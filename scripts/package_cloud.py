"""Build an allowlisted deployment bundle; never package local user data."""
import argparse
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
MODULES = (
    "authentication.py", "cloud_state.py", "conversation.py", "database_files.py",
    "gemini_provider.py", "keywords.py", "repository.py", "request_context.py",
    "request_validation.py", "server.py", "settings.py", "sql_tools.py", "workbench.py",
    "wsgi.py", "gunicorn.conf.py", "requirements-cloud.txt", "requirements-postgres.txt",
    "static/design.css", "static/favicon.svg",
)


def package(destination, root=ROOT):
    if not (root / "dist/index.html").is_file():
        raise SystemExit("Build the frontend first: npm run build")
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in MODULES:
            archive.write(root / name, name)
        for directory in ("connections", "dist"):
            for path in sorted((root / directory).rglob("*")):
                if not path.is_file() or path.is_symlink():
                    continue
                if directory == "connections" and (path.suffix != ".py" or "__pycache__" in path.parts):
                    continue
                archive.write(path, path.relative_to(root).as_posix())
        archive.writestr("requirements.txt", "-r requirements-cloud.txt\n-r requirements-postgres.txt\n")
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    package(parser.parse_args().output)
