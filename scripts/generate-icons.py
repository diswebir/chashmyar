#!/usr/bin/env python3
"""Derive ChashmYar's desktop assets from the approved eye artwork.

Optional maintainer tool, not required to build the application. Run from the
repository root with Python 3 and Pillow 13.0.0. `--check` compares output bytes
without modifying files. Do not silently swap the approved source artwork.
"""
from __future__ import annotations

import argparse
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import sys

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets/branding/chashmyar-logo-selected.png"
ICONS = ROOT / "src-tauri/icons"
# The crop is calibrated to the approved 2048px artwork, not to arbitrary art.
SOURCE_SIZE = (2048, 2048)
EYE_BOX = (156, 598, 1888, 1453)
WORK_SIZE = 2048
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
PNG_SIZES = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "256x256.png": 256,
    "512x512.png": 512,
    "icon.png": 1024,
}


def png_bytes(image: Image.Image) -> bytes:
    out = BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()


def render() -> dict[Path, bytes]:
    original = Image.open(SOURCE)
    if original.size != SOURCE_SIZE:
        raise ValueError(f"Approved source must be {SOURCE_SIZE}, got {original.size}")

    # Keep the approved eye's curves, iris and highlight, not a redrawn symbol.
    # Neutralize off-white image background while retaining the grayscale mark.
    eye = original.convert("L").crop(EYE_BOX)
    eye = eye.point([min(255, round(value * 255 / 240)) for value in range(256)])
    eye_width = round(WORK_SIZE * 0.88)
    eye_height = round(eye.height * eye_width / eye.width)
    eye = eye.resize((eye_width, eye_height), Image.Resampling.LANCZOS).convert("RGBA")

    # An opaque white, subtly outlined tile keeps a black logo legible on both
    # light and dark Windows taskbars. Transparent rounded corners avoid a hard
    # square. All sizes derive from the same high-resolution composition.
    canvas = Image.new("RGBA", (WORK_SIZE, WORK_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    inset = 12
    draw.rounded_rectangle(
        (inset, inset, WORK_SIZE - inset - 1, WORK_SIZE - inset - 1),
        radius=470,
        fill=(255, 255, 255, 255),
        outline=(218, 222, 228, 255),
        width=24,
    )
    canvas.alpha_composite(eye, ((WORK_SIZE - eye_width) // 2, (WORK_SIZE - eye_height) // 2))
    sizes = sorted(set(PNG_SIZES.values()) | set(ICO_SIZES))
    frames = {size: canvas.resize((size, size), Image.Resampling.LANCZOS) for size in sizes}

    result = {ICONS / name: png_bytes(frames[size]) for name, size in PNG_SIZES.items()}
    ico = BytesIO()
    frames[256].save(
        ico,
        format="ICO",
        sizes=[(size, size) for size in ICO_SIZES],
        append_images=[frames[size] for size in ICO_SIZES if size != 256],
    )
    result[ICONS / "icon.ico"] = ico.getvalue()
    manifest = {
        "source": {"path": str(SOURCE.relative_to(ROOT).as_posix()), "sha256": sha256(SOURCE.read_bytes()).hexdigest()},
        "generated": {
            path.relative_to(ROOT).as_posix(): sha256(data).hexdigest()
            for path, data in sorted(result.items())
        },
    }
    result[ROOT / "assets/branding/asset-hashes.json"] = (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode("utf8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="compare assets without writing")
    args = parser.parse_args()
    try:
        output = render()
        if args.check:
            mismatches = [str(path.relative_to(ROOT)) for path, data in output.items()
                          if not path.is_file() or path.read_bytes() != data]
            if mismatches:
                print("Icon assets differ (use the documented Pillow version): " + ", ".join(mismatches), file=sys.stderr)
                return 1
            print(f"Verified {len(output)} icon assets against the approved source.")
        else:
            ICONS.mkdir(parents=True, exist_ok=True)
            for path, data in output.items():
                path.write_bytes(data)
                print(f"Wrote {path.relative_to(ROOT)} ({len(data)} bytes)")
        return 0
    except (OSError, ValueError) as error:
        print(f"Icon generation failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
