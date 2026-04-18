import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.config import settings
from app.database import engine, async_session
from app.models import Base
from app.models.user import User
from app.models.location import Location
from app.services.auth_service import hash_password
from app.routers import (
    audit,
    auth,
    cash_drawer,
    dashboard,
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

logger = logging.getLogger(__name__)

app = FastAPI(title=settings.app_name, version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
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

SEED_LOCATIONS = [
    {"name": "Six Beans - Apple Valley", "address": "21788 Bear Valley Rd", "city": "Apple Valley", "state": "CA", "zip_code": "92308", "phone": "(760) 946-9008"},
    {"name": "Six Beans - Hesperia", "address": "15760 Ranchero Rd", "city": "Hesperia", "state": "CA", "zip_code": "92345", "phone": "(760) 948-0164"},
    {"name": "Six Beans - Barstow", "address": "921 Barstow Rd", "city": "Barstow", "state": "CA", "zip_code": "92311", "phone": "(760) 229-0997"},
    {"name": "Six Beans - Victorville", "address": "12875 Bear Valley Rd", "city": "Victorville", "state": "CA", "zip_code": "92392", "phone": "(760) 983-5028"},
    {"name": "Six Beans - Apple Valley (Yucca Loma)", "address": "13730 Apple Valley Rd", "city": "Apple Valley", "state": "CA", "zip_code": "92307", "phone": "(442) 292-2185"},
]


@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as session:
        # Update existing locations to real addresses
        existing_locs = (await session.execute(select(Location))).scalars().all()
        if existing_locs and existing_locs[0].city != "Apple Valley":
            logger.info("Updating locations to real addresses...")
            for i, loc in enumerate(existing_locs):
                if i < len(SEED_LOCATIONS):
                    for key, val in SEED_LOCATIONS[i].items():
                        setattr(loc, key, val)
            # Remove extra placeholder locations (had 6, now have 5)
            for loc in existing_locs[len(SEED_LOCATIONS):]:
                await session.delete(loc)
            await session.commit()
            logger.info("Locations updated.")

        result = await session.execute(select(User).limit(1))
        if result.scalar_one_or_none() is not None:
            return

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
        ))
        await session.commit()
        logger.info("Seed complete — 6 locations, 2 owner accounts.")


@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "app": settings.app_name}
