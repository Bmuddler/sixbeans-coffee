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
    {"name": "Six Beans - Downtown", "address": "123 Main St", "city": "San Diego", "state": "CA", "zip_code": "92101", "phone": "(619) 555-0101"},
    {"name": "Six Beans - Hillcrest", "address": "456 University Ave", "city": "San Diego", "state": "CA", "zip_code": "92103", "phone": "(619) 555-0102"},
    {"name": "Six Beans - North Park", "address": "789 30th St", "city": "San Diego", "state": "CA", "zip_code": "92104", "phone": "(619) 555-0103"},
    {"name": "Six Beans - Pacific Beach", "address": "321 Garnet Ave", "city": "San Diego", "state": "CA", "zip_code": "92109", "phone": "(619) 555-0104"},
    {"name": "Six Beans - La Jolla", "address": "654 Prospect St", "city": "La Jolla", "state": "CA", "zip_code": "92037", "phone": "(858) 555-0105"},
    {"name": "Six Beans - Encinitas", "address": "987 Coast Hwy 101", "city": "Encinitas", "state": "CA", "zip_code": "92024", "phone": "(760) 555-0106"},
]


@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as session:
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
