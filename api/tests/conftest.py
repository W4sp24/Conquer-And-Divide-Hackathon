import os
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "test.db"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_tmp.as_posix()}"
os.environ["SELLER_KEY"] = "test-key"
os.environ["OPENROUTER_API_KEY"] = ""
os.environ["SERVE_WEB"] = "false"
os.environ["EXPIRY_INTERVAL_S"] = "0.2"
