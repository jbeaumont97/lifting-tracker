#!/usr/bin/env python3
"""Generate the app icons. Run again after changing the mark:

    python3 tools/make_icons.py
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "icons")
BLUE = (42, 120, 214, 255)      # --series-1
WHITE = (255, 255, 255, 255)


def barbell(size, inset_ratio=0.0, bg=BLUE, radius_ratio=0.0):
    """A barbell mark, centred. inset_ratio shrinks the mark for maskable icons."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if radius_ratio:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=bg)
    else:
        d.rectangle([0, 0, size, size], fill=bg)

    s = size * (1 - inset_ratio)          # drawing box for the mark
    o = (size - s) / 2                    # offset to centre it
    cy = size / 2

    def box(x0, y0, x1, y1, r):
        d.rounded_rectangle([o + s * x0, o + s * y0, o + s * x1, o + s * y1], radius=int(s * r), fill=WHITE)

    bar_h = 0.075
    box(0.225, 0.5 - bar_h / 2, 0.775, 0.5 + bar_h / 2, bar_h / 2)   # the bar
    for x0, x1, h in ((0.145, 0.235, 0.34), (0.765, 0.855, 0.34),    # inner plates
                      (0.055, 0.115, 0.20), (0.885, 0.945, 0.20)):   # outer collars
        box(x0, 0.5 - h / 2, x1, 0.5 + h / 2, 0.035)
    del cy
    return img


def main():
    os.makedirs(ICONS, exist_ok=True)
    jobs = [
        ("icon-192.png", 192, 0.0, 0.0),
        ("icon-512.png", 512, 0.0, 0.0),
        ("apple-touch-icon.png", 180, 0.0, 0.0),
        ("icon-maskable-512.png", 512, 0.22, 0.0),      # 78% safe zone
        ("favicon.png", 64, 0.0, 0.0),
    ]
    for name, size, inset, radius in jobs:
        img = barbell(size, inset_ratio=inset, radius_ratio=radius)
        img.save(os.path.join(ICONS, name))
        print(f"  {name}  {size}x{size}")


if __name__ == "__main__":
    main()
