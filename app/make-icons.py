"""Logo de Poyekhali → iconos de Android, pantalla de arranque y docs/logo.png + docs/logo.svg.
    python make-icons.py
Misma geometría que src/logo.js: esfera cortada en 9 husos.
"""
import glob
import math
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "android", "app", "src", "main", "res")
DOCS = os.path.join(HERE, "..", "docs")
PAPER, INK = (239, 236, 229), (29, 28, 26)


def slices():
    out = []
    for i in range(9):
        k = i - 4
        ry = 34 * math.sqrt(1 - (k / 4.7) ** 2)
        rx = 4.1 * math.sqrt(1 - (k / 5.2) ** 2)
        out.append((50 + k * 9.2, 50, rx, ry))
    return out


def orbit_pts(n=240):
    a = math.radians(-20)
    pts = []
    for i in range(n + 1):
        t = 2 * math.pi * i / n
        x, y = 47 * math.cos(t), 13 * math.sin(t)
        pts.append((50 + x * math.cos(a) - y * math.sin(a), 50 + x * math.sin(a) + y * math.cos(a)))
    return pts


def render(size, bg=PAPER, mark=0.62, shape=None):
    """Logo a `size` px. bg=None → fondo transparente. mark = fracción del lado que ocupa el dibujo."""
    ss = 4
    S = size * ss
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if bg is not None:
        if shape == "circle":
            d.ellipse((0, 0, S - 1, S - 1), fill=bg + (255,))
        elif shape == "rounded":
            d.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.22), fill=bg + (255,))
        else:
            d.rectangle((0, 0, S, S), fill=bg + (255,))
    u = S * mark / 100.0
    o = (S - 100 * u) / 2
    P = lambda x, y: (o + x * u, o + y * u)
    for cx, cy, rx, ry in slices():
        x0, y0 = P(cx - rx, cy - ry)
        x1, y1 = P(cx + rx, cy + ry)
        d.ellipse((x0, y0, x1, y1), fill=INK + (255,))
    return img.resize((size, size), Image.LANCZOS)


def svg():
    s = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">',
         '<rect width="100" height="100" fill="#efece5"/><g transform="translate(19 19) scale(.62)" color="#1d1c1a">']
    for cx, cy, rx, ry in slices():
        s.append(f'<ellipse cx="{cx:.2f}" cy="{cy}" rx="{rx:.2f}" ry="{ry:.2f}" fill="currentColor"/>')
    s.append('</g></svg>')
    return "\n".join(s)


if __name__ == "__main__":
    os.makedirs(DOCS, exist_ok=True)
    render(512).save(os.path.join(DOCS, "logo.png"))
    with open(os.path.join(DOCS, "logo.svg"), "w", encoding="utf-8") as f:
        f.write(svg())
    if os.path.isdir(RES):
        dens = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
        for name, k in dens.items():
            out = os.path.join(RES, f"mipmap-{name}")
            os.makedirs(out, exist_ok=True)
            render(int(48 * k), PAPER, 0.66, "rounded").save(os.path.join(out, "ic_launcher.png"))
            render(int(48 * k), PAPER, 0.62, "circle").save(os.path.join(out, "ic_launcher_round.png"))
            render(int(108 * k), None, 0.5).save(os.path.join(out, "ic_launcher_foreground.png"))
        with open(os.path.join(RES, "values", "ic_launcher_background.xml"), "w", encoding="utf-8") as f:
            f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#EFECE5</color>\n</resources>\n')
        for path in glob.glob(os.path.join(RES, "drawable*", "splash.png")):
            w, h = Image.open(path).size
            img = Image.new("RGB", (w, h), PAPER)
            s = int(min(w, h) * 0.3)
            icon = render(s, None, 0.9)
            img.paste(icon, ((w - s) // 2, (h - s) // 2), icon)
            img.save(path)
        print("iconos y splash de Android listos")
    print("docs/logo.png y docs/logo.svg listos")
