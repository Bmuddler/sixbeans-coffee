"""Audit log of each ingestion attempt.

One row per (source, target_date) attempt. The owner dashboard reads this to
show the "last sync" badge for each source and to surface failures the owner
needs to react to (e.g. a store's GoDaddy login expired, or the DoorDash
email hasn't arrived yet).
"""

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from app.models import Base


# Source enum — keep in sync with DailyRevenue channels plus any scraper sources
# that don't produce DailyRevenue rows (e.g. the TapMango customer/loyalty API).
SOURCE_GODADDY = "godaddy"
SOURCE_TAPMANGO_ORDERS = "tapmango_orders"
SOURCE_TAPMANGO_API = "tapmango_api"
SOURCE_DOORDASH = "doordash"
SOURCE_HOMEBASE = "homebase"
ALL_SOURCES = (
    SOURCE_GODADDY,
    SOURCE_TAPMANGO_ORDERS,
    SOURCE_TAPMANGO_API,
    SOURCE_DOORDASH,
    SOURCE_HOMEBASE,
)

# Status enum
STATUS_SUCCESS = "success"
STATUS_PARTIAL = "partial"  # e.g. 5/6 stores OK, 1 failed — data partially usable
STATUS_FAILED = "failed"
STATUS_RUNNING = "running"


class IngestionRun(Base):
    __tablename__ = "ingestion_runs"
    __table_args__ = (
        CheckConstraint(
            "source in ('godaddy','tapmango_orders','tapmango_api','doordash','homebase')",
            name="ck_ingestion_runs_source",
        ),
        CheckConstraint(
            "status in ('success','partial','failed','running')",
            name="ck_ingestion_runs_status",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    source = Column(String(30), nullable=False, index=True)

    # Target date being ingested (e.g. "yesterday"). For TapMango API pulls
    # that aren't date-bound, this mirrors started_at's date.
    target_date = Column(Date, nullable=False, index=True)

    # Optional scope — a single run might cover a specific location; NULL means
    # "all locations for this source."
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=True, index=True)

    status = Column(String(20), nullable=False, default=STATUS_RUNNING)
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    finished_at = Column(DateTime, nullable=True)

    records_ingested = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    # Free-form JSON-ish notes serialized as text — avoids a JSON column
    # type mismatch between sqlite (dev) and postgres (prod).
    notes = Column(Text, nullable=True)

    location = relationship("Location")
