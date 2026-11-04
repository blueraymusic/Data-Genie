"""Exercise the OIDC boundary with real RSA signatures, without a live provider."""

import base64
import hashlib
import json
import time
import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

try:
    import jwt
    from cryptography.hazmat.primitives.asymmetric import rsa
except ImportError:
    jwt = rsa = None
try:
    import msal
except ImportError:
    msal = None

from backend import authentication, microsoft_auth


CLIENT = "11111111-1111-4111-8111-111111111111"
TENANT = "22222222-2222-4222-8222-222222222222"
OTHER_TENANT = "33333333-3333-4333-8333-333333333333"
PUBLIC = "https://data-genie.space"
CALLBACK = PUBLIC + microsoft_auth.CALLBACK_PATH


@unittest.skipIf(jwt is None, "Optional Microsoft sign-in packages are not installed.")
class MicrosoftTokenTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.jwk_data = {
            **json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(cls.private_key.public_key())),
            "kid": "fixture-key", "use": "sig", "alg": "RS256",
            "issuer": microsoft_auth.MS_ORIGIN + "/{tenantid}/v2.0",
        }

    def setUp(self):
        self.config = {"client_id": CLIENT, "secret": "fixture-only-secret",
                       "tenant": "common", "redirect_uri": CALLBACK}
        self.flow = {"nonce": "fixture-flow-nonce", "state": "fixture-flow-state",
                     "genie_config": [CLIENT, "common", CALLBACK]}
        now = int(time.time())
        self.claims = {
            "iss": microsoft_auth.MS_ORIGIN + "/" + TENANT + "/v2.0",
            "tid": TENANT, "sub": "fixture-subject", "aud": CLIENT,
            "iat": now - 30, "exp": now + 300, "ver": "2.0",
            "nonce": authentication.token_hash(self.flow["nonce"]),
            "email": "ada@example.test", "given_name": "Ada", "family_name": "Lovelace",
        }
        self.jwks = Mock()
        self.jwks.get_signing_key_from_jwt.return_value = jwt.PyJWK(self.jwk_data)
        self.keys_patch = patch.object(microsoft_auth, "signing_keys", return_value=self.jwks)
        self.keys_patch.start()
        self.addCleanup(self.keys_patch.stop)

    def encode(self, updates=None, *, remove=(), key=None, headers=None, algorithm="RS256"):
        claims = {**self.claims, **(updates or {})}
        for name in remove:
            claims.pop(name, None)
        return jwt.encode(claims, self.private_key if key is None else key,
                          algorithm=algorithm, headers={"kid": "fixture-key", **(headers or {})})

    def validate(self, encoded, config=None):
        return microsoft_auth.validate_id_token(encoded, self.flow, config or self.config)

    def test_signed_token_maps_only_verified_identity(self):
        result = self.validate(self.encode())
        self.assertEqual(result, {
            "issuer": self.claims["iss"], "subject": "fixture-subject", "email": "ada@example.test",
            "first_name": "Ada", "last_name": "Lovelace",
        })
        self.assertNotIn("secret", result)
        self.assertNotIn("id_token", result)

    def test_invalid_claims_are_rejected_with_generic_error(self):
        now = int(time.time())
        cases = {
            "wrong audience": {"aud": "another-client"},
            "audience array": {"aud": [CLIENT]},
            "wrong issuer": {"iss": "https://untrusted.example/" + TENANT + "/v2.0"},
            "cross tenant issuer": {"iss": microsoft_auth.MS_ORIGIN + "/" + OTHER_TENANT + "/v2.0"},
            "malformed tenant": {"tid": "../../untrusted.example"},
            "non string tenant": {"tid": [TENANT]},
            "wrong nonce": {"nonce": "not-the-flow-nonce"},
            "raw nonce": {"nonce": self.flow["nonce"]},
            "non string nonce": {"nonce": 123},
            "expired": {"exp": now - 120},
            "future issued time": {"iat": now + 120},
            "not yet valid": {"nbf": now + 120},
            "wrong authorized party": {"azp": "another-client"},
            "old token version": {"ver": "1.0"},
            "non string subject": {"sub": 123},
        }
        for label, claims in cases.items():
            with self.subTest(label=label), self.assertRaises(microsoft_auth.MicrosoftError) as caught:
                self.validate(self.encode(claims))
            self.assertEqual(caught.exception.code, "invalid")
            self.assertEqual(str(caught.exception), "Microsoft sign-in could not be completed.")

    def test_every_required_claim_and_version_is_checked(self):
        for name in ("iss", "sub", "aud", "exp", "iat", "nonce", "tid", "ver"):
            with self.subTest(claim=name), self.assertRaises(microsoft_auth.MicrosoftError):
                self.validate(self.encode(remove=(name,)))

    def test_bad_signature_unsigned_and_hmac_tokens_are_rejected(self):
        tokens = [
            self.encode(key=self.other_key),
            jwt.encode(self.claims, None, algorithm="none"),
            jwt.encode(self.claims, "fixture-hmac-secret-at-least-32-bytes", algorithm="HS256"),
            "not.a.jwt",
            "a" * 32_769,
            None,
        ]
        for encoded in tokens:
            with self.subTest(kind=str(encoded)[:20]), self.assertRaises(microsoft_auth.MicrosoftError):
                self.validate(encoded)

    def test_key_issuer_constraint_is_enforced(self):
        for issuer in (None, "", "https://untrusted.example/{tenantid}/v2.0",
                       microsoft_auth.MS_ORIGIN + "/" + OTHER_TENANT + "/v2.0"):
            key_data = {**self.jwk_data, "issuer": issuer}
            self.jwks.get_signing_key_from_jwt.return_value = jwt.PyJWK(key_data)
            with self.subTest(issuer=issuer), self.assertRaises(microsoft_auth.MicrosoftError):
                self.validate(self.encode())
        self.jwks.get_signing_key_from_jwt.return_value = jwt.PyJWK(
            {**self.jwk_data, "issuer": self.claims["iss"]})
        self.assertEqual(self.validate(self.encode())["subject"], "fixture-subject")

    def test_common_consumer_organization_and_single_tenant_audiences(self):
        consumer = microsoft_auth.CONSUMER_TENANT
        consumer_token = self.encode({"tid": consumer, "iss": microsoft_auth.MS_ORIGIN + "/" + consumer + "/v2.0"})
        organization_token = self.encode()
        for authority, token in (("common", consumer_token), ("common", organization_token),
                                 ("consumers", consumer_token), ("organizations", organization_token),
                                 (TENANT, organization_token)):
            with self.subTest(allowed=authority):
                self.assertEqual(self.validate(token, {**self.config, "tenant": authority})["subject"], "fixture-subject")
        for authority, token in (("organizations", consumer_token), ("consumers", organization_token),
                                 (OTHER_TENANT, organization_token), (TENANT, consumer_token)):
            with self.subTest(rejected=authority), self.assertRaises(microsoft_auth.MicrosoftError):
                self.validate(token, {**self.config, "tenant": authority})

    def test_token_headers_never_choose_a_network_endpoint(self):
        encoded = self.encode(headers={"jku": "https://untrusted.example/keys",
                                       "x5u": "http://169.254.169.254/metadata"})
        with patch("urllib.request.urlopen", side_effect=AssertionError("unexpected network")):
            self.assertEqual(self.validate(encoded)["issuer"], self.claims["iss"])
        self.jwks.get_signing_key_from_jwt.assert_called_once_with(encoded)

    def test_missing_email_and_profile_can_only_map_stable_identity(self):
        result = self.validate(self.encode(remove=("email", "given_name", "family_name")))
        self.assertEqual(result["issuer"], self.claims["iss"])
        self.assertEqual(result["subject"], self.claims["sub"])
        self.assertIsNone(result["email"])
        self.assertEqual(result["first_name"], "Microsoft")
        self.assertEqual(result["last_name"], "user")

    def test_finish_checks_state_and_configuration_before_exchange(self):
        cases = [({**self.flow, "genie_config": [CLIENT, "common", "https://other.example/callback"]},
                  {"state": self.flow["state"], "code": "code"}),
                 (self.flow, {"state": "forged-state", "code": "code"}),
                 (self.flow, {"state": self.flow["state"]})]
        for flow, response in cases:
            with self.subTest(response=response), patch.object(microsoft_auth, "client") as client, \
                    self.assertRaises(microsoft_auth.MicrosoftError):
                microsoft_auth.finish(self.config, flow, response)
            client.assert_not_called()

    def test_finish_validates_signed_id_token_instead_of_library_claims(self):
        sdk = Mock()
        sdk.acquire_token_by_auth_code_flow.return_value = {
            "id_token": self.encode(), "id_token_claims": {"sub": "untrusted-library-shortcut"},
            "access_token": "not-persisted", "refresh_token": "not-persisted",
        }
        response = {"state": self.flow["state"], "code": "fixture-code"}
        with patch.object(microsoft_auth, "client", return_value=sdk):
            result = microsoft_auth.finish(self.config, self.flow, response)
        self.assertEqual(result["subject"], self.claims["sub"])
        self.assertNotIn("access_token", result)
        sdk.acquire_token_by_auth_code_flow.assert_called_once_with(self.flow, response)

    @unittest.skipIf(msal is None, "Optional MSAL package is not installed.")
    def test_actual_msal_roundtrip_uses_minimal_scopes_and_pkce(self):
        metadata_url = microsoft_auth.MS_ORIGIN + "/common/v2.0/.well-known/openid-configuration"
        authorize_url = microsoft_auth.MS_ORIGIN + "/common/oauth2/v2.0/authorize"
        token_url = microsoft_auth.MS_ORIGIN + "/common/oauth2/v2.0/token"
        metadata = {
            "issuer": microsoft_auth.MS_ORIGIN + "/{tenantid}/v2.0",
            "authorization_endpoint": authorize_url,
            "token_endpoint": token_url,
            "jwks_uri": microsoft_auth.MS_ORIGIN + "/common/discovery/v2.0/keys",
        }

        class Response:
            status_code = 200
            headers = {"Content-Type": "application/json"}

            def __init__(self, body):
                self.text = json.dumps(body)

            def json(self):
                return json.loads(self.text)

        class InMemoryHttp:
            def __init__(self):
                self.gets = []
                self.posts = []
                self.token = None

            def get(self, url, **kwargs):
                if url != metadata_url:
                    raise AssertionError("Unexpected MSAL metadata endpoint")
                self.gets.append(url)
                return Response(metadata)

            def post(self, url, data=None, **kwargs):
                if url != token_url:
                    raise AssertionError("Unexpected MSAL token endpoint")
                self.posts.append((url, dict(data)))
                return Response({"id_token": self.token, "access_token": "fixture-access-token",
                                 "token_type": "Bearer", "expires_in": 3600,
                                 "scope": "openid profile email"})

        http = InMemoryHttp()
        sdk = msal.ConfidentialClientApplication(
            CLIENT, client_credential=self.config["secret"],
            authority=microsoft_auth.MS_ORIGIN + "/common",
            http_client=http, exclude_scopes=["offline_access"], enable_pii_log=False,
        )
        with patch.object(microsoft_auth, "client", return_value=sdk), \
                patch("urllib.request.urlopen", side_effect=AssertionError("Unexpected real network")):
            flow = microsoft_auth.begin(self.config)
            authorization = urlsplit(flow["auth_uri"])
            query = parse_qs(authorization.query)
            self.assertEqual(authorization.scheme + "://" + authorization.netloc + authorization.path,
                             authorize_url)
            self.assertEqual(set(query["scope"][0].split()), {"openid", "profile", "email"})
            self.assertEqual(query["response_type"], ["code"])
            self.assertEqual(query["response_mode"], ["query"])
            self.assertEqual(query["code_challenge_method"], ["S256"])
            challenge = base64.urlsafe_b64encode(
                hashlib.sha256(flow["code_verifier"].encode("ascii")).digest()).rstrip(b"=").decode("ascii")
            self.assertEqual(query["code_challenge"], [challenge])
            self.assertEqual(query["redirect_uri"], [CALLBACK])
            self.assertEqual(query["nonce"], [authentication.token_hash(flow["nonce"])])
            http.token = self.encode({"nonce": query["nonce"][0]})
            identity = microsoft_auth.finish(
                self.config, flow, {"state": flow["state"], "code": "fixture-authorization-code"})

        self.assertEqual(http.gets, [metadata_url])
        self.assertEqual(len(http.posts), 1)
        endpoint, posted = http.posts[0]
        self.assertEqual(endpoint, token_url)
        self.assertEqual(posted["grant_type"], "authorization_code")
        self.assertEqual(posted["code"], "fixture-authorization-code")
        self.assertEqual(posted["code_verifier"], flow["code_verifier"])
        self.assertEqual(posted["redirect_uri"], CALLBACK)
        self.assertEqual(set(posted["scope"].split()), {"openid", "profile", "email"})
        self.assertEqual(identity["issuer"], self.claims["iss"])
        self.assertEqual(identity["subject"], self.claims["sub"])
        self.assertEqual(identity["email"], self.claims["email"])
        self.assertNotIn("access_token", identity)

    def test_cancelled_callback_does_not_exchange_and_library_error_is_redacted(self):
        with patch.object(microsoft_auth, "client") as client, \
                self.assertRaises(microsoft_auth.MicrosoftError) as caught:
            microsoft_auth.finish(self.config, self.flow,
                                  {"state": self.flow["state"], "error": "access_denied",
                                   "error_description": "private provider profile"})
        self.assertEqual(caught.exception.code, "cancelled")
        client.assert_not_called()
        sdk = Mock()
        sdk.acquire_token_by_auth_code_flow.side_effect = ValueError("private provider code and token")
        with patch.object(microsoft_auth, "client", return_value=sdk), \
                self.assertRaises(microsoft_auth.MicrosoftError) as caught:
            microsoft_auth.finish(self.config, self.flow, {"state": self.flow["state"], "code": "code"})
        self.assertNotIn("private", str(caught.exception))


class MicrosoftConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.values = {
            "GENIE_MICROSOFT_CLIENT_ID": CLIENT,
            "GENIE_MICROSOFT_CLIENT_SECRET": "fixture-only-secret",
            "GENIE_MICROSOFT_TENANT": "common",
            "GENIE_MICROSOFT_REDIRECT_URI": CALLBACK,
        }
        self.patch = patch.object(microsoft_auth.settings, "value",
                                 side_effect=lambda name, default="": self.values.get(name, default))
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def configured(self, public=PUBLIC):
        with patch.object(microsoft_auth.settings, "public_url", return_value=public):
            return microsoft_auth.configuration()

    def test_complete_public_configuration(self):
        self.assertEqual(self.configured(), {"client_id": CLIENT, "secret": "fixture-only-secret",
                                            "tenant": "common", "redirect_uri": CALLBACK})

    def test_client_and_tenant_uuids_accept_uppercase_configuration(self):
        self.values["GENIE_MICROSOFT_CLIENT_ID"] = "ABCDEFAB-1234-4321-ABCD-ABCDEF123456"
        self.values["GENIE_MICROSOFT_TENANT"] = "ABCDEFAB-1234-4321-ABCD-ABCDEF123456"
        self.assertEqual(self.configured()["client_id"], self.values["GENIE_MICROSOFT_CLIENT_ID"].lower())
        self.assertEqual(self.configured()["tenant"], self.values["GENIE_MICROSOFT_TENANT"].lower())

    def test_incomplete_and_unsafe_configuration_stays_disabled(self):
        cases = [
            ("GENIE_MICROSOFT_CLIENT_ID", ""),
            ("GENIE_MICROSOFT_CLIENT_ID", "not-a-uuid"),
            ("GENIE_MICROSOFT_CLIENT_SECRET", " "),
            ("GENIE_MICROSOFT_TENANT", "https://untrusted.example/tenant"),
            ("GENIE_MICROSOFT_REDIRECT_URI", ""),
            ("GENIE_MICROSOFT_REDIRECT_URI", "http://data-genie.space" + microsoft_auth.CALLBACK_PATH),
            ("GENIE_MICROSOFT_REDIRECT_URI", "https://untrusted.example" + microsoft_auth.CALLBACK_PATH),
            ("GENIE_MICROSOFT_REDIRECT_URI", CALLBACK + "?return_url=https://untrusted.example"),
            ("GENIE_MICROSOFT_REDIRECT_URI", CALLBACK + "#fragment"),
            ("GENIE_MICROSOFT_REDIRECT_URI", "https://data-genie.space@untrusted.example" + microsoft_auth.CALLBACK_PATH),
        ]
        for name, value in cases:
            old = self.values[name]
            self.values[name] = value
            with self.subTest(setting=name, value=value):
                self.assertIsNone(self.configured())
            self.values[name] = old

    def test_local_callback_requires_http_loopback_and_exact_path(self):
        for origin in ("http://localhost:8000", "http://127.0.0.1:8001", "http://[::1]:8000"):
            self.values["GENIE_MICROSOFT_REDIRECT_URI"] = origin + microsoft_auth.CALLBACK_PATH
            with self.subTest(allowed=origin):
                self.assertIsNotNone(self.configured(public=""))
        for callback in ("http://example.test" + microsoft_auth.CALLBACK_PATH,
                         "http://localhost:0" + microsoft_auth.CALLBACK_PATH,
                         "http://localhost:8000/wrong-callback",
                         "http://localhost:bad" + microsoft_auth.CALLBACK_PATH,
                         "http://localhost:65536" + microsoft_auth.CALLBACK_PATH,
                         "http://localhost:8000" + microsoft_auth.CALLBACK_PATH + "?extra=true",
                         "http://user:password@localhost:8000" + microsoft_auth.CALLBACK_PATH):
            self.values["GENIE_MICROSOFT_REDIRECT_URI"] = callback
            with self.subTest(rejected=callback):
                self.assertIsNone(self.configured(public=""))

    def test_begin_requires_pkce_nonce_and_trusted_authorization_endpoint(self):
        config = self.configured()
        sdk = Mock()
        good = {"state": "state", "nonce": "nonce", "code_verifier": "verifier",
                "auth_uri": microsoft_auth.MS_ORIGIN + "/common/oauth2/v2.0/authorize"}
        for bad in ({**good, "auth_uri": "https://untrusted.example/authorize"},
                    {**good, "auth_uri": "http://login.microsoftonline.com/authorize"},
                    {**good, "auth_uri": "https://login.microsoftonline.com@untrusted.example/authorize"},
                    {key: value for key, value in good.items() if key != "state"},
                    {key: value for key, value in good.items() if key != "nonce"},
                    {key: value for key, value in good.items() if key != "code_verifier"}):
            sdk.initiate_auth_code_flow.return_value = bad
            with self.subTest(flow=bad), patch.object(microsoft_auth, "client", return_value=sdk), \
                    self.assertRaises(microsoft_auth.MicrosoftError):
                microsoft_auth.begin(config)
        sdk.initiate_auth_code_flow.return_value = good.copy()
        with patch.object(microsoft_auth, "client", return_value=sdk):
            flow = microsoft_auth.begin(config)
        self.assertEqual(flow["genie_config"], [CLIENT, "common", CALLBACK])
        self.assertEqual(sdk.initiate_auth_code_flow.call_args.kwargs["scopes"], ["email"])
        self.assertEqual(sdk.initiate_auth_code_flow.call_args.kwargs["response_mode"], "query")

    @unittest.skipIf(jwt is None, "Optional Microsoft sign-in packages are not installed.")
    def test_jwks_client_uses_only_fixed_microsoft_endpoint_with_bounded_cache(self):
        microsoft_auth.signing_keys.cache_clear()
        self.addCleanup(microsoft_auth.signing_keys.cache_clear)
        with patch.object(jwt, "PyJWKClient") as client:
            first = microsoft_auth.signing_keys()
            self.assertIs(microsoft_auth.signing_keys(), first)
        client.assert_called_once_with("https://login.microsoftonline.com/common/discovery/v2.0/keys",
                                       timeout=10, lifespan=300)


if __name__ == "__main__":
    unittest.main()
