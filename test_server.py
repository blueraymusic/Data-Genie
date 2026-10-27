"""Offline contract tests for the local Data Genie backend."""

import os
from pathlib import Path
import sqlite3
import tempfile
import unittest

import workbench as server


class TemporaryDatabase(unittest.TestCase):
    def setUp(self):
        descriptor, path = tempfile.mkstemp(suffix=".sqlite3")
        os.close(descriptor)
        self.path = Path(path)
        with sqlite3.connect(self.path, factory=server.Conn) as connection:
            connection.execute("CREATE TABLE inventory (id INTEGER PRIMARY KEY, item TEXT, quantity INTEGER)")
            connection.execute("INSERT INTO inventory (item, quantity) VALUES ('widget', 4)")

        self.original_path = server.ACTIVE_DB_PATH
        self.original_name = server.ACTIVE_DB_NAME
        server.ACTIVE_DB_PATH = self.path
        server.ACTIVE_DB_NAME = "test.sqlite3"

    def tearDown(self):
        server.ACTIVE_DB_PATH = self.original_path
        server.ACTIVE_DB_NAME = self.original_name
        self.path.unlink(missing_ok=True)

    def test_schema_preview_and_mutation(self):
        self.assertEqual(server.visible_tables(), ["inventory"])
        plan = server.keyword_plan("show inventory data")
        sql, operation = server.validate_sql(plan["sql"])
        self.assertEqual(operation, "read")
        self.assertEqual(server.execute_sql(sql, operation)["rows"][0]["item"], "widget")

        plan = server.keyword_plan("analyze inventory")
        self.assertEqual(plan["visualization"], "bar")
        self.assertIn('SUM("quantity")', plan["sql"])

        plan = server.keyword_plan("add column status to inventory")
        self.assertEqual(plan["sql"], 'ALTER TABLE "inventory" ADD COLUMN "status" TEXT DEFAULT NULL')

        sql, operation = server.validate_sql("INSERT INTO inventory (item, quantity) VALUES ('gadget', 2)")
        self.assertEqual(operation, "write")
        self.assertEqual(server.execute_sql(sql, operation)["changes"], 1)
        rows = server.execute_sql("SELECT COUNT(*) AS total FROM inventory", "read")["rows"]
        self.assertEqual(rows, [{"total": 2}])


class SqlValidation(unittest.TestCase):
    def test_allows_single_read_and_flags_write(self):
        self.assertEqual(server.validate_sql("SELECT 1")[1], "read")
        self.assertEqual(server.validate_sql("CREATE TABLE notes (id INTEGER)")[1], "write")

    def test_blocks_connection_commands_and_multiple_statements(self):
        with self.assertRaises(ValueError):
            server.validate_sql("PRAGMA table_info(products)")
        with self.assertRaises(ValueError):
            server.validate_sql("SELECT 1; SELECT 2")


class KeywordInterpreter(unittest.TestCase):
    def test_keyword_errors_are_clear(self):
        with self.assertRaises(server.KeywordError):
            server.keyword_plan("analyze a made up table")


if __name__ == "__main__":
    unittest.main()
