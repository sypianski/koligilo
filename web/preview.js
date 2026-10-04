// Podgląd strony (TASK-23): przybliżenie w CSS tego, co crengine zrobi na czytniku.
// Decyzja i znane rozbieżności: ~/utensili/libraro/decyzje/PC-005-*.md. Wierny
// render prawdziwym crengine to osobny TASK-24 (przycisk poniżej jest nieaktywny).
// Czyste funkcje (skala, CSS, dokument) są testowane w node: tests/preview_test.js.
"use strict";

const Preview = (() => {
  const KOD = typeof KO !== "undefined" ? KO : (typeof require !== "undefined" ? require("./koreader_opts.js") : null);
  const LUA = typeof luaList !== "undefined" ? { luaList, luaSerialize } : require("./lua.js");

  // Rozdzielczość = okno KOReadera w pionie (piksele ekranu). ppi tylko do opisu.
  const PROFILES = [
    { id: "bigme-hibreak", label: "BigMe HiBreak 6,13″", w: 824, h: 1648, ppi: 300, gray: true, re: /hibreak|bigme/i },
    { id: "kindle-pw", label: "Kindle Paperwhite 6,8″", w: 1236, h: 1648, ppi: 300, gray: true, re: /kindle|paperwhite/i },
    { id: "kobo-libra", label: "Kobo Libra 2 7″", w: 1264, h: 1680, ppi: 300, gray: true, re: /libra/i },
    { id: "kobo-clara", label: "Kobo Clara 6″", w: 1072, h: 1448, ppi: 300, gray: true, re: /clara/i },
    { id: "phone", label: "Telefon (Pixel 7) 6,3″", w: 1080, h: 2400, ppi: 416, gray: false, re: /pixel|phone|android/i },
  ];

  // Screen:scaleBySize z koreader-base (ffi/framebuffer.lua), bez nadpisanego DPI:
  // ceil(v · krótszy_bok / 600). Tak KOReader przelicza rozmiar czcionki („pt” w menu
  // to w praktyce px ekranu 600 px szerokości) i marginesy.
  const scaleBySize = (v, p) => Math.ceil(v * Math.min(p.w, p.h) / 600);

  const get = (t, k) => t instanceof Map ? t.get(k) : (t && typeof t === "object" ? t[k] : undefined);
  const OPT = new Map((KOD ? KOD.opts : []).map(o => [o.key, o]));
  const def = k => OPT.get(k)?.default;
  const val = (s, k) => (s[k] !== undefined && s[k] !== null ? s[k] : def(k));
  const num = (s, k) => { const v = val(s, k); return typeof v === "number" ? v : Number(def(k)); };
  const pair = (s, k) => { const l = LUA.luaList(val(s, k)) || LUA.luaList(def(k)) || [0, 0]; return [Number(l[0]), Number(l[1])]; };
  const on = (t, k) => get(t, k) === true;

  // gamma: wartość to indeks crengine, etykieta z menu to faktyczna gamma
  function gammaOf(idx) {
    const o = OPT.get("copt_font_gamma");
    const i = o ? o.values.indexOf(idx) : -1;
    return i >= 0 ? Number(o.labels[i]) : 1;
  }

  // Poprawki włączone we wspólnej wartości, w kolejności KOReadera (priorytet pomijamy).
  function activeTweaks(s) {
    const t = val(s, "style_tweaks");
    return (KOD ? KOD.tweaks : []).filter(tw => tw.css && on(t, tw.id));
  }

  function footerSettings(s) {
    const d = KOD?.preview?.footer || {};
    const f = val(s, "footer");
    const out = { ...d };
    if (f instanceof Map) for (const [k, v] of f) out[k] = v;
    else if (f && typeof f === "object") Object.assign(out, f);
    return out;
  }

  // Wszystkie liczby, z których składa się strona (px ekranu urządzenia).
  function metrics(s, p) {
    const fs = scaleBySize(num(s, "copt_font_size"), p);
    const [ml, mr] = pair(s, "copt_h_page_margins");
    const ft = footerSettings(s);
    const footerOn = !ft.disabled;
    const footerH = footerOn ? scaleBySize(ft.container_height ?? 14, p) + scaleBySize(ft.container_bottom_padding ?? 1, p) : 0;
    const headerOn = num(s, "copt_status_line") === 0;
    const headerFs = scaleBySize(KOD?.preview?.cre_header_size || 20, p);
    const dpi = num(s, "copt_render_dpi");
    return {
      fs, lineSpacing: num(s, "copt_line_spacing"),
      left: scaleBySize(ml, p), right: scaleBySize(mr, p),
      top: scaleBySize(num(s, "copt_t_page_margin"), p),
      // readertypeset.lua: dolny margines + wysokość paska stanu, chyba że „nakładaj się”
      bottom: scaleBySize(num(s, "copt_b_page_margin"), p) + (ft.reclaim_height ? 0 : footerH),
      footerOn, footerH, footerFs: scaleBySize(ft.text_font_size ?? 14, p), footer: ft,
      headerOn, headerH: headerOn ? Math.ceil(headerFs * 1.5) : 0, headerFs,
      u: dpi > 0 ? dpi / 96 : 1, dpi,
      weight: num(s, "copt_font_base_weight"), gamma: gammaOf(num(s, "copt_font_gamma")),
      wordSpacing: pair(s, "copt_word_spacing"), wordExpansion: num(s, "copt_word_expansion"),
      kerning: num(s, "copt_font_kerning"), blockMode: num(s, "copt_block_rendering_mode"),
      viewMode: num(s, "copt_view_mode"), embeddedCss: num(s, "copt_embedded_css") !== 0,
    };
  }

  // ---------------------------------------------------------------- CSS crengine → przeglądarka

  // Nazwa kroju trafia do CSS w srcdoc: bez cudzysłowów, ukośników i nawiasów kątowych.
  const fontName = x => typeof x === "string" ? x.replace(/["\\<>{};\n\r]/g, "").trim() : "";

  function stripCrMedia(css) {
    let out = "", i = 0;
    for (;;) {
      const at = css.slice(i).search(/@media[^{]*-cr-/);
      if (at < 0) return out + css.slice(i);
      out += css.slice(i, i + at);
      let j = css.indexOf("{", i + at), depth = 0;
      for (; j < css.length; j++) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}" && --depth === 0) break;
      }
      i = j + 1;
    }
  }

  // -cr-only-if: warunki dokumentu liczymy tu (EPUB, tryb renderowania), warunki
  // przypisu na stronie zamieniamy na selektor .fnarea; nieznane — reguła odpada.
  function crCondition(tokens, ctx) {
    let scope = null;
    for (const tok of tokens) {
      const neg = tok.startsWith("-"), name = neg ? tok.slice(1) : tok;
      let v;
      switch (name) {
        case "epub-document": v = true; break;
        case "fb2-document": case "txt-document": case "html-document": v = false; break;
        case "legacy": v = ctx.blockMode === 0; break;
        case "enhanced": v = ctx.blockMode !== 0; break;
        case "float-floatboxes": v = ctx.blockMode >= 2; break;
        case "line-height-normal": case "inline": v = true; break;
        case "inside-inpage-footnote": if (!neg) scope = scope || "inside"; v = true; break;
        case "inpage-footnote": if (!neg) scope = "self"; else if (scope === "inside") scope = "desc"; v = true; break;
        default: return { ok: false };
      }
      if (neg ? v && !name.includes("footnote") && name !== "inline" : !v) return { ok: false };
    }
    return { ok: true, scope };
  }

  const ABS = /(-?\d*\.?\d+)(px|pt)\b/g;
  const scaleAbs = (decl, ctx) => ctx.u === 1 ? decl : decl.replace(ABS, (m, n, unit) => `${+(n * ctx.u).toFixed(3)}${unit}`);

  function translateCss(css, ctx) {
    const inpage = [];
    let out = "";
    const src = stripCrMedia(css.replace(/\/\*[\s\S]*?\*\//g, "")).replace(/@import[^;]*;/g, "");
    for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim();
      const decls = m[2].split(";").map(d => d.trim()).filter(Boolean);
      const cond = decls.find(d => /^-cr-only-if\s*:/.test(d));
      let scope = null;
      if (cond) {
        const r = crCondition(cond.split(":")[1].trim().split(/\s+/), ctx);
        if (!r.ok) continue;
        scope = r.scope;
      }
      const hint = decls.find(d => /^-cr-hint\s*:.*\bfootnote-inpage\b/.test(d));
      if (hint) inpage.push(sel);
      const keep = decls.filter(d => !/^-cr-/.test(d)).map(d => scaleAbs(d, ctx));
      if (!keep.length) continue;
      const parts = sel.split(",").map(x => x.trim()).filter(x => x && x !== "autoBoxing");
      const scoped = parts.map(x => scope === "self" ? `.fnarea > ${x}` : scope === "desc" ? `.fnarea > * ${x}` : scope === "inside" ? `.fnarea ${x}` : x);
      if (scoped.length) out += `${scoped.join(", ")} { ${keep.join("; ")}; }\n`;
    }
    return { css: out, inpage };
  }

  // ---------------------------------------------------------------- strona przykładowa

  const IMG = "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140">` +
    `<rect width="240" height="140" fill="#eee"/><path d="M0 110 L60 60 L100 90 L150 40 L240 105 L240 140 L0 140Z" fill="#777"/>` +
    `<circle cx="190" cy="32" r="14" fill="#bbb"/><path d="M0 122 Q60 112 120 124 T240 118" stroke="#333" stroke-width="3" fill="none"/></svg>`);

  const BOOK = { title: "Brzegi i przeprawy", author: "Anna Przykładowa", chapter: "III. Nad rzeką", page: 57, total: 312 };

  // Arkusz „wydawcy” — wyłączany przez „Style osadzone” (copt_embedded_css).
  const PUBLISHER_CSS = `
h1.ch { text-align: center; margin-top: 1.4em; }
h2.sub { text-align: center; font-style: italic; font-weight: normal; }
p.first { text-indent: 0; }
span.dropcap { float: left; font-size: 3.1em; line-height: 0.85; margin: 0.05em 0.08em 0 0; font-weight: bold; }
.sc { font-variant: small-caps; }
div.poem { margin: 0.6em 0 0.6em 2em; }
div.poem p { text-indent: 0; text-align: left; }
div.poem p.in { margin-left: 1.5em; }
figure { margin: 0.8em 0; text-align: center; text-indent: 0; }
figcaption { font-size: 85%; font-style: italic; }
p.note-ref-end { text-indent: 0; }`;

  // Tekst z miękkimi łącznikami (&shy;) wg wzorców pl (left 2, right 2 — jak w KOReaderze):
  // przeglądarki bez słownika polskiego (np. Chromium na Linuksie) też podzielą wyrazy.
  const SAMPLE = `
<h1 class="ch">Rozdział trzeci</h1>
<h2 class="sub">Nad rzeką, o świcie</h2>
<h3>1. Przeprawa</h3>
<p class="first"><span class="dropcap">R</span>zeka o tej porze była szara i nie&shy;ru&shy;cho&shy;ma, jakby ktoś roz&shy;lał po łą&shy;kach roz&shy;to&shy;pio&shy;ną cynę. Prze&shy;woź&shy;nik stał już przy pro&shy;mie i palił fajkę, przy&shy;glą&shy;da&shy;jąc się nad&shy;cho&shy;dzą&shy;cym z&nbsp;nie&shy;prze&shy;nik&shy;nio&shy;ną cier&shy;pli&shy;wo&shy;ścią czło&shy;wie&shy;ka, który wi&shy;dział setki po&shy;dob&shy;nych po&shy;ran&shy;ków<a href="#fn1" id="ref1" role="doc-noteref" type="noteref"><sup>1</sup></a>.</p>
<p>Naj&shy;praw&shy;do&shy;po&shy;dob&shy;niej nikt z&nbsp;po&shy;dróż&shy;nych nie zda&shy;wał sobie spra&shy;wy, że współ&shy;od&shy;po&shy;wie&shy;dzial&shy;ność za bez&shy;pie&shy;czeń&shy;stwo prze&shy;pra&shy;wy spo&shy;czy&shy;wa także na nich. Trze&shy;ba było za&shy;cho&shy;wać <em>spo&shy;kój</em>, trzy&shy;mać się <strong>po&shy;rę&shy;czy</strong> i nie wy&shy;chy&shy;lać się za burtę, zwłasz&shy;cza przy <span class="sc">Sta&shy;rym Mły&shy;nie</span>, gdzie nurt przy&shy;spie&shy;szał nie&shy;spo&shy;dzie&shy;wa&shy;nie.</p>
<p>Prze&shy;woź&shy;nik mruk&shy;nął coś pod nosem i od&shy;wią&shy;zał linę. Prom za&shy;ko&shy;ły&shy;sał się, za&shy;trzesz&shy;czał i po&shy;wo&shy;li, nie&shy;praw&shy;do&shy;po&shy;dob&shy;nie po&shy;wo&shy;li, za&shy;czął sunąć ku prze&shy;ciw&shy;le&shy;głe&shy;mu brze&shy;go&shy;wi.</p>
<blockquote><p>„Rzeka ni&shy;cze&shy;go nie od&shy;da&shy;je za darmo — ma&shy;wiał jego oj&shy;ciec — ale też ni&shy;cze&shy;go nie za&shy;bie&shy;ra bez po&shy;wo&shy;du”.</p></blockquote>
<p>Na środ&shy;ku nurtu mgła gęst&shy;nia&shy;ła. Ktoś za&shy;czął cicho nucić starą pio&shy;sen&shy;kę fli&shy;sa&shy;ków:</p>
<div class="poem">
<p>Pły&shy;nie woda, pły&shy;nie czas,</p>
<p class="in">nikt nie wróci drugi raz;</p>
<p>kto zo&shy;sta&shy;wił serce tu,</p>
<p class="in">ten je znaj&shy;dzie w szu&shy;mie snu.</p>
</div>
<p>W sa&shy;kwie na&shy;uczy&shy;cie&shy;la, który je&shy;chał do mia&shy;stecz&shy;ka po książ&shy;ki, le&shy;ża&shy;ła kart&shy;ka z&nbsp;listą spra&shy;wun&shy;ków:</p>
<ul><li>atra&shy;ment i dwa tu&shy;zi&shy;ny sta&shy;ló&shy;wek,</li><li>słow&shy;nik grec&shy;ki (<span lang="grc">λεξικόν</span>),</li><li>świe&shy;ce ło&shy;jo&shy;we.</li></ul>
<ol><li>Naj&shy;pierw pocz&shy;ta,</li><li>potem księ&shy;gar&shy;nia,</li><li>na końcu targ.</li></ol>
<figure><img class="fig" src="${IMG}" alt="Szkic: rzeka i wzgórza o świcie" width="240" height="140"><figcaption>Ryc. 1. Prze&shy;pra&shy;wa pod Sta&shy;rym Mły&shy;nem (szkic z&nbsp;no&shy;tat&shy;ni&shy;ka).</figcaption></figure>
<p>Na&shy;uczy&shy;ciel otwo&shy;rzył no&shy;tat&shy;nik i od&shy;czy&shy;tał za&shy;no&shy;to&shy;wa&shy;ny wie&shy;czo&shy;rem cytat: <span lang="grc">ἐν ἀρχῇ ἦν ὁ λόγος</span>, a pod nim arab&shy;skie przy&shy;sło&shy;wie <span lang="ar" dir="rtl">العلم نور</span> — „wie&shy;dza jest świa&shy;tłem”. Prze&shy;woź&shy;nik po&shy;ki&shy;wał głową, choć nie zro&shy;zu&shy;miał ani słowa.</p>
<table><caption>Roz&shy;kład prze&shy;praw</caption><tr><th>Pora</th><th>Kurs</th><th>Opła&shy;ta</th></tr><tr><td>świt</td><td>na lewy brzeg</td><td>2 gro&shy;sze</td></tr><tr><td>po&shy;łu&shy;dnie</td><td>na prawy brzeg</td><td>3 gro&shy;sze</td></tr></table>
<p>Kiedy do&shy;bi&shy;li do brze&shy;gu, słoń&shy;ce prze&shy;bi&shy;ło się wresz&shy;cie przez mgłę. Po&shy;dróż&shy;ni ro&shy;ze&shy;szli się każdy w&nbsp;swoją stro&shy;nę, a&nbsp;prze&shy;woź&shy;nik, jak co dzień, usiadł na pniu i pa&shy;trzył, jak rzeka zmie&shy;nia kolor z&nbsp;sza&shy;re&shy;go na złoty. Ten aka&shy;pit jest dłuż&shy;szy, żeby przejść przez gra&shy;ni&shy;cę stro&shy;ny i po&shy;ka&shy;zać, czy na dole zo&shy;sta&shy;je sa&shy;mot&shy;ny wiersz (szewc), czy na górze na&shy;stęp&shy;nej stro&shy;ny lą&shy;du&shy;je ostat&shy;ni wiersz aka&shy;pi&shy;tu (bę&shy;kart). Takie de&shy;cy&shy;zje po&shy;dej&shy;mu&shy;je sil&shy;nik przy ła&shy;ma&shy;niu stron, za&shy;leż&shy;nie od usta&shy;wień po&shy;pra&shy;wek stylu.</p>
<p>Rzeka pły&shy;nę&shy;ła dalej, obo&shy;jęt&shy;na na ludz&shy;kie spra&shy;wy, jak pły&shy;nę&shy;ła przed stu laty i jak bę&shy;dzie pły&shy;nąć jutro.</p>
<aside id="fn1" role="doc-footnote" type="footnote"><p class="note-ref-end"><a href="#ref1">1</a> Prze&shy;woź&shy;nik pra&shy;co&shy;wał przy tej prze&shy;pra&shy;wie od czter&shy;dzie&shy;stu lat; prze&shy;jął ją po ojcu.</p></aside>`;

  // ---------------------------------------------------------------- dokument ramki

  // Główny krój, a gdy go brak w przeglądarce — ogólny szeryfowy (nie pierwszy z listy
  // zapasowych, bo tam jest FreeSans). Zapasowe KOReadera dalej łatają brakujące znaki.
  function fontStack(s) {
    const q = n => `"${n}"`;
    const main = fontName(val(s, "cre_font")) || KOD?.preview?.default_font || "Noto Serif";
    const rest = [fontName(val(s, "fallback_font")), ...(KOD?.preview?.fallback_fonts || [])].filter(n => n && n !== main);
    return [q(main), "serif", ...[...new Set(rest)].map(q)].join(", ");
  }

  // normalLH: zmierzony stosunek line-height:normal do rozmiaru czcionki (crengine
  // liczy interlinię 100 % od metryki kroju, nie od stałej 1,2).
  function buildDoc(s, p, opt = {}) {
    const m = metrics(s, p);
    const ctx = { blockMode: m.blockMode, u: m.u };
    const base = translateCss(KOD?.preview?.epub_css || "", ctx);
    const tw = activeTweaks(s).map(t => translateCss(t.css, ctx));
    const lhTweak = activeTweaks(s).map(t => /^normal_line-height_([\d.]+)$/.exec(t.id)).filter(Boolean).pop();
    const normal = lhTweak ? Number(lhTweak[1]) / 100 : (opt.normalLH || 1.2);
    const lh = +(normal * m.lineSpacing / 100).toFixed(4);
    const [scale] = m.wordSpacing;
    const gammaShadow = m.gamma > 1 ? `-webkit-text-stroke: ${+(Math.min(0.06, 0.012 * Math.log2(m.gamma))).toFixed(4)}em currentColor;` : "";
    const gammaColor = m.gamma < 1 ? "#3a3a3a" : "#000";
    const contentH = p.h - m.top - m.bottom - m.headerH;
    const css = `
html { font-size: ${m.fs}px; }
html, body { margin: 0; padding: 0; background: #fff; }
body { width: ${p.w}px; height: ${p.h}px; overflow: hidden; position: relative; color: ${gammaColor};
  font-family: ${fontStack(s)}; font-size: ${m.fs}px; line-height: ${lh};
  font-weight: ${Math.round(400 + m.weight * 100)}; ${gammaShadow}
  word-spacing: ${+((scale / 100 - 1) * 0.25).toFixed(4)}em;
  font-kerning: ${m.kerning === 0 ? "none" : "normal"}; font-variant-ligatures: ${m.kerning >= 3 ? "common-ligatures" : "none"};
  ${p.gray ? "filter: grayscale(1);" : ""} }
.book { orphans: 1; widows: 1; hyphens: auto; -webkit-hyphens: auto; }
b, strong, th, dt, h1, h2, h3, h4, h5, h6, span.dropcap { font-weight: ${Math.min(1000, Math.round(700 + m.weight * 100))}; }
h2.sub { font-weight: ${Math.round(400 + m.weight * 100)}; }
img.fig { width: ${+(240 * m.u).toFixed(1)}px; height: auto; max-width: 100%; }
.pages { position: absolute; left: ${m.left}px; top: ${m.top + m.headerH}px; width: ${p.w - m.left - m.right}px;
  height: ${contentH}px; overflow: hidden; }
.paged .book { height: 100%; column-width: ${p.w - m.left - m.right}px; column-gap: 0; column-fill: auto; }
.fnarea { position: absolute; left: ${m.left}px; width: ${p.w - m.left - m.right}px; bottom: ${m.bottom}px; font-size: 0.8rem; }
.fnarea::before { content: ""; display: block; width: 30%; border-top: 1px solid #000; margin-bottom: 0.3em; }
.fnarea aside { display: block; }
.ftr { position: absolute; left: ${m.left}px; right: ${m.right}px; bottom: 0; height: ${m.footerH}px; display: flex; align-items: center; gap: ${Math.round(m.footerFs * 0.6)}px;
  font: ${m.footerFs}px/1 "${fontName(KOD?.preview?.header_font) || "Noto Sans"}", sans-serif; color: #000; -webkit-text-stroke: 0; white-space: nowrap; }
.ftr .bar { flex: 1; min-width: 20%; height: ${scaleBySize(m.footer.progress_style_thin ? 3 : 7, p)}px; border: 1px solid #000; position: relative; }
.ftr .bar i { position: absolute; inset: 0 auto 0 0; background: #000; }
.ftr .bar b { position: absolute; top: -3px; bottom: -3px; width: 2px; background: #000; }
.ftr .sep { opacity: .6; }
.hdr { position: absolute; left: ${m.left}px; right: ${m.right}px; top: ${m.top}px; height: ${m.headerH}px; display: flex; justify-content: space-between; align-items: center;
  font: ${m.headerFs}px/1 "${fontName(KOD?.preview?.header_font) || "Noto Sans"}", sans-serif; border-bottom: 1px solid #000; -webkit-text-stroke: 0; }
${m.blockMode < 2 ? "span.dropcap, img { float: none !important; }" : ""}`;
    return {
      m, inpage: [...base.inpage, ...tw.flatMap(t => t.inpage)],
      html: `<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>${base.css}</style>` +
        (m.embeddedCss ? `<style>${PUBLISHER_CSS}</style>` : "") +
        `<style>${tw.map(t => t.css).join("\n")}</style><style>${css}</style></head>` +
        `<body><div class="pages${m.viewMode === 0 ? " paged" : ""}"><div class="book" lang="pl">${SAMPLE}</div></div>` +
        (m.headerOn ? `<div class="hdr"><span>${BOOK.title}</span><span>57 / 312</span></div>` : "") +
        `<div class="fnarea" hidden></div>${m.footerOn ? `<div class="ftr" aria-hidden="true"></div>` : ""}</body></html>`,
    };
  }

  // Pasek stanu KOReadera: jeden element albo wszystkie naraz, z paskiem postępu obok.
  const FOOTER_ITEMS = {
    page_progress: (pg) => `${pg} / ${BOOK.total}`,
    pages_left_book: (pg) => `↣ ${BOOK.total - pg}`,
    time: () => "⌚ 07:42",
    pages_left: () => "⇒ 6",
    battery: () => "▮ 83%",
    percentage: (pg) => `⤠ ${Math.round(pg / BOOK.total * 100)}%`,
    book_time_to_read: () => "⏳ 7 h 12 min",
    chapter_time_to_read: () => "⤻ 9 min",
    frontlight: () => "☼ 12",
    mem_usage: () => "▤ 84 MiB",
    wifi_status: () => "Wi-Fi",
    book_title: () => BOOK.title,
    book_author: () => BOOK.author,
    book_chapter: () => BOOK.chapter,
    bookmark_count: () => "☆ 3",
    chapter_progress: (pg) => `${pg - 50} / 14`,
  };
  function footerHTML(ft, pg) {
    const order = (KOD?.opts.find(o => o.key === "footer")?.flags || []).map(f => f.k).filter(k => FOOTER_ITEMS[k]);
    let items = order.filter(k => ft[k] === true).map(k => FOOTER_ITEMS[k](pg));
    if (!ft.all_at_once) items = items.slice(0, 1);
    const esc = x => String(x).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
    const text = items.map(esc).join(ft.items_separator === "bar" ? ' <span class="sep">|</span> ' : "  ");
    const pct = (pg / BOOK.total * 100).toFixed(1);
    const bar = ft.disable_progress_bar ? "" :
      `<span class="bar"><i style="width:${pct}%"></i>${ft.toc_markers ? '<b style="left:18%"></b><b style="left:47%"></b><b style="left:71%"></b>' : ""}</span>`;
    return ft.progress_bar_position === "below" ? text : bar + (text ? `<span>${text}</span>` : "");
  }

  // ---------------------------------------------------------------- panel (DOM)

  const st = { open: false, id: null, key: null, label: "", base: null, cur: null, cand: undefined, hasCand: false,
    mode: "po", page: 0, pages: 1, prof: null, devices: [], docs: {}, lh: {} };
  const PROF_KEY = "koligilo.preview.profile";
  const MODE_KEY = "koligilo.preview.mode";
  try { st.prof = localStorage.getItem(PROF_KEY); st.mode = localStorage.getItem(MODE_KEY) || "po"; } catch { /* bez pamięci */ }

  const $ = id => document.getElementById(id);
  const profile = () => PROFILES.find(p => p.id === st.prof) || PROFILES[0];

  // stosunek line-height:normal do rozmiaru dla danego stosu czcionek (w oknie panelu)
  function normalLH(stack) {
    if (st.lh[stack]) return st.lh[stack];
    const el = document.createElement("span");
    el.style.cssText = `position:absolute;visibility:hidden;font:100px/normal ${stack};white-space:nowrap`;
    el.textContent = "Ąg";
    document.body.append(el);
    const r = el.getBoundingClientRect().height / 100;
    el.remove();
    return (st.lh[stack] = r > 0.8 && r < 2 ? r : 1.2);
  }

  // czy krój jest w tej przeglądarce (porównanie szerokości z krojem zastępczym)
  function hasFont(name) {
    const c = document.createElement("canvas").getContext("2d");
    const t = "Zażółć gęślą jaźń 0123";
    return ["monospace", "serif"].some(g => {
      c.font = `40px ${g}`; const a = c.measureText(t).width;
      c.font = `40px "${name}", ${g}`; return c.measureText(t).width !== a;
    });
  }

  function settingsFor(which) {
    if (which === "przed") return st.base || st.cur || {};
    const cur = st.cur || {};
    return st.hasCand ? { ...cur, [st.key]: st.cand } : cur;
  }

  function mount() {
    if ($("pv")) return;
    const shell = $("shell");
    const aside = h("aside", { id: "pv", class: "pv", role: "complementary", "aria-labelledby": "pv-title", hidden: true },
      h("div", { class: "pv-head" },
        h("div", {},
          h("h2", { id: "pv-title" }, "Podgląd strony"),
          h("p", { id: "pv-sub", class: "pv-sub" })),
        h("button", { type: "button", class: "pv-x", "aria-label": "Zamknij podgląd (Esc)", title: "Zamknij (Esc)", onclick: () => close(true) }, "×")),
      h("div", { class: "pv-bar" },
        h("label", { class: "pv-prof" }, h("span", {}, "Ekran"),
          h("select", { id: "pv-prof", onchange: ev => { st.prof = ev.target.value; try { localStorage.setItem(PROF_KEY, st.prof); } catch {} st.page = 0; draw(); } })),
        h("div", { id: "pv-mode", class: "seg", role: "radiogroup", "aria-label": "Porównanie" },
          [["przed", "Przed"], ["po", "Po"], ["obok", "Obok siebie"]].map(([v, l]) => h("button", {
            type: "button", role: "radio", "data-v": v,
            onclick: () => { st.mode = v; try { localStorage.setItem(MODE_KEY, v); } catch {} draw(); } }, l)))),
      h("div", { id: "pv-stage", class: "pv-stage" }),
      h("div", { class: "pv-nav" },
        h("button", { type: "button", id: "pv-prev", "aria-label": "Poprzednia strona", onclick: () => flip(-1) }, "‹"),
        h("span", { id: "pv-pg", "aria-live": "polite" }),
        h("button", { type: "button", id: "pv-next", "aria-label": "Następna strona", onclick: () => flip(1) }, "›")),
      h("p", { id: "pv-metrics", class: "pv-metrics" }),
      h("p", { class: "pv-note" },
        "Przybliżenie w przeglądarce (CSS), nie render crengine — łamanie wierszy i stron może się różnić o kilka wierszy. ",
        h("button", { type: "button", class: "linkish", disabled: true, title: "Wierny podgląd prawdziwym crengine — w przygotowaniu (TASK-24)" }, "Wierny podgląd (crengine)")));
    shell.append(aside);
    new ResizeObserver(() => st.open && fit()).observe(aside);
    document.addEventListener("keydown", ev => {
      if (ev.key === "Escape" && st.open && !ev.defaultPrevented) { ev.preventDefault(); close(true); }
    });
  }

  function frameBox(which) {
    const box = h("figure", { class: "pv-frame", "data-w": which },
      h("figcaption", {}),
      h("div", { class: "pv-screen" }, h("iframe", { title: `Podgląd strony — ${which === "przed" ? "przed zmianą" : "po zmianie"}`,
        sandbox: "allow-same-origin", tabindex: "-1", onload: ev => layoutFrame(ev.target, which) })));
    return box;
  }

  function caption(which) {
    const o = OPT.get(st.key);
    const v = settingsFor(which)[st.key];
    let txt = "";
    if (o && typeof fmtValue === "function" && o.values) txt = v === undefined ? `${fmtValue(o, o.default)} (domyślne)` : fmtValue(o, v);
    else if (o?.kind === "font") txt = v ? String(v) : `${KOD.preview.default_font} (domyślna)`;
    const same = which === "po" && LUA.luaSerialize(settingsFor("po")[st.key] ?? null) === LUA.luaSerialize(settingsFor("przed")[st.key] ?? null);
    return (which === "przed" ? "Przed" : "Po") + (txt ? ": " + txt : "") + (same ? " (bez zmian)" : "");
  }

  function draw() {
    if (!st.open) return;
    const p = profile();
    const sel = $("pv-prof");
    sel.replaceChildren(...PROFILES.map(x => {
      const dev = st.devices.filter(d => x.re.test(d.model || d.name || "")).map(d => d.name).join(", ");
      return h("option", { value: x.id, selected: x.id === p.id || null }, x.label + ` · ${x.w}×${x.h}` + (dev ? ` · jak ${dev}` : ""));
    }));
    for (const b of $("pv-mode").children) b.setAttribute("aria-checked", String(b.dataset.v === st.mode));
    $("pv-sub").textContent = st.label;
    const want = st.mode === "obok" ? ["przed", "po"] : [st.mode];
    const stage = $("pv-stage");
    stage.classList.toggle("two", want.length === 2);
    for (const f of [...stage.children]) if (!want.includes(f.dataset.w)) f.remove();
    for (const w of want) {
      let f = stage.querySelector(`[data-w="${w}"]`);
      if (!f) { f = frameBox(w); stage.append(f); }
      if (w === "przed" && stage.firstChild !== f) stage.prepend(f);
      const cap = f.querySelector("figcaption");
      cap.textContent = caption(w);
      cap.title = w === "po" ? "Najedź na inną wartość albo wpisz własną, żeby zobaczyć ją przed zapisaniem" : "";
      const s = settingsFor(w);
      const doc = buildDoc(s, p, { normalLH: normalLH(fontStack(s)) });
      const fr = f.querySelector("iframe");
      fr._pv = doc;
      fr.style.width = p.w + "px"; fr.style.height = p.h + "px";
      if (fr.srcdoc !== doc.html) fr.srcdoc = doc.html; else layoutFrame(fr, w);
    }
    const s = settingsFor(want[want.length - 1]);
    const m = metrics(s, p);
    const font = fontName(val(s, "cre_font")) || KOD.preview.default_font;
    $("pv-metrics").textContent =
      `${p.label}, ${p.w}×${p.h} px, ${p.ppi} ppi. Czcionka ${String(num(s, "copt_font_size")).replace(".", ",")} → ${m.fs} px ekranu` +
      ` (KOReader: rozmiar × krótszy bok / 600). Marginesy: L ${m.left}, P ${m.right}, G ${m.top}, D ${m.bottom} px` +
      (m.footerOn && !m.footer.reclaim_height ? ` (w tym pasek stanu ${m.footerH} px)` : "") + `. Interlinia ${m.lineSpacing} %.` +
      (hasFont(font) ? "" : ` Kroju „${font}” nie ma w tej przeglądarce — podgląd użył zastępczego.`) +
      (num(s, "copt_visible_pages") === 2 ? " Dwie kolumny KOReader pokazuje tylko w poziomie — podgląd jest pionowy." : "");
    fit();
  }

  // po załadowaniu ramki: przypisy na stronie, liczba stron, pasek stanu
  function layoutFrame(fr, which) {
    const d = fr.contentDocument, doc = fr._pv;
    if (!d || !doc || !d.body) return;
    const pages = d.querySelector(".pages"), fn = d.querySelector(".fnarea");
    if (!pages) return;
    const W = pages.clientWidth;
    let fnEls = [];
    for (const sel of doc.inpage) { try { fnEls.push(...d.querySelectorAll(sel)); } catch { /* selektor spoza przeglądarki */ } }
    fnEls = [...new Set(fnEls)].filter(e => d.querySelector(".book").contains(e));
    if (fnEls.length && fn) {
      fn.append(...fnEls); fn.hidden = false;
      pages.style.height = (pages.clientHeight - fn.offsetHeight - Math.round(doc.m.fs * 0.5)) + "px";
    }
    const book = d.querySelector(".book");
    const n = doc.m.viewMode === 0 ? Math.max(1, Math.round(book.scrollWidth / W)) : 1;
    if (which === (st.mode === "obok" ? "po" : st.mode)) st.pages = n;
    const pg = Math.min(st.page, n - 1);
    pages.scrollLeft = pg * W;
    if (fn && fnEls.length) {
      const ref = d.getElementById("ref1");
      const refPage = ref ? Math.floor((ref.getBoundingClientRect().left - pages.getBoundingClientRect().left + pages.scrollLeft) / W) : 0;
      fn.hidden = refPage !== pg;
    }
    const ftr = d.querySelector(".ftr");
    if (ftr) ftr.innerHTML = footerHTML(doc.m.footer, BOOK.page + pg);
    const hdr = d.querySelector(".hdr span:last-child");
    if (hdr) hdr.textContent = `${BOOK.page + pg} / ${BOOK.total}`;
    $("pv-pg").textContent = `strona ${Math.min(st.page, st.pages - 1) + 1} z ${st.pages}`;
    $("pv-prev").disabled = st.page <= 0;
    $("pv-next").disabled = st.page >= st.pages - 1;
  }

  function flip(d) {
    st.page = Math.max(0, Math.min(st.pages - 1, st.page + d));
    for (const fr of document.querySelectorAll("#pv-stage iframe")) layoutFrame(fr, fr.closest("figure").dataset.w);
  }

  // skala ramek do szerokości panelu (i wysokości okna), z zachowaniem proporcji ekranu
  function fit() {
    const stage = $("pv-stage"), p = profile();
    if (!stage) return;
    const frames = [...stage.querySelectorAll(".pv-frame")];
    const gap = 12, availW = (stage.clientWidth - gap * (frames.length - 1)) / frames.length;
    const availH = Math.max(240, window.innerHeight - 250);
    const k = Math.max(0.05, Math.min(1, availW / p.w, availH / p.h)); // nigdy powyżej 1:1
    for (const f of frames) {
      const scr = f.querySelector(".pv-screen"), fr = f.querySelector("iframe");
      scr.style.width = Math.floor(p.w * k) + "px"; scr.style.height = Math.floor(p.h * k) + "px";
      fr.style.transform = `scale(${k})`;
    }
  }

  function open(o) {
    mount();
    const changed = st.id !== o.id;
    Object.assign(st, { id: o.id, key: o.key, label: o.label, cur: o.settings });
    if (changed || !st.open) { st.base = o.settings; st.cand = undefined; st.hasCand = false; st.page = 0; }
    if (!st.prof && o.devices) {
      const hit = PROFILES.find(p => o.devices.some(d => p.re.test(d.model || d.name || "")));
      if (hit) st.prof = hit.id;
    }
    st.devices = o.devices || [];
    st.open = true;
    $("pv").hidden = false;
    $("shell").classList.add("pv-open");
    draw();
  }

  function close(returnFocus) {
    if (!st.open) return;
    st.open = false;
    $("pv").hidden = true;
    $("shell").classList.remove("pv-open");
    if (returnFocus) document.querySelector(`.srow[data-id="${CSS.escape(st.id || "")}"]`)?.focus?.();
    st.id = null;
  }

  // odświeżenie wspólnych wartości (co 3 s): przerysuj tylko, gdy coś się zmieniło
  function update(settings, devices) {
    if (!st.open) return;
    const sig = x => { try { return LUA.luaSerialize(Object.fromEntries(Object.entries(x || {}).filter(([, v]) => v !== undefined))); } catch { return Math.random(); } };
    st.devices = devices || st.devices;
    if (sig(settings) === sig(st.cur)) return;
    st.cur = settings;
    draw();
  }

  // wartość „po” zanim klikniesz (najechanie na preset, wpisywanie); undefined = brak
  function candidate(id, value) {
    if (!st.open || id !== st.id) return;
    const has = value !== undefined;
    if (has === st.hasCand && (!has || LUA.luaSerialize(value) === LUA.luaSerialize(st.cand))) return;
    st.cand = value; st.hasCand = has;
    if (has && st.mode === "przed") st.mode = "po";
    draw();
  }

  return { PROFILES, scaleBySize, metrics, translateCss, buildDoc, footerHTML, SAMPLE,
    open, close, update, candidate, isOpen: () => st.open, current: () => st.id };
})();

if (typeof module !== "undefined") module.exports = Preview;
