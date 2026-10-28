"""Connection validation and credential storage do not require a live database."""

from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from decimal import Decimal
from datetime import date

from connections import CredentialVault, PostgresConnector, connection_config
from connections.postgres import _value


class ConnectionConfigTests(unittest.TestCase):
    def test_postgres_values_preserve_precision_and_serialize_dates(self):
        value = _value({"id": 9007199254740993, "amount": Decimal("1234567890.12345678"), "date": date(2026, 10, 27), "tags": ["sample", True]})
        self.assertEqual(value, {"id":"9007199254740993", "amount":"1234567890.12345678", "date":"2026-10-27", "tags":["sample",True]})
        self.assertIn('9007199254740993', json.dumps(value))

    def test_url_is_parsed_into_explicit_parameters(self):
        config = connection_config({"connection_url": "postgresql://reader:p%40ss@db.example.test:6543/shop?sslmode=require"})
        self.assertEqual(config["password"], "p@ss")
        self.assertEqual(config["port"], 6543)
        self.assertEqual(config["schema_name"], "public")
        self.assertTrue(config["read_only"])
        self.assertEqual(config["name"], "shop")

    def test_remote_ssl_and_connection_options_are_constrained(self):
        for url in ("postgresql://u:p@remote.example.test/shop?sslmode=disable", "postgresql://u:p@localhost/shop?passfile=/private/file", "postgresql://u:p@localhost/shop?options=unsafe", "sqlite:///tmp/test", "postgresql://u@localhost/shop", "postgresql://u:p@localhost:0/shop"):
            with self.subTest(url=url), self.assertRaises(ValueError) as caught:
                connection_config({"connection_url": url})
            self.assertNotIn(url, str(caught.exception))

    def test_changes_require_explicit_boolean_opt_in(self):
        source = {"connection_url": "postgresql://u:p@localhost/shop", "allow_changes": "true"}
        self.assertTrue(connection_config(source)["read_only"])
        self.assertFalse(connection_config({**source, "allow_changes": True})["read_only"])

    def test_hosted_connection_channel_binding_and_system_certificates_are_preserved(self):
        source = {"connection_url":"postgresql://user:fixture-password@db.example.test/shop?sslmode=require&channel_binding=require"}
        config = connection_config(source)
        self.assertEqual(config["channel_binding"],"require")
        self.assertEqual(config["sslmode"],"require")
        verified = connection_config({"connection_url":source["connection_url"]+"&sslrootcert=system"})
        self.assertEqual(verified["sslmode"],"verify-full")
        with self.assertRaises(ValueError):
            connection_config({"connection_url":source["connection_url"]+"&sslrootcert=/private/certificate"})


@unittest.skipUnless(importlib.util.find_spec("cryptography"), "Optional PostgreSQL dependencies are not installed")
class CredentialVaultTests(unittest.TestCase):
    def test_saved_config_is_encrypted_with_an_owner_only_separate_key(self):
        with tempfile.TemporaryDirectory() as directory:
            vault = CredentialVault(Path(directory) / "repository.sqlite3")
            config = {"password": "private-test-password", "host": "db.example.test"}
            encrypted = vault.encrypt(config)
            self.assertNotIn(config["password"], encrypted)
            self.assertEqual(CredentialVault(Path(directory) / "repository.sqlite3").decrypt(encrypted), config)
            self.assertEqual(vault.key_path.stat().st_mode & 0o777, 0o600)

    def test_concurrent_first_connections_share_one_key(self):
        with tempfile.TemporaryDirectory() as directory:
            vault = CredentialVault(Path(directory) / "repository.sqlite3")
            with ThreadPoolExecutor(max_workers=8) as pool:
                encrypted = list(pool.map(lambda index: vault.encrypt({"index": index}), range(20)))
            self.assertEqual([vault.decrypt(value)["index"] for value in encrypted], list(range(20)))

    def test_a_missing_key_is_not_replaced_when_reopening_a_connection(self):
        with tempfile.TemporaryDirectory() as directory:
            vault = CredentialVault(Path(directory) / "repository.sqlite3")
            encrypted = vault.encrypt({"password":"private test value"})
            vault.key_path.unlink()
            with self.assertRaises(ValueError):
                vault.decrypt(encrypted)
            self.assertFalse(vault.key_path.exists())


@unittest.skipUnless(importlib.util.find_spec("sqlglot"), "Optional PostgreSQL dependencies are not installed")
class PostgresSqlTests(unittest.TestCase):
    def setUp(self):
        self.adapter = PostgresConnector(connection_config({"connection_url": "postgresql://u:p@localhost/shop"}))
        self.adapter._schema = [{"name": "customers"}, {"name": "orders"}]

    def test_writes_cte_changes_server_functions_and_extra_statements_are_blocked(self):
        statements = ["DELETE FROM customers", "WITH erased AS (DELETE FROM customers RETURNING *) SELECT * FROM erased", "SELECT * INTO copied FROM customers", "SELECT * FROM customers FOR UPDATE", "SELECT pg_read_file('/private/file') FROM customers", "SELECT * FROM pg_catalog.pg_authid", "SELECT * FROM other.customers", "SELECT * FROM customers; DELETE FROM customers", "COPY customers TO '/tmp/export'"]
        for statement in statements:
            with self.subTest(statement=statement), self.assertRaises(ValueError):
                self.adapter._parsed(statement)

    def test_join_targets_and_aggregation_are_real_tables(self):
        _, details = self.adapter._parsed("SELECT c.name, COUNT(*) FROM customers c JOIN orders o ON c.id=o.customer_id GROUP BY c.name")
        self.assertEqual({target["table_name"] for target in details["targets"]}, {"customers", "orders"})
        self.assertTrue(details["has_aggregation"])

    def test_only_table_ddl_is_allowed_after_changes_are_enabled(self):
        self.adapter.config["read_only"] = False
        for statement in ("CREATE FUNCTION steal() RETURNS text LANGUAGE sql AS $$ SELECT 'x' $$", "ALTER ROLE somebody SUPERUSER", "DROP DATABASE shop"):
            with self.subTest(statement=statement), self.assertRaises(ValueError):
                self.adapter._parsed(statement)

    def test_mutating_ctes_cannot_hide_a_second_change_inside_a_confirmation(self):
        self.adapter.config["read_only"] = False
        with self.assertRaises(ValueError):
            self.adapter._parsed("WITH erased AS (DELETE FROM customers RETURNING name) INSERT INTO customers(name) SELECT name FROM erased")
        _, details = self.adapter._parsed("WITH selected AS (SELECT * FROM customers) SELECT COUNT(*) FROM selected")
        self.assertEqual(details["targets"], [{"table_name":"customers", "access_type":"read"}])

    def test_cte_names_only_hide_relations_in_their_own_scope(self):
        with self.assertRaises(ValueError):
            self.adapter._parsed("SELECT nspname,(WITH pg_namespace AS (SELECT * FROM customers) SELECT COUNT(*) FROM pg_namespace) FROM pg_namespace")
        _, details = self.adapter._parsed("WITH customers AS (SELECT * FROM customers) SELECT * FROM customers")
        self.assertEqual(details["targets"], [{"table_name":"customers", "access_type":"read"}])

    def test_a_cte_cannot_hide_the_real_mutation_target(self):
        self.adapter.config["read_only"] = False
        with self.assertRaises(ValueError):
            self.adapter._parsed("WITH pg_namespace AS (SELECT * FROM customers) DELETE FROM pg_namespace")
        _, details = self.adapter._parsed("WITH orders AS (SELECT * FROM customers) DELETE FROM orders")
        self.assertIn({"table_name":"orders", "access_type":"write"},details["targets"])

    def test_qualified_user_functions_cannot_borrow_a_builtin_name(self):
        for query in ("SELECT other.lower(name) FROM customers", "SELECT public.lower(name) FROM customers", "SELECT * FROM other.generate_series(1,2) CROSS JOIN customers"):
            with self.subTest(query=query), self.assertRaises(ValueError):
                self.adapter._parsed(query)
        root, _ = self.adapter._parsed("SELECT pg_catalog.lower(name) FROM CUSTOMERS")
        self.assertIn('"public".customers',root.sql(dialect="postgres"))
