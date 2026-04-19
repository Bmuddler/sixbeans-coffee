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
from app.models.system_settings import SystemSettings
from app.routers import (
    applications,
    audit,
    auth,
    cash_drawer,
    dashboard,
    documents,
    forms,
    kiosk,
    locations,
    messaging,
    payroll,
    schedules,
    shift_swap,
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

SEED_LOCATIONS = [
    {"name": "Six Beans - Apple Valley", "address": "21788 Bear Valley Rd", "city": "Apple Valley", "state": "CA", "zip_code": "92308", "phone": "(760) 946-9008"},
    {"name": "Six Beans - Hesperia", "address": "15760 Ranchero Rd", "city": "Hesperia", "state": "CA", "zip_code": "92345", "phone": "(760) 948-0164"},
    {"name": "Six Beans - Barstow", "address": "921 Barstow Rd", "city": "Barstow", "state": "CA", "zip_code": "92311", "phone": "(760) 229-0997"},
    {"name": "Six Beans - Victorville", "address": "12875 Bear Valley Rd", "city": "Victorville", "state": "CA", "zip_code": "92392", "phone": "(760) 983-5028"},
    {"name": "Six Beans - Apple Valley (Yucca Loma)", "address": "13730 Apple Valley Rd", "city": "Apple Valley", "state": "CA", "zip_code": "92307", "phone": "(442) 292-2185"},
    {"name": "Six Beans - Victorville (7th St)", "address": "14213 7th St", "city": "Victorville", "state": "CA", "zip_code": "92395", "phone": "(442) 229-2222"},
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

    async with async_session() as session:
        # Sync locations with SEED_LOCATIONS
        existing_locs = (await session.execute(select(Location))).scalars().all()
        existing_addresses = {loc.address for loc in existing_locs}
        changed = False
        for i, loc in enumerate(existing_locs):
            if i < len(SEED_LOCATIONS) and loc.address != SEED_LOCATIONS[i]["address"]:
                for key, val in SEED_LOCATIONS[i].items():
                    setattr(loc, key, val)
                changed = True
        for seed_loc in SEED_LOCATIONS:
            if seed_loc["address"] not in existing_addresses:
                session.add(Location(**seed_loc, is_active=True))
                changed = True
        if changed:
            await session.commit()
            logger.info("Locations synced.")

        # Set owners to not require password change
        from app.models.user import UserRole
        await session.execute(
            text("UPDATE users SET must_change_password = FALSE WHERE role = 'owner'")
        )
        await session.commit()

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

        # Bulk-import employees from Homebase CSV data
        await seed_employees(session)

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
