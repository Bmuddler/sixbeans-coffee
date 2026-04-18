"""Bulk import employees from Homebase CSV data (hardcoded)."""

import logging

from sqlalchemy import select, func, insert

from app.models.user import User, user_locations
from app.models.location import Location
from app.services.auth_service import hash_password

logger = logging.getLogger(__name__)

# Location name mapping: CSV name -> database name
LOCATION_MAP = {
    "Barstow Six Beans": "Six Beans - Barstow",
    "SIX BEANS COFFEE CO": "Six Beans - Apple Valley",
    "Six Beans Victorville": "Six Beans - Victorville",
    "Six Beans Coffee Yucca Loma": "Six Beans - Apple Valley (Yucca Loma)",
    "Six Beans Coffee Ranchero": "Six Beans - Hesperia",
    "Six Beans Coffee Co 7th Street": "Six Beans - Victorville (7th St)",
}

# Permission level mapping: CSV permission -> database role
ROLE_MAP = {
    "Employee": "employee",
    "Manager": "manager",
    "General Manager": "owner",
}

# All employees extracted from Homebase CSV export.
# Rows with empty first_name represent additional location assignments
# for the previous employee (multi-location employees).
EMPLOYEES = [
    {"first_name": "abbey", "last_name": "", "email": "abigailautumnremi06@gmail.com", "phone": "7609576233", "location": "Barstow Six Beans", "permission": "Employee", "pin": "360640"},
    {"first_name": "Abby", "last_name": "Nicklason", "email": "abigail.nicklason1@gmail.com", "phone": "7608850407", "location": "SIX BEANS COFFEE CO", "permission": "Employee", "pin": "850407"},
    {"first_name": "Abigail", "last_name": "Thomas", "email": "abigail22507@hotmail.com", "phone": "4422437004", "location": "SIX BEANS COFFEE CO", "permission": "Employee", "pin": "347216"},
    {"first_name": "Adelia", "last_name": "Aguilar", "email": "adeliasarah@gmail.com", "phone": "7606841286", "location": "SIX BEANS COFFEE CO", "permission": "Manager", "pin": "600305"},
    {"first_name": "Alexia", "last_name": "Tinajero", "email": "alexiatinajero02@gmail.com", "phone": "7604027940", "location": "SIX BEANS COFFEE CO", "permission": "Employee", "pin": "000464"},
    {"first_name": "Alissa", "last_name": "Pineda", "email": "alissapineda2003@gmail.com", "phone": "7609279349", "location": "Six Beans Victorville", "permission": "Manager", "pin": "756257"},
    {"first_name": "Ally", "last_name": "Allaway", "email": "ally.allaway@gmail.com", "phone": "7604127291", "location": "SIX BEANS COFFEE CO", "permission": "Manager", "pin": "357802"},
    {"first_name": "Alyssa", "last_name": "Miranda", "email": "alysxmarie@gmail.com", "phone": "7606865760", "location": "SIX BEANS COFFEE CO", "permission": "Employee", "pin": "213177"},
    {"first_name": "Amelie", "last_name": "Hernandez", "email": "amelie.velle.hernandez@gmail.com", "phone": "4424897287", "location": "Six Beans Coffee Co 7th Street", "permission": "Employee", "pin": "7026"},
    {"first_name": "", "last_name": "", "email": "", "phone": "", "location": "Six Beans Victorville", "permission": "Employee", "pin": "702611"},
    {"first_name": "Anthony", "last_name": "Monroy", "email": "a.monroybcc@gmail.com", "phone": "4424469163", "location": "Barstow Six Beans", "permission": "Manager", "pin": "404841"},
    {"first_name": "Arianna", "last_name": "Rizzardi", "email": "arizzardi1206@gmail.com", "phone": "7605150064", "location": "Six Beans Coffee Yucca Loma", "permission": "Employee", "pin": "516127"},
    {"first_name": "Aura", "last_name": "Ramirez", "email": "auraampie101@gmail.com", "phone": "7608408934", "location": "Six Beans Coffee Co 7th Street", "permission": "Employee", "pin": "7888"},
    {"first_name": "Autumn", "last_name": "Hicks", "email": "", "phone": "8402627141", "location": "Six Beans Coffee Ranchero", "permission": "Employee", "pin": "167534"},
    {"first_name": "Britney", "last_name": "Solis", "email": "britneysolis14@gmail.com", "phone": "6264561739", "location": "Six Beans Victorville", "permission": "Employee", "pin": "647762"},
    {"first_name": "Cali", "last_name": "Daggy", "email": "calidaggy23@icloud.com", "phone": "7609985386", "location": "Six Beans Coffee Yucca Loma", "permission": "Employee", "pin": "646343"},
    {"first_name": "Chloe", "last_name": "Nicklason", "email": "chloe.nicklason@gmail.com", "phone": "7608819560", "location": "SIX BEANS COFFEE CO", "permission": "Employee", "pin": "819560"},
    {"first_name": "Christian", "last_name": "Solis", "email": "csolis1405@gmail.com", "phone": "7609853699", "location": "Six Beans Coffee Co 7th Street", "permission": "Employee", "pin": "8147"},
    {"first_name": "Ciara", "last_name": "Youngs", "email": "ciarayoungs77@gmail.com", "phone": "7604027731", "location": "Six Beans Victorville", "permission": "Manager", "pin": "705511"},
    {"first_name": "Cristina", "last_name": "Sandoval", "email": "cristinassandoval@icloud.com", "phone": "7608102226", "location": "Six Beans Coffee Co 7th Street", "permission": "Employee", "pin": "2226"},
    {"first_name": "Daniel", "last_name": "Gonzalez", "email": "gonzalezdaniela1529@gmail.com", "phone": "7607920105", "location": "Six Beans Victorville", "permission": "Employee", "pin": "254733"},
    {"first_name": "dejanae", "last_name": "matai", "email": "", "phone": "4422955312", "location": "Barstow Six Beans", "permission": "Employee", "pin": "412352"},
    {"first_name": "Delilah", "last_name": "Castillo", "email": "delicast36865@gmail.com", "phone": "7607160574", "location": "Barstow Six Beans", "permission": "Employee", "pin": "063528"},
    {"first_name": "Elizabeth", "last_name": "Hernandez", "email": "elizabethm.hernandezz@gmail.com", "phone": "7606437968", "location": "Six Beans Coffee Co 7th Street", "permission": "Employee", "pin": "3441"},
    {"first_name": "", "last_name": "", "email": "", "phone": "", "location": "Six Beans Victorville", "permission": "Employee", "pin": "344111"},
    {"first_name": "Emily", "last_name": "Espinoza", "email": "03.espinozaemily@gmail.com", "phone": "3236277563", "location": "Six Beans Coffee Ranchero", "permission": "Employee", "pin": "158445"},
    {"first_name": "Gaby", "last_name": "Contreras", "email": "kimygaby22@gmail.com", "phone": "7608186901", "location": "Barstow Six Beans", "permission": "Employee", "pin": "166123"},
    {"first_name": "Giada", "last_name": "Sadach", "email": "giadasadach15@gmail.com", "phone": "7602201285", "location": "Six Beans Coffee Co 7th Street", "permission": "Employee", "pin": "7127"},
    {"first_name": "Gustavo", "last_name": "Herrera Jr.", "email": "gtherrera117@gmail.com", "phone": "3104619463", "location": "Six Beans Victorville", "permission": "Employee", "pin": "875454"},
    {"first_name": "Hannah", "last_name": "Hough", "email": "hannahphough22@gmail.com", "phone": "7606287950", "location": "SIX BEANS COFFEE CO", "permission": "Employee", "pin": "801728"},
    {"first_name": "Isabella", "last_name": "Hodson", "email": "", "phone": "7605522922", "location": "Six Beans Coffee Yucca Loma", "permission": "Manager", "pin": "814216"},
    {"first_name": "", "last_name": "", "email": "", "phone": "", "location": "Six Beans Coffee Ranchero", "permission": "Manager", "pin": "814216"},
    {"first_name": "Janay", "last_name": "Dumas", "email": "dumas.janay@gmail.com", "phone": "7708565796", "location": "Six Beans Victorville", "permission": "Employee", "pin": "868722"},
    {"first_name": "Jayden", "last_name": "Gutierrez", "email": "jay1sabel9@gmail.com", "phone": "7604902821", "location": "SIX BEANS COFFEE CO", "permission": "Employee", "pin": "286381"},
    {"first_name": "Johanna", "last_name": "Munoz", "email": "jmunoz3263@gmail.com", "phone": "9097450985", "location": "Six Beans Victorville", "permission": "Employee", "pin": "167703"},
    {"first_name": "Jose", "last_name": "Ponce", "email": "jp327256@gmail.com", "phone": "9253540887", "location": "SIX BEANS COFFEE CO", "permission": "Employee", "pin": "853064"},
    {"first_name": "Julia", "last_name": "Fernandez", "email": "bayles1008@gmail.com", "phone": "7603389500", "location": "Six Beans Coffee Ranchero", "permission": "Employee", "pin": "057782"},
    {"first_name": "Juliana", "last_name": "Estrada", "email": "julianasofiaestrada@gmail.com", "phone": "7606629083", "location": "Six Beans Coffee Yucca Loma", "permission": "Employee", "pin": "774422"},
    {"first_name": "Kailee", "last_name": "Villatoro", "email": "", "phone": "7607137523", "location": "Six Beans Victorville", "permission": "Employee", "pin": "187647"},
    {"first_name": "Kaitlin", "last_name": "Privett", "email": "kaitlinprivett@gmail.com", "phone": "7607132795", "location": "Six Beans Victorville", "permission": "Employee", "pin": "587708"},
    {"first_name": "Karlie", "last_name": "West", "email": "westkarlie2@gmail.com", "phone": "9095593918", "location": "Six Beans Coffee Yucca Loma", "permission": "Employee", "pin": "670044"},
    {"first_name": "Kiley", "last_name": "Reason", "email": "kileyreason10@gmail.com", "phone": "7604906997", "location": "Six Beans Coffee Yucca Loma", "permission": "Manager", "pin": "220672"},
    {"first_name": "", "last_name": "", "email": "", "phone": "", "location": "Six Beans Coffee Ranchero", "permission": "Manager", "pin": "220672"},
    {"first_name": "Kiley", "last_name": "Wendt", "email": "xkwendt@gmail.com", "phone": "5309052500", "location": "Six Beans Victorville", "permission": "Employee", "pin": "055112"},
    {"first_name": "Kristen", "last_name": "Banuelos", "email": "kristenbanuelos89@gmail.com", "phone": "7602977416", "location": "Six Beans Coffee Ranchero", "permission": "Employee", "pin": "854158"},
    {"first_name": "Lilly", "last_name": "Hernanadez", "email": "lrhernandez467@gmail.com", "phone": "7608124958", "location": "Six Beans Coffee Ranchero", "permission": "Employee", "pin": "017640"},
    {"first_name": "Maddie", "last_name": "Gonzalez", "email": "gmadison248@gmail.com", "phone": "7609560472", "location": "Six Beans Coffee Co 7th Street", "permission": "Employee", "pin": "0281"},
    {"first_name": "Madie", "last_name": "Braden", "email": "", "phone": "9094410428", "location": "Six Beans Coffee Ranchero", "permission": "Employee", "pin": "013372"},
    {"first_name": "Madison", "last_name": "Payne", "email": "maddypayne02@gmail.com", "phone": "9092785564", "location": "Six Beans Coffee Yucca Loma", "permission": "Employee", "pin": "208813"},
    {"first_name": "Makayla", "last_name": "Hazard", "email": "makhazard@gmail.com", "phone": "7606841067", "location": "Six Beans Coffee Yucca Loma", "permission": "Employee", "pin": "714226"},
    {"first_name": "Makayla", "last_name": "Lowery", "email": "makaylalowery01@gmail.com", "phone": "7608818431", "location": "SIX BEANS COFFEE CO", "permission": "Employee", "pin": "525162"},
    {"first_name": "Mia", "last_name": "Palumbo", "email": "miapalumbo06@gmail.com", "phone": "6265516767", "location": "SIX BEANS COFFEE CO", "permission": "Employee", "pin": "877001"},
    {"first_name": "Micah", "last_name": "Nicklason", "email": "mchnksn06@gmail.com", "phone": "7604880421", "location": "Six Beans Coffee Co 7th Street", "permission": "Employee", "pin": "8268"},
    {"first_name": "", "last_name": "", "email": "", "phone": "", "location": "SIX BEANS COFFEE CO", "permission": "Employee", "pin": "338268"},
    {"first_name": "", "last_name": "", "email": "", "phone": "", "location": "Six Beans Victorville", "permission": "Employee", "pin": "721674"},
    {"first_name": "Mylie", "last_name": "Shepard", "email": "mylieshepard44@gmail.com", "phone": "7608818872", "location": "Six Beans Coffee Yucca Loma", "permission": "Employee", "pin": "254727"},
    {"first_name": "Natalie", "last_name": "Soto", "email": "n4741ie1.1@gmail.com", "phone": "4422434539", "location": "Six Beans Coffee Co 7th Street", "permission": "Employee", "pin": "7107"},
    {"first_name": "", "last_name": "", "email": "", "phone": "", "location": "Six Beans Victorville", "permission": "Employee", "pin": "887107"},
    {"first_name": "Nici", "last_name": "Pena", "email": "nici.pena105@gmail.com", "phone": "9092146194", "location": "Six Beans Coffee Co 7th Street", "permission": "Employee", "pin": "8324"},
    {"first_name": "Payton", "last_name": "Raney", "email": "paytonraney38@gmail.com", "phone": "9099384625", "location": "Six Beans Coffee Ranchero", "permission": "Employee", "pin": "143440"},
    {"first_name": "Sofia", "last_name": "Herrarte", "email": "sofiaherrarte0@gmail.com", "phone": "8189794099", "location": "Six Beans Coffee Co 7th Street", "permission": "Employee", "pin": "0426"},
    {"first_name": "Zamantha", "last_name": "Limon", "email": "zamanthalimon1@gmail.com", "phone": "9513573113", "location": "Six Beans Coffee Co 7th Street", "permission": "Manager", "pin": "6444"},
    {"first_name": "Zoey", "last_name": "Hines", "email": "zhines5233@gmail.com", "phone": "7605529774", "location": "Six Beans Coffee Co 7th Street", "permission": "Employee", "pin": "4535"},
]


def _extract_pin_last_four(pin_raw: str) -> str:
    """Extract last 4 digits of PIN, stripping quotes and apostrophes."""
    cleaned = pin_raw.strip().strip("'").strip('"').lstrip("'")
    return cleaned[-4:] if len(cleaned) >= 4 else cleaned.zfill(4)


async def seed_employees(session):
    """Seed employees from hardcoded Homebase CSV data.

    Skips if more than 2 users already exist (the 2 owners).
    Updates existing owner accounts (logcastles@gmail.com, jessica@sixbeanscoffee.com)
    with CSV data instead of creating duplicates.
    """
    # Check if employees already seeded (more than the 2 initial owners)
    user_count_result = await session.execute(select(func.count(User.id)))
    user_count = user_count_result.scalar()
    if user_count > 2:
        logger.info("Employee seed skipped — %d users already exist.", user_count)
        return

    # Build location name -> id lookup
    locations_result = await session.execute(select(Location))
    all_locations = locations_result.scalars().all()
    location_lookup = {loc.name: loc.id for loc in all_locations}

    hashed_pw = hash_password("123456789")

    # Process rows: group primary employees and their additional location rows
    parsed_employees = []  # list of (employee_dict, [location_names])
    current_employee = None
    current_locations = []

    for row in EMPLOYEES:
        if row["first_name"]:
            # Save previous employee if exists
            if current_employee is not None:
                parsed_employees.append((current_employee, current_locations))
            current_employee = row
            current_locations = [row["location"]]
        else:
            # Additional location for current employee
            if current_employee is not None:
                current_locations.append(row["location"])

    # Don't forget the last employee
    if current_employee is not None:
        parsed_employees.append((current_employee, current_locations))

    created_count = 0
    updated_count = 0

    for emp, loc_names in parsed_employees:
        email = emp["email"].strip()
        first_name = emp["first_name"].strip()
        last_name = emp["last_name"].strip()
        phone = emp["phone"].strip() or None
        role = ROLE_MAP.get(emp["permission"], "employee")
        pin = _extract_pin_last_four(emp["pin"])

        # Skip rows with no email AND no first_name (like TAPMANGO)
        if not email and not first_name:
            continue

        # Resolve location IDs
        resolved_location_ids = []
        for loc_csv_name in loc_names:
            loc_csv_name = loc_csv_name.strip()
            db_name = LOCATION_MAP.get(loc_csv_name)
            if db_name and db_name in location_lookup:
                resolved_location_ids.append(location_lookup[db_name])
            else:
                logger.warning("Unknown location mapping: '%s'", loc_csv_name)

        # Check if user already exists by email (avoid duplicates)
        if email:
            result = await session.execute(select(User).where(User.email == email))
            if result.scalar_one_or_none() is not None:
                logger.info("Skipping duplicate email: %s", email)
                continue

        # For employees without email, generate a placeholder
        if not email:
            placeholder = f"{first_name.lower().replace(' ', '')}.{last_name.lower().replace(' ', '')}@placeholder.sixbeans.local"
            email = placeholder

        new_user = User(
            email=email,
            first_name=first_name,
            last_name=last_name,
            phone=phone,
            pin_last_four=pin,
            hashed_password=hashed_pw,
            role=role,
            is_active=True,
        )
        session.add(new_user)
        await session.flush()

        for loc_id in resolved_location_ids:
            await session.execute(
                insert(user_locations).values(user_id=new_user.id, location_id=loc_id)
            )
        created_count += 1

    await session.commit()
    logger.info(
        "Employee seed complete — %d created, %d updated.",
        created_count,
        updated_count,
    )
