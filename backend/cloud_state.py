"""Durable, bounded SQLite snapshots for the free Azure development deployment.

SQLite executes on local scratch disk, never an App Service network mount.
An Azure SQL transaction locks the application state while a request runs and
commits its snapshot before an HTTP response is released. This deliberately
serializes requests: it is a small-project adapter, not a scale-out database.
"""
from contextlib import contextmanager
from io import BytesIO
from pathlib import PurePosixPath
from pathlib import Path
import hashlib
import shutil
import threading
import tempfile
import zipfile

from . import settings


class StateUnavailable(RuntimeError):
    pass


class StateLimit(StateUnavailable):
    pass


MAX_STATE_BYTES = 64 * 1024 * 1024
MAX_STATE_FILES = 256
_lock = threading.RLock()
_version = None
_store_identity = None


def scratch_root(root):
    """Never clear a checkout or an existing user database directory."""
    if root.is_symlink():
        raise StateUnavailable("Cloud scratch storage cannot be a symbolic link.")
    root = root.resolve()
    roots = {Path("/tmp").resolve(), Path(tempfile.gettempdir()).resolve()}
    if root.name != "data-genie" or root.is_symlink() or not any(parent in root.parents for parent in roots):
        raise StateUnavailable("Use a dedicated temporary data-genie directory for cloud scratch storage.")
    if settings.ROOT == root or settings.ROOT in root.parents or root in settings.ROOT.parents:
        raise StateUnavailable("Cloud scratch storage must be outside the project.")
    marker = root / ".cloud-scratch"
    if root.exists() and any(root.iterdir()) and not marker.is_file():
        raise StateUnavailable("Refusing to overwrite an unmarked data directory.")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    marker.touch(mode=0o600, exist_ok=True)


def snapshot(root):
    """Bound both the expanded and encoded data, including repository history."""
    scratch_root(root)
    files = sorted(path for path in root.rglob("*") if path.is_file())
    if len(files) > MAX_STATE_FILES or any(path.is_symlink() for path in root.rglob("*")):
        raise StateLimit("The free workspace file limit has been reached.")
    if sum(path.stat().st_size for path in files) > MAX_STATE_BYTES:
        raise StateLimit("The free workspace storage limit has been reached. Download data before adding more.")
    output = BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
        for path in files:
            archive.write(path, path.relative_to(root).as_posix())
    result = output.getvalue()
    if len(result) > MAX_STATE_BYTES:
        raise StateLimit("The free workspace storage limit has been reached.")
    return result


def restore(root, payload):
    """Validate the entire archive before replacing any scratch files."""
    scratch_root(root)
    entries = []
    if payload:
        if len(payload) > MAX_STATE_BYTES:
            raise StateUnavailable("The stored workspace exceeds its supported size.")
        with zipfile.ZipFile(BytesIO(payload)) as archive:
            members = archive.infolist()
            if len(members) > MAX_STATE_FILES or sum(item.file_size for item in members) > MAX_STATE_BYTES:
                raise StateUnavailable("The stored workspace exceeds its supported size.")
            for item in members:
                path = PurePosixPath(item.filename)
                if (path.is_absolute() or ".." in path.parts or "\\" in item.filename
                        or not path.parts or item.is_dir() or (item.external_attr >> 16) & 0o170000 == 0o120000):
                    raise StateUnavailable("The stored workspace contains an invalid path.")
                entries.append((path, archive.read(item)))
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    for child in root.iterdir():
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child)
        else:
            child.unlink()
    for relative, content in entries:
        destination = root.joinpath(*relative.parts)
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        destination.write_bytes(content)
        destination.chmod(0o600)
    (root / ".cloud-scratch").touch(mode=0o600, exist_ok=True)
    from . import workbench
    workbench._repositories.clear()


def connect():
    import certifi
    import pytds
    from .cloud_tls import install_hostname_verifier
    host = settings.value("GENIE_SQL_HOST").strip()
    if not host.endswith(".database.windows.net") or "/" in host or ":" in host:
        raise StateUnavailable("Configure the Azure SQL server hostname.")
    install_hostname_verifier()
    return pytds.connect(
        server=host, database=settings.value("GENIE_SQL_DATABASE"),
        user=settings.value("GENIE_SQL_USER"), password=settings.value("GENIE_SQL_PASSWORD"),
        cafile=certifi.where(), validate_host=True, enc_login_only=False,
        login_timeout=60, timeout=180, autocommit=False,
    )


@contextmanager
def transaction():
    """Keep the acknowledged state durable, or fail without silently going ephemeral."""
    global _version, _store_identity
    root = settings.data_directory()
    if not settings.value("GENIE_DATA_DIR") or root == settings.ROOT / "db" or root.is_symlink():
        raise StateUnavailable("Cloud scratch storage must be separate from local user data.")
    if not settings.public_url() or not settings.value("GENIE_CONNECTION_KEY"):
        raise StateUnavailable("Cloud HTTPS origin and encryption key must be configured.")
    identity = (str(root), settings.value("GENIE_SQL_HOST"), settings.value("GENIE_SQL_DATABASE"))
    with _lock:
        connection = None
        previous = None
        changed = False
        try:
            connection = connect()
            cursor = connection.cursor()
            cursor.execute("IF OBJECT_ID(N'dbo.data_genie_state', N'U') IS NULL "
                           "CREATE TABLE dbo.data_genie_state (id int NOT NULL PRIMARY KEY CHECK(id=1), "
                           "revision bigint NOT NULL, payload varbinary(max) NULL)")
            cursor.execute("SELECT revision,payload FROM dbo.data_genie_state WITH (UPDLOCK,HOLDLOCK) WHERE id=1")
            row = cursor.fetchone()
            revision, previous = (row[0], bytes(row[1]) if row[1] is not None else None) if row else (0, None)
            if row is None:
                cursor.execute("INSERT INTO dbo.data_genie_state(id,revision,payload) VALUES(1,0,NULL)")
            if _version != revision or _store_identity != identity:
                restore(root, previous)
                _version, _store_identity = revision, identity
            # Compare file contents rather than ZIP timestamps.
            before = fingerprint(root)
            yield
            current = snapshot(root)
            changed = before != fingerprint(root)
            if changed:
                cursor.execute("UPDATE dbo.data_genie_state SET revision=revision+1,payload=%s WHERE id=1", (current,))
            connection.commit()
            _version = revision + int(changed)
        except StateUnavailable:
            if previous is not None or connection is not None:
                restore(root, previous)
            _version = None
            if connection is not None:
                connection.rollback()
            raise
        except Exception:
            _version = None
            if connection is not None:
                try:
                    connection.rollback()
                except Exception:
                    pass
                # Discard scratch state. A fresh transaction reloads the committed
                # revision, including the case where commit acknowledgement was lost.
                restore(root, previous)
            raise StateUnavailable("Cloud storage is unavailable or its free allowance is paused. "
                                   "Check History before retrying a change.") from None
        finally:
            if connection is not None:
                connection.close()


def fingerprint(root):
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.digest()
