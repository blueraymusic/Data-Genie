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
MAX_ATTEMPTS = 5
MAX_LOGIN_IP_ATTEMPTS = 30
MAX_REGISTER_IP_ATTEMPTS = 5
COOKIE_NAME = "data_genie_login"


class LoginRequired(PermissionError):
    pass


class TooManyAttempts(ValueError):
    def __init__(self, retry_after):
        self.retry_after = max(1, int(retry_after))
        super().__init__("Too many account attempts. Try again in a few minutes.")


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
    try:
        algorithm, iterations, salt, expected = (encoded or _DUMMY_HASH).split("$")
        if algorithm != "pbkdf2_sha256" or not 600_000 <= int(iterations) <= 2_000_000:
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations)).hex()
        return hmac.compare_digest(actual, expected) and encoded is not None
    except (ValueError, TypeError):
        return False


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def csrf_token(token):
    return hmac.new(token.encode(), b"data-genie-csrf-v1", hashlib.sha256).hexdigest()


def public_user(row):
    return {key: row[key] for key in ("account_id", "first_name", "last_name", "email")}


class Accounts:
    def __init__(self, repository):
        self.repository = repository

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
            connection.execute("DELETE FROM auth_rate_limits WHERE started_at<=?", (now - ATTEMPT_WINDOW,))
            connection.execute("DELETE FROM login_attempts WHERE started_at<=?", (now - ATTEMPT_WINDOW,))
            row = connection.execute("SELECT * FROM auth_rate_limits WHERE bucket_key=?", (ip_key,)).fetchone()
            if row and row["attempts"] >= limit:
                retry_after = row["started_at"] + ATTEMPT_WINDOW - now
            else:
                connection.execute("""INSERT INTO auth_rate_limits(bucket_key,started_at,attempts) VALUES(?,?,1)
                    ON CONFLICT(bucket_key) DO UPDATE SET attempts=attempts+1""", (ip_key, now))
                if action == "login" and email is not None:
                    # Keep the existing hash so already-persisted lockouts remain effective.
                    pair_key = token_hash(client + ":" + email)
                    pair = connection.execute("SELECT * FROM login_attempts WHERE attempt_key=?", (pair_key,)).fetchone()
                    if pair and pair["failures"] >= MAX_ATTEMPTS:
                        retry_after = pair["started_at"] + ATTEMPT_WINDOW - now
                    else:
                        connection.execute("""INSERT INTO login_attempts(attempt_key,started_at,failures) VALUES(?,?,1)
                            ON CONFLICT(attempt_key) DO UPDATE SET failures=failures+1""", (pair_key, now))
        # Raise after committing: pair-denied requests still consume their IP budget.
        if retry_after:
            raise TooManyAttempts(retry_after)

    def register(self, first_name, last_name, email, password, client="local"):
        self._reserve_attempt(client, "register")
        names = [str(value or "").strip() for value in (first_name, last_name)]
        email = str(email or "").strip().lower()
        if any(not name or len(name) > 100 for name in names):
            raise ValueError("Provide your first and last name, up to 100 characters each.")
        if len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise ValueError("Provide a valid email address.")
        encoded = password_hash(password)
        with self.repository._connection(write=True) as connection:
            if connection.execute("SELECT 1 FROM accounts WHERE email=?", (email,)).fetchone():
                raise ValueError("Unable to create an account with these details. Try logging in or use different details.")
            cursor = connection.execute("INSERT INTO accounts(first_name,last_name,email,password_hash,created_at) VALUES(?,?,?,?,?)",
                                        (*names, email, encoded, int(time.time())))
            account = connection.execute("SELECT * FROM accounts WHERE account_id=?", (cursor.lastrowid,)).fetchone()
            return public_user(account)

    def login(self, email, password, client="local"):
        email = str(email or "").strip().lower()[:254]
        attempt_key = token_hash(client + ":" + email)
        self._reserve_attempt(client, "login", email)
        with self.repository._connection() as connection:
            account = connection.execute("SELECT * FROM accounts WHERE email=?", (email,)).fetchone()
        valid = password_matches(password, account["password_hash"] if account else None)
        if valid:
            with self.repository._connection(write=True) as connection:
                connection.execute("DELETE FROM login_attempts WHERE attempt_key=?", (attempt_key,))
        if not valid:
            raise LoginRequired("Email or password is incorrect.")
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
            row = connection.execute("""SELECT a.*,b.created_at,b.expires_at,b.last_seen FROM browser_logins b
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

    def change_password(self, account_id, current_password, new_password):
        with self.repository._connection() as connection:
            row = connection.execute("SELECT password_hash FROM accounts WHERE account_id=?", (account_id,)).fetchone()
        if not row or not password_matches(current_password, row[0]):
            raise ValueError("Your current password is incorrect.")
        encoded = password_hash(new_password)
        with self.repository._connection(write=True) as connection:
            connection.execute("UPDATE accounts SET password_hash=? WHERE account_id=?", (encoded, account_id))
            connection.execute("DELETE FROM browser_logins WHERE account_id=?", (account_id,))
