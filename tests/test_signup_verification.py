"""Email proof is single use, short lived, and never creates an early account."""
import unittest
from unittest.mock import patch
from backend import workbench
from backend.signup_verification import SignupVerification
from tests.test_http import HttpHarness

class SignupVerificationTests(HttpHarness, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.service = SignupVerification(workbench.get_repository())
        self.delivery = patch('backend.signup_verification.send_code').start()
        self.addCleanup(patch.stopall)
        self.payload = dict(first_name='Code', last_name='Fixture', email='code@example.test', password=self.password)

    def start(self):
        challenge = self.service.start(self.payload, 'signup-fixture')
        return challenge, self.delivery.call_args.args[1]

    def test_http_waits_for_email_proof_then_creates_only_one_account(self):
        with patch('backend.signup_verification.required', return_value=True):
            status, challenge = self.request('POST', '/api/auth/register', self.payload)
        self.assertEqual(status, 202)
        with workbench.get_repository()._connection() as connection:
            self.assertIsNone(connection.execute('SELECT 1 FROM accounts WHERE email=?', (self.payload['email'],)).fetchone())
            row = dict(connection.execute('SELECT * FROM signup_verifications').fetchone())
        code = self.delivery.call_args.args[1]
        self.assertNotIn(code, str(row))
        self.assertNotIn(self.password, str(row))
        self.assertNotIn(challenge['challenge'], str(row))
        status, data = self.request('POST', '/api/auth/verify-email', dict(challenge=challenge['challenge'], code=code))
        self.assertEqual(status, 200)
        self.assertEqual(data['user']['email'], self.payload['email'])
        self.assertEqual(self.request('POST', '/api/auth/verify-email', dict(challenge=challenge['challenge'], code=code))[0], 400)

    def test_three_wrong_attempts_lock_even_the_correct_code(self):
        challenge, code = self.start()
        wrong = '000000' if code != '000000' else '111111'
        for remaining in (2, 1, 0):
            with self.assertRaises(ValueError):
                self.service.verify(dict(challenge=challenge['challenge'], code=wrong), 'verify-fixture')
        with self.assertRaises(ValueError):
            self.service.verify(dict(challenge=challenge['challenge'], code=code), 'verify-fixture')
        with workbench.get_repository()._connection() as connection:
            self.assertEqual(connection.execute('SELECT attempts FROM signup_verifications').fetchone()[0], 3)

    def test_five_minute_expiry_and_resend_invalidate_old_code(self):
        challenge, code = self.start()
        with self.assertRaises(ValueError):
            self.service.resend(challenge, 'resend-fixture')
        with workbench.get_repository()._connection(write=True) as connection:
            connection.execute('UPDATE signup_verifications SET expires_at=expires_at-61')
        replacement = self.service.resend(challenge, 'resend-fixture')
        with self.assertRaises(ValueError):
            self.service.verify(dict(challenge=challenge['challenge'], code=code), 'verify-fixture')
        with workbench.get_repository()._connection(write=True) as connection:
            connection.execute('UPDATE signup_verifications SET expires_at=0')
        with self.assertRaises(ValueError):
            self.service.verify(dict(challenge=replacement['challenge'], code=self.delivery.call_args.args[1]), 'verify-fixture')

    def test_delivery_failure_leaves_no_pending_signup(self):
        self.delivery.side_effect = ValueError('Unavailable')
        with self.assertRaises(ValueError):
            self.start()
        with workbench.get_repository()._connection() as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM signup_verifications').fetchone()[0], 0)
