"""Seed US Foods shop mappings and product catalog."""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.usfoods import USFoodsProduct, USFoodsShopMapping

logger = logging.getLogger(__name__)

SHOP_MAPPINGS = [
    {"us_foods_account_name": "Adelia Aguilar", "customer_number": "74284720", "match_keywords": "adelia,bakery", "is_routing_alias": True, "notes": "Routes to Ranchero/Hesperia account"},
    {"us_foods_account_name": "Six Bean Coffee Apple Valley", "customer_number": "64240757", "match_keywords": "apple valley", "is_routing_alias": False},
    {"us_foods_account_name": "Six Bean Coffee Barstow", "customer_number": "54330857", "match_keywords": "barstow", "is_routing_alias": False},
    {"us_foods_account_name": "Six Bean Coffee Hesperia", "customer_number": "74284720", "match_keywords": "ranchero,hesperia", "is_routing_alias": False},
    {"us_foods_account_name": "Six Bean Coffee Victorvil", "customer_number": "84371863", "match_keywords": "topaz,victorville", "is_routing_alias": False},
    {"us_foods_account_name": "Six Bean Coffee Yucca Lom", "customer_number": "24417636", "match_keywords": "yucca loma,yucca", "is_routing_alias": False},
    {"us_foods_account_name": "Six Bean Coffee 7th St", "customer_number": "14495147", "match_keywords": "7th,zamantha", "is_routing_alias": False},
]

PRODUCTS = [
    {"product_number": "1044889", "description": "FLOUR, ALL-PURPOSE HOTEL and RESTAURANT FINE BLEACHED ENRICHED BAG", "brand": "MONARCH", "pack_size": "25 LB", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "1045280", "description": "CHIP, POTATO KETTLE-COOKED BBQ GLUTEN-FREE BAG", "brand": "METRO DELI", "pack_size": "60/1.38 OZ", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "1063371", "description": "MILK SUB, OAT ASEPTIC CARTON SHELF STABLE BARISTA BLEND", "brand": "CALIFIA FARMS", "pack_size": "12/32 OZ", "storage_class": None, "default_unit": "CS"},
    {"product_number": "1195137", "description": "CHEESE, CHEDDAR MILD HICKORY SMOKED SLICED .75 OZ TWIN PACK REF", "brand": "METRO DELI", "pack_size": "4/1.5 LB", "storage_class": "REF 33 - 40 DAIRY", "default_unit": "CS"},
    {"product_number": "1329903", "description": "SALT, TABLE NOT IODIZED BAG", "brand": "MONARCH", "pack_size": "25 LB", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "1331339", "description": "TOMATO, ROUND 6X6 #1 GRADE FRESH REF BULK", "brand": "CROSS VALLEY FARMS", "pack_size": "25 LB", "storage_class": "REF 51 - 70", "default_unit": "CS"},
    {"product_number": "1345057", "description": "BLUEBERRY, DOMESTIC CULTIVATED IQF FROZEN", "brand": "MONARCH", "pack_size": "30 LB", "storage_class": "FROZEN  0", "default_unit": "CS"},
    {"product_number": "1627207", "description": "SUGAR, POWDERED CONFECTIONER WHITE 6X CANE BAG", "brand": "MONARCH", "pack_size": "25 LB", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "1627215", "description": "SUGAR, POWDERED CONFECTIONER 10X CANE", "brand": "MONARCH", "pack_size": "12/2 LB", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "1873405", "description": "GLOVE, POLY LARGE CLEAR STRAIGHT CUFF EMBOSSED AMBIDEXTROUS", "brand": "MONOGRAM", "pack_size": "4/500 EA", "storage_class": "DRY NONFOOD", "default_unit": "CS"},
    {"product_number": "1904788", "description": "TURKEY, BREAST SLICED SKINLESS COOKED OVEN ROASTED REF", "brand": "BUTTERBALL", "pack_size": "12/1 LB", "storage_class": "REF 33 - 40 NOT RAW", "default_unit": "CS"},
    {"product_number": "1990175", "description": "JUICE, APPLE 100% PLASTIC BOTTLE SHELF STABLE", "brand": "TREE TOP", "pack_size": "8/64 OZ", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "2015881", "description": "TOMATO, #2 GRADE ROUND BULK FRESH REF", "brand": "PACKER", "pack_size": "25 LB", "storage_class": "REF 51 - 70", "default_unit": "CS"},
    {"product_number": "2220853", "description": "PEANUT BUTTER, CREAMY CAN SHELF STABLE", "brand": "JIF", "pack_size": "6/64 OZ", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "2310720", "description": "JUICE, ORANGE 100% BAR PACK PLASTIC BOTTLE SHELF STABLE", "brand": "OCEAN SPRAY", "pack_size": "12/32 OZ", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "2331353", "description": "TOMATO, ROUND 5X6 #1 GRADE FRESH REF BULK", "brand": "CROSS VALLEY FARMS", "pack_size": "25 LB", "storage_class": "REF 51 - 70", "default_unit": "CS"},
    {"product_number": "2334043", "description": "SAUCE, PASTA PESTO BASIL TUB FROZEN TRADITIONAL", "brand": "ROSELI", "pack_size": "3/2 LB", "storage_class": "FROZEN  0", "default_unit": "CS"},
    {"product_number": "2477933", "description": "BACON, PORK 150 COUNT SLICED LAID OUT APPLEWOOD SMOKED CURED COOKED REF VAC", "brand": "PATUXENT FARMS", "pack_size": "2/150 EA", "storage_class": "REF 33 - 40 NOT RAW", "default_unit": "CS"},
    {"product_number": "2634442", "description": "WALNUT, HALF and PIECE UNSALTED RAW SHELL OFF BAG SHELF STABLE NUT", "brand": "MONARCH", "pack_size": "5 LB", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "2856370", "description": "MILK, 2% REDUCED FAT PASTEURIZED RBST FREE JUG REF", "brand": "GLENVIEW FARMS", "pack_size": "6/.5 GA", "storage_class": "REF 33 - 40 DAIRY", "default_unit": "CS"},
    {"product_number": "2869626", "description": "CRANBERRY, SWEETENED DRIED INFUSED BAG", "brand": "MONARCH", "pack_size": "10 LB", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "2877312", "description": "CHEESE, MONTEREY JACK SHRED FANCY RBST FREE BAG REF", "brand": "GLENVIEW FARMS", "pack_size": "4/5 LB", "storage_class": "REF 33 - 40 DAIRY", "default_unit": "CS"},
    {"product_number": "3355294", "description": "LETTUCE, GREEN LEAF CASE", "brand": None, "pack_size": None, "storage_class": "REF 33 - 40 HI HUMIDITY", "default_unit": "CS"},
    {"product_number": "3441144", "description": "RAISIN, GOLDEN BLEACHED REF", "brand": "PACKER", "pack_size": "6/5 LB", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "3835816", "description": "MILK SUB, ALMOND UNSWEETENED CARTON REF", "brand": "SILK", "pack_size": "6/.5 GA", "storage_class": "UNASSIGNED", "default_unit": "CS"},
    {"product_number": "3890613", "description": "SOUR CREAM, CULTURED HEAVY BODY SELECT TUB REF", "brand": "DAIRY STAR", "pack_size": "2/5 LB", "storage_class": "REF 33 - 40 DAIRY", "default_unit": "CS"},
    {"product_number": "4105888", "description": "OIL, VEGETABLE TFF SALAD and FRYING", "brand": "CITATION", "pack_size": "3/1 GA", "storage_class": "DRY OILS", "default_unit": "CS"},
    {"product_number": "4341632", "description": "FLOUR, ALL-PURPOSE HOTEL and RESTAURANT FINE BLEACHED ENRICHED BAG", "brand": "MONARCH", "pack_size": "25 LB", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "4438354", "description": "COCOA, BAKING DARK POWDER DOMESTIC SPECIAL", "brand": "HERSHEY", "pack_size": "12/8 OZ", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "4638961", "description": "MILK, 2% REDUCED FAT PASTEURIZED RBST FREE VITAMIN A and D GRADE A JUG REF CA", "brand": "GLENVIEW FARMS", "pack_size": "2/1 GA", "storage_class": "REF 33 - 40 DAIRY", "default_unit": "CS"},
    {"product_number": "4843827", "description": "CREAM, WHIPPING HEAVY LIQUID 40% BUTTERFAT PASTEURIZED DAIRY RBST FREE CART", "brand": "GLENVIEW FARMS", "pack_size": "6/.5 GA", "storage_class": "REF 33 - 40 DAIRY", "default_unit": "CS"},
    {"product_number": "4985693", "description": "CHEESE, CHEDDAR YELLOW MILD SLICED .75 OZ TRAY REF", "brand": "GLENVIEW FARMS", "pack_size": "4/2.5 LB", "storage_class": "REF 33 - 40 DAIRY", "default_unit": "CS"},
    {"product_number": "4996955", "description": "CHEESE, PEPPER JACK SLICED .75 OZ TRAY REF", "brand": "GLENVIEW FARMS", "pack_size": "4/2.5 LB", "storage_class": "REF 33 - 40 DAIRY", "default_unit": "CS"},
    {"product_number": "5010749", "description": "SUGAR, BROWN LIGHT GRANULATED CANE GOLDEN", "brand": "CandH PURE CANE SUGAR", "pack_size": "25 LB", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "5053069", "description": "PEPPER, CHILI GREEN DICED PEELED IMPORTED and DOMESTIC CAN SHELF STABLE", "brand": "DEL PASADO", "pack_size": "12/27 OZ", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "5214382", "description": "SAUCE, HOT SS POUCH", "brand": "CHOLULA", "pack_size": "200/7 GR", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "5326426", "description": "LETTUCE, ICEBERG CLEANED and TRIMMED FRESH REF", "brand": "CROSS VALLEY FARMS", "pack_size": "4/6 EA", "storage_class": "REF 33 - 40 HI HUMIDITY", "default_unit": "CS"},
    {"product_number": "5330683", "description": "SAUCE, PIZZA TOMATO W/ BASIL EXTRA-HEAVY CAN SHELF STABLE CALIFORNIA", "brand": "ROSELI", "pack_size": "6/#10 CN", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "5330949", "description": "FLOUR, ALL-PURPOSE HOTEL and RESTAURANT FINE BLEACHED ENRICHED BAG", "brand": "MONARCH", "pack_size": "50 LB", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "5342551", "description": "BUTTER, SALTED SOLID AA GRADE RBST FREE PAPER WRAPPED REF", "brand": "GLENVIEW FARMS", "pack_size": "36/1 LB", "storage_class": "REF 33 - 40 DAIRY", "default_unit": "CS"},
    {"product_number": "5410301", "description": "EGG, SHELL MEDIUM GRADE A WHITE CAGE-FREE LOOSE PACK FRESH PROP12", "brand": "GLENVIEW FARMS", "pack_size": "15 DZ", "storage_class": "REF 33 - 40 RAW", "default_unit": "CS"},
    {"product_number": "5488748", "description": "WATER, BOTTLED", "brand": None, "pack_size": None, "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "5663000", "description": "FLOUR, ALMOND BLANCHED", "brand": "ARTISAN SPECIALTY-FI-UT", "pack_size": "5 LB", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "5771977", "description": "OIL, PAN COATING CANOLA OIL BASED AEROSOL SPRAY TFF", "brand": "MONARCH", "pack_size": "6/17 OZ", "storage_class": "DRY OILS", "default_unit": "CS"},
    {"product_number": "5886775", "description": "CONTAINER, PLASTIC 5X5 1 CMPT CLEAR 2.5 H HINGED LID INTELLILOCK", "brand": "MONOGRAM", "pack_size": "375 EA", "storage_class": "DRY NONFOOD", "default_unit": "CS"},
    {"product_number": "6106948", "description": "EGG, PATTY SCRAMBLED PLAIN 3.5 ROUND COOKED FROZEN BULK CAGE-FREE PROP12", "brand": "PAPETTI'S", "pack_size": "120/1.5 OZ", "storage_class": "FROZEN  0", "default_unit": "CS"},
    {"product_number": "6329676", "description": "PEPPERONI, PORK BEEF SLICED 14-16 COUNT COOKED REF GAS FLUSHED NO CHAR", "brand": "ROSELI", "pack_size": "2/5 LB", "storage_class": "REF 33 - 40 NOT RAW", "default_unit": "CS"},
    {"product_number": "6329924", "description": "SALT, TABLE IODIZED BAG", "brand": "MONARCH", "pack_size": "25 LB", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "63586", "description": "HONEY, SS POUCH SHELF STABLE", "brand": "KRAFT", "pack_size": "200/9 GR", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "6378798", "description": "JUICE, LEMON RECONSTITUTED BOTTLE SHELF STABLE", "brand": "THIRSTER", "pack_size": "4/1 GA", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "6382386", "description": "CHEESE, MOZZARELLA LOW-MOISTURE-WHOLE-MILK SHREDDED FEATHER BAG REF PREMIUM", "brand": "ROSELI", "pack_size": "4/5 LB", "storage_class": "REF 33 - 40 DAIRY", "default_unit": "CS"},
    {"product_number": "6417284", "description": "MARGARINE, BUTTER BLEND SOLID SALTED PHO-FREE REF", "brand": "GLENVIEW FARMS", "pack_size": "30/1 LB", "storage_class": "REF 33 - 40 DAIRY", "default_unit": "CS"},
    {"product_number": "6419501", "description": "CHEESE, CHEDDAR YELLOW MILD SLICED .75 OZ TWIN PACK REF", "brand": "GLENVIEW FARMS", "pack_size": "6/1.5 LB", "storage_class": "REF 33 - 40 DAIRY", "default_unit": "CS"},
    {"product_number": "6432884", "description": "CHEESE, PEPPER JACK SLICED .75 OZ TWIN PACK REF", "brand": "GLENVIEW FARMS", "pack_size": "6/1.5 LB", "storage_class": "REF 33 - 40 DAIRY", "default_unit": "CS"},
    {"product_number": "6480262", "description": "BAKING SODA, BOX", "brand": "MONARCH", "pack_size": "24/1 LB", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "6602304", "description": "GUACAMOLE, POUCH FROZEN SUPREME", "brand": "DEL PASADO", "pack_size": "12/1 LB", "storage_class": "FROZEN  0", "default_unit": "CS"},
    {"product_number": "6632293", "description": "CREAMER, POWDER ORIGINAL SHELF STABLE CANISTER NON-DAIRY", "brand": "COFFEE-MATE", "pack_size": "6/35.3 OZ", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "6739708", "description": "BAKING POWDER, DOUBLE ACTION TUB", "brand": "MONARCH", "pack_size": "6/5 LB", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "6872105", "description": "MILK SUB, SOY CARTON SHELF STABLE", "brand": "SILK", "pack_size": "12/1 QT", "storage_class": "UNASSIGNED", "default_unit": "CS"},
    {"product_number": "6922793", "description": "MILK, CONDENSED SWEETENED", "brand": "GLENVIEW FARMS", "pack_size": "24/14 OZ", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "7130883", "description": "HONEY, SS POUCH", "brand": "PORTION PAC", "pack_size": "200/9 GR", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "7205727", "description": "CHEESE, CHEDDAR MONTEREY JACK BLEND SHREDDED FANCY 50/50 BAG REF", "brand": "GLENVIEW FARMS", "pack_size": "4/5 LB", "storage_class": "REF 33 - 40 DAIRY", "default_unit": "CS"},
    {"product_number": "7327653", "description": "BLACKBERRY, MARION WHOLE DOMESTIC IQF FROZEN", "brand": "MONARCH", "pack_size": "2/5 LB", "storage_class": "FROZEN  0", "default_unit": "CS"},
    {"product_number": "7329113", "description": "MAYONNAISE, EXTRA-HEAVY PLASTIC JUG SHELF STABLE", "brand": "HARVEST VALUE", "pack_size": "4/1 GA", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "7492177", "description": "PEPPER, CHILI GREEN DICED PEELED SHELF STABLE CAN", "brand": "DEL PASADO", "pack_size": "6/#10 CN", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "760306", "description": "SPICE, GINGER GROUND PLASTIC SHAKER SHELF STABLE SEASONING", "brand": "MONARCH", "pack_size": "15 OZ", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "760355", "description": "SPICE, NUTMEG GROUND PLASTIC SHAKER SHELF STABLE SEASONING", "brand": "MONARCH", "pack_size": "16 OZ", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "760488", "description": "SPICE, POPPY SEED WHOLE PLASTIC SHAKER SHELF STABLE SEASONING", "brand": "MONARCH", "pack_size": "20 OZ", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "760876", "description": "SPICE, CINNAMON GROUND PLASTIC JUG SHELF STABLE SEASONING", "brand": "MONARCH", "pack_size": "5 LB", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "778654", "description": "BAG, SANDWICH 6X.75X6.5 PAPER WHITE GREASE RESISTANT", "brand": "MONOGRAM", "pack_size": "2000 EA", "storage_class": "DRY NONFOOD", "default_unit": "CS"},
    {"product_number": "7863400", "description": "HAZELNUT BUTTER, CHOCOLATE TUB SHELF STABLE SPREAD", "brand": "NUTELLA", "pack_size": "2/6.6 LB", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "7945553", "description": "DETERGENT, POT and PAN MANUAL VP1 LIQUID JUG PINK", "brand": "VALU PLUS", "pack_size": "4/1 GA", "storage_class": "DRY HAZARDOUS", "default_unit": "CS"},
    {"product_number": "8004772", "description": "BAKING POWDER, DOUBLE ACTING", "brand": "CALUMET", "pack_size": "6/5 LB", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "8117129", "description": "TURKEY, BREAST SLICED .5 OZ SKINLESS COOKED FROZEN", "brand": "JENNIE-O TURKEY STORE", "pack_size": "12/1 LB", "storage_class": "FROZEN  0", "default_unit": "CS"},
    {"product_number": "8303414", "description": "PEPPER, CHILI GREEN DICED FIRE ROASTED SHELF STABLE", "brand": "EMBASA", "pack_size": "12/27 OZ", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "8370652", "description": "MIX, PUDDING and PIE FILLING CHOCOLATE INSTANT", "brand": "MONARCH", "pack_size": "12/24 OZ", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "8382848", "description": "BANANA, GREEN TIP FRESH REF", "brand": "PACKER", "pack_size": "10 LB", "storage_class": "REF 51 - 70", "default_unit": "CS"},
    {"product_number": "8383283", "description": "SUGAR, WHITE CANE EXTRA FINE BAG", "brand": "MONARCH", "pack_size": "50 LB", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "8435355", "description": "MILK SUB, COCONUT UNSWEETENED ASEPTIC CARTON SHELF STABLE", "brand": "THIRSTER", "pack_size": "12/1 QT", "storage_class": "UNASSIGNED", "default_unit": "CS"},
    {"product_number": "855387", "description": "SUGAR, BROWN LIGHT GRANULATED CANE", "brand": "MONARCH", "pack_size": "12/2 LB", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "8647067", "description": "NAPKIN, BEVERAGE WHITE 8.98X9.45 1 PLY PAPER 1/4 FOLD", "brand": "MONOGRAM", "pack_size": "8/500 EA", "storage_class": "DRY NONFOOD", "default_unit": "CS"},
    {"product_number": "8658343", "description": "BAG, SHOPPING 10X6.75X12 PAPER KRAFT BROWN W/ HANDLE CARRY-OUT", "brand": "MONOGRAM", "pack_size": "250 EA", "storage_class": "DRY NONFOOD", "default_unit": "CS"},
    {"product_number": "8888646", "description": "ALMOND, SLICED BLANCHED UNSALTED SHELL OFF BAG NUT", "brand": "MONARCH", "pack_size": "3/2 LB", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "9009986", "description": "PUMPKIN, SOLID PACK CANNED", "brand": "LIBBYS PUMPKIN", "pack_size": "6/#10 CN", "storage_class": "DRY FOOD", "default_unit": "CS"},
    {"product_number": "9168931", "description": "TURKEY, BREAST SLICED .7 OZ SKINLESS COOKED OVEN ROASTED REF GAS FLUSHED EX", "brand": "JENNIE-O TURKEY STORE", "pack_size": "6/2 LB", "storage_class": "REF 33 - 40 NOT RAW", "default_unit": "CS"},
    {"product_number": "9328568", "description": "SAUSAGE, PORK PATTY WIDE 2 OZ 3.5 COOKED FROZEN 2-DIAMOND BREAKFAST", "brand": "PATUXENT FARMS", "pack_size": "10 LB", "storage_class": "FROZEN  0", "default_unit": "CS"},
    {"product_number": "9340860", "description": "CHEESE, CREAM PLAIN LOAF TUB REF", "brand": "GLENVIEW FARMS", "pack_size": "30 LB", "storage_class": "REF 33 - 40 DAIRY", "default_unit": "CS"},
    {"product_number": "9419516", "description": "CHEESE, PROVOLONE SLICED .75 OZ TWIN PACK REF", "brand": "ROSELI", "pack_size": "6/1.5 LB", "storage_class": "REF 33 - 40 DAIRY", "default_unit": "CS"},
]


async def seed_usfoods(session: AsyncSession) -> None:
    """Seed US Foods shop mappings and product catalog if empty."""
    # Seed shop mappings
    result = await session.execute(select(USFoodsShopMapping).limit(1))
    if result.scalar_one_or_none() is None:
        for mapping_data in SHOP_MAPPINGS:
            session.add(USFoodsShopMapping(**mapping_data))
        await session.commit()
        logger.info("Seeded %d US Foods shop mappings.", len(SHOP_MAPPINGS))

    # Seed product catalog
    result = await session.execute(select(USFoodsProduct).limit(1))
    if result.scalar_one_or_none() is None:
        for product_data in PRODUCTS:
            session.add(USFoodsProduct(**product_data, is_active=True))
        await session.commit()
        logger.info("Seeded %d US Foods products.", len(PRODUCTS))
