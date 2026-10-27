"""Reject incomplete requests before attempting a translation."""

import re


class RequestClarification(ValueError):
    """The request needs more detail; no SQL should be prepared or run."""

    def __init__(self, message, suggestions=None):
        super().__init__(message)
        self.suggestions = suggestions or []


INCOMPLETE_REQUEST = (
    'Describe what you want to see or change, for example "show all customers".'
)
STRUCTURE_SHORTCUTS = {"schema", "tables"}


def validate_request(text, has_context=False):
    words = re.findall(r"\w+", text, re.UNICODE)
    if text.lower().strip().removesuffix("?") in STRUCTURE_SHORTCUTS:
        return
    if has_context and len(words) == 1 and len(words[0]) >= 3 and words[0].isalpha():
        return
    if len(words) < 2 or not any(character.isalpha() for character in text):
        raise RequestClarification(INCOMPLETE_REQUEST)
