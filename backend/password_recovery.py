"""Single-use, hashed password recovery tokens with generic request responses."""
import secrets
import time
import logging
import threading
from concurrent.futures import ThreadPoolExecutor

from .authentication import Accounts, password_hash, token_hash
from .signup_verification import send_email


LIFETIME = 15 * 60
RESPONSE = {'message': 'If an account with a password exists for this email, you will receive instructions to reset it. Check your inbox and spam folder.'}
_DELIVERY_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix='genie-account-email')
_DELIVERY_SLOTS = threading.BoundedSemaphore(16)


def _deliver_email(email, message):
    try:
        send_email(email, 'Reset your Data Genie password', message)
    except Exception:
        # Do not log the address, provider payload, or recovery secret.
        logging.getLogger(__name__).warning('Password reset email delivery failed.')
    finally:
        _DELIVERY_SLOTS.release()


def queue_reset_email(email, message):
    """Bound work and return before provider latency can disclose an account.

    Workers perform no repository access, so hosted state remains exclusively
    owned by the request's durable transaction. A restart can drop queued email;
    the person can request a fresh link in that case.
    """
    if not _DELIVERY_SLOTS.acquire(blocking=False):
        return False
    try:
        _DELIVERY_POOL.submit(_deliver_email, email, message)
    except RuntimeError:
        _DELIVERY_SLOTS.release()
        return False
    return True


class PasswordRecovery:
    def __init__(self, repository):
        self.repository = repository
        self.accounts = Accounts(repository)

    def start(self, payload, client, origin):
        # No email policy check here: an existing user must retain recovery
        # access even if registration policy changed after account creation.
        self.accounts._reserve_attempt(client, 'register')
        email = str(payload.get('email') or '').strip().lower()[:254]
        # Do not throttle unknown addresses differently from registered ones.
        self.accounts._reserve_attempt('password-reset:' + token_hash(email), 'register')
        token, now = secrets.token_urlsafe(32), int(time.time())
        with self.repository._connection(write=True) as connection:
            connection.execute('DELETE FROM password_resets WHERE expires_at<=?', (now,))
            account = self.accounts._account(connection, 'email', email)
            eligible = bool(account and account['password_hash'].startswith('pbkdf2_sha256$'))
            if eligible:
                connection.execute('DELETE FROM password_resets WHERE account_id=?', (account['account_id'],))
                connection.execute('INSERT INTO password_resets VALUES(?,?,?)',
                                   (token_hash(token), account['account_id'], now + LIFETIME))
        if eligible:
            try:
                from .agent_tokens import AgentTokens
                AgentTokens(self.repository).reserve('password-reset-email-delivery', 200, 86400)
                # A fragment keeps the secret out of HTTP request URLs and
                # referrers. The page submits it only in the JSON reset body.
                link = origin.rstrip('/') + '/reset-password#token=' + token
                queued = queue_reset_email(email, f'Use this link to choose a new Data Genie password:\n\n{link}\n\n'
                           'This link expires in 15 minutes and can be used once. '
                           'If you did not request this, ignore this email. Your password has not changed.')
                if not queued:
                    raise RuntimeError('Email queue unavailable.')
            except Exception:
                with self.repository._connection(write=True) as connection:
                    connection.execute('DELETE FROM password_resets WHERE token_hash=?', (token_hash(token),))
                # Availability, status, and message must not reveal whether an
                # account exists, including during an email-provider outage.
        return dict(RESPONSE)

    def finish(self, payload, client):
        self.accounts._reserve_attempt(client, 'login')
        token = payload.get('token')
        if not isinstance(token, str) or not 32 <= len(token) <= 128:
            raise ValueError('This reset link is invalid or expired. Request a new one.')
        # Validate the password before consuming the single-use token.
        encoded = password_hash(payload.get('new_password'))
        now = int(time.time())
        with self.repository._connection(write=True) as connection:
            row = connection.execute('SELECT * FROM password_resets WHERE token_hash=?', (token_hash(token),)).fetchone()
            if not row or row['expires_at'] <= now:
                raise ValueError('This reset link is invalid or expired. Request a new one.')
            account = self.accounts._account(connection, 'account_id', row['account_id'])
            if not account or not account['password_hash'].startswith('pbkdf2_sha256$'):
                raise ValueError('This reset link is invalid or expired. Request a new one.')
            connection.execute('UPDATE accounts SET password_hash=? WHERE account_id=?', (encoded, row['account_id']))
            connection.execute('DELETE FROM browser_logins WHERE account_id=?', (row['account_id'],))
            connection.execute('UPDATE agent_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE account_id=?', (now, row['account_id']))
            connection.execute('DELETE FROM password_resets WHERE account_id=?', (row['account_id'],))
            # The mailbox owner can recover immediately from a password lockout.
            connection.execute('DELETE FROM login_attempts WHERE attempt_key IN (?,?)',
                               (token_hash('account:' + account['email']), token_hash(client + ':' + account['email'])))
        return {'message': 'Your password has been updated. Log in with your new password. Other logins and agent connections have been signed out.'}
