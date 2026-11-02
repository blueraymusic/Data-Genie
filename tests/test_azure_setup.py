"""The identity bootstrap must never grant subscription-wide or unknown access."""
from contextlib import redirect_stdout
from io import StringIO
import unittest
from unittest.mock import patch

from scripts import setup_terraform_azure as setup


class IdentitySetupTests(unittest.TestCase):
    arguments = ["setup", "--subscription", "fixture-subscription", "--terraform-project", "Blueray", "--managed-identity"]

    def test_preview_does_not_invoke_azure(self):
        with patch("sys.argv", self.arguments), patch.object(setup, "az") as azure, patch.object(setup.subprocess, "run") as run, redirect_stdout(StringIO()):
            setup.main()
        azure.assert_not_called()
        run.assert_not_called()

    def test_managed_identity_uses_only_the_group_and_two_exact_subjects(self):
        scope = "/subscriptions/fixture-subscription/resourceGroups/data_genie"
        def response(*args):
            if args[:2] == ("group", "show"): return {"id": scope}
            if args[:2] == ("account", "show"): return {"tenantId": "fixture-tenant"}
            if args[:2] == ("identity", "list"): return []
            if args[:2] == ("identity", "create"): return {"clientId": "fixture-client", "principalId": "fixture-principal"}
            return {}
        with patch("sys.argv", self.arguments + ["--apply"]), patch.object(setup, "az", side_effect=response) as azure, patch.object(setup.subprocess, "run"), redirect_stdout(StringIO()) as output:
            setup.main()
        calls = [call.args for call in azure.call_args_list]
        self.assertFalse(any(args[0] == "ad" for args in calls))
        roles = [args for args in calls if args[:3] == ("role", "assignment", "create")]
        self.assertEqual(len(roles), 1)
        self.assertEqual(roles[0][roles[0].index("--scope") + 1], scope)
        self.assertEqual(roles[0][roles[0].index("--role") + 1], "Contributor")
        trusts = [args for args in calls if args[:3] == ("identity", "federated-credential", "create")]
        subjects = {args[args.index("--subject") + 1] for args in trusts}
        self.assertEqual(subjects, {
            "organization:blueray321:project:Blueray:workspace:Data-Genie:run_phase:plan",
            "organization:blueray321:project:Blueray:workspace:Data-Genie:run_phase:apply",
        })
        for args in trusts:
            self.assertIn("https://app.terraform.io", args)
            self.assertIn("api://AzureADTokenExchange", args)
        self.assertIn("TFC_AZURE_RUN_CLIENT_ID=fixture-client", output.getvalue())

    def test_existing_managed_identity_is_not_modified(self):
        with patch("sys.argv", self.arguments + ["--apply"]), patch.object(setup, "az", side_effect=[{"id":"fixture-scope"}, {"tenantId":"fixture-tenant"}, [{"name":"data-genie-terraform"}]]) as azure, patch.object(setup.subprocess, "run"), redirect_stdout(StringIO()), self.assertRaises(SystemExit):
            setup.main()
        self.assertEqual(azure.call_count, 3)


if __name__ == "__main__":
    unittest.main()
