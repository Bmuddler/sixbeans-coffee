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
    {"name": "Six Beans - Apple Valley", "address": "21788 Bear Valley Rd", "city": "Apple Valley", "state": "CA", "zip_code": "92308", "phone": "(760) 946-9008"},
    {"name": "Six Beans - Hesperia", "address": "15760 Ranchero Rd", "city": "Hesperia", "state": "CA", "zip_code": "92345", "phone": "(760) 948-0164"},
    {"name": "Six Beans - Barstow", "address": "921 Barstow Rd", "city": "Barstow", "state": "CA", "zip_code": "92311", "phone": "(760) 229-0997"},
    {"name": "Six Beans - Victorville", "address": "12875 Bear Valley Rd", "city": "Victorville", "state": "CA", "zip_code": "92392", "phone": "(760) 983-5028"},
    {"name": "Six Beans - Apple Valley (Yucca Loma)", "address": "13730 Apple Valley Rd", "city": "Apple Valley", "state": "CA", "zip_code": "92307", "phone": "(442) 292-2185"},
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
