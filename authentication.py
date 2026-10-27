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
COOKIE_NAME = "data_genie_login"


class LoginRequired(PermissionError):
    pass


class TooManyAttempts(ValueError):
    pass


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

    def register(self, first_name, last_name, email, password):
        names = [str(value or "").strip() for value in (first_name, last_name)]
        email = str(email or "").strip().lower()
        if any(not name or len(name) > 100 for name in names):
            raise ValueError("Provide your first and last name, up to 100 characters each.")
        if len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise ValueError("Provide a valid email address.")
        encoded = password_hash(password)
        with self.repository._connection(write=True) as connection:
            if connection.execute("SELECT 1 FROM accounts WHERE email=?", (email,)).fetchone():
                raise ValueError("An account already uses that email. Log in instead.")
            cursor = connection.execute("INSERT INTO accounts(first_name,last_name,email,password_hash,created_at) VALUES(?,?,?,?,?)",
                                        (*names, email, encoded, int(time.time())))
            account = connection.execute("SELECT * FROM accounts WHERE account_id=?", (cursor.lastrowid,)).fetchone()
            return public_user(account)

    def login(self, email, password, client="local"):
        email = str(email or "").strip().lower()[:254]
        attempt_key = token_hash(client + ":" + email)
        now = int(time.time())
        with self.repository._connection() as connection:
            attempt = connection.execute("SELECT * FROM login_attempts WHERE attempt_key=?", (attempt_key,)).fetchone()
            account = connection.execute("SELECT * FROM accounts WHERE email=?", (email,)).fetchone()
        if attempt and attempt["started_at"] > now - ATTEMPT_WINDOW and attempt["failures"] >= MAX_ATTEMPTS:
            raise TooManyAttempts("Too many failed attempts. Try again in 15 minutes.")
        valid = password_matches(password, account["password_hash"] if account else None)
        with self.repository._connection(write=True) as connection:
            connection.execute("DELETE FROM login_attempts WHERE started_at<=?", (now - ATTEMPT_WINDOW,))
            if valid:
                connection.execute("DELETE FROM login_attempts WHERE attempt_key=?", (attempt_key,))
            else:
                connection.execute("""INSERT INTO login_attempts(attempt_key,started_at,failures) VALUES(?,?,1)
                    ON CONFLICT(attempt_key) DO UPDATE SET failures=failures+1""", (attempt_key, now))
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
