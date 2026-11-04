"""Optional Microsoft OIDC sign-in; provider tokens never become app sessions.

MSAL owns authorization-code/PKCE exchange. We validate the signed ID token
explicitly: recent MSAL versions decode claims without validating them. Only
short-lived, single-use flow data is persisted, never provider access tokens.
"""
from contextlib import contextmanager
from functools import lru_cache
import hmac
import json
import re
import secrets
import time
from urllib.parse import urlsplit

from . import authentication, cloud_state, settings


CALLBACK_PATH = "/api/auth/microsoft/callback"
COOKIE_NAME = "data_genie_microsoft"
FLOW_LIFETIME = 10 * 60
GUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad"
MS_ORIGIN = "https://login.microsoftonline.com"


class MicrosoftError(ValueError):
    def __init__(self, code="invalid"):
        self.code = code
        super().__init__("Microsoft sign-in could not be completed.")


def configuration():
    """Fail closed on incomplete configuration or an unsafe callback origin."""
    client = settings.value("GENIE_MICROSOFT_CLIENT_ID").strip().lower()
    secret = settings.value("GENIE_MICROSOFT_CLIENT_SECRET").strip()
    tenant = settings.value("GENIE_MICROSOFT_TENANT", "common").strip().lower()
    redirect = settings.value("GENIE_MICROSOFT_REDIRECT_URI").strip()
    if not GUID.fullmatch(client) or not secret or not redirect:
        return None
    if tenant not in {"common", "organizations", "consumers"} and not GUID.fullmatch(tenant):
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
    return {"client_id": client, "secret": secret, "tenant": tenant, "redirect_uri": redirect}


@contextmanager
def durable():
    """Only short repository work holds the cloud snapshot lock."""
    if settings.value("GENIE_CLOUD_STATE") == "azure_sql":
        failure = None
        with cloud_state.transaction():
            try:
                yield
            except (ValueError, PermissionError) as error:
                # Preserve consumed attempts/flows even for an expected rejection.
                # Storage failures still roll back and prevent releasing cookies.
                failure = error
        if failure:
            raise failure
    else:
        yield


def client(config):
    import msal
    return msal.ConfidentialClientApplication(
        config["client_id"], client_credential=config["secret"],
        authority=MS_ORIGIN + "/" + config["tenant"],
        timeout=10, exclude_scopes=["offline_access"], enable_pii_log=False,
    )


def begin(config):
    try:
        flow = client(config).initiate_auth_code_flow(
            scopes=["email"], redirect_uri=config["redirect_uri"],
            response_mode="query", prompt="select_account",
        )
        target = urlsplit(flow.get("auth_uri", ""))
        if (not flow.get("state") or not flow.get("nonce") or not flow.get("code_verifier")
                or target.scheme != "https" or target.netloc != "login.microsoftonline.com"):
            raise MicrosoftError("unavailable")
        # Reject flows from before a client/authority/redirect configuration change.
        flow["genie_config"] = [config["client_id"], config["tenant"], config["redirect_uri"]]
        return flow
    except MicrosoftError:
        raise
    except Exception:
        # Library errors can contain tokens and profile claims. Never relay/log them.
        raise MicrosoftError("unavailable") from None


@lru_cache(maxsize=1)
def signing_keys():
    import jwt
    # The URL is fixed, never taken from a JWT header/claim. Cache the JWKS set
    # briefly, rather than keys indefinitely, to respect signing-key rotation.
    return jwt.PyJWKClient(MS_ORIGIN + "/common/discovery/v2.0/keys", timeout=10, lifespan=300)


def validate_id_token(encoded, flow, config):
    import jwt
    if not isinstance(encoded, str) or len(encoded) > 32_768:
        raise MicrosoftError()
    try:
        # Unverified tid only selects the expected issuer string. It never selects
        # a network endpoint or account. No claim is used until signature validation.
        hint = jwt.decode(encoded, options={"verify_signature": False})
        tenant = hint.get("tid", "")
        if not isinstance(tenant, str) or not GUID.fullmatch(tenant):
            raise MicrosoftError()
        expected_issuer = MS_ORIGIN + "/" + tenant + "/v2.0"
        allowed = config["tenant"]
        if ((GUID.fullmatch(allowed) and tenant != allowed)
                or (allowed == "organizations" and tenant == CONSUMER_TENANT)
                or (allowed == "consumers" and tenant != CONSUMER_TENANT)):
            raise MicrosoftError()
        key = signing_keys().get_signing_key_from_jwt(encoded)
        # Microsoft publishes issuer constraints on each multitenant signing key.
        key_issuer = key._jwk_data.get("issuer", "")
        if key_issuer.replace("{tenantid}", tenant) != expected_issuer:
            raise MicrosoftError()
        claims = jwt.decode(
            encoded, key.key, algorithms=["RS256"], audience=config["client_id"],
            issuer=expected_issuer, leeway=60,
            options={"require": ["iss", "sub", "aud", "exp", "iat", "nonce", "tid"], "strict_aud": True},
        )
        nonce = authentication.token_hash(flow["nonce"])
        if not isinstance(claims["nonce"], str) or not hmac.compare_digest(claims["nonce"], nonce):
            raise MicrosoftError()
        if claims.get("azp", config["client_id"]) != config["client_id"] or claims.get("ver") != "2.0":
            raise MicrosoftError()
        name = (str(claims.get("name") or "").strip() or "Microsoft user").split(maxsplit=1)
        return {
            "issuer": claims["iss"], "subject": claims["sub"],
            "email": claims.get("email") or claims.get("preferred_username"),
            "first_name": claims.get("given_name") or name[0],
            "last_name": claims.get("family_name") or (name[1] if len(name) > 1 else ""),
        }
    except MicrosoftError:
        raise
    except Exception:
        raise MicrosoftError() from None


def finish(config, flow, response):
    if flow.get("genie_config") != [config["client_id"], config["tenant"], config["redirect_uri"]]:
        raise MicrosoftError()
    if not hmac.compare_digest(str(response.get("state", "")), flow.get("state", "")):
        raise MicrosoftError()
    if "error" in response:
        raise MicrosoftError("cancelled" if response["error"] == "access_denied" else "invalid")
    if not isinstance(response.get("code"), str) or not response["code"]:
        raise MicrosoftError()
    try:
        result = client(config).acquire_token_by_auth_code_flow(flow, response)
        if result.get("error"):
            raise MicrosoftError()
        return validate_id_token(result.get("id_token"), flow, config)
    except MicrosoftError:
        raise
    except Exception:
        raise MicrosoftError() from None


class FlowStore:
    def __init__(self, repository):
        self.repository = repository

    def save(self, browser, payload, *, intent="signin", account_id=None, login_hash=None):
        now = int(time.time())
        with self.repository._connection(write=True) as connection:
            connection.execute("DELETE FROM microsoft_auth_flows WHERE expires_at<=?", (now,))
            connection.execute("""INSERT OR REPLACE INTO microsoft_auth_flows
                (browser_hash,state_hash,payload_json,intent,account_id,login_hash,expires_at)
                VALUES(?,?,?,?,?,?,?)""", (
                    authentication.token_hash(browser),
                    authentication.token_hash(payload["state"]) if payload.get("state") else None,
                    json.dumps(payload), intent, account_id, login_hash, now + FLOW_LIFETIME,
                ))

    def consume(self, browser, *, state=None, grant=False):
        if not isinstance(browser, str) or not 32 <= len(browser) <= 128:
            raise MicrosoftError("link_expired" if grant else "invalid")
        with self.repository._connection(write=True) as connection:
            row = connection.execute("SELECT * FROM microsoft_auth_flows WHERE browser_hash=?",
                                     (authentication.token_hash(browser),)).fetchone()
            # Do not destroy a legitimate flow when an unrelated forged callback
            # guesses an incorrect state. The successful match is consumed atomically.
            valid = (row and row["expires_at"] > time.time()
                     and ((grant and row["intent"] == "link_grant")
                          or (not grant and row["intent"] in {"signin", "link"} and isinstance(state, str)
                              and hmac.compare_digest(row["state_hash"], authentication.token_hash(state)))))
            if valid:
                connection.execute("DELETE FROM microsoft_auth_flows WHERE browser_hash=?", (row["browser_hash"],))
                record = dict(row)
            else:
                record = None
        if record is None:
            raise MicrosoftError("link_expired" if grant else "invalid")
        record["payload"] = json.loads(record.pop("payload_json"))
        return record

    def active_link(self, record):
        now = int(time.time())
        with self.repository._connection() as connection:
            row = connection.execute("""SELECT 1 FROM browser_logins WHERE token_hash=? AND account_id=?
                AND expires_at>? AND last_seen>?""", (record["login_hash"], record["account_id"], now,
                                                     now - authentication.IDLE_LIFETIME)).fetchone()
        if not row:
            raise MicrosoftError("link_expired")


def new_browser_token():
    return secrets.token_urlsafe(32)
