"""Bounded email verification: no account exists until a code is consumed."""
import hashlib
import hmac
import json
import re
import secrets
import time
from urllib.request import Request

from . import settings
from .authentication import Accounts, TooManyAttempts, password_hash, public_user, token_hash

LIFETIME = 300
MAX_ATTEMPTS = 3


def required():
    return bool(settings.public_url() or settings.value('GENIE_VERIFY_EMAIL') == 'true')


def send_code(email, code):
    key = settings.value('BREVO_API_KEY').strip()
    sender = settings.value('BREVO_SENDER_EMAIL', 'no-reply@data-genie.space').strip()
    if not key or key.startswith('@Microsoft.KeyVault('):
        raise ValueError('Email verification is temporarily unavailable. Please try again later.')
    payload = {'sender': {'name': 'Blueray Inc.', 'email': sender},
               'to': [{'email': email}], 'subject': 'Your Data Genie verification code',
               'textContent': f'Your Data Genie code is {code}. It expires in 5 minutes. You have 3 attempts. If you did not request this, ignore this email.'}
    request = Request('https://api.brevo.com/v3/smtp/email', data=json.dumps(payload).encode(),
                      headers={'api-key': key, 'Content-Type': 'application/json'}, method='POST')
    try:
        # Do not follow redirects with the service credential.
        from urllib.request import build_opener, HTTPRedirectHandler
        class NoRedirect(HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        with build_opener(NoRedirect).open(request, timeout=15) as response:
            if response.status != 201:
                raise ValueError('Unexpected email provider response.')
    except Exception:
        raise ValueError('Email verification is temporarily unavailable. Please try again later.') from None


def digest(challenge, code):
    return hmac.new(challenge.encode(), str(code).encode(), hashlib.sha256).hexdigest()


class SignupVerification:
    def __init__(self, repository):
        self.repository = repository
        self.accounts = Accounts(repository)

    def start(self, payload, client):
        self.accounts._reserve_attempt(client, 'register')
        names = [str(payload.get(key) or '').strip() for key in ('first_name', 'last_name')]
        email = str(payload.get('email') or '').strip().lower()
        if any(not name or len(name) > 100 for name in names):
            raise ValueError('Provide your first and last name, up to 100 characters each.')
        if len(email) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
            raise ValueError('Provide a valid email address.')
        self.accounts._reserve_attempt('signup-email:' + token_hash(email), 'register')
        encoded = password_hash(payload.get('password'))
        return self._issue(names, email, encoded)

    def _issue(self, names, email, encoded):
        now = int(time.time())
        challenge, code = secrets.token_urlsafe(32), f'{secrets.randbelow(1000000):06d}'
        with self.repository._connection(write=True) as connection:
            connection.execute('DELETE FROM signup_verifications WHERE expires_at<=?', (now,))
            previous = connection.execute('SELECT expires_at FROM signup_verifications WHERE email=?', (email,)).fetchone()
            if previous and previous['expires_at'] - LIFETIME + 60 > now:
                raise TooManyAttempts(previous['expires_at'] - LIFETIME + 60 - now)
            connection.execute('DELETE FROM signup_verifications WHERE email=?', (email,))
            connection.execute('INSERT INTO signup_verifications VALUES(?,?,?,?,?,?,?,0)',
                (token_hash(challenge), digest(challenge, code), *names, email, encoded, now + LIFETIME))
        try:
            from .agent_tokens import AgentTokens
            AgentTokens(self.repository).reserve('signup-email-delivery', 200, 86400)
            send_code(email, code)
        except Exception:
            with self.repository._connection(write=True) as connection:
                connection.execute('DELETE FROM signup_verifications WHERE challenge_hash=?', (token_hash(challenge),))
            raise
        return {'verification_required': True, 'challenge': challenge, 'expires_at': now + LIFETIME, 'email': email}

    def resend(self, payload, client):
        self.accounts._reserve_attempt(client, 'register')
        challenge = str(payload.get('challenge') or '')[:128]
        with self.repository._connection() as connection:
            row = connection.execute('SELECT * FROM signup_verifications WHERE challenge_hash=?', (token_hash(challenge),)).fetchone()
        if not row or row['expires_at'] <= time.time():
            raise ValueError('This signup expired. Start again to request a new code.')
        self.accounts._reserve_attempt('signup-email:' + token_hash(row['email']), 'register')
        return self._issue([row['first_name'], row['last_name']], row['email'], row['password_hash'])

    def verify(self, payload, client):
        self.accounts._reserve_attempt(client, 'login')
        challenge = str(payload.get('challenge') or '')[:128]
        code = str(payload.get('code') or '')[:20]
        user, error = None, 'This code is invalid or expired. Request a new code.'
        with self.repository._connection(write=True) as connection:
            connection.execute('DELETE FROM signup_verifications WHERE expires_at<=?', (int(time.time()),))
            row = connection.execute('SELECT * FROM signup_verifications WHERE challenge_hash=?', (token_hash(challenge),)).fetchone()
            if row and row['attempts'] < MAX_ATTEMPTS:
                if re.fullmatch(r'\d{6}', code) and hmac.compare_digest(row['code_hash'], digest(challenge, code)):
                    if not self.accounts._account(connection, 'email', row['email']):
                        cursor = connection.execute('INSERT INTO accounts(first_name,last_name,email,password_hash,created_at) VALUES(?,?,?,?,?)',
                            (row['first_name'], row['last_name'], row['email'], row['password_hash'], int(time.time())))
                        user = public_user(self.accounts._account(connection, 'account_id', cursor.lastrowid))
                    else:
                        error = 'Unable to create an account with these details. Try logging in.'
                    connection.execute('DELETE FROM signup_verifications WHERE challenge_hash=?', (token_hash(challenge),))
                else:
                    connection.execute('UPDATE signup_verifications SET attempts=attempts+1 WHERE challenge_hash=?', (token_hash(challenge),))
                    remaining = MAX_ATTEMPTS - row['attempts'] - 1
                    error = f'Incorrect code. {remaining} attempts remaining.' if remaining else 'Three incorrect attempts. Request a new code.'
        if not user:
            raise ValueError(error)
        return user
