"""Optional invitation emails; private links exist only in memory during sending.

The caller authorizes the owner, reserves and durably commits an attempt, then
sends outside repository transactions. A timeout never triggers an automatic
resend: Azure may already have accepted the first message.
"""

from datetime import datetime, timezone
import hashlib
from html import escape
import re
import time
from urllib.parse import parse_qs, urlsplit
import uuid

from . import settings


SEND_TIMEOUT = 20
_SENT = 'Email sent. Ask your teammate to check their inbox and spam folder.'
_DISABLED = 'Invitation email is not configured. Copy and share the private invitation link.'
_FAILED = 'The invitation email could not be sent. Copy and share the private link, or try again later.'
_UNCERTAIN = ('Email status could not be confirmed. Check with your teammate before sending another '
              'invitation, or share the private link.')
_ERROR_CODES = {'send_failed', 'send_unconfirmed', 'invalid_message', 'provider_unavailable'}


class EmailRateLimited(ValueError):
    def __init__(self, retry_after):
        self.retry_after = max(1, int(retry_after))
        super().__init__('Invitation email limit reached. Wait before sending another email.')


def _address(value):
    if (not isinstance(value, str) or len(value) > 254
            or not re.fullmatch(r'[^@\s<>,;:"\\\x00-\x1f\x7f]+@[^@\s<>,;:"\\\x00-\x1f\x7f]+', value)):
        raise ValueError('Use a single email address.')
    return value


def _config():
    connection = settings.value('GENIE_EMAIL_CONNECTION_STRING').strip()
    sender = settings.value('GENIE_EMAIL_SENDER').strip()
    reply = settings.value('GENIE_EMAIL_REPLY_TO').strip()
    try:
        origin = settings.public_url()
        if not connection or not sender or not origin:
            return None
        _address(sender)
        if reply:
            _address(reply)
        if any(ord(character) < 32 for character in connection):
            return None
    except ValueError:
        return None
    return {'connection': connection, 'sender': sender, 'reply': reply, 'origin': origin}


def public_settings():
    enabled = _config() is not None
    return {'enabled': enabled, 'provider': 'Azure Communication Services' if enabled else None}


def _text(value, maximum=200):
    # Names can appear in the subject, so remove every control and line separator.
    return ' '.join(''.join(character if character.isprintable() else ' '
                            for character in str(value or '')).split())[:maximum]


def _invitation_url(invitation, url):
    if not isinstance(url, str) or len(url) > 2048 or any(ord(char) < 32 for char in url):
        raise ValueError('Use the private invitation link.')
    parsed = urlsplit(url)
    query = parse_qs(parsed.query)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.path != '/workspaces' or parsed.fragment
            or set(query) != {'invite', 'token'} or len(query['invite']) != 1
            or len(query['token']) != 1 or query['invite'][0] != invitation.get('invitation_id')
            or not 1 <= len(query['token'][0]) <= 500):
        raise ValueError('Use the private invitation link.')
    return url


def invitation_message(invitation, inviter_display_name, url):
    """Build SDK content without including database contents or account secrets."""
    url = _invitation_url(invitation, url)
    workspace = _text(invitation.get('workspace_name'), 100) or 'a workspace'
    inviter = _text(inviter_display_name) or 'A teammate'
    recipient = _address(invitation.get('email'))
    role = 'viewer' if invitation.get('role') == 'viewer' else 'member'
    try:
        expires = datetime.fromtimestamp(int(invitation['expires_at']), timezone.utc).strftime('%B %d, %Y at %H:%M UTC')
    except (KeyError, TypeError, ValueError, OverflowError, OSError):
        expires = 'the expiry shown on your invitation'
    subject = f'Join {workspace} on Data Genie'
    explanation = (f'{inviter} invited you to join {workspace} as a {role}. '
                   f'Sign in or create an account with {recipient}, then choose Join workspace.')
    plain = (f'Data Genie\n\n{explanation}\n\nOpen your invitation:\n{url}\n\n'
             f'This private invitation expires {expires}.\n'
             'Keep this link private. If you did not expect this invitation, you can ignore this email.')
    html = ('<!doctype html><html><body style="margin:0;background:#f5f6fb;color:#18213a;'
            'font-family:Arial,sans-serif"><main style="max-width:560px;margin:32px auto;'
            'padding:32px;background:#fff;border-radius:16px">'
            '<p style="color:#6857d8;font-weight:bold">DATA GENIE</p>'
            '<h1 style="font-size:26px">You’re invited to a workspace</h1>'
            f'<p style="line-height:1.6">{escape(explanation)}</p>'
            f'<p style="margin:28px 0"><a href="{escape(url, quote=True)}" '
            'style="background:#6857d8;color:#fff;text-decoration:none;padding:14px 20px;'
            'border-radius:8px;display:inline-block">Open invitation</a></p>'
            f'<p style="line-height:1.6">This private invitation expires {escape(expires)}.</p>'
            '<p style="font-size:13px;color:#667085;line-height:1.6">Keep this link private. '
            'If you did not expect this invitation, you can ignore this email.</p>'
            '</main></body></html>')
    return {'subject': subject, 'plainText': plain, 'html': html}


def _result(status, error_code=None, provider_message_id=None):
    result = {'email_status': status,
              'email_message': (_SENT if status == 'sent' else _DISABLED if status == 'not_configured'
                                else _UNCERTAIN if error_code == 'send_unconfirmed' else _FAILED)}
    if error_code in _ERROR_CODES:
        result['error_code'] = error_code
    if provider_message_id is not None:
        try:
            result['provider_message_id'] = str(uuid.UUID(str(provider_message_id)))
        except (ValueError, TypeError, AttributeError):
            pass
    return result


def send_invitation(invitation, inviter_display_name, url):
    """Make one send attempt. 'sent' means provider accepted, not inbox delivery."""
    config = _config()
    if config is None:
        return _result('not_configured')
    try:
        content = invitation_message(invitation, inviter_display_name, url)
        parsed = urlsplit(url)
        if f'{parsed.scheme}://{parsed.netloc}' != config['origin']:
            return _result('failed', 'invalid_message')
        message = {'senderAddress': config['sender'], 'content': content,
                   'recipients': {'to': [{'address': invitation['email']}]}}
        if config['reply']:
            message['replyTo'] = [{'address': config['reply']}]
    except (ValueError, TypeError, KeyError):
        return _result('failed', 'invalid_message')
    try:
        from azure.communication.email import EmailClient
    except ImportError:
        return _result('failed', 'provider_unavailable')
    client = None
    try:
        client = EmailClient.from_connection_string(
            config['connection'], retry_total=0, connection_timeout=5, read_timeout=10,
            logging_enable=False)
        outcome = client.begin_send(message, logging_enable=False).result(timeout=SEND_TIMEOUT)
        if isinstance(outcome, dict) and outcome.get('status') == 'Succeeded':
            return _result('sent', provider_message_id=outcome.get('id'))
        if isinstance(outcome, dict) and outcome.get('status') in {'Failed', 'Canceled'}:
            return _result('failed', 'send_failed')
        return _result('failed', 'send_unconfirmed')
    except TimeoutError:
        return _result('failed', 'send_unconfirmed')
    except Exception:
        # SDK exception strings may contain credentials, private links or recipients.
        # A transport failure can occur after acceptance, so never replay it here.
        return _result('failed', 'send_unconfirmed')
    finally:
        if client is not None:
            try:
                client.close()
            except Exception:
                pass


def _daily_limit():
    try:
        return max(1, min(1000, int(settings.value('GENIE_EMAIL_DAILY_LIMIT', '100'))))
    except (ValueError, TypeError):
        return 100


def _bucket(scope, value=''):
    return hashlib.sha256(('data-genie-invitation-email:' + scope + ':' + str(value)).encode('utf-8')).hexdigest()


def reserve_attempt(repository, account_id, email, invitation_id):
    """Spend all limits atomically before any external call, without storing emails."""
    recipient = _address(email).lower()
    with repository._connection(write=True) as connection:
        now = int(time.time())
        invitation = connection.execute('SELECT * FROM workspace_invitations WHERE invitation_id=?',
                                        (invitation_id,)).fetchone()
        if (invitation is None or invitation['invited_by'] != account_id
                or invitation['email'].lower() != recipient or invitation['accepted_at'] is not None
                or invitation['revoked_at'] is not None or invitation['expires_at'] <= now):
            raise ValueError('This invitation is not available.')
        limits = [(_bucket('global'), 86400, _daily_limit()),
                  (_bucket('owner', account_id), 3600, 20),
                  (_bucket('recipient', recipient), 60, 1)]
        remaining = []
        for key, period, maximum in limits:
            row = connection.execute('SELECT * FROM workspace_email_rate_limits WHERE bucket_key=?', (key,)).fetchone()
            if row is not None and row['expires_at'] > now and row['attempts'] >= maximum:
                remaining.append(row['expires_at'] - now)
        if remaining:
            raise EmailRateLimited(max(remaining))
        connection.execute('DELETE FROM workspace_email_rate_limits WHERE expires_at<=?', (now,))
        for key, period, maximum in limits:
            connection.execute('''INSERT INTO workspace_email_rate_limits VALUES(?,?,?,1)
                ON CONFLICT(bucket_key) DO UPDATE SET attempts=attempts+1''', (key, now, now + period))
        connection.execute('''INSERT INTO workspace_invitation_emails
            (invitation_id,status,attempted_at) VALUES(?,'sending',?)
            ON CONFLICT(invitation_id) DO UPDATE SET status='sending',attempted_at=excluded.attempted_at,
                completed_at=NULL,provider_message_id=NULL,error_code=NULL''', (invitation_id, now))


def record_result(repository, invitation_id, result):
    """Store only bounded transport metadata, never provider errors or email content."""
    status = result.get('email_status')
    if status not in {'sent', 'failed', 'not_configured'}:
        raise ValueError('Choose a valid invitation email status.')
    safe = _result(status, result.get('error_code'), result.get('provider_message_id'))
    with repository._connection(write=True) as connection:
        connection.execute('''INSERT INTO workspace_invitation_emails
            (invitation_id,status,completed_at,provider_message_id,error_code) VALUES(?,?,?,?,?)
            ON CONFLICT(invitation_id) DO UPDATE SET status=excluded.status,completed_at=excluded.completed_at,
                provider_message_id=excluded.provider_message_id,error_code=excluded.error_code''',
                           (invitation_id, status, int(time.time()), safe.get('provider_message_id'), safe.get('error_code')))


def _public_status(row):
    status = row['status'] if row else 'not_configured'
    result = _result('failed', 'send_unconfirmed') if status == 'sending' else _result(status, row['error_code'] if row else None)
    result.pop('error_code', None)
    if row and row['attempted_at'] is not None:
        result['email_attempted_at'] = row['attempted_at']
    return result


def invitation_status(repository, invitation_id):
    with repository._connection() as connection:
        row = connection.execute('SELECT * FROM workspace_invitation_emails WHERE invitation_id=?', (invitation_id,)).fetchone()
        return _public_status(row)


def workspace_statuses(repository, workspace_id):
    """Owner authorization is the caller's responsibility; provider IDs stay private."""
    with repository._connection() as connection:
        return {row['invitation_id']: _public_status(row) for row in connection.execute('''
            SELECT e.* FROM workspace_invitation_emails e JOIN workspace_invitations i USING(invitation_id)
            WHERE i.workspace_id=?''', (workspace_id,))}
