"""Optional fixture generator; importing this module does not modify files."""


def main():
    import sqlite3
    from pathlib import Path

    # Define the file path
    path = Path("testdb.sqlite")

    # Connect to SQLite (this will create the file)
    conn = sqlite3.connect(path)
    cur = conn.cursor()

    # Drop table if it already exists, then create 'testdb'
    cur.execute("DROP TABLE IF EXISTS testdb")
    cur.execute("""
        CREATE TABLE testdb (
            id INTEGER PRIMARY KEY,
            name TEXT,
            value REAL
        )
    """)

    # Insert sample rows
    cur.executemany(
        "INSERT INTO testdb (name, value) VALUES (?, ?)",
        [
            ("Apple", 10.5),
            ("Banana", 7.25),
            ("Orange", 12.0),
        ],
    )

    # Commit changes and close the connection
    conn.commit()
    conn.close()

    print(f"Successfully created database: {path.absolute()}")


if __name__ == "__main__":
    main()
