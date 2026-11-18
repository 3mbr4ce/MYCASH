#!/usr/bin/env python3
"""MYSUITE v1.2 (section 5a) app icon for MYCASH: "C$" (#F2F3F5, bold) on a #121214 rounded square, Frosted Blue dot
top-right. Adapted from MYYT's tools/brand/mkicons.py (same geometry: letters 420/1024 anchored at (512,560), dot centre
(820,204) diameter 144, corner radius 224, 2048 px master, Lanczos down-scaling).
Writes: Android launcher PNGs (all mipmap densities, classic icon, no adaptive icon), the Android 12+ system-splash
icon, Windows exe icons + installer .ico, the SVG and a 512 px preview."""
import os
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
BG, FG, DOT = "#121214", "#F2F3F5", "#8be5f3"
LETTERS = "C$"
SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="224" fill="#121214"/>
  <text x="512" y="560" text-anchor="middle" dominant-baseline="middle"
        font-family="system-ui, Segoe UI, Roboto, Arial, sans-serif" font-weight="700"
        font-size="420" fill="#F2F3F5">C$</text>
  <circle cx="820" cy="204" r="72" fill="#8be5f3"/>
</svg>
'''

def master(letters=LETTERS):
    S = 2048; k = S / 1024
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(224 * k), fill=BG)
    d.text((512 * k, 560 * k), letters, font=ImageFont.truetype(FONT, int(420 * k)), fill=FG, anchor="mm")
    d.ellipse([(820 - 72) * k, (204 - 72) * k, (820 + 72) * k, (204 + 72) * k], fill=DOT)
    return im

def save(im, size, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.resize((size, size), Image.LANCZOS).save(path, optimize=True)

def splash_icon(m, path):
    """Android 12+ system splash: the icon is cut to a circle (2/3 of the 288 px @1x area for icons without background,
    here we draw on a full square). Put the whole rounded square inside the circle so letters and dot stay visible."""
    S = 1152  # 288dp * 4 (xxxhdpi)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    circle = S * 2 / 3            # visible circle diameter
    side = int(circle / 1.414 * 0.98)  # square inscribed in the circle
    ic = m.resize((side, side), Image.LANCZOS)
    out.alpha_composite(ic, ((S - side) // 2, (S - side) // 2))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save(path, optimize=True)

if __name__ == "__main__":
    m = master()
    open(os.path.join(ROOT, "web", "mycash-icon.svg"), "w").write(SVG)
    save(m, 512, os.path.join(ROOT, "tools", "brand", "mycash-icon-512.png"))
    for n in (16, 24, 32, 48, 64, 128, 256):
        save(m, n, os.path.join(ROOT, "desktop", "winres", "icon%d.png" % n))
    os.makedirs(os.path.join(ROOT, "installer"), exist_ok=True)
    m.resize((256, 256), Image.LANCZOS).save(os.path.join(ROOT, "installer", "MYCASH.ico"),
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    for dpi, n in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
        save(m, n, os.path.join(ROOT, "android", "res", "mipmap-" + dpi, "ic_launcher.png"))
    splash_icon(m, os.path.join(ROOT, "android", "res", "drawable-xxxhdpi", "splash_icon.png"))
    save(m, 384, os.path.join(ROOT, "android", "res", "drawable-xxxhdpi", "start_icon.png"))
    print("icons written")
