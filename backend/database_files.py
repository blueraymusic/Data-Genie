"""Create independent SQLite data files without overwriting existing databases."""

from contextlib import closing
from pathlib import Path
import sqlite3


def database_filename(name):
    """Browser-created databases accept a display name, never a server path."""
    name = str(name or "my_database.sqlite3").strip()
    if not name or len(name) > 150 or any(character in name for character in ("/", "\\", "\x00", "\r", "\n")):
        raise ValueError("Use a database filename without folders, up to 150 characters.")
    if name in {".", ".."}:
        raise ValueError("Choose a database filename.")
    if Path(name).suffix.lower() not in {".db", ".sqlite", ".sqlite3"}:
        name += ".sqlite3"
    return name


def create_database_file(path, starter=True):
    """Materialize an empty SQLite header, optionally adding an editable example."""
    path = Path(path).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("xb"):
            pass
    except FileExistsError as exc:
        raise ValueError("That file already exists. Attach it instead, or choose a new filename.") from exc
    try:
        with closing(sqlite3.connect(path)) as connection:
            connection.execute("PRAGMA foreign_keys=ON")
            # Opening and closing an unused SQLite connection leaves a zero-byte
            # file. VACUUM creates a usable SQLite file even without any tables.
            connection.execute("VACUUM")
            if starter:
                connection.executescript("""
                    CREATE TABLE notes (
                        id INTEGER PRIMARY KEY,
                        title TEXT NOT NULL,
                        body TEXT NOT NULL DEFAULT '',
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );
                    INSERT INTO notes(title,body) VALUES (
                        'Welcome to your database',
                        'This is an editable starter note. Add your own notes or delete this one.'
                    );
                """)
            connection.commit()
        return path
    except Exception:
        path.unlink(missing_ok=True)
        raise
