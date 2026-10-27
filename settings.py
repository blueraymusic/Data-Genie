"""Local, non-secret configuration for optional Data Genie integrations."""

from pathlib import Path
import os


ROOT = Path(__file__).resolve().parent
ENV_PATH = ROOT / ".env"
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"


def _local_values():
    """Read simple KEY=VALUE entries without exporting or logging secrets."""
    if not ENV_PATH.is_file():
        return {}
    values = {}
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key and key.replace("_", "").isalnum():
            values[key] = value.strip().strip('"').strip("'")
    return values


def value(name, default=""):
    """Environment variables take priority, so deployments do not need .env files."""
    return os.environ.get(name) or _local_values().get(name, default)


def gemini_settings():
    return {
        "api_key": value("GEMINI_API_KEY").strip(),
        "model": value("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL,
    }


def public_ai_settings():
    config = gemini_settings()
    return {
        "enabled": bool(config["api_key"]),
        "provider": "Gemini" if config["api_key"] else None,
        "model": config["model"] if config["api_key"] else None,
    }
