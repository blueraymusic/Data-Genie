"""Optional Google OIDC sign-in with single-use state, nonce, and S256 PKCE.

Only the verified issuer/subject identifies an account. Provider access and
refresh tokens are discarded, and network calls never hold the snapshot lock.
"""
import base64
from functools import lru_cache
import hashlib
import hmac
import json
import re
import secrets
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from . import authentication, settings
from .microsoft_auth import FlowStore as LegacyFlowStore, durable


CALLBACK_PATH = "/api/auth/google/callback"
COOKIE_NAME = "data_genie_google"
FLOW_LIFETIME = 10 * 60
ISSUER = "https://accounts.google.com"
AUTHORIZE_URL = ISSUER + "/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
CLIENT_ID = re.compile(r"^[A-Za-z0-9_-]{1,200}\.apps\.googleusercontent\.com$")


class GoogleError(ValueError):
    def __init__(self, code="invalid"):
        self.code = code
        super().__init__("Google sign-in could not be completed.")


def configuration():
    """Fail closed unless the callback exactly matches the configured origin."""
    client = settings.value("GENIE_GOOGLE_CLIENT_ID").strip()
    secret = settings.value("GENIE_GOOGLE_CLIENT_SECRET").strip()
    redirect = settings.value("GENIE_GOOGLE_REDIRECT_URI").strip()
    if not CLIENT_ID.fullmatch(client) or not secret or not redirect:
        return None
    try:
        parsed = urlsplit(redirect)
        public = settings.public_url()
        if (parsed.username or parsed.password or parsed.query or parsed.fragment
                or parsed.path != CALLBACK_PATH or not parsed.hostname):
            return None
        if public:
            if redirect != public + CALLBACK_PATH:
                return None
        elif (parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
              or not 1 <= (parsed.port if parsed.port is not None else 80) <= 65535):
            return None
    except ValueError:
        return None
    return {"client_id": client, "secret": secret, "redirect_uri": redirect}


def begin(config):
    flow = {"state": secrets.token_urlsafe(32), "nonce": secrets.token_urlsafe(32),
            "code_verifier": secrets.token_urlsafe(64),
            "genie_config": [config["client_id"], config["redirect_uri"]]}
    challenge = base64.urlsafe_b64encode(hashlib.sha256(
        flow["code_verifier"].encode("ascii")).digest()).rstrip(b"=").decode("ascii")
    flow["auth_uri"] = AUTHORIZE_URL + "?" + urlencode({
        "client_id": config["client_id"], "redirect_uri": config["redirect_uri"],
        "response_type": "code", "scope": "openid email profile", "access_type": "online",
        "prompt": "select_account", "state": flow["state"], "nonce": flow["nonce"],
        "code_challenge": challenge, "code_challenge_method": "S256",
    })
    return flow


@lru_cache(maxsize=1)
def signing_keys():
    import jwt
    return jwt.PyJWKClient(JWKS_URL, timeout=10, lifespan=300)


def validate_id_token(encoded, flow, config):
    import jwt
    if not isinstance(encoded, str) or len(encoded) > 32_768:
        raise GoogleError()
    try:
        key = signing_keys().get_signing_key_from_jwt(encoded)
        claims = jwt.decode(
            encoded, key.key, algorithms=["RS256"], audience=config["client_id"],
            issuer=[ISSUER, "accounts.google.com"], leeway=60,
            options={"require": ["iss", "sub", "aud", "exp", "iat", "nonce"], "strict_aud": True},
        )
        if (not isinstance(claims["nonce"], str)
                or not hmac.compare_digest(claims["nonce"], flow["nonce"])
                or claims.get("azp", config["client_id"]) != config["client_id"]):
            raise GoogleError()
        subject = claims["sub"]
        if not isinstance(subject, str) or not 1 <= len(subject) <= 255 or any(ord(c) < 33 for c in subject):
            raise GoogleError()
        email = claims.get("email")
        verified = claims.get("email_verified") is True
        domain = email.rsplit("@", 1)[-1].lower() if isinstance(email, str) else ""
        hosted = claims.get("hd")
        # Google is authoritative for Gmail and managed Workspace addresses.
        # Other Google accounts can still be explicitly linked after a local
        # password check; their historical email verification cannot claim mail.
        authoritative = verified and (domain in {"gmail.com", "googlemail.com"}
                                      or (isinstance(hosted, str) and bool(hosted.strip())))
        name = (str(claims.get("name") or "").strip() or "Google user").split(maxsplit=1)
        return {"issuer": ISSUER, "subject": subject, "email": email,
                "email_verified": verified, "email_authoritative": authoritative,
                "first_name": claims.get("given_name") or name[0],
                "last_name": claims.get("family_name") or (name[1] if len(name) > 1 else "")}
    except GoogleError:
        raise
    except Exception:
        raise GoogleError() from None


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        # Never forward the client secret to a redirected endpoint.
        return None


def exchange(config, flow, code):
    request = Request(TOKEN_URL, data=urlencode({
        "client_id": config["client_id"], "client_secret": config["secret"],
        "redirect_uri": config["redirect_uri"], "code": code,
        "code_verifier": flow["code_verifier"], "grant_type": "authorization_code",
    }).encode("ascii"), headers={"Accept": "application/json",
                                "Content-Type": "application/x-www-form-urlencoded"})
    with build_opener(NoRedirect()).open(request, timeout=10) as response:
        payload = response.read(65_537)
        if len(payload) > 65_536:
            raise GoogleError()
        result = json.loads(payload)
        if not isinstance(result, dict) or result.get("error"):
            raise GoogleError()
        return result.get("id_token")


def finish(config, flow, response):
    if flow.get("genie_config") != [config["client_id"], config["redirect_uri"]]:
        raise GoogleError()
    if not hmac.compare_digest(str(response.get("state", "")), flow.get("state", "")):
        raise GoogleError()
    if "error" in response:
        raise GoogleError("cancelled" if response["error"] == "access_denied" else "invalid")
    code = response.get("code")
    if not isinstance(code, str) or not 1 <= len(code) <= 4096:
        raise GoogleError()
    try:
        return validate_id_token(exchange(config, flow, code), flow, config)
    except GoogleError:
        raise
    except Exception:
        # HTTP/library errors can include credentials, codes, and profile claims.
        raise GoogleError() from None


class FlowStore(LegacyFlowStore):
    """Separate flow namespace prevents old-provider callbacks from being reused."""
    table = "google_auth_flows"
    error_class = GoogleError


def new_browser_token():
    return secrets.token_urlsafe(32)
