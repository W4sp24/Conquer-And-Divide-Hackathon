"""Environment settings. Every value can be set in api/.env or the host's env vars."""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

API_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=API_DIR / ".env", extra="ignore")

    # SQLite by default so the demo runs with zero setup. For Supabase/Postgres use
    # postgresql+asyncpg://user:pass@host:port/db
    database_url: str = f"sqlite+aiosqlite:///{(API_DIR / 'data' / 'live_seller.db').as_posix()}"

    # Demo seller key sent by the seller screens (header X-Seller-Key or ?key=).
    seller_key: str = "demo-seller-key"

    # Meta Live Video API (optional; Replay and In-app live work without it)
    meta_page_token: str = ""
    meta_graph_version: str = "v21.0"

    # LLM step of the parsing cascade (optional; without a key, unsure comments go to review)
    openrouter_api_key: str = ""
    openrouter_model: str = "anthropic/claude-haiku-5.5"
    llm_timeout_s: float = 15.0

    # Web
    web_origin: str = "http://localhost:5173"
    public_web_url: str = ""          # base URL used in QR codes; empty = browser origin / LAN IP
    serve_web: bool = True            # serve web/dist from this app when it exists

    # Mock QR Ph gateway (stands in for PayMongo test mode)
    gateway_webhook_secret: str = "mockpay-dev-secret"
    qr_minutes: int = 30

    # Queue timing defaults (seller can override per seller row)
    hold_minutes: int = 15
    pay_window_hours: int = 24
    expiry_interval_s: float = 10.0

    # Seed demo data on first start
    seed_demo: bool = True


settings = Settings()
