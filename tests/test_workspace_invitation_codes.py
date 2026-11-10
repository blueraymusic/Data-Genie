"""Readable invitation codes keep matching-account and secret-hash boundaries."""

import hashlib
from pathlib import Path
import secrets
import tempfile
import unittest

from backend.repository import Repository
from backend.workspaces import WorkspaceStore


class WorkspaceInvitationCodeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.repository = Repository(Path(self.directory.name) / 'repository.sqlite3')
        self.store = WorkspaceStore(self.repository)
        with self.repository._connection(write=True) as connection:
            self.owner = connection.execute('''INSERT INTO accounts(first_name,last_name,email,password_hash,created_at)
                VALUES('Owner','Fixture','owner@example.test','!test',1)''').lastrowid
            self.member = connection.execute('''INSERT INTO accounts(first_name,last_name,email,password_hash,created_at)
                VALUES('Member','Fixture','member@example.test','!test',1)''').lastrowid
            self.outsider = connection.execute('''INSERT INTO accounts(first_name,last_name,email,password_hash,created_at)
                VALUES('Other','Fixture','other@example.test','!test',1)''').lastrowid
        self.workspace_id = self.store.create_workspace(self.owner, 'Invitation test')['workspace_id']

    def invitation(self):
        return self.store.invite(self.owner, self.workspace_id, 'member@example.test')

    def test_new_code_is_five_groups_of_four_uppercase_hex_characters_and_only_hash_is_saved(self):
        invitation = self.invitation()
        self.assertRegex(invitation['token'], r'^(?:[0-9A-F]{4}-){4}[0-9A-F]{4}$')
        with self.repository._connection() as connection:
            row = connection.execute('SELECT token_hash FROM workspace_invitations WHERE invitation_id=?',
                                     (invitation['invitation_id'],)).fetchone()
            self.assertEqual(row[0], hashlib.sha256(invitation['token'].encode()).hexdigest())
            self.assertNotIn(invitation['token'], '\n'.join(connection.iterdump()))
        self.assertNotIn('token', self.store.list_workspaces(self.member)['invitations'][0])

    def test_lowercase_grouped_code_is_accepted(self):
        invitation = self.invitation()
        result = self.store.accept_invitation(self.member, invitation['invitation_id'], invitation['token'].lower())
        self.assertEqual(result['workspace_id'], self.workspace_id)

    def test_unhyphenated_code_with_outer_whitespace_is_accepted(self):
        invitation = self.invitation()
        result = self.store.accept_invitation(self.member, invitation['invitation_id'],
                                              ' \n' + invitation['token'].replace('-', '').lower() + '\n ')
        self.assertEqual(result['workspace_id'], self.workspace_id)

    def test_existing_url_safe_invitation_secret_still_works_without_normalization(self):
        invitation = self.invitation()
        legacy = secrets.token_urlsafe(32)
        with self.repository._connection(write=True) as connection:
            connection.execute('UPDATE workspace_invitations SET token_hash=? WHERE invitation_id=?',
                               (hashlib.sha256(legacy.encode()).hexdigest(), invitation['invitation_id']))
        result = self.store.accept_invitation(self.member, invitation['invitation_id'], legacy)
        self.assertEqual(result['workspace_id'], self.workspace_id)

    def test_normalized_code_still_requires_matching_account_and_exact_secret(self):
        invitation = self.invitation()
        for account_id, token in [(self.outsider, invitation['token'].lower()),
                                  (self.member, invitation['token'].replace('-', ' ')),
                                  (self.member, invitation['token'][:-1]),
                                  (self.member, invitation['token'] + 'A'),
                                  (self.member, '0000-0000-0000-0000-0000')]:
            with self.subTest(account_id=account_id, token=token), self.assertRaises(PermissionError):
                self.store.accept_invitation(account_id, invitation['invitation_id'], token)
        result = self.store.accept_invitation(self.member, invitation['invitation_id'], invitation['token'])
        self.assertEqual(result['workspace_id'], self.workspace_id)
        with self.assertRaises(PermissionError):
            self.store.accept_invitation(self.member, invitation['invitation_id'], invitation['token'])


if __name__ == '__main__':
    unittest.main()
