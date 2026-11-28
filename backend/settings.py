"""Local, non-secret configuration for optional Data Genie integrations."""

from pathlib import Path
import os
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
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
    return os.environ[name] if name in os.environ else _local_values().get(name, default)


def gemini_settings():
    return {
        "api_key": value("GEMINI_API_KEY").strip(),
        "model": value("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL,
    }


def public_ai_settings():
    config = gemini_settings()
    return {
        "enabled": bool(config["api_key"]),
        "provider": "Data Genie AI" if config["api_key"] else None,
        "model": config["model"] if config["api_key"] else None,
    }


def public_url():
    """An explicit HTTPS origin enables hosted operation; local stays local."""
    raw = value("GENIE_PUBLIC_URL").strip().rstrip("/")
    if not raw and value("GENIE_CLOUD_STATE") == "azure_sql":
        hostname = os.environ.get("WEBSITE_HOSTNAME", "").strip()
        if hostname.endswith(".azurewebsites.net") and "/" not in hostname and ":" not in hostname:
            raw = "https://" + hostname
    if not raw:
        return ""
    parsed = urlsplit(raw)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.path or parsed.query or parsed.fragment):
        raise ValueError("GENIE_PUBLIC_URL must be an HTTPS origin without a path.")
    return raw


def data_directory():
    return Path(value("GENIE_DATA_DIR").strip() or str(ROOT / "db")).expanduser().resolve()
