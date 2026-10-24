#!/usr/bin/env python3
"""Odświeża fontcatalog_data.go: katalog polecanych czcionek do czytania (TASK-37).

  python3 scripts/font-catalog.py        (wymaga `gh` i sieci)

Dla każdej rodziny bierze HEAD gałęzi repozytorium autora, PRZYPINA adresy do
konkretnego commita (raw.githubusercontent.com/<repo>/<commit>/<ścieżka>),
pobiera pliki, liczy sha256 i sprawdza nagłówek sfnt. Serwer koligilo pobiera
potem wyłącznie te adresy i odrzuca plik o innej sumie. Licencje sprawdza się
ręcznie przed dopisaniem rodziny do listy FAM (wszystkie tu to SIL OFL 1.1).
"""
import json, subprocess, hashlib, urllib.request, urllib.parse, sys, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
S4=["Regular","Italic","Bold","BoldItalic"]
def f(pat, names=None): return [pat.format(s) for s in S4]
FAM=[
 dict(id="literata",name="Literata",repo="googlefonts/literata",branch="main",desc="Krój zaprojektowany do długiego czytania na ekranie (dla Google Play Books). Łacina, cyrylica, greka.",scripts="łacina, cyrylica, greka",files=f("fonts/ttf/Literata-{}.ttf")),
 dict(id="source-serif",name="Source Serif 4",repo="adobe-fonts/source-serif",branch="release",desc="Neutralna, czytelna antykwa Adobe. Dobra do tekstów naukowych.",scripts="łacina, cyrylica, greka",files=["OTF/SourceSerif4-Regular.otf","OTF/SourceSerif4-It.otf","OTF/SourceSerif4-Bold.otf","OTF/SourceSerif4-BoldIt.otf"]),
 dict(id="eb-garamond",name="EB Garamond",repo="octaviopardo/EBGaramond12",branch="master",desc="Klasyczna garamondowa antykwa, elegancka w druku i na dużych ekranach. Pełna łacina, greka.",scripts="łacina, greka",files=f("fonts/otf/EBGaramond-{}.otf")),
 dict(id="merriweather",name="Merriweather",repo="SorkinType/Merriweather",branch="master",desc="Mocna, szeroka antykwa o dużym x-height, czytelna na małych ekranach i e-ink.",scripts="łacina, cyrylica",files=f("fonts/ttf/Merriweather-{}.ttf")),
 dict(id="lora",name="Lora",repo="cyrealtype/Lora-Cyrillic",branch="main",desc="Nowoczesna antykwa o kaligraficznym rysunku, dobra do beletrystyki.",scripts="łacina, cyrylica",files=f("fonts/ttf/Lora-{}.ttf")),
 dict(id="noto-serif",name="Noto Serif",repo="notofonts/notofonts.github.io",branch="main",desc="Uniwersalna antykwa Google, pewny wybór przy mieszanych alfabetach.",scripts="łacina, cyrylica, greka",files=f("fonts/NotoSerif/hinted/ttf/NotoSerif-{}.ttf")),
 dict(id="charis-sil",name="Charis",repo="silnrsi/font-charis",branch="master",desc="Antykwa SIL oparta na Bitstream Charter, z ogromnym zestawem znaków diakrytycznych i IPA. Dla filologii.",scripts="łacina (rozszerzona), cyrylica, IPA",files=f("references/v7000/Charis-{}.ttf")),
 dict(id="gentium-book-plus",name="Gentium Book",repo="silnrsi/font-gentium",branch="master",desc="Antykwa SIL z pełną greką polytoniczną i szerokimi znakami diakrytycznymi. Dla klasyków.",scripts="łacina, greka (polytoniczna), cyrylica",files=f("references/v7000/GentiumBook-{}.ttf")),
 dict(id="amiri",name="Amiri",repo="aliftype/amiri",branch="main",desc="Naskh w stylu klasycznych druków bulackich. Do tekstów arabskich (z łaciną).",scripts="arabski, łacina",files=f("fonts/Amiri-{}.ttf")),
 dict(id="atkinson-hyperlegible",name="Atkinson Hyperlegible",repo="googlefonts/atkinson-hyperlegible",branch="main",desc="Krój Braille Institute o maksymalnej rozróżnialności liter. Dla osób słabowidzących.",scripts="łacina",files=f("fonts/ttf/AtkinsonHyperlegible-{}.ttf")),
 dict(id="opendyslexic",name="OpenDyslexic",repo="antijingoist/opendyslexic",branch="main",desc="Krój z obciążonymi dołami liter, ułatwiający czytanie osobom z dysleksją.",scripts="łacina",files=["compiled/OpenDyslexic-Regular.otf","compiled/OpenDyslexic-Italic.otf","compiled/OpenDyslexic-Bold.otf","compiled/OpenDyslexic-BoldItalic.otf"]),
]
def gh(path, jq): return subprocess.check_output(["gh","api",path,"--jq",jq],text=True).strip()
STARTER={"literata","source-serif","atkinson-hyperlegible"}
out=[]
for fam in FAM:
    try: br=gh(f"repos/{fam['repo']}","(.default_branch)")
    except Exception: br=fam["branch"]
    sha=gh(f"repos/{fam['repo']}/commits/{br}",".sha")
    fam["branch"]=br; fam["commit"]=sha
    lic=gh(f"repos/{fam['repo']}",'.license.spdx_id // "?"'); fam["license"]="OFL-1.1" if fam["id"]=="noto-serif" else lic  # Noto: OFL w tabeli name czcionki, repo ma licencję Apache dla kodu
    assert fam["license"]=="OFL-1.1", (fam["id"],lic)
    fam["starter"]=fam["id"] in STARTER
    items=[]
    for p in fam["files"]:
        url=f"https://raw.githubusercontent.com/{fam['repo']}/{sha}/{urllib.parse.quote(p)}"
        try: b=urllib.request.urlopen(url,timeout=60).read()
        except Exception as e: print("FAIL",fam["id"],p,e); continue
        m=b[:4]
        ok = m in (b"\x00\x01\x00\x00",b"OTTO",b"true")
        name=p.rsplit("/",1)[1]
        items.append(dict(file=name,path=p,url=url,sha256=hashlib.sha256(b).hexdigest(),size=len(b),magic_ok=ok))
        print(fam["id"],name,len(b),ok,flush=True)
    fam["items"]=items; del fam["files"]
    assert all(i["magic_ok"] for i in items) and len(items)==4, fam["id"]
    out.append(fam)


def q(s): return json.dumps(s,ensure_ascii=False)
L=["// Kod wygenerowany przez scripts/font-catalog.py — nie edytuj ręcznie.","","package main","","var fontCatalog = []FontFamily{"]
for f in out:
    L.append("\t{")
    L.append(f"\t\tID: {q(f['id'])}, Name: {q(f['name'])}, Scripts: {q(f['scripts'])}, License: {q(f['license'])},")
    L.append(f"\t\tSource: {q('https://github.com/'+f['repo']+'/tree/'+f['commit'])}, Starter: {str(f['starter']).lower()},")
    L.append(f"\t\tDescription: {q(f['desc'])},")
    L.append("\t\tFonts: []CatalogFont{")
    for i in f["items"]:
        L.append(f"\t\t\t{{{q(i['file'])}, {q(i['url'])}, {q(i['sha256'])}, {i['size']}}},")
    L.append("\t\t},")
    L.append("\t},")
L.append("}")
open("fontcatalog_data.go","w").write("\n".join(L)+"\n")
print(len(out),"rodzin")
