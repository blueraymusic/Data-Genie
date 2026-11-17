"""Recovery never exposes account presence, and mailbox tokens are single-use."""
from concurrent.futures import ThreadPoolExecutor
import re
import time
import unittest
from unittest.mock import patch

from backend import authentication, workbench
from backend.password_recovery import PasswordRecovery, RESPONSE, queue_reset_email
from tests.test_http import HttpHarness


class PasswordRecoveryTests(HttpHarness, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.service = PasswordRecovery(workbench.get_repository())
        self.delivery = patch('backend.password_recovery.queue_reset_email', return_value=True).start()
        self.addCleanup(patch.stopall)

    def start(self):
        response = self.service.start({'email': self.account['email']}, 'recover-fixture', 'http://localhost:8000')
        token = re.search(r'#token=([\w-]+)', self.delivery.call_args.args[1]).group(1)
        return response, token

    def test_http_response_does_not_identify_registered_or_unknown_addresses(self):
        bodies = []
        for email in (self.account['email'], 'missing@example.test'):
            status, body = self.request('POST', '/api/auth/forgot-password', {'email': email})
            self.assertEqual(status, 202)
            self.assertNotIn('Set-Cookie:', self.last_headers)
            bodies.append(body)
        self.assertEqual(bodies, [RESPONSE, RESPONSE])
        self.assertEqual(self.delivery.call_count, 1)
        self.delivery.side_effect = RuntimeError('provider down')
        status, body = self.request('POST', '/api/auth/forgot-password', {'email': self.account['email']})
        self.assertEqual((status, body), (202, RESPONSE))
        with workbench.get_repository()._connection() as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM password_resets').fetchone()[0], 0)

    def test_hashed_token_resets_password_once_and_revokes_existing_logins_and_agents(self):
        _, token = self.start()
        accounts = authentication.Accounts(workbench.get_repository())
        other_login = accounts.issue_login(self.account['account_id'])
        from backend.agent_tokens import AgentTokens
        agents = AgentTokens(workbench.get_repository())
        key = agents.create(self.account['account_id'], {'name': 'Recovery test', 'workspace_id': self.session['access']['workspace_id']})
        new_password = 'a recovered long passphrase 357'
        with workbench.get_repository()._connection() as connection:
            stored = dict(connection.execute('SELECT * FROM password_resets').fetchone())
        self.assertNotIn(token, str(stored))
        status, response = self.request('POST', '/api/auth/reset-password', {'token': token, 'new_password': new_password})
        self.assertEqual(status, 200)
        self.assertNotIn('Set-Cookie:', self.last_headers)
        with self.assertRaises(authentication.LoginRequired):
            accounts.authenticate(other_login)
        with self.assertRaises(authentication.LoginRequired):
            agents.authenticate('Bearer ' + key['token'], 'recovered-agent')
        self.assertEqual(self.request('POST', '/api/auth/reset-password', {'token': token, 'new_password': self.password})[0], 400)
        self.assertEqual(self.request('POST', '/api/auth/login', {'email': self.account['email'], 'password': self.password})[0], 401)
        self.assertEqual(self.request('POST', '/api/auth/login', {'email': self.account['email'], 'password': new_password})[0], 200)

    def test_invalid_password_does_not_consume_token_and_expired_or_replaced_tokens_fail(self):
        _, first = self.start()
        with self.assertRaisesRegex(ValueError, '15 to 128'):
            self.service.finish({'token': first, 'new_password': 'short'}, 'reset-fixture')
        _, replacement = self.start()
        with self.assertRaisesRegex(ValueError, 'invalid or expired'):
            self.service.finish({'token': first, 'new_password': self.password}, 'reset-fixture')
        with patch('backend.password_recovery.time.time', return_value=time.time() + 901):
            with self.assertRaisesRegex(ValueError, 'invalid or expired'):
                self.service.finish({'token': replacement, 'new_password': self.password}, 'reset-fixture')

    def test_two_concurrent_uses_cannot_both_change_the_password(self):
        _, token = self.start()
        def reset(index):
            try:
                self.service.finish({'token': token, 'new_password': self.password + str(index)}, 'reset-' + str(index))
                return 'changed'
            except ValueError:
                return 'expired'
        with ThreadPoolExecutor(max_workers=2) as executor:
            outcomes = list(executor.map(reset, range(2)))
        self.assertCountEqual(outcomes, ['changed', 'expired'])

    def test_reset_recovers_from_password_lockout(self):
        for _ in range(authentication.MAX_ATTEMPTS):
            self.assertEqual(self.request('POST', '/api/auth/login', {'email': self.account['email'], 'password': 'wrong'})[0], 401)
        _, token = self.start()
        self.assertEqual(self.request('POST', '/api/auth/reset-password', {'token': token, 'new_password': self.password})[0], 200)
        self.assertEqual(self.request('POST', '/api/auth/login', {'email': self.account['email'], 'password': self.password})[0], 200)

    def test_microsoft_only_account_does_not_gain_a_password(self):
        with workbench.get_repository()._connection(write=True) as connection:
            connection.execute('UPDATE accounts SET password_hash=? WHERE account_id=?', (authentication.MICROSOFT_PASSWORD_SENTINEL, self.account['account_id']))
        self.assertEqual(self.service.start({'email': self.account['email']}, 'recover-fixture', 'http://localhost:8000'), RESPONSE)
        self.delivery.assert_not_called()

    def test_delivery_does_not_delay_request_or_log_email_or_token_on_failure(self):
        from backend import password_recovery
        with patch('backend.password_recovery.queue_reset_email', wraps=queue_reset_email), \
                patch.object(password_recovery._DELIVERY_POOL, 'submit') as submit, \
                patch('backend.password_recovery.send_email', side_effect=RuntimeError('private provider detail')) as sender:
            result = self.service.start({'email': self.account['email']}, 'recover-fixture', 'http://localhost:8000')
            self.assertEqual(result, RESPONSE)
            sender.assert_not_called()
            task, email, message = submit.call_args.args
            self.assertIn('#token=', message)
            with self.assertLogs('backend.password_recovery', level='WARNING') as logs:
                task(email, message)
            sender.assert_called_once()
            self.assertNotIn(email, str(logs.output))
            self.assertNotIn('private provider detail', str(logs.output))
            self.assertNotIn('#token=', str(logs.output))


class RegistrationEmailPolicyTests(HttpHarness, unittest.TestCase):
    def test_disposable_addresses_blocked_before_account_or_signup_challenge(self):
        from backend.signup_verification import SignupVerification
        payload = dict(first_name='New', last_name='Reader', email='temporary@aiqseo.com', password=self.password)
        with self.assertRaisesRegex(ValueError, 'Temporary email'):
            SignupVerification(workbench.get_repository()).start(payload, 'email-fixture')
        self.assertEqual(self.request('POST', '/api/auth/register', payload)[0], 400)
        with workbench.get_repository()._connection() as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM signup_verifications').fetchone()[0], 0)

    def test_organization_allowlist_is_configurable(self):
        from backend.email_policy import registration_email
        with patch('backend.email_policy.settings.value', side_effect=lambda key: 'company.example' if key == 'GENIE_ALLOWED_EMAIL_DOMAINS' else ''):
            self.assertEqual(registration_email('Person@company.example'), 'person@company.example')
            with self.assertRaisesRegex(ValueError, 'approved organization'):
                registration_email('person@gmail.com')
        self.assertEqual(registration_email('person@gmail.com'), 'person@gmail.com')

    def test_invalid_mailbox_spellings_are_rejected_and_normal_aliases_still_work(self):
        from backend.email_policy import registration_email
        for email in ('a@gmail.com.', 'a@-company.com', 'a@company..com', '.a@gmail.com', 'a..b@gmail.com', 'a@company.com/path'):
            with self.subTest(email=email), self.assertRaises(ValueError):
                registration_email(email)
        self.assertEqual(registration_email('Person+team@Gmail.com'), 'person+team@gmail.com')
        self.assertEqual(registration_email('reader@bücher.example'), 'reader@bücher.example')
        with self.assertRaisesRegex(ValueError, 'Temporary email'):
            registration_email('reader@sub.aiqseo.com')
