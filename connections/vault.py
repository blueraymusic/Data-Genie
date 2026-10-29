"""Encrypt saved connection settings with a separate, owner-only local key."""

import json
import os
import threading
from pathlib import Path
from .errors import ConnectionFailure, missing_postgres_support


class CredentialVault:
    _lock = threading.RLock()
    def __init__(self, repository_path):
        self.key_path = Path(str(repository_path) + ".key")

    def _cipher(self, create=True):
        with self._lock:
            return self._open_cipher(create)

    def _open_cipher(self, create):
        try:
            from cryptography.fernet import Fernet
        except ImportError:
            raise missing_postgres_support() from None
        self.key_path.parent.mkdir(parents=True, exist_ok=True)
        if not create and not self.key_path.exists():
            raise ConnectionFailure("The saved connection key is missing. Restore it or enter the connection details again.",
                                    "connection_key_missing", "reconnect", 409)
        try:
            descriptor = os.open(self.key_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            if self.key_path.is_symlink() or not self.key_path.is_file():
                raise ConnectionFailure("The connection key must be a regular local file. Restore it or enter the connection details again.",
                                        "connection_key_invalid", "reconnect", 409)
        else:
            with os.fdopen(descriptor, "wb") as target:
                target.write(Fernet.generate_key())
        self.key_path.chmod(0o600)
        try:
            return Fernet(self.key_path.read_bytes())
        except (ValueError, OSError):
            raise ConnectionFailure("The saved connection key could not be opened. Restore it or enter the connection details again.",
                                    "connection_key_invalid", "reconnect", 409) from None

    def encrypt(self, config):
        return self._cipher().encrypt(json.dumps(config).encode()).decode()

    def decrypt(self, encrypted):
        try:
            return json.loads(self._cipher(create=False).decrypt(encrypted.encode()))
        except ValueError:
            raise
        except Exception:
            raise ConnectionFailure("This saved connection could not be unlocked. Enter the connection details again.",
                                    "connection_locked", "reconnect", 409) from None
