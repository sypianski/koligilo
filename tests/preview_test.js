// TASK-23: czyste funkcje podglądu strony (web/preview.js) — skala KOReadera,
// tłumaczenie CSS crengine, kompletność strony przykładowej. node tests/preview_test.js
"use strict";
const P = require("../web/preview.js");
const KO = require("../web/koreader_opts.js");

let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${name}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`); }
};
const ok = (name, cond) => { if (!cond) { fail++; console.log("FAIL " + name); } };
const prof = id => P.PROFILES.find(p => p.id === id);

// Screen:scaleBySize: ceil(v · min(w,h) / 600)
eq("scale BigMe 22", P.scaleBySize(22, prof("bigme-hibreak")), 31);
eq("scale Kindle 22", P.scaleBySize(22, prof("kindle-pw")), 46);
eq("scale 600 px = 1:1", P.scaleBySize(22, { w: 600, h: 800 }), 22);

// profile ekranu rozpoznają prawdziwe czytniki (model albo nazwa z parowania)
const forDev = d => P.PROFILES.find(p => p.re.test(`${d.model || ""} ${d.name || ""}`))?.id;
eq("profil: Bigyo", forDev({ name: "Bigyo", model: "hibreak_eea" }), "bigme-hibreak");
eq("profil: Steam Deck po nazwie", forDev({ name: "SteamDeck", model: "Flatpak" }), "steamdeck");
eq("profil: Onyx Note Air3 C", forDev({ name: "Onyx NoteAir3C", model: "Onyx NoteAir3C" }), "onyx-noteair3c");
eq("skala Steam Deck (poziomo) liczy od krótszego boku", P.scaleBySize(22, prof("steamdeck")), 30);

// profil z ekranu zgłoszonego przez czytnik (nowy model bez wpisu w PROFILES)
const dp = P.deviceProfile({ id: "x1", name: "Nowy", model: "Nieznany", platform: "Android", screen: { w: 1872, h: 1404, dpi: 227, color: true } });
eq("ekran czytnika: pion mimo obróconego zgłoszenia", [dp.w, dp.h], [1404, 1872]);
eq("ekran czytnika: kolor => bez szarości", dp.gray, false);
eq("ekran czytnika: etykieta z przekątną", dp.label, "Nowy 10,3″");
const deck = P.deviceProfile({ id: "d1", name: "SteamDeck", platform: "Desktop", screen: { w: 1280, h: 800, dpi: 216 } });
eq("komputer zostaje w poziomie", [deck.w, deck.h, deck.gray], [1280, 800, true]);
eq("brak ekranu => brak profilu", P.deviceProfile({ id: "z", name: "Stary" }), null);
eq("śmieciowy ekran => brak profilu", P.deviceProfile({ id: "z", screen: { w: 10, h: 10, dpi: 1 } }), null);
eq("scale z profilu czytnika", P.scaleBySize(22, dp), 52);
const cu = P.customProfile({ w: "1080", h: "2400", ppi: "416", color: true });
eq("własny ekran: liczby z pól tekstowych", [cu.id, cu.w, cu.h, cu.ppi, cu.gray], ["custom", 1080, 2400, 416, false]);
eq("własny ekran: poza zakresem", P.customProfile({ w: 100, h: 2400, ppi: 416 }), null);
eq("własny ekran: nie-liczby", P.customProfile({ w: "abc", h: 1, ppi: 1 }), null);
eq("własny ekran: brak", P.customProfile(null), null);
ok("własny ekran buduje dokument", /width: 1080px/.test(P.buildDoc({}, cu).html));

// domyślne KOReadera (brak wspólnych wartości) na BigMe
const m0 = P.metrics({}, prof("bigme-hibreak"));
eq("domyślny rozmiar", m0.fs, 31);
eq("domyślne marginesy L/P/G", [m0.left, m0.right, m0.top], [14, 14, 21]);
eq("dolny = margines + pasek stanu", m0.bottom, 21 + m0.footerH);
ok("pasek stanu domyślnie włączony", m0.footerOn && m0.footerH > 0);
eq("interlinia domyślna", m0.lineSpacing, 100);

// AC3: profil ekranu zmienia px czcionki i marginesów
const s = { copt_font_size: 20, copt_h_page_margins: new Map([[1, 30], [2, 30]]), copt_t_page_margin: 10 };
const a = P.metrics(s, prof("bigme-hibreak")), b = P.metrics(s, prof("phone"));
ok("profil zmienia czcionkę", a.fs !== b.fs);
ok("profil zmienia marginesy", a.left !== b.left && a.top !== b.top);
eq("para marginesów z Map (luaParse)", [a.left, a.right], [42, 42]);
const r = P.metrics({ footer: new Map([["reclaim_height", true]]) }, prof("bigme-hibreak"));
eq("nakładanie paska stanu: dolny bez paska", r.bottom, 21);
eq("render_dpi 300 skaluje jednostki bezwzględne", P.metrics({ copt_render_dpi: 300 }, prof("kindle-pw")).u, 300 / 96);

// -cr-only-if: warunki dokumentu i przypisy na stronie
const t = P.translateCss(`
h1 { -cr-only-if: -epub-document; page-break-before: always; }
p { -cr-only-if: legacy; color: red; }
*, autoBoxing { -cr-hint: late; -cr-only-if: inside-inpage-footnote -inline; font-size: 0.8rem !important; }
*[role~="doc-footnote"] { -cr-only-if: -fb2-document; -cr-hint: footnote-inpage; margin: 0 !important; }
td { padding: 3px; }
@media (-cr-max-cre-dom-version: 20180527) { img { display: block; } }`, { blockMode: 2, u: 2 });
ok("-epub-document odpada", !/page-break-before/.test(t.css));
ok("legacy odpada w trybie książka", !/red/.test(t.css));
ok("inside-inpage-footnote → .fnarea", /\.fnarea \* \{ font-size: 0\.8rem/.test(t.css));
eq("footnote-inpage zbiera selektor", t.inpage, ['*[role~="doc-footnote"]']);
ok("px × render_dpi/96", /padding: 6px/.test(t.css));
ok("@media -cr- wycięte", !/display: block/.test(t.css));
ok("legacy działa w trybie wsteczny", /red/.test(P.translateCss("p { -cr-only-if: legacy; color: red; }", { blockMode: 0, u: 1 }).css));

// każda poprawka KOReadera przechodzi przez tłumacza bez wyjątku i bez nawiasów bez pary
for (const tw of KO.tweaks) {
  try {
    const o = P.translateCss(tw.css, { blockMode: 2, u: 1 });
    ok("nawiasy " + tw.id, (o.css.match(/\{/g) || []).length === (o.css.match(/\}/g) || []).length);
  } catch (e) { fail++; console.log("FAIL tweak " + tw.id + ": " + e.message); }
}

// AC2: strona przykładowa zawiera wszystkie elementy z opisu taska
const d = P.buildDoc({ style_tweaks: new Map([["footnote-inpage_epub", true]]), copt_status_line: 0 }, prof("bigme-hibreak"));
for (const [name, re] of [
  ["h1", /<h1/], ["h2 podtytuł", /<h2/], ["h3", /<h3/], ["akapit bez wcięcia", /class="first"/], ["inicjał", /dropcap/],
  ["cytat blokowy", /<blockquote/], ["wiersz", /class="poem"/], ["lista ul", /<ul>/], ["lista ol", /<ol>/],
  ["odnośnik przypisu", /role="doc-noteref"/], ["treść przypisu", /role="doc-footnote"/], ["obraz", /<img/], ["podpis", /<figcaption/],
  ["tabela", /<table/], ["kursywa", /<em>/], ["pogrubienie", /<strong>/], ["kapitaliki", /class="sc"/],
  ["grecki", /lang="grc"/], ["arabski", /lang="ar"/], ["dzielenie po polsku", /hyphens: auto/], ["lang=pl", /class="book" lang="pl"/],
  ["justowanie (epub.css)", /text-align: justify/], ["stopka", /class="ftr"/], ["nagłówek crengine", /class="hdr"/],
]) ok("strona: " + name, re.test(d.html));
ok("przypis na stronie z poprawki EPUB", d.inpage.length > 0);
ok("style wydawcy domyślnie", /dropcap \{ float: left/.test(d.html));
ok("bez stylów wydawcy", !/dropcap \{ float: left/.test(P.buildDoc({ copt_embedded_css: 0 }, prof("bigme-hibreak")).html));

// nazwa czcionki ze wspólnej wartości nie wyjdzie z CSS/HTML
const evil = P.buildDoc({ cre_font: 'X"; } </style><script>alert(1)</script>' }, prof("bigme-hibreak")).html;
ok("czcionka oczyszczona", !/<script>/.test(evil) && !/X"; \}/.test(evil));

// pasek stanu: domyślnie jeden element (strona) + pasek postępu
const f = P.footerHTML(Object.assign({}, KO.preview.footer), 57);
ok("stopka: numer strony", /57 \/ 312/.test(f));
ok("stopka: pasek postępu", /class="bar"/.test(f));
ok("stopka: wszystkie naraz", /⌚/.test(P.footerHTML(Object.assign({}, KO.preview.footer, { all_at_once: true }), 57)));

console.log(fail ? `preview: ${fail} błędów` : "preview: OK");
process.exit(fail ? 1 : 0);
