"""Sprite definitions: (sheet, x0, y0, x1, y1) in source-sheet pixels.

Source sheets are AI-upscaled pixel art at roughly 3.75 source px per art pixel.
Everything is downscaled by SCALE so a 120px source tile becomes a 32px game tile.
"""
SCALE = 32 / 120

# optional 7th value: extra scale multiplier (sheet 2 draws some things smaller)
# kind: 'obj' => background removed (flood fill from crop border)
#       'tile' => opaque crop, resized to exactly 32x32
SPRITES = {
    # ---- ground tiles (opaque) ----
    'tile_soil':      ('s1', 430, 92, 536, 196, 'tile'),
    'tile_water':     ('s1', 952, 352, 1058, 456, 'tile'),
    'tile_grass_f1':  ('s1', 32, 89, 144, 197, 'tile'),
    'tile_grass_f2':  ('s1', 164, 89, 276, 197, 'tile'),
    'tile_grass_f3':  ('s1', 32, 219, 144, 327, 'tile'),

    # ---- buildings ----
    'house':          ('s1', 1140, 80, 1580, 490, 'obj'),
    'barn_red':       ('s2', 40, 55, 285, 300, 'obj', 1.4),
    'windmill':       ('s2', 315, 50, 515, 300, 'obj', 1.5),
    'silo':           ('s2', 555, 55, 675, 300, 'obj', 1.4),
    'greenhouse':     ('s2', 715, 55, 955, 300, 'obj', 1.4),
    'coop_pen':       ('s2', 20, 308, 295, 495, 'obj', 1.3),
    'coop_small':     ('s2', 310, 308, 510, 500, 'obj', 1.3),
    'gate_arch':      ('s2', 710, 350, 965, 465, 'obj', 1.3),

    # ---- trees & nature ----
    'tree_round':     ('s1', 25, 835, 245, 1145, 'obj'),
    'tree_pine':      ('s2', 975, 815, 1105, 1005, 'obj', 1.5),
    'tree_pine2':     ('s2', 980, 1035, 1110, 1255, 'obj', 1.4),
    'tree_dead':      ('s2', 1105, 825, 1245, 995, 'obj', 1.5),
    'tree_fruit':     ('s2', 1240, 825, 1375, 995, 'obj', 1.5),
    'tree_big':       ('s2', 1375, 820, 1520, 995, 'obj', 1.6),
    'tree_autumn':    ('s2', 1105, 1035, 1245, 1255, 'obj', 1.4),
    'tree_green':     ('s2', 1240, 1040, 1380, 1255, 'obj', 1.4),
    'bush_a':         ('s1', 675, 890, 900, 1003, 'obj'),
    'bush_b':         ('s1', 650, 1003, 900, 1115, 'obj'),
    'rock_big':       ('s2', 1520, 855, 1655, 990, 'obj'),
    'rock_moss':      ('s2', 1660, 845, 1795, 990, 'obj'),
    'rock_tall':      ('s2', 1395, 995, 1505, 1115, 'obj'),
    'stump_moss':     ('s2', 1520, 1005, 1655, 1115, 'obj'),
    'stump':          ('s2', 1655, 1015, 1775, 1115, 'obj'),
    'stump2':         ('s2', 1390, 1145, 1505, 1245, 'obj'),
    'log':            ('s2', 1515, 1130, 1725, 1250, 'obj'),
    'mushroom':       ('s2', 1805, 1000, 1915, 1110, 'obj'),
    'mushrooms':      ('s2', 1795, 1120, 1920, 1250, 'obj'),
    'flower_bush_y':  ('s2', 980, 1270, 1105, 1385, 'obj'),
    'flower_bush_r':  ('s2', 1105, 1265, 1245, 1385, 'obj'),
    'flower_bush_t':  ('s2', 1240, 1270, 1375, 1385, 'obj'),
    'flowers_o':      ('s2', 1380, 1270, 1505, 1385, 'obj'),
    'flowers_lav':    ('s2', 1520, 1260, 1650, 1390, 'obj'),
    'flowers_y':      ('s2', 1660, 1260, 1785, 1385, 'obj'),
    'fern':           ('s2', 985, 1405, 1085, 1495, 'obj'),
    'plant':          ('s2', 1105, 1395, 1225, 1505, 'obj'),
    'pebbles':        ('s2', 1400, 1405, 1505, 1505, 'obj'),
    'rock_s1':        ('s2', 1525, 1405, 1645, 1510, 'obj'),
    'rock_s2':        ('s2', 1660, 1400, 1775, 1515, 'obj'),
    'rock_s3':        ('s2', 1785, 1405, 1915, 1510, 'obj'),
    'leaves':         ('s2', 2090, 1405, 2200, 1500, 'obj'),

    # ---- farm props ----
    'scarecrow':      ('s2', 1000, 55, 1115, 165, 'obj'),
    'cart':           ('s2', 1185, 70, 1365, 150, 'obj'),
    'beehives':       ('s2', 1395, 70, 1535, 155, 'obj'),
    'seed_bag':       ('s2', 1545, 55, 1655, 155, 'obj'),
    'planter_sun':    ('s2', 1255, 200, 1365, 290, 'obj'),
    'veg_crates':     ('s2', 1390, 225, 1505, 295, 'obj'),
    'barrel_herb':    ('s2', 1535, 210, 1655, 295, 'obj'),
    'crates':         ('s2', 1675, 210, 1805, 295, 'obj'),
    'hay_pile':       ('s2', 995, 350, 1095, 450, 'obj'),
    'trough_feed':    ('s2', 1145, 380, 1235, 435, 'obj'),
    'trough_water':   ('s2', 1250, 380, 1365, 435, 'obj'),
    'bucket':         ('s2', 1005, 485, 1075, 560, 'obj'),
    'logs':           ('s2', 1000, 660, 1105, 740, 'obj'),
    'firewood':       ('s2', 1115, 650, 1235, 740, 'obj'),
    'chest_gold':     ('s2', 1255, 660, 1355, 740, 'obj'),
    'hay_bale':       ('s1', 1155, 1155, 1305, 1270, 'obj'),
    'trough_long':    ('s1', 1380, 1175, 1585, 1260, 'obj'),
    'barrel':         ('s1', 1600, 1155, 1695, 1265, 'obj'),
    'well':           ('s1', 1705, 1150, 1825, 1270, 'obj'),
    'crate':          ('s1', 1605, 1280, 1695, 1390, 'obj'),
    'tool_rack':      ('s1', 1705, 1285, 1825, 1375, 'obj'),
    'table':          ('s1', 1710, 1400, 1820, 1500, 'obj'),
    'sign':           ('s1', 2025, 1300, 2120, 1395, 'obj'),
    'lamp_post':      ('s1', 2150, 1290, 2205, 1405, 'obj'),
    'campfire':       ('s1', 2245, 1295, 2345, 1405, 'obj'),
    'notice':         ('s1', 2025, 1415, 2120, 1515, 'obj'),
    'signpost':       ('s2', 2340, 840, 2480, 1060, 'obj', 1.1),
    'sack':           ('s2', 2520, 1250, 2590, 1360, 'obj'),
    'barrel2':        ('s2', 2640, 1260, 2710, 1365, 'obj'),
    'lamp_tall':      ('s2', 1960, 830, 2050, 1060, 'obj'),
    'bridge_h':       ('s2', 285, 1295, 552, 1390, 'obj'),
    'fence_h':        ('s1', 428, 475, 540, 545, 'obj'),
    'fence_post':     ('s1', 428, 475, 462, 545, 'obj'),

    # ---- crops (patch tiles incl. their own soil) ----
    'crop_sprout':    ('s1', 1495, 1010, 1595, 1120, 'obj'),
    'crop_young':     ('s1', 800, 1395, 990, 1505, 'obj'),
    'crop_carrot':    ('s1', 1160, 880, 1280, 1000, 'obj'),
    'crop_tomato':    ('s1', 1160, 1005, 1280, 1125, 'obj'),
    'crop_grape':     ('s1', 1388, 880, 1490, 1000, 'obj'),
    'crop_strawberry':('s1', 1490, 880, 1595, 1000, 'obj'),
    'crop_eggplant':  ('s1', 1388, 1005, 1490, 1125, 'obj'),
    'crop_turnip':    ('s1', 1600, 875, 1712, 995, 'obj'),
    'crop_pumpkin':   ('s1', 1712, 875, 1828, 995, 'obj'),
    'crop_beet':      ('s1', 1828, 875, 1940, 995, 'obj'),
}
