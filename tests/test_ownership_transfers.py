"""A pending request never grants ownership; only its recipient can accept."""
import unittest
from backend import workbench
from tests.test_http import HttpHarness
from tests.fixtures_accounts import AccountWorkspaceFixture


class OwnershipTransferTests(AccountWorkspaceFixture, HttpHarness, unittest.TestCase):
    def send(self, team, **changes):
        return self.request('POST', '/api/workspaces/' + team + '/ownership-transfer', {
            'recipient_account_id': self.member, 'name': 'Fixture studio', 'password': self.password, **changes,
        })

    def review(self, transfer):
        return self.request('GET', '/api/ownership-transfers/' + transfer['transfer_id'])

    def decide(self, transfer, action, **changes):
        return self.request('POST', '/api/ownership-transfers/' + transfer['transfer_id'] + '/' + action, changes)

    def test_request_is_in_recipient_inbox_without_changing_owner_then_accepts(self):
        team = self.team()
        status, transfer = self.send(team)
        self.assertEqual(status, 200)
        self.assertEqual(self.store.get_workspace(self.owner, team)['workspace']['role'], 'owner')
        self.assertEqual(self.request('GET', '/api/workspaces')[1]['ownership_transfers'], [])
        self.as_user(self.member)
        inbox = self.request('GET', '/api/workspaces')[1]['ownership_transfers']
        self.assertEqual(inbox[0]['transfer_id'], transfer['transfer_id'])
        status, review = self.review(transfer)
        self.assertEqual(status, 200)
        self.assertEqual(review['databases'], 1)
        self.assertEqual(self.decide(transfer, 'accept', password='wrong', review_version=review['review_version'])[0], 400)
        status, accepted = self.decide(transfer, 'accept', password=self.password, review_version=review['review_version'])
        self.assertEqual((status, accepted['status']), (200, 'accepted'))
        self.assertEqual(self.store.get_workspace(self.member, team)['workspace']['role'], 'owner')
        self.assertEqual(self.store.get_workspace(self.owner, team)['workspace']['role'], 'member')
        self.assertTrue(self.source.is_file())
        self.assertEqual(self.request('GET', '/api/workspaces')[1]['ownership_transfers'], [])
        self.assertEqual(self.decide(transfer, 'accept', password=self.password, review_version=review['review_version'])[0], 400)
        self.check_integrity()

    def test_decline_and_cancel_leave_ownership_unchanged(self):
        team = self.team()
        _, transfer = self.send(team)
        self.as_user(self.member)
        self.assertEqual(self.decide(transfer, 'decline')[1]['status'], 'declined')
        self.assertEqual(self.store.get_workspace(self.owner, team)['workspace']['role'], 'owner')
        self.as_user(self.owner)
        _, transfer = self.send(team)
        self.assertEqual(self.decide(transfer, 'cancel')[1]['status'], 'cancelled')
        self.assertEqual(self.store.get_workspace(self.owner, team)['workspace']['role'], 'owner')
        self.as_user(self.member)
        self.assertEqual(self.decide(transfer, 'accept', password=self.password)[0], 400)

    def test_non_owner_non_recipient_self_and_non_member_are_rejected(self):
        team = self.team()
        self.assertEqual(self.send(team, recipient_account_id=self.owner)[0], 400)
        outsider = self.accounts.register('Outside', 'Fixture', 'outside@example.test', self.password, 'outside-fixture')['account_id']
        self.assertEqual(self.send(team, recipient_account_id=outsider)[0], 403)
        _, transfer = self.send(team)
        self.assertEqual(self.decide(transfer, 'accept', password=self.password)[0], 403)
        self.as_user(self.viewer)
        self.assertEqual(self.review(transfer)[0], 403)
        self.assertEqual(self.decide(transfer, 'decline')[0], 403)
        self.assertEqual(self.send(team)[0], 403)
        self.check_integrity()

    def test_inventory_change_requires_a_fresh_review(self):
        team = self.team()
        _, transfer = self.send(team)
        self.as_user(self.member)
        _, review = self.review(transfer)
        with self.repository._connection(write=True) as connection:
            connection.execute("UPDATE workspace_members SET role='viewer' WHERE workspace_id=? AND account_id=?", (team, self.viewer))
            connection.execute('UPDATE workspace_members SET joined_at=joined_at+1 WHERE workspace_id=?', (team,))
        # A newly added PostgreSQL connection changes the proposed ownership scope.
        remote = self.repository.create_external_session(self.owner, 'Extra fixture', 'fixture-credentials')
        self.store.attach_database(self.owner, team, remote['database_id'])
        status, result = self.decide(transfer, 'accept', password=self.password, review_version=review['review_version'])
        self.assertEqual(status, 400)
        self.assertIn('changed', result['error'])
        _, review = self.review(transfer)
        self.assertEqual(review['postgres_connections'], 1)
        self.assertEqual(self.decide(transfer, 'accept', password=self.password, review_version=review['review_version'])[0], 200)
        with self.repository._connection() as connection:
            self.assertEqual(connection.execute('SELECT account_id FROM external_connections').fetchone()[0], self.member)
        self.check_integrity()

    def test_expiry_removal_and_duplicate_requests_are_handled(self):
        team = self.team()
        _, transfer = self.send(team)
        self.assertEqual(self.send(team)[0], 400)
        with self.repository._connection(write=True) as connection:
            connection.execute('UPDATE ownership_transfers SET expires_at=0 WHERE transfer_id=?', (transfer['transfer_id'],))
        self.as_user(self.member)
        self.assertEqual(self.review(transfer)[1]['status'], 'expired')
        self.assertEqual(self.decide(transfer, 'accept', password=self.password)[0], 400)
        self.as_user(self.owner)
        _, transfer = self.send(team)
        self.store.remove_member(self.owner, team, self.member)
        self.as_user(self.member)
        self.assertEqual(self.review(transfer)[1]['status'], 'cancelled')
        self.assertEqual(self.request('GET', '/api/workspaces')[1]['ownership_transfers'], [])
        self.assertEqual(self.decide(transfer, 'accept', password=self.password)[0], 400)

    def test_csrf_and_account_deletion_do_not_bypass_acceptance(self):
        team = self.team()
        self.assertEqual(self.request('POST', '/api/workspaces/' + team + '/ownership-transfer', {}, extra_headers={'X-CSRF-Token': ''})[0], 403)
        _, transfer = self.send(team)
        self.assertEqual(self.request('POST', '/api/auth/delete', {'email': 'ada@example.com', 'confirmation': 'DELETE', 'password': self.password, 'transfers': {team: self.member}})[0], 400)
        self.assertEqual(self.request('POST', '/api/auth/delete', {'email': 'ada@example.com', 'confirmation': 'DELETE', 'password': self.password})[0], 200)
        self.as_user(self.member)
        self.assertEqual(self.review(transfer)[0], 403)
        self.check_integrity()
