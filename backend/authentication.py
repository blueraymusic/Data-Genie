"""Local password accounts and expiring browser logins in the app repository."""

import hashlib
import hmac
import re
import secrets
import time


PASSWORD_ITERATIONS = 600_000
LOGIN_LIFETIME = 12 * 60 * 60
IDLE_LIFETIME = 30 * 60
ATTEMPT_WINDOW = 15 * 60
MAX_ATTEMPTS = 3
MAX_LOGIN_IP_ATTEMPTS = 30
MAX_REGISTER_IP_ATTEMPTS = 5
COOKIE_NAME = "data_genie_login"
MICROSOFT_PASSWORD_SENTINEL = "!microsoft"
GOOGLE_PASSWORD_SENTINEL = "!google"


class LoginRequired(PermissionError):
    pass


class TooManyAttempts(ValueError):
    def __init__(self, retry_after):
        self.retry_after = max(1, int(retry_after))
        super().__init__("Too many account attempts. Try again in a few minutes.")


class MicrosoftAccountError(ValueError):
    """A fixed, non-provider error code that is safe for an auth redirect."""

    MESSAGES = {
        "invalid_identity": "Microsoft sign-in could not be verified. Please try again.",
        "profile_required": "Microsoft did not provide an email address. Use email and password to create an account.",
        "account_exists": "Log in with your current password, then connect Microsoft in Account settings.",
        "identity_in_use": "This Microsoft account is already connected to another Data Genie account.",
        "already_linked": "A different Microsoft account is already connected to this Data Genie account.",
        "email_not_allowed": "Use a personal, work, or school email approved for this installation.",
    }

    def __init__(self, code):
        self.code = code if code in self.MESSAGES else "invalid_identity"
        super().__init__(self.MESSAGES[self.code])


class GoogleAccountError(ValueError):
    """A fixed, non-provider error code that is safe for an auth redirect."""

    MESSAGES = {
        "invalid_identity": "Google sign-in could not be verified. Please try again.",
        "profile_required": "Use a verified Gmail or Google Workspace account, or create an account with email and password first.",
        "account_exists": "Log in with your current password, then connect Google in Account settings.",
        "identity_in_use": "This Google account is already connected to another Data Genie account.",
        "already_linked": "A different Google account is already connected to this Data Genie account.",
        "email_not_allowed": "Use a personal, work, or school email approved for this installation.",
    }

    def __init__(self, code):
        self.code = code if code in self.MESSAGES else "invalid_identity"
        super().__init__(self.MESSAGES[self.code])


def password_hash(password):
    if not isinstance(password, str) or not 15 <= len(password) <= 128:
        raise ValueError("Use a password with 15 to 128 characters.")
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), PASSWORD_ITERATIONS).hex()
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${salt}${digest}"


_DUMMY_HASH = password_hash("dummy password used for timing only")


def password_matches(password, encoded):
    if not isinstance(password, str) or len(password) > 128:
        return False
    has_password = isinstance(encoded, str) and encoded.startswith("pbkdf2_sha256$")
    try:
        algorithm, iterations, salt, expected = (encoded if has_password else _DUMMY_HASH).split("$")
        if algorithm != "pbkdf2_sha256" or not 600_000 <= int(iterations) <= 2_000_000:
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations)).hex()
        return hmac.compare_digest(actual, expected) and has_password
    except (ValueError, TypeError):
        return False


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def csrf_token(token):
    return hmac.new(token.encode(), b"data-genie-csrf-v1", hashlib.sha256).hexdigest()


def public_user(row):
    user = {key: row[key] for key in ("account_id", "first_name", "last_name", "email", "created_at")}
    user["password_enabled"] = bool(row["password_hash"] and row["password_hash"].startswith("pbkdf2_sha256$"))
    user["microsoft_linked"] = bool(row["microsoft_linked"]) if "microsoft_linked" in row.keys() else False
    user["google_linked"] = bool(row["google_linked"]) if "google_linked" in row.keys() else False
    user["profile_photo"] = row["profile_photo"] if "profile_photo" in row.keys() else None
    user["walkthrough_pending"] = bool(row["walkthrough_pending"])
    return user


def _microsoft_key(identity):
    """Check the shape of an identity already validated by the OIDC layer."""
    if not isinstance(identity, dict):
        raise MicrosoftAccountError("invalid_identity")
    issuer, subject = identity.get("issuer"), identity.get("subject")
    if (not isinstance(issuer, str) or not issuer.startswith("https://") or len(issuer) > 512
            or not isinstance(subject, str) or not 1 <= len(subject) <= 255
            or any(ord(char) < 33 for char in issuer + subject)):
        raise MicrosoftAccountError("invalid_identity")
    return issuer, subject


def _microsoft_profile(identity):
    email = identity.get("email")
    email = email.strip().lower() if isinstance(email, str) else ""
    if len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise MicrosoftAccountError("profile_required")
    # A Microsoft profile can have one name. Do not invent a family name or use
    # an email address as an identity key; these fields are display metadata.
    names = []
    for key in ("first_name", "last_name"):
        value = identity.get(key)
        value = value.strip() if isinstance(value, str) else ""
        names.append(value[:100])
    if not any(names):
        names[0] = "Microsoft user"
    return *names, email


def _google_key(identity):
    """Check the shape of an identity already validated by the OIDC layer."""
    if not isinstance(identity, dict):
        raise GoogleAccountError("invalid_identity")
    issuer, subject = identity.get("issuer"), identity.get("subject")
    if (not isinstance(issuer, str) or not issuer.startswith("https://") or len(issuer) > 512
            or not isinstance(subject, str) or not 1 <= len(subject) <= 255
            or any(ord(char) < 33 for char in issuer + subject)):
        raise GoogleAccountError("invalid_identity")
    if issuer != "https://accounts.google.com":
        raise GoogleAccountError("invalid_identity")
    return issuer, subject


def _google_profile(identity):
    if identity.get("email_verified") is not True or identity.get("email_authoritative") is not True:
        raise GoogleAccountError("profile_required")
    email = identity.get("email")
    email = email.strip().lower() if isinstance(email, str) else ""
    if len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise GoogleAccountError("profile_required")
    # A Google profile can have one name. Do not invent a family name or use
    # an email address as an identity key; these fields are display metadata.
    names = []
    for key in ("first_name", "last_name"):
        value = identity.get(key)
        value = value.strip() if isinstance(value, str) else ""
        names.append(value[:100])
    if not any(names):
        names[0] = "Google user"
    return *names, email


class Accounts:
    def __init__(self, repository):
        self.repository = repository

    @staticmethod
    def _account(connection, field, value):
        # field is selected internally; values are always bound parameters.
        if field not in ("account_id", "email"):
            raise ValueError("Unknown account field.")
        return connection.execute(f"""SELECT a.*,
            EXISTS(SELECT 1 FROM external_identities e
                   WHERE e.account_id=a.account_id AND e.provider='microsoft') AS microsoft_linked,
            EXISTS(SELECT 1 FROM google_identities g WHERE g.account_id=a.account_id) AS google_linked
            FROM accounts a WHERE a.{field}=?""", (value,)).fetchone()

    @staticmethod
    def _create_account(connection, first_name, last_name, email, encoded_password):
        return connection.execute("""INSERT INTO accounts
            (first_name,last_name,email,password_hash,created_at,walkthrough_pending) VALUES(?,?,?,?,?,1)""",
            (first_name, last_name, email, encoded_password, int(time.time()))).lastrowid

    def _reserve_attempt(self, client, action, email=None):
        """Commit admission before hashing, including invalid/duplicate requests.

        BEGIN IMMEDIATE serializes admission across local threads/processes. The
        hosted repository is additionally serialized and persisted by cloud_state.
        An IP budget is never cleared by successful authentication.
        """
        now = int(time.time())
        ip_key = token_hash(action + ":ip:" + client)
        limit = MAX_REGISTER_IP_ATTEMPTS if action == "register" else MAX_LOGIN_IP_ATTEMPTS
        retry_after = 0
        with self.repository._connection(write=True) as connection:
            # Agent/email delivery budgets can span a full day; authentication
            # housekeeping must not erase them at the 15-minute boundary.
            connection.execute("DELETE FROM auth_rate_limits WHERE started_at<=? AND bucket_key NOT LIKE 'agent:%'", (now - ATTEMPT_WINDOW,))
            connection.execute("DELETE FROM login_attempts WHERE started_at<=?", (now - ATTEMPT_WINDOW,))
            row = connection.execute("SELECT * FROM auth_rate_limits WHERE bucket_key=?", (ip_key,)).fetchone()
            if row and row["attempts"] >= limit:
                retry_after = row["started_at"] + ATTEMPT_WINDOW - now
            else:
                connection.execute("""INSERT INTO auth_rate_limits(bucket_key,started_at,attempts) VALUES(?,?,1)
                    ON CONFLICT(bucket_key) DO UPDATE SET attempts=attempts+1""", (ip_key, now))
                if action == "login" and email is not None:
                    # Keep the existing hash so already-persisted lockouts remain effective.
                    keys = (token_hash(client + ":" + email), token_hash("account:" + email))
                    for key in keys:
                        attempt = connection.execute("SELECT * FROM login_attempts WHERE attempt_key=?", (key,)).fetchone()
                        if attempt and attempt["failures"] >= MAX_ATTEMPTS:
                            retry_after = max(retry_after, attempt["started_at"] + ATTEMPT_WINDOW - now)
                    if not retry_after:
                        for key in keys:
                            connection.execute("""INSERT INTO login_attempts(attempt_key,started_at,failures) VALUES(?,?,1)
                                ON CONFLICT(attempt_key) DO UPDATE SET failures=failures+1""", (key, now))
        # Raise after committing: pair-denied requests still consume their IP budget.
        if retry_after:
            raise TooManyAttempts(retry_after)

    def register(self, first_name, last_name, email, password, client="local"):
        self._reserve_attempt(client, "register")
        names = [str(value or "").strip() for value in (first_name, last_name)]
        from .email_policy import registration_email
        email = registration_email(email)
        if any(not name or len(name) > 100 for name in names):
            raise ValueError("Provide your first and last name, up to 100 characters each.")
        encoded = password_hash(password)
        with self.repository._connection(write=True) as connection:
            if connection.execute("SELECT 1 FROM accounts WHERE email=?", (email,)).fetchone():
                raise ValueError("Unable to create an account with these details. Try logging in or use different details.")
            account_id = self._create_account(connection, *names, email, encoded)
            account = self._account(connection, "account_id", account_id)
            return public_user(account)

    def login(self, email, password, client="local"):
        email = str(email or "").strip().lower()[:254]
        attempt_key = token_hash(client + ":" + email)
        self._reserve_attempt(client, "login", email)
        with self.repository._connection() as connection:
            account = self._account(connection, "email", email)
        valid = password_matches(password, account["password_hash"] if account else None)
        if valid:
            with self.repository._connection(write=True) as connection:
                connection.execute("DELETE FROM login_attempts WHERE attempt_key IN (?,?)", (attempt_key, token_hash("account:" + email)))
        if not valid:
            raise LoginRequired("Email or password is incorrect.")
        return public_user(account)

    def microsoft_login(self, identity, client="local"):
        """Resolve a verified issuer/subject, never an email, to an app account."""
        issuer, subject = _microsoft_key(identity)
        with self.repository._connection() as connection:
            known = connection.execute("""SELECT account_id FROM external_identities
                WHERE provider='microsoft' AND issuer=? AND subject=?""", (issuer, subject)).fetchone()
        if not known:
            # New SSO accounts share registration's per-IP budget. Reserve it
            # outside the write transaction to avoid nesting SQLite writers.
            self._reserve_attempt(client, "register")
        with self.repository._connection(write=True) as connection:
            # Recheck under the write lock: concurrent callbacks must converge.
            known = connection.execute("""SELECT account_id FROM external_identities
                WHERE provider='microsoft' AND issuer=? AND subject=?""", (issuer, subject)).fetchone()
            if known:
                return public_user(self._account(connection, "account_id", known["account_id"]))
            first_name, last_name, email = _microsoft_profile(identity)
            from .email_policy import registration_email
            try:
                registration_email(email)
            except ValueError:
                raise MicrosoftAccountError("email_not_allowed") from None
            if self._account(connection, "email", email):
                raise MicrosoftAccountError("account_exists")
            account_id = self._create_account(connection, first_name, last_name, email, MICROSOFT_PASSWORD_SENTINEL)
            connection.execute("""INSERT INTO external_identities
                (provider,issuer,subject,account_id,created_at) VALUES('microsoft',?,?,?,?)""",
                (issuer, subject, account_id, int(time.time())))
            return public_user(self._account(connection, "account_id", account_id))

    def link_microsoft(self, account_id, identity):
        """Attach a verified identity after the caller reauthenticates locally."""
        issuer, subject = _microsoft_key(identity)
        with self.repository._connection(write=True) as connection:
            account = self._account(connection, "account_id", account_id)
            if account is None:
                raise LoginRequired("Log in to continue.")
            existing = connection.execute("""SELECT account_id FROM external_identities
                WHERE provider='microsoft' AND issuer=? AND subject=?""", (issuer, subject)).fetchone()
            if existing:
                if existing["account_id"] != account_id:
                    raise MicrosoftAccountError("identity_in_use")
                return public_user(account)
            if account["microsoft_linked"]:
                raise MicrosoftAccountError("already_linked")
            connection.execute("""INSERT INTO external_identities
                (provider,issuer,subject,account_id,created_at) VALUES('microsoft',?,?,?,?)""",
                (issuer, subject, account_id, int(time.time())))
            return public_user(self._account(connection, "account_id", account_id))

    def google_login(self, identity, client="local"):
        """Resolve a verified issuer/subject, never an email, to an app account."""
        issuer, subject = _google_key(identity)
        with self.repository._connection() as connection:
            known = connection.execute("""SELECT account_id FROM google_identities
                WHERE provider='google' AND issuer=? AND subject=?""", (issuer, subject)).fetchone()
        if not known:
            # New SSO accounts share registration's per-IP budget. Reserve it
            # outside the write transaction to avoid nesting SQLite writers.
            self._reserve_attempt(client, "register")
        with self.repository._connection(write=True) as connection:
            # Recheck under the write lock: concurrent callbacks must converge.
            known = connection.execute("""SELECT account_id FROM google_identities
                WHERE provider='google' AND issuer=? AND subject=?""", (issuer, subject)).fetchone()
            if known:
                return public_user(self._account(connection, "account_id", known["account_id"]))
            first_name, last_name, email = _google_profile(identity)
            from .email_policy import registration_email
            try:
                registration_email(email)
            except ValueError:
                raise GoogleAccountError("email_not_allowed") from None
            if self._account(connection, "email", email):
                raise GoogleAccountError("account_exists")
            account_id = self._create_account(connection, first_name, last_name, email, GOOGLE_PASSWORD_SENTINEL)
            connection.execute("""INSERT INTO google_identities
                (provider,issuer,subject,account_id,created_at) VALUES('google',?,?,?,?)""",
                (issuer, subject, account_id, int(time.time())))
            return public_user(self._account(connection, "account_id", account_id))

    def link_google(self, account_id, identity):
        """Attach a verified identity after the caller reauthenticates locally."""
        issuer, subject = _google_key(identity)
        with self.repository._connection(write=True) as connection:
            account = self._account(connection, "account_id", account_id)
            if account is None:
                raise LoginRequired("Log in to continue.")
            existing = connection.execute("""SELECT account_id FROM google_identities
                WHERE provider='google' AND issuer=? AND subject=?""", (issuer, subject)).fetchone()
            if existing:
                if existing["account_id"] != account_id:
                    raise GoogleAccountError("identity_in_use")
                return public_user(account)
            if account["google_linked"]:
                raise GoogleAccountError("already_linked")
            connection.execute("""INSERT INTO google_identities
                (provider,issuer,subject,account_id,created_at) VALUES('google',?,?,?,?)""",
                (issuer, subject, account_id, int(time.time())))
            return public_user(self._account(connection, "account_id", account_id))

    def verify_password(self, account_id, password, client="local"):
        with self.repository._connection() as connection:
            account = self._account(connection, "account_id", account_id)
        email = account["email"] if account else f"account:{account_id}"
        self._reserve_attempt(client, "login", email)
        if not password_matches(password, account["password_hash"] if account else None):
            raise ValueError("Your current password is incorrect.")
        with self.repository._connection(write=True) as connection:
            connection.execute("DELETE FROM login_attempts WHERE attempt_key IN (?,?)", (token_hash(client + ":" + email), token_hash("account:" + email)))
        return public_user(account)

    def issue_login(self, account_id, previous_token=None):
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        with self.repository._connection(write=True) as connection:
            connection.execute("DELETE FROM browser_logins WHERE expires_at<=? OR last_seen<=?", (now, now - IDLE_LIFETIME))
            if previous_token:
                connection.execute("DELETE FROM browser_logins WHERE token_hash=?", (token_hash(previous_token),))
            connection.execute("INSERT INTO browser_logins(token_hash,account_id,created_at,last_seen,expires_at) VALUES(?,?,?,?,?)",
                               (token_hash(token), account_id, now, now, now + LOGIN_LIFETIME))
        return token

    def authenticate(self, token):
        if not isinstance(token, str) or not 32 <= len(token) <= 128:
            raise LoginRequired("Log in to continue.")
        now = int(time.time())
        with self.repository._connection(write=True) as connection:
            row = connection.execute("""SELECT a.*,b.created_at,b.expires_at,b.last_seen,
                EXISTS(SELECT 1 FROM external_identities e
                       WHERE e.account_id=a.account_id AND e.provider='microsoft') AS microsoft_linked,
            EXISTS(SELECT 1 FROM google_identities g WHERE g.account_id=a.account_id) AS google_linked
                FROM browser_logins b
                JOIN accounts a USING(account_id) WHERE b.token_hash=?""", (token_hash(token),)).fetchone()
            if not row or row["expires_at"] <= now or row["last_seen"] <= now - IDLE_LIFETIME:
                connection.execute("DELETE FROM browser_logins WHERE token_hash=?", (token_hash(token),))
                user = None
            else:
                connection.execute("UPDATE browser_logins SET last_seen=? WHERE token_hash=?", (now, token_hash(token)))
                user = public_user(row)
        if user is None:
            raise LoginRequired("Your login has expired. Log in again.")
        return user

    def logout(self, token):
        if token:
            with self.repository._connection(write=True) as connection:
                connection.execute("DELETE FROM browser_logins WHERE token_hash=?", (token_hash(token),))

    def change_password(self, account_id, current_password, new_password, client="local"):
        self.verify_password(account_id, current_password, client)
        encoded = password_hash(new_password)
        with self.repository._connection(write=True) as connection:
            connection.execute("UPDATE accounts SET password_hash=? WHERE account_id=?", (encoded, account_id))
            connection.execute("DELETE FROM browser_logins WHERE account_id=?", (account_id,))
            connection.execute("UPDATE agent_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE account_id=?", (int(time.time()), account_id))
            connection.execute("DELETE FROM password_resets WHERE account_id=?", (account_id,))

    def complete_walkthrough(self, account_id):
        with self.repository._connection(write=True) as connection:
            connection.execute("UPDATE accounts SET walkthrough_pending=0 WHERE account_id=? AND walkthrough_pending=1",
                               (account_id,))

    def update_profile(self, account_id, payload):
        from .profile import profile_photo
        names = [payload.get(key) for key in ("first_name", "last_name")]
        if any(not isinstance(name, str) for name in names):
            raise ValueError("Provide your first and last name, up to 100 characters each.")
        names = [name.strip() for name in names]
        if not names[0] or any(len(name) > 100 or any(ord(char) < 32 or ord(char) == 127 for char in name) for name in names):
            raise ValueError("Provide a first name and use up to 100 characters per name.")
        photo = profile_photo(payload["profile_photo"]) if "profile_photo" in payload else None
        with self.repository._connection(write=True) as connection:
            account = self._account(connection, "account_id", account_id)
            if not account:
                raise LoginRequired("Log in to continue.")
            if "profile_photo" not in payload:
                photo = account["profile_photo"]
            connection.execute("UPDATE accounts SET first_name=?,last_name=?,profile_photo=? WHERE account_id=?",
                               (*names, photo, account_id))
            connection.execute("UPDATE users SET first_name=?,last_name=? WHERE email=?", (*names, account["email"]))
            return public_user(self._account(connection, "account_id", account_id))
