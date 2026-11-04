"""Stable external identities, explicit linking, and local credential isolation."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sqlite3
import tempfile
import unittest

from backend.authentication import (Accounts, LoginRequired, MicrosoftAccountError,
                                    TooManyAttempts, password_matches)
from backend.repository import Repository


class MicrosoftAccountTests(unittest.TestCase):
    password = "a long local-only passphrase 72"

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="genie-microsoft-accounts-")
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "repository.sqlite3"
        self.repository = Repository(self.path)
        self.accounts = Accounts(self.repository)
        self.identity = {"issuer": "https://login.microsoftonline.com/tenant-one/v2.0",
                         "subject": "stable-subject-one", "email": "reader@example.test",
                         "first_name": "Ada", "last_name": "Reader"}

    def local(self, email="local@example.test"):
        return self.accounts.register("Local", "Reader", email, self.password, client="seed")

    def assert_code(self, code, method, *args, **kwargs):
        with self.assertRaises(MicrosoftAccountError) as caught:
            method(*args, **kwargs)
        self.assertEqual(caught.exception.code, code)

    def test_first_and_repeated_identity_reuse_the_app_account_and_login(self):
        first = self.accounts.microsoft_login(self.identity)
        self.assertFalse(first["password_enabled"])
        self.assertTrue(first["microsoft_linked"])
        # Mutable claims do not move an existing identity to another account or
        # update an email into a collision with another local account.
        other = self.local("other@example.test")
        changed = {**self.identity, "email": other["email"], "first_name": "Changed"}
        self.assertEqual(self.accounts.microsoft_login(changed), first)
        self.assertEqual(self.accounts.microsoft_login({"issuer": self.identity["issuer"],
                                                       "subject": self.identity["subject"]}), first)
        token = self.accounts.issue_login(first["account_id"])
        self.assertEqual(self.accounts.authenticate(token), first)
        self.accounts.logout(token)
        with self.assertRaises(LoginRequired):
            self.accounts.authenticate(token)

    def test_email_collision_cannot_claim_local_or_external_account(self):
        local = self.local("reader@example.test")
        self.assert_code("account_exists", self.accounts.microsoft_login, self.identity)
        self.assertEqual(self.accounts.login(local["email"], self.password), local)
        with self.repository._connection() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM accounts").fetchone()[0], 1)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM external_identities").fetchone()[0], 0)
        self.accounts.microsoft_login({**self.identity, "email": "second@example.test"})
        self.assert_code("account_exists", self.accounts.microsoft_login,
                         {**self.identity, "subject": "different-subject", "email": "second@example.test"})

    def test_issuer_and_subject_are_both_part_of_identity(self):
        first = self.accounts.microsoft_login(self.identity, client="first")
        second = self.accounts.microsoft_login({**self.identity,
                                               "issuer": "https://login.microsoftonline.com/tenant-two/v2.0",
                                               "email": "second@example.test"}, client="second")
        third = self.accounts.microsoft_login({**self.identity, "subject": "subject-two",
                                              "email": "third@example.test"}, client="third")
        self.assertEqual(len({first["account_id"], second["account_id"], third["account_id"]}), 3)

    def test_explicit_link_keeps_local_credentials_and_allows_other_profile_email(self):
        user = self.local()
        self.assertTrue(user["password_enabled"])
        self.assertFalse(user["microsoft_linked"])
        self.assertEqual(self.accounts.verify_password(user["account_id"], self.password), user)
        linked = self.accounts.link_microsoft(user["account_id"], self.identity)
        self.assertTrue(linked["password_enabled"])
        self.assertTrue(linked["microsoft_linked"])
        self.assertEqual(linked["email"], user["email"])
        self.assertEqual(self.accounts.login(user["email"], self.password), linked)
        self.assertEqual(self.accounts.microsoft_login(self.identity), linked)
        self.assertEqual(self.accounts.link_microsoft(user["account_id"], self.identity), linked)

    def test_link_cannot_take_another_identity_or_replace_existing_link(self):
        first = self.local()
        second = self.local("second@example.test")
        self.accounts.link_microsoft(first["account_id"], self.identity)
        self.assert_code("identity_in_use", self.accounts.link_microsoft, second["account_id"], self.identity)
        self.assert_code("already_linked", self.accounts.link_microsoft, first["account_id"],
                         {**self.identity, "subject": "subject-two"})
        with self.assertRaises(LoginRequired):
            self.accounts.link_microsoft(99999, self.identity)

    def test_external_only_account_never_accepts_local_password_or_sets_one(self):
        user = self.accounts.microsoft_login(self.identity)
        for password in ("", "dummy password used for timing only", self.password):
            with self.assertRaises(LoginRequired):
                self.accounts.login(user["email"], password)
            with self.assertRaises(ValueError):
                self.accounts.change_password(user["account_id"], password, self.password)
        with self.assertRaises(ValueError):
            self.accounts.verify_password(user["account_id"], "dummy password used for timing only", client="verify")
        for absent in (None, "", "!microsoft", 0, False):
            self.assertFalse(password_matches("dummy password used for timing only", absent))

    def test_new_accounts_require_email_but_one_name_or_missing_names_are_supported(self):
        for index, identity in enumerate(({**self.identity, "email": ""},
                                          {**self.identity, "email": "not-email"},
                                          {**self.identity, "email": None})):
            self.assert_code("profile_required", self.accounts.microsoft_login, identity, client=f"bad-{index}")
        one = self.accounts.microsoft_login({**self.identity, "last_name": ""}, client="one")
        self.assertEqual(one["first_name"], "Ada")
        self.assertEqual(one["last_name"], "")
        none = self.accounts.microsoft_login({**self.identity, "subject": "two", "email": "two@example.test",
                                             "first_name": None, "last_name": None}, client="none")
        self.assertTrue(none["first_name"])

    def test_invalid_identity_is_rejected_before_any_account_is_created(self):
        for identity in (None, {}, {**self.identity, "subject": ""},
                         {**self.identity, "issuer": "http://example.test"},
                         {**self.identity, "subject": "contains whitespace"}):
            self.assert_code("invalid_identity", self.accounts.microsoft_login, identity)
        with self.repository._connection() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM accounts").fetchone()[0], 0)

    def test_first_time_sso_accounts_share_registration_budget_but_known_signin_does_not(self):
        users = [self.accounts.microsoft_login({**self.identity, "subject": f"subject-{index}",
                                               "email": f"reader-{index}@example.test"}, client="same-ip")
                 for index in range(5)]
        with self.assertRaises(TooManyAttempts):
            self.accounts.microsoft_login({**self.identity, "subject": "sixth", "email": "sixth@example.test"},
                                          client="same-ip")
        known = {**self.identity, "subject": "subject-0"}
        self.assertEqual(self.accounts.microsoft_login(known, client="same-ip"), users[0])
        self.accounts.microsoft_login({**self.identity, "subject": "sixth", "email": "sixth@example.test"},
                                      client="another-ip")

    def test_password_reauthentication_has_existing_login_attempt_limits(self):
        user = self.local()
        for _ in range(5):
            with self.assertRaises(ValueError):
                self.accounts.verify_password(user["account_id"], "wrong", client="same-ip")
        with self.assertRaises(TooManyAttempts):
            self.accounts.verify_password(user["account_id"], self.password, client="same-ip")
        self.accounts.verify_password(user["account_id"], self.password, client="another-ip")

    def test_schema_upgrade_is_additive_and_mapping_survives_new_repository_instance(self):
        local = self.local()
        with sqlite3.connect(self.path) as connection:
            connection.executescript("DROP TABLE external_identities; DROP TABLE microsoft_auth_flows;")
        reopened = Accounts(Repository(self.path))
        self.assertEqual(reopened.login(local["email"], self.password), local)
        linked = reopened.link_microsoft(local["account_id"], self.identity)
        restored = Accounts(Repository(self.path))
        self.assertEqual(restored.microsoft_login(self.identity), linked)

    def test_single_name_accounts_can_create_owned_sessions_without_claiming_another_history(self):
        first = self.accounts.microsoft_login({**self.identity, "last_name": ""}, client="first")
        second = self.accounts.microsoft_login({**self.identity, "subject": "second", "email": "second@example.test"},
                                              client="second")
        source = self.path.parent / "source.sqlite3"
        with sqlite3.connect(source) as connection:
            connection.execute("CREATE TABLE notes(id INTEGER PRIMARY KEY)")
        session = self.repository.start_session(first["first_name"], first["last_name"], first["email"], source,
                                                "source.sqlite3", account_id=first["account_id"])
        self.assertEqual(session["account_id"], first["account_id"])
        self.assertEqual(session["last_name"], "")
        self.assertEqual(len(self.repository.list_sessions(account_id=first["account_id"])), 1)
        self.assertEqual(self.repository.list_sessions(account_id=second["account_id"]), [])

    def test_concurrent_callbacks_converge_on_one_account(self):
        # Start initialization before independent instances race on writes.
        self.repository._initialize()
        with ThreadPoolExecutor(max_workers=2) as pool:
            users = list(pool.map(lambda _: Accounts(Repository(self.path)).microsoft_login(self.identity), range(2)))
        self.assertEqual(users[0], users[1])
        with self.repository._connection() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM accounts").fetchone()[0], 1)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM external_identities").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
