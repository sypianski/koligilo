// TASK-55: logika zakładki „Słowniki” (web/dicts.js) — filtry katalogu, liczniki języków,
// stan czytnika względem celu, postęp pobierania, wykrywanie zakończonych zadań.
// node tests/dicts_test.js (z katalogu repo).
"use strict";
const D = require("../web/dicts.js");

let fail = 0;
const eq = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { fail++; console.log(`FAIL ${name}\n  got  ${a}\n  want ${b}`); }
};

const cat = [
  { id: "a", name: "Wiktionary Deutsch-English", folder: "x", lang_in: "deu", lang_out: "eng", license: "CC BY-SA", origin: "wikdict" },
  { id: "b", name: "GCIDE", folder: "y", lang_in: "eng", lang_out: "eng", license: "GPLv3+", origin: "koreader" },
  { id: "c", name: "Słownik języka polskiego", folder: "z", lang_in: "pol", lang_out: "pol", license: "Public Domain", origin: "koreader" },
  { id: "d", name: "English-Polish", folder: "w", lang_in: "eng", lang_out: "pol", license: "CC0", origin: "koreader-dicts" },
];
const names = { deu: "niemiecki", eng: "angielski", pol: "polski" };
const ln = c => names[c] || c;
const ids = (f, have) => D.filterCatalog(cat, f, have, ln).map(c => c.id);

eq("bez filtrów", ids({}), ["a", "b", "c", "d"]);
eq("język źródłowy", ids({ inL: "eng" }), ["b", "d"]);
eq("źródłowy + docelowy", ids({ inL: "eng", outL: "pol" }), ["d"]);
eq("pochodzenie", ids({ origin: "koreader" }), ["b", "c"]);
eq("tylko pobrane", ids({ only: true }, new Set(["b", "d"])), ["b", "d"]);
eq("tylko pobrane bez zbioru", ids({ only: true }), []);
eq("tekst: nazwa", ids({ q: "gcide" }), ["b"]);
eq("tekst: bez diakrytyków", ids({ q: "slownik jezyka" }), ["c"]);
eq("tekst: kod języka", ids({ q: "deu" }), ["a"]);
eq("tekst: nazwa języka", ids({ q: "niemiecki" }), ["a"]);
eq("tekst: wiele słów (I)", ids({ q: "english polish" }), ["d"]);
eq("tekst: wielkość liter", ids({ q: "PUBLIC" }), ["c"]);
eq("tekst + filtr", ids({ q: "eng", origin: "koreader" }), ["b"]);
eq("brak trafień", ids({ q: "zzz" }), []);
eq("bez funkcji nazw", D.filterCatalog(cat, { q: "niemiecki" }, null).length, 0);

eq("liczniki źródłowych", D.langCounts(cat, "lang_in"), [["eng", 2], ["deu", 1], ["pol", 1]]);
eq("liczniki docelowych", D.langCounts(cat, "lang_out"), [["eng", 2], ["pol", 2]]);

const active = [{ name: "A", sha256: "1" }, { name: "B", sha256: "2" }, { name: "C", sha256: "3" }];
const at = "2026-10-25T10:00:00Z";
eq("bez zgody", D.deviceState({ dicts_allowed: false }, active).kind, "no-consent");
eq("pusty cel", D.deviceState({ dicts_allowed: true }, []).kind, "empty");
eq("czeka na pierwszą", D.deviceState({ dicts_allowed: true, dict_report_at: "0001-01-01T00:00:00Z" }, active).kind, "waiting");
eq("komplet", D.deviceState({ dicts_allowed: true, dict_report_at: at, dict_inventory: [{ name: "A", sha256: "1" }, { name: "B", sha256: "2" }, { name: "C", sha256: "3" }] }, active),
  { kind: "ok", have: 3, total: 3, missing: [], stale: [], reported: true });
eq("brakuje i nieaktualny", D.deviceState({ dicts_allowed: true, dict_report_at: at, dict_inventory: [{ name: "A", sha256: "1" }, { name: "B", sha256: "OLD" }, { name: "X", sha256: "9" }] }, active),
  { kind: "partial", have: 1, total: 3, missing: ["C"], stale: ["B"], reported: true });
eq("zgoda bez raportu, ale z inwentarzem", D.deviceState({ dicts_allowed: true, dict_inventory: [{ name: "A", sha256: "1" }] }, active).kind, "waiting");

const mb = n => (n / 1048576).toFixed(1) + " MB";
eq("postęp z sumą", D.jobText({ state: "pobieranie", done: 1048576, total: 4194304 }, mb), "pobieranie 1.0 MB z 4.0 MB (25%)");
eq("postęp bez sumy", D.jobText({ state: "pobieranie", done: 2097152, total: 0 }, mb), "pobieranie 2.0 MB");
eq("postęp na starcie", D.jobText({ state: "pobieranie", done: 0, total: 0 }, mb), "pobieranie…");
eq("przetwarzanie", D.jobText({ state: "przetwarzanie" }, mb), "przetwarzanie…");
eq("błąd", D.jobText({ state: "błąd", error: "404" }, mb), "404");
eq("nadmiar nie przekracza 100%", D.jobText({ state: "pobieranie", done: 9, total: 4 }, mb).endsWith("(100%)"), true);

eq("running: trwa", D.running({ a: { state: "pobieranie" } }), true);
eq("running: tylko błąd", D.running({ a: { state: "błąd" } }), false);
eq("running: pusto", D.running({}), false);
eq("finished: zniknęło", D.finished({ a: { state: "pobieranie" }, b: { state: "błąd" }, c: { state: "przetwarzanie" } }, { c: { state: "przetwarzanie" } }), ["a"]);
eq("finished: brak poprzednich", D.finished(undefined, { a: {} }), []);

// macierz słownik × czytnik (TASK-58)
const dA = { name: "A", sha256: "1" };
const dev = (allowed, inv) => ({ dicts_allowed: allowed, dict_inventory: inv });
eq("komórka: jest", D.cellState(dev(true, [{ name: "A", sha256: "1" }]), dA), "ok");
eq("komórka: inna suma", D.cellState(dev(true, [{ name: "A", sha256: "2" }]), dA), "stale");
eq("komórka: brak", D.cellState(dev(true, [{ name: "B", sha256: "1" }]), dA), "missing");
eq("komórka: bez inwentarza", D.cellState(dev(true), dA), "missing");
eq("komórka: bez zgody", D.cellState(dev(false, [{ name: "A", sha256: "1" }]), dA), "no-consent");

console.log(fail ? `${fail} testów nie przeszło` : "dicts: ok");
process.exit(fail ? 1 : 0);
