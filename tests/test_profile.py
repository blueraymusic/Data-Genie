"""Account-owned profile changes through authenticated HTTP routes."""
import base64
import unittest

from tests.test_http import HttpHarness

PHOTO = 'data:image/jpeg;base64,' + (
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDmqKKK904j/9k='
)


class ProfileTests(HttpHarness, unittest.TestCase):
    def profile(self, **changes):
        return self.request('POST', '/api/auth/profile', {
            'first_name': ' Ada ', 'last_name': 'Byron', **changes,
        })

    def test_updates_own_profile_and_keeps_email_login_and_session_identity(self):
        status, result = self.profile(profile_photo=PHOTO, account_id=999, email='different@example.com')
        self.assertEqual(status, 200)
        self.assertEqual(result['user']['account_id'], self.account['account_id'])
        self.assertEqual(result['user']['first_name'], 'Ada')
        self.assertEqual(result['user']['email'], 'ada@example.com')
        self.assertEqual(result['user']['profile_photo'], PHOTO)
        self.assertIsInstance(result['user']['created_at'], int)
        self.assertEqual(result['user']['created_at'], self.account['created_at'])
        _, status = self.request('GET', '/api/status', session_id=self.session_id)
        self.assertEqual(status['last_name'], 'Byron')
        _, result = self.request('POST', '/api/auth/login', {'email': 'ada@example.com', 'password': self.password})
        self.assertEqual(result['user']['profile_photo'], PHOTO)
        self.assertEqual(result['user']['last_name'], 'Byron')

    def test_preserves_photo_when_omitted_and_removes_it_explicitly(self):
        self.profile(profile_photo=PHOTO)
        self.assertEqual(self.profile()[1]['user']['profile_photo'], PHOTO)
        self.assertIsNone(self.profile(profile_photo=None)[1]['user']['profile_photo'])
        self.assertIsNone(self.request('GET', '/api/auth/session')[1]['user']['profile_photo'])

    def test_requires_login_and_csrf(self):
        body = {'first_name': 'Other', 'last_name': 'Name'}
        self.assertEqual(self.request('POST', '/api/auth/profile', body, extra_headers={'X-CSRF-Token': ''})[0], 403)
        self.assertEqual(self.request('POST', '/api/auth/profile', body, extra_headers={'Cookie': ''})[0], 401)
        self.assertEqual(self.request('GET', '/api/auth/session')[1]['user']['last_name'], 'Lovelace')

    def test_rejects_invalid_names_and_active_remote_or_oversized_images_atomically(self):
        for value in ['', 'x' * 101, 'name\ninside', {'name': 'wrong type'}]:
            with self.subTest(name=value):
                self.assertEqual(self.profile(first_name=value)[0], 400)
        for photo in ['https://example.com/avatar.jpg', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,broken!', 'data:image/jpeg;base64,' + 'A' * 140000, False]:
            with self.subTest(photo=str(photo)[:40]):
                self.assertEqual(self.profile(profile_photo=photo)[0], 400)
        self.assertEqual(self.request('GET', '/api/auth/session')[1]['user']['last_name'], 'Lovelace')

    def test_rejects_large_jpeg_dimensions_even_with_a_small_file(self):
        image = bytearray(base64.b64decode(PHOTO.split(',')[1]))
        frame = image.index(b'\xff\xc0')
        image[frame + 7:frame + 9] = (10000).to_bytes(2, 'big')
        self.assertEqual(self.profile(profile_photo='data:image/jpeg;base64,' + base64.b64encode(image).decode())[0], 400)
