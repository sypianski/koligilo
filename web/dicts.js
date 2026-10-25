// Słowniki StarDict w panelu (TASK-55, PC-020). Czysta logika zakładki „Słowniki” —
// bez DOM, testowana w node (tests/dicts_test.js), w stylu padmap.js.
//
// Katalog (GET /api/admin/dict-catalog) ma ok. 1,7 tys. pozycji z listy KOReadera,
// więc filtrowanie i liczniki filtrów liczy się tu, a widok rysuje tylko jedną stronę.
"use strict";

const Dicts = (() => {
  const ORIGINS = [["koreader", "KOReader"], ["wikdict", "WikDict"], ["koreader-dicts", "koreader-dicts"]];

  // Wyszukiwanie bez wielkości liter i bez znaków diakrytycznych („zolc” znajdzie „żółć”).
  // „ł” i „ø” nie rozkładają się w NFD, więc idą osobno.
  const fold = s => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/ł/g, "l").replace(/ø/g, "o");

  // Tekst, w którym szukamy: nazwa, kody języków i ich nazwy (jeśli podano funkcję nazw).
  function haystack(c, langName) {
    return fold([c.name, c.folder, c.lang_in, c.lang_out, c.license, c.origin,
      langName ? langName(c.lang_in) : "", langName ? langName(c.lang_out) : ""].join(" "));
  }

  // Język w filtrze: pusty (""/[]) = dowolny, tekst = ten jeden, tablica = którykolwiek z nich (TASK-58).
  const langOk = (want, code) => !want || (Array.isArray(want) ? !want.length || want.includes(code) : want === code);

  // Filtr katalogu. f: {q, inL, outL, origin, only}; inL/outL to kod albo lista kodów (suma w obrębie jednego
  // filtra, iloczyn między „z” i „na”); only = tylko pobrane (haveIds: Set id).
  // Kolejność z katalogu jest zachowana (serwer sortuje po parze języków i nazwie).
  function filterCatalog(cat, f, haveIds, langName) {
    const words = fold(f.q).split(/\s+/).filter(Boolean);
    return cat.filter(c => {
      if (!langOk(f.inL, c.lang_in) || !langOk(f.outL, c.lang_out)) return false;
      if (f.origin && c.origin !== f.origin) return false;
      if (f.only && !(haveIds && haveIds.has(c.id))) return false;
      if (!words.length) return true;
      const hay = haystack(c, langName);
      return words.every(w => hay.includes(w));
    });
  }

  // Wynik od największego (liczba haseł), potem po nazwie — kolejność z katalogu to kody języków,
  // więc pierwszy ekran bez sortowania to afarski i abchaski (TASK-58). Nie zmienia tablicy wejściowej.
  const bySize = list => [...list].sort((a, b) => (b.entries || 0) - (a.entries || 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Liczniki do list wyboru języka: kod → liczba pozycji, malejąco, potem po kodzie.
  function langCounts(cat, key) {
    const m = new Map();
    for (const c of cat) m.set(c[key], (m.get(c[key]) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  }

  // Stan czytnika względem celu (aktywne, zaakceptowane słowniki z panelu).
  // dev: {dicts_allowed, dict_inventory:[{name,sha256}], dict_report_at}
  function deviceState(dev, active) {
    const reported = !!dev.dict_report_at && !String(dev.dict_report_at).startsWith("0001");
    const inv = new Map((dev.dict_inventory || []).map(x => [x.name, x.sha256]));
    const missing = [], stale = [];
    let have = 0;
    for (const d of active) {
      if (!inv.has(d.name)) missing.push(d.name);
      else if (inv.get(d.name) !== d.sha256) stale.push(d.name);
      else have++;
    }
    let kind;
    if (!dev.dicts_allowed) kind = "no-consent";
    else if (!active.length) kind = "empty";
    else if (!reported) kind = "waiting";
    else if (have === active.length) kind = "ok";
    else kind = "partial";
    return { kind, have, total: active.length, missing, stale, reported };
  }

  // Komórka macierzy „słownik × czytnik” (TASK-58): ok | stale | missing | no-consent.
  // dev.dict_inventory to lista {name, sha256} zgłoszona przez czytnik; d to słownik z panelu.
  function cellState(dev, d) {
    if (!dev.dicts_allowed) return "no-consent";
    const got = (dev.dict_inventory || []).find(x => x.name === d.name);
    if (!got) return "missing";
    return got.sha256 === d.sha256 ? "ok" : "stale";
  }

  // Zadanie pobierania z serwera: tekst postępu („pobieranie 12,3 z 45,6 MB (27%)”).
  function jobText(job, fmtSize) {
    if (!job) return "";
    if (job.state === "przetwarzanie") return "przetwarzanie…";
    if (job.state === "błąd") return job.error || "błąd";
    if (job.total > 0) return `pobieranie ${fmtSize(job.done)} z ${fmtSize(job.total)} (${Math.min(100, Math.floor(100 * job.done / job.total))}%)`;
    return job.done > 0 ? `pobieranie ${fmtSize(job.done)}` : "pobieranie…";
  }

  // Zadanie jeszcze trwa (błąd to stan końcowy — nie trzeba go odpytywać).
  const running = jobs => Object.values(jobs || {}).some(j => j.state !== "błąd");

  // Który z zakończonych właśnie zadań się udał: były w poprzednim stanie (trwające),
  // a teraz ich nie ma. Zwraca id (komunikat składa widok z listy słowników).
  function finished(prev, next) {
    return Object.keys(prev || {}).filter(id => prev[id].state !== "błąd" && !(next || {})[id]);
  }

  return { ORIGINS, fold, filterCatalog, bySize, langCounts, deviceState, cellState, jobText, running, finished };
})();

if (typeof module !== "undefined") module.exports = Dicts;
