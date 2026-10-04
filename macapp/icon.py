#!/usr/bin/env python3
"""Ikona koligilo.app: dwa splecione ogniwa, tusz na papierze (jak panel).

    python3 macapp/icon.py OUT.png   # 1024×1024, z niej iconutil robi .icns

Geometria jak web/icon.svg (siatka 64): kafelek 3..61, ogniwa (25.5,32) i (38.5,32), r 11.5.
"""
import sys
from PIL import Image, ImageDraw

S = 1024
SS = 4                     # nadpróbkowanie zamiast antyaliasingu, którego ImageDraw nie ma
PAPER = (247, 247, 244)
INK = (22, 22, 22)


def main(out):
    big = S * SS
    k = 824 * SS / 58          # siatka 64 → kafelek 824 px (siatka ikon macOS)
    o = 100 * SS - 3 * k
    P = lambda v: o + v * k

    im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    rule = round(3 * k)
    d.rounded_rectangle((P(3), P(3), P(61), P(61)), round(12 * k), fill=INK)
    d.rounded_rectangle((P(3) + rule, P(3) + rule, P(61) - rule, P(61) - rule),
                        round(12 * k) - rule, fill=PAPER)

    def ring(cx, cy, r, w):
        # ImageDraw rysuje obrys do środka ramki — poszerzamy ją o pół grubości
        R = (r + w / 2) * k
        return (P(cx) - R, P(cy) - R, P(cx) + R, P(cy) + R), round(w * k)

    for cx in (25.5, 38.5):
        box, w = ring(cx, 32, 11.5, 4.4)
        d.ellipse(box, outline=INK, width=w)
    # na dolnym skrzyżowaniu lewe ogniwo przechodzi nad prawym
    box, w = ring(25.5, 32, 11.5, 8)
    d.arc(box, 35, 80, fill=PAPER, width=w)
    box, w = ring(25.5, 32, 11.5, 4.4)
    d.arc(box, 30, 85, fill=INK, width=w)

    im.resize((S, S), Image.LANCZOS).save(out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "icon.png")
