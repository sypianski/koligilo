#!/usr/bin/env python3
"""Generuje dictcatalog.json — katalog słowników StarDict z listy KOReadera (TASK-55).

Źródło: frontend/ui/data/dictionaries.lua oraz dictionaries_wikdict.lua i
dictionaries_koreader_dicts.lua z repozytorium koreader/koreader, przypięte do
commitu (REF). Wymaga sieci i `gh` (tylko do rozwiązania gałęzi na commit).

    python3 scripts/dict-catalog.py [REF]     # domyślnie bieżący master

Adresy KOReadera często wskazują „latest” (wydania GitHuba), więc sumy sha256
NIE da się przypiąć w katalogu: serwer liczy ją przy pobraniu (patrz dictcatalog.go
i PC-020). Pozycje spoza listy dozwolonych hostów (dictAllowedHosts) są pomijane.
"""
import hashlib
import json
import re
import subprocess
import sys
import urllib.request
from datetime import date
from urllib.parse import urlparse

REPO = "koreader/koreader"
FILES = [
    ("frontend/ui/data/dictionaries.lua", "koreader"),
    ("frontend/ui/data/dictionaries_wikdict.lua", "wikdict"),
    ("frontend/ui/data/dictionaries_koreader_dicts.lua", "koreader-dicts"),
]
# Musi się zgadzać z dictAllowedHosts w dictcatalog.go (pilnuje TestDictCatalogIntegrity).
ALLOWED = {
    "github.com", "gitlab.com", "build.koreader.rocks", "download.wikdict.com",
    "www.reader-dict.com", "khoicandev.github.io", "cyphar.github.io", "dicionario-aberto.net",
}
STR = r'"((?:[^"\\]|\\.)*)"'


def unescape(s):
    return re.sub(r"\\(.)", lambda m: {"n": "\n", "t": "\t"}.get(m.group(1), m.group(1)), s)


def fetch(ref, path):
    url = f"https://raw.githubusercontent.com/{REPO}/{ref}/{path}"
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read().decode("utf-8")


def entries(text):
    # Każdy wpis to blok `{ name = …, lang_in = …, … url = … }` na poziomie 1 tabeli.
    for blk in re.findall(r"^    \{\n(.*?)^    \},?$", text, re.S | re.M):
        def f(key, num=False):
            if num:
                m = re.search(rf"^\s*{key}\s*=\s*(\d+)", blk, re.M)
                return int(m.group(1)) if m else 0
            m = re.search(rf"^\s*{key}\s*=\s*(?:_\()?{STR}", blk, re.M)
            return unescape(m.group(1)) if m else ""
        yield dict(name=f("name"), lang_in=f("lang_in"), lang_out=f("lang_out"),
                   entries=f("entries", True), license=f("license"), url=f("url"))


def sanitize(s):
    s = re.sub(r'[/\\:*?"<>|\x00-\x1f]', " ", s)
    s = " ".join(s.split())
    while ".." in s:
        s = s.replace("..", ".")
    s = s.strip(". ")
    return s[:96].rstrip(". ")


def main():
    ref = sys.argv[1] if len(sys.argv) > 1 else "master"
    if not re.fullmatch(r"[0-9a-f]{40}", ref):
        ref = subprocess.check_output(
            ["gh", "api", f"repos/{REPO}/commits/{ref}", "--jq", ".sha"], text=True).strip()
    out, seen_url, folders, skipped = [], set(), set(), []
    for path, origin in FILES:
        for e in entries(fetch(ref, path)):
            u = e["url"].replace("http://build.koreader.rocks", "https://build.koreader.rocks")
            p = urlparse(u)
            if not e["name"] or p.scheme != "https" or p.hostname not in ALLOWED or u in seen_url:
                skipped.append(u)
                continue
            seen_url.add(u)
            folder = sanitize(e["name"])
            pair = f'{e["lang_in"]}-{e["lang_out"]}'
            if not folder:
                folder = sanitize(pair) or "slownik"
            if folder.lower() in folders:
                folder = sanitize(f"{folder} ({pair})")
            n = 2
            base = folder
            while folder.lower() in folders:
                folder = f"{base} {n}"
                n += 1
            folders.add(folder.lower())
            out.append(dict(
                id=hashlib.sha256(u.encode()).hexdigest()[:12], name=e["name"], folder=folder,
                lang_in=e["lang_in"], lang_out=e["lang_out"], entries=e["entries"],
                license=e["license"], url=u, origin=origin))
    out.sort(key=lambda d: (d["lang_in"], d["lang_out"], d["name"].lower(), d["id"]))
    doc = dict(source=dict(repo=REPO, ref=ref, generated=date.today().isoformat()), dicts=out)
    with open("dictcatalog.json", "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=0, separators=(",", ":"))
        fh.write("\n")
    print(f"{len(out)} słowników z {REPO}@{ref[:10]}, pominięto {len(skipped)}")
    for u in skipped[:10]:
        print("  pominięty:", u)


if __name__ == "__main__":
    main()
