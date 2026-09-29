"""The shared HappyFarm palette, mirroring docs/HAPPYFARM_ART_BIBLE.md section 5.

Blender works in linear colour, so the sRGB hexes from the art bible are converted here. Change a
colour in the art bible, `apps/web/src/render/materials.ts` and this file together, or in none.
"""

PALETTE = {
    "grass": 0x7DC35A,
    "foliage": 0x4F9D45,
    "pine": 0x3C7F4A,
    "soil": 0xB98A5A,
    "soil_occupied": 0x8A6440,
    "dirt": 0xC9A26A,
    "dirt_dark": 0xB0854F,
    "sand": 0xE7D59A,
    "stone": 0x9AA3AB,
    "water": 0x49A7DD,
    "wood": 0xA9763F,
    "barn_wall": 0xD1574A,
    "barn_roof": 0x8D3F38,
    "trim": 0xF3E3C8,
    "crop_growing": 0x6FBF7F,
    "crop_mature": 0xE0B64A,
    "carrot": 0xE0803C,
    "carrot_top": 0x4F9B3F,
    "wheat_stalk": 0xC8A94A,
    "wheat_grain": 0xE4CD72,
    "corn_stalk": 0x5D9C46,
    "corn_leaf": 0x6FB054,
    "corn_cob": 0xE8C34A,
    "player_body": 0x3F6FD8,
    "player_legs": 0x39435C,
    "player_skin": 0xF1C7A1,
    "player_hat": 0xD9A441,
    "player_hair": 0x6B4A2F,
}


def srgb_to_linear(channel: int) -> float:
    value = channel / 255
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def linear_rgba(name: str) -> tuple[float, float, float, float]:
    hex_value = PALETTE[name]
    return (
        srgb_to_linear((hex_value >> 16) & 0xFF),
        srgb_to_linear((hex_value >> 8) & 0xFF),
        srgb_to_linear(hex_value & 0xFF),
        1.0,
    )
