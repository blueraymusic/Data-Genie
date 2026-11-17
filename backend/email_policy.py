"""Registration email policy; mailbox verification proves access to an address."""
import re

from . import settings


# Keep normal personal, business and education mail providers available. Hosts
# can extend this list or explicitly restrict registration to their own domains.
DISPOSABLE_DOMAINS = frozenset({
    '10minutemail.com', '10minutemail.net', 'aiqseo.com', 'dispostable.com',
    'guerrillamail.com', 'guerrillamail.net', 'guerrillamailblock.com',
    'mailinator.com', 'maildrop.cc', 'sharklasers.com', 'temp-mail.org',
    'tempmail.com', 'throwawaymail.com', 'yopmail.com', 'yopmail.fr',
})


def _domains(name):
    return {part.strip().lower().rstrip('.') for part in settings.value(name).split(',') if part.strip()}


def registration_email(value):
    email = str(value or '').strip().lower()
    if len(email) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
        raise ValueError('Provide a valid email address.')
    local, domain = email.rsplit('@', 1)
    # Reject malformed aliases and host spellings before sending a code. In
    # particular, a trailing dot must not create a second spelling of an account.
    if (len(local) > 64 or local.startswith('.') or local.endswith('.') or '..' in local
            or not re.fullmatch(r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+", local)):
        raise ValueError('Provide a valid email address.')
    try:
        domain = domain.encode('idna').decode('ascii')
    except UnicodeError:
        raise ValueError('Provide a valid email address.') from None
    if (len(domain) > 253 or not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label)
                                      for label in domain.split('.'))):
        raise ValueError('Provide a valid email address.')
    blocked = DISPOSABLE_DOMAINS | _domains('GENIE_BLOCKED_EMAIL_DOMAINS')
    if any(domain == item or domain.endswith('.' + item) for item in blocked):
        raise ValueError('Temporary email addresses are not supported. Use your personal, work, or school email.')
    allowed = _domains('GENIE_ALLOWED_EMAIL_DOMAINS')
    if allowed and domain not in allowed:
        raise ValueError('Use an email address from an approved organization.')
    return email
