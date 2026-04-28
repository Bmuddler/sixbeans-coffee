import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text

from app.config import settings as app_settings
from app.database import engine, async_session
from app.models import Base
from app.models.user import User
from app.models.location import Location
from app.services.auth_service import hash_password
from app.seed_employees import seed_employees
from app.seed_supply_catalog import seed_supply_catalog
from app.seed_usfoods import seed_usfoods
from app.models.system_settings import SystemSettings
from app.routers import (
    analytics_admin,
    applications,
    expenses,
    insights,
    audit,
    auth,
    cash_drawer,
    dashboard,
    documents,
    finance,
    forms,
    kiosk,
    locations,
    messaging,
    payroll,
    schedules,
    shift_swap,
    supply_orders,
    supply_reports,
    usfoods,
    time_clock,
    time_off,
    users,
)
from app.routers import settings as settings_router

logger = logging.getLogger(__name__)

app = FastAPI(title=app_settings.app_name, version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in app_settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(users.router, prefix="/api/users", tags=["Users"])
app.include_router(locations.router, prefix="/api/locations", tags=["Locations"])
app.include_router(schedules.router, prefix="/api/schedules", tags=["Schedules"])
app.include_router(time_clock.router, prefix="/api/time-clock", tags=["Time Clock"])
app.include_router(time_off.router, prefix="/api/time-off", tags=["Time Off"])
app.include_router(shift_swap.router, prefix="/api/shift-swap", tags=["Shift Swap"])
app.include_router(messaging.router, prefix="/api/messaging", tags=["Messaging"])
app.include_router(cash_drawer.router, prefix="/api/cash-drawer", tags=["Cash Drawer"])
app.include_router(payroll.router, prefix="/api/payroll", tags=["Payroll"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(kiosk.router, prefix="/api/kiosk", tags=["Kiosk"])
app.include_router(audit.router, prefix="/api/audit", tags=["Audit"])
app.include_router(forms.router, prefix="/api/forms", tags=["Forms"])
app.include_router(documents.router, prefix="/api/documents", tags=["Documents"])
app.include_router(settings_router.router, prefix="/api/settings", tags=["Settings"])
app.include_router(applications.router, prefix="/api/applications", tags=["Applications"])
app.include_router(supply_orders.router, prefix="/api/supply-orders", tags=["Supply Orders"])
app.include_router(supply_reports.router, prefix="/api/supply-reports", tags=["Supply Reports"])
app.include_router(usfoods.router, prefix="/api/usfoods", tags=["US Foods"])
app.include_router(analytics_admin.router, prefix="/api", tags=["Analytics Admin"])
app.include_router(insights.router, prefix="/api", tags=["Insights"])
app.include_router(expenses.router, prefix="/api", tags=["Expenses"])
app.include_router(finance.router, prefix="/api/finance", tags=["Finance"])

SEED_LOCATIONS = [
    {"name": "Six Beans - Apple Valley", "address": "21788 Bear Valley Rd", "city": "Apple Valley", "state": "CA", "zip_code": "92308", "phone": "(760) 946-9008"},
    {"name": "Six Beans - Hesperia", "address": "15760 Ranchero Rd", "city": "Hesperia", "state": "CA", "zip_code": "92345", "phone": "(760) 948-0164"},
    {"name": "Six Beans - Barstow", "address": "921 Barstow Rd Unit B", "city": "Barstow", "state": "CA", "zip_code": "92311", "phone": "(760) 252-5396"},
    {"name": "Six Beans - Victorville", "address": "12875 Bear Valley Rd", "city": "Victorville", "state": "CA", "zip_code": "92392", "phone": "(760) 983-5028"},
    {"name": "Six Beans - Apple Valley (Yucca Loma)", "address": "13730 Apple Valley Rd", "city": "Apple Valley", "state": "CA", "zip_code": "92307", "phone": "(442) 292-2185"},
    {"name": "Six Beans - Victorville (7th St)", "address": "14213 7th St", "city": "Victorville", "state": "CA", "zip_code": "92395", "phone": "(442) 229-2222"},
    {"name": "Six Beans - Warehouse", "address": "", "city": "Apple Valley", "state": "CA", "zip_code": "92308", "phone": ""},
    {"name": "Six Beans - Bakery", "address": "", "city": "Apple Valley", "state": "CA", "zip_code": "92308", "phone": ""},
]


@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Add missing columns to existing tables
        await conn.execute(text(
            "ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_direct BOOLEAN DEFAULT FALSE"
        ))
        await conn.execute(text(
            "ALTER TABLE time_clocks ADD COLUMN IF NOT EXISTS is_unscheduled BOOLEAN DEFAULT FALSE"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT TRUE"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS adp_employee_code VARCHAR(20)"
        ))
        await conn.execute(text(
            "ALTER TABLE time_clocks ADD COLUMN IF NOT EXISTS auto_clockout_at TIMESTAMP"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_preferences TEXT"
        ))
        await conn.execute(text(
            "ALTER TABLE time_off_requests ADD COLUMN IF NOT EXISTS start_time TIME"
        ))
        await conn.execute(text(
            "ALTER TABLE time_off_requests ADD COLUMN IF NOT EXISTS end_time TIME"
        ))
        # Analytics ingestion — external IDs on locations
        await conn.execute(text(
            "ALTER TABLE locations ADD COLUMN IF NOT EXISTS canonical_short_name VARCHAR(50)"
        ))
        await conn.execute(text(
            "ALTER TABLE locations ADD COLUMN IF NOT EXISTS godaddy_store_id VARCHAR(50)"
        ))
        await conn.execute(text(
            "ALTER TABLE locations ADD COLUMN IF NOT EXISTS godaddy_dropdown_label VARCHAR(200)"
        ))
        await conn.execute(text(
            "ALTER TABLE locations ADD COLUMN IF NOT EXISTS tapmango_location_id INTEGER"
        ))
        await conn.execute(text(
            "ALTER TABLE locations ADD COLUMN IF NOT EXISTS doordash_store_id INTEGER"
        ))
        # Public marketing fields
        await conn.execute(text(
            "ALTER TABLE locations ADD COLUMN IF NOT EXISTS display_name VARCHAR(100)"
        ))
        await conn.execute(text(
            "ALTER TABLE locations ADD COLUMN IF NOT EXISTS hours VARCHAR(200)"
        ))
        await conn.execute(text(
            "ALTER TABLE locations ADD COLUMN IF NOT EXISTS show_on_homepage BOOLEAN NOT NULL DEFAULT FALSE"
        ))
        # One-time backfill: seed display_name and homepage flag for the 6
        # public shops. Skips rows where display_name is already set so
        # owners can override via the admin form afterward.
        homepage_seed = [
            ("Six Beans - Apple Valley", "Apple Valley", "Mon-Sat 5:30am-7pm · Sun 6am-7pm"),
            ("Six Beans - Hesperia", "Hesperia", "Mon-Sat 5:30am-7pm · Sun 6am-7pm"),
            ("Six Beans - Barstow", "Barstow", "Mon-Sat 5:30am-7pm · Sun 6am-7pm"),
            ("Six Beans - Victorville", "Victorville", "Mon-Sat 5:30am-7pm · Sun 6am-7pm"),
            ("Six Beans - Apple Valley (Yucca Loma)", "Yucca Loma", "Mon-Sat 5:30am-7pm · Sun 6am-7pm"),
            ("Six Beans - Victorville (7th St)", "7th Street", "Mon-Sun 6am-6pm"),
        ]
        for full_name, display, hrs in homepage_seed:
            await conn.execute(
                text(
                    "UPDATE locations SET display_name = :display, hours = :hrs, "
                    "show_on_homepage = TRUE "
                    "WHERE name = :full_name AND display_name IS NULL"
                ),
                {"display": display, "hrs": hrs, "full_name": full_name},
            )
        # The ingestion_runs.source CHECK constraint was initially written
        # without 'homebase'. Drop & re-add so the current source enum is
        # accepted. Idempotent across restarts.
        await conn.execute(text(
            "ALTER TABLE ingestion_runs DROP CONSTRAINT IF EXISTS ck_ingestion_runs_source"
        ))
        await conn.execute(text(
            "ALTER TABLE ingestion_runs ADD CONSTRAINT ck_ingestion_runs_source "
            "CHECK (source in ('godaddy','tapmango_orders','tapmango_api','doordash','homebase'))"
        ))
        await conn.execute(text(
            "ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS labor_burden_multiplier "
            "DOUBLE PRECISION NOT NULL DEFAULT 1.25"
        ))
        await conn.execute(text(
            "ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS cogs_percent "
            "DOUBLE PRECISION NOT NULL DEFAULT 0.22"
        ))
        await conn.execute(text(
            "ALTER TABLE company_documents ADD COLUMN IF NOT EXISTS visibility "
            "VARCHAR(20) NOT NULL DEFAULT 'all'"
        ))
        await conn.execute(text(
            "ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS status "
            "VARCHAR(20) NOT NULL DEFAULT 'new'"
        ))
        await conn.execute(text(
            "ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS "
            "forwarded_to_location_id INTEGER REFERENCES locations(id)"
        ))
        await conn.execute(text(
            "ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS forwarded_at TIMESTAMP"
        ))
        await conn.execute(text(
            "ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS "
            "forwarded_by INTEGER REFERENCES users(id)"
        ))
        await conn.execute(text(
            "ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS rating VARCHAR(10)"
        ))
        await conn.execute(text(
            "ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP"
        ))
        await conn.execute(text(
            "ALTER TABLE finance_rules ADD COLUMN IF NOT EXISTS "
            "account_id INTEGER REFERENCES bank_accounts(id)"
        ))
        await conn.execute(text(
            "ALTER TABLE daily_revenues ADD COLUMN IF NOT EXISTS card_total DOUBLE PRECISION"
        ))
        await conn.execute(text(
            "ALTER TABLE daily_revenues ADD COLUMN IF NOT EXISTS cash_total DOUBLE PRECISION"
        ))
        await conn.execute(text(
            "ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS card_processing_fee_pct "
            "DOUBLE PRECISION NOT NULL DEFAULT 0.023"
        ))
        await conn.execute(text(
            "ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS tapmango_fee_pct "
            "DOUBLE PRECISION NOT NULL DEFAULT 0.03"
        ))

        # H2: ensure unique constraints declared in the SQLAlchemy models
        # actually exist on the live DB. create_all() only adds constraints
        # when a table is first created, so tables that predate the
        # `unique=True` declarations never got the enforcement — which is
        # how duplicate canonical_short_name and duplicate godaddy_store_id
        # rows were able to sneak in and cause the revenue-misrouting bugs.
        # Each statement is idempotent via dynamic existence check.
        # Each ALTER runs in its own savepoint so a failure (lingering
        # duplicate rows) doesn't poison the outer transaction.
        async def _ensure_constraint(table: str, columns: str, name: str) -> None:
            exists = await conn.execute(text(
                "SELECT 1 FROM pg_constraint WHERE conname = :n"
            ), {"n": name})
            if exists.scalar_one_or_none():
                return
            try:
                async with conn.begin_nested():
                    await conn.execute(text(
                        f"ALTER TABLE {table} ADD CONSTRAINT {name} UNIQUE ({columns})"
                    ))
                logger.info("Added unique constraint %s on %s(%s)", name, table, columns)
            except Exception as exc:
                # Savepoint rolled back automatically on exit; outer tx is fine.
                logger.warning(
                    "Could not add unique constraint %s on %s(%s) — likely duplicate rows, skipping: %s",
                    name, table, columns, str(exc).splitlines()[0] if str(exc) else exc,
                )

        await _ensure_constraint("locations", "canonical_short_name", "uq_locations_canonical_short_name")
        await _ensure_constraint("locations", "godaddy_store_id", "uq_locations_godaddy_store_id")
        await _ensure_constraint("locations", "tapmango_location_id", "uq_locations_tapmango_location_id")
        await _ensure_constraint("locations", "doordash_store_id", "uq_locations_doordash_store_id")
        await _ensure_constraint(
            "daily_revenues", "location_id, date, channel",
            "uq_daily_revenue_location_date_channel",
        )
        await _ensure_constraint(
            "hourly_revenue", "location_id, date, hour, quarter, channel",
            "uq_hourly_revenue_slot",
        )
        await _ensure_constraint(
            "daily_labor", "location_id, date",
            "uq_daily_labor_location_date",
        )
        await conn.execute(text(
            "ALTER TABLE locations ADD COLUMN IF NOT EXISTS godaddy_terminal_ids "
            "VARCHAR(500)"
        ))
        await conn.execute(text(
            "ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS analytics_reset_version "
            "INTEGER NOT NULL DEFAULT 0"
        ))

    async with async_session() as session:
        # Locations are seeded ONLY on a fresh install (see the empty-DB path
        # below that runs when no users exist). A previous version of this
        # file re-checked SEED_LOCATIONS on every boot and re-inserted any
        # whose address wasn't currently in the DB — which meant deleting a
        # shop in the UI would silently come back on the next deploy. We
        # don't auto-reseed at runtime anymore: deletions stick, and new
        # shops are added through the UI like any other operational change.

        # Backfill canonical short names and external IDs for analytics ingestion.
        # Matches on address (unique per location) to avoid ambiguity.
        # Tuple: (address_match, canonical_short_name, godaddy_store_id,
        #         godaddy_dropdown_label, tapmango_location_id,
        #         doordash_store_id, godaddy_terminal_ids).
        # GoDaddy terminal IDs were identified by matching each Settlement
        # Report file's 4/21 gross/txn totals against the already-verified
        # per-store Transactions Reports from that day; two stores (AVHS
        # and Hesperia) have two physical terminals.
        CANONICAL_MAPPINGS = [
            ("21788 Bear Valley Rd", "APPLE_VALLEY_HS",
             "7160b3ac-5321-403c-b849-e4f041ef7574",
             "Six Beans Coffee Co. - AV HS", 2360, 27728588,
             "15a661b5-f3b3-40de-a44f-07519e82ed7d,50db32b6-92c0-4965-af2c-cfe5ca2764f6"),
            ("15760 Ranchero Rd", "HESPERIA",
             "ab50508a-8f15-4235-b54d-b5e6151fa474",
             "Six Beans Coffee Co. - Ranchero", 7226, 27795480,
             "67609ff9-0112-419d-a1c7-95a450c96a45,f13621ad-c969-49be-ad2c-8d25ecdc2964"),
            ("921 Barstow Rd", "BARSTOW",
             "99842f2c-4850-4f3d-bebc-2a5459654a1b",
             "Six Beans Coffee Co. - Barstow", 8772, 27728689,
             "19929ffe-f068-4bbd-9a53-87b36479eb87"),
            ("12875 Bear Valley Rd", "VICTORVILLE",
             "28f4c6a9-e59f-4d31-a47b-73b4b7270330",
             "Six Beans Coffee Co (Bear Valley Rd)", 9908, 27659027,
             "ba935e9a-a848-4b3e-83a3-a4ff65708ecf"),
            ("13730 Apple Valley Rd", "YUCCA_LOMA",
             "7d0f498a-44d1-4176-978b-fec7aa58b00d",
             "Six Beans Coffee Co. - Yucca Loma", 10958, 27798819,
             "ecc38797-9c91-4c8e-b5ec-d95cb7bc99ff"),
            ("14213 7th St", "SEVENTH_STREET",
             "42fa2bf7-6b6e-4f2a-a4b2-61db54d2043a",
             "Six Beans Coffee Co. - 7th Street", 12497, 36236401,
             "b5b39c32-0280-4354-a5a9-4edb4beb6bb8"),
        ]
        all_locs = (await session.execute(select(Location))).scalars().all()

        # Clean up any duplicate "Six Beans - Bakery" rows an earlier
        # deploy may have created with address="Bakery (internal)".
        # Keep the SEED_LOCATIONS row (empty address) and drop the rest.
        bakery_rows = [l for l in all_locs if (l.name or "").strip().lower() == "six beans - bakery"]
        if len(bakery_rows) > 1:
            canonical = next((l for l in bakery_rows if (l.address or "") == ""), bakery_rows[0])
            for dup in bakery_rows:
                if dup is not canonical:
                    await session.execute(text(
                        "DELETE FROM locations WHERE id = :id"
                    ), {"id": dup.id})
            await session.commit()
            all_locs = (await session.execute(select(Location))).scalars().all()

        # Bakery and Warehouse both have empty addresses so they can't be
        # routed via the CANONICAL_MAPPINGS address table. Assign their
        # canonical_short_name by name-match instead.
        name_short_changed = False
        for loc in all_locs:
            lname = (loc.name or "").lower()
            if "bakery" in lname and loc.canonical_short_name != "BAKERY":
                loc.canonical_short_name = "BAKERY"
                name_short_changed = True
            elif "warehouse" in lname and loc.canonical_short_name != "WAREHOUSE":
                loc.canonical_short_name = "WAREHOUSE"
                name_short_changed = True
        if name_short_changed:
            await session.commit()
            logger.info("Bakery / Warehouse canonical_short_names assigned.")

        by_address = {loc.address: loc for loc in all_locs}
        mapped_addresses = {row[0] for row in CANONICAL_MAPPINGS}
        targets: list[tuple[Location, str, str, str, int | None, int | None, str | None]] = []
        needs_update = False
        for address_match, short_name, gd_store_id, gd_label, tm_id, dd_id, gd_terms in CANONICAL_MAPPINGS:
            loc = by_address.get(address_match)
            if loc is None:
                continue
            if (
                loc.canonical_short_name != short_name
                or loc.godaddy_store_id != gd_store_id
                or loc.godaddy_dropdown_label != gd_label
                or loc.tapmango_location_id != tm_id
                or loc.doordash_store_id != dd_id
                or (loc.godaddy_terminal_ids or "") != (gd_terms or "")
            ):
                needs_update = True
            targets.append((loc, short_name, gd_store_id, gd_label, tm_id, dd_id, gd_terms))

        # Non-sales locations (e.g. warehouse) must not hold any POS channel
        # IDs — these get nulled on every boot so a stray admin link can't
        # send store revenue to the wrong row.
        non_sales = [
            loc for loc in all_locs
            if loc.address not in mapped_addresses
            and (
                loc.godaddy_store_id is not None
                or loc.tapmango_location_id is not None
                or loc.doordash_store_id is not None
                or loc.godaddy_terminal_ids is not None
            )
        ]
        if non_sales:
            needs_update = True

        mappings_changed = False
        if needs_update:
            # Two-phase update: unique constraints on godaddy_store_id /
            # tapmango_location_id / doordash_store_id mean we can't directly
            # swap values between locations. Null everything in the affected
            # set first, flush, then apply the canonical mapping.
            for loc, *_ in targets:
                loc.godaddy_store_id = None
                loc.tapmango_location_id = None
                loc.doordash_store_id = None
                loc.godaddy_terminal_ids = None
            for loc in non_sales:
                loc.godaddy_store_id = None
                loc.tapmango_location_id = None
                loc.doordash_store_id = None
                loc.godaddy_terminal_ids = None
            await session.flush()
            for loc, short_name, gd_store_id, gd_label, tm_id, dd_id, gd_terms in targets:
                loc.canonical_short_name = short_name
                loc.godaddy_store_id = gd_store_id
                loc.godaddy_dropdown_label = gd_label
                loc.tapmango_location_id = tm_id
                loc.doordash_store_id = dd_id
                loc.godaddy_terminal_ids = gd_terms
            mappings_changed = True
        if mappings_changed:
            await session.commit()
            logger.info("Analytics canonical mappings backfilled for %d locations.", len(CANONICAL_MAPPINGS))

        # One-shot analytics-data self-heal.
        # Bump TARGET when the Locations table had duplicate canonical_short_names
        # that caused historical revenue / labor / hourly / expense rows to land
        # on the wrong location_id. Wipe the affected tables exactly once and
        # wait for the owner to re-upload / re-import — cleaner than trying
        # to detect-and-reassociate every row.
        #   v1: revenue + labor (initial dedupe)
        #   v2: revenue + labor + expenses (dedupe revealed expenses were also wrong)
        RESET_TARGET = 2
        current_ver = (await session.execute(
            select(SystemSettings.analytics_reset_version).limit(1)
        )).scalar_one_or_none()
        if current_ver is None or current_ver < RESET_TARGET:
            logger.info(
                "Analytics data reset v%d: wiping daily_revenues / hourly_revenue / "
                "daily_labor / expenses.", RESET_TARGET,
            )
            await session.execute(text("DELETE FROM hourly_revenue"))
            await session.execute(text("DELETE FROM daily_revenues"))
            await session.execute(text("DELETE FROM daily_labor"))
            await session.execute(text("DELETE FROM expenses"))
            await session.execute(text("DELETE FROM ingestion_runs"))
            existing_settings = (await session.execute(
                select(SystemSettings).limit(1)
            )).scalar_one_or_none()
            if existing_settings is None:
                session.add(SystemSettings(id=1, analytics_reset_version=RESET_TARGET))
            else:
                existing_settings.analytics_reset_version = RESET_TARGET
            await session.commit()
            logger.info(
                "Analytics data reset complete. Re-upload files on Analytics Ingestion "
                "and re-click 'Import from P&L Excel' on the Expenses page."
            )

        # Purge any stray revenue / hourly rows attached to labor-only
        # locations (Bakery, Warehouse, or any row with no POS channel IDs).
        # These land there only when an earlier iteration of the mapping
        # had a channel ID pointed at the wrong row.
        non_sales_ids_result = await session.execute(text("""
            SELECT id FROM locations
            WHERE godaddy_store_id IS NULL
              AND tapmango_location_id IS NULL
              AND doordash_store_id IS NULL
        """))
        non_sales_ids = [r[0] for r in non_sales_ids_result.all()]
        if non_sales_ids:
            deleted_rev = await session.execute(text(
                "DELETE FROM daily_revenues WHERE location_id = ANY(:ids)"
            ), {"ids": non_sales_ids})
            deleted_hour = await session.execute(text(
                "DELETE FROM hourly_revenue WHERE location_id = ANY(:ids)"
            ), {"ids": non_sales_ids})
            await session.commit()
            rc_rev = getattr(deleted_rev, "rowcount", 0) or 0
            rc_hour = getattr(deleted_hour, "rowcount", 0) or 0
            if rc_rev or rc_hour:
                logger.info(
                    "Purged %d daily_revenues + %d hourly_revenue rows from "
                    "non-sales locations %s.", rc_rev, rc_hour, non_sales_ids,
                )

        # Set owners to not require password change
        from app.models.user import UserRole, user_locations
        await session.execute(
            text("UPDATE users SET must_change_password = FALSE WHERE role = 'owner'")
        )
        await session.commit()

        # Assign Adelia to Bakery location
        adelia = (await session.execute(
            select(User).where(User.email == "adeliasarah@gmail.com")
        )).scalar_one_or_none()
        bakery_loc = (await session.execute(
            select(Location).where(Location.name == "Six Beans - Bakery")
        )).scalar_one_or_none()
        if adelia and bakery_loc:
            existing = (await session.execute(
                select(user_locations).where(
                    user_locations.c.user_id == adelia.id,
                    user_locations.c.location_id == bakery_loc.id,
                )
            )).first()
            if not existing:
                await session.execute(
                    user_locations.insert().values(user_id=adelia.id, location_id=bakery_loc.id)
                )
                await session.commit()
                logger.info("Adelia assigned to Bakery location.")

        # Seed default SystemSettings if none exists
        settings_result = await session.execute(select(SystemSettings).where(SystemSettings.id == 1))
        if settings_result.scalar_one_or_none() is None:
            session.add(SystemSettings(id=1, early_clockin_minutes=5, auto_clockout_minutes=0))
            await session.commit()
            logger.info("Default system settings created.")

        result = await session.execute(select(User).limit(1))
        if result.scalar_one_or_none() is None:
            logger.info("Empty database — seeding locations and owner accounts...")
            for loc_data in SEED_LOCATIONS:
                session.add(Location(**loc_data, is_active=True))

            session.add(User(
                email="logcastles@gmail.com",
                first_name="Owner",
                last_name="Admin",
                phone="5555550100",
                pin_last_four="0100",
                hashed_password=hash_password("Sixb3ans12!"),
                role="owner",
                is_active=True,
                must_change_password=False,
            ))
            session.add(User(
                email="jessica@sixbeanscoffee.com",
                first_name="Jessica",
                last_name="Admin",
                phone="5555550200",
                pin_last_four="0200",
                hashed_password=hash_password("Sixb3ans12!"),
                role="owner",
                is_active=True,
                must_change_password=False,
            ))
            await session.commit()
            logger.info("Seed complete — 6 locations, 2 owner accounts.")

            # First-install only. These were previously called on every boot
            # below this if-block, which meant any time the CSV-backed seed
            # data drifted out of sync with reality (deletes, location moves,
            # role changes), the seed would either silently no-op via email
            # checks or — worse — re-run partial inserts that mutated
            # operational data on every restart. They belong inside the
            # empty-DB branch alongside the location and owner seed.
            await seed_employees(session)
            await seed_supply_catalog(session)
            await seed_usfoods(session)

        # Banking center: idempotent (skips if any bank account exists), so
        # safe to call on every boot — but only fires once on a fresh DB.
        from app.data.finance_seed import seed_finance, ensure_account_scoped_rules
        await seed_finance(session)
        await ensure_account_scoped_rules(session)

        # USFoods: ensure the Victorville mapping picks up the typo'd shop
        # name "Six beans victorvillle" (three L's) we see on Square orders.
        # Idempotent: only updates if the keyword isn't already there.
        from app.models.usfoods import USFoodsShopMapping
        vict_mapping = (await session.execute(
            select(USFoodsShopMapping).where(
                USFoodsShopMapping.us_foods_account_name == "Six Bean Coffee Victorvil"
            )
        )).scalar_one_or_none()
        if vict_mapping is not None:
            kws = (vict_mapping.match_keywords or "")
            if "victorvillle" not in kws.lower():
                vict_mapping.match_keywords = (kws.rstrip(",") + ",victorvillle").lstrip(",")
                await session.commit()
                logger.info(
                    "USFoods: added 'victorvillle' typo variant to Victorville keywords."
                )

        # Seed ADP employee codes (one-time)
        adp_check = await session.execute(
            select(User).where(User.adp_employee_code.isnot(None)).limit(1)
        )
        if adp_check.scalar_one_or_none() is None:
            ADP_CODES = {
                "Aguilar, Adelia": "100", "Allaway, Ally": "5", "Castillo, Delilah": "145",
                "Contreras, Gabriela": "108", "Gonzalez, Madison": "84", "Gutierrez, Jayden": "147",
                "Hernandez, Amelie": "140", "Hernandez, Elizabeth": "141", "Herrarte, Sofia": "129",
                "Herrera Jr., Gustavo": "143", "Hines, Zoey": "131", "Hough, Hannah": "122",
                "Limon, Zamantha": "65", "Lowery, Makayla": "121", "matai, dejanae": "138",
                "Miranda, Alyssa": "80", "Monroy, Anthony": "110", "Munoz, Johanna": "71",
                "Nicklason, Abby": "114", "Nicklason, Chloe": "133", "Nicklason, Jessica": "96",
                "Nicklason, Micah": "91", "Palumbo, Mia": "146", "Pineda, Alissa": "35",
                "Ponce, Jose": "137", "Privett, Kaitlin": "126", "abbey, ": "111",
                "Sadach, Giada": "128", "Sandoval, Cristina": "130", "Solis, Britney": "149",
                "Soto, Natalie": "124", "Thomas, Abigail": "136", "Tinajero, Alexia": "148",
                "Villatoro, Kailee": "127", "Youngs, Ciara": "88",
            }
            all_users = (await session.execute(select(User))).scalars().all()
            matched = 0
            for user in all_users:
                for name_key, code in ADP_CODES.items():
                    last_part, first_part = name_key.split(", ", 1)
                    if (user.last_name.strip().lower() == last_part.strip().lower()
                            and user.first_name.strip().lower() == first_part.strip().lower()):
                        user.adp_employee_code = code
                        matched += 1
                        break
            if matched:
                await session.commit()
                logger.info(f"Seeded ADP codes for {matched} employees.")


@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "app": app_settings.app_name}
