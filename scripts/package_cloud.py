"""Build an allowlisted deployment bundle; never package local user data."""
import argparse
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
FILES = (
    "azure/gunicorn.conf.py", "azure/requirements.txt", "backend/requirements-postgres.txt",
    "frontend/src/styles/design.css", "frontend/public/favicon.svg",
)


def package(destination, root=ROOT):
    if not (root / "frontend/dist/index.html").is_file():
        raise SystemExit("Build the frontend first: npm run build")
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in FILES:
            archive.write(root / name, name)
        for directory in ("backend", "frontend/dist"):
            for path in sorted((root / directory).rglob("*")):
                if not path.is_file() or path.is_symlink():
                    continue
                if directory == "backend" and (path.suffix != ".py" or "__pycache__" in path.parts):
                    continue
                archive.write(path, path.relative_to(root).as_posix())
        archive.writestr("requirements.txt", "-r azure/requirements.txt\n-r backend/requirements-postgres.txt\n")
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    package(parser.parse_args().output)
