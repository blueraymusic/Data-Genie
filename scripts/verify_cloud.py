"""Check HTTPS, frontend assets, and the durable backend after deployment."""
import json
import sys
import time
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit
from urllib.request import urlopen


class FrontendAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = {}

    def handle_starttag(self, tag, attributes):
        values = dict(attributes)
        if tag == "script" and values.get("src"):
            self.paths[values["src"]] = "script"
        if tag == "link" and set(values.get("rel", "").split()) & {"stylesheet", "modulepreload"} and values.get("href"):
            self.paths[values["href"]] = "stylesheet" if "stylesheet" in values["rel"].split() else "modulepreload"


def read_response(url, timeout, content_types):
    with urlopen(url, timeout=timeout) as response:
        final = urlsplit(response.geturl())
        expected = urlsplit(url)
        if final.scheme != "https" or final.netloc != expected.netloc or response.status != 200:
            raise ValueError("The deployed response did not use this application's HTTPS origin.")
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type not in content_types:
            raise ValueError("The deployed response has an unexpected content type.")
        body = response.read()
        if not body:
            raise ValueError("The deployed response is empty.")
        return body


def check_deployment(origin):
    html = read_response(origin + "/", 60, {"text/html"}).decode("utf-8")
    parser = FrontendAssets()
    parser.feed(html)
    assets = {(urljoin(origin + "/", path), kind) for path, kind in parser.paths.items()}
    kinds = set()
    for asset, kind in sorted(assets):
        parsed = urlsplit(asset)
        # Google Fonts is an optional, external stylesheet, not a deployed Vite
        # build asset. Do not fetch it or mistake it for the application's CSS.
        if (kind == "stylesheet" and parsed.scheme == "https"
                and parsed.netloc == "fonts.googleapis.com" and parsed.path in {"/css", "/css2"}):
            continue
        if parsed.scheme != "https" or parsed.netloc != urlsplit(origin).netloc or not parsed.path.startswith("/assets/"):
            raise ValueError("Frontend build assets must use this application's HTTPS origin.")
        if parsed.path.endswith(".js"):
            read_response(asset, 60, {"text/javascript", "application/javascript"})
            kinds.add("js")
        elif parsed.path.endswith(".css"):
            read_response(asset, 60, {"text/css"})
            kinds.add("css")
        else:
            raise ValueError("The frontend references an unexpected build asset.")
    if kinds != {"js", "css"}:
        raise ValueError("The frontend must include its JavaScript and stylesheet build assets.")
    health = json.loads(read_response(origin + "/healthz", 60, {"application/json"}))
    if not isinstance(health, dict) or health.get("status") != "ok":
        raise ValueError("The application's liveness check failed.")
    session = json.loads(read_response(origin + "/api/auth/session", 120, {"application/json"}))
    if not isinstance(session, dict) or session.get("user", "missing") is not None:
        raise ValueError("Unexpected anonymous session response.")


def main(origin):
    url = urlsplit(origin)
    if (url.scheme != "https" or not url.hostname or url.username or url.password
            or url.path not in {"", "/"} or url.query or url.fragment):
        raise SystemExit("Use the application's HTTPS origin.")
    origin = origin.rstrip("/")
    for attempt in range(12):
        try:
            check_deployment(origin)
            print("HTTPS frontend assets, liveness and cloud-backed session endpoint verified:", origin)
            return
        except Exception:
            if attempt == 11:
                raise SystemExit("Deployment verification failed. Check App Service logs and cloud storage availability.") from None
            time.sleep(10)


if __name__ == "__main__":
    main(sys.argv[1])
