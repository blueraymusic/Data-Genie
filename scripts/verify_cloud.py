"""Check HTTPS, frontend assets, and the durable backend after deployment."""
import json
import sys
import time
from urllib.parse import urlsplit
from urllib.request import urlopen


def main(origin):
    url = urlsplit(origin)
    if url.scheme != "https" or not url.hostname or url.path or url.query or url.fragment:
        raise SystemExit("Use the application's HTTPS origin.")
    for attempt in range(12):
        try:
            with urlopen(origin + "/", timeout=60) as response:
                if b"/assets/" not in response.read():
                    raise ValueError("Frontend build is missing.")
            with urlopen(origin + "/api/auth/session", timeout=120) as response:
                if json.load(response).get("user", "missing") is not None:
                    raise ValueError("Unexpected anonymous session response.")
            print("HTTPS frontend and cloud-backed session endpoint verified:", origin)
            return
        except Exception:
            if attempt == 11:
                raise SystemExit("Deployment verification failed. Check App Service logs and free SQL availability.") from None
            time.sleep(10)


if __name__ == "__main__":
    main(sys.argv[1])
