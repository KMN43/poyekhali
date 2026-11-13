"""Pixel art de los satélites → src/px/ (va en el repositorio; se ejecuta solo si cambian las imágenes).
    python make-pixel.py

A) foto-*.png: fotos libres de Wikimedia Commons reducidas a 1 bit (tinta/papel, trama Bayer 4×4) con los
   paneles solares (píxeles saturados) en amarillo sodio. Las fotos originales se descargan a .pxcache/ (no se sube).
B) emb-*.png: emblemas de 16×16 dibujados a mano o con primitivas.
Las imágenes se guardan a 1× y la app las escala con image-rendering: pixelated.
"""
import colorsys
import os
import urllib.request

from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "src", "px")
CACHE = os.path.join(HERE, ".pxcache")
os.makedirs(OUT, exist_ok=True)
os.makedirs(CACHE, exist_ok=True)
PAPER, INK, ACC = (239, 236, 229), (29, 28, 26), (232, 174, 23)
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
TH = "https://thumb.wikimedia.org/wikipedia/commons/thumb/"

# nombre: (url, recorte l,t,r,b, invertir, ancho px, corte de fondo, gamma) · licencias en src/sats.js
PHOTOS = {
    "iss": (TH + "5/59/The_station_pictured_from_the_SpaceX_Crew_Dragon_5.jpg/500px-The_station_pictured_from_the_SpaceX_Crew_Dragon_5.jpg", (0.02, 0.05, 0.98, 0.95), True, 72, 1.0, 0.75),
    "meteor": (TH + "2/2c/Meteor-M_2.jpeg/500px-Meteor-M_2.jpeg", (0.0, 0.0, 1.0, 1.0), False, 72, 1.0, 1.0),
    "diwata": (TH + "e/ef/Diwata-2.png/500px-Diwata-2.png", (0.53, 0.06, 0.99, 0.80), False, 64, 1.0, 1.0),
    "funcube": (TH + "1/19/FUNcube-1.jpg/500px-FUNcube-1.jpg", (0.24, 0.1, 0.84, 0.88), False, 60, 0.6, 1.25),
}


def fetch(name, url):
    path = os.path.join(CACHE, name + os.path.splitext(url.split("?")[0])[1])
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers={"User-Agent": "poyekhali-build/1.0 (proyecto personal)"})
        with urllib.request.urlopen(req, timeout=30) as r, open(path, "wb") as f:
            f.write(r.read())
    return path


def photo(name, url, crop, invert, W, cut, gamma):
    im = Image.open(fetch(name, url)).convert("RGB")
    w, h = im.size
    im = im.crop((int(crop[0] * w), int(crop[1] * h), int(crop[2] * w), int(crop[3] * h)))
    H = max(1, round(im.height * W / im.width))
    small = im.resize((W, H), Image.LANCZOS)
    g = ImageOps.autocontrast(small.convert("L"), cutoff=2)
    if invert:
        g = ImageOps.invert(g)
    out = Image.new("RGB", (W, H), PAPER)
    px, gp, op = small.load(), g.load(), out.load()
    for y in range(H):
        for x in range(W):
            r, gg, b = px[x, y]
            _, s, v = colorsys.rgb_to_hsv(r / 255, gg / 255, b / 255)
            lum = (gp[x, y] / 255) ** gamma
            if lum > cut:
                lum = 1.0
            thr = (BAYER[y % 4][x % 4] + 0.5) / 16
            if s > 0.38 and v > 0.18 and lum < 0.92:   # paneles solares → amarillo
                op[x, y] = ACC if lum < thr + 0.25 else PAPER
            else:
                op[x, y] = INK if lum < thr else PAPER
    out.save(os.path.join(OUT, f"foto-{name}.png"))


# ---------------------------------------------------------------- emblemas ('.' papel, '#' tinta, 'y' amarillo)
EMB = {
    "meteor": [
        "................", "................", "......####......", ".yyyy.#..#.yyyy.", ".yyyy.#..#.yyyy.",
        ".yyyy######yyyy.", ".yyyy.#..#.yyyy.", ".yyyy.#..#.yyyy.", "......#..#......", "......#..#......",
        "......####......", ".....######.....", "......#..#......", ".......##.......", "................", "................"],
    "iss": [
        "................", "................", ".yy.yy....yy.yy.", ".yy.yy....yy.yy.", ".yy.yy.##.yy.yy.",
        ".yy.yy.##.yy.yy.", "################", ".yy.yy####yy.yy.", ".yy.yy.##.yy.yy.", ".yy.yy.##.yy.yy.",
        ".......##.......", ".......##.......", "................", "................", "................", "................"],
    "so50": [
        "#..............#", ".#............#.", "..#..........#..", "...#........#...", "....########....",
        "....#yy##yy#....", "....#yy##yy#....", "....########....", "....#yy##yy#....", "....#yy##yy#....",
        "....########....", "........#.......", "........#.......", "........#.......", "........#.......", "................"],
    "po101": [
        "................", "................", "................", ".....######.....", "yyyy.#....#.yyyy",
        "yyyy##.##.##yyyy", "yyyy.#.##.#.yyyy", "yyyy.#....#.yyyy", "yyyy.######.yyyy", "................",
        "................", "................", "................", "................", "................", "................"],
    "ao73": [
        "#..............#", ".#............#.", "..#..........#..", "...#........#...", "....#......#....",
        ".....######.....", ".....#yyyy#.....", ".....#yyyy#.....", ".....#yyyy#.....", ".....#yyyy#.....",
        ".....######.....", "....#......#....", "...#........#...", "..#..........#..", ".#............#.", "#..............#"],
    # AO-7: dipolo de 10 m arriba, cuerpo octogonal con células y dos antenas abiertas abajo
    "ao7": [
        "................", "................", "################", ".......#........", ".......#........",
        ".....######.....", "....#yy..yy#....", "...#yy..yy..#...", "...#..yy..yy#...", "...#yy..yy..#...",
        "....#..yy..#....", ".....######.....", "....#......#....", "...#........#...", "..#..........#..", "................"],
}


def rs44():
    """RS-44: la etapa Briz-KM (tambor con anillo), el satélite pegado y sus antenas hacia fuera."""
    g = [["."] * 16 for _ in range(16)]
    def put(x, y, c="#"):
        if 0 <= x < 16 and 0 <= y < 16:
            g[y][x] = c
    for x in range(1, 8):            # tambor: bordes superior e inferior
        put(x, 3); put(x, 12)
    for y in range(4, 12):           # laterales
        put(0, y); put(8, y)
    for x in range(2, 7):            # anillo interior (depósito toroidal)
        put(x, 6); put(x, 9)
    for y in (7, 8):
        put(2, y); put(6, y)
    for x in range(9, 13):           # satélite: caja con panel amarillo
        put(x, 5); put(x, 10)
    for y in range(5, 11):
        put(9, y); put(12, y)
    for y in range(6, 10):
        put(10, y, "y"); put(11, y, "y")
    for i in range(1, 4):            # antenas
        put(12 + i, 5 - i); put(12 + i, 10 + i)
    for x in range(13, 16):
        put(x, 7)
    return ["".join(r) for r in g]


EMB["rs44"] = rs44()
COL = {".": PAPER, "#": INK, "y": ACC}

if __name__ == "__main__":
    for k, rows in EMB.items():
        assert len(rows) == 16 and all(len(r) == 16 for r in rows), (k, [len(r) for r in rows])
        im = Image.new("RGB", (16, 16), PAPER)
        for y, r in enumerate(rows):
            for x, c in enumerate(r):
                im.putpixel((x, y), COL[c])
        im.save(os.path.join(OUT, f"emb-{k}.png"))
    for k, v in PHOTOS.items():
        photo(k, *v)
    print("src/px listo:", sorted(os.listdir(OUT)))
