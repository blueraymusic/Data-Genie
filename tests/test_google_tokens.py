"""Real RSA signatures and controlled HTTP responses at the Google boundary."""
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

from backend import google_auth

CLIENT = "123-fixture.apps.googleusercontent.com"
PUBLIC = "https://data-genie.space"
CALLBACK = PUBLIC + google_auth.CALLBACK_PATH


@unittest.skipIf(jwt is None, "Optional PyJWT/crypto package is not installed.")
class GoogleTokenTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.jwk_data = {**json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(cls.private_key.public_key())),
                        "kid": "fixture-key", "use": "sig", "alg": "RS256"}

    def setUp(self):
        self.config = {"client_id": CLIENT, "secret": "fixture-only", "redirect_uri": CALLBACK}
        self.flow = google_auth.begin(self.config)
        now = int(time.time())
        self.claims = {"iss": google_auth.ISSUER, "sub": "fixture-subject", "aud": CLIENT,
                       "iat": now - 30, "exp": now + 300, "nonce": self.flow["nonce"],
                       "email": "ada@gmail.com", "email_verified": True,
                       "given_name": "Ada", "family_name": "Lovelace"}
        self.jwks = Mock()
        self.jwks.get_signing_key_from_jwt.return_value = jwt.PyJWK(self.jwk_data)
        self.keys_patch = patch.object(google_auth, "signing_keys", return_value=self.jwks)
        self.keys_patch.start()
        self.addCleanup(self.keys_patch.stop)

    def encode(self, updates=None, *, remove=(), key=None, headers=None):
        claims = {**self.claims, **(updates or {})}
        for name in remove:
            claims.pop(name, None)
        return jwt.encode(claims, key or self.private_key, algorithm="RS256",
                          headers={"kid": "fixture-key", **(headers or {})})

    def validate(self, encoded):
        return google_auth.validate_id_token(encoded, self.flow, self.config)

    def test_signed_claims_canonicalize_issuer_and_never_expose_tokens(self):
        for issuer in (google_auth.ISSUER, "accounts.google.com"):
            result = self.validate(self.encode({"iss": issuer}))
            self.assertEqual(result, {"issuer": google_auth.ISSUER, "subject": "fixture-subject",
                                     "email": "ada@gmail.com", "email_verified": True,
                                     "email_authoritative": True, "first_name": "Ada", "last_name": "Lovelace"})

    def test_google_is_authoritative_only_for_verified_gmail_or_workspace(self):
        cases = [({"email_verified": False}, False), ({"email_verified": "true"}, False),
                 ({"email": "ada@example.com"}, False),
                 ({"email": "ada@example.com", "hd": "example.com"}, True),
                 ({"email": "ada@googlemail.com"}, True),
                 ({"email": "ada@example.com", "hd": ""}, False)]
        for changes, expected in cases:
            with self.subTest(claims=changes):
                self.assertIs(self.validate(self.encode(changes))["email_authoritative"], expected)

    def test_invalid_claims_rejected_with_no_provider_details(self):
        now = int(time.time())
        for updates in ({"aud": "other"}, {"aud": [CLIENT]}, {"iss": "https://untrusted.example"},
                        {"nonce": "wrong"}, {"nonce": 123}, {"sub": ""}, {"sub": 123},
                        {"sub": "with whitespace"}, {"exp": now - 120}, {"iat": now + 120},
                        {"nbf": now + 120}, {"azp": "other"}):
            with self.subTest(claims=updates), self.assertRaises(google_auth.GoogleError) as caught:
                self.validate(self.encode(updates))
            self.assertEqual(str(caught.exception), "Google sign-in could not be completed.")
        for name in ("iss", "sub", "aud", "exp", "iat", "nonce"):
            with self.subTest(missing=name), self.assertRaises(google_auth.GoogleError):
                self.validate(self.encode(remove=(name,)))

    def test_bad_signature_unsigned_and_hmac_tokens_rejected(self):
        tokens = [self.encode(key=self.other_key), jwt.encode(self.claims, None, algorithm="none"),
                  jwt.encode(self.claims, "fixture-only-hmac-secret-at-least-32-bytes", algorithm="HS256"),
                  "not.a.jwt", "a" * 32_769, None]
        for encoded in tokens:
            with self.subTest(token=str(encoded)[:20]), self.assertRaises(google_auth.GoogleError):
                self.validate(encoded)

    def test_untrusted_jwt_header_never_selects_network_endpoint(self):
        encoded = self.encode(headers={"jku": "https://untrusted.example/keys",
                                       "x5u": "http://169.254.169.254/metadata"})
        with patch("urllib.request.urlopen", side_effect=AssertionError("unexpected network")):
            self.assertEqual(self.validate(encoded)["subject"], "fixture-subject")
        self.jwks.get_signing_key_from_jwt.assert_called_once_with(encoded)

    def test_begin_minimal_scopes_pkce_and_random_browser_bound_secrets(self):
        target = urlsplit(self.flow["auth_uri"])
        self.assertEqual(target.scheme + "://" + target.netloc + target.path, google_auth.AUTHORIZE_URL)
        query = parse_qs(target.query)
        self.assertEqual(set(query["scope"][0].split()), {"openid", "email", "profile"})
        self.assertEqual(query["response_type"], ["code"])
        self.assertEqual(query["access_type"], ["online"])
        self.assertEqual(query["redirect_uri"], [CALLBACK])
        self.assertEqual(query["nonce"], [self.flow["nonce"]])
        self.assertEqual(query["state"], [self.flow["state"]])
        self.assertEqual(query["code_challenge_method"], ["S256"])
        challenge = base64.urlsafe_b64encode(hashlib.sha256(
            self.flow["code_verifier"].encode("ascii")).digest()).rstrip(b"=").decode("ascii")
        self.assertEqual(query["code_challenge"], [challenge])
        another = google_auth.begin(self.config)
        for key in ("nonce", "state", "code_verifier"):
            self.assertNotEqual(self.flow[key], another[key])
        self.assertNotIn("fixture-only", self.flow["auth_uri"])

    def test_finish_checks_state_config_cancellation_before_any_exchange(self):
        cases = [({**self.flow, "genie_config": [CLIENT, "https://other.example/callback"]},
                  {"state": self.flow["state"], "code": "code"}),
                 (self.flow, {"state": "forged-state", "code": "code"}),
                 (self.flow, {"state": self.flow["state"]}),
                 (self.flow, {"state": self.flow["state"], "error": "access_denied"})]
        for flow, response in cases:
            with self.subTest(response=response), patch.object(google_auth, "exchange") as exchange, \
                    self.assertRaises(google_auth.GoogleError):
                google_auth.finish(self.config, flow, response)
            exchange.assert_not_called()

    def test_finish_uses_signature_verification_and_redacts_network_failure(self):
        response = {"state": self.flow["state"], "code": "fixture-code"}
        with patch.object(google_auth, "exchange", return_value=self.encode()):
            self.assertEqual(google_auth.finish(self.config, self.flow, response)["subject"], "fixture-subject")
        with patch.object(google_auth, "exchange", side_effect=ValueError("private secret and provider code")), \
                self.assertRaises(google_auth.GoogleError) as caught:
            google_auth.finish(self.config, self.flow, response)
        self.assertNotIn("private", str(caught.exception))

    def test_http_exchange_posts_only_to_fixed_endpoint_and_bounds_response(self):
        http_response = Mock()
        http_response.__enter__ = Mock(return_value=http_response)
        http_response.__exit__ = Mock(return_value=False)
        http_response.read.return_value = json.dumps({"id_token": self.encode(),
                                                     "access_token": "discarded", "refresh_token": "discarded"}).encode()
        opener = Mock()
        opener.open.return_value = http_response
        with patch.object(google_auth, "build_opener", return_value=opener) as build:
            token = google_auth.exchange(self.config, self.flow, "code")
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, google_auth.TOKEN_URL)
        self.assertEqual(opener.open.call_args.kwargs, {"timeout": 10})
        self.assertIsInstance(build.call_args.args[0], google_auth.NoRedirect)
        self.assertIsNone(build.call_args.args[0].redirect_request(None, None, 302, "", {}, "https://evil.test"))
        self.assertEqual(parse_qs(request.data.decode()), {
            "client_id": [CLIENT], "client_secret": ["fixture-only"], "code": ["code"],
            "redirect_uri": [CALLBACK], "code_verifier": [self.flow["code_verifier"]],
            "grant_type": ["authorization_code"]})
        self.assertEqual(self.validate(token)["subject"], "fixture-subject")
        http_response.read.assert_called_once_with(65_537)
        for payload in (b"x" * 65_537, b"[]", b'{"error":"private error"}'):
            http_response.read.return_value = payload
            with patch.object(google_auth, "build_opener", return_value=opener), self.assertRaises(google_auth.GoogleError):
                google_auth.exchange(self.config, self.flow, "code")


class GoogleConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.values = {"GENIE_GOOGLE_CLIENT_ID": CLIENT, "GENIE_GOOGLE_CLIENT_SECRET": "fixture-only",
                       "GENIE_GOOGLE_REDIRECT_URI": CALLBACK}
        self.patch = patch.object(google_auth.settings, "value",
                                  side_effect=lambda name, default="": self.values.get(name, default))
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def configured(self, public=PUBLIC):
        with patch.object(google_auth.settings, "public_url", return_value=public):
            return google_auth.configuration()

    def test_complete_config_and_fail_closed_on_missing_or_unsafe_values(self):
        self.assertEqual(self.configured(), {"client_id": CLIENT, "secret": "fixture-only", "redirect_uri": CALLBACK})
        for name, value in [("GENIE_GOOGLE_CLIENT_ID", ""), ("GENIE_GOOGLE_CLIENT_ID", "https://evil.test"),
                            ("GENIE_GOOGLE_CLIENT_SECRET", " "), ("GENIE_GOOGLE_REDIRECT_URI", ""),
                            ("GENIE_GOOGLE_REDIRECT_URI", "http://data-genie.space" + google_auth.CALLBACK_PATH),
                            ("GENIE_GOOGLE_REDIRECT_URI", "https://evil.test" + google_auth.CALLBACK_PATH),
                            ("GENIE_GOOGLE_REDIRECT_URI", CALLBACK + "?next=evil"),
                            ("GENIE_GOOGLE_REDIRECT_URI", CALLBACK + "#fragment")]:
            old = self.values[name]
            self.values[name] = value
            with self.subTest(setting=name):
                self.assertIsNone(self.configured())
            self.values[name] = old

    def test_local_callback_requires_loopback_and_exact_path(self):
        for origin in ("http://localhost:8000", "http://127.0.0.1:8001", "http://[::1]:8000"):
            self.values["GENIE_GOOGLE_REDIRECT_URI"] = origin + google_auth.CALLBACK_PATH
            self.assertIsNotNone(self.configured(public=""))
        for callback in ("http://example.test" + google_auth.CALLBACK_PATH,
                         "http://localhost:0" + google_auth.CALLBACK_PATH,
                         "http://localhost:65536" + google_auth.CALLBACK_PATH,
                         "http://localhost:8000/wrong", "http://user:password@localhost:8000" + google_auth.CALLBACK_PATH):
            self.values["GENIE_GOOGLE_REDIRECT_URI"] = callback
            self.assertIsNone(self.configured(public=""))

    @unittest.skipIf(jwt is None, "Optional PyJWT package is not installed.")
    def test_jwks_uses_fixed_google_endpoint_with_bounded_cache(self):
        google_auth.signing_keys.cache_clear()
        self.addCleanup(google_auth.signing_keys.cache_clear)
        with patch.object(jwt, "PyJWKClient") as client:
            self.assertIs(google_auth.signing_keys(), google_auth.signing_keys())
        client.assert_called_once_with(google_auth.JWKS_URL, timeout=10, lifespan=300)
