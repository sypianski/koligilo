#!/usr/bin/env python3
"""Ikona koligilo.app: dwa splecione ogniwa, tusz na papierze (jak panel).

    python3 macapp/icon.py OUT.png   # 1024×1024, z niej iconutil robi .icns

Wynik jest zacommitowany jako macapp/icon.png i to jego bierze scripts/mac-app.sh
(na Macu nie ma numpy/scipy). Ten skrypt uruchamia się tylko przy zmianie ikony.

Ikona jest pełną kratką 1024 px (bez przezroczystego marginesu): macOS 26+ sam
nakłada na każdą ikonę swoją maskę, normalizuje jej rozmiar i dodaje cień oraz skos
u krawędzi. Własna ramka w kształcie zwykłego prostokąta z zaokrągleniem nie jest
współśrodkowa z tą maską — na bokach wychodzi gruba, na rogach i u góry cienka.
Dlatego ramka jest tu liczona równolegle do maski systemu: macapp/icon-mask.png to
jej kształt (kanał alfa renderu czarnego kwadratu przez NSWorkspace.icon(forFile:),
przycięty do bryły), a papier to wnętrze maski cofnięte o stałą odległość.
Góra i dół dostają ramkę grubszą o RULE_V − RULE, bo skos systemu zjada tam
ok. 10% czerni.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt

S = 1024
SS = 2                     # nadpróbkowanie zamiast antyaliasingu, którego ImageDraw nie ma
PAPER = (247, 247, 244)
INK = (22, 22, 22)
RULE = 53                  # grubość ramki na bokach (px na 1024) = 3/58 kafelka jak w web/icon.svg
RULE_V = 60                # u góry i u dołu

MASK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon-mask.png")


def main(out):
    big = S * SS
    mask = np.array(Image.open(MASK).convert("L").resize((big, big), Image.LANCZOS)) > 127
    # pad: krawędź kratki też jest krawędzią maski
    dist = distance_transform_edt(np.pad(mask, 1))[1:-1, 1:-1]

    # waga 1 przy górze/dole, 0 przy bokach; grubość ramki płynnie między RULE a RULE_V
    t = np.abs(np.linspace(-1, 1, big))
    wv = t[:, None] ** 4 / (t[:, None] ** 4 + t[None, :] ** 4 + 1e-9)
    thick = (RULE + (RULE_V - RULE) * wv) * SS

    px = np.zeros((big, big, 4), np.uint8)
    px[..., :3] = INK
    px[..., 3] = 255
    px[dist > thick, :3] = PAPER
    im = Image.fromarray(px, "RGBA")
    d = ImageDraw.Draw(im)

    k = big / 58               # siatka 64 jak web/icon.svg: kafelek 3..61 = cała kratka
    P = lambda v: big / 2 + (v - 32) * k

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
