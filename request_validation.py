"""Reject incomplete requests before attempting a translation."""

import re


class RequestClarification(ValueError):
    """The request needs more detail; no SQL should be prepared or run."""

    def __init__(self, message, suggestions=None, *, choices=None, intent=None, continues_task=None):
        super().__init__(message)
        self.choices = choices or []
        self.suggestions = suggestions or [choice["request"] for choice in self.choices]
        self.intent = str(intent)[:1500] if intent is not None else None
        self.continues_task = continues_task


INCOMPLETE_REQUEST = (
    'Describe what you want to see or change, for example "show all customers".'
)
STRUCTURE_SHORTCUTS = {"schema", "tables"}


def awaiting_answer(turns):
    if not turns:
        return False
    last = turns[-1]
    return bool(not last.get("commands") and (
        last.get("intent") or last.get("needs_clarification") or
        (last.get("clarification") and not last["clarification"].startswith("Gemini"))
    ))


def validate_request(text, has_context=False, allow_short_reply=False):
    words = re.findall(r"\w+", text, re.UNICODE)
    if text.lower().strip().removesuffix("?") in STRUCTURE_SHORTCUTS:
        return
    if allow_short_reply and (re.fullmatch(r"[+-]?\d+(?:\.\d+)?", text.strip()) or (len(words) == 1 and len(words[0]) >= 2 and words[0].isalpha())):
        return
    if has_context and len(words) == 1 and len(words[0]) >= 3 and words[0].isalpha():
        return
    if len(words) < 2 or not any(character.isalpha() for character in text):
        raise RequestClarification(INCOMPLETE_REQUEST)
