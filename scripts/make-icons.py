"""Famcal icon (OLD first logo, superseded by branding/famabria-logo-*.png): white rounded square with a big red C (Calendar) and two calendar-ring tabs. Run: python3 scripts/make-icons.py"""
from PIL import Image, ImageDraw
import math
S = 1024
BG, RED = '#FFFFFF', '#E11D48'
def master(tabs=True, full_bleed=False):
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if full_bleed: d.rectangle([0, 0, S, S], fill=BG)
    else: d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * .22), fill=BG, outline='#E5E7EB', width=int(S*.012))
    cx, cy = S / 2, S * (0.56 if tabs else 0.5)
    R, T = S * 0.33, S * 0.15            # outer radius, stroke
    a0, a1 = 40, 320                     # opening on the right
    r = R - T / 2
    d.arc([cx - R, cy - R, cx + R, cy + R], a0, a1, fill=RED, width=int(T))
    for a in (a0, a1):                   # round caps
        x, y = cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))
        d.ellipse([x - T / 2, y - T / 2, x + T / 2, y + T / 2], fill=RED)
    if tabs:
        for x in (S * .32, S * .68):
            d.rounded_rectangle([x - S * .035, S * .09, x + S * .035, S * .23], radius=int(S * .035), fill=RED)
    return im
def save(im, path, size): im.resize((size, size), Image.LANCZOS).save(path)
big, small = master(True), master(False)
for n in (128, 48): save(big, f'public/icons/{n}.png', n)
for n in (32, 16): save(small, f'public/icons/{n}.png', n)
save(master(True, True), 'public-web/icons/icon-512.png', 512)
save(master(True, True), 'public-web/icons/icon-192.png', 192)
save(master(True, True), 'public-web/icons/apple-touch-icon.png', 180)
big.save('branding/old/famcal-icon-1024.png')
print('ok')
