#!/usr/bin/env python3
"""Validate a HappyFarm V2 artwork manifest against exported raster assets.

This checks file existence, metadata, transparency and cap inset bounds. It CANNOT
validate taste, visual similarity, layout, correct item identity, or 9-slice seams.
Use manual visual QA for those.
"""
import argparse
import json
from pathlib import Path
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: python -m pip install Pillow")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--min-assets", type=int, default=1)
    args = parser.parse_args()
    errors = []
    try:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    except Exception as exc:
        sys.exit(f"Failed to parse manifest: {exc}")
    if manifest.get("schemaVersion") != 1:
        errors.append("schemaVersion must be 1")
    assets = manifest.get("assets", [])
    if len(assets) < args.min_assets:
        errors.append(f"Expected at least {args.min_assets} asset records")
    ids = set()
    manifest_base = args.manifest.parent.resolve()
    for index, asset in enumerate(assets):
        aid = asset.get("id", f"#{index}")
        if aid in ids:
            errors.append(f"{aid}: duplicate id")
        ids.add(aid)
        for field in ("id", "kind", "file", "density", "sourceFile", "license", "status"):
            if not asset.get(field):
                errors.append(f"{aid}: missing {field}")
        kind = asset.get("kind")
        if kind not in ("nine_slice", "icon", "decor"):
            errors.append(f"{aid}: unsupported kind {kind!r}")
        density = asset.get("density")
        if not isinstance(density, (int, float)) or density < 1:
            errors.append(f"{aid}: density must be >= 1")
        rel = asset.get("file", "")
        file = (manifest_base / rel).resolve()
        if not file.is_relative_to(manifest_base):
            errors.append(f"{aid}: path escapes manifest directory")
            continue
        if not file.is_file():
            errors.append(f"{aid}: missing image {rel}")
            continue
        try:
            with Image.open(file) as im:
                if im.format not in ("PNG", "WEBP"):
                    errors.append(f"{aid}: expected PNG or WebP, got {im.format}")
                if im.mode != "RGBA":
                    errors.append(f"{aid}: expected RGBA mode, got {im.mode}")
                image = im.convert("RGBA")
                alpha_min, alpha_max = image.getchannel("A").getextrema()
                if asset.get("alphaRequired", True) and not (alpha_min == 0 and alpha_max > 0):
                    errors.append(f"{aid}: expected some fully transparent and some visible pixels")
                if kind == "nine_slice":
                    caps = asset.get("capInsets", {})
                    if set(caps) != {"top", "right", "bottom", "left"}:
                        errors.append(f"{aid}: nine_slice requires top/right/bottom/left capInsets")
                    else:
                        vals = list(caps.values())
                        if any(type(v) is not int or v <= 0 for v in vals):
                            errors.append(f"{aid}: capInsets must be positive integers")
                        elif caps["left"] + caps["right"] >= image.width or caps["top"] + caps["bottom"] >= image.height:
                            errors.append(f"{aid}: capInsets leave no stretchable center")
                print(f"CHECK {aid}: {image.width}x{image.height}, alpha={alpha_min}..{alpha_max}")
        except Exception as exc:
            errors.append(f"{aid}: unreadable image: {exc}")
        source_rel = asset.get("sourceFile")
        if source_rel:
            source = (manifest_base / source_rel).resolve()
            if not source.is_relative_to(manifest_base) or not source.is_file():
                errors.append(f"{aid}: missing editable source {source_rel}")
    if errors:
        print("\nFAILED:\n- " + "\n- ".join(errors), file=sys.stderr)
        return 1
    print(f"\nPASS metadata/alpha/cap-inset checks for {len(assets)} asset(s). Visual QA still required.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
