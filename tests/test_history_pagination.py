"""History pages bound saved-payload loading without hiding older requests."""

import unittest
from unittest.mock import patch

from backend import workbench
from tests.test_http import HttpHarness


class HistoryPaginationTests(HttpHarness, unittest.TestCase):
    def add_reads(self, count):
        return [workbench.submit_request(self.session_id,
                f"SELECT body FROM notes WHERE id=1 /* record-{index:02d} */", raw_sql=True)["request_id"]
                for index in range(count)]

    def history(self, query=""):
        status, response = self.request("GET", "/api/history" + query, session_id=self.session_id)
        self.assertEqual(status, 200, response)
        return response

    def test_pages_cover_every_record_in_order_and_default_remains_compatible(self):
        ids = self.add_reads(47)[::-1]
        seen = []
        for offset in (0, 20, 40):
            page = self.history(f"?limit=20&offset={offset}")
            self.assertEqual(page["total"], 47)
            self.assertEqual(page["offset"], offset)
            self.assertEqual(page["limit"], 20)
            self.assertEqual(page["has_more"], offset < 40)
            self.assertEqual([item["request_id"] for item in page["requests"]], ids[offset:offset + 20])
            seen.extend(item["request_id"] for item in page["requests"])
        self.assertEqual(seen, ids)
        self.assertEqual(len(self.history()["requests"]), 47)
        self.assertNotIn("total", self.history())
        self.assertEqual(self.history("?limit=20&offset=100")["requests"], [])

    def test_filters_apply_before_count_and_offset_and_only_page_payloads_are_loaded(self):
        ids = self.add_reads(25)
        repository = workbench.get_repository()
        with patch.object(repository, "_command", wraps=repository._command) as load:
            page = self.history("?search=record-0&operation=SELECT&limit=3&offset=3")
        self.assertEqual(page["total"], 10)
        self.assertEqual([item["request_id"] for item in page["requests"]], ids[:10][::-1][3:6])
        self.assertEqual(load.call_count, 3)
        empty = self.history("?search=record-0&operation=DELETE&limit=3&offset=0")
        self.assertEqual(empty["total"], 0)
        self.assertEqual(empty["requests"], [])
        self.assertFalse(empty["has_more"])

    def test_old_pending_commands_are_returned_separately_and_single_request_lookup_is_scoped(self):
        pending = workbench.submit_request(self.session_id, "ALTER TABLE notes ADD COLUMN pending_note TEXT", raw_sql=True)
        ids = self.add_reads(25)
        page = self.history("?limit=5&offset=0&include_pending=1")
        self.assertEqual([item["request_id"] for item in page["requests"]], ids[::-1][:5])
        self.assertEqual([item["request_id"] for item in page["pending_requests"]], [pending["request_id"]])
        self.assertEqual(page["pending_requests"][0]["commands"][0]["preview"]["table"], "notes")
        exact = self.history(f"?request_id={pending['request_id']}")
        self.assertEqual(len(exact["requests"]), 1)
        with_pending_on_page = self.history(f"?request_id={pending['request_id']}&include_pending=1")
        self.assertEqual(with_pending_on_page["pending_requests"], [])
        status, created = self.request("POST", "/api/sessions", {"database_mode": "create", "database_name": "separate"})
        self.assertEqual(status, 201)
        status, response = self.request("GET", f"/api/history?request_id={pending['request_id']}", session_id=created["session_id"])
        self.assertEqual(status, 200)
        self.assertEqual(response["requests"], [])

    def test_invalid_page_arguments_and_cross_account_access_are_rejected(self):
        for query in ("limit=0", "limit=101", "limit=no", "limit=2&offset=-1", "limit=2&offset=1000001",
                      "request_id=0", "request_id=no", "request_id=999999999999999999999999999999", "limit=2&include_pending=yes"):
            with self.subTest(query=query):
                self.assertEqual(self.request("GET", "/api/history?" + query, session_id=self.session_id)[0], 400)
        self.request("POST", "/api/auth/register", {"first_name": "Other", "last_name": "Reader",
                     "email": "other@example.test", "password": self.password}, extra_headers={"Cookie": ""})
        self.assertEqual(self.request("GET", "/api/history?limit=20&include_pending=1", session_id=self.session_id)[0], 403)


if __name__ == "__main__":
    unittest.main()
