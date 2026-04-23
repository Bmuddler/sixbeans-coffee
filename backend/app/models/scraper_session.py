"""Encrypted storage for Playwright session cookies.

One row per (source, location_id) — when a scraper runs nightly it loads
the cookies from this table, injects them into a fresh Playwright context,
and skips the login flow entirely. When cookies expire (~30 days), the
admin dashboard prompts the owner to re-authenticate.

For services where one login covers all stores (GoDaddy and TapMango both
use one account with a store dropdown), the row uses location_id = NULL
and source alone identifies it.
"""

from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.models import Base


# Source enum shared with ingestion_run.py's scraper sources
SOURCE_GODADDY = "godaddy"
SOURCE_TAPMANGO_PORTAL = "tapmango_portal"
ALL_SCRAPER_SOURCES = (SOURCE_GODADDY, SOURCE_TAPMANGO_PORTAL)


class ScraperSession(Base):
    __tablename__ = "scraper_sessions"
    __table_args__ = (
        UniqueConstraint("source", name="uq_scraper_sessions_source"),
    )

    id = Column(Integer, primary_key=True, index=True)
    source = Column(String(30), nullable=False, index=True)

    # Optional — for future per-location sessions. Currently NULL because
    # GoDaddy and TapMango both use one account with a store dropdown.
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=True)

    # Encrypted cookie bundle (Playwright storage_state JSON, Fernet-encrypted).
    encrypted_cookies = Column(LargeBinary, nullable=False)

    # Who captured the session and when
    captured_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    captured_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Last successful use by a scraper — helps detect expired cookies
    last_used_at = Column(DateTime, nullable=True)
    last_failure_at = Column(DateTime, nullable=True)
    last_failure_reason = Column(String(500), nullable=True)

    location = relationship("Location")
    captured_by = relationship("User")
