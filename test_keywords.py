"""Schema-grounded keyword plans and quoted-value boundaries."""

import unittest

import keywords


class KeywordPlanTests(unittest.TestCase):
    def setUp(self):
        def column(name, datatype, primary_key=False):
            return {"name": name, "type": datatype, "primary_key": primary_key}

        self.schemas = {
            "products": {"columns": [column("id", "INTEGER", True), column("name", "TEXT"), column("category", "TEXT")]},
            "links": {"columns": [column("id", "INTEGER", True), column("product_id", "INTEGER"), column("label", "TEXT")]},
            "owned": {
                "columns": [column("owner", "INTEGER"), column("label", "TEXT")],
                "foreign_keys": [{"from": "owner", "to": "id", "table": "products"}],
            },
            "catalog": {"columns": [column("sku", "INTEGER", True), column("name", "TEXT")]},
            "sales": {"columns": [column("id", "INTEGER", True), column("units", "INTEGER"), column("revenue", "REAL"),
                                    column("note", "TEXT"), column("sale_date", "TEXT")]},
            "summary": {"columns": [column("id", "INTEGER", True), column("amount", "REAL")]},
            "accounts": {"columns": [column("id", "INTEGER", True), column("amount", "REAL")]},
            "sales table": {"columns": [column("id", "INTEGER", True), column("note", "TEXT"), column("revenue", "REAL")]},
        }

    def plan(self, question):
        return keywords.plan(question, list(self.schemas), self.schemas.__getitem__)

    def test_no_implicit_identifier_aggregation_without_numeric_measures(self):
        # An informative error or a preview is acceptable; summing keys is not.
        for table in ("products", "links", "owned", "catalog"):
            for action in ("analyze", "average", "sum", "compare", "trend"):
                with self.subTest(table=table, action=action):
                    try:
                        plan = self.plan(f'{action} "{table}"')
                    except keywords.KeywordError:
                        continue
                    self.assertNotRegex(plan["sql"], r"\b(?:SUM|AVG|MIN|MAX)\s*\(")
                    self.assertEqual(plan["visualization"], "table")

    def test_explicit_numeric_identifiers_remain_available(self):
        self.assertIn('SUM("id")', self.plan("sum id in products")["sql"])
        self.assertIn('SUM("owner")', self.plan("sum owner in owned")["sql"])
        self.assertIn('AVG("sku")', self.plan("average sku in catalog")["sql"])

    def test_explicit_measure_is_not_replaced_by_numeric_group(self):
        sql = self.plan("compare revenue by units in sales")["sql"]
        self.assertIn('SUM("revenue")', sql)
        self.assertIn('GROUP BY "units"', sql)
        self.assertNotIn('SUM("id")', sql)

    def test_monthly_average_uses_average(self):
        sql = self.plan("average revenue in sales by month")["sql"]
        self.assertIn('AVG("revenue")', sql)
        self.assertIn('substr("sale_date", 1, 7)', sql)

    def test_table_names_do_not_trigger_aggregate_intents(self):
        for name in ("summary", "accounts"):
            with self.subTest(name=name):
                self.assertEqual(self.plan(f"show {name}")["sql"], f'SELECT * FROM "{name}" LIMIT 50')

    def test_mutation_words_in_filter_and_insert_values_remain_data(self):
        self.assertEqual(
            self.plan('show sales where note="drop table sales"')["sql"],
            'SELECT * FROM "sales" WHERE "note" = \'drop table sales\' LIMIT 50',
        )
        self.assertEqual(
            self.plan('insert into sales note="delete from sales"')["sql"],
            'INSERT INTO "sales" ("note") VALUES (\'delete from sales\')',
        )

    def test_delete_keeps_its_predicate(self):
        self.assertEqual(self.plan("delete from sales where id=1")["sql"], 'DELETE FROM "sales" WHERE "id" = 1')

    def test_quoted_table_names_resolve_independently_of_literal_values(self):
        self.assertEqual(
            self.plan('show "sales table" where note="products"')["sql"],
            'SELECT * FROM "sales table" WHERE "note" = \'products\' LIMIT 50',
        )
        self.assertEqual(
            self.plan('delete from "sales table" where id=1')["sql"],
            'DELETE FROM "sales table" WHERE "id" = 1',
        )

    def test_join_words_inside_a_quoted_table_name_are_not_commands(self):
        self.schemas["sales with products archive"] = {
            "columns": [{"name": "id", "type": "INTEGER", "primary_key": True}],
        }
        self.assertEqual(
            self.plan('show "sales with products archive"')["sql"],
            'SELECT * FROM "sales with products archive" LIMIT 50',
        )

    def test_contains_decodes_escaped_apostrophes_once(self):
        self.assertEqual(
            self.plan("show sales where note contains 'O''Brien'")["sql"],
            'SELECT * FROM "sales" WHERE "note" LIKE \'%O\'\'Brien%\' LIMIT 50',
        )

    def test_candidate_name_is_not_a_date_for_automatic_analysis(self):
        self.schemas["candidates"] = {
            "columns": [
                {"name": "id", "type": "INTEGER", "primary_key": True},
                {"name": "candidate_name", "type": "TEXT"},
                {"name": "score", "type": "REAL"},
            ],
        }
        plan = self.plan("analyze candidates")
        self.assertEqual(plan["visualization"], "bar")
        self.assertIn('GROUP BY "candidate_name"', plan["sql"])
        self.assertNotIn('substr("candidate_name"', plan["sql"])

    def test_compound_request_split_preserves_quoted_command_words(self):
        request = 'insert into sales note="hello then drop table sales" then show sales'
        self.assertEqual(keywords.split_requests(request), [
            'insert into sales note="hello then drop table sales"', 'show sales',
        ])
        request = 'insert into sales note="hello" then show sales'
        self.assertEqual(keywords.split_requests(request), ['insert into sales note="hello"', 'show sales'])

    def test_empty_database_accepts_structure_creation_and_rejects_unknown_tables(self):
        create = keywords.plan('create table "projects" (id INTEGER PRIMARY KEY, name TEXT)', [], lambda _: None)
        self.assertEqual(create["sql"], 'CREATE TABLE "projects" (id INTEGER PRIMARY KEY, name TEXT)')
        self.assertIsNotNone(keywords.metadata_plan("show tables", []))
        with self.assertRaises(keywords.KeywordError):
            keywords.plan("show products", [], lambda _: None)


if __name__ == "__main__":
    unittest.main()
