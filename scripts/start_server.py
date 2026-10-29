"""Start the app with its project environment when one is available."""

import os
from pathlib import Path
import sys


def main():
    root = Path(__file__).resolve().parent.parent
    project_python = root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    python = str(project_python) if project_python.is_file() else sys.executable
    os.execv(python, [python, "-B", str(root / "server.py"), *sys.argv[1:]])


if __name__ == "__main__":
    main()
