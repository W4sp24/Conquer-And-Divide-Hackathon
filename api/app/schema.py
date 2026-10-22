"""Database tables (SQLAlchemy Core). Same shape as supabase/schema.sql.

Money is always whole centavos. Two unique rules carry the important guarantees:
one item code per seller, and one payment reference per seller (proofs).
"""
from datetime import datetime, timezone

from sqlalchemy import (JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, MetaData,
                        String, Table, Text, TypeDecorator, UniqueConstraint, Float)

metadata = MetaData()


class UTCDateTime(TypeDecorator):
    """Stores UTC, always returns timezone-aware UTC datetimes (SQLite drops tz info)."""
    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, str):
            value = datetime.fromisoformat(value)
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _id():
    return Column("id", String(36), primary_key=True)


def _now():
    return datetime.now(timezone.utc)


sellers = Table(
    "sellers", metadata, _id(),
    Column("name", Text, nullable=False),              # "Jessa"
    Column("shop_name", Text, nullable=False),         # "Jessa's Ukay, Tondo"
    Column("payment_mode", String(16), nullable=False, default="both"),  # manual | instant_qr | both
    Column("wallet_provider", Text, default="GCash"),
    Column("wallet_name", Text, default=""),           # shown to buyers, e.g. "Jessa B."
    Column("wallet_number", Text, default=""),         # shown to buyers, e.g. "0917 123 4821"
    Column("auto_release_gateway", Boolean, nullable=False, default=True),
    Column("hold_minutes", Integer, nullable=False, default=15),
    Column("pay_window_hours", Integer, nullable=False, default=24),
    Column("created_at", UTCDateTime, nullable=False, default=_now),
)

catalog_items = Table(
    "catalog_items", metadata, _id(),
    Column("seller_id", String(36), ForeignKey("sellers.id"), nullable=False),
    Column("code", String(16), nullable=False),        # "B12"
    Column("name", Text, nullable=False),
    Column("price_centavos", Integer, nullable=False),
    Column("sizes", JSON, nullable=False, default=list),
    Column("stock", Integer, nullable=False, default=1),
    Column("keywords", JSON, nullable=False, default=list),
    Column("photo_url", Text),                         # small data URL or https URL
    Column("tone", String(9), default="#C9CDC6"),      # placeholder swatch when no photo
    Column("active", Boolean, nullable=False, default=True),
    Column("created_at", UTCDateTime, nullable=False, default=_now),
    UniqueConstraint("seller_id", "code", name="uq_item_code"),
)

live_sessions = Table(
    "live_sessions", metadata, _id(),
    Column("seller_id", String(36), ForeignKey("sellers.id"), nullable=False),
    Column("title", Text, nullable=False, default="Live selling"),
    Column("source", String(16), nullable=False),      # meta | replay | chat
    Column("live_video_id", Text),                     # Meta live video id, or recording name
    Column("fb_video_url", Text),                      # optional public FB video URL for the viewer embed
    Column("replay_speed", Float, nullable=False, default=1.0),
    Column("current_item_id", String(36), ForeignKey("catalog_items.id")),
    Column("recent_item_ids", JSON, nullable=False, default=list),
    Column("status", String(16), nullable=False, default="idle"),  # idle | running | ended
    Column("error", Text),
    Column("created_at", UTCDateTime, nullable=False, default=_now),
    Column("started_at", UTCDateTime),
    Column("ended_at", UTCDateTime),
)

buyers = Table(
    "buyers", metadata, _id(),
    Column("seller_id", String(36), ForeignKey("sellers.id"), nullable=False),
    Column("platform_user_id", Text, nullable=False),  # Meta from.id, or the in-app chat device id
    Column("display_name", Text, nullable=False),
    Column("claims", Integer, nullable=False, default=0),
    Column("verified", Integer, nullable=False, default=0),
    Column("failed_proofs", Integer, nullable=False, default=0),
    Column("expired_unpaid", Integer, nullable=False, default=0),
    Column("cancels", Integer, nullable=False, default=0),
    Column("max_paid_centavos", Integer, nullable=False, default=0),
    Column("created_at", UTCDateTime, nullable=False, default=_now),
    UniqueConstraint("seller_id", "platform_user_id", name="uq_buyer"),
)

comments = Table(
    "comments", metadata,
    Column("id", String(128), primary_key=True),      # Meta comment id, or generated
    Column("session_id", String(36), ForeignKey("live_sessions.id"), nullable=False),
    Column("buyer_id", String(36), ForeignKey("buyers.id")),
    Column("message", Text, nullable=False),
    Column("source", String(16), nullable=False, default="chat"),
    Column("created_time", UTCDateTime, nullable=False),   # platform time decides queue order
    Column("parse_stage", String(16)),                 # rules | fuzzy | llm | review | ignored | fixed
    Column("parse_result", JSON),
    Column("confidence", Float),
    Column("outcome", Text),                           # what the comment did, e.g. "claimed B12"
    Column("resolved", Boolean, nullable=False, default=False),  # review handled
    Column("received_at", UTCDateTime, nullable=False, default=_now),
)
Index("comments_session", comments.c.session_id, comments.c.created_time)

orders = Table(
    "orders", metadata, _id(),
    Column("seller_id", String(36), ForeignKey("sellers.id"), nullable=False),
    Column("session_id", String(36), ForeignKey("live_sessions.id"), nullable=False),
    Column("buyer_id", String(36), ForeignKey("buyers.id"), nullable=False),
    Column("item_id", String(36), ForeignKey("catalog_items.id"), nullable=False),
    Column("comment_id", String(128), ForeignKey("comments.id")),
    Column("size", Text),
    Column("qty", Integer, nullable=False, default=1),
    Column("unit_price_centavos", Integer, nullable=False),
    Column("total_centavos", Integer, nullable=False),
    Column("for_name", Text),                          # "para kay Ana"
    Column("status", String(16), nullable=False, default="WAITLISTED"),
    Column("buyer_token", String(64), nullable=False, unique=True),
    Column("claimed_at", UTCDateTime, nullable=False),
    Column("hold_until", UTCDateTime),
    Column("pay_by", UTCDateTime),
    # the buyer's latest proof (what they typed), copied here so a reused reference still shows
    Column("proof_reference", Text),
    Column("proof_amount_centavos", Integer),
    Column("proof_submitted_at", UTCDateTime),
    Column("proof_attested", Boolean, nullable=False, default=False),
    Column("proof_channel", String(16)),               # manual | qrph
    Column("verdict", String(16)),                     # RELEASE | HOLD | PENDING
    Column("verdict_reasons", JSON, nullable=False, default=list),
    Column("verdict_suggestion", Text),
    Column("seller_note", Text),                       # "Ask buyer" message shown on the buyer page
    Column("created_at", UTCDateTime, nullable=False, default=_now),
    Column("updated_at", UTCDateTime, nullable=False, default=_now),
)
Index("orders_queue", orders.c.item_id, orders.c.status, orders.c.claimed_at)

order_events = Table(
    "order_events", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("order_id", String(36), ForeignKey("orders.id"), nullable=False),
    Column("from_status", String(16)),
    Column("to_status", String(16), nullable=False),
    Column("actor", String(16), nullable=False),       # system | buyer | seller | webhook
    Column("note", Text),
    Column("at", UTCDateTime, nullable=False, default=_now),
)

proofs = Table(
    "proofs", metadata, _id(),
    Column("seller_id", String(36), ForeignKey("sellers.id"), nullable=False),
    Column("order_id", String(36), ForeignKey("orders.id"), nullable=False),
    Column("reference", Text, nullable=False),         # cleaned before insert
    Column("amount_centavos", Integer, nullable=False),
    Column("attested", Boolean, nullable=False, default=False),
    Column("submitted_at", UTCDateTime, nullable=False, default=_now),
    UniqueConstraint("seller_id", "reference", name="uq_proof_reference"),
)

statement_uploads = Table(
    "statement_uploads", metadata, _id(),
    Column("seller_id", String(36), ForeignKey("sellers.id"), nullable=False),
    Column("filename", Text),
    Column("row_count", Integer),
    Column("covers_until", UTCDateTime),               # newest payment time in the file
    Column("uploaded_at", UTCDateTime, nullable=False, default=_now),
)

payments = Table(
    "payments", metadata, _id(),
    Column("seller_id", String(36), ForeignKey("sellers.id"), nullable=False),
    Column("source", String(16), nullable=False),      # statement | qrph
    Column("reference", Text, nullable=False),
    Column("amount_centavos", Integer, nullable=False),
    Column("paid_at", UTCDateTime, nullable=False),
    Column("order_id", String(36), ForeignKey("orders.id")),
    Column("upload_id", String(36), ForeignKey("statement_uploads.id")),
    UniqueConstraint("seller_id", "source", "reference", name="uq_payment"),
)

corrections = Table(
    "corrections", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("seller_id", String(36), ForeignKey("sellers.id"), nullable=False),
    Column("message", Text, nullable=False),
    Column("fixed", JSON, nullable=False),             # {intent, item_code, size, qty, for_name}
    Column("created_at", UTCDateTime, nullable=False, default=_now),
)

# --- Mock payment rails (stand-ins for real-world systems) -------------------------

payment_intents = Table(                               # mock QR Ph gateway (like PayMongo)
    "payment_intents", metadata, _id(),
    Column("seller_id", String(36), ForeignKey("sellers.id"), nullable=False),
    Column("order_id", String(36), ForeignKey("orders.id"), nullable=False),
    Column("amount_centavos", Integer, nullable=False),
    Column("status", String(20), nullable=False, default="awaiting_payment"),  # awaiting_payment | paid | expired | cancelled
    Column("reference", Text),                         # set when paid
    Column("payer_name", Text),
    Column("expires_at", UTCDateTime, nullable=False),
    Column("created_at", UTCDateTime, nullable=False, default=_now),
    Column("paid_at", UTCDateTime),
)

wallet_ledger = Table(                                 # mock e-wallet account of the seller (like GCash)
    "wallet_ledger", metadata, _id(),
    Column("seller_id", String(36), ForeignKey("sellers.id"), nullable=False),
    Column("reference", Text, nullable=False),
    Column("amount_centavos", Integer, nullable=False),
    Column("sender_name", Text, nullable=False),
    Column("message", Text),
    Column("paid_at", UTCDateTime, nullable=False, default=_now),
)
