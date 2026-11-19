"""Concurrent live drafts merge without changing the reviewed report snapshot."""
import random
import unittest

from backend import report_collaboration as collaboration, workbench
from tests.test_http import HttpHarness
from tests import test_reports as fixture


class TextOperationTests(unittest.TestCase):
    def test_concurrent_insert_replace_and_delete_operations_converge_with_unicode(self):
        rng = random.Random(932)
        for _ in range(500):
            text = ''.join(rng.choice('abc😀é') for _ in range(rng.randrange(15)))
            operations = []
            for side in range(2):
                start = rng.randrange(len(text) + 1)
                end = rng.randrange(start, len(text) + 1)
                inserted = ''.join(rng.choice('XYZ💡') for _ in range(rng.randrange(5)))
                operation = []
                for part in (start, -(end - start), inserted, len(text) - end):
                    collaboration.append(operation, part)
                operations.append(operation)
            left, right = operations
            after_left, after_right = collaboration.transform(left, right, True)
            self.assertEqual(collaboration.apply(collaboration.apply(text, left), after_right),
                             collaboration.apply(collaboration.apply(text, right), after_left))


class ReportCollaborationHttpTests(HttpHarness, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.clients = {'owner': (self.cookie, self.csrf, self.account)}
        for name in ('member', 'viewer', 'outsider'):
            self.cookie = self.csrf = ''
            status, response = self.request('POST', '/api/auth/register', {
                'first_name': name, 'last_name': 'Fixture', 'email': name + '@example.test', 'password': self.password})
            self.assertEqual(status, 201)
            self.clients[name] = (self.cookie, self.csrf, response['user'])
        self.as_user('owner')
        _, self.workspace = self.request('POST', '/api/workspaces', {'name': 'Live report team'})
        self.workspace_id = self.workspace['workspace_id']
        self.database_id = self.session['database_id']
        self.request('POST', self.route('attach'), {'database_id': self.database_id})
    as_user = fixture.ReportHttpTests.as_user
    route = fixture.ReportHttpTests.route
    invite = fixture.ReportHttpTests.invite
    accept = fixture.ReportHttpTests.accept
    join = fixture.ReportHttpTests.join
    forbidden = fixture.ReportHttpTests.forbidden
    create_report = fixture.ReportHttpTests.create_report

    def live_draft(self):
        self.join('member')
        self.as_user('member')
        report = self.create_report(body='ab😀cd')
        path = self.route('reports') + '/' + report['report_id'] + '/live'
        status, initial = self.request('GET', path + '?after=0&client_id=member-tab')
        self.assertEqual(status, 200, initial)
        return report, path

    def edit(self, path, operation_id, operation, base=0, field='body', client='member-tab'):
        return self.request('POST', path, {'client_id': client, 'operation_id': operation_id,
            'field': field, 'base_revision': base, 'operation': operation})

    def test_concurrent_typing_merges_idempotently_and_remains_a_working_draft(self):
        report, path = self.live_draft()
        self.assertEqual(self.edit(path, 'member-op', [1, 'M', 4])[0], 200)
        self.as_user('owner')
        initial = self.request('GET', path + '?after=0&client_id=owner-tab')[1]
        self.assertEqual(initial['collaborators'][0]['first_name'], 'member')
        status, result = self.edit(path, 'owner-op', [1, 'O', 4], client='owner-tab')
        self.assertEqual(status, 200, result)
        self.assertEqual(result['document']['body'], 'aMOb😀cd')
        self.assertEqual(result['document']['revision'], 2)
        self.assertEqual(self.edit(path, 'owner-op', [1, 'O', 4], client='owner-tab')[1]['document']['body'], 'aMOb😀cd')
        status, result = self.edit(path, 'delete-op', [2, -1, 2], client='owner-tab')
        self.assertEqual(status, 200, result)
        self.assertEqual(result['document']['body'], 'aMObcd')
        snapshot = self.request('GET', self.route('reports'))[1]['reports'][0]
        self.assertEqual(snapshot['body'], report['body'])
        self.assertEqual(snapshot['version'], 1)
        changes = self.request('GET', path + '?after=2&client_id=owner-tab')[1]
        self.assertEqual([row['revision'] for row in changes['operations']], [3])

    def test_saving_requires_the_exact_live_revision_and_publication_ends_author_editing(self):
        report, path = self.live_draft()
        self.edit(path, 'member-op', [1, 'M', 4])
        self.as_user('owner')
        for payload in (report, {**report, 'collaboration_revision': 0}, {**report, 'collaboration_revision': 1}):
            self.assertEqual(self.request('POST', self.route('reports'), payload)[0], 400)
        live = self.request('GET', path + '?after=0&client_id=owner-tab')[1]['document']
        payload = {**report, 'title': live['title'], 'body': live['body'], 'version': live['base_version'],
                   'collaboration_revision': live['revision'], 'published': True}
        self.assertEqual(self.request('POST', self.route('reports'), payload)[0], 200)
        self.assertEqual(self.request('GET', self.route('reports'))[1]['reports'][0]['body'], 'aMb😀cd')
        self.as_user('member')
        self.forbidden('GET', path + '?after=1&client_id=member-tab')
        self.assertEqual(self.edit(path, 'late-op', [6, '!'], 1)[0], 403)

    def test_viewers_outsiders_and_removed_members_cannot_read_or_modify_live_drafts(self):
        report, path = self.live_draft()
        self.as_user('outsider')
        self.forbidden('GET', path + '?after=0&client_id=outsider')
        self.assertEqual(self.edit(path, 'outsider-op', ['bad', 5])[0], 403)
        self.as_user('owner')
        self.request('POST', self.route('remove'), {'account_id': self.clients['member'][2]['account_id']})
        self.as_user('member')
        self.forbidden('GET', path + '?after=0&client_id=member-tab')
        self.assertEqual(self.edit(path, 'removed-op', ['bad', 5])[0], 403)

    def test_operation_history_is_bounded_and_old_pending_edits_are_rejected(self):
        report, path = self.live_draft()
        repository = workbench.get_repository()
        with repository._connection(write=True) as connection:
            for revision in range(1, 41):
                collaboration.record(connection, report['report_id'], revision, 'large-' + str(revision), 'body', ['é' * 20000, -20000], 20000)
            connection.execute('UPDATE report_collaboration SET revision=40 WHERE report_id=?', (report['report_id'],))
            rows = connection.execute('SELECT revision,operation_json FROM report_edit_operations WHERE report_id=? ORDER BY revision', (report['report_id'],)).fetchall()
            self.assertLessEqual(sum(len(row['operation_json'].encode('utf-8')) for row in rows), 1048576)
            self.assertGreater(rows[0]['revision'], 1)
        status, result = self.edit(path, 'stale-op', [5])
        self.assertEqual(status, 400, result)
        self.assertIn('copy it before reopening', result['error'])
        self.assertTrue(self.request('GET', path + '?after=0&client_id=member-tab')[1]['reset'])

    def test_move_preserves_live_working_text_and_advances_the_saved_version(self):
        report, path = self.live_draft()
        self.edit(path, 'working-op', [5, ' draft'])
        self.as_user('owner')
        personal = next(row for row in self.request('GET', '/api/workspaces')[1]['workspaces'] if row['personal'])
        status, result = self.request('POST', self.route('reports') + '/' + report['report_id'] + '/move',
            {'workspace_id': personal['workspace_id'], 'version': report['version']})
        self.assertEqual(status, 200, result)
        destination = '/api/workspaces/' + personal['workspace_id'] + '/reports'
        live = self.request('GET', destination + '/' + report['report_id'] + '/live?after=0&client_id=owner')[1]['document']
        self.assertEqual(live['body'], 'ab😀cd draft')
        self.assertEqual(live['base_version'], 2)
        status, result = self.request('POST', destination, {**report, 'body': live['body'],
            'version': live['base_version'], 'collaboration_revision': live['revision']})
        self.assertEqual(status, 200, result)

    def test_sharing_the_reviewed_snapshot_does_not_overwrite_live_working_text(self):
        report, path = self.live_draft()
        self.edit(path, 'working-op', [5, ' draft'])
        self.as_user('owner')
        self.assertEqual(self.request('POST', self.route('reports'), {**report, 'published': True})[0], 200)
        saved = self.request('GET', self.route('reports'))[1]['reports'][0]
        self.assertEqual(saved['body'], 'ab😀cd')
        live = self.request('GET', path + '?after=0&client_id=owner')[1]['document']
        self.assertEqual(live['body'], 'ab😀cd draft')
        self.assertEqual(live['base_version'], 2)
        self.assertTrue(live['published'])
        self.assertEqual(self.request('POST', self.route('reports'), {**saved, 'published': False})[0], 200)
        self.assertEqual(self.request('GET', path + '?after=0&client_id=owner')[1]['document']['body'], live['body'])
