"""Shared isolated account/workspace fixtures, without live service access."""
from pathlib import Path
from backend import authentication, workbench
from backend.reports import ReportStore
from backend.workspaces import WorkspaceStore

class AccountWorkspaceFixture:
    def setUp(self):
        super().setUp()
        self.repository = workbench.get_repository()
        self.accounts = authentication.Accounts(self.repository)
        self.store = WorkspaceStore(self.repository)
        self.reports = ReportStore(self.repository)
        self.owner = self.account['account_id']
        self.member = self.accounts.register('Member', 'Fixture', 'member@example.test', self.password, 'member-fixture')['account_id']
        self.viewer = self.accounts.register('Viewer', 'Fixture', 'viewer@example.test', self.password, 'viewer-fixture')['account_id']
        self.source = Path(self.session['path'])

    def as_user(self, account_id):
        token = self.accounts.issue_login(account_id)
        self.cookie = authentication.COOKIE_NAME + '=' + token
        self.csrf = authentication.csrf_token(token)

    def team(self, owner=None, members=True):
        owner = owner or self.owner
        team = self.store.create_workspace(owner, 'Fixture studio')['workspace_id']
        if owner == self.owner:
            self.store.attach_database(owner, team, self.session['database_id'])
        if members:
            targets = [(self.member, 'member'), (self.viewer, 'viewer')] if owner == self.owner else [(self.owner, 'member')]
            for account_id, role in targets:
                with self.repository._connection() as connection:
                    email = connection.execute('SELECT email FROM accounts WHERE account_id=?', (account_id,)).fetchone()[0]
                invite = self.store.invite(owner, team, email, role)
                self.store.accept_invitation(account_id, invite['invitation_id'], invite['token'])
        return team

    def report(self, team, author=None, published=True):
        return self.reports.save_report(author or self.owner, team, {'title': 'Fixture findings', 'body': 'Reviewed fixture snapshot.', 'published': published})['report_id']

    def remove(self, **changes):
        return self.request('POST', '/api/auth/delete', {'email': 'ada@example.com', 'confirmation': 'DELETE', 'password': self.password, **changes})

    def check_integrity(self):
        with self.repository._connection() as connection:
            self.assertEqual(connection.execute('PRAGMA foreign_key_check').fetchall(), [])
