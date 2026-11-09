"""Invitation HTTP boundaries with isolated state and a stubbed mail transport."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from io import BytesIO
import json
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from backend import cloud_state, email_delivery as mail, settings, workbench, wsgi
from backend.workspaces import AUTHORIZATION_LOCK
from tests.test_http import HttpHarness


class InvitationHttpTests(HttpHarness, unittest.TestCase):
    def setUp(self):
        self.config = {}
        self.configuration = patch.object(settings, 'value', side_effect=lambda name, default='': self.config.get(name, default))
        self.configuration.start()
        self.addCleanup(self.configuration.stop)
        super().setUp()
        self.owner_login = (self.cookie, self.csrf)
        status, self.workspace = self.request('POST', '/api/workspaces', {'name': 'Research team'})
        self.assertEqual(status, 201, self.workspace)
        self.workspace_path = '/api/workspaces/' + self.workspace['workspace_id']
        self.invite_path = self.workspace_path + '/invite'
        self.provider_id = '8ac9821e-667d-4c33-9005-1ade91f33849'

    def request(self, method, path, payload=None, session_id=None, extra_headers=None, raw=False):
        headers = {'Host': urlsplit(self.config['GENIE_PUBLIC_URL']).netloc} if self.config.get('GENIE_PUBLIC_URL') else {}
        headers.update(extra_headers or {})
        return super().request(method, path, payload, session_id, headers, raw)

    def enabled(self, cloud=False):
        self.config.update({'GENIE_EMAIL_CONNECTION_STRING': 'endpoint=https://mail.example;accesskey=private-key',
                            'GENIE_EMAIL_SENDER': 'DoNotReply@verified.example.test',
                            'GENIE_PUBLIC_URL': 'https://genie.example.test'})
        if cloud:
            self.config['GENIE_CLOUD_STATE'] = 'azure_sql'

    def sent(self, *_):
        return {'email_status': 'sent', 'provider_message_id': self.provider_id}

    def invite(self, email='recipient@example.test'):
        return self.request('POST', self.invite_path, {'email': email, 'role': 'member'})

    def recipient(self, email='recipient@example.test'):
        self.cookie = self.csrf = ''
        status, result = self.request('POST', '/api/auth/register', {
            'first_name': 'Recipient', 'last_name': 'Fixture', 'email': email, 'password': self.password})
        self.assertEqual(status, 201, result)

    def accept(self, invitation):
        return self.request('POST', '/api/workspaces/invitations/accept', {
            'invitation_id': invitation['invitation_id'], 'token': invitation['token']})

    def wsgi_request(self, payload, **extra):
        body = json.dumps(payload).encode()
        environ = {'REQUEST_METHOD': 'POST', 'PATH_INFO': self.invite_path, 'QUERY_STRING': '',
                   'HTTP_HOST': 'genie.example.test', 'HTTP_ORIGIN': 'https://genie.example.test',
                   'HTTP_COOKIE': self.cookie, 'HTTP_X_CSRF_TOKEN': self.csrf,
                   'CONTENT_TYPE': 'application/json', 'CONTENT_LENGTH': str(len(body)),
                   'REMOTE_ADDR': '127.0.0.1', 'wsgi.input': BytesIO(body)}
        environ.update(extra)
        response = {}
        def start(status, headers):
            response.update(status=int(status.split()[0]), headers=dict(headers))
        response['body'] = json.loads(b''.join(wsgi.application(environ, start)))
        return response

    def test_unconfigured_email_returns_usable_copy_link_and_persisted_manual_status(self):
        with patch.object(mail, 'send_invitation') as send:
            status, invitation = self.invite()
        self.assertEqual(status, 201, invitation)
        self.assertEqual(invitation['email_status'], 'not_configured')
        self.assertIn('Copy and share', invitation['email_message'])
        send.assert_not_called()
        parsed = urlsplit(invitation['invitation_url'])
        self.assertEqual(parsed.netloc, '127.0.0.1:8000')
        self.assertEqual(parse_qs(parsed.query)['token'], [invitation['token']])
        status, detail = self.request('GET', self.workspace_path)
        self.assertEqual(status, 200)
        self.assertFalse(detail['email']['enabled'])
        self.assertEqual(detail['invitations'][0]['email_status'], 'not_configured')
        self.assertNotIn(invitation['token'], json.dumps(detail))
        self.recipient()
        self.assertEqual(self.accept(invitation)[0], 200)

    def test_success_is_persisted_publicly_without_provider_id_or_secret_configuration(self):
        self.enabled()
        with patch.object(mail, 'send_invitation', side_effect=self.sent) as send:
            status, invitation = self.invite()
        self.assertEqual(status, 201, invitation)
        self.assertEqual(invitation['email_status'], 'sent')
        self.assertNotIn('delivered', invitation['email_message'].lower())
        self.assertNotIn('provider_message_id', invitation)
        self.assertNotIn(self.provider_id, json.dumps(invitation))
        self.assertNotIn('private-key', json.dumps(invitation))
        sent_invitation, inviter, url = send.call_args.args
        self.assertEqual(sent_invitation['email'], 'recipient@example.test')
        self.assertEqual(inviter, 'Ada Lovelace')
        self.assertEqual(url, invitation['invitation_url'])
        self.assertTrue(url.startswith('https://genie.example.test/workspaces?'))
        _, detail = self.request('GET', self.workspace_path)
        self.assertEqual(detail['invitations'][0]['email_status'], 'sent')
        self.assertNotIn(self.provider_id, json.dumps(detail))
        self.assertNotIn(invitation['token'], json.dumps(detail))
        with workbench.get_repository()._connection() as connection:
            row = connection.execute('SELECT provider_message_id FROM workspace_invitation_emails WHERE invitation_id=?',
                                     (invitation['invitation_id'],)).fetchone()
            self.assertEqual(row[0], self.provider_id)

    def test_failed_email_still_returns_usable_invitation_and_sanitized_persisted_status(self):
        self.enabled()
        with patch.object(mail, 'send_invitation', return_value={
                'email_status': 'failed', 'email_message': 'private provider diagnostic',
                'error_code': 'send_unconfirmed', 'provider_message_id': 'private-key'}):
            status, invitation = self.invite()
        self.assertEqual(status, 201, invitation)
        self.assertEqual(invitation['email_status'], 'failed')
        self.assertIn('could not be confirmed', invitation['email_message'])
        self.assertNotIn('private provider diagnostic', json.dumps(invitation))
        self.assertNotIn('private-key', json.dumps(invitation))
        _, detail = self.request('GET', self.workspace_path)
        self.assertEqual(detail['invitations'][0]['email_status'], 'failed')
        self.recipient()
        self.assertEqual(self.accept(invitation)[0], 200)

    def test_login_csrf_and_live_owner_permission_are_required_before_any_send(self):
        status, invitation = self.invite()
        self.assertEqual(status, 201)
        self.recipient()
        self.assertEqual(self.accept(invitation)[0], 200)
        member_login = (self.cookie, self.csrf)
        self.enabled()
        with patch.object(mail, 'send_invitation') as send:
            self.cookie = self.csrf = ''
            self.assertEqual(self.invite('new@example.test')[0], 401)
            self.cookie, self.csrf = self.owner_login
            self.assertEqual(self.request('POST', self.invite_path, {'email': 'new@example.test'},
                                          extra_headers={'X-CSRF-Token': ''})[0], 403)
            self.cookie, self.csrf = member_login
            self.assertEqual(self.invite('new@example.test')[0], 403)
            send.assert_not_called()
        self.cookie, self.csrf = self.owner_login
        _, detail = self.request('GET', self.workspace_path)
        self.assertEqual(len(detail['invitations']), 1)
        self.cookie, self.csrf = member_login
        _, detail = self.request('GET', self.workspace_path)
        self.assertEqual(detail['invitations'], [])

    def test_recipient_cooldown_rotates_to_a_new_usable_manual_link_without_another_send(self):
        self.enabled()
        with patch.object(mail, 'send_invitation', side_effect=self.sent) as send:
            status, original = self.invite()
            self.assertEqual(status, 201)
            status, replacement = self.invite()
        self.assertEqual(status, 201, replacement)
        self.assertEqual(replacement['email_status'], 'failed')
        self.assertGreater(replacement['retry_after'], 0)
        self.assertIn('private link', replacement['email_message'])
        self.assertNotEqual(replacement['token'], original['token'])
        self.assertNotEqual(replacement['invitation_id'], original['invitation_id'])
        send.assert_called_once()
        self.recipient()
        self.assertEqual(self.accept(original)[0], 403)
        self.assertEqual(self.accept(replacement)[0], 200)

    def test_hosted_send_occurs_between_two_short_durable_transactions(self):
        self.enabled(cloud=True)
        depth, events = 0, []
        @contextmanager
        def transaction():
            nonlocal depth
            depth += 1
            events.append('enter')
            try:
                yield
            finally:
                depth -= 1
                events.append('exit')
        def send(invitation, inviter, url):
            self.assertEqual(depth, 0, 'The provider must not run inside the durable state lock.')
            self.assertEqual(events, ['enter', 'exit'])
            with workbench.get_repository()._connection(write=True) as connection:
                row = connection.execute('SELECT status FROM workspace_invitation_emails WHERE invitation_id=?',
                                         (invitation['invitation_id'],)).fetchone()
                self.assertEqual(row['status'], 'sending')
            def authorization_lock_is_available():
                acquired = AUTHORIZATION_LOCK.acquire(timeout=0.1)
                if acquired:
                    AUTHORIZATION_LOCK.release()
                return acquired
            with ThreadPoolExecutor(max_workers=1) as pool:
                self.assertTrue(pool.submit(authorization_lock_is_available).result(timeout=1))
            events.append('send')
            return self.sent()
        with patch.object(cloud_state, 'transaction', transaction), patch.object(mail, 'send_invitation', side_effect=send):
            response = self.wsgi_request({'email': 'recipient@example.test', 'role': 'member'})
        self.assertEqual(response['status'], 201, response)
        self.assertEqual(events, ['enter', 'exit', 'send', 'enter', 'exit'])
        self.assertEqual(response['body']['email_status'], 'sent')

    def test_hosted_expected_request_errors_keep_their_status_without_sending(self):
        self.enabled(cloud=True)
        @contextmanager
        def transaction():
            # Match the adapter's conversion of unexpected exceptions. Expected
            # request errors must be caught before leaving its context.
            try:
                yield
            except Exception:
                raise cloud_state.StateUnavailable('Uncaught request error was converted.', retry_safe=False) from None
        with patch.object(cloud_state, 'transaction', transaction), patch.object(mail, 'send_invitation') as send:
            self.assertEqual(self.wsgi_request({'email': 'recipient@example.test'}, HTTP_X_CSRF_TOKEN='')['status'], 403)
            self.assertEqual(self.wsgi_request({'email': 'recipient@example.test'}, HTTP_COOKIE='')['status'], 401)
            self.assertEqual(self.wsgi_request({'email': 'not-an-email'})['status'], 400)
            send.assert_not_called()

    def test_hosted_foreign_origin_never_opens_durable_state_or_sends(self):
        self.enabled(cloud=True)
        with patch.object(cloud_state, 'transaction') as transaction, patch.object(mail, 'send_invitation') as send:
            response = self.wsgi_request({'email': 'recipient@example.test'}, HTTP_ORIGIN='https://attacker.example')
        self.assertEqual(response['status'], 403)
        transaction.assert_not_called()
        send.assert_not_called()

    def test_status_persistence_failure_after_send_is_uncertain_and_never_safe_to_replay(self):
        self.enabled(cloud=True)
        calls = 0
        @contextmanager
        def transaction():
            nonlocal calls
            calls += 1
            if calls == 2:
                raise cloud_state.StateUnavailable('A new storage connection failed.', retry_safe=True)
            yield
        with patch.object(cloud_state, 'transaction', transaction), \
                patch.object(mail, 'send_invitation', side_effect=self.sent) as send:
            response = self.wsgi_request({'email': 'recipient@example.test'})
        self.assertEqual(response['status'], 503, response)
        self.assertFalse(response['body']['retry_safe'])
        self.assertEqual(response['body']['recovery'], 'check_history')
        send.assert_called_once()
        sent_invitation = send.call_args.args[0]
        self.assertNotIn(sent_invitation['token'], json.dumps(response['body']))
        saved = mail.invitation_status(workbench.get_repository(), sent_invitation['invitation_id'])
        self.assertEqual(saved['email_status'], 'failed')
        self.assertIn('could not be confirmed', saved['email_message'])


if __name__ == '__main__':
    unittest.main()
