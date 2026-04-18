"""Seed the database with initial data: 6 locations and owner accounts."""
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.config import settings
from app.database import _get_async_url
from app.models import Base
from app.models.user import User
from app.models.location import Location
from app.services.auth_service import hash_password


LOCATIONS = [
    {"name": "Six Beans - Downtown", "address": "123 Main St", "city": "San Diego", "state": "CA", "zip_code": "92101", "phone": "(619) 555-0101"},
    {"name": "Six Beans - Hillcrest", "address": "456 University Ave", "city": "San Diego", "state": "CA", "zip_code": "92103", "phone": "(619) 555-0102"},
    {"name": "Six Beans - North Park", "address": "789 30th St", "city": "San Diego", "state": "CA", "zip_code": "92104", "phone": "(619) 555-0103"},
    {"name": "Six Beans - Pacific Beach", "address": "321 Garnet Ave", "city": "San Diego", "state": "CA", "zip_code": "92109", "phone": "(619) 555-0104"},
    {"name": "Six Beans - La Jolla", "address": "654 Prospect St", "city": "La Jolla", "state": "CA", "zip_code": "92037", "phone": "(858) 555-0105"},
    {"name": "Six Beans - Encinitas", "address": "987 Coast Hwy 101", "city": "Encinitas", "state": "CA", "zip_code": "92024", "phone": "(760) 555-0106"},
]


async def seed():
    engine = create_async_engine(_get_async_url(settings.database_url))

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        locations = []
        for loc_data in LOCATIONS:
            loc = Location(**loc_data, is_active=True)
            session.add(loc)
            locations.append(loc)

        owner1 = User(
            email="logcastles@gmail.com",
            first_name="Owner",
            last_name="Admin",
            phone="5555550100",
            pin_last_four="0100",
            hashed_password=hash_password("Sixb3ans12!"),
            role="owner",
            is_active=True,
        )
        owner2 = User(
            email="jessica@sixbeanscoffee.com",
            first_name="Jessica",
            last_name="Admin",
            phone="5555550200",
            pin_last_four="0200",
            hashed_password=hash_password("Sixb3ans12!"),
            role="owner",
            is_active=True,
        )
        session.add(owner1)
        session.add(owner2)

        await session.commit()
        print(f"Seeded {len(locations)} locations and 2 owner accounts.")
        print("Owner 1: logcastles@gmail.com")
        print("Owner 2: jessica@sixbeanscoffee.com")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
