"""Canonical Six Beans employee roster — the source of truth used by
/api/users/reconcile to repair drift in the users / user_locations tables.

Per the owner: 'SIX BEANS COFFEE CO' in the source spreadsheet means
Apple Valley flagship.
"""

# Maps Homebase / spreadsheet location strings to DB location names.
LOCATION_MAP = {
    "Six Beans Coffee Apple Valley": "Six Beans - Apple Valley",
    "Six Beans Coffee Ranchero": "Six Beans - Hesperia",
    "Barstow Six Beans": "Six Beans - Barstow",
    "Six Beans Victorville": "Six Beans - Victorville",
    "Six Beans Coffee Yucca Loma": "Six Beans - Apple Valley (Yucca Loma)",
    "Six Beans Coffee Co 7th Street": "Six Beans - Victorville (7th St)",
    "SIX BEANS COFFEE CO": "Six Beans - Apple Valley",
}


# (first, last, email, phone, location_key, role, pin)
# Email '' means no email — we generate a placeholder.
CANONICAL_ROSTER: list[tuple[str, str, str, str, str, str, str]] = [
    ("abbey", "", "abigailautumnremi06@gmail.com", "7609576233", "Barstow Six Beans", "Employee", "0640"),
    ("Abby", "Nicklason", "abigail.nicklason1@gmail.com", "7608850407", "SIX BEANS COFFEE CO", "Employee", "0407"),
    ("Abigail", "Thomas", "abigail22507@hotmail.com", "4422437004", "SIX BEANS COFFEE CO", "Employee", "7216"),
    ("Adelia", "Aguilar", "adeliasarah@gmail.com", "7606841286", "SIX BEANS COFFEE CO", "Manager", "0305"),
    ("Alexia", "Tinajero", "alexiatinajero02@gmail.com", "7604027940", "SIX BEANS COFFEE CO", "Employee", "0464"),
    ("Ally", "Allaway", "ally.allaway@gmail.com", "7604127291", "SIX BEANS COFFEE CO", "Manager", "7802"),
    ("Alyssa", "Miranda", "alysxmarie@gmail.com", "7606865760", "SIX BEANS COFFEE CO", "Employee", "3177"),
    ("Amelie", "Hernandez", "amelie.velle.hernandez@gmail.com", "4424897287", "Six Beans Coffee Co 7th Street", "Employee", "7026"),
    ("Anthony", "Monroy", "a.monroybcc@gmail.com", "4424469163", "Barstow Six Beans", "Manager", "4841"),
    ("Arianna", "Rizzardi", "arizzardi1206@gmail.com", "7605150064", "Six Beans Coffee Yucca Loma", "Employee", "6127"),
    ("Aura", "Ramirez", "auraampie101@gmail.com", "7608408934", "Six Beans Coffee Co 7th Street", "Employee", "7888"),
    ("Autumn", "Hicks", "", "8402627141", "Six Beans Coffee Ranchero", "Employee", "7534"),
    ("Bellicia", "Telles", "belliciatelles@gmail.com", "7608770199", "Barstow Six Beans", "Employee", "0484"),
    ("Britney", "Solis", "britneysolis14@gmail.com", "6264561739", "Six Beans Victorville", "Employee", "7762"),
    ("Cali", "Daggy", "calidaggy23@icloud.com", "7609985386", "Six Beans Coffee Yucca Loma", "Employee", "6343"),
    ("Chloe", "Nicklason", "chloe.nicklason@gmail.com", "7608819560", "SIX BEANS COFFEE CO", "Employee", "9560"),
    ("Christian", "Solis", "csolis1405@gmail.com", "7609853699", "Six Beans Coffee Co 7th Street", "Employee", "8147"),
    ("Ciara", "Youngs", "ciarayoungs77@gmail.com", "7604027731", "Six Beans Victorville", "Manager", "5511"),
    ("Cristina", "Sandoval", "cristinassandoval@icloud.com", "7608102226", "Six Beans Coffee Co 7th Street", "Employee", "2226"),
    ("Daniel", "Gonzalez", "gonzalezdaniela1529@gmail.com", "7607920105", "Six Beans Victorville", "Employee", "4733"),
    ("dejanae", "matai", "", "4422955312", "Barstow Six Beans", "Employee", "2352"),
    ("Delilah", "Castillo", "delicast36865@gmail.com", "7607160574", "Barstow Six Beans", "Employee", "3528"),
    ("Elizabeth", "Hernandez", "elizabethm.hernandezz@gmail.com", "7606437968", "Six Beans Coffee Co 7th Street", "Employee", "5278"),
    ("Emily", "Espinoza", "03.espinozaemily@gmail.com", "3236277563", "Six Beans Coffee Ranchero", "Employee", "8445"),
    ("Gaby", "Contreras", "kimygaby22@gmail.com", "7608186901", "Barstow Six Beans", "Employee", "6123"),
    ("Giada", "Sadach", "giadasadach15@gmail.com", "7602201285", "Six Beans Coffee Co 7th Street", "Employee", "7127"),
    ("Gustavo", "Herrera Jr.", "gtherrera117@gmail.com", "3104619463", "Six Beans Victorville", "Employee", "5454"),
    ("Hannah", "Hough", "hannahphough22@gmail.com", "7606287950", "SIX BEANS COFFEE CO", "Employee", "1728"),
    ("Isabella", "Hodson", "", "7605522922", "Six Beans Coffee Yucca Loma", "Manager", "4216"),
    ("Janay", "Dumas", "dumas.janay@gmail.com", "7708565796", "Six Beans Coffee Co 7th Street", "Employee", "8687"),
    ("Jayden", "Gutierrez", "jay1sabel9@gmail.com", "7604902821", "SIX BEANS COFFEE CO", "Employee", "6381"),
    ("Johanna", "Munoz", "jmunoz3263@gmail.com", "9097450985", "Six Beans Victorville", "Employee", "7703"),
    ("Jose", "Ponce", "jp327256@gmail.com", "9253540887", "SIX BEANS COFFEE CO", "Employee", "3064"),
    ("Julia", "Fernandez", "bayles1008@gmail.com", "7603389500", "Six Beans Coffee Ranchero", "Employee", "7782"),
    ("Juliana", "Estrada", "julianasofiaestrada@gmail.com", "7606629083", "Six Beans Coffee Yucca Loma", "Employee", "4422"),
    ("Kaitlin", "Privett", "kaitlinprivett@gmail.com", "7607132795", "Six Beans Victorville", "Employee", "7708"),
    ("Karlie", "West", "westkarlie2@gmail.com", "9095593918", "Six Beans Coffee Yucca Loma", "Employee", "0044"),
    ("Kiley", "Reason", "kileyreason10@gmail.com", "7604906997", "Six Beans Coffee Yucca Loma", "Manager", "0672"),
    ("Kiley", "Wendt", "xkwendt@gmail.com", "5309052500", "Six Beans Victorville", "Employee", "5112"),
    ("Kristen", "Banuelos", "kristenbanuelos89@gmail.com", "7602977416", "Six Beans Coffee Ranchero", "Employee", "4158"),
    ("Lilly", "Hernanadez", "lrhernandez467@gmail.com", "7608124958", "Six Beans Coffee Ranchero", "Employee", "7640"),
    ("Maddie", "Gonzalez", "gmadison248@gmail.com", "7609560472", "Six Beans Coffee Co 7th Street", "Employee", "0281"),
    ("Madie", "Braden", "", "9094410428", "Six Beans Coffee Ranchero", "Employee", "3372"),
    ("Madison", "Payne", "maddypayne02@gmail.com", "9092785564", "Six Beans Coffee Yucca Loma", "Employee", "8813"),
    ("Makayla", "Lowery", "makaylalowery01@gmail.com", "7608818431", "SIX BEANS COFFEE CO", "Employee", "5162"),
    ("Makayla", "Hazard", "makhazard@gmail.com", "7606841067", "Six Beans Coffee Yucca Loma", "Employee", "4226"),
    ("Mia", "Palumbo", "miapalumbo06@gmail.com", "6265516767", "SIX BEANS COFFEE CO", "Employee", "7001"),
    ("Micah", "Nicklason", "mchnksn06@gmail.com", "7604880421", "Six Beans Coffee Co 7th Street", "Employee", "8268"),
    ("Mylie", "Shepard", "mylieshepard44@gmail.com", "7608818872", "Six Beans Coffee Yucca Loma", "Employee", "4727"),
    ("Natalie", "Soto", "n4741ie1.1@gmail.com", "4422434539", "Six Beans Coffee Co 7th Street", "Employee", "7107"),
    ("Payton", "Raney", "paytonraney38@gmail.com", "9099384625", "Six Beans Coffee Ranchero", "Employee", "3440"),
    ("Sofia", "Herrarte", "sofiaherrarte0@gmail.com", "8189794099", "Six Beans Coffee Co 7th Street", "Employee", "0426"),
    ("Zamantha", "Limon", "zamanthalimon1@gmail.com", "9513573113", "Six Beans Coffee Co 7th Street", "Manager", "6444"),
    ("Zoey", "Hines", "zhines5233@gmail.com", "7605529774", "Six Beans Coffee Co 7th Street", "Employee", "4535"),
]


ROLE_MAP = {"Owner": "owner", "Manager": "manager", "Employee": "employee"}


def placeholder_email(first: str, last: str) -> str:
    return f"{first.lower().replace(' ', '')}.{last.lower().replace(' ', '')}@placeholder.sixbeans.local"


def normalized_roster() -> list[dict]:
    """Return canonical roster as dicts with resolved email + role."""
    out = []
    for first, last, email, phone, loc_key, perm, pin in CANONICAL_ROSTER:
        e = email.strip() or placeholder_email(first, last)
        out.append({
            "first_name": first.strip(),
            "last_name": last.strip(),
            "email": e.lower(),
            "phone": phone.strip() or None,
            "location_key": loc_key,
            "role": ROLE_MAP.get(perm, "employee"),
            "pin_last_four": pin.strip()[-4:],
        })
    return out
