"""Logo de Pasadas → iconos de Android, pantalla de arranque y docs/logo.png + docs/logo.svg.
    python make-icons.py
Misma geometría que src/logo.js: esfera en 9 husos + órbita inclinada con el satélite.
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
    # órbita (tenue) por debajo, para que se vea solo entre husos y fuera de la esfera
    orb = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(orb).line([P(*p) for p in orbit_pts()], fill=INK + (97,), width=max(1, int(1.5 * u)))
    img.alpha_composite(orb)
    for cx, cy, rx, ry in slices():
        x0, y0 = P(cx - rx, cy - ry)
        x1, y1 = P(cx + rx, cy + ry)
        d.ellipse((x0, y0, x1, y1), fill=INK + (255,))
    sx, sy = P(93.0, 32.3)
    halo = (bg or PAPER) + (255,)
    d.ellipse((sx - 5.2 * u, sy - 5.2 * u, sx + 5.2 * u, sy + 5.2 * u), fill=halo if bg is not None else (0, 0, 0, 0))
    if bg is None:  # sin fondo: el halo es un hueco real
        mask = Image.new("L", (S, S), 255)
        ImageDraw.Draw(mask).ellipse((sx - 5.2 * u, sy - 5.2 * u, sx + 5.2 * u, sy + 5.2 * u), fill=0)
        img.putalpha(Image.composite(img.getchannel("A"), Image.new("L", (S, S), 0), mask))
        d = ImageDraw.Draw(img)
    d.ellipse((sx - 3.2 * u, sy - 3.2 * u, sx + 3.2 * u, sy + 3.2 * u), fill=INK + (255,))
    return img.resize((size, size), Image.LANCZOS)


def svg():
    s = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">',
         '<rect width="100" height="100" fill="#efece5"/><g transform="translate(19 19) scale(.62)" color="#1d1c1a">']
    s.append('<ellipse cx="50" cy="50" rx="47" ry="13" transform="rotate(-20 50 50)" fill="none" stroke="currentColor" stroke-opacity=".38" stroke-width="1.5"/>')
    for cx, cy, rx, ry in slices():
        s.append(f'<ellipse cx="{cx:.2f}" cy="{cy}" rx="{rx:.2f}" ry="{ry:.2f}" fill="currentColor"/>')
    s.append('<circle cx="93.0" cy="32.3" r="5.2" fill="#efece5"/><circle cx="93.0" cy="32.3" r="3.2" fill="currentColor"/></g></svg>')
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
