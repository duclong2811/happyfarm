"""Generate HappyFarm's production 2.5D UI material family.

This is a deterministic raster source, not a runtime CSS effect. Each output is an RGBA layer with
separate shadow, material, bevel and ornament passes. Corner ornaments live inside the preserved
9-slice corners; the center and edges remain plain enough to scale without stretching detail.

Usage:
    python tools/ui-art/generate_premium_ui.py

The script intentionally contains no text, labels, quantities or game data.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable, Tuple

from PIL import Image, ImageChops, ImageDraw, ImageFilter


Color = Tuple[int, int, int, int]
Point = Tuple[int, int]

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "apps" / "web" / "src" / "assets" / "ui" / "premium-2_5d"


def lerp(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def gradient(width: int, height: int, top: Color, bottom: Color) -> Image.Image:
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for y in range(height):
        t = y / max(1, height - 1)
        draw.line(
            [(0, y), (width, y)],
            fill=tuple(lerp(top[index], bottom[index], t) for index in range(4)),
        )
    return image


def mask_round_rect(size: Tuple[int, int], box: Tuple[int, int, int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
    return mask


def paste_masked(base: Image.Image, layer: Image.Image, mask: Image.Image) -> None:
    base.alpha_composite(Image.composite(layer, Image.new("RGBA", base.size), mask))


def leaf_sprite(scale: float = 1.0, hue: str = "green") -> Image.Image:
    size = round(92 * scale)
    sprite = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(sprite)
    if hue == "gold":
        dark, mid, light = (174, 91, 12, 255), (246, 173, 34, 255), (255, 222, 101, 255)
    else:
        dark, mid, light = (29, 91, 26, 255), (73, 160, 39, 255), (155, 220, 64, 255)
    points = [
        (round(size * .08), round(size * .63)),
        (round(size * .22), round(size * .17)),
        (round(size * .52), round(size * .06)),
        (round(size * .88), round(size * .26)),
        (round(size * .72), round(size * .64)),
        (round(size * .40), round(size * .83)),
    ]
    shadow = Image.new("RGBA", sprite.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shifted = [(x + round(size * .04), y + round(size * .06)) for x, y in points]
    shadow_draw.polygon(shifted, fill=(46, 18, 3, 150))
    sprite.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(max(1, round(size * .05)))))
    draw = ImageDraw.Draw(sprite)
    draw.polygon(points, fill=dark)
    inner = [(round(x * .96), round(y * .92)) for x, y in points]
    draw.polygon(inner, fill=mid)
    draw.line(
        [(round(size * .14), round(size * .68)), (round(size * .72), round(size * .23))],
        fill=light,
        width=max(1, round(size * .035)),
    )
    draw.line(
        [(round(size * .37), round(size * .48)), (round(size * .24), round(size * .28))],
        fill=light,
        width=max(1, round(size * .018)),
    )
    draw.line(
        [(round(size * .49), round(size * .39)), (round(size * .66), round(size * .26))],
        fill=light,
        width=max(1, round(size * .018)),
    )
    return sprite


def add_corner_leaves(image: Image.Image, size: float = 1.0) -> None:
    leaf = leaf_sprite(size)
    positions = [
        (round(image.width * .02), round(image.height * .02), 24),
        (round(image.width * .82), round(image.height * .01), -24),
        (round(image.width * .02), round(image.height * .70), -18),
        (round(image.width * .82), round(image.height * .72), 18),
    ]
    for x, y, angle in positions:
        image.alpha_composite(leaf.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True), (x, y))


def button_asset(
    name: str,
    size: Tuple[int, int],
    top: Color,
    bottom: Color,
    inner: Color,
    inner_bottom: Color,
    leaves: bool = True,
) -> None:
    width, height = size
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    outer = mask_round_rect(size, (28, 30, width - 29, height - 25), round(height * .32))
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    shadow_mask = Image.new("L", size, 0)
    ImageDraw.Draw(shadow_mask).rounded_rectangle(
        (28, 39, width - 29, height - 16), radius=round(height * .32), fill=170
    )
    shadow.paste((54, 19, 3, 218), mask=shadow_mask)
    image.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(round(height * .075))))

    paste_masked(image, gradient(width, height, top, bottom), outer)
    inner_mask = mask_round_rect(size, (64, 62, width - 65, height - 57), round(height * .23))
    paste_masked(image, gradient(width, height, inner, inner_bottom), inner_mask)

    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((31, 33, width - 32, height - 28), radius=round(height * .30), outline=(255, 232, 128, 255), width=6)
    draw.rounded_rectangle((46, 47, width - 47, height - 42), radius=round(height * .27), outline=(104, 40, 6, 238), width=6)
    draw.rounded_rectangle((70, 68, width - 71, height - 63), radius=round(height * .20), outline=(255, 250, 202, 235), width=4)
    draw.line([(round(width * .18), 48), (round(width * .82), 48)], fill=(255, 253, 214, 205), width=5)
    draw.line([(round(width * .18), height - 37), (round(width * .82), height - 37)], fill=(89, 31, 4, 210), width=6)
    if leaves:
        add_corner_leaves(image, max(.42, height / 256))
    image.save(OUT / name, optimize=True)


def square_asset(name: str, size: int, selected: bool = False) -> None:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    outer = mask_round_rect((size, size), (18, 18, size - 19, size - 19), round(size * .18))
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow_mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(shadow_mask).rounded_rectangle((20, 28, size - 17, size - 12), radius=round(size * .18), fill=170)
    shadow.paste((50, 17, 3, 216), mask=shadow_mask)
    image.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(round(size * .065))))
    if selected:
        outer_top, outer_bottom = (112, 218, 50, 255), (22, 93, 32, 255)
        inner_top, inner_bottom = (239, 255, 177, 255), (151, 218, 78, 255)
    else:
        outer_top, outer_bottom = (255, 202, 44, 255), (157, 57, 7, 255)
        inner_top, inner_bottom = (255, 249, 203, 255), (244, 207, 130, 255)
    paste_masked(image, gradient(size, size, outer_top, outer_bottom), outer)
    inner = mask_round_rect((size, size), (48, 48, size - 49, size - 49), round(size * .11))
    paste_masked(image, gradient(size, size, inner_top, inner_bottom), inner)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((20, 20, size - 21, size - 21), radius=round(size * .17), outline=(255, 240, 134, 255), width=max(3, round(size * .028)))
    draw.rounded_rectangle((33, 33, size - 34, size - 34), radius=round(size * .13), outline=(111, 42, 5, 232), width=max(3, round(size * .024)))
    draw.rounded_rectangle((57, 57, size - 58, size - 58), radius=round(size * .09), outline=(255, 255, 232, 220), width=max(2, round(size * .018)))
    add_corner_leaves(image, max(.48, size / 320))
    image.save(OUT / name, optimize=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    button_asset(
        "button-primary.png", (1024, 256),
        (255, 214, 58, 255), (198, 76, 7, 255),
        (255, 249, 177, 255), (248, 145, 13, 255),
    )
    button_asset(
        "button-secondary.png", (1024, 256),
        (255, 196, 80, 255), (163, 59, 7, 255),
        (255, 248, 210, 255), (239, 197, 120, 255),
    )
    button_asset(
        "button-selected.png", (1024, 256),
        (126, 220, 50, 255), (21, 91, 32, 255),
        (242, 255, 182, 255), (126, 205, 65, 255),
    )
    button_asset(
        "button-disabled.png", (1024, 256),
        (201, 188, 151, 255), (119, 101, 76, 255),
        (232, 224, 195, 255), (183, 169, 139, 255),
        leaves=False,
    )
    button_asset(
        "nav-button-normal.png", (256, 256),
        (255, 211, 112, 255), (169, 76, 10, 255),
        (255, 252, 226, 255), (241, 214, 161, 255),
    )
    button_asset(
        "nav-button-active.png", (256, 256),
        (197, 255, 91, 255), (29, 106, 35, 255),
        (249, 255, 218, 255), (126, 209, 69, 255),
    )
    square_asset("item-slot.png", 320)


if __name__ == "__main__":
    main()
