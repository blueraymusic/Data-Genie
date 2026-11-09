"""Invitation transport is stubbed: no tests send mail or contact Azure."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch
from urllib.parse import urlencode

from backend import email_delivery as mail
from backend.repository import Repository
from backend.workspaces import WorkspaceStore


class EmailDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.repository = Repository(Path(self.directory.name) / 'repository.sqlite3')
        self.config = {}
        self.addCleanup(patch.stopall)
        patch.object(mail.settings, 'value', side_effect=lambda name, default='': self.config.get(name, default)).start()
        self.clock = patch.object(mail.time, 'time', return_value=1800000000).start()
        self.store = WorkspaceStore(self.repository)
        with self.repository._connection(write=True) as connection:
            self.owner = connection.execute('''INSERT INTO accounts(first_name,last_name,email,password_hash,created_at)
                VALUES('Ada','Owner','owner@example.test','!test',1800000000)''').lastrowid
        self.workspace = self.store.create_workspace(self.owner, 'Operations')
        self.invitation = self.invite('recipient@example.test')
        self.provider_id = '8ac9821e-667d-4c33-9005-1ade91f33849'
        self.client = Mock()
        self.client.begin_send.return_value.result.return_value = {'status': 'Succeeded', 'id': self.provider_id}
        self.email_client = Mock()
        self.email_client.from_connection_string.return_value = self.client
        module = types.ModuleType('azure.communication.email')
        module.EmailClient = self.email_client
        patch.dict(sys.modules, {'azure': types.ModuleType('azure'),
                                'azure.communication': types.ModuleType('azure.communication'),
                                'azure.communication.email': module}).start()

    def invite(self, email):
        return self.store.invite(self.owner, self.workspace['workspace_id'], email)

    def enabled(self):
        self.config.update({'GENIE_EMAIL_CONNECTION_STRING': 'endpoint=https://mail.example;accesskey=secret-key',
                            'GENIE_EMAIL_SENDER': 'DoNotReply@verified.example.test',
                            'GENIE_PUBLIC_URL': 'https://genie.example.test'})

    def link(self, invitation=None):
        invitation = invitation or self.invitation
        return 'https://genie.example.test/workspaces?' + urlencode(
            {'invite': invitation['invitation_id'], 'token': invitation['token']})

    def reserve(self, invitation=None, repository=None):
        invitation = invitation or self.invitation
        return mail.reserve_attempt(repository or self.repository, self.owner, invitation['email'], invitation['invitation_id'])

    def test_disabled_email_keeps_manual_fallback_and_never_constructs_client(self):
        self.assertEqual(mail.public_settings(), {'enabled': False, 'provider': None})
        result = mail.send_invitation(self.invitation, 'Ada Owner', self.link())
        self.assertEqual(result['email_status'], 'not_configured')
        self.assertIn('Copy and share', result['email_message'])
        self.email_client.from_connection_string.assert_not_called()
        self.assertNotIn('secret', str(mail.public_settings()))

    def test_partial_or_invalid_configuration_stays_disabled(self):
        self.enabled()
        for key, value in [('GENIE_EMAIL_CONNECTION_STRING', ''), ('GENIE_EMAIL_SENDER', ''),
                           ('GENIE_PUBLIC_URL', 'http://genie.example.test'),
                           ('GENIE_EMAIL_SENDER', 'sender@example.test\r\nBcc: attacker@example.test'),
                           ('GENIE_EMAIL_REPLY_TO', 'reply@example.test,second@example.test')]:
            with self.subTest(key=key, value=value):
                with patch.dict(self.config, {key: value}):
                    self.assertFalse(mail.public_settings()['enabled'])
                    self.assertEqual(mail.send_invitation(self.invitation, 'Ada', self.link())['email_status'], 'not_configured')
        self.email_client.from_connection_string.assert_not_called()

    def test_provider_success_sends_only_to_invited_email_and_has_no_automatic_retries(self):
        self.enabled()
        self.config['GENIE_EMAIL_REPLY_TO'] = 'help@example.test'
        result = mail.send_invitation(self.invitation, 'Ada Owner', self.link())
        self.assertEqual(result['email_status'], 'sent')
        self.assertEqual(result['provider_message_id'], self.provider_id)
        self.assertNotIn('delivered', result['email_message'].lower())
        args, kwargs = self.email_client.from_connection_string.call_args
        self.assertEqual(args, (self.config['GENIE_EMAIL_CONNECTION_STRING'],))
        self.assertEqual(kwargs['retry_total'], 0)
        self.assertFalse(kwargs['logging_enable'])
        message = self.client.begin_send.call_args.args[0]
        self.assertEqual(message['recipients'], {'to': [{'address': self.invitation['email']}]})
        self.assertEqual(message['replyTo'], [{'address': 'help@example.test'}])
        self.assertEqual(message['senderAddress'], self.config['GENIE_EMAIL_SENDER'])
        self.assertIn(self.link(), message['content']['plainText'])
        self.client.begin_send.assert_called_once()
        self.client.begin_send.return_value.result.assert_called_once_with(timeout=20)
        self.client.close.assert_called_once()

    def test_provider_rejection_returns_generic_status_without_diagnostics(self):
        self.enabled()
        self.client.begin_send.return_value.result.return_value = {
            'status': 'Failed', 'error': {'message': self.link() + self.config['GENIE_EMAIL_CONNECTION_STRING']}}
        result = mail.send_invitation(self.invitation, 'Ada', self.link())
        self.assertEqual(result['email_status'], 'failed')
        self.assertEqual(result['error_code'], 'send_failed')
        self.assertNotIn(self.invitation['token'], str(result))
        self.assertNotIn('secret-key', str(result))
        self.assertNotIn(self.invitation['email'], str(result))

    def test_timeout_or_transport_failure_never_replays_or_claims_sent(self):
        self.enabled()
        for error in [TimeoutError('private-token'), RuntimeError('secret-key recipient@example.test')]:
            with self.subTest(error=type(error).__name__):
                self.client.reset_mock()
                self.client.begin_send.return_value.result.side_effect = error
                result = mail.send_invitation(self.invitation, 'Ada', self.link())
                self.assertEqual(result['email_status'], 'failed')
                self.assertEqual(result['error_code'], 'send_unconfirmed')
                self.assertIn('Check with your teammate', result['email_message'])
                self.assertNotIn(str(error), str(result))
                self.client.begin_send.assert_called_once()
                self.client.close.assert_called_once()

    def test_nonterminal_provider_result_is_unconfirmed(self):
        self.enabled()
        self.client.begin_send.return_value.result.return_value = {'status': 'Running'}
        result = mail.send_invitation(self.invitation, 'Ada', self.link())
        self.assertEqual(result['email_status'], 'failed')
        self.assertEqual(result['error_code'], 'send_unconfirmed')

    def test_message_escapes_names_url_and_removes_subject_header_controls(self):
        invitation = {**self.invitation, 'workspace_name': '<script>"Team"</script>\r\nBcc: example',
                      'database': 'Private financial rows', 'password': 'sensitive password'}
        content = mail.invitation_message(invitation, '<img src=x onerror=run()>\nOwner', self.link())
        self.assertNotIn('<script>', content['html'])
        self.assertNotIn('<img src=x', content['html'])
        self.assertIn('&lt;script&gt;', content['html'])
        self.assertIn('&amp;token=', content['html'])
        self.assertNotIn('\r', content['subject'])
        self.assertNotIn('\n', content['subject'])
        self.assertNotIn('Private financial rows', str(content))
        self.assertNotIn('sensitive password', str(content))
        self.assertIn(self.invitation['email'], content['plainText'])
        self.assertIn('UTC', content['plainText'])

    def test_wrong_origin_wrong_invitation_and_recipient_header_injection_never_send(self):
        self.enabled()
        cases = [(self.invitation, self.link().replace('https://genie.example.test', 'https://attacker.example')),
                 ({**self.invitation, 'invitation_id': 'wrong'}, self.link()),
                 ({**self.invitation, 'email': 'person@example.test\r\nBcc:other@example.test'}, self.link()),
                 (self.invitation, 'javascript:alert(1)'),
                 (self.invitation, self.link() + '\r\nInjected')]
        for invitation, link in cases:
            with self.subTest(link=link):
                self.assertEqual(mail.send_invitation(invitation, 'Ada', link)['email_status'], 'failed')
        self.client.begin_send.assert_not_called()

    def test_result_persists_across_repository_instances_without_private_link_or_public_provider_id(self):
        self.reserve()
        self.enabled()
        result = mail.send_invitation(self.invitation, 'Ada', self.link())
        mail.record_result(self.repository, self.invitation['invitation_id'], result)
        reopened = Repository(self.repository.path)
        status = mail.invitation_status(reopened, self.invitation['invitation_id'])
        self.assertEqual(status['email_status'], 'sent')
        self.assertEqual(status['email_attempted_at'], int(self.clock.return_value))
        self.assertNotIn('provider_message_id', status)
        self.assertEqual(mail.workspace_statuses(reopened, self.workspace['workspace_id']),
                         {self.invitation['invitation_id']: status})
        with reopened._connection() as connection:
            saved = connection.execute('SELECT * FROM workspace_invitation_emails').fetchone()
            self.assertEqual(saved['provider_message_id'], self.provider_id)
            database_text = '\n'.join(connection.iterdump())
        self.assertNotIn(self.invitation['token'], database_text)
        self.assertNotIn('secret-key', database_text)
        self.assertNotIn(self.link(), database_text)

    def test_incomplete_attempt_is_reported_as_uncertain_after_restart(self):
        self.reserve()
        status = mail.invitation_status(Repository(self.repository.path), self.invitation['invitation_id'])
        self.assertEqual(status['email_status'], 'failed')
        self.assertIn('could not be confirmed', status['email_message'])

    def test_record_result_does_not_persist_untrusted_messages_or_error_details(self):
        mail.record_result(self.repository, self.invitation['invitation_id'], {
            'email_status': 'failed', 'email_message': self.link(),
            'error_code': self.invitation['token'], 'provider_message_id': self.link()})
        with self.repository._connection() as connection:
            row = connection.execute('SELECT * FROM workspace_invitation_emails').fetchone()
            self.assertIsNone(row['provider_message_id'])
            self.assertIsNone(row['error_code'])
            self.assertIsNone(row['attempted_at'])
        self.assertNotIn(self.invitation['token'], str(mail.invitation_status(self.repository, self.invitation['invitation_id'])))

    def test_recipient_cooldown_is_persisted_and_failed_sends_still_spend_capacity(self):
        self.reserve()
        mail.record_result(self.repository, self.invitation['invitation_id'], {'email_status': 'failed'})
        self.clock.return_value += 59
        with self.assertRaises(mail.EmailRateLimited) as limited:
            self.reserve(repository=Repository(self.repository.path))
        self.assertEqual(limited.exception.retry_after, 1)
        with self.repository._connection() as connection:
            rows = connection.execute('SELECT * FROM workspace_email_rate_limits').fetchall()
            self.assertEqual(len(rows), 3)
            self.assertTrue(all(len(row['bucket_key']) == 64 and row['attempts'] == 1 for row in rows))
            self.assertNotIn(self.invitation['email'], str([dict(row) for row in rows]))
        self.clock.return_value += 1
        self.reserve()

    def test_owner_hourly_budget_and_expiry(self):
        for index in range(20):
            self.reserve(self.invite(f'person{index}@example.test'))
        invitation = self.invite('next@example.test')
        with self.assertRaises(mail.EmailRateLimited) as limited:
            self.reserve(invitation)
        self.assertEqual(limited.exception.retry_after, 3600)
        self.clock.return_value += 3600
        self.reserve(invitation)

    def test_global_daily_budget_blocks_then_resets_at_expiry(self):
        self.config['GENIE_EMAIL_DAILY_LIMIT'] = '2'
        self.reserve(self.invite('first@example.test'))
        self.reserve(self.invite('second@example.test'))
        next_invitation = self.invite('next@example.test')
        with self.assertRaises(mail.EmailRateLimited) as limited:
            self.reserve(next_invitation)
        self.assertEqual(limited.exception.retry_after, 86400)
        self.clock.return_value += 86400
        self.reserve(next_invitation)

    def test_daily_configuration_is_bounded_and_invalid_values_default(self):
        for raw, expected in [('0', 1), ('-500', 1), ('100000', 1000), ('10', 10), ('bad', 100)]:
            with self.subTest(raw=raw):
                self.config['GENIE_EMAIL_DAILY_LIMIT'] = raw
                self.assertEqual(mail._daily_limit(), expected)

    def test_concurrent_attempts_cannot_bypass_recipient_cooldown(self):
        def reserve(_):
            try:
                self.reserve(repository=Repository(self.repository.path))
                return True
            except mail.EmailRateLimited:
                return False
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(reserve, range(2)))
        self.assertEqual(sorted(results), [False, True])
        with self.repository._connection() as connection:
            self.assertEqual([row[0] for row in connection.execute('SELECT attempts FROM workspace_email_rate_limits')], [1, 1, 1])

    def test_expired_revoked_or_wrong_recipient_invites_cannot_reserve_capacity(self):
        with self.assertRaises(ValueError):
            mail.reserve_attempt(self.repository, self.owner, 'someone-else@example.test', self.invitation['invitation_id'])
        self.store.revoke_invitation(self.owner, self.workspace['workspace_id'], self.invitation['invitation_id'])
        with self.assertRaises(ValueError):
            self.reserve()
        expired = self.invite('expired@example.test')
        self.clock.return_value = expired['expires_at']
        with self.assertRaises(ValueError):
            self.reserve(expired)
        with self.repository._connection() as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM workspace_email_rate_limits').fetchone()[0], 0)

    def test_additive_schema_upgrade_preserves_existing_invitation_and_secret_hash(self):
        with self.repository._connection(write=True) as connection:
            connection.execute('DROP TABLE workspace_invitation_emails')
            connection.execute('DROP TABLE workspace_email_rate_limits')
            original_hash = connection.execute('SELECT token_hash FROM workspace_invitations WHERE invitation_id=?',
                                               (self.invitation['invitation_id'],)).fetchone()[0]
        reopened = Repository(self.repository.path)
        self.reserve(repository=reopened)
        with reopened._connection() as connection:
            saved_hash = connection.execute('SELECT token_hash FROM workspace_invitations WHERE invitation_id=?',
                                            (self.invitation['invitation_id'],)).fetchone()[0]
        self.assertEqual(saved_hash, original_hash)


if __name__ == '__main__':
    unittest.main()
