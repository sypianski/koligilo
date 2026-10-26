// Panel koligilo — vanilla JS, bez zależności. Dwa tryby:
//  • desktop (`koligilo`): /api/local/* istnieje; w trybie komputera (TASK-15)
//    /api/admin/* obsługuje wbudowany serwer, w trybie „Mój serwer” proxy
//    z tokenem doklejanym przez lokalny proces,
//  • serwer (`koligilo serve`): token administratora w localStorage.
"use strict";

const app = document.getElementById("app");

// Widok „Wtyczki” (TASK-33): jedna strona z macierzą, kreator dodawania w arkuszu
// (S.addSheet) i osobny ekran „Ustawienia wtyczek” (S.plugView === PLUGSET, TASK-26).
const PLUGSET = "ustawienia-wtyczek"; // wartość S.plugView dla ekranu z ustawieniami samych wtyczek
const STEPS_KEY = "koligilo.plugSteps"; // „Zrozumiano” przy kartce „Trzy kroki” (zapamiętane w tej przeglądarce)
function stepsGet() { try { return localStorage.getItem(STEPS_KEY) !== "0"; } catch { return true; } }
function stepsSet(on) { try { localStorage.setItem(STEPS_KEY, on ? "1" : "0"); } catch {} }

const S = {
  mode: null,          // "desktop" | "serve"
  local: null,         // /api/local/config: {mode, chosen, server, public_url, moved_to, …}
  state: null,         // /api/admin/state
  tab: "urzadzenia",
  error: null,
  wizardChoice: "local",
  srvMsg: null,        // widok „Aplikacja”: {ok, text}
  addrEdit: false,     // widok „Aplikacja” → Serwer: rozwinięte pole „zmień adres”
  appTab: null,        // zakładka widoku „Aplikacja”: "serwer" | "dane" | "panel" (null = serwer, TASK-35)
  srvBusy: false,
  busy: false,
  usb: null,           // {readers, adb} — tylko tryb desktop
  usbBusy: null,       // id czytnika w trakcie parowania
  usbMsg: null,
  addReader: null,     // dodawanie czytnika (TASK-59): {step: 1|2, hand, open}; null = zamknięte, domyślny krok 1
  devMenu: null,       // id czytnika z otwartym menu „⋯” (TASK-59)
  devEdit: null,       // otwarty pasek pod wierszem czytnika: {id, mode: "rename"|"forget", name, busy, error} (TASK-29)
  rvCode: "",          // wpisywany kod z czytnika
  rvFound: null,       // {name, platform, ...} po sprawdzeniu kodu
  rvMsg: null,
  rvBusy: false,
  acc: null,           // /api/admin/accounts
  dr: {},              // szkice formularzy kont (przeżywają przerysowanie)
  accOpen: null,       // rozwinięty wiersz widoku „Konta”: "kosync" | "wallabag" | "cloud" | "opds" | "targets" | "rosetta" (TASK-31)
  accMsg: {},          // komunikaty per formularz: {ok, text}
  accBusy: null,       // który formularz się zapisuje
  accTesting: null,    // ścieżka trwającego „Sprawdź połączenie” (TASK-31)
  valDrafts: {},       // edytory wartości: id -> {type, text, bool, error, isNew}
  valMsg: {},          // komunikaty per wartość: {ok, text}
  valBusy: null,       // id wartości w trakcie zapisu/wczytywania
  valNew: {},          // szkice nowych wartości (klucz spoza katalogu): groupId -> {key, type, text, bool, error}
  valSec: null,        // wybrana sekcja w spisie widoku „Ustawienia czytników” (id sekcji KO, null = pierwsza, TASK-32)
  valQ: "",           // pole „Szukaj ustawienia” w widoku „Ustawienia czytników” (TASK-32)
  valSel: null,        // zaznaczone ustawienie (id) — otwiera panel podglądu strony (TASK-23, web/preview.js)
  valFull: {},         // pełne literały przyciętych podglądów: id -> {t, lit}
  valAdv: false,       // sekcja „Zaawansowane” rozwinięta?
  valOpen: {},         // rozwinięte kategorie/opisy w widoku ustawień: klucz -> true
  valEx: null,         // rozwinięty wiersz ustawienia (id) — jeden naraz (TASK-32)
  valDev: null,        // czytnik wybrany na pasku „Pokaż dla” (id) albo null = wszystkie (TASK-32)
  grp: { cats: { wyglad: true }, rows: {}, menu: null, snack: null, never: false, busy: false }, // widok „Co synchronizować” (TASK-30): rozwinięte sekcje i wiersze, otwarte menu „⋯”, pasek „Cofnij”
  ctl: {},             // szkice pól liczbowych/tekstowych kontrolek: id(+część) -> tekst
  pad: { view: "btn", layout: "xbox", drafts: {}, fresh: false, msg: null, busy: false, actDraft: null, actMsg: null }, // edytor mapowania gamepada (TASK-25): drafts układ -> {kontrolka: rola}; actDraft (TASK-27) rola -> akcja w czytaniu

  // wtyczki (TASK-10/11); TASK-33: jedna strona + arkusz „Dodaj wtyczkę”,
  // TASK-20: gwiazdki ulubionych.
  plugins: null,       // /api/admin/plugins → lista PluginVersion
  plugView: "main",    // "main" | "ustawienia-wtyczek" (PLUGSET)
  fontView: "lib",     // zakładka wewnętrzna „Czcionek”: "lib" | "cat" | "dev" (TASK-38)
  fontScript: "all",   // filtr pisma w katalogu polecanych
  fontOpen: {},        // rozwinięte rodziny w Bibliotece: nazwa -> true
  fontAddedOpen: false, // rozwinięta lista „Dodane” w katalogu
  dicts: null,         // /api/admin/dicts → słowniki StarDict w magazynie (TASK-55)
  dictJobs: {},        // trwające i nieudane pobrania z katalogu: id katalogu -> {state, error, done, total}
  dictCat: null,       // katalog słowników z KOReadera (GET /api/admin/dict-catalog, ładowany raz)
  dictSheet: false,    // arkusz „Dodaj słownik” (katalog), TASK-58
  dictQ: "", dictIn: [], dictOut: [], dictLangOpen: null, dictLangQ: { in: "", out: "" }, dictLangHi: 0, dictTab: "cat", dictOrigin: "", dictOnly: false, // filtry katalogu (języki: listy kodów)
  dictShown: 50,       // ile wierszy katalogu jest narysowanych („Pokaż więcej”)
  dictPick: new Set(), // zaznaczone w katalogu (id) — „Pobierz zaznaczone”, TASK-58
  dictSel: new Set(),  // zaznaczone w bibliotece (sha256) — „Usuń zaznaczone”, TASK-60
  dictSort: "size",    // kolejność katalogu: "size" (największe) | "name" (A–Z), TASK-60
  dictMsg: null,       // komunikat {ok, text}
  dictBusy: false,     // trwa wgrywanie
  plugSteps: stepsGet(), // kartka „Trzy kroki” widoczna?
  addSheet: null,      // arkusz „Dodaj wtyczkę”: patrz newSheet()
  plugFlash: null,     // Set katalogów świeżo dodanych wtyczek: wiersz macierzy podświetlony przez kilka sekund (TASK-54)
  plugToast: null,     // komunikat po dodaniu wtyczek (na dole strony, znika sam)
  plugSel: null,       // zaznaczona wtyczka w macierzy „Zainstalowane”: {dir, dev|null} (TASK-33)
  plugMsg: null,       // komunikat po zapisie przypisań: {ok, text}
  favBusy: null,       // klucz ulubionej w trakcie zapisu
  favOnly: false,      // filtr „Tylko ulubione” w macierzy „Zainstalowane” (TASK-20 AC2)
  otherQ: "",         // pole „Szukaj wśród” w liście „Wbudowane w KOReadera” (TASK-41)
  otherPart: false,    // filtr „Tylko na części czytników” w tej liście
  otherOpen: false,    // lista „Wbudowane w KOReadera” rozwinięta?
  manualQ: "",         // to samo dla listy „Ręczne na czytnikach” (TASK-43)
  manualPart: false,
  manualOpen: true,    // ręczne są domyślnie widoczne — to one czekają na przejęcie
  gallery: null,       // /api/admin/gallery → {repos, total, page, updated_at, note, stale}
  galQ: "",
  galSort: "stars",
  galPage: 1,
  galBusy: false,
  uploadBusy: false,
  uploadMsg: null,
  devPluginBusy: null,
  approveBusy: null,    // sha wersji z czytnika w trakcie akceptacji (TASK-12 dodatek)

  // aktualizacje wtyczek z galerii (TASK-12)
  galUpdates: null,     // /api/admin/gallery/updates → {updates, updated_at, note}
  galUpdatesBusy: false,
  galUpdateBusy: null,  // repo w trakcie aktualizacji
  galUpdateMsg: {},     // per repo: {ok, text}
};

// ---------------------------------------------------------------- DOM

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// ---------------------------------------------------------------- powłoka aplikacji (TASK-16)
// Ikony: własne ścieżki SVG (stałe napisy, żadnych danych z serwera), bez bibliotek.
// Tylko motyw — zakładki widoków mają wyłącznie napisy (z samych ikon nie było wiadomo, co jest gdzie).

const ICONS = {
  auto: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  dark: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/>',
};
function icon(name) {
  const s = h("span", { class: "ico", "aria-hidden": "true" });
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return s.firstChild;
}

// Widoki: [id, etykieta, licznik?]. Kolejność = skróty Alt+1…9. „Aplikacja”
// (dawne „Ustawienia” w stopce paska) to zwykła zakładka; „Ustawienia czytników”
// to dawne „Wspólne ustawienia” — dwie różne rzeczy, więc dwie różne nazwy.
// TASK-33: „Wtyczki” to jedna strona (macierz + arkusz „Dodaj wtyczkę”, patrz
// pluginsTab()). TASK-26: „Ustawienia
// czytników” to ustawienia urządzenia/KOReadera; ustawienia samych wtyczek (np.
// mapowanie przycisków KOPada) żyją w Wtyczki → „Ustawienia wtyczek”.
const VIEWS = [
  ["urzadzenia", "Urządzenia", st => st.devices.length],
  ["grupy", "Co synchronizować"],
  ["konta", "Konta"],
  ["wspolne", "Ustawienia czytników", st => st.values.filter(v => !v.deleted).length],
  ["wtyczki", "Wtyczki"],
  ["czcionki", "Czcionki", st => (st.fonts || []).length],
  ["slowniki", "Słowniki", () => (S.dicts || []).length],
  ["jak", "Jak to działa"],
  ["ustawienia", "Aplikacja"],
];

// Motyw: "auto" (wg prefers-color-scheme) | "light" (papier) | "dark" (odwrócony e-ink).
// Podpis pod nagłówkiem widoku (TASK-29): jedna linia zamiast karty ze wstępem. Widok bez wpisu go nie ma.
function plPl(n, one, few, many) {
  return n === 1 ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? few : many;
}
const VIEW_SUB = {
  urzadzenia: st => st.devices.length === 0 ? "Nie połączono jeszcze żadnego czytnika"
    : `${st.devices.length} ${plPl(st.devices.length, "czytnik połączony", "czytniki połączone", "czytników połączonych")}`,
  konta: st => accountsSub(st),
  wspolne: () => "Wspólna wersja ustawień. Czytnik bez wpisu zostaje przy własnym.",
};

const THEME_KEY = "koligilo.theme";
function themeGet() { try { return localStorage.getItem(THEME_KEY) || "auto"; } catch { return "auto"; } }
function themeApply(t) {
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
function themeSet(t) {
  try { if (t === "auto") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, t); } catch {}
  themeApply(t); render();
  document.querySelector(`#theme [data-t="${t}"]`)?.focus();
}
const THEME_OPTS = [["auto", "Jak w systemie"], ["light", "Jasny"], ["dark", "Ciemny"]];
// Radiogroup motywu — węzeł budowany na nowo przy każdym renderze widoku Ustawień
// (w odróżnieniu od dawnego renderTheme(), które mutowało stały #theme poza #app).
function themeControl() {
  const cur = themeGet();
  return h("div", { id: "theme", class: "theme", role: "radiogroup", "aria-label": "Motyw" },
    THEME_OPTS.map(([t, label], i) => h("button", {
      type: "button", role: "radio", "aria-checked": String(cur === t), "aria-label": label, title: label,
      "data-t": t, tabindex: cur === t ? "0" : "-1", onclick: () => themeSet(t),
      onkeydown: ev => {
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
        if (d) { ev.preventDefault(); themeSet(THEME_OPTS[(i + d + THEME_OPTS.length) % THEME_OPTS.length][0]); }
      },
    }, icon(t), h("span", {}, label))));
}
themeApply(themeGet());

// Kreator tylko przy pierwszym uruchomieniu — wbudowany serwer działa już wtedy.
function needsWizard() { return S.mode === "desktop" && !(S.local?.chosen && S.local?.configured); }

// Zakładki mają zawsze napis (bez samych ikon). Gdy pasek jest za wąski, przewija się
// poziomo: przy zmianie widoku aktywna zakładka ląduje na środku, a przy zwykłym
// odświeżeniu (co 3 s) zostaje tam, gdzie ją ustawił użytkownik. Przyciemniona krawędź
// (.more-l / .more-r) mówi, że po tamtej stronie są kolejne zakładki.
let navShownTab = null;
function navFit() {
  const nav = document.getElementById("nav");
  nav.classList.toggle("more-l", nav.scrollLeft > 4);
  nav.classList.toggle("more-r", nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 4);
}
document.getElementById("nav").addEventListener("scroll", navFit, { passive: true });
window.addEventListener("resize", navFit);

function renderNav() {
  const ready = !!S.state && !needsWizard() && !(S.mode === "serve" && !adminToken());
  document.getElementById("shell").classList.toggle("bare", !ready);
  const nav = document.getElementById("nav");
  if (!ready) { nav.replaceChildren(); navShownTab = null; navFit(); return; }
  const keep = nav.scrollLeft;
  nav.replaceChildren(h("ul", {}, VIEWS.map(([id, label, count], i) => {
    const n = count ? count(S.state) : 0;
    return h("li", {},
      h("button", {
        type: "button", class: "nav-item", id: "nav-" + id, "data-view": id, "aria-label": label,
        "aria-current": S.tab === id ? "page" : null, "aria-keyshortcuts": "Alt+" + (i + 1),
        title: `${label} (Alt+${i + 1})`, onclick: () => showTab(id),
      },
        h("span", { class: "label" }, label),
        id === "urzadzenia" && S.state.pending.length > 0 && h("span", { class: "pend", title: "Czytnik czeka na połączenie" }),
        n > 0 && h("span", { class: "count" }, n)));
  })));
  nav.scrollLeft = keep;
  if (navShownTab !== S.tab) {
    const cur = nav.querySelector('[aria-current="page"]');
    if (cur) nav.scrollLeft = cur.offsetLeft - (nav.clientWidth - cur.offsetWidth) / 2;
    navShownTab = S.tab;
  }
  navFit();
}

function renderSync() {
  const el = document.getElementById("sync");
  const last = (S.state?.devices || []).filter(d => d.last_sync).sort((a, b) => new Date(b.last_sync.at) - new Date(a.last_sync.at))[0];
  el.textContent = !S.state ? "" : last ? `Ostatnia synchronizacja: ${ago(last.last_sync.at)} (${last.name || last.model})` : "Jeszcze bez synchronizacji";
}

function explain(...paras) {
  return h("div", { class: "explain" }, paras.map(p => h("p", {}, p)));
}

// Wstęp, który po przeczytaniu tylko zabiera miejsce nad treścią: <details> z jednozdaniowym
// nagłówkiem (zawiera sedno, więc zwinięty dalej coś mówi). Domyślnie rozwinięty, dopóki
// użytkownik go nie zwinie; wybór zapamiętany w tej przeglądarce (localStorage), a gdy
// storage nie działa — w pamięci strony, żeby odświeżenie co 3 s nie rozwijało go z powrotem.
const FOLD_KEY = "koligilo.fold.";
const foldMem = {};
function foldOpen(key) {
  if (key in foldMem) return foldMem[key];
  try { return localStorage.getItem(FOLD_KEY + key) !== "0"; } catch { return true; }
}
function explainFold(key, title, ...paras) {
  return h("details", {
    class: "explain fold", open: foldOpen(key),
    ontoggle: ev => {
      const now = ev.target.open;
      if (now === foldOpen(key)) return;
      foldMem[key] = now;
      try { localStorage.setItem(FOLD_KEY + key, now ? "1" : "0"); } catch {}
    },
  }, h("summary", {}, title), paras.map(p => h("p", {}, p)));
}

function ago(iso) {
  if (!iso || iso.startsWith("0001")) return "nigdy";
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return "przed chwilą";
  if (s < 3600) return `${Math.round(s / 60)} min temu`;
  if (s < 86400) return `${Math.round(s / 3600)} godz. temu`;
  return new Date(iso).toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" });
}

// ---------------------------------------------------------------- API

function adminToken() {
  try { return localStorage.getItem("koligilo.admin") || ""; } catch { return ""; }
}

// Nagłówek, który guard() (desktop.go) wymaga na każde żądanie /api/* w trybie
// desktopowym: proste żądania cross-site (formularz, <img>, <script src>) nie
// mogą go ustawić bez preflightu CORS, a panel nigdy nie odpowiada
// Access-Control-Allow-*, więc obca strona nie dostanie na to zgody. W trybie
// serwera (koligilo serve) nagłówek jest niegroźny — serwer go ignoruje.
const HDR = "X-Koligilo";

async function api(method, path, body) {
  const headers = { "Content-Type": "application/json", [HDR]: "1" };
  if (S.mode === "serve") headers.Authorization = "Bearer " + adminToken();
  const r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await r.json(); } catch { /* pusta odpowiedź */ }
  if (!r.ok) {
    const e = new Error((data && data.error) || `HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return data;
}

// apiRaw: jak api(), ale nie rzuca na błąd HTTP — potrzebne tam, gdzie ciało
// błędu niesie dodatkowe pola (np. "candidates" przy instalacji z galerii).
async function apiRaw(method, path, body) {
  const headers = { "Content-Type": "application/json", [HDR]: "1" };
  if (S.mode === "serve") headers.Authorization = "Bearer " + adminToken();
  const r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await r.json(); } catch { /* pusta odpowiedź */ }
  return { ok: r.ok, status: r.status, data };
}

// apiUpload: multipart/form-data (ZIP wtyczki) — api() wymusza JSON, więc to
// osobna funkcja. Bez nagłówka Content-Type: przeglądarka sama dokleja boundary.
async function apiUpload(path, formData) {
  const headers = { [HDR]: "1" };
  if (S.mode === "serve") headers.Authorization = "Bearer " + adminToken();
  const r = await fetch(path, { method: "POST", headers, body: formData });
  let data = null;
  try { data = await r.json(); } catch { /* pusta odpowiedź */ }
  if (!r.ok) {
    const e = new Error((data && data.error) || `HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return data;
}

async function detectMode() {
  const r = await fetch("/api/local/config", { headers: { [HDR]: "1" } });
  if (r.ok) { S.mode = "desktop"; S.local = await r.json(); }
  else S.mode = "serve";
}

async function loadLocal() {
  try { S.local = await (await fetch("/api/local/config", { headers: { [HDR]: "1" } })).json(); } catch { /* zostaje poprzedni */ }
}

async function refresh() {
  if (S.mode === "desktop") await loadLocal();
  if (needsWizard()) return render();
  if (S.mode === "serve" && !adminToken()) return render();
  try {
    S.state = await api("GET", "/api/admin/state");
    S.error = null;
    const plugSet = S.tab === "wtyczki" && S.plugView === PLUGSET; // Wtyczki → Ustawienia wtyczek (TASK-26)
    if (S.tab === "wspolne") await valLoadFull();
    if (plugSet) await padLoadFull(); // pełny padmap (565 znaków) przekracza podgląd 400 znaków
    await dictsLoad(); // lekka lista + zadania; licznik w nawigacji i zakładka „Słowniki”
    if (S.tab === "slowniki") await dictCatLoad();
    if (S.tab === "czcionki") {
      try { S.fontCat = (await api("GET", "/api/admin/font-catalog")).families; } catch (e) { S.fontCat = S.fontCat || null; S.error = e.message; }
    }
    if (S.tab === "konta" || S.tab === "grupy" || plugSet) { // „Ustawienia wtyczek” podpowiadają brak klucza Rosetty (TASK-42), „Co synchronizować” brak konta (TASK-51)
      try { S.acc = await api("GET", "/api/admin/accounts"); } catch (e) { S.acc = null; S.error = e.message; }
    }
    // lista wtyczek, aktualizacje i galeria są potrzebne tylko w pozostałych zakładkach —
    // „Ustawienia wtyczek” odświeżają się w tle co 3 s i nie ma sensu pobierać ich za każdym razem
    if (S.tab === "wtyczki" && !plugSet) {
      try { S.plugins = (await api("GET", "/api/admin/plugins")).plugins; } catch (e) { S.plugins = null; S.error = e.message; }
    }
    if (S.tab === "wtyczki" && !plugSet && !S.galUpdates) {
      try { S.galUpdates = await api("GET", "/api/admin/gallery/updates"); } catch (e) { S.galUpdates = null; S.error = e.message; }
    }
    if (S.tab === "wtyczki" && !plugSet && S.addSheet && S.addSheet.src === "galeria") {
      const qs = new URLSearchParams({ q: S.galQ, sort: S.galSort, page: String(S.galPage) });
      try { S.gallery = await api("GET", "/api/admin/gallery?" + qs); } catch (e) { S.gallery = null; S.error = e.message; }
    }
    if (usbWanted()) {
      try { S.usb = await (await fetch("/api/local/usb", { headers: { [HDR]: "1" } })).json(); } catch { S.usb = null; }
    }
  } catch (e) {
    if (e.status === 401 && S.mode === "serve") {
      try { localStorage.removeItem("koligilo.admin"); } catch {}
      S.error = "Token administratora nie pasuje — wklej go ponownie.";
    } else {
      S.error = e.message;
    }
  }
  render();
}

// ---------------------------------------------------------------- render

function render() {
  const focused = document.activeElement && document.activeElement.id;
  const scroll = app.scrollTop;
  const sheetBody = app.querySelector(".sheet-body"), sheetScroll = sheetBody ? sheetBody.scrollTop : 0;
  const langList = app.querySelector(".langlist"), langScroll = langList ? langList.scrollTop : 0;
  app.replaceChildren();
  renderConn();
  renderNav();
  renderSync();
  if (needsWizard()) app.append(wizard());
  else if (S.mode === "serve" && !adminToken()) app.append(login());
  else if (!S.state) app.append(S.error ? errorCard(S.error) : h("p", { class: "loading" }, "Łączę z serwerem…"));
  else app.append(main());
  document.getElementById("ver").textContent = "koligilo " + (S.state ? S.state.version : "");
  app.scrollTop = scroll;
  const sheetBodyNew = app.querySelector(".sheet-body");
  if (sheetBodyNew) sheetBodyNew.scrollTop = sheetScroll;
  const langListNew = app.querySelector(".langlist");
  if (langListNew) langListNew.scrollTop = langScroll;
  if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
  // panel podglądu żyje poza #app (ramki nie przeładowują się co 3 s)
  // TASK-32: w „Ustawieniach czytników” podgląd stoi od początku (na wybranym ustawieniu albo „Rozmiar czcionki”),
  // ale tylko na szerokim oknie (poniżej 1100 px nie ma miejsca i jest ukryty, nie nakładany na listę).
  if (typeof Preview !== "undefined") {
    if (S.tab === "wspolne" && S.state && !needsWizard() && PV_WIDE.matches) {
      if (Preview.isOpen()) Preview.update(pvSettings(), S.state.devices); else pvOpenDefault();
    } else Preview.close();
  }
}

function renderConn() {
  const c = document.getElementById("conn");
  if (S.mode === "desktop" ? needsWizard() : !adminToken()) { c.hidden = true; return; }
  c.hidden = false;
  const local = S.mode === "desktop" && S.local.mode === "local";
  const bad = !!S.error || (local && !S.local.device_up);
  c.className = "conn" + (bad ? " bad" : "");
  const text = local
    ? (S.local.device_up ? ["Ten komputer jest serwerem · czytniki: ", S.local.public_url || "brak adresu w sieci"]
      : ["Serwer na tym komputerze nie działa"])
    : S.mode === "desktop"
      ? [S.error ? "Własny serwer nie odpowiada: " : "Własny serwer: ", S.local.server]
      : [S.error ? "Brak połączenia z " : "Połączono z ", location.origin];
  const dot = h("span", { class: "dot" }), label = h("span", {}, ...text);
  // tryb desktop: cały wskaźnik prowadzi do Ustawień → Serwer (dawny osobny przycisk
  // „Zmień” zniknął, TASK-18); w trybie serve nie ma czego zmieniać — zostaje tekst.
  if (S.mode === "desktop") {
    c.replaceChildren(h("button", { type: "button", onclick: () => { S.appTab = "serwer"; showTab("ustawienia"); }, title: "Aplikacja → Serwer" }, dot, label));
  } else {
    c.replaceChildren(dot, label);
  }
}

function errorCard(msg) {
  return h("div", { class: "card" },
    h("h2", {}, "Nie mogę pobrać danych"),
    h("p", { class: "err" }, msg),
    h("p", { class: "muted" }, "Sprawdzam ponownie co kilka sekund. Jeśli serwer stoi na VPS-ie, upewnij się, że działa (np. ", h("code", {}, "systemctl status koligilo"), ")."));
}

// ------------------------------------------------ kreator (tryb desktop)

const TRANSPORTS = [
  {
    id: "local", name: "Ten komputer", badge: "Polecane",
    for: "Nic nie trzeba stawiać ani wpisywać — ten komputer sam jest serwerem.",
    plus: ["Działa od razu: czytnik w tej samej sieci Wi-Fi znajdzie go sam",
      "Twoje dane zostają na tym komputerze",
      "Później możesz przenieść wszystko na własny serwer bez ponownego łączenia czytników"],
    minus: ["Czytniki synchronizują się tylko wtedy, gdy ten komputer jest włączony i widoczny (ta sama sieć albo Tailscale) — do tego czasu zmiany czekają na czytniku"],
  },
  {
    id: "server", name: "Mój serwer",
    for: "Masz VPS albo inny komputer, który stoi stale włączony.",
    plus: ["Zmiany dochodzą z każdego miejsca, niezależnie od tego komputera",
      "Twoje dane nie trafiają do żadnej firmy"],
    minus: ["Serwer trzeba raz postawić i utrzymywać (jedna binarka: koligilo serve)"],
  },
  {
    id: "dropbox", name: "Dropbox", soon: true,
    for: "Nie masz serwera, masz (albo założysz) darmowe konto Dropbox.",
    plus: ["Nic nie trzeba stawiać — logujesz się raz w przeglądarce",
      "Działa z każdego miejsca, nie tylko w domowej sieci"],
    minus: ["Pliki leżą u zewnętrznej firmy (hasła szyfrujemy przed wysłaniem)",
      "Wolniejsze: czytniki sprawdzają zmiany co jakiś czas"],
  },
  {
    id: "webdav", name: "WebDAV (np. Koofr)", soon: true,
    for: "Nie masz serwera i wolisz otwarty standard — np. darmowe 10 GB w Koofr.",
    plus: ["Otwarty standard, wielu dostawców (Koofr, Nextcloud…)",
      "Ten sam serwer mogą używać statystyki czytania KOReadera"],
    minus: ["Adres i hasło trzeba raz wpisać w panelu",
      "Szybkość zależy od dostawcy"],
  },
];

function wizard() {
  const choice = TRANSPORTS.find(t => t.id === S.wizardChoice);
  return h("section", { class: "wizard" },
    h("h2", {}, "Gdzie mają spotykać się Twoje czytniki?"),
    explain(
      "koligilo potrzebuje miejsca, przez które urządzenia wymieniają ustawienia. Czytniki rzadko są włączone jednocześnie, więc nie mogą rozmawiać bezpośrednio — zostawiają zmiany w tym miejscu, a pozostałe odbierają je, gdy tylko połączą się z Wi-Fi.",
      "Wybór możesz później zmienić. Ustawienia na czytnikach nie zależą od niego."),
    h("div", { class: "options", role: "radiogroup" },
      TRANSPORTS.map(t => h("button", {
        class: "option" + (S.wizardChoice === t.id ? " selected" : ""),
        role: "radio", "aria-checked": String(S.wizardChoice === t.id),
        disabled: t.soon, onclick: () => { S.wizardChoice = t.id; render(); },
      },
        h("h3", {}, t.name, t.badge && h("span", { class: "badge" }, t.badge), t.soon && h("span", { class: "badge soon" }, "wkrótce")),
        h("p", { class: "for" }, t.for),
        h("ul", {}, t.plus.map(p => h("li", { class: "plus" }, p)), t.minus.map(m => h("li", { class: "minus" }, m))),
      ))),
    choice.id === "local" && h("div", { class: "row" },
      h("button", { class: "primary", disabled: S.busy, onclick: () => setMode("local") }, "Zacznij na tym komputerze")),
    choice.id === "server" && serverForm(),
    S.error && choice.id === "local" && h("p", { class: "err" }, S.error),
  );
}

function serverForm() {
  return h("form", { class: "card", onsubmit: saveServer },
    h("h3", { style: "margin-top:0" }, "Połącz z serwerem"),
    h("label", { class: "field" },
      h("span", {}, "Adres serwera"),
      h("input", { type: "text", id: "f-server", name: "server", placeholder: "koligilo.twojadomena.pl", autocomplete: "url", required: true }),
      h("small", {}, "Ten sam adres, pod którym czytniki będą widziały serwer. Przy parowaniu panel sam poda go czytnikom w tej sieci Wi-Fi.")),
    h("label", { class: "field" },
      h("span", {}, "Token administratora"),
      h("input", { type: "password", id: "f-token", name: "token", placeholder: "kol-…", autocomplete: "off", required: true }),
      h("small", {}, "Serwer wypisuje go jeden raz, przy pierwszym uruchomieniu ", h("code", {}, "koligilo serve"), ". Zostaje tylko na tym komputerze.")),
    h("div", { class: "row" }, h("button", { class: "primary", type: "submit", disabled: S.busy }, S.busy ? "Sprawdzam…" : "Sprawdź i połącz")),
    S.error && h("p", { class: "err" }, S.error));
}

async function saveServer(ev) {
  ev.preventDefault();
  const f = ev.target;
  S.busy = true; S.error = null; render();
  try {
    await api("POST", "/api/local/config", { server: f.server.value, admin_token: f.token.value });
    await loadLocal();
    S.state = null;
  } catch (e) {
    S.error = e.message;
  }
  S.busy = false;
  await refresh();
  if (S.error) {
    // zachowaj wpisane wartości po błędzie
    const s = document.getElementById("f-server"); if (s) s.value = f.server.value;
  }
}

async function setMode(mode) {
  S.busy = true; S.error = null; render();
  try { S.local = await api("POST", "/api/local/mode", { mode }); S.state = null; }
  catch (e) { S.error = e.message; }
  S.busy = false;
  await refresh();
}

// ------------------------------------------------ widok „Ustawienia” (TASK-18)
// Wygląd (motyw) + Serwer (dawny osobny widok „Serwer”, TASK-15) + O aplikacji —
// jeden wpis w stopce paska bocznego zamiast luźnego przełącznika motywu i przycisku trybu.

// TASK-35: trzy zakładki wewnętrzne (jak „Dodaj czytnik”): Serwer (tryb i adres), Dane (przenosiny
// i kopia — rzadkie akcje), Panel (motyw). W trybie serwera (VPS) nie ma „Dane”.
function appTabList() {
  return S.mode === "desktop" ? [["serwer", "Serwer"], ["dane", "Dane"], ["panel", "Panel"]]
    : [["serwer", "Serwer"], ["panel", "Panel"]];
}

function showAppTab(id) { S.appTab = id; render(); document.getElementById("apptab-" + id)?.focus(); }

function appTablist(list, cur) {
  return h("div", { class: "tabs", role: "tablist", "aria-label": "Aplikacja" },
    list.map(([id, label], i) => h("button", {
      type: "button", role: "tab", id: "apptab-" + id, "aria-selected": String(cur === id),
      "aria-controls": "apppanel", tabindex: cur === id ? "0" : "-1", class: "tab" + (cur === id ? " selected" : ""),
      onclick: () => showAppTab(id),
      onkeydown: ev => {
        const d = { ArrowRight: 1, ArrowLeft: -1 }[ev.key], home = ev.key === "Home", end = ev.key === "End";
        if (d == null && !home && !end) return;
        ev.preventDefault();
        showAppTab(list[home ? 0 : end ? list.length - 1 : (i + d + list.length) % list.length][0]);
      },
    }, label)));
}

function ustawieniaTab() {
  const list = appTabList(), cur = list.some(([id]) => id === S.appTab) ? S.appTab : "serwer";
  const body = { serwer: serverPane, dane: dataPane, panel: panelPane }[cur];
  return h("div", {},
    // komunikat po akcji (przenosiny, zmiana trybu) jest nad zakładkami, żeby nie zginął po zmianie zakładki
    S.srvMsg && h("p", { class: S.srvMsg.ok ? "ok" : "err", role: "status" }, S.srvMsg.text),
    appTablist(list, cur),
    h("div", { id: "apppanel", role: "tabpanel", tabindex: "-1", "aria-labelledby": "apptab-" + cur },
      h("section", { class: "card" }, h("h3", { style: "margin-top:0" }, list.find(([id]) => id === cur)[1]), body())));
}

function panelPane() {
  return h("div", {},
    h("p", { class: "muted small", style: "margin-top:0" }, "Motyw panelu — zapamiętywany w tej przeglądarce."),
    themeControl());
}

// Tryb serwera (VPS, koligilo serve): panel zarządza serwerem, na którym sam działa —
// nie ma tu „zmiany serwera” jak w trybie komputera (S.local), sekcja jest okrojona.
function serverPane() { return S.mode === "desktop" ? serverTab() : serverTabServe(); }

function serverTabServe() {
  return h("div", {},
    h("div", { class: "statline" },
      h("span", { class: "dot" }),
      h("span", { class: "grow" }, h("b", {}, "Połączono z " + location.origin),
        h("span", { class: "muted" }, " · token administratora jest zapamiętany tylko w tej przeglądarce")),
      h("button", { type: "button", onclick: forgetToken }, "Zapomnij token")),
    h("section", { class: "sub" },
      h("h4", {}, "Kopia danych serwera"),
      h("p", { class: "muted small" }, "Urządzenia, ustawienia czytników, wtyczki i galeria w jednym pliku .tar.gz. Wczytasz ją na innym serwerze poleceniem ", h("code", {}, "koligilo import --data KATALOG plik.tar.gz"), "."),
      h("button", { onclick: downloadServerExport }, "Pobierz kopię serwera")));
}

// „Zapomnij token” (TASK-35): usuwa token z tej przeglądarki i wraca do ekranu logowania. Serwer niczego nie zmienia.
// Token pokazuje się tylko przy pierwszym uruchomieniu serwera, więc ostrzegamy, że nie da się go odzyskać z panelu.
function forgetToken() {
  if (!confirm("Zapomnieć token administratora w tej przeglądarce? Żeby wrócić do panelu, trzeba będzie wkleić go ponownie — serwer pokazał go tylko przy pierwszym uruchomieniu, a ten panel nie potrafi go odtworzyć.")) return;
  try { localStorage.removeItem("koligilo.admin"); } catch {}
  S.state = null; S.error = null; S.srvMsg = null;
  refresh();
}

function shortcutsList() {
  return h("dl", { class: "shortcuts" },
    h("dt", {}, h("kbd", {}, "Alt"), "+", h("kbd", {}, "1"), "…", h("kbd", {}, "7")), h("dd", {}, "przełącz zakładkę"),
    h("dt", {}, h("kbd", {}, "/")), h("dd", {}, "szukaj w galerii wtyczek (otwiera „Dodaj wtyczkę”)"),
    h("dt", {}, h("kbd", {}, "←"), " ", h("kbd", {}, "→"), " ", h("kbd", {}, "Home"), " ", h("kbd", {}, "End")), h("dd", {}, "po zakładkach, gdy jest na nich fokus"),
    h("dt", {}, h("kbd", {}, "?")), h("dd", {}, "ta lista skrótów"));
}

// Okno ze skrótami (TASK-35): przycisk „? skróty” w stopce i klawisz „?”. Natywny <dialog> — fokus zostaje w oknie,
// Esc zamyka, po zamknięciu fokus wraca tam, skąd go otwarto.
function openKeys() {
  const d = document.getElementById("keys-dialog");
  if (d.open) return;
  d.replaceChildren(
    h("div", { class: "sheet-head" },
      h("h2", { id: "keys-title" }, "Skróty klawiszowe"),
      h("button", { type: "button", "aria-label": "Zamknij", onclick: () => d.close() }, "×")),
    h("div", { class: "keys-body" }, shortcutsList()));
  d.showModal();
}
document.getElementById("keys-btn").addEventListener("click", openKeys);
document.getElementById("keys-dialog").addEventListener("click", ev => { if (ev.target === ev.currentTarget) ev.currentTarget.close(); }); // klik w tło

// ------------------------------------------------ sekcja „Serwer” (tryb desktop, TASK-15)

function serverTab() {
  const L = S.local, local = L.mode === "local";
  return h("div", {},
    explain(local
      ? "Ten komputer jest serwerem koligilo. Czytniki synchronizują się tylko wtedy, gdy jest włączony i widoczny — w tej samej sieci Wi-Fi albo przez Tailscale. Do tego czasu zmiany czekają na czytniku i dojdą przy następnym połączeniu."
      : "Panel pokazuje Twój własny serwer. Dane tego komputera leżą nietknięte — możesz w każdej chwili wrócić do trybu „Ten komputer”."),
    L.moved_to && h("section", { class: "card", style: "margin-bottom:var(--card-gap)" },
      h("h3", { style: "margin-top:0" }, "Dane tego komputera przeniesiono"),
      h("p", {}, "Czytniki, które zgłoszą się tutaj, dostają nowy adres: ", h("code", {}, L.moved_to), " — i same się przepinają, bez ponownego łączenia."),
      local && h("button", { disabled: S.srvBusy, onclick: stopRedirect }, "Przestań przekierowywać")),
    h("div", { class: "options", role: "radiogroup", "aria-label": "Gdzie działa serwer" },
      [["local", "Ten komputer", "Serwer działa tutaj; nic nie trzeba stawiać."],
       ["remote", "Mój serwer", L.server ? "Panel rozmawia z " + L.server + "." : "VPS albo inny stale włączony komputer."]]
        .map(([id, name, desc]) => h("button", {
          class: "option" + (L.mode === id ? " selected" : ""), role: "radio", "aria-checked": String(L.mode === id),
          disabled: S.srvBusy, onclick: () => switchMode(id),
        }, h("h3", {}, name), h("p", { class: "for" }, desc)))),
    local && addressLine());
}

// Zakładka „Dane” (tryb komputera): rzadkie akcje — przenosiny i kopia. Bloki to `.sub`, nie karty w karcie.
function dataPane() {
  const L = S.local;
  return h("div", {},
    L.mode === "local" ? moveOutForm() : remoteCards(),
    h("section", { class: "sub" },
      h("h4", {}, "Kopia danych tego komputera"),
      h("p", { class: "muted small", style: "margin-top:0" }, "Urządzenia, ustawienia czytników, wtyczki i galeria w jednym pliku .tar.gz (", h("code", {}, L.data_dir), "). Na serwerze wczytasz ją poleceniem ", h("code", {}, "koligilo import --data KATALOG plik.tar.gz"), "."),
      h("button", { onclick: downloadExport }, "Pobierz kopię")));
}

// Adres dla czytników (TASK-35): jedna linia pod wyborem trybu; pole zapisu i „Wykrywaj sam” rozwijają się po „zmień adres”.
function addressLine() {
  const L = S.local, edit = !!S.addrEdit;
  if (L.device_error) return h("p", { class: "err", style: "margin:0" }, L.device_error);
  return h("div", { class: "addrline" },
    h("p", { style: "margin:0" }, "Czytniki łączą się z ", h("code", {}, L.public_url || "(nie znam adresu tego komputera w sieci)"),
      L.public_override ? " (wpisany ręcznie) · " : " · ",
      h("button", {
        type: "button", class: "linkbtn", "aria-expanded": String(edit), "aria-controls": "addr-form",
        onclick: () => { S.addrEdit = !edit; render(); if (S.addrEdit) document.getElementById("f-puburl")?.focus(); },
      }, "zmień adres")),
    edit && h("form", { id: "addr-form", class: "sub", onsubmit: savePublicURL },
      !L.public_override && h("p", { class: "muted small" }, "Adres wykryty automatycznie; Tailscale ma pierwszeństwo, a czytnik w tej samej sieci Wi-Fi dostaje adres z tej sieci."),
      h("div", { class: "row" },
        h("input", { type: "text", name: "url", id: "f-puburl", "aria-label": "Adres dla czytników", placeholder: "http://192.168.1.10:" + (L.device_port || 7210), style: "max-width:320px" }),
        h("button", { type: "submit", disabled: S.srvBusy }, "Zapisz adres"),
        L.public_override && h("button", { type: "button", disabled: S.srvBusy, onclick: () => savePublicURL(null, "") }, "Wykrywaj sam"))));
}

function moveOutForm() {
  const L = S.local;
  return h("form", { class: "sub", onsubmit: moveOut },
    h("h4", {}, "Przenieś na mój serwer"),
    h("p", { class: "muted small", style: "margin-top:0" }, "Urządzenia, ustawienia czytników i wtyczki trafią na serwer. Czytniki przy następnej synchronizacji same dostaną nowy adres — nie trzeba ich łączyć od nowa. Ten komputer zostanie panelem serwera."),
    h("label", { class: "field" }, h("span", {}, "Adres serwera"),
      h("input", { type: "text", id: "f-mvserver", name: "server", placeholder: "koligilo.twojadomena.pl", required: true, value: L.server || "" })),
    h("label", { class: "field" }, h("span", {}, "Token administratora"),
      h("input", { type: "password", id: "f-mvtoken", name: "token", placeholder: "kol-…", autocomplete: "off", required: true })),
    h("button", { class: "primary", type: "submit", disabled: S.srvBusy }, S.srvBusy ? "Przenoszę…" : "Przenieś dane"));
}

function remoteCards() {
  return [
    h("section", { class: "sub" },
      h("h4", {}, "Przenieś dane na ten komputer"),
      h("p", { class: "muted small", style: "margin-top:0" }, "Urządzenia, ustawienia i wtyczki z serwera trafią tutaj, a serwer zacznie kierować czytniki pod adres tego komputera. Potem czytniki synchronizują się tylko, gdy ten komputer jest włączony i widoczny."),
      h("button", { class: "primary", disabled: S.srvBusy, onclick: moveHere }, S.srvBusy ? "Przenoszę…" : "Przenieś na ten komputer")),
    h("form", { class: "sub", onsubmit: saveServer },
      h("h4", {}, "Inny serwer"),
      h("label", { class: "field" }, h("span", {}, "Adres serwera"),
        h("input", { type: "text", id: "f-server", name: "server", required: true, value: S.local.server || "" })),
      h("label", { class: "field" }, h("span", {}, "Token administratora"),
        h("input", { type: "password", id: "f-token", name: "token", placeholder: "kol-…", autocomplete: "off", required: true })),
      h("button", { type: "submit", disabled: S.busy }, "Sprawdź i połącz")),
  ];
}

async function srvDo(fn) {
  S.srvBusy = true; S.srvMsg = null; render();
  try { S.srvMsg = await fn(); } catch (e) { S.srvMsg = { ok: false, text: e.message }; }
  S.srvBusy = false;
  S.state = null;
  await refresh();
}

function switchMode(mode) {
  if (mode === S.local.mode) return;
  if (mode === "remote" && !S.local.server) {
    S.appTab = "dane";
    S.srvMsg = { ok: false, text: "Podaj adres i token swojego serwera w zakładce „Dane” (formularz „Przenieś na mój serwer”) albo wybierz go w kreatorze." };
    return render();
  }
  const q = mode === "local"
    ? "Przełączyć na „Ten komputer”? Panel pokaże dane tego komputera, a czytniki połączone z serwerem dalej będą synchronizować się z serwerem. Żeby przenieść je tutaj, użyj „Przenieś dane na ten komputer”."
    : "Przełączyć panel na Twój serwer? Czytniki połączone z tym komputerem nie będą się synchronizować, dopóki nie wrócisz do tego trybu albo nie przeniesiesz danych („Przenieś na mój serwer”). Dane tego komputera zostaną nietknięte.";
  if (!confirm(q)) return;
  srvDo(async () => { await api("POST", "/api/local/mode", { mode }); return { ok: true, text: "Przełączono." }; });
}

function savePublicURL(ev, value) {
  if (ev) ev.preventDefault();
  const url = value ?? ev.target.url.value;
  S.addrEdit = false;
  srvDo(async () => { await api("POST", "/api/local/public-url", { url }); return { ok: true, text: "Zapisano adres dla czytników." }; });
}

// Przenosiny: needs_replace = na celu są już dane; pytamy i ponawiamy z replace.
async function moveCall(path, body) {
  const r = await apiRaw("POST", path, body);
  if (r.ok) return r.data;
  if (r.data && r.data.needs_replace && !body.replace
    && confirm((r.data.error || "") + "\n\nZastąpić je? Kopia starego stanu zostanie w katalogu danych (.pre-import-…).")) {
    return moveCall(path, { ...body, replace: true });
  }
  throw new Error((r.data && r.data.error) || `HTTP ${r.status}`);
}

function importedText(out) {
  const i = out.imported || {};
  return `Przeniesiono: ${i.devices} urządzeń, ${i.values} wartości, ${i.plugins} wtyczek. Czytniki przy następnej synchronizacji same przejdą na nowy adres.`;
}

function moveOut(ev) {
  ev.preventDefault();
  const f = ev.target;
  const body = { server: f.server.value, admin_token: f.token.value };
  srvDo(async () => ({ ok: true, text: importedText(await moveCall("/api/local/move", body)) }));
}

function moveHere() {
  if (!confirm("Przenieść dane z serwera na ten komputer? Serwer zacznie kierować czytniki pod adres tego komputera (" + (S.local.public_url || "?") + ").")) return;
  srvDo(async () => ({ ok: true, text: importedText(await moveCall("/api/local/move-here", {})) }));
}

function stopRedirect() {
  if (!confirm("Przestać kierować czytniki na " + S.local.moved_to + "? Czytniki, które się tu zgłoszą, znowu będą synchronizować się z tym komputerem.")) return;
  srvDo(async () => { await api("POST", "/api/admin/moved", { moved_to: "" }); return { ok: true, text: "Przekierowanie wyłączone." }; });
}

async function downloadArchive(path, name, headers) {
  try {
    const r = await fetch(path, { headers: { [HDR]: "1", ...headers } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const a = h("a", { href: URL.createObjectURL(await r.blob()), download: `${name}-${new Date().toISOString().slice(0, 10)}.tar.gz` });
    document.body.append(a); a.click(); a.remove();
  } catch (e) { S.srvMsg = { ok: false, text: "Nie udało się pobrać kopii: " + e.message }; render(); }
}

function downloadExport() { return downloadArchive("/api/local/export", "koligilo-komputer"); }

// tryb serwera: ten sam plik co `GET /api/admin/export`, z tokenem w nagłówku (zwykły link nie mógłby go wysłać)
function downloadServerExport() { return downloadArchive("/api/admin/export", "koligilo-serwer", { Authorization: "Bearer " + adminToken() }); }

// ------------------------------------------------ logowanie (tryb serwer)

function login() {
  return h("form", { class: "card", onsubmit: ev => {
    ev.preventDefault();
    try { localStorage.setItem("koligilo.admin", ev.target.token.value.trim()); } catch {}
    refresh();
  } },
    h("h2", { style: "margin-top:0" }, "Panel serwera koligilo"),
    explain("Ten panel działa na serwerze. Żeby nim zarządzać, wklej token administratora — serwer wypisał go przy pierwszym uruchomieniu. Token zostanie zapamiętany w tej przeglądarce."),
    h("label", { class: "field" }, h("span", {}, "Token administratora"),
      h("input", { type: "password", name: "token", id: "f-login", placeholder: "kol-…", required: true })),
    h("button", { class: "primary", type: "submit" }, "Wejdź"),
    S.error && h("p", { class: "err" }, S.error));
}

// ------------------------------------------------ widok główny

function main() {
  const st = S.state;
  // nawigację rysuje renderNav() w pasku zakładek; tu tylko nagłówek widoku
  const view = VIEWS.find(v => v[0] === S.tab) || VIEWS[0];
  return h("div", { class: "view", role: "region", "aria-labelledby": "view-title" },
    h("header", { class: "view-head", "data-drag": true }, h("h1", { id: "view-title" }, view[1]),
      HOW_HELP[S.tab] && helpMark(HOW_HELP[S.tab]),
      VIEW_SUB[S.tab] && h("span", { class: "sub" }, VIEW_SUB[S.tab](st)),
      S.tab === "urzadzenia" && st.devices.length > 0 && h("button", { type: "button", class: "primary view-act", id: "b-add-reader", onclick: openAddReader }, "＋ Dodaj czytnik")),
    pendingInAdd() ? null : st.pending.map(pairBanner),
    S.error && h("p", { class: "err" }, S.error),
    { urzadzenia: devicesTab, grupy: groupsTab, konta: accountsTab, wspolne: valuesTab,
      wtyczki: pluginsTab, czcionki: fontsTab, slowniki: dictsTab, jak: howTab, ustawienia: ustawieniaTab }[S.tab]());
}

function pairBanner(p) {
  // TASK-29: zwarty baner — kod, nazwa i przyciski w jednej linii, zdanie ostrzegawcze zostaje
  // (zatwierdzenie jest zawsze ręczne i wymaga porównania kodu z ekranem czytnika)
  return h("section", { class: "card pair", "aria-live": "polite" },
    h("div", { class: "code", "aria-label": "Kod parowania " + p.code.split("").join(" ") }, p.code),
    h("div", { class: "what" },
      h("h3", {}, `„${p.name || p.model}” chce dołączyć`,
        h("span", { class: "muted small" }, " ", [p.platform, p.ko_version && "KOReader " + p.ko_version].filter(Boolean).join(" · "))),
      h("p", { class: "muted small" }, "Porównaj kod z tym na ekranie czytnika. Jeśli jest inny albo nikt teraz niczego nie łączy — odrzuć.")),
    h("div", { class: "row pair-acts" },
      h("button", { class: "primary", onclick: () => decide(p.id, true) }, "Kody się zgadzają — połącz"),
      h("button", { onclick: () => decide(p.id, false) }, "Odrzuć")));
}

async function decide(id, approve) {
  try { await api("POST", `/api/admin/pair/${id}`, { approve }); if (approve) showTab("grupy"); }
  catch (e) { S.error = e.message; }
  refresh();
}

// ------------------------------------------------ zakładka: urządzenia

function devicesTab() {
  const devs = S.state.devices;
  if (S.devEdit && !devs.some(d => d.id === S.devEdit.id)) S.devEdit = null; // czytnik zniknął (np. zapomniany gdzie indziej)
  if (S.devMenu && !devs.some(d => d.id === S.devMenu)) S.devMenu = null;
  return h("section", { class: "devs-view" },
    deviceStrip(devs),
    addDoneNote(),
    devs.length ? h("div", { class: "dcards" }, devs.map(deviceCard)) : addReaderInline(),
    addSheetOpen() && addReaderSheet());
}

// TASK-59: „Dodaj czytnik” to dwa kroki, bo tak to wygląda dla użytkownika: (1) plugin musi być na czytniku
// (kablem USB wgrywa się sam, ręcznie z adresu), (2) czytnik się łączy (kod albo wykrycie w sieci).
// Dawniej trzy równorzędne zakładki (TASK-29) mieszały sytuację czytnika z techniką, a krok zerowy
// odsyłał do innej zakładki. Z listą czytników to arkusz otwierany przyciskiem w nagłówku; przy pustej
// liście ta sama treść stoi w karcie na stronie. Prośba o połączenie jest w środku (jedna, nie dwie).
// S.addReader: {step: 1|2, hand: bool, open: bool}; open = arkusz (karta pustego stanu nie ma open).
function addState() { return S.addReader || { step: 1, hand: S.mode !== "desktop", open: false }; }
function setAdd(patch) { S.addReader = { ...addState(), ...patch }; return render(); }
function addSheetOpen() { return S.tab === "urzadzenia" && !!S.addReader?.open && S.state.devices.length > 0; }
function addInline() { return S.tab === "urzadzenia" && S.state.devices.length === 0; }
// prośby o połączenie rysuje wtedy dodawanie (w arkuszu / w karcie), a nie baner strony
function pendingInAdd() { return addSheetOpen() || addInline(); }
function usbWanted() {
  if (S.mode !== "desktop" || S.tab !== "urzadzenia" || S.usbBusy) return false;
  return (addSheetOpen() || addInline()) && !addState().hand && addState().step === 1;
}
function openAddReader() {
  S.rvMsg = null; S.usbMsg = null; S.rvFound = null;
  S.addReader = { step: 1, hand: S.mode !== "desktop", open: true };
  const p = usbWanted() ? refresh() : render();
  Promise.resolve(p).then(() => document.getElementById("addr-tab-1")?.focus());
}
function closeAddReader() { S.addReader = null; render(); document.getElementById("b-add-reader")?.focus(); }

const ADD_STEPS = [[1, "Plugin na czytniku"], [2, "Połączenie"]];
function addStepTabs(cur) {
  const go = (n, focus) => { Promise.resolve(setAdd({ step: n })).then(() => { if (usbWanted()) return refresh(); }).then(() => { if (focus) document.getElementById("addr-tab-" + n)?.focus(); }); };
  return h("div", { class: "tabs addr-tabs", role: "tablist", "aria-label": "Kroki dodawania czytnika" },
    ADD_STEPS.map(([n, label]) => h("button", {
      type: "button", role: "tab", id: "addr-tab-" + n, "aria-selected": String(cur === n), tabindex: cur === n ? "0" : "-1",
      class: "tab" + (cur === n ? " selected" : ""), onclick: () => go(n, false),
      onkeydown: ev => {
        const to = { ArrowRight: 2, ArrowLeft: 1, Home: 1, End: 2 }[ev.key];
        if (!to) return;
        ev.preventDefault(); go(to, true);
      } }, h("span", { class: "stepn", "aria-hidden": "true" }, n), " ", label)));
}

function addPending() {
  return S.state.pending.map(pairBanner);
}

// Krok 1: kabel USB (tylko aplikacja na komputerze) albo ręcznie. Kabel robi też krok 2, stąd zdanie i brak „Dalej”.
function addStep1() {
  const st = addState(), desk = S.mode === "desktop";
  const seg = desk && h("div", { class: "seg addr-seg", role: "group", "aria-label": "Jak wgrać plugin" },
    [[false, "Kablem USB"], [true, "Ręcznie, bez kabla"]].map(([hand, label]) => h("button", {
      type: "button", "aria-pressed": String(st.hand === hand), id: "addr-seg-" + (hand ? "hand" : "usb"),
      onclick: () => Promise.resolve(setAdd({ hand })).then(() => usbWanted() && refresh()) }, label)));
  const manual = [
    h("ol", { class: "steps" },
      h("li", {}, "Otwórz w przeglądarce czytnika ", h("code", {}, serverURL() + "/koligilo.koplugin.zip"),
        ", rozpakuj do ", h("code", {}, "koreader/plugins/"), " (na Androidzie: ", h("code", {}, "/sdcard/koreader/plugins/"), ")."),
      h("li", {}, "Uruchom KOReader ponownie.")),
    h("p", { class: "muted small" }, "Plugin koligilo instalujesz na czytniku raz. Potem krok 2 łączy go z tym panelem."),
  ];
  return [seg, !desk || st.hand ? manual : [
    usbBody(),
    h("p", { class: "muted small" }, "Z kablem krok 2 odpada: czytnik dostaje adres serwera i łączy się sam — na czytniku zostaje potwierdzić pierwszą synchronizację."),
  ]];
}

// Krok 2: czytnik ma plugin i się zgłasza. Prośba z state.pending to ta sama prośba co w banerze;
// zatwierdzenie dalej tylko ręczne, po porównaniu kodu z ekranem czytnika.
function addStep2() {
  return [
    h("ol", { class: "steps" },
      h("li", {}, "Na czytniku: ", h("b", {}, MENU_PATH_PAIR)),
      h("li", {}, "W tej samej sieci czytnik sam znajdzie ten komputer — pojawi się tu prośba z czterocyfrowym kodem do porównania."),
      h("li", {}, "W każdej innej sieci (także uczelnianej, hotelowej, przez VPN) czytnik pokaże sześciocyfrowy kod — wpisz go tutaj:",
        codeForm()),
      h("li", {}, "Na czytniku potwierdź pierwszą synchronizację. Gotowe.")),
    S.state.pending.length === 0 && h("p", { class: "muted small addr-wait", role: "status", "aria-live": "polite" }, "Czekam na zgłoszenie czytnika…"),
    // informacja o punkcie kontaktowym zostaje widoczna przy wpisywaniu kodu
    h("p", { class: "muted small" },
      "Kod przechodzi przez punkt kontaktowy koligilo.sypian.ski — serwer autora koligilo. Na czas parowania (najwyżej 10 minut, tylko w pamięci) trafia tam model czytnika oraz adres tego komputera i klucz dla czytnika; po odebraniu przez czytnik są kasowane. Ustawień ani książek ten serwer nie widzi. W tej samej sieci Wi-Fi albo po kablu parowanie go nie używa."),
  ];
}
const MENU_PATH_PAIR = "Menu → Narzędzia → koligilo → Połącz z komputerem…";

function addBody() {
  const cur = addState().step;
  return [
    addPending(),
    h("div", { id: "addr-panel-" + cur, role: "tabpanel", "aria-labelledby": "addr-tab-" + cur }, cur === 1 ? addStep1() : addStep2()),
  ];
}
function addFoot(sheet) {
  const cur = addState().step, st = addState();
  const usb = S.mode === "desktop" && !st.hand;
  const close = sheet && h("button", { type: "button", id: "addr-close2", onclick: closeAddReader }, "Zamknij");
  const next = h("button", { type: "button", class: "primary", id: "addr-next",
    onclick: () => Promise.resolve(setAdd({ step: 2 })).then(() => document.getElementById("f-rvcode")?.focus()) }, "Dalej: połącz →");
  const back = h("button", { type: "button", id: "addr-back", onclick: () => Promise.resolve(setAdd({ step: 1 })).then(() => usbWanted() && refresh()) }, "← Wstecz");
  return cur === 1 ? [close, !usb && next] : [back, close];
}

function addReaderSheet() {
  return h("div", { class: "sheet-back", onmousedown: ev => { if (ev.target === ev.currentTarget) closeAddReader(); } },
    h("div", { class: "sheet addsheet addr", role: "dialog", "aria-modal": "true", "aria-labelledby": "addr-title" },
      h("header", { class: "sheet-head" },
        h("h2", { id: "addr-title" }, "Dodaj czytnik"),
        h("button", { type: "button", id: "addr-close", "aria-label": "Zamknij", onclick: closeAddReader }, "×")),
      addStepTabs(addState().step),
      h("div", { class: "sheet-body" }, addBody()),
      h("footer", { class: "sheet-foot addr-foot" }, h("div", { class: "row" }, addFoot(true)))));
}

// Pusta lista: ta sama treść w karcie na stronie, bez „Zamknij”.
function addReaderInline() {
  return h("section", { class: "card addr-inline", style: "margin-bottom:var(--card-gap)" },
    h("h3", { style: "margin-top:0" }, "Połącz pierwszy czytnik"),
    h("p", { class: "muted small", style: "margin-top:0" }, "Każdy czytnik po połączeniu z Wi-Fi sam wysyła swoje zmiany i odbiera zmiany z pozostałych."),
    addStepTabs(addState().step),
    addBody(),
    h("div", { class: "row addr-foot" }, addFoot(false)));
}

// Po połączeniu pierwszego czytnika karta pustego stanu znika, więc wynik („Połączono …”) pokazujemy
// jednym zdaniem nad listą, dopóki go nie zamkniesz.
function addDoneNote() {
  const m = [S.rvMsg, S.usbMsg].find(x => x && x.ok);
  if (!m || addSheetOpen() || addInline()) return null;
  return h("p", { class: "dnote", role: "status" }, "✓ " + m.text + " ",
    h("button", { type: "button", class: "linkbtn", onclick: () => { S.rvMsg = null; S.usbMsg = null; render(); } }, "OK"));
}

function codeForm() {
  return h("div", { class: "codeform" },
    h("form", { class: "row", onsubmit: ev => { ev.preventDefault(); rvLookup(); } },
      h("input", { type: "text", id: "f-rvcode", inputmode: "numeric", autocomplete: "off", "aria-label": "Sześciocyfrowy kod z czytnika",
        placeholder: "123 456", style: "max-width:180px;font:600 22px/1 var(--mono);letter-spacing:.12em",
        value: S.rvCode, oninput: ev => { S.rvCode = ev.target.value; } }),
      h("button", { type: "submit", disabled: S.rvBusy }, "Sprawdź kod")),
    S.rvFound && h("div", { class: "row", style: "margin-top:12px;padding:10px 12px;border-radius:8px;background:var(--accent-soft)" },
      h("div", { style: "flex:1" }, "Czytnik: ", h("b", {}, S.rvFound.name || S.rvFound.model || "?"),
        h("span", { class: "muted small" }, " · ", [S.rvFound.platform, S.rvFound.ko_version && "KOReader " + S.rvFound.ko_version].filter(Boolean).join(" · "))),
      h("button", { class: "primary", disabled: S.rvBusy, onclick: rvClaim }, S.rvBusy ? "Łączę…" : "To mój czytnik — połącz"),
      h("button", { onclick: () => { S.rvFound = null; S.rvCode = ""; render(); } }, "Anuluj")),
    S.rvMsg && h("p", { class: S.rvMsg.ok ? "" : "err" }, S.rvMsg.text));
}

async function rvLookup() {
  const code = S.rvCode.replace(/\D/g, "");
  if (code.length !== 6) { S.rvMsg = { ok: false, text: "Kod ma sześć cyfr." }; return render(); }
  S.rvBusy = true; S.rvMsg = null; render();
  try { S.rvFound = await api("GET", `/api/admin/rv/${code}`); }
  catch (e) { S.rvFound = null; S.rvMsg = { ok: false, text: e.message }; }
  S.rvBusy = false; render();
}

async function rvClaim() {
  const code = S.rvCode.replace(/\D/g, "");
  S.rvBusy = true; render();
  try {
    await api("POST", `/api/admin/rv/${code}/claim`);
    S.rvMsg = { ok: true, text: `Połączono „${S.rvFound.name || "czytnik"}”. Na czytniku pojawi się pytanie o pierwszą synchronizację.` };
    S.rvFound = null; S.rvCode = "";
  } catch (e) { S.rvMsg = { ok: false, text: e.message }; }
  S.rvBusy = false; refresh();
}

function usbBody() {
  const readers = S.usb?.readers || [];
  return h("div", { class: "usb" },
    h("p", { class: "muted small", style: "margin-top:0" },
      "Najprostsza droga: podłącz czytnik do tego komputera kablem USB. koligilo wgra plugin i zapisze na czytniku adres serwera — na czytniku zostaje tylko potwierdzić pierwszą synchronizację. Działa w każdej sieci, także uczelnianej."),
    !S.usb ? h("p", { class: "muted" }, "Szukam podłączonych czytników…")
      : readers.length === 0
        ? h("p", { class: "muted" }, "Nie widzę podłączonego czytnika z KOReaderem. ",
            "Kobo, Kindle i PocketBook: podłącz i wybierz na czytniku tryb dysku USB. ",
            "Android (Bigme, Boox, telefon): włącz debugowanie USB w opcjach programisty",
            S.usb.adb ? "." : " — i zainstaluj na komputerze adb (Android platform-tools).")
        : readers.map(r => h("div", { class: "row", style: "justify-content:space-between;padding:8px 0;border-top:1px solid var(--line)" },
            h("div", {}, h("b", {}, r.label), h("div", { class: "muted small" },
              r.kind === "android" ? "Android, przez adb" : "dysk USB", r.paired ? " · już ma konfigurację koligilo" : "")),
            h("button", { class: r.paired ? "" : "primary", disabled: !!S.usbBusy, onclick: () => pairUSB(r) },
              S.usbBusy === r.id ? "Łączę…" : r.paired ? "Połącz ponownie" : "Połącz ten czytnik"))),
    S.usbMsg && h("p", { class: S.usbMsg.ok ? "" : "err" }, S.usbMsg.text));
}

async function pairUSB(r) {
  if (r.paired && !confirm(`„${r.label}” ma już konfigurację koligilo. Połączyć go od nowa? Powstanie nowy wpis urządzenia — stary możesz potem zapomnieć.`)) return;
  S.usbBusy = r.id; S.usbMsg = null; render();
  try {
    const out = await api("POST", "/api/local/usb/pair", { id: r.id });
    S.usbMsg = { ok: true, text: out.message };
  } catch (e) {
    S.usbMsg = { ok: false, text: e.message };
  }
  S.usbBusy = null;
  refresh();
}

// Stan synchronizacji czytnika (TASK-29): „cicho” = ostatnia synchronizacja starsza niż QUIET_DAYS.
// Czytnik leżący w szufladzie przez weekend nie ma świecić, stąd tydzień. Korzysta z danych,
// które serwer już zwraca (last_sync), więc nie dochodzi żadne pole.
const QUIET_DAYS = 7;
function syncHealth(d) {
  const ls = d.last_sync;
  // TASK-50: bezpiecznik wtyczki wstrzymał synchronizację; znika po pierwszej udanej (serwer czyści zgłoszenie)
  const sb = d.sync_blocked;
  if (sb && sb.count > 0) {
    const n = sb.count, w = n === 1 ? "ustawienie" : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? "ustawienia" : "ustawień";
    return { k: "stop", text: `wstrzymana: zniknęło ${n} ${w}`,
      title: `Wtyczka wstrzymała synchronizację ${ago(sb.at)}: ${n} ${w} zniknęło naraz z tego czytnika. Nic nie zostało wysłane ani zmienione. Zmień ustawienia pojedynczo albo wyłącz ich grupy.` };
  }
  if (!ls) return { k: "na", text: "jeszcze nie synchronizował", title: "Połączony " + ago(d.paired_at) };
  const days = Math.floor((Date.now() - new Date(ls.at)) / 86400000);
  if (days >= QUIET_DAYS) return { k: "warn", text: `cicho od ${days} dni`, title: "Ostatnia synchronizacja: " + ago(ls.at) };
  return { k: "ok", text: ago(ls.at), title: "Ostatnio widziany " + ago(d.last_seen) };
}
// kropka (kształt niesie stan bez koloru) + słowo; kropka jest dla czytników ekranu zbędna, bo słowo mówi to samo
function healthCell(d) {
  const x = syncHealth(d);
  return h("span", { class: "hcell", title: x.title }, h("span", { class: "hdot " + x.k, "aria-hidden": "true" }), h("span", { class: "hword " + x.k }, x.text));
}

// TASK-49: wersja wtyczki koligilo na czytniku. Porównanie liczbowe po X.Y.Z (0.10.0 > 0.9.9),
// nie tekstowe; nierozpoznany numer nie jest uznawany za starszy.
function verParts(v) {
  const m = /^(\d{1,4})\.(\d{1,5})\.(\d{1,6})$/.exec(v || "");
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function verOlder(a, b) {
  const x = verParts(a), y = verParts(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
}
// TASK-59: urządzenia jako karty (dwie kolumny, jedna poniżej 760 px) zamiast tabeli o siedmiu kolumnach:
// wiersz tabeli miał 276–300 px, bo wersja wtyczki i zgody siedziały w jednej wąskiej kolumnie.
// Karta mówi: kto (nazwa, KOReader), czy żyje (stan), jaka wtyczka, na co się zgodził, co dostaje.
// Zmiana nazwy i „Zapomnij” są w menu „⋯”; pasek potwierdzenia (S.devEdit) rozwija się w karcie,
// więc stan edycji żyje w S i odświeżanie co 3 s go nie zamyka.

// Zgody czytnika jako sześć żetonów: ciągła ramka i ✓ = pozwolone, kreskowana = nie (kształt niesie stan,
// nie kolor). Zgodę daje się wyłącznie na czytniku (menu koligilo → Zgody; PC-004, PC-018, PC-019, PC-020) —
// panel jej nie ustawia, tylko opisuje.
const DEV_CONSENTS = [
  ["plugins_allowed", "Wtyczki"], ["fonts_allowed", "Czcionki"], ["dicts_allowed", "Słowniki"],
  ["self_update_allowed", "Aktualizacja koligilo"], ["merge_after_sync", "Scalanie statystyk"], ["wallabag_after_sync", "Wallabag"],
];
function consentChips(d) {
  return h("div", { class: "cchips", title: "Zgodę daje się wyłącznie na czytniku: menu koligilo → Zgody." },
    DEV_CONSENTS.map(([k, label]) => h("span", { class: "cc" + (d[k] ? " on" : "") },
      label, h("span", { class: "sr" }, d[k] ? " (pozwolone na czytniku)" : " (niepozwolone na czytniku)"))));
}

// Wersja wtyczki koligilo na czytniku (TASK-49); stara wtyczka nie zgłasza numeru.
function koligiloVer(d) {
  const cur = S.state?.server_plugin_version, v = d.plugin_version;
  if (!v) return h("span", { class: "muted" }, "koligilo: nieznana wersja (stara wtyczka)");
  return h("span", {}, "koligilo " + v,
    verOlder(v, cur) && h("span", { class: "badge warn", title: `Na serwerze jest wersja ${cur}.` }, "nieaktualna"));
}

// „Co czytnik dostaje” zamiast liczników z ostatniej synchronizacji (dawniej „Wysłał / pobrał 0 / 3”):
// ile grup z katalogu jest włączonych i ile wtyczek ma przypisanych. Dane już są w /api/admin/state.
function deviceScope(d) {
  const cat = S.state.catalog || [], n = cat.filter(g => d.groups[g.id]).length, np = Object.keys(d.plugins || {}).length;
  return `dostaje ${n} z ${cat.length} ${cat.length === 1 ? "grupy" : "grup"} · `
    + (np === 0 ? "bez wtyczek" : `${np} ${plPl(np, "wtyczka", "wtyczki", "wtyczek")}`);
}

// Pasek nad kartami: jedna linia o czytnikach, które się zatrzymały (wstrzymana synchronizacja albo cisza od
// QUIET_DAYS). Zdrowa lista nie ma paska. Stan liczy syncHealth, więc próg i teksty są w jednym miejscu.
function deviceStrip(devs) {
  const items = devs.map(d => [d, syncHealth(d)]).filter(([, x]) => x.k === "stop" || x.k === "warn");
  if (!items.length) return null;
  return h("div", { class: "dstrip", role: "status" },
    h("span", { class: "hdot stop", "aria-hidden": "true" }),
    h("span", {}, items.map(([d, x], i) => [
      i > 0 && " · ", h("b", {}, d.name), ": ",
      x.k === "stop" ? `synchronizacja wstrzymana (${x.text.replace(/^wstrzymana: /, "")})` : x.text,
    ])));
}

function deviceCard(d) {
  const open = S.devMenu === d.id, E = S.devEdit && S.devEdit.id === d.id ? S.devEdit : null;
  // model pomijamy, gdy powtarza nazwę („Steam Deck” obok „Linux · Steam Deck”)
  const meta = [d.platform, d.model && d.model !== d.name ? d.model : null].filter(Boolean).join(" · ");
  const item = (mode, label, cls) => h("button", {
    type: "button", role: "menuitem", class: cls || "", id: `f-dev-${d.id}-${mode}`,
    "aria-label": `${label} ${d.name}`, onclick: () => devEditStart(d, mode),
  }, label);
  return h("article", { class: "dcard", "aria-label": d.name },
    h("div", { class: "dc-h" },
      h("h3", { class: "dn" }, d.name),
      h("span", { class: "chip-ko" }, "KOReader " + (d.ko_version || "?")),
      h("div", { class: "dmenu" },
        h("button", {
          type: "button", class: "grp-more", id: `f-dev-${d.id}-menu`, "aria-haspopup": "menu", "aria-expanded": String(open),
          "aria-label": `Operacje na urządzeniu ${d.name}`, title: "Operacje na urządzeniu",
          onclick: ev => { ev.stopPropagation(); devMenuToggle(d); },
        }, "⋯"),
        open && h("div", { class: "cmenu", role: "menu", "aria-label": `Operacje na urządzeniu ${d.name}`, onkeydown: devMenuKey },
          item("rename", "Zmień nazwę"), item("forget", "Zapomnij", "danger")))),
    meta && h("div", { class: "muted small" }, meta),
    h("div", {}, healthCell(d)),
    h("div", { class: "small" }, koligiloVer(d)),
    consentChips(d),
    h("div", { class: "muted small", title: "Grupy ustawień włączone na tym czytniku i wtyczki, które mu przypisano. Zmienisz to w „Co synchronizować” i „Wtyczki”." }, deviceScope(d)),
    E && deviceEditBar(d));
}

function deviceEditBar(d) {
  const E = S.devEdit;
  const cancel = h("button", { type: "button", id: "f-devcancel", onclick: devEditCancel }, "Anuluj");
  const onkey = ev => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); devEditCancel(); } };
  if (E.mode === "rename") {
    return h("div", { class: "dedit", onkeydown: onkey },
      h("form", { class: "row", onsubmit: ev => { ev.preventDefault(); devRenameSave(d); } },
        h("label", { for: "f-devname", class: "dlabel" }, "Nowa nazwa (np. „Kobo w sypialni”)"),
        h("input", { type: "text", id: "f-devname", value: E.name, autocomplete: "off", style: "max-width:300px",
          oninput: ev => { E.name = ev.target.value; } }),
        h("button", { type: "submit", class: "primary", id: "f-devsave", disabled: E.busy }, E.busy ? "Zapisuję…" : "Zapisz"),
        cancel,
        E.error && h("span", { class: "err", role: "alert" }, E.error)));
  }
  return h("div", { class: "dedit", onkeydown: onkey },
    h("div", { class: "row" },
      h("div", { style: "flex:1;min-width:200px" }, h("b", {}, `Zapomnieć „${d.name}”?`), " ",
        "Urządzenie przestanie się synchronizować. Jego ustawienia zostaną takie, jakie są. Żeby je znowu połączyć, trzeba będzie sparować je od nowa."),
      h("button", { type: "button", class: "danger", id: "f-devforget", disabled: E.busy, onclick: () => devForget(d) }, E.busy ? "Zapominam…" : "Zapomnij"),
      cancel,
      E.error && h("span", { class: "err", role: "alert" }, E.error)));
}

function devMenuToggle(d) {
  S.devMenu = S.devMenu === d.id ? null : d.id;
  render();
  if (S.devMenu) document.getElementById(`f-dev-${d.id}-rename`)?.focus();
}
function devMenuKey(ev) {
  const d = { ArrowDown: 1, ArrowUp: -1 }[ev.key];
  if (d == null) return;
  ev.preventDefault();
  const items = [...ev.currentTarget.querySelectorAll("button")], i = items.indexOf(document.activeElement);
  items[(i + d + items.length) % items.length].focus();
}
document.addEventListener("click", ev => {
  if (S.devMenu && !ev.target.closest(".dmenu")) { S.devMenu = null; if (S.tab === "urzadzenia") render(); }
});
document.addEventListener("keydown", ev => {
  if (ev.key === "Escape" && S.devMenu) {
    const id = `f-dev-${S.devMenu}-menu`;
    S.devMenu = null; render(); document.getElementById(id)?.focus();
  }
});

// Fokus: przy zapomnieniu ląduje na „Anuluj” (nie na przycisku nieodwracalnym), przy zmianie nazwy w polu.
function devEditStart(d, mode) {
  S.devMenu = null;
  S.devEdit = { id: d.id, mode, name: d.name, busy: false, error: null };
  render();
  const el = document.getElementById(mode === "rename" ? "f-devname" : "f-devcancel");
  el?.focus();
  if (mode === "rename") el?.select();
}

function devEditCancel() {
  const E = S.devEdit;
  S.devEdit = null;
  render();
  if (E) document.getElementById(`f-dev-${E.id}-menu`)?.focus(); // wróć na „⋯”, z którego otwarto pasek
}

function serverURL() {
  if (S.mode !== "desktop") return S.state?.public_url || location.origin;
  return S.local?.mode === "local" ? (S.local.public_url || "") : (S.local?.server || "");
}

async function devRenameSave(d) {
  const E = S.devEdit, name = E.name.trim();
  if (!name) { E.error = "Nazwa nie może być pusta."; return render(); }
  if (name === d.name) return devEditCancel();
  E.busy = true; E.error = null; render();
  try { await api("POST", `/api/admin/devices/${d.id}/rename`, { name }); S.devEdit = null; }
  catch (e) { E.busy = false; E.error = e.message; }
  refresh();
}

async function devForget(d) {
  const E = S.devEdit;
  E.busy = true; E.error = null; render();
  try { await api("DELETE", `/api/admin/devices/${d.id}`); S.devEdit = null; }
  catch (e) { E.busy = false; E.error = e.message; }
  refresh();
}

// ------------------------------------------------ zakładka: grupy (TASK-30)
//
// Tabela grup × urządzenia z sekcjami zwijanymi (kategorie z catalog.go; zwinięta sekcja pokazuje „k/n”
// włączonych), wierszem zwiniętym do nazwy i znaczników (opis i ostrzeżenie po kliknięciu), licznikiem „na 2 z 3”,
// kolumną „Wszystkie” oraz menu „⋯” w nagłówku kolumny („Ustaw jak…”, „Przywróć domyślne”). Każda zmiana
// kończy się paskiem z „Cofnij” (S.grp.snack). Poniżej 760 px tabelę zastępują karty grup (tylko CSS).
// Zmiany kilku komórek to kolejne żądania (nie atomowe), więc „Cofnij” odtwarza poprzednie wartości.

let grpSnackTimer = null;

function grpCount(g, devices) {
  return { n: devices.filter(d => d.groups[g.id]).length, t: devices.length };
}

function grpChip(g, devices) {
  const { n, t } = grpCount(g, devices);
  if (n === 0) return h("span", { class: "cn zero" }, "wyłączona wszędzie");
  if (n === 1 && t > 1) return h("span", { class: "cn one" }, `tylko 1 z ${t} — nic się nie dzieli`);
  return h("span", { class: "cn" }, `na ${n} z ${t}`);
}

function grpMarks(g) {
  return [
    g.secret && h("span", { class: "badge key", title: "Zawiera hasła lub tokeny" }, "🔑 dane logowania"),
    g.warning && h("span", { class: "badge warn", title: "Rozwiń wiersz, by przeczytać ostrzeżenie" }, "⚠ uwaga"),
  ];
}

function grpDetail(g) {
  return [h("div", { class: "gdesc" }, g.description), g.warning && h("div", { class: "gwarn" }, "⚠ ", g.warning)];
}

// TASK-51: grupa konta włączona na czytniku, a w „Konta” nic nie wpisano — czytnik nie dostanie niczego.
function grpAccHint(g, devices) {
  const a = ACCOUNTS.find(x => x.group === g.id);
  if (!a || !S.acc || accInfo(a.id).conf) return null;
  const on = devices.filter(d => d.groups[g.id]).map(d => d.name);
  if (!on.length) return null;
  return h("div", { class: "gacc small", role: "note" },
    h("span", {}, "⚠ Grupa włączona, ale konto nie jest skonfigurowane"), h("span", { class: "muted" }, ` (${on.join(", ")})`), " ",
    h("button", { type: "button", class: "linkbtn", onclick: () => { S.accOpen = a.id; showTab("konta"); } }, "Przejdź do Kont"));
}

function grpNameCell(g, devices) {
  const open = !!S.grp.rows[g.id], id = "grp-row-" + g.id;
  return h("th", { scope: "row", style: "text-align:left;font-weight:400" },
    h("div", { class: "gname" },
      h("button", {
        type: "button", class: "grp-tog", id, "aria-expanded": String(open), "aria-controls": id + "-more",
        onclick: () => { S.grp.rows[g.id] = !open; render(); },
      }, h("span", { class: "car", "aria-hidden": "true" }, open ? "▾" : "▸"), g.name),
      grpMarks(g), grpChip(g, devices)),
    grpAccHint(g, devices),
    open && h("div", { id: id + "-more" }, grpDetail(g)));
}

function grpSwitch(g, d) {
  return h("label", { class: "switch", title: `${g.name} — ${d.name}` },
    h("input", {
      type: "checkbox", checked: d.groups[g.id], disabled: S.grp.busy,
      "aria-label": `${g.name} na ${d.name}`,
      onchange: ev => grpToggle(g, d, ev.target.checked),
    }),
    h("span", {}));
}

// Kolumna „Wszystkie”: trzy stany (wszędzie / częściowo / nigdzie). Kliknięcie ustawia wszędzie albo nigdzie.
function grpAllSwitch(g, devices) {
  const { n, t } = grpCount(g, devices);
  const input = h("input", {
    type: "checkbox", checked: t > 0 && n === t, disabled: S.grp.busy,
    "aria-label": `${g.name} na wszystkich urządzeniach`,
    onchange: ev => {
      const on = ev.target.checked;
      grpApply(devices.filter(d => !!d.groups[g.id] !== on).map(d => grpChange(g, d, on)),
        `${on ? "Włączono" : "Wyłączono"} „${g.name}” na wszystkich urządzeniach.`);
    },
  });
  input.indeterminate = n > 0 && n < t;
  return h("label", { class: "switch" + (input.indeterminate ? " part" : ""), title: "Wszystkie urządzenia" }, input, h("span", {}));
}

function grpChange(g, d, on) {
  return { dev: d.id, devName: d.name, group: g.id, groupName: g.name, on, was: !on };
}

function grpToggle(g, d, on) {
  grpApply([grpChange(g, d, on)], on
    ? `Włączono „${g.name}” na ${d.name}. Przyjmie wersję wspólną przy najbliższej synchronizacji.`
    : `Wyłączono „${g.name}” na ${d.name}. Ustawienia z tej grupy zostają na urządzeniu, ale przestają się synchronizować.`);
}

// Wykonuje zmiany po kolei; po sukcesie pokazuje pasek z „Cofnij” (odwrócone zmiany). undo=true: bez paska.
async function grpApply(changes, text, undo) {
  clearTimeout(grpSnackTimer);
  if (!changes.length) {
    S.grp.snack = { text: "Bez zmian — wszystko już jest tak ustawione." };
    return grpSnackShow();
  }
  S.grp.busy = true; S.grp.snack = null; render();
  try {
    for (const c of changes) await api("POST", `/api/admin/devices/${c.dev}/groups`, { group: c.group, on: c.on });
    S.grp.snack = undo ? { text: "Cofnięto." } : { text, undo: changes.map(c => ({ ...c, on: c.was, was: c.on })) };
  } catch (e) {
    S.error = e.message;
  }
  S.grp.busy = false;
  grpSnackShow();
  refresh();
}

function grpSnackShow() {
  clearTimeout(grpSnackTimer);
  grpSnackTimer = setTimeout(() => { S.grp.snack = null; if (S.tab === "grupy") render(); }, 12000);
  if (S.tab === "grupy") render();
}

function grpSnack() {
  const sn = S.grp.snack;
  if (!sn) return null;
  return h("div", { class: "snack", role: "status", "aria-live": "polite" },
    h("span", { class: "grow" }, sn.text),
    sn.undo && h("button", { type: "button", id: "grp-undo", onclick: () => grpApply(sn.undo, "", true) }, "Cofnij"),
    h("button", { type: "button", class: "snack-x", "aria-label": "Zamknij", onclick: () => { S.grp.snack = null; render(); } }, "×"));
}

// Menu „⋯” w nagłówku kolumny: kopiuje układ z innego urządzenia albo przywraca domyślne grupy z katalogu.
function grpMenu(d, devices, catalog) {
  const open = S.grp.menu === d.id, id = "grp-more-" + d.id;
  const items = [];
  const others = devices.filter(x => x.id !== d.id);
  if (others.length) {
    items.push(h("span", { class: "cmenu-h" }, "Ustaw jak…"));
    for (const o of others) items.push(h("button", {
      type: "button", role: "menuitem", class: "s",
      onclick: () => {
        S.grp.menu = null;
        const ch = catalog.filter(g => !!d.groups[g.id] !== !!o.groups[g.id]).map(g => grpChange(g, d, !!o.groups[g.id]));
        grpApply(ch, `Ustawiono „${d.name}” jak „${o.name}”: ${ch.length} ${plPl(ch.length, "zmiana", "zmiany", "zmian")}.`);
      },
    }, o.name));
  }
  items.push(h("button", {
    type: "button", role: "menuitem",
    onclick: () => {
      S.grp.menu = null;
      const ch = catalog.filter(g => !!d.groups[g.id] !== !!g.default).map(g => grpChange(g, d, !!g.default));
      grpApply(ch, `Przywrócono domyślne grupy na „${d.name}”: ${ch.length} ${plPl(ch.length, "zmiana", "zmiany", "zmian")}.`);
    },
  }, "Przywróć domyślne"));
  return [
    h("button", {
      type: "button", class: "grp-more", id, "aria-haspopup": "menu", "aria-expanded": String(open),
      "aria-label": `Operacje na urządzeniu ${d.name}`, title: "Operacje na urządzeniu",
      onclick: ev => { ev.stopPropagation(); S.grp.menu = open ? null : d.id; render(); },
    }, "⋯"),
    open && h("div", { class: "cmenu", role: "menu", "aria-label": `Operacje na urządzeniu ${d.name}` }, items),
  ];
}
document.addEventListener("click", ev => {
  if (S.grp.menu && !ev.target.closest(".cmenu")) { S.grp.menu = null; if (S.tab === "grupy") render(); }
});
document.addEventListener("keydown", ev => {
  if (ev.key === "Escape" && S.grp.menu) {
    const id = "grp-more-" + S.grp.menu;
    S.grp.menu = null; render(); document.getElementById(id)?.focus();
  }
});

function grpSections(catalog) {
  const cats = (S.state.categories || []).map(c => ({ ...c, groups: catalog.filter(g => g.category === c.id) }))
    .filter(c => c.groups.length);
  const known = new Set(cats.flatMap(c => c.groups.map(g => g.id)));
  const rest = catalog.filter(g => !known.has(g.id));
  if (rest.length) cats.push({ id: "_inne", name: "Inne", groups: rest });
  return cats;
}

function groupsTab() {
  const { catalog, devices, never } = S.state;
  const nGroups = n => `${n} ${plPl(n, "grupa", "grupy", "grup")}`;
  return h("section", { class: "grp" },
    explainFold("grupy", "Włączona grupa działa w obie strony: urządzenie wysyła swoje zmiany i przyjmuje cudze.",
      "Gdy włączasz grupę na urządzeniu, które już ma swoje wartości, przy najbliższej synchronizacji przyjmie wersję wspólną. Jeśli dwa urządzenia zmienią to samo ustawienie w międzyczasie, wygrywa zmiana, która pierwsza dotrze na serwer."),
    h("details", {
      class: "explain fold grp-never", open: S.grp.never,
      ontoggle: ev => { S.grp.never = ev.target.open; },
    },
      h("summary", {}, `${never.length} ${plPl(never.length, "ustawienie zostaje", "ustawienia zostają", "ustawień zostaje")} na każdym urządzeniu osobno`),
      h("p", { class: "muted small" }, "Tych ustawień koligilo nigdy nie przenosi — nawet gdyby ktoś próbował:"),
      h("ul", {}, never.map(n => h("li", {}, h("b", {}, n.name), " — ", n.reason)))),
    devices.length === 0
      ? h("p", { class: "muted" }, "Na razie nie ma połączonych urządzeń — tabela pokaże się po sparowaniu pierwszego czytnika.")
      : [groupMatrix(catalog, devices, grpSections(catalog), nGroups), groupCards(devices, grpSections(catalog), nGroups)],
    grpSnack());
}

function groupMatrix(catalog, devices, sections, nGroups) {
  const head = h("thead", {}, h("tr", {},
    h("th", { scope: "col" }, "Ustawienia"),
    h("th", { scope: "col" }, "Wszystkie"),
    devices.map(d => h("th", { scope: "col", class: "hc" }, d.name, grpMenu(d, devices, catalog)))));
  const body = h("tbody", {}, sections.map(c => {
    const open = !!S.grp.cats[c.id], id = "grp-cat-" + c.id;
    return [
      h("tr", { class: "sh" },
        h("th", { scope: "rowgroup", style: "text-align:left" },
          h("button", {
            type: "button", class: "grp-tog", id, "aria-expanded": String(open),
            onclick: () => { S.grp.cats[c.id] = !open; render(); },
          }, h("span", { class: "car", "aria-hidden": "true" }, open ? "▾" : "▸"), c.name),
          h("span", { class: "muted small" }, " · ", nGroups(c.groups.length))),
        h("td", {}),
        devices.map(d => h("td", { class: "cell small", "aria-label": `${c.name} na ${d.name}: włączone ${c.groups.filter(g => d.groups[g.id]).length} z ${c.groups.length}` },
          `${c.groups.filter(g => d.groups[g.id]).length}/${c.groups.length}`))),
      open && c.groups.map(g => h("tr", { class: "gr" },
        grpNameCell(g, devices),
        h("td", { class: "cell" }, grpAllSwitch(g, devices)),
        devices.map(d => h("td", { class: "cell" }, grpSwitch(g, d))))),
    ];
  }));
  return h("div", { class: "card grp-wrap grp-table" }, h("table", { class: "matrix grp-matrix" }, head, body));
}

// Wąskie okno: każda grupa to karta z listą urządzeń (opis i ostrzeżenie zawsze widoczne).
function groupCards(devices, sections, nGroups) {
  return h("div", { class: "grp-cards" }, sections.map(c => [
    h("div", { class: "sech" }, c.name, h("span", { class: "muted small" }, " · ", nGroups(c.groups.length))),
    c.groups.map(g => h("div", { class: "gcard" },
      h("div", { class: "gname" }, g.name, grpMarks(g), grpChip(g, devices)),
      grpAccHint(g, devices),
      grpDetail(g),
      h("div", { class: "dl" }, devices.map(d => h("div", { class: "dr" }, h("span", {}, d.name), grpSwitch(g, d)))))),
  ]));
}

// ------------------------------------------------ zakładka: konta (TASK-31)
//
// Jedna lista wierszy zamiast pięciu otwartych formularzy: ● nazwa, plakietka „kto
// dostaje”, streszczenie i „Edytuj ▾”. Otwarty jest jeden wiersz naraz (S.accOpen);
// szkice formularzy żyją w S.dr, więc zwinięcie wiersza ani odświeżenie ich nie kasuje.
// Zakładka nie odświeża się w tle (patrz setInterval na końcu pliku).

// Etykiety stanu i grupy katalogu, z których wiersze liczą „kto dostaje” (devices[].groups).
const ACCOUNTS = [
  { id: "kosync", name: "Postęp czytania (kosync)", short: "kosync", group: "konto_kosync",
    desc: "Dzięki temu każdy czytnik otworzy książkę na stronie, na której skończyłeś na innym. Konto zakładasz raz — np. w KOReaderze: Narzędzia → Synchronizacja postępu → Zarejestruj." },
  { id: "wallabag", name: "Wallabag", short: "Wallabag", group: "konto_wallabag",
    desc: "Client ID i secret założysz w Wallabagu: Zarządzanie klientami API → Utwórz nowego klienta. Folder pobierania artykułów zostaje osobny na każdym czytniku." },
  { id: "cloud", name: "Konta w chmurze", short: "konta w chmurze", plural: true, group: "konta_chmura",
    desc: "To samo co Menu → Chmura w KOReaderze: miejsca, z których czytnik pobiera książki i w których statystyki oraz słowniczek trzymają wspólną bazę. Na czytnikach pojawią się pod tymi samymi nazwami." },
  { id: "opds", name: "Katalogi OPDS", short: "katalogi OPDS", plural: true, group: "konto_opds",
    desc: "To ten sam spis co Menu → OPDS w KOReaderze: katalogi książek (np. Calibre, Project Gutenberg), z których czytnik pobiera pliki. Czytniki dostaną ich nazwy, adresy i loginy z hasłami. Pobrane pliki, kolejka synchronizacji i lokalne foldery zostają na każdym urządzeniu osobno." },
  { id: "targets", name: "Statystyki i słowniczek", short: "statystyki i słowniczek", plural: true, group: "konto_statystyki",
    desc: "Statystyki czytania i słowniczek (w KOReaderze: Kreator słownictwa) mogą być wspólne dla wszystkich czytników. Tu wybierasz, na którym koncie w chmurze leży ich wspólna baza; scalanie robi KOReader, kiedy każesz mu to zrobić na czytniku." },
  { id: "rosetta", name: "Rosetta — klucze API", short: "Rosetta", group: "rosetta_klucze",
    desc: "Rosetta tłumaczy strony na żywo. Google Translate działa bez żadnych kluczy; dostęp do modelu AI jest potrzebny tylko wtedy, gdy wybierzesz w ustawieniach wtyczki tłumaczenie „Model AI” (albo „Gotowy przekład” z modelem na brakujące akapity). Klucz to sekret — włączaj tę grupę tylko między urządzeniami, którym ufasz." },
];

function hostOf(url) {
  try { const u = new URL(url); return u.host + (u.pathname !== "/" ? u.pathname.replace(/\/$/, "") : ""); } catch { return url || ""; }
}

// Stan usługi z S.acc: {conf, sum, warn}. „warn” to stan wymagający uwagi (krótkotrwały token Dropboxa).
function accInfo(id) {
  const a = S.acc || {};
  const cloud = a.cloud || [];
  if (id === "kosync") {
    const k = a.kosync;
    return k ? { conf: true, sum: [k.username, k.server ? hostOf(k.server) : "serwer KOReadera"].filter(Boolean).join(" · ") }
      : { conf: false, sum: "nie skonfigurowane" };
  }
  if (id === "wallabag") {
    const w = a.wallabag;
    return w ? { conf: true, sum: [w.username, hostOf(w.server_url)].filter(Boolean).join(" · ") }
      : { conf: false, sum: "nie skonfigurowane" };
  }
  if (id === "cloud") {
    if (!cloud.length) return { conf: false, sum: a.cloud_error || "nie skonfigurowane" };
    const broken = cloud.some(c => c.broken);
    return { conf: true, warn: broken,
      sum: cloud.map(c => { const t = CLOUD_TYPES[c.type] || c.type; return t === c.name ? c.name : `${c.name} (${t})`; }).join(" · ")
        + (broken ? " · ⚠ wymaga ponownego połączenia" : "") };
  }
  if (id === "opds") {
    const l = a.opds || [];
    return l.length ? { conf: true, sum: l.map(o => o.title).join(" · ") }
      : { conf: false, sum: a.opds_error || "nie skonfigurowane" };
  }
  if (id === "targets") {
    const t = a.targets || {};
    const parts = TARGETS.map(([which, label]) => t[which]
      ? `${label.toLowerCase().split(" ")[0]} → ${t[which].name}, ${t[which].folder || "/"}` : null);
    const on = parts.filter(Boolean);
    if (!on.length) return { conf: false, sum: cloud.length ? "wyłączone" : "najpierw dodaj konto w chmurze" };
    const off = TARGETS.filter(([which]) => !t[which]).map(([which, label]) => label.toLowerCase().split(" ")[0] + (which === "statystyki" ? " wyłączone" : " wyłączony"));
    const broken = TARGETS.some(([which]) => t[which]?.broken);
    return { conf: true, warn: broken,
      sum: [...on, ...off].join(" · ") + (broken ? " · ⚠ wymaga ponownego połączenia" : "") };
  }
  const r = a.rosetta;
  return r ? { conf: true, sum: [r.ai_base_url && hostOf(r.ai_base_url), r.ai_model].filter(Boolean).join(" · ") || "klucz zapisany" }
    : { conf: false, sum: "nie skonfigurowane" };
}

// Ile czytników dostaje grupę: {n, total, on:[nazwy], off:[nazwy]} albo null bez czytników.
function accReach(group) {
  const devs = S.state.devices || [];
  if (!devs.length) return null;
  const on = devs.filter(d => d.groups && d.groups[group]).map(d => d.name || d.model);
  const off = devs.filter(d => !(d.groups && d.groups[group])).map(d => d.name || d.model);
  return { n: on.length, total: devs.length, on, off };
}

function reachBadge(a, conf) {
  if (!conf) return h("span", { class: "badge soon" }, "nie skonfigurowane");
  const r = accReach(a.group);
  if (!r) return h("span", { class: "badge soon", title: "Nie sparowano jeszcze żadnego czytnika" }, "brak czytników");
  const title = `Dostają: ${r.on.join(", ") || "nikt"}.` + (r.off.length ? ` Grupa wyłączona na: ${r.off.join(", ")} (zakładka „Co synchronizować”).` : "");
  if (r.n === 0) return h("span", { class: "badge warn", title }, "nikt nie dostaje");
  if (r.n === r.total) return h("span", { class: "badge soon", title }, `u wszystkich (${r.n})`);
  return h("span", { class: "badge warn", title }, `u ${r.n} z ${r.total}`);
}

// Podpis pod nagłówkiem widoku: ile usług jest skonfigurowanych i które nie dochodzą do wszystkich czytników.
function accountsSub(st) {
  if (!S.acc) return "";
  const conf = ACCOUNTS.filter(a => accInfo(a.id).conf);
  if (!conf.length) return "Nic jeszcze nie skonfigurowano";
  const head = `${conf.length} z ${ACCOUNTS.length} usług skonfigurowanych`;
  const devs = st.devices || [];
  if (!devs.length) return head + " · brak sparowanych czytników";
  const partial = conf.map(a => ({ a, r: accReach(a.group) })).filter(x => x.r.n < x.r.total);
  if (!partial.length) return head + " · wszystkie trafiają na wszystkie czytniki";
  const say = ({ a, r }) => r.n === 0
    ? `${a.short} ${a.plural ? "nie trafiają" : "nie trafia"} na żaden czytnik`
    : `${a.short} ${a.plural ? "trafiają" : "trafia"} na ${r.n} z ${r.total} czytników`;
  return head + " · " + partial.slice(0, 2).map(say).join(" · ") + (partial.length > 2 ? ` · i ${partial.length - 2} więcej` : "");
}

// Szkic formularza: przy pierwszym renderze wypełniony z serwera, potem żyje
// w S.dr aż do zapisu albo anulowania.
function draft(name, init) {
  if (!S.dr[name]) S.dr[name] = init();
  return S.dr[name];
}

function field(d, key, label, o = {}) {
  const id = `f-${o.form || "acc"}-${key}`;
  return h("label", { class: "field" },
    h("span", {}, label),
    h("input", {
      id, type: o.type || "text", value: d[key] ?? "", placeholder: o.placeholder,
      autocomplete: o.type === "password" ? "new-password" : "off", spellcheck: "false",
      oninput: ev => { d[key] = ev.target.value; },
    }),
    o.hint && h("small", {}, o.hint));
}

// Pole sekretu. Zapisany sekret to „•••••••• zapisane [Zmień]” (serwer oddaje tylko has_*, nigdy wartość);
// pole do wpisania pojawia się dopiero po „Zmień”. Puste pole przy zapisie nadal znaczy „bez zmian”.
function secretField(d, key, label, o = {}) {
  d._chg = d._chg || {};
  if (!o.saved || d._chg[key]) {
    const id = `f-${o.form || "acc"}-${key}`;
    return h("div", {},
      field(d, key, label, { form: o.form, type: "password", hint: o.hint,
        placeholder: o.saved ? "wpisz nowe — puste zostawia zapisane" : "" }),
      o.saved && h("button", { type: "button", class: "linkbtn small", onclick: () => {
        d._chg[key] = false; d[key] = ""; render(); } }, "Anuluj zmianę"));
  }
  return h("div", { class: "field" },
    h("span", {}, label),
    h("div", { class: "secret-saved" },
      h("span", { class: "dots", role: "img", "aria-label": "zapisane, ukryte" }, "••••••••"),
      h("span", { class: "muted small" }, "zapisane"),
      h("button", { type: "button", id: `f-${o.form || "acc"}-${key}-chg`, onclick: () => {
        d._chg[key] = true; render();
        document.getElementById(`f-${o.form || "acc"}-${key}`)?.focus();
      } }, "Zmień")),
    o.hint && h("small", {}, o.hint));
}

function accMsg(name) {
  const m = S.accMsg[name];
  return m && h("p", { class: m.ok ? "ok" : "err" }, m.text);
}

async function accSave(name, method, path, body, after) {
  S.accBusy = name; S.accMsg[name] = null; render();
  try {
    await api(method, path, body);
    delete S.dr[name];
    S.accMsg[name] = { ok: true, text: "Zapisane. Czytniki z włączoną grupą dostaną to przy najbliższej synchronizacji." };
    if (after) after();
  } catch (e) {
    S.accMsg[name] = { ok: false, text: e.message };
  }
  S.accBusy = null;
  refresh();
}

// „Sprawdź połączenie” (TASK-31): serwer loguje się na ZAPISANE konto (nie na to, co jest w formularzu),
// więc przy niezapisanych zmianach komunikat to mówi. Wynik nigdy nie zawiera haseł.
async function accTest(msgKey, path, label, dirty) {
  S.accTesting = path; S.accMsg[msgKey] = null; render();
  try {
    const r = await api("POST", path);
    let text = (label ? label + ": " : "") + r.message;
    if (dirty) text += " Sprawdzono zapisane dane — zmian z formularza jeszcze nie zapisano.";
    S.accMsg[msgKey] = { ok: !!r.ok, text };
  } catch (e) {
    S.accMsg[msgKey] = { ok: false, text: (label ? label + ": " : "") + e.message };
  }
  S.accTesting = null;
  render();
}

function testBtn(msgKey, path, label, dirty, text = "Sprawdź połączenie") {
  const busy = S.accTesting === path;
  return h("button", { type: "button", id: "test" + path.replace(/[^a-z0-9]+/gi, "-"), disabled: !!S.accTesting || S.accBusy === msgKey,
    onclick: () => accTest(msgKey, path, label, typeof dirty === "function" ? dirty() : dirty) }, busy ? "Sprawdzam…" : text);
}

// Zapis na górze, „Usuń konto z czytników” jako link po prawej pod kreską. Usunięcia nie da się cofnąć
// (wartości lecą jako nagrobki, a sekretów przeglądarka nie ma), więc potwierdzenie zostaje.
function accActions(name, o) {
  return h("div", { class: "row endrow" },
    h("button", { class: "primary", type: "submit", disabled: S.accBusy === name }, "Zapisz"),
    o.cur && o.test && testBtn(name, o.test, "", o.dirty),
    h("span", { class: "grow" }),
    o.cur && h("button", { type: "button", class: "linkbtn danger", onclick: () => {
      if (confirm(o.confirm)) accSave(name, "DELETE", o.path);
    } }, "Usuń konto z czytników"));
}

function accountsTab() {
  if (!S.acc) return h("p", { class: "loading" }, "Wczytuję konta…");
  return h("section", {},
    h("div", { class: "card acclist" }, ACCOUNTS.map(accRow)),
    h("p", { class: "muted small acc-foot" }, "Hasła i tokeny nigdy nie wracają do przeglądarki."));
}

function accRow(a) {
  const info = accInfo(a.id), open = S.accOpen === a.id;
  const label = open ? "Zwiń ▴" : info.conf ? "Edytuj ▾" : a.id === "targets" && (S.acc.cloud || []).length ? "Ustaw ▾" : "Dodaj ▾";
  return h("div", { class: "accrow" + (open ? " open" : ""), "data-acc": a.id },
    h("div", { class: "acch" },
      h("span", { class: "hdot " + (info.conf ? "ok" : "na"), "aria-hidden": "true" }),
      h("div", { class: "grow" },
        h("b", {}, a.name), reachBadge(a, info.conf),
        h("div", { class: "muted small" + (info.warn ? " warnline" : "") }, info.sum)),
      h("button", { type: "button", id: "acc-btn-" + a.id, "aria-expanded": String(open), "aria-controls": "acc-body-" + a.id,
        onclick: () => { S.accOpen = open ? null : a.id; render(); } }, label)),
    open && h("div", { class: "accb", id: "acc-body-" + a.id },
      h("p", { class: "muted small" }, a.desc),
      { kosync: kosyncForm, wallabag: wallabagForm, cloud: cloudBody, opds: opdsBody, targets: targetsBody, rosetta: rosettaForm }[a.id]()));
}

function checkboxField(d, key, label) {
  return h("label", { class: "row", style: "font-weight:400" },
    h("input", { type: "checkbox", checked: !!d[key], onchange: ev => { d[key] = ev.target.checked; } }),
    label);
}

function selectField(d, key, label, options) {
  return h("label", { class: "field" },
    h("span", {}, label),
    h("select", { value: String(d[key]), onchange: ev => { d[key] = Number(ev.target.value); } },
      options.map(([val, text]) => h("option", { value: String(val), selected: d[key] === val }, text))));
}

// changedOnly: tylko pola, które użytkownik naprawdę zmienił względem tego,
// co wczytano z GET (d._orig) — reszta zostaje nieobecna w body PUT, więc
// serwer (setXxxPtr/setIntPtr — patrz accounts.go) ich nie rusza. Bez tego
// zapis samego loginu/hasła nadpisałby np. sync_forward wartością domyślną,
// gubiąc realny enum zsynchronizowany z czytnika (TASK-21 poprawka).
function changedOnly(d, keys) {
  const out = {};
  for (const k of keys) {
    if (JSON.stringify(d[k]) !== JSON.stringify(d._orig[k])) out[k] = d[k];
  }
  return out;
}

// Etykiety jak w kosync.koplugin (SYNC_STRATEGY / CHECKSUM_METHOD) — te pola
// to enumy liczbowe, NIE bool/string (patrz komentarz w accounts.go).
const SYNC_STRATEGY_OPTS = [[1, "Pytaj"], [2, "Po cichu"], [3, "Nigdy"]];
const CHECKSUM_METHOD_OPTS = [[0, "Zawartość pliku (binarnie)"], [1, "Nazwa pliku"]];

function kosyncForm() {
  const cur = S.acc.kosync;
  const extraKeys = ["auto_sync", "sync_forward", "sync_backward", "checksum_method"];
  // Braki (null z GET — nieskonfigurowane albo nieoczekiwany typ w stanie)
  // pokazujemy jako domyślne wartości KOReadera, ale _orig też je pamięta w
  // tej postaci, więc dopóki użytkownik nie tknie selecta, nic się nie wyśle.
  const extra = { auto_sync: cur?.auto_sync ?? false, sync_forward: cur?.sync_forward ?? 1,
    sync_backward: cur?.sync_backward ?? 3, checksum_method: cur?.checksum_method ?? 0 };
  const d = draft("kosync", () => ({ server: cur?.server || "", username: cur?.username || "", password: "",
    ...extra, _orig: extra }));
  return h("form", { class: "accform", onsubmit: ev => { ev.preventDefault();
      accSave("kosync", "PUT", "/api/admin/accounts/kosync",
        { server: d.server, username: d.username, password: d.password, ...changedOnly(d, extraKeys) }); } },
    field(d, "server", "Serwer", { form: "ks", placeholder: "puste = serwer KOReadera (sync.koreader.rocks)" }),
    field(d, "username", "Login", { form: "ks" }),
    secretField(d, "password", "Hasło", { form: "ks", saved: cur?.has_password,
      hint: "Serwer zapisze tylko skrót hasła (md5) — tak jak KOReader." }),
    h("details", { class: "help" },
      h("summary", {}, "Więcej opcji"),
      checkboxField(d, "auto_sync", "Automatyczna synchronizacja postępu"),
      selectField(d, "sync_forward", "Przeskok do nowszej pozycji (na innym czytniku przeczytano dalej)", SYNC_STRATEGY_OPTS),
      selectField(d, "sync_backward", "Przeskok do starszej pozycji (na innym czytniku jest wcześniej)", SYNC_STRATEGY_OPTS),
      selectField(d, "checksum_method", "Metoda sumy kontrolnej", CHECKSUM_METHOD_OPTS)),
    accActions("kosync", { cur, test: "/api/admin/accounts/kosync/test",
      dirty: () => !!(d.password || d.username !== (cur?.username || "") || d.server !== (cur?.server || "")),
      path: "/api/admin/accounts/kosync", confirm: "Usunąć konto kosync ze wszystkich czytników?" }),
    accMsg("kosync"));
}

function wallabagForm() {
  const cur = S.acc.wallabag;
  const extraKeys = ["filter_tag", "ignore_tags", "auto_tags", "articles_per_sync",
    "is_delete_finished", "is_delete_read", "is_auto_delete", "send_review_as_tags"];
  const extra = { filter_tag: cur?.filter_tag ?? "", ignore_tags: cur?.ignore_tags ?? "",
    auto_tags: cur?.auto_tags ?? "", articles_per_sync: cur?.articles_per_sync ?? "",
    is_delete_finished: cur?.is_delete_finished ?? false, is_delete_read: cur?.is_delete_read ?? false,
    is_auto_delete: cur?.is_auto_delete ?? false, send_review_as_tags: cur?.send_review_as_tags ?? false };
  const d = draft("wallabag", () => ({ server_url: cur?.server_url || "", client_id: cur?.client_id || "",
    client_secret: "", username: cur?.username || "", password: "", ...extra, _orig: extra }));
  return h("form", { class: "accform", onsubmit: ev => { ev.preventDefault();
      accSave("wallabag", "PUT", "/api/admin/accounts/wallabag",
        { server_url: d.server_url, client_id: d.client_id, client_secret: d.client_secret,
          username: d.username, password: d.password, ...changedOnly(d, extraKeys) }); } },
    field(d, "server_url", "Serwer", { form: "wb", placeholder: "https://app.wallabag.it" }),
    h("div", { class: "grid2" },
      field(d, "client_id", "Client ID", { form: "wb" }),
      secretField(d, "client_secret", "Client secret", { form: "wb", saved: cur?.has_client_secret })),
    h("div", { class: "grid2" },
      field(d, "username", "Login", { form: "wb" }),
      secretField(d, "password", "Hasło", { form: "wb", saved: cur?.has_password })),
    h("details", { class: "help" },
      h("summary", {}, "Więcej opcji"),
      field(d, "filter_tag", "Tag filtrujący", { form: "wb" }),
      field(d, "ignore_tags", "Ignorowane tagi", { form: "wb" }),
      field(d, "auto_tags", "Automatyczne tagi", { form: "wb" }),
      field(d, "articles_per_sync", "Artykułów na synchronizację", { form: "wb" }),
      checkboxField(d, "is_delete_finished", "Usuwaj ukończone"),
      checkboxField(d, "is_delete_read", "Usuwaj przeczytane"),
      checkboxField(d, "is_auto_delete", "Automatyczne usuwanie"),
      checkboxField(d, "send_review_as_tags", "Wysyłaj ocenę jako tagi")),
    accActions("wallabag", { cur, test: "/api/admin/accounts/wallabag/test",
      dirty: () => !!(d.password || d.client_secret || d.username !== (cur?.username || "") || d.client_id !== (cur?.client_id || "")
        || d.server_url !== (cur?.server_url || "")),
      path: "/api/admin/accounts/wallabag", confirm: "Usunąć konto Wallabag ze wszystkich czytników?" }),
    accMsg("wallabag"));
}

const CLOUD_TYPES = { dropbox: "Dropbox", webdav: "WebDAV", ftp: "FTP" };

function cloudBody() {
  const list = S.acc.cloud || [];
  const d = S.dr.cloud;
  return h("div", {},
    S.acc.cloud_error && h("p", { class: "err" }, S.acc.cloud_error),
    list.length === 0 && !d && h("p", { class: "muted" }, "Brak kont. Dodaj pierwsze — albo zsynchronizuj czytnik, który już je ma."),
    list.map((c, i) => h("div", { class: "cloudrow" },
      h("div", { class: "what" },
        h("b", {}, c.name), h("span", { class: "badge" }, CLOUD_TYPES[c.type] || c.type),
        h("div", { class: "muted small" },
          c.type === "dropbox" ? `aplikacja ${c.app_key || "?"}` : [c.address, c.username].filter(Boolean).join(" · "),
          c.folder && ` · folder ${c.folder}`),
        c.broken && h("div", { class: "err small" }, "⚠ Ten czytnik zapisał tylko krótkotrwały token Dropboxa — połącz konto ponownie (Edytuj).")),
      !d && h("div", { class: "row" },
        testBtn("cloud", `/api/admin/accounts/cloud/${i}/test`, c.name, false),
        h("button", { onclick: () => { S.dr.cloud = cloudDraft(c, i); S.accMsg.cloud = null; render(); } }, "Edytuj"),
        h("button", { class: "danger", onclick: () => {
          if (confirm(`Usunąć konto „${c.name}” ze wszystkich czytników?`)) accSave("cloud", "DELETE", `/api/admin/accounts/cloud/${i}`);
        } }, "Usuń")))),
    d ? cloudForm(d, list[d.index])
      : h("div", { class: "row", style: "margin-top:12px" },
          h("button", { onclick: () => { S.dr.cloud = cloudDraft(null, -1); S.accMsg.cloud = null; render(); } }, "+ Dodaj konto")),
    accMsg("cloud"));
}

function cloudDraft(c, i) {
  return { index: i, type: c?.type || "dropbox", name: c?.name || "", folder: c?.folder || "/",
    address: c?.address || "", username: c?.username || "", password: "",
    app_key: c?.app_key || "", app_secret: "", code: "", refresh_token: "", manual: false };
}

function dropboxAuthURL(key) {
  return "https://www.dropbox.com/oauth2/authorize?" + new URLSearchParams({
    client_id: key.trim(), response_type: "code", token_access_type: "offline" });
}

// Stan kroków dodawania konta, liczony ze szkicu: [{done}], a „bieżący” to pierwszy niezrobiony.
function cloudStepState(d, cur) {
  if (d.type !== "dropbox") return [{ done: true }, { done: !!d.address.trim() }];
  const needToken = !cur || !cur.has_password || cur.broken;
  const haveKey = !!d.app_key.trim();
  const haveKeys = haveKey && (!!d.app_secret || !!cur?.has_app_secret);
  const connected = !needToken || !!d.code.trim() || !!d.refresh_token.trim();
  return [{ done: true }, { done: haveKey }, { done: haveKeys }, { done: connected && haveKeys }];
}

// Ustawia ✓/numer i klasę kroków w już zbudowanym formularzu — wołane przy każdym wpisanym znaku,
// bo przerysowanie widoku zabrałoby fokus i połknęło kliknięcie w przycisk obok.
function applyCloudSteps(root, d, cur) {
  const st = cloudStepState(d, cur), now = st.findIndex(x => !x.done);
  root.querySelectorAll("ol.acsteps > li").forEach((li, i) => {
    const x = st[i]; if (!x) return;
    li.className = x.done ? "done" : i === now ? "cur" : "";
    li.querySelector(":scope > b").textContent = x.done ? "✓" : String(i + 1);
    const sr = li.querySelector(".sr"); if (sr) sr.textContent = x.done ? " (zrobione)" : "";
  });
}

// Krok formularza: instrukcja stoi przy kroku, a znacznik (✓ albo numer) ustawia applyCloudSteps.
function cloudStep(n, title, ...kids) {
  return h("li", {}, h("b", { "aria-hidden": "true" }, String(n)),
    h("div", {}, h("b", { class: "st" }, title, h("span", { class: "sr" })), ...kids));
}

function cloudForm(d, cur) {
  const isNew = d.index < 0;
  const dropbox = d.type === "dropbox";
  const steps = [];
  steps.push(cloudStep(1, "Typ konta",
    isNew
      ? h("div", { class: "row", role: "radiogroup", "aria-label": "Typ konta", style: "margin-top:4px" },
          Object.entries(CLOUD_TYPES).map(([t, label]) => h("button", {
            type: "button", role: "radio", "aria-checked": String(d.type === t),
            class: d.type === t ? "primary" : "", onclick: () => { d.type = t; render(); },
          }, label)))
      : h("p", { class: "muted small" }, CLOUD_TYPES[d.type] || d.type)));
  if (dropbox) {
    const needToken = !cur || !cur.has_password || cur.broken;
    steps.push(cloudStep(2, "Utwórz aplikację w Dropboxie",
      h("small", { class: "stsub" },
        "Otwórz ", h("a", { href: "https://www.dropbox.com/developers/apps", target: "_blank", rel: "noopener" }, "dropbox.com/developers/apps"),
        " → Create app → Scoped access → App folder → dowolna nazwa (np. „koreader-twoje-imie”). W zakładce Permissions zaznacz files.metadata.read, files.content.read i files.content.write, potem Submit. Masz już aplikację dla KOReadera? Użyj tej samej — czytniki zobaczą te same pliki.")));
    steps.push(cloudStep(3, "Wpisz App key i App secret",
      h("small", { class: "stsub" }, "Z zakładki Settings aplikacji."),
      h("div", { class: "grid2" },
        field(d, "app_key", "App key", { form: "cl" }),
        secretField(d, "app_secret", "App secret", { form: "cl", saved: cur?.has_app_secret }))));
    steps.push(cloudStep(4, needToken ? "Połącz z Dropboxem" : "Połączenie z Dropboxem",
      !needToken && h("small", { class: "stsub" }, "Konto jest połączone. Połącz ponownie tylko, jeśli czytniki zgłaszają błąd logowania."),
      h("div", { class: "row" },
        h("button", { type: "button", disabled: !d.app_key.trim(), id: "f-cl-open", onclick: () => window.open(dropboxAuthURL(d.app_key), "_blank", "noopener") },
          "1. Otwórz Dropbox i kliknij „Zezwól”"),
        h("input", { id: "f-cl-code", type: "text", value: d.code, placeholder: "2. wklej kod z Dropboxa", autocomplete: "off",
          "aria-label": "Kod z Dropboxa", style: "flex:1;min-width:200px", oninput: ev => { d.code = ev.target.value; } })),
      h("small", { class: "stsub" }, "Kod działa raz i tylko kilka minut — zapisz konto zaraz po wklejeniu. ",
        h("a", { href: "#", onclick: ev => { ev.preventDefault(); d.manual = !d.manual; render(); } },
          d.manual ? "Ukryj pole refresh tokenu" : "Mam już refresh token")),
      d.manual && field(d, "refresh_token", "Refresh token", { form: "cl", type: "password" })));
  } else {
    steps.push(cloudStep(2, "Adres i dane logowania",
      field(d, "address", "Adres", { form: "cl", placeholder: d.type === "webdav" ? "https://app.koofr.net/dav/Koofr" : "ftp://example.com" }),
      h("div", { class: "grid2" },
        field(d, "username", "Login", { form: "cl" }),
        secretField(d, "password", "Hasło", { form: "cl", saved: cur?.has_password }))));
  }
  const form = h("form", { class: "subform", onsubmit: ev => { ev.preventDefault();
      accSave("cloud", "POST", "/api/admin/accounts/cloud", d); },
      // przycisk „Otwórz Dropbox” odblokowuje się, gdy jest App key — bez przerysowania
      oninput: ev => {
        applyCloudSteps(ev.currentTarget, d, cur);
        const open = ev.currentTarget.querySelector("#f-cl-open"); if (open) open.disabled = !d.app_key.trim();
      } },
    h("h4", {}, isNew ? "Nowe konto" : `Edycja: ${cur?.name}`),
    h("ol", { class: "acsteps" }, steps),
    field(d, "name", "Nazwa", { form: "cl", placeholder: dropbox ? "Dropbox" : "np. Koofr",
      hint: "Tak konto będzie się nazywać w menu Chmura na czytnikach." }),
    field(d, "folder", "Folder startowy", { form: "cl", placeholder: "/", hint: "Gdzie czytnik otworzy to konto w menu Chmura." }),
    h("div", { class: "row" },
      h("button", { class: "primary", type: "submit", disabled: S.accBusy === "cloud" },
        S.accBusy === "cloud" ? "Zapisuję…" : "Zapisz konto"),
      h("button", { type: "button", onclick: () => { delete S.dr.cloud; S.accMsg.cloud = null; render(); } }, "Anuluj")));
  applyCloudSteps(form, d, cur);
  return form;
}

// Katalogi OPDS (TASK-48): prosta lista + formularz nazwa/adres/login/hasło. Pola, których tu nie ma
// (raw_names, sync, sync_dir…), serwer zostawia w zapisanym wpisie bez zmian.
function opdsBody() {
  const list = S.acc.opds || [];
  const d = S.dr.opds;
  return h("div", {},
    S.acc.opds_error && h("p", { class: "err" }, S.acc.opds_error),
    list.length === 0 && !d && h("p", { class: "muted" }, "Brak katalogów. Dodaj pierwszy — albo zsynchronizuj czytnik, który już je ma."),
    list.map((o, i) => h("div", { class: "cloudrow" },
      h("div", { class: "what" },
        h("b", {}, o.title),
        h("div", { class: "muted small" }, [hostOf(o.url), o.username].filter(Boolean).join(" · "))),
      !d && h("div", { class: "row" },
        h("button", { onclick: () => { S.dr.opds = opdsDraft(o, i); S.accMsg.opds = null; render(); } }, "Edytuj"),
        h("button", { class: "danger", onclick: () => {
          if (confirm(`Usunąć katalog „${o.title}” ze wszystkich czytników?`)) accSave("opds", "DELETE", `/api/admin/accounts/opds/${i}`);
        } }, "Usuń")))),
    d ? opdsForm(d, list[d.index])
      : h("div", { class: "row", style: "margin-top:12px" },
          h("button", { onclick: () => { S.dr.opds = opdsDraft(null, -1); S.accMsg.opds = null; render(); } }, "+ Dodaj katalog")),
    accMsg("opds"));
}

function opdsDraft(o, i) {
  return { index: i, title: o?.title || "", url: o?.url || "", username: o?.username || "", password: "" };
}

function opdsForm(d, cur) {
  const isNew = d.index < 0;
  return h("form", { class: "subform", onsubmit: ev => { ev.preventDefault();
      accSave("opds", "POST", "/api/admin/accounts/opds", d); } },
    h("h4", {}, isNew ? "Nowy katalog" : `Edycja: ${cur?.title}`),
    field(d, "title", "Nazwa", { form: "op", placeholder: "np. Calibre",
      hint: "Tak katalog będzie się nazywać w menu OPDS na czytnikach." }),
    field(d, "url", "Adres katalogu", { form: "op", placeholder: "https://calibre.example.com/opds",
      hint: "Adres http:// albo https://. Bez przedrostka KOReader też dopisuje http://." }),
    h("div", { class: "grid2" },
      field(d, "username", "Login", { form: "op", hint: "Zostaw puste, jeśli katalog nie wymaga logowania." }),
      secretField(d, "password", "Hasło", { form: "op", saved: cur?.has_password,
        hint: "Po wyczyszczeniu loginu hasło też jest usuwane." })),
    h("div", { class: "row" },
      h("button", { class: "primary", type: "submit", disabled: S.accBusy === "opds" },
        S.accBusy === "opds" ? "Zapisuję…" : "Zapisz katalog"),
      h("button", { type: "button", onclick: () => { delete S.dr.opds; S.accMsg.opds = null; render(); } }, "Anuluj")));
}

const TARGETS = [
  ["statystyki", "Statystyki czytania", "Wspólna baza statystyk (czas czytania, strony, kalendarz)."],
  ["slowniczek", "Słowniczek", "Wspólna lista słówek do powtórek (w KOReaderze: Kreator słownictwa)."],
];

function targetDraft(which) {
  const cur = S.acc.targets?.[which];
  const on = !!cur, account = cur && cur.account >= 0 ? cur.account : 0, folder = cur?.folder || "";
  return draft("t-" + which, () => ({ on, account, folder, _orig: { on, account, folder } }));
}

function targetDirty(d) {
  return d.on !== d._orig.on || (d.on && (Number(d.account) !== Number(d._orig.account) || d.folder !== d._orig.folder));
}

// Statystyki i słowniczek zapisują się osobno (dwie trasy, PUT albo DELETE przy wyłączeniu), ale jednym
// przyciskiem: wysyłamy tylko to, co się zmieniło. Błąd jednego nie blokuje drugiego.
async function targetsSave() {
  S.accBusy = "targets"; S.accMsg.targets = null; render();
  const errs = [];
  for (const [which, label] of TARGETS) {
    const d = S.dr["t-" + which];
    if (!d || !targetDirty(d)) continue;
    try {
      if (d.on) await api("PUT", `/api/admin/accounts/target/${which}`, { account: Number(d.account), folder: d.folder });
      else await api("DELETE", `/api/admin/accounts/target/${which}`);
      delete S.dr["t-" + which];
    } catch (e) { errs.push(`${label}: ${e.message}`); }
  }
  S.accMsg.targets = errs.length ? { ok: false, text: errs.join(" · ") }
    : { ok: true, text: "Zapisane. Czytniki z włączoną grupą dostaną to przy najbliższej synchronizacji." };
  S.accBusy = null;
  refresh();
}

// Pisanie w polu folderu nie przerysowuje widoku (zgubiłoby kursor) — tylko włącza „Zapisz zmiany”.
function targetsDirtyUI(form, ds) {
  const b = form?.querySelector("button.primary");
  if (b) b.disabled = !ds.some(targetDirty);
}

function targetsBody() {
  const list = S.acc.cloud || [];
  if (list.length === 0) {
    return h("p", { class: "muted" }, "Najpierw dodaj konto w chmurze — to na nim będą leżeć wspólne pliki. ",
      h("button", { type: "button", class: "linkbtn", onclick: () => { S.accOpen = "cloud"; render(); } }, "Przejdź do kont w chmurze"));
  }
  const ds = TARGETS.map(([which]) => targetDraft(which));
  const dirty = ds.some(targetDirty);
  return h("form", { class: "accform", onsubmit: ev => { ev.preventDefault(); targetsSave(); } },
    h("ol", { class: "steps tgsteps" },
      h("li", {}, h("b", {}, "Wybierz, co ma być wspólne. "),
        "Włącz statystyki i/lub słowniczek, wskaż konto i folder. Folder ma być ten sam dla wszystkich czytników (np. /koreader) i najlepiej już istnieć na koncie."),
      h("li", {}, h("b", {}, "Zapisz. "),
        "Czytniki z włączoną grupą „Synchronizacja statystyk i słowniczka” dostaną ustawienie przy najbliższej synchronizacji koligilo (Menu → Narzędzia → koligilo → Synchronizuj teraz)."),
      h("li", {}, h("b", {}, "Na czytniku włącz scalanie. "),
        "KOReader sam z siebie nie scala tych baz. Najprościej raz na każdym czytniku zaznaczyć w menu koligilo (Zgody) „Scalaj statystyki i słowniczek po synchronizacji” — wtedy dzieje się to po każdej synchronizacji. Ręcznie: Statystyki czytania → Synchronizuj teraz oraz Kreator słownictwa → Synchronizacja w chmurze → Synchronizuj teraz (albo gest „Statystyki czytania: synchronizuj”).")),
    TARGETS.map(([which, label, desc], i) => {
      const d = ds[i], cur = S.acc.targets?.[which];
      return h("div", { class: "tgl" + (d.on ? "" : " off") },
        switchCtl(label, d.on, on => { d.on = on; render(); }, "t-" + which),
        h("div", { class: "what" }, h("b", {}, label), h("div", { class: "muted small" }, desc),
          cur?.account < 0 && h("div", { class: "err small" }, "Zapisane konto nie ma już odpowiednika na liście — wybierz konto i zapisz."),
          cur?.broken && h("div", { class: "err small" }, "⚠ Zapisany jest krótkotrwały token — wybierz konto ponownie i zapisz.")),
        h("div", { class: "tgfields" },
          h("label", { class: "tgf" }, h("span", {}, "Konto w chmurze"),
            h("select", { disabled: !d.on, onchange: ev => { d.account = ev.target.value; targetsDirtyUI(ev.target.form, ds); } },
              list.map((c, j) => h("option", { value: j, selected: Number(d.account) === j || undefined }, `${c.name} (${CLOUD_TYPES[c.type] || c.type})`)))),
          h("label", { class: "tgf" }, h("span", {}, "Folder na koncie"),
            h("input", { id: `f-t-${which}`, type: "text", value: d.folder, placeholder: "np. /koreader", disabled: !d.on,
              autocomplete: "off", spellcheck: "false", oninput: ev => { d.folder = ev.target.value; targetsDirtyUI(ev.target.form, ds); } })),
          // TASK-51: serwer sprawdza ZAPISANY cel (konto i folder), nie to, co jest w polach
          d.on && cur && h("div", { class: "tgtest" },
            testBtn("targets", `/api/admin/accounts/target/${which}/test`, label, () => targetDirty(d), "Sprawdź folder"))));
    }),
    h("div", { class: "row", style: "margin-top:10px" },
      h("button", { class: "primary", type: "submit", disabled: !dirty || S.accBusy === "targets" },
        S.accBusy === "targets" ? "Zapisuję…" : "Zapisz zmiany"),
      h("span", { class: "muted small" }, "Wyłączony przełącznik usuwa ustawienie z czytników; zapisane na koncie pliki zostają.")),
    accMsg("targets"));
}

// Gotowe adresy dostawców zgodnych z OpenAI (Rosetta wysyła zapytanie w formacie chat/completions
// z nagłówkiem Bearer). Przycisk tylko wpisuje adres i przykładowy model do pól — dalej trzeba zapisać.
const ROSETTA_PRESETS = [
  { name: "OpenRouter", url: "https://openrouter.ai/api/v1/chat/completions", model: "google/gemini-2.5-flash" },
  { name: "OpenAI", url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" },
];

function rosettaForm() {
  const cur = S.acc.rosetta;
  const extraKeys = ["ai_base_url", "ai_model", "ai_max_tokens", "ai_temperature"];
  const extra = { ai_base_url: cur?.ai_base_url ?? "", ai_model: cur?.ai_model ?? "",
    ai_max_tokens: cur?.ai_max_tokens ?? "", ai_temperature: cur?.ai_temperature ?? "" };
  const d = draft("rosetta", () => ({ ...extra, _orig: extra, api_key: "" }));
  return h("form", { class: "accform", onsubmit: ev => { ev.preventDefault();
      accSave("rosetta", "PUT", "/api/admin/accounts/rosetta", { ...changedOnly(d, extraKeys), api_key: d.api_key }); } },
    h("div", { class: "row rpresets" },
      h("span", { class: "muted small" }, "Szybki start:"),
      ROSETTA_PRESETS.map(p => h("button", { type: "button", onclick: () => { d.ai_base_url = p.url; d.ai_model = p.model; render(); } }, p.name)),
      h("span", { class: "muted small" }, "wpisuje adres i przykładowy model — klucz zdobywasz u dostawcy.")),
    field(d, "ai_base_url", "Adres API", { form: "ro", placeholder: "https://openrouter.ai/api/v1/chat/completions",
      hint: "Pełny adres, który kończy się na /chat/completions. Zadziała każdy dostawca zgodny z OpenAI. Puste = OpenRouter." }),
    field(d, "ai_model", "Model", { form: "ro", placeholder: "google/gemini-2.5-flash",
      hint: "Nazwa modelu dokładnie tak, jak podaje ją dostawca. Puste = google/gemini-2.5-flash." }),
    secretField(d, "api_key", "Klucz API", { form: "ro", saved: cur?.has_api_key,
      hint: "Klucz z konta u dostawcy. Trafia na czytniki, które mają włączoną grupę „Rosetta — klucze API”." }),
    h("details", { class: "rmore" },
      h("summary", {}, "Więcej opcji (zwykle zostaw puste)"),
      h("div", { class: "grid2" },
        field(d, "ai_max_tokens", "Limit tokenów", { form: "ro", placeholder: "4096",
          hint: "Najdłuższa odpowiedź modelu. Przy długich stronach podnieś." }),
        field(d, "ai_temperature", "Temperatura", { form: "ro", placeholder: "0.3",
          hint: "0–2. Niska wartość to wierniejszy, mniej „kreatywny” przekład." }))),
    accActions("rosetta", { cur, test: "/api/admin/accounts/rosetta/test",
      dirty: () => !!d.api_key || Object.keys(changedOnly(d, extraKeys)).length > 0,
      path: "/api/admin/accounts/rosetta", confirm: "Usunąć klucze API Rosetty ze wszystkich czytników?" }),
    h("p", { class: "muted small" }, "Język tłumaczenia, wybór Google/AI i wygląd panelu ustawiasz w ",
      h("button", { type: "button", class: "linkbtn", onclick: () => { S.plugView = PLUGSET; showTab("wtyczki"); } }, "Wtyczki → Ustawienia wtyczek → Rosetta"), "."),
    accMsg("rosetta"));
}

// ------------------------------------------------ zakładka: ustawienia czytników (dawne „wspólne”)

// Literały Lua: luaQuote/luaSerialize/luaParse są w web/lua.js (lustro
// Sync.serialize, test: tests/luaser_test.js). Edytor surowy („Zaawansowane”)
// dla tabel przyjmuje literał wpisany wprost — waliduje go serwer.

// Zwraca napis albo null, jeśli literał nie jest prostym cytowanym napisem
// (np. ma nieznaną sekwencję ucieczki) — wtedy edytor spada na tryb surowy.
function luaUnquoteString(lit) {
  if (typeof lit !== "string" || lit.length < 2 || lit[0] !== '"' || lit[lit.length - 1] !== '"') return null;
  const inner = lit.slice(1, -1);
  let out = "", i = 0;
  while (i < inner.length) {
    const c = inner[i];
    if (c !== "\\") { out += c; i++; continue; }
    const e = inner[i + 1];
    if (e === "n") { out += "\n"; i += 2; }
    else if (e === "r") { out += "\r"; i += 2; }
    else if (e === "t") { out += "\t"; i += 2; }
    else if (e === '"' || e === "\\") { out += e; i += 2; }
    else if (e >= "0" && e <= "9") {
      let j = i + 1, k = 0;
      while (j < inner.length && k < 3 && inner[j] >= "0" && inner[j] <= "9") { j++; k++; }
      out += String.fromCharCode(parseInt(inner.slice(i + 1, j), 10));
      i = j;
    } else return null;
  }
  return out;
}

const NUM_RE = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

function detectType(literal) {
  if (literal === "true" || literal === "false") return "bool";
  if (literal[0] === '"') return "string";
  if (NUM_RE.test(literal)) return "number";
  return "raw"; // tabela albo coś, czego edytor prostych pól nie rozumie
}

function catalogGroup(id) {
  return S.state.catalog.find(g => g.id === id);
}

function valMsgFor(id) {
  const m = S.valMsg[id];
  return m && h("p", { class: (m.ok ? "ok" : "err") + " small" }, m.text);
}

// --- edycja/usunięcie istniejącej wartości ---

async function valEdit(v) {
  const g = catalogGroup(v.group);
  if (g && g.secret) {
    // Hasła nigdy nie wracają do przeglądarki — pole startuje puste.
    S.valDrafts[v.id] = { type: "string", text: "", error: null, isNew: false, secret: true };
    return render();
  }
  S.valBusy = v.id; render();
  try {
    const full = await api("GET", "/api/admin/values/" + encodeURIComponent(v.id));
    const t = detectType(full.value);
    let text = full.value;
    let type = t;
    if (t === "string") {
      const s = luaUnquoteString(full.value);
      if (s == null) type = "raw"; else text = s;
    }
    S.valDrafts[v.id] = { type, text, bool: full.value === "true", error: null, isNew: false };
  } catch (e) {
    S.valMsg[v.id] = { ok: false, text: e.message };
  }
  S.valBusy = null; render();
}

function valCancel(id) {
  delete S.valDrafts[id];
  render();
}

function draftLiteral(d) {
  if (d.type === "bool") return d.bool ? "true" : "false";
  if (d.type === "number") return d.text.trim();
  if (d.type === "string") return luaQuote(d.text);
  return d.text; // raw — literał wpisany wprost, waliduje serwer
}

async function valSave(id, d) {
  const literal = draftLiteral(d);
  S.valBusy = id; d.error = null; render();
  try {
    await api("POST", "/api/admin/values", { set: { [id]: literal } });
    delete S.valDrafts[id];
    delete S.valNew[groupOfId(id)];
    S.valMsg[id] = { ok: true, text: "Zapisane. Czytniki z włączoną grupą dostaną to przy najbliższej synchronizacji." };
  } catch (e) {
    d.error = e.message; // zostaw wpisany tekst — użytkownik nie traci pracy
  }
  S.valBusy = null; refresh();
}

async function valDelete(id) {
  if (!confirm(`Usunąć tę wartość (${id})?\n\nPozostałe urządzenia też ją usuną przy najbliższej synchronizacji.`)) return;
  S.valBusy = id; render();
  try { await api("POST", "/api/admin/values", { delete: [id] }); delete S.valDrafts[id]; }
  catch (e) { S.valMsg[id] = { ok: false, text: e.message }; }
  S.valBusy = null; refresh();
}

function groupOfId(id) {
  const g = S.state.catalog.find(g => g.entries.some(e => e.key != null ? id === e.file + "|" + e.key
    : id.startsWith(e.file + "#") && (id.slice(e.file.length + 1).startsWith(e.prefix || ""))));
  return g && g.id;
}

// Edytor prostego/surowego literału — wspólny dla edycji i dodawania.
function valueEditor(id, d, onSave) {
  const typeSelect = !d.secret && h("select", { "aria-label": "Typ wartości", value: d.type,
    onchange: ev => { d.type = ev.target.value; render(); } },
    ["string", "number", "bool", "raw"].map(t => h("option", { value: t, selected: d.type === t },
      { string: "tekst", number: "liczba", bool: "prawda/fałsz", raw: "tabela (literał Lua)" }[t])));
  let field;
  if (d.secret) {
    field = h("input", { type: "password", autocomplete: "new-password", value: d.text,
      placeholder: "nowa wartość — zostaw puste, żeby anulować",
      oninput: ev => { d.text = ev.target.value; } });
  } else if (d.type === "bool") {
    field = h("label", { class: "row", style: "font-weight:400" },
      h("input", { type: "checkbox", checked: d.bool, onchange: ev => { d.bool = ev.target.checked; } }),
      d.bool ? "prawda" : "fałsz");
  } else if (d.type === "raw") {
    field = h("textarea", { rows: 4, style: "width:100%;font-family:var(--mono);font-size:12.5px",
      oninput: ev => { d.text = ev.target.value; } }, d.text);
  } else {
    field = h("input", { type: "text", inputmode: d.type === "number" ? "decimal" : undefined,
      value: d.text, oninput: ev => { d.text = ev.target.value; } });
  }
  return h("div", { class: "valedit" },
    typeSelect,
    field,
    h("div", { class: "row", style: "margin-top:8px" },
      h("button", { class: "primary", disabled: S.valBusy === id, onclick: () => onSave(d) },
        S.valBusy === id ? "Zapisuję…" : "Zapisz"),
      h("button", { type: "button", onclick: () => { delete S.valDrafts[id]; delete S.valNew[groupOfId(id) || id]; render(); } }, "Anuluj")),
    d.error && h("p", { class: "err small" }, d.error));
}

function valueRow(v) {
  const [file, key] = v.id.includes("|") ? v.id.split("|") : v.id.split("#");
  const d = S.valDrafts[v.id];
  return h("div", { class: "vrow" + (v.deleted ? " deleted" : "") },
    h("div", { class: "k" }, h("span", { class: "f" }, file), key),
    h("div", {},
      d
        ? valueEditor(v.id, d, dd => valSave(v.id, dd))
        : h("div", {},
            h("pre", {}, v.deleted ? "(usunięte)" : v.preview),
            h("div", { class: "meta" }, `z: ${v.from || "urządzenia, które już usunięto"} · ${ago(v.t)}`),
            h("div", { class: "row", style: "margin-top:6px" },
              h("button", { disabled: S.valBusy === v.id, onclick: () => valEdit(v) },
                S.valBusy === v.id ? "Wczytuję…" : (v.deleted ? "Przywróć / ustaw od nowa" : "Edytuj")),
              !v.deleted && h("button", { class: "danger", disabled: S.valBusy === v.id, onclick: () => valDelete(v.id) }, "Usuń")),
            valMsgFor(v.id))));
}

// --- dodawanie nowej wartości dla ID z katalogu, którego jeszcze nie ma ---

function missingKeys(g, activeIds) {
  return g.entries.filter(e => e.key != null && !activeIds.has(e.file + "|" + e.key));
}

function addKeyButton(g, e) {
  const id = e.file + "|" + e.key;
  return h("button", { onclick: () => {
    S.valDrafts[id] = { type: "string", text: "", error: null, isNew: true, secret: !!g.secret };
    render();
  } }, `+ ${e.key}`);
}

function newPrefixForm(g) {
  const d = S.valNew[g.id] || (S.valNew[g.id] = { key: "", type: "string", text: "", bool: false, error: null });
  const prefixEntry = g.entries.find(e => e.prefix != null);
  if (!prefixEntry) return null;
  const id = prefixEntry.file + "#" + d.key.trim();
  return h("div", { class: "newval" },
    h("div", { class: "row" },
      h("input", { type: "text", placeholder: "nazwa klucza (np. copt_status_line)", value: d.key,
        oninput: ev => { d.key = ev.target.value; } })),
    d.key.trim() && valueEditor(id, d, dd => {
      if (!dd.key.trim()) { dd.error = "podaj nazwę klucza"; render(); return; }
      valSave(id, dd);
    }));
}

// Surowy widok (dawny edytor literałów) — w „Zaawansowane”, zwinięty domyślnie.
function advancedValues(catalog, values) {
  const byGroup = new Map(catalog.map(g => [g.id, []]));
  for (const v of values) (byGroup.get(v.group) || byGroup.set(v.group, []).get(v.group)).push(v);
  const activeIds = new Set(values.filter(v => !v.deleted).map(v => v.id));
  const relevant = catalog.filter(g => byGroup.get(g.id).length || missingKeys(g, activeIds).length || g.entries.some(e => e.prefix != null));
  return relevant.map(g => {
    const missing = missingKeys(g, activeIds);
    return h("div", { class: "card vgroup" },
      h("h3", {}, g.name),
      byGroup.get(g.id).map(valueRow),
      missing.length > 0 && h("div", { class: "row", style: "margin-top:10px" }, missing.map(e => addKeyButton(g, e))),
      g.entries.some(e => e.prefix != null) && newPrefixForm(g));
  });
}

// ------------------------------------------------ ustawienia po ludzku (TASK-22)
//
// Mapa KO (web/koreader_opts.js, generowana z KOReadera przypiętego do tagu)
// mówi, jak KOReader nazywa klucz, jakie ma presety i zakresy. Kontrolka
// buduje wartość JS, a zapis idzie WYŁĄCZNIE przez luaSerialize (web/lua.js),
// żeby literał był bajt w bajt taki jak Sync.serialize na czytniku.

// ID wartości dla (plik, klucz) wg katalogu — null, gdy klucz nie jest synchronizowany
// albo należy do grupy z danymi logowania (te żyją w „Konta”).
function idFor(file, key) {
  for (const g of S.state.catalog) {
    if (g.secret) continue;
    for (const e of g.entries) {
      if (e.file !== file) continue;
      if (e.key != null && e.key === key) return file + "|" + key;
      if (e.prefix != null && e.key == null && key.startsWith(e.prefix) && !(e.except || []).includes(key)) return file + "#" + key;
    }
  }
  return null;
}

const PREVIEW_MAX = 400; // serwer przycina podgląd do 400 znaków (clip w store.go)
const clipped = v => Array.from(v.preview || "").length >= PREVIEW_MAX;

// Pełne literały dla podanych (znanych) kluczy, których podgląd jest przycięty.
async function valLoadFor(known) {
  for (const v of S.state.values) {
    if (v.deleted || !known.has(v.id) || !clipped(v) || S.valFull[v.id]?.t === v.t) continue;
    try { S.valFull[v.id] = { t: v.t, lit: (await api("GET", "/api/admin/values/" + encodeURIComponent(v.id))).value }; }
    catch { /* zostaje „wczytuję” — spróbujemy przy następnym odświeżeniu */ }
  }
}

// Widok „Ustawienia czytników”: klucze znane mapie KOReadera (np. stopka).
async function valLoadFull() {
  if (typeof KO === "undefined") return;
  await valLoadFor(new Set(KO.opts.map(o => idFor(o.file, o.key)).filter(Boolean)));
}

// Wtyczki → „Ustawienia wtyczek”: padmap KOPada bywa dłuższy niż podgląd (400 znaków).
async function padLoadFull() {
  if (typeof Padmap !== "undefined") await valLoadFor(new Set([Padmap.ID]));
}

// Aktualna wartość jako obiekt JS: {state: "absent"|"loading"|"ok"|"bad", value}
function currentValue(v) {
  if (!v || v.deleted) return { state: "absent" };
  let lit = v.preview;
  if (clipped(v)) {
    if (S.valFull[v.id]?.t !== v.t) return { state: "loading" };
    lit = S.valFull[v.id].lit;
  }
  try { return { state: "ok", value: luaParse(lit) }; } catch { return { state: "bad" }; }
}

async function ctlSave(id, value, focusKey) {
  let literal;
  try { literal = luaSerialize(value); } catch (e) { S.valMsg[id] = { ok: false, text: e.message }; return render(); }
  S.valBusy = id; render();
  try {
    await api("POST", "/api/admin/values", { set: { [id]: literal } });
    const lack = devLacking(id, S.state.devices);
    S.valMsg[id] = { ok: true, text: lack.length
      ? `Zapisane — ale ${lack.map(d => d.name).join(", ")} ${lack.length > 1 ? "nie dostaną" : "nie dostanie"} tego (grupa wyłączona).${lack.length < S.state.devices.length ? " Pozostałe czytniki dostaną to przy najbliższej synchronizacji." : ""}`
      : "Zapisane — czytniki dostaną to przy najbliższej synchronizacji." };
    pvCand(id, undefined);
    for (const k of Object.keys(S.ctl)) if (k === id || k.startsWith(id + "~")) delete S.ctl[k];
  } catch (e) {
    S.valMsg[id] = { ok: false, text: e.message };
  }
  S.valBusy = null;
  await refresh();
  if (focusKey) app.querySelector(`[data-fk="${CSS.escape(focusKey)}"]`)?.focus();
}

async function ctlReset(id, label) {
  if (!confirm(`Usunąć wspólną wartość „${label}”?\n\nCzytniki usuną ją u siebie i wrócą do ustawienia domyślnego KOReadera.`)) return;
  S.valBusy = id; render();
  try { await api("POST", "/api/admin/values", { delete: [id] }); delete S.valMsg[id]; }
  catch (e) { S.valMsg[id] = { ok: false, text: e.message }; }
  S.valBusy = null; refresh();
}

// Zaznaczenie wiersza (klik/fokus) otwiera panel podglądu strony (TASK-23).
// Klasę zmieniamy w miejscu: pełne render() zabrałoby fokus klawiaturze.
function valSelect(id) {
  if (S.valSel !== id) {
    S.valSel = id;
    for (const el of app.querySelectorAll(".srow")) el.classList.toggle("sel", el.dataset.id === id);
  }
  pvOpen(id);
}

// ------------------------------------------------ podgląd strony (TASK-23)

// sekcje mapy, które zmieniają wygląd strony (listy plików i statystyki — nie)
const PV_SECTIONS = new Set(["font", "layout", "doc", "tweaks", "footer"]);

// Aktualne wspólne wartości znanych opcji (klucz KOReadera → wartość JS);
// brak klucza = podgląd weźmie domyślne KOReadera.
function pvSettings() {
  const out = {};
  if (typeof KO === "undefined" || !S.state) return out;
  const byId = new Map(S.state.values.map(v => [v.id, v]));
  for (const o of KO.opts) {
    const id = idFor(o.file, o.key);
    const cv = id ? currentValue(byId.get(id)) : { state: "absent" };
    if (cv.state === "ok") out[o.key] = cv.value;
  }
  return out;
}

const PV_WIDE = window.matchMedia("(min-width: 1101px)");
PV_WIDE.addEventListener("change", () => { if (S.tab === "wspolne") render(); });

// Ustawienie, na którym podgląd startuje: ostatnio zaznaczone, a bez niego „Rozmiar czcionki”.
function pvOpenDefault() {
  if (typeof KO === "undefined") return;
  const o = KO.opts.find(x => S.valSel && idFor(x.file, x.key) === S.valSel && PV_SECTIONS.has(x.section))
    || KO.opts.find(x => x.key === "copt_font_size");
  const id = o && idFor(o.file, o.key);
  if (id) Preview.open({ id, key: o.key, label: o.label, settings: pvSettings(), devices: S.state.devices });
}

function pvOpen(id) {
  if (typeof Preview === "undefined" || typeof KO === "undefined" || !S.state || !PV_WIDE.matches) return;
  const o = KO.opts.find(x => idFor(x.file, x.key) === id);
  if (!o || !PV_SECTIONS.has(o.section)) return;
  if (Preview.isOpen() && Preview.current() === id) return;
  Preview.open({ id, key: o.key, label: o.label, settings: pvSettings(), devices: S.state.devices });
}

// wartość „po” przed zapisem: najechanie/fokus na preset, wpisywanie; undefined = brak
function pvCand(id, value) { if (typeof Preview !== "undefined") Preview.candidate(id, value); }
const pvHover = (id, value) => ({ onmouseenter: () => pvCand(id, value), onmouseleave: () => pvCand(id, undefined) });

const fmtNum = (n, unit) => (typeof n === "number" ? String(n).replace(".", ",") : String(n)) + (unit ? " " + unit : "");
function fmtValue(o, x) {
  const i = (o.values || []).findIndex(p => luaSame(p, x));
  if (i >= 0) return o.labels[i];
  const l = luaList(x);
  if (l) return l.map(n => fmtNum(n)).join(" / ") + (o.unit ? " " + o.unit : "");
  return typeof x === "number" ? fmtNum(x, o.unit) : String(x);
}

// Przyciski segmentowe (role=radiogroup): strzałki przesuwają fokus, Spacja/Enter wybiera.
function segmented(o, id, cur, disabled) {
  const idx = o.values.findIndex(p => luaSame(p, cur));
  const focusIdx = idx >= 0 ? idx : 0;
  return h("div", { class: "seg", role: "radiogroup", "aria-label": o.label },
    o.values.map((p, i) => h("button", {
      type: "button", role: "radio", "aria-checked": String(i === idx), disabled,
      tabindex: i === focusIdx ? "0" : "-1", "data-fk": id + "#" + i, ...pvHover(id, p),
      onfocus: () => { valSelect(id); pvCand(id, p); }, onblur: () => pvCand(id, undefined),
      title: o.unit && !o.labels[i].includes(o.unit) ? o.labels[i] + " " + o.unit : null,
      onclick: () => { if (i !== idx) ctlSave(id, p, id + "#" + i); },
      onkeydown: ev => {
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
        if (!d) return;
        ev.preventDefault();
        const sib = ev.currentTarget.parentNode.children;
        sib[(i + d + sib.length) % sib.length].focus();
      },
    }, o.labels[i])));
}

function numField(id, part, spec, cur, label, onval) {
  const k = id + "~" + part;
  const text = S.ctl[k] ?? (cur == null ? "" : String(cur));
  return h("label", { class: "num" },
    label && h("span", {}, label),
    h("input", { type: "number", inputmode: "decimal", min: spec.min, max: spec.max, step: spec.step || "any",
      value: text, "data-fk": k, "aria-label": label || "Wartość",
      oninput: ev => { S.ctl[k] = ev.target.value; if (onval) onval(); } }),
    spec.unit && h("span", { class: "unit" }, spec.unit));
}

function numValue(text, spec) {
  const n = Number(String(text).replace(",", "."));
  if (String(text).trim() === "" || !Number.isFinite(n)) return { err: "wpisz liczbę" };
  if (spec.min != null && n < spec.min) return { err: `najmniej ${spec.min}` };
  if (spec.max != null && n > spec.max) return { err: `najwięcej ${spec.max}` };
  return { n };
}

// Własna wartość spoza presetów (more_options w KOReaderze): liczba albo para lewo/prawo.
function customEditor(o, id, cur, disabled) {
  const c = o.custom;
  const pair = c.pair ? (luaList(cur) || luaList(o.default) || []) : null;
  // na żywo w podglądzie, póki liczba mieści się w zakresie
  const live = () => {
    if (c.pair) {
      const a = numValue(S.ctl[id + "~l"] ?? pair[0], c.left), b = numValue(S.ctl[id + "~r"] ?? pair[1], c.right);
      return pvCand(id, a.err || b.err ? undefined : [a.n, b.n]);
    }
    const a = numValue(S.ctl[id + "~v"] ?? cur, c);
    pvCand(id, a.err ? undefined : a.n);
  };
  const save = () => {
    if (c.pair) {
      const a = numValue(S.ctl[id + "~l"] ?? pair[0], c.left), b = numValue(S.ctl[id + "~r"] ?? pair[1], c.right);
      if (a.err || b.err) { S.valMsg[id] = { ok: false, text: a.err || b.err }; return render(); }
      return ctlSave(id, [a.n, b.n], id + "~l");
    }
    const a = numValue(S.ctl[id + "~v"] ?? cur, c);
    if (a.err) { S.valMsg[id] = { ok: false, text: a.err }; return render(); }
    ctlSave(id, a.n, id + "~v");
  };
  return h("form", { class: "custom", onsubmit: ev => { ev.preventDefault(); save(); } },
    c.pair
      ? [numField(id, "l", { ...c.left, unit: c.unit }, pair[0], c.left.label || "lewy", live),
         numField(id, "r", { ...c.right, unit: c.unit }, pair[1], c.right.label || "prawy", live)]
      : numField(id, "v", c, typeof cur === "number" ? cur : o.default, o.values.length ? "Własna" : null, live),
    h("button", { type: "submit", disabled }, "Ustaw"));
}

// Wartość tekstowa (kod języka, nazwa czcionki): pole z podpowiedziami (o.suggest = [[wartość, opis]]).
// Zapis idzie przez ctlSave → luaSerialize, jak każda inna kontrolka.
function textCtl(o, id, cur, disabled) {
  const k = id + "~t", list = o.suggest ? "dl-" + id.replace(/\W/g, "_") : null;
  const shown = S.ctl[k] ?? (typeof cur === "string" ? cur : (o.default ?? ""));
  const save = () => {
    const t = String(S.ctl[k] ?? shown).trim();
    if (!t && !o.allowEmpty) { S.valMsg[id] = { ok: false, text: "wpisz wartość" }; return render(); }
    ctlSave(id, t, k);
  };
  return h("form", { class: "custom", onsubmit: ev => { ev.preventDefault(); save(); } },
    h("input", { type: "text", list, value: shown, placeholder: o.placeholder, "data-fk": k, "aria-label": o.label,
      autocomplete: "off", spellcheck: "false", oninput: ev => { S.ctl[k] = ev.target.value; } }),
    list && h("datalist", { id: list }, o.suggest.map(([v, l]) => h("option", { value: v }, l))),
    h("button", { type: "submit", disabled }, "Ustaw"));
}

function switchCtl(label, checked, onchange, fk, disabled, extra) {
  return h("label", { class: "switch", ...extra },
    h("input", { type: "checkbox", role: "switch", checked, disabled, "aria-label": label, "data-fk": fk,
      onchange: ev => onchange(ev.target.checked) }),
    h("span", {}));
}

function fontCtl(o, id, cur, disabled) {
  const k = id + "~f";
  const known = new Set();
  for (const v of S.state.values) {
    if (v.deleted || !/#(cre_font|fallback_font)$|\|(cre_font|fallback_font)$/.test(v.id)) continue;
    try { const x = luaParse(v.preview); if (typeof x === "string") known.add(x); } catch { /* pomiń */ }
  }
  const listId = "fonts-" + o.key;
  return h("form", { class: "custom", onsubmit: ev => {
      ev.preventDefault();
      const name = (S.ctl[k] ?? cur ?? "").trim();
      if (!name) { S.valMsg[id] = { ok: false, text: "podaj nazwę czcionki" }; return render(); }
      ctlSave(id, name, k);
    } },
    h("input", { type: "text", list: listId, value: S.ctl[k] ?? (typeof cur === "string" ? cur : ""), "data-fk": k,
      "aria-label": o.label, placeholder: "nazwa czcionki, np. Noto Serif",
      oninput: ev => { S.ctl[k] = ev.target.value; pvCand(id, ev.target.value.trim() || undefined); } }),
    h("datalist", { id: listId }, [...known].sort().map(f => h("option", { value: f }))),
    h("button", { type: "submit", disabled }, "Ustaw"));
}

// Poprawki stylu: zbiór id → true. Odznaczenie usuwa klucz; nieznane id zostają nietknięte.
function tweaksCtl(o, id, cur, disabled) {
  const on = cur instanceof Map ? cur : new Map();
  const set = (tid, val) => {
    const next = new Map(on);
    if (val) next.set(tid, true); else next.delete(tid);
    ctlSave(id, next, id + "~" + tid);
  };
  const cats = new Map();
  for (const t of KO.tweaks) {
    const top = t.cat ? t.cat.split(" › ")[0] : "—";
    (cats.get(top) || cats.set(top, []).get(top)).push(t);
  }
  const knownIds = new Set(KO.tweaks.map(t => t.id));
  const extra = [...on.keys()].filter(k => typeof k === "string" && !knownIds.has(k));
  const toggled = t => { const next = new Map(on); if (on.get(t) === true) next.delete(t); else next.set(t, true); return next; };
  const item = (t, label, desc, sub) => h("label", { class: "tweak", title: desc || null, ...pvHover(id, toggled(t)) },
    h("input", { type: "checkbox", checked: on.get(t) === true, disabled, "data-fk": id + "~" + t,
      onchange: ev => set(t, ev.target.checked) }),
    h("span", {}, label, sub && h("span", { class: "muted small" }, " · " + sub)));
  // TASK-32: włączone poprawki na wierzchu (z „×”), wszystkie 120 w zwiniętej liście kategorii
  const known = new Map(KO.tweaks.map(t => [t.id, t]));
  const order = new Map(KO.tweaks.map((t, i) => [t.id, i]));
  const enabled = [...on.keys()].filter(k => on.get(k) === true)
    .sort((a, b) => (order.has(a) ? order.get(a) : 1e6) - (order.has(b) ? order.get(b) : 1e6) || String(a).localeCompare(String(b)));
  const enabledRow = tid => {
    const t = known.get(tid);
    const title = t ? t.title : tid, sub = t && t.cat ? t.cat.split(" › ").join(" › ") : "spoza KOReadera " + KO.version;
    return h("div", { class: "twr", ...pvHover(id, toggled(tid)) },
      h("span", { class: "grow" }, title, h("span", { class: "muted small" }, " · " + sub)),
      h("button", { type: "button", class: "twx", disabled, "aria-label": "Wyłącz: " + title, title: "Wyłącz", "data-fk": id + "~" + tid, onclick: () => set(tid, false) }, "×"));
  };
  const allOpen = !!S.valOpen["tw:all"];
  return h("div", { class: "tweaks" },
    h("div", { class: "twon" },
      h("p", { class: "muted small", style: "margin:2px 0 4px" }, enabled.length ? `Włączone wspólnie (${enabled.length})` : "Żadna poprawka nie jest włączona wspólnie."),
      enabled.map(enabledRow)),
    h("details", { class: "twall", open: allOpen || null, ontoggle: ev => { S.valOpen["tw:all"] = ev.target.open; } },
      h("summary", {}, `Wszystkie poprawki (${KO.tweaks.length})`),
      [...cats].map(([cat, list]) => {
        const n = list.filter(t => on.get(t.id) === true).length;
        const ok = "tw:" + cat;
        return h("details", { open: !!S.valOpen[ok] || null, ontoggle: ev => { S.valOpen[ok] = ev.target.open; } },
          h("summary", {}, cat, n > 0 && h("span", { class: "cnt" }, String(n))),
          list.map(t => item(t.id, t.title, t.desc, t.cat.includes(" › ") ? t.cat.split(" › ").slice(1).join(" › ") : null)));
      })),
    extra.length > 0 && h("details", { open: !!S.valOpen["tw:?"] || null, ontoggle: ev => { S.valOpen["tw:?"] = ev.target.open; } },
      h("summary", {}, `Spoza KOReadera ${KO.version}`, h("span", { class: "cnt" }, String(extra.length))),
      extra.map(t => item(t, t, "Poprawka użytkownika albo z innej wersji KOReadera"))));
}

// Stopka: tabela ustawień — przełączniki dla znanych pól, reszta zostaje bez zmian.
function flagsCtl(o, id, cur, disabled) {
  const t = cur instanceof Map ? cur : new Map();
  const put = (k, val, fk) => { const next = new Map(t); next.set(k, val); ctlSave(id, next, fk); };
  return h("div", { class: "flags" },
    o.flags.filter(f => t.has(f.k)).map(f => {
      const val = t.get(f.k) === true;
      return h("div", { class: "flag", ...pvHover(id, new Map(t).set(f.k, !val)) },
        switchCtl(f.label, f.invert ? !val : val, c => put(f.k, f.invert ? !c : c, id + "~" + f.k), id + "~" + f.k, disabled),
        h("span", {}, f.label));
    }),
    (o.nums || []).filter(n => typeof t.get(n.k) === "number").map(n => h("form", { class: "custom", onsubmit: ev => {
        ev.preventDefault();
        const a = numValue(S.ctl[id + "~" + n.k] ?? t.get(n.k), n);
        if (a.err) { S.valMsg[id] = { ok: false, text: a.err }; return render(); }
        put(n.k, a.n, id + "~" + n.k);
      } }, numField(id, n.k, n, t.get(n.k), n.label), h("button", { type: "submit", disabled }, "Ustaw"))));
}

function control(o, id, cv) {
  const disabled = S.valBusy === id;
  const cur = cv.value;
  if (cv.state === "loading") return h("p", { class: "muted small" }, "Wczytuję…");
  if (cv.state === "bad") return h("p", { class: "muted small" }, "Tej wartości nie da się tu pokazać — zobacz „Zaawansowane”.");
  // Tabele (stopka, poprawki) edytujemy tylko, gdy wspólna wartość już istnieje:
  // częściowa tabela nadpisałaby na czytniku domyślne KOReadera.
  if ((o.kind === "flags" || o.kind === "tweaks") && cv.state === "absent")
    return h("p", { class: "muted small" }, "Brak wspólnej wartości — pojawi się po pierwszej synchronizacji czytnika z włączoną grupą.");
  switch (o.kind) {
    case "switch":
      return switchCtl(o.label, luaSame(cur ?? o.default, o.on), c => ctlSave(id, c ? o.on : o.off, id + "~s"), id + "~s", disabled,
        pvHover(id, luaSame(cur ?? o.default, o.on) ? o.off : o.on));
    case "bool":
      return switchCtl(o.label, (cur ?? o.default) === true, c => ctlSave(id, c, id + "~s"), id + "~s", disabled);
    case "choice": {
      const shown = cur ?? o.default;
      const known = o.values.some(p => luaSame(p, shown));
      return h("div", { class: "choice" },
        o.values.length > 0 && segmented(o, id, shown, disabled),
        !known && shown != null && o.values.length > 0 && h("span", { class: "own" }, "własna: " + fmtValue(o, shown)),
        o.custom && customEditor(o, id, shown, disabled));
    }
    case "text": return textCtl(o, id, cur, disabled);
    case "font": return fontCtl(o, id, cur, disabled);
    case "tweaks": return tweaksCtl(o, id, cur, disabled);
    case "flags": return flagsCtl(o, id, cur, disabled);
  }
  return null;
}

// Opis z KOReadera: bloki (napis = akapit, tablica = lista). Pierwszy blok
// zawsze widoczny, reszta pod „więcej” — bez trójkątów <details>.
function helpText(o, id) {
  if (!o.help || !o.help.length) return null;
  const block = b => Array.isArray(b) ? h("ul", {}, b.map(x => h("li", {}, x))) : h("p", {}, b);
  const k = "help:" + id, open = !!S.valOpen[k], rest = o.help.slice(1);
  return h("div", { class: "shelp", id: "help-" + id },
    block(o.help[0]),
    rest.length > 0 && open && rest.map(block),
    rest.length > 0 && h("button", { type: "button", class: "more", "aria-expanded": String(open),
      onclick: ev => { ev.stopPropagation(); S.valOpen[k] = !open; render(); } }, open ? "mniej" : "więcej"));
}

// TASK-32: wiersz zwinięty to kropka (● wspólne, ○ nieustawione), nazwa i wartość tekstem;
// opis, kontrolka i źródło rozwijają się pod nim (jeden otwarty naraz: S.valEx).
// Tabele sekcji (stopka, poprawki) zostają zawsze rozwinięte.
function valueText(o, cv) {
  if (cv.state === "loading") return "…";
  if (cv.state === "bad") return "nie do pokazania";
  const x = cv.state === "ok" ? cv.value : (o.kind === "bool" ? false : o.default);
  if (x === undefined || x === null) return "—";
  if (o.kind === "switch") return luaSame(x, o.on) ? "włączone" : "wyłączone";
  if (o.kind === "bool") return x === true ? "włączone" : "wyłączone";
  const t = fmtValue(o, x);
  return o.unit && /^[-+−]?\d/.test(t) && !t.includes(o.unit) ? t + " " + o.unit : t; // jednostka tylko przy liczbach, nie przy „średni”/„brak”
}

// Czytniki, które NIE dostaną ustawienia, bo mają wyłączoną jego grupę (domyślnie wyłączone
// są m.in. „Rozmiar czcionki i marginesy” i „Wybór czcionek”).
function devLacking(id, devices) {
  const g = groupOfId(id);
  return g ? devices.filter(d => d.groups && d.groups[g] === false) : [];
}
// Czytniki wybrane na pasku „Pokaż dla”; przy jednym czytniku zawsze on.
function devPicked() {
  const ds = S.state.devices;
  return ds.length === 1 ? ds : ds.filter(d => d.id === S.valDev);
}

function settingMeta(o, id, v, cv, def) {
  const set = cv.state !== "absent";
  return h("div", { class: "meta" },
    set ? `z: ${v.from || "urządzenia, które już usunięto"} · ${ago(v.t)}` : (def != null ? `domyślnie: ${def}` : "nie ustawiono"),
    set && h("button", { type: "button", class: "linkish", disabled: S.valBusy === id,
      onclick: ev => { ev.stopPropagation(); ctlReset(id, o.label); } }, "usuń"));
}

function lackNote(id) {
  const lack = devLacking(id, S.state.devices);
  if (!lack.length) return null;
  const g = catalogGroup(groupOfId(id));
  return h("p", { class: "lack small" },
    `${lack.map(d => d.name).join(", ")} ${lack.length > 1 ? "nie dostaną" : "nie dostanie"} tego: grupa „${g ? g.name : groupOfId(id)}” jest wyłączona. `,
    "Możesz ustawić wartość — zapisze się, ale nie rozpropaguje na ", lack.length > 1 ? "te czytniki" : "ten czytnik", ". ",
    h("button", { type: "button", class: "linkish", onclick: () => showTab("grupy") }, "Włącz w „Co synchronizować”"));
}

function settingRow(o, id, v, secLabel) {
  const cv = currentValue(v);
  const set = cv.state !== "absent";
  // jedna tabela na sekcję (stopka, poprawki) — bez powtórzonej nazwy, zawsze rozwinięta
  const wide = (o.kind === "flags" || o.kind === "tweaks") && o.label === secLabel;
  const def = o.default !== undefined ? fmtValue(o, o.default) : null;
  const dim = devLacking(id, devPicked()).length > 0;
  const cls = "srow" + (S.valSel === id ? " sel" : "") + (set ? "" : " absent") + (wide ? " wide" : "") + (dim ? " dim" : "");
  if (wide) {
    return h("div", { class: cls, "data-id": id, "aria-label": o.label, onfocusin: () => valSelect(id), onclick: () => valSelect(id) },
      h("div", { class: "sc" }, control(o, id, cv), lackNote(id), settingMeta(o, id, v, cv, def), valMsgFor(id)));
  }
  const open = S.valEx === id;
  const text = valueText(o, cv) + (set ? "" : " (domyślnie)");
  return h("div", { class: cls + (open ? " open" : ""), "data-id": id },
    h("button", { type: "button", class: "srow-h", "aria-expanded": String(open), "aria-controls": "sb-" + id, "data-fk": id + "~h",
        title: set ? `z: ${v.from || "urządzenia, które już usunięto"} · ${ago(v.t)}` : null,
        onclick: () => {
          S.valEx = open ? null : id;
          if (!open) valSelect(id);
          render();
          app.querySelector(`[data-fk="${CSS.escape(id + "~h")}"]`)?.focus();
        } },
      h("span", { class: "sdot " + (set ? "on" : "off"), role: "img", "aria-label": set ? "wspólne" : "nieustawione" }),
      h("span", { class: "sname" }, o.label),
      dim && h("span", { class: "slack" }, "nie dostaje"),
      h("span", { class: "sval" + (set ? "" : " def") }, text),
      h("span", { class: "chev", "aria-hidden": "true" })),
    open && h("div", { class: "srow-b", id: "sb-" + id, onfocusin: () => valSelect(id) },
      helpText(o, id),
      h("div", { class: "sc" }, control(o, id, cv), lackNote(id), settingMeta(o, id, v, cv, def), valMsgFor(id))));
}

// Pasek „Pokaż dla”: wybór czytnika przygasza ustawienia, których ten czytnik nie dostanie.
function deviceBar(mapped, byId) {
  const ds = S.state.devices;
  if (ds.length === 0) return null;
  if (S.valDev && !ds.some(d => d.id === S.valDev)) S.valDev = null;
  const pick = ds.length === 1 ? ds[0] : ds.find(d => d.id === S.valDev);
  const n = (list) => [...mapped].filter(id => byId.get(id) && !byId.get(id).deleted && devLacking(id, list).length > 0).length;
  const chip = (d) => h("button", { type: "button", "aria-pressed": String(d ? d.id === pick?.id : !pick), "data-fk": "dev~" + (d ? d.id : "all"),
    onclick: () => { S.valDev = d ? d.id : null; render(); app.querySelector(`[data-fk="${CSS.escape("dev~" + (d ? d.id : "all"))}"]`)?.focus(); } },
    d ? d.name : "Wszystkie");
  const k = pick ? n([pick]) : n(ds);
  const note = pick
    ? (k > 0 ? `${pick.name} nie dostaje ${k} ${plPl(k, "ustawienie", "ustawienia", "ustawień")} (grupa wyłączona)` : `${pick.name} dostaje wszystkie ustawione wartości`)
    : (k > 0 ? `${k} ${plPl(k, "ustawienie nie trafia", "ustawienia nie trafiają", "ustawień nie trafia")} na każdy czytnik — wybierz czytnik, żeby zobaczyć które` : "Każdy czytnik dostaje wszystkie ustawione wartości");
  return h("div", { class: "devbar" },
    h("span", { class: "muted small" }, "Pokaż dla:"),
    h("div", { class: "seg", role: "group", "aria-label": "Pokaż dla czytnika" }, (ds.length > 1 ? [chip(null)] : []).concat(ds.map(chip))),
    h("span", { class: "small " + (k > 0 ? "lack" : "muted") }, note));
}

// ---- szukanie (TASK-32): nazwy i opisy ustawień, poprawki stylu (tytuł, opis, kategoria), flagi paska stanu.
// Porównanie bez wielkości liter i bez znaków diakrytycznych; każde słowo zapytania musi trafić.
const searchNorm = s => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
const SEARCH_MAX_TWEAKS = 30;

function searchHits(q) {
  const words = searchNorm(q).split(/\s+/).filter(Boolean);
  if (!words.length || typeof KO === "undefined") return null;
  const all = hay => { const h = searchNorm(hay); return words.every(w => h.includes(w)); };
  const hits = [];
  const byName = x => all(x.kind === "tweak" ? x.t.title : x.kind === "flag" ? x.f.label : x.o.label) ? 0 : 1; // trafienia w nazwie przed trafieniami w opisie
  for (const sec of KO.sections) {
    for (const o of KO.opts.filter(x => x.section === sec.id)) {
      const id = idFor(o.file, o.key);
      if (!id) continue;
      if (o.kind === "tweaks") {
        for (const t of KO.tweaks) if (all(`${t.title} ${t.desc || ""} ${t.cat || ""}`)) hits.push({ kind: "tweak", o, id, t, sec });
      } else if (o.kind === "flags") {
        for (const f of o.flags) if (all(f.label)) hits.push({ kind: "flag", o, id, f, sec });
      } else if (all(`${o.label} ${(o.help || []).flat().join(" ")}`)) hits.push({ kind: "opt", o, id, sec });
    }
  }
  return hits.map((x, i) => [byName(x), i, x]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(a => a[2]);
}

// Poprawka stylu jako wynik szukania: przełącznik działa tak jak w tabeli poprawek (ctlSave na całej tabeli).
function tweakHit(h_, byId) {
  const { o, id, t } = h_, cv = currentValue(byId.get(id));
  const editable = cv.state === "ok" && cv.value instanceof Map;
  const on = editable ? cv.value : new Map();
  const sub = t.cat ? t.cat.split(" › ").join(" › ") : null;
  const next = () => { const m = new Map(on); if (on.get(t.id) === true) m.delete(t.id); else m.set(t.id, true); return m; };
  return h("label", { class: "tweak", title: t.desc || null, ...pvHover(id, next()) },
    h("input", { type: "checkbox", checked: on.get(t.id) === true, disabled: !editable || S.valBusy === id, "data-fk": id + "~" + t.id,
      onchange: ev => ctlSave(id, (() => { const m = new Map(on); if (ev.target.checked) m.set(t.id, true); else m.delete(t.id); return m; })(), id + "~" + t.id) }),
    h("span", {}, t.title, sub && h("span", { class: "muted small" }, " · " + sub),
      !editable && h("span", { class: "muted small" }, " · brak wspólnej wartości")));
}

function flagHit(h_, byId) {
  const { o, id, f } = h_, cv = currentValue(byId.get(id));
  const t = cv.state === "ok" && cv.value instanceof Map ? cv.value : null;
  if (!t || !t.has(f.k)) return h("div", { class: "flag muted" }, h("span", {}, f.label, " · brak wspólnej wartości"));
  const val = t.get(f.k) === true;
  return h("div", { class: "flag", ...pvHover(id, new Map(t).set(f.k, !val)) },
    switchCtl(f.label, f.invert ? !val : val, c => ctlSave(id, new Map(t).set(f.k, f.invert ? !c : c), id + "~" + f.k), id + "~" + f.k, S.valBusy === id),
    h("span", {}, f.label));
}

function findBar() {
  return h("div", { class: "vfind" },
    h("input", { type: "search", id: "f-valq", "aria-label": "Szukaj ustawienia", placeholder: "Szukaj ustawienia…", value: S.valQ,
      oninput: ev => {
        const pos = ev.target.selectionStart;
        S.valQ = ev.target.value; render();
        const el = document.getElementById("f-valq");
        if (el) { el.focus(); el.setSelectionRange(pos, pos); }
      } }),
    S.valQ && h("button", { type: "button", onclick: () => { S.valQ = ""; render(); document.getElementById("f-valq")?.focus(); } }, "Wyczyść"));
}

// Wyniki zastępują sekcje (te same wiersze nie mogą stać dwa razy z tym samym id rozwinięcia).
function searchResults(hits, byId) {
  const shown = [], tw = hits.filter(x => x.kind === "tweak");
  let skipped = 0;
  for (const x of hits) {
    if (x.kind === "tweak" && tw.indexOf(x) >= SEARCH_MAX_TWEAKS) { skipped++; continue; }
    shown.push(x);
  }
  return h("section", { class: "card sgroup", "aria-label": "Wyniki szukania" },
    h("h3", {}, `Trafienia (${hits.length})`),
    hits.length === 0 && h("p", { class: "muted" }, `Nic nie pasuje do „${S.valQ.trim()}”.`),
    shown.map(x => h("div", { class: "hit" },
      h("span", { class: "hitsec muted small" }, x.sec.label),
      x.kind === "opt" ? settingRow(x.o, x.id, byId.get(x.id), null) : x.kind === "tweak" ? tweakHit(x, byId) : flagHit(x, byId))),
    skipped > 0 && h("p", { class: "muted small" }, `… i ${skipped} ${plPl(skipped, "poprawka więcej", "poprawki więcej", "poprawek więcej")} — zawęź szukanie.`));
}

// Licznik sekcji w spisie: [ustawione, wszystkie]. Poprawki i flagi liczą włączone pozycje, nie wiersz.
function sectionCount(opts, byId) {
  let n = 0, total = 0;
  for (const o of opts) {
    const id = idFor(o.file, o.key);
    const cv = id ? currentValue(byId.get(id)) : { state: "absent" };
    if (o.kind === "tweaks") { total += KO.tweaks.length; if (cv.state === "ok" && cv.value instanceof Map) n += KO.tweaks.filter(t => cv.value.get(t.id) === true).length; }
    else if (o.kind === "flags") { total += o.flags.length; if (cv.state === "ok" && cv.value instanceof Map) n += o.flags.filter(f => cv.value.get(f.k) === true).length; }
    else { total += 1; if (cv.state !== "absent") n += 1; }
  }
  return [n, total];
}

// Spis sekcji: lista z lewej (szeroki widok), rząd przycisków nad listą (średni), lista rozwijana (wąski).
// Szerokość mierzy kontener `.valwrap` (container query), bo podgląd strony zabiera część okna.
function sectionNav(secs, cur) {
  const pick = id => { S.valSec = id; S.valEx = null; render(); };
  const lbl = ([n, t]) => `${n}/${t}`;
  return h("div", { class: "secnav" },
    h("nav", { class: "secnav-list", "aria-label": "Sekcje ustawień" }, secs.map(x =>
      h("button", { type: "button", "aria-current": x.sec.id === cur.sec.id ? "true" : null, "data-fk": "sec~" + x.sec.id,
        onclick: () => { pick(x.sec.id); app.querySelector(`[data-fk="${CSS.escape("sec~" + x.sec.id)}"]`)?.focus(); },
        title: `${x.count[0]} z ${x.count[1]} ustawionych wspólnie` },
        h("span", {}, x.sec.label), h("small", {}, lbl(x.count))))),
    h("label", { class: "secnav-sel" }, h("span", { class: "muted small" }, "Sekcja"),
      h("select", { id: "f-valsec", "aria-label": "Sekcja ustawień", onchange: ev => { pick(ev.target.value); document.getElementById("f-valsec")?.focus(); } },
        secs.map(x => h("option", { value: x.sec.id, selected: x.sec.id === cur.sec.id }, `${x.sec.label} (${lbl(x.count)})`)))));
}

function valuesTab() {
  // Grupy Secret (konta/poświadczenia) żyją wyłącznie w zakładce „Konta” (TASK-21 AC1).
  const catalog = S.state.catalog.filter(g => !g.secret);
  const secretGroups = new Set(S.state.catalog.filter(g => g.secret).map(g => g.id));
  const values = S.state.values.filter(v => !secretGroups.has(v.group));
  const byId = new Map(values.map(v => [v.id, v]));
  const hasKO = typeof KO !== "undefined";
  const mapped = new Set();
  // Sekcje: wiersze budujemy dla wszystkich (znaczek i licznik „Zaawansowane” liczą z `mapped`), ale pokazujemy jedną (spis, TASK-32).
  const secs = hasKO ? KO.sections.map(sec => {
    const opts = KO.opts.filter(o => o.section === sec.id);
    const rows = opts.map(o => {
      const id = idFor(o.file, o.key);
      if (!id) return null;
      mapped.add(id);
      return settingRow(o, id, byId.get(id), sec.label);
    }).filter(Boolean);
    return rows.length ? { sec, rows, count: sectionCount(opts, byId) } : null;
  }).filter(Boolean) : [];
  const curSec = secs.find(x => x.sec.id === S.valSec) || secs[0];
  const sections = curSec && h("div", { class: "valwrap" },
    h("div", { class: "valsplit" }, sectionNav(secs, curSec),
      h("section", { class: "card sgroup valmain", "aria-label": curSec.sec.label }, h("h3", {}, curSec.sec.label), curSec.rows)));
  // padmap KOPada ma własny edytor w Wtyczki → „Ustawienia wtyczek” (TASK-26); tu
  // zostaje tylko jako surowa wartość w „Zaawansowane”, ale nie liczy się do znaczka
  if (typeof Padmap !== "undefined") mapped.add(Padmap.ID);
  // ustawienia Rosetty też mają własną kartę w „Ustawienia wtyczek” (TASK-40)
  for (const o of ROSETTA_OPTS) { const id = idFor(ROSETTA_FILE, o.key); if (id) mapped.add(id); }
  // …a Asystent AI (TASK-47)
  for (const o of ASSISTANT_OPTS) { const id = idFor(ASSISTANT_FILE, o.key); if (id) mapped.add(id); }
  const unmapped = values.filter(v => !v.deleted && !mapped.has(v.id)).length;
  const hits = searchHits(S.valQ);
  return h("section", {},
    hasKO && findBar(),
    deviceBar(mapped, byId),
    hits ? searchResults(hits, byId) : sections,
    h("details", { class: "card adv", open: S.valAdv || null, ontoggle: ev => { S.valAdv = ev.target.open; } },
      h("summary", {}, "Zaawansowane — surowe wartości (literały Lua)",
        unmapped > 0 && h("span", { class: "cnt", title: "wartości spoza mapy KOReadera" }, String(unmapped))),
      h("p", { class: "muted small" }, "Wszystkie wspólne wartości z identyfikatorami plików i kluczy, także te, których nie ma w mapie nazw KOReadera. Zmiana tutaj działa tak, jakby zrobiono ją na innym czytniku."),
      advancedValues(catalog, values)),
    hasKO && h("p", { class: "muted small kover" },
      `Nazwy i opisy: KOReader ${KO.version}, tłumaczenie polskie (koreader-translations ${KO.l10n.slice(0, 7)}).`));
}

// ------------------------------------------------ gamepad: mapowanie przycisków KOPada (TASK-25)
//
// Wspólna wartość settings/kopad.lua|padmap (PC-011, PC-014): nadpisania względem
// domyślnego mapowania układu (`layouts`: przycisk → rola) i względem domyślnych
// akcji ról w czytaniu (`actions`: rola → akcja, TASK-27). Logika (czytanie,
// mapowanie efektywne, różnice, składanie literału) jest w web/padmap.js i testowana
// w node; tu tylko DOM.
// Szkic edycji układu żyje w S.pad.drafts, szkic akcji w S.pad.actDraft — przeżywają
// przerysowania z odświeżania stanu. Obie karty zapisują TĘ SAMĄ wartość, więc każdy
// zapis składa literał ze świeżego stanu serwera: zapis układu zachowuje zapisane akcje,
// zapis akcji — zapisane układy (i żaden nie rusza cudzych niezapisanych szkiców).

// Stan zapisanej wartości: {state: "loading"|"absent"|"ok"|"bad", layouts, reason}
function padSaved() {
  const v = S.state.values.find(x => x.id === Padmap.ID);
  const cv = currentValue(v);
  if (cv.state === "loading") return { state: "loading", layouts: {}, actions: {} };
  if (cv.state === "absent") return { state: "absent", layouts: {}, actions: {} };
  if (cv.state === "bad") return { state: "bad", reason: "to nie jest poprawny literał Lua" };
  return Padmap.fromValue(cv.value);
}

// Układy, na których budujemy zapis; null = wartość nieczytelna i nie zaczęto od zera.
function padBase(saved) {
  if (saved.state === "ok" || saved.state === "absent") return saved.layouts;
  return S.pad.fresh ? {} : null;
}

// Zapisane nadpisania akcji (rola → akcja); przy „zacznij od zera” puste.
function padSavedActions(saved) {
  return saved.state === "ok" || saved.state === "absent" ? (saved.actions || {}) : {};
}

// Akcje efektywne do wyświetlenia: szkic (jeszcze niezapisany) albo zapisane + domyślne.
// Etykiety ról w obu kartach liczą się z nich, więc nie kłamią po przestawieniu.
function padActs(saved) {
  return S.pad.actDraft || Padmap.effectiveActions(padSavedActions(saved));
}

function padSvg(layout, map, acts) {
  const P = Padmap;
  const lab = c => P.printed(layout, c);
  const chg = new Set(P.changed(layout, map));
  const g = (c, shape, text) => `<g class="pctl${chg.has(c) ? " chg" : ""}" data-ctl="${c}">${shape}${text}</g>`;
  const rect = (x, y, w, hh) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="6"/>`;
  const circ = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}"/>`;
  const txt = (x, y, t, cls) => `<text x="${x}" y="${y}"${cls ? ` class="${cls}"` : ""}>${t}</text>`;
  const svg = `<svg viewBox="0 0 360 232" class="padsvg" role="img" aria-label="${P.describe(layout, map, acts).replace(/"/g, "&quot;")}">
<path class="pbody" d="M92 70H268C300 70 318 96 332 150C342 190 338 212 316 214C296 216 286 196 270 176C260 164 252 160 236 160H124C108 160 100 164 90 176C74 196 64 216 44 214C22 212 18 190 28 150C42 96 60 70 92 70Z"/>
<g class="pdeco">${circ(92, 108, 17)}${circ(92, 108, 7)}${circ(222, 142, 14)}${circ(222, 142, 6)}<path d="M130 130v24M118 142h24"/></g>
${g("ltrigger", rect(58, 20, 56, 20), txt(86, 31, lab("ltrigger")))}
${g("rtrigger", rect(246, 20, 56, 20), txt(274, 31, lab("rtrigger")))}
${g("lshoulder", rect(50, 45, 72, 17), txt(86, 54, lab("lshoulder")))}
${g("rshoulder", rect(238, 45, 72, 17), txt(274, 54, lab("rshoulder")))}
${g("back", circ(150, 98, 9), txt(150, 120, lab("back"), "sm"))}
${g("start", circ(210, 98, 9), txt(210, 120, lab("start"), "sm"))}
${g("north", circ(270, 86, 11), txt(270, 86, lab("north"), "face"))}
${g("south", circ(270, 128, 11), txt(270, 128, lab("south"), "face"))}
${g("west", circ(249, 107, 11), txt(249, 107, lab("west"), "face"))}
${g("east", circ(291, 107, 11), txt(291, 107, lab("east"), "face"))}
</svg>`;
  const holder = h("div", { class: "padsvgbox" });
  holder.innerHTML = svg; // wyłącznie stałe etykiety z padmap.js, żadnych danych z serwera
  const el = holder.firstChild;
  // klik w kontrolkę na sylwetce przenosi fokus na jej listę (klawiatura i czytnik ekranu mają select)
  for (const node of el.querySelectorAll("[data-ctl]")) {
    node.addEventListener("click", () => document.getElementById(`padsel-${layout}-${node.dataset.ctl}`)?.focus());
  }
  return el;
}

// Wiersz pod kursorem albo z fokusem zapala odpowiedni przycisk na schemacie (TASK-41). Sam znacznik klasy,
// bez render(), więc nie przerywa edycji; kształt (grubszy obrys) niesie to także bez koloru.
function padHl(c, on) { document.querySelector(`.padsvg [data-ctl="${c}"]`)?.classList.toggle("hl", on); }

function padRow(layout, c, map, acts) {
  const P = Padmap, id = `padsel-${layout}-${c}`;
  const def = P.defaultMap(layout)[c], changed = map[c] !== def;
  return h("div", { class: "padrow" + (changed ? " chg" : ""),
    onmouseenter: () => padHl(c, true), onmouseleave: () => padHl(c, false),
    onfocusin: () => padHl(c, true), onfocusout: () => padHl(c, false) },
    h("label", { for: id },
      h("span", { class: "pk" }, P.printed(layout, c)),
      h("span", { class: "muted small" }, P.POSITIONS[c])),
    h("select", { id, onchange: ev => { S.pad.drafts[layout] = { ...map, [c]: ev.target.value }; render(); } },
      P.ROLE_IDS.map(r => h("option", { value: r, selected: map[c] === r }, P.roleLabel(r, acts) + (r === def ? " — domyślnie" : "")))),
    changed && h("span", { class: "padnote muted small" }, "● zmienione · domyślnie: " + P.roleLabel(def, acts) + " ",
      h("button", { type: "button", class: "linkbtn", onclick: () => { S.pad.drafts[layout] = { ...map, [c]: def }; render(); } }, "↺ przywróć")));
}

const PAD_LAYOUT_NOTES = {
  xbox: "Przyciski mają tu te same nazwy co role KOPada.",
  playstation: "Pozycje jak w Xboksie: ✕ to dolny przycisk (rola A). Różnią się tylko symbole.",
  nintendo: "Drukowane A jest po prawej, więc domyślnie rola A leży pod prawym przyciskiem (A↔B i X↔Y zamienione względem Xboksa).",
  valve: "Pozycje jak w Xboksie, różnią się tylko etykiety (Widok i Menu zamiast Wstecz i Start, L1/R1, L2/R2). Pady Valve mają też tylne przyciski L4/L5/R4/R5, których KOPad nie obsługuje, więc nie da się ich tu przemapować.",
};

function padTablist(base) {
  const ids = Padmap.LAYOUT_IDS;
  return h("div", { class: "tabs", role: "tablist", "aria-label": "Układ pada" },
    ids.map((id, i) => {
      const sel = S.pad.layout === id;
      const map = S.pad.drafts[id], dirty = !!map && Padmap.differs(base, id, map);
      const n = Padmap.changed(id, map || Padmap.effective(base, id)).length;
      return h("button", {
        type: "button", role: "tab", id: "padtab-" + id, "aria-selected": String(sel),
        "aria-controls": "padpanel", tabindex: sel ? "0" : "-1", class: "tab" + (sel ? " selected" : ""),
        onclick: () => { S.pad.layout = id; S.pad.msg = null; render(); },
        onkeydown: ev => {
          const d = { ArrowRight: 1, ArrowLeft: -1 }[ev.key];
          if (d == null && ev.key !== "Home" && ev.key !== "End") return;
          ev.preventDefault();
          const nid = ids[ev.key === "Home" ? 0 : ev.key === "End" ? ids.length - 1 : (i + d + ids.length) % ids.length];
          S.pad.layout = nid; S.pad.msg = null; render();
          document.getElementById("padtab-" + nid)?.focus();
        },
      }, Padmap.LAYOUT_SHORT[id],
        n > 0 && h("span", { class: "cnt", title: `${n} z 10 kontrolek zmienionych względem domyślnych` }, String(n)),
        dirty && h("span", { class: "dirty", title: "niezapisane zmiany" }, "●", h("span", { class: "sr" }, " niezapisane zmiany")));
    }));
}

async function padSave(layout) {
  const P = S.pad, saved = padSaved(), base = padBase(saved);
  const map = P.drafts[layout];
  if (!map || base === null) return;
  // wartość składana z ŚWIEŻEGO stanu serwera: inne układy zostają nietknięte
  const lit = Padmap.toLiteral(Padmap.withLayout(base, layout, map), padSavedActions(saved));
  P.busy = true; P.msg = null; render();
  try {
    if (lit === null) {
      if (saved.state !== "absent") await api("POST", "/api/admin/values", { delete: [Padmap.ID] });
    } else {
      await api("POST", "/api/admin/values", { set: { [Padmap.ID]: lit } });
    }
    delete P.drafts[layout];
    P.fresh = false;
    P.msg = { ok: true, text: lit === null
      ? "Zapisane — ani żaden układ, ani żadna akcja nie ma już nadpisań, więc wspólna wartość została usunięta. Czytniki wrócą do domyślnych mapowań."
      : "Zapisane — czytniki z włączoną grupą „KOPad” dostaną to przy najbliższej synchronizacji." };
  } catch (e) {
    P.msg = { ok: false, text: e.message };
  }
  P.busy = false;
  await refresh();
  document.getElementById("padtab-" + layout)?.focus();
}

// Krótki wstęp karty (TASK-41): jedno zdanie i link do tematu „Jak to działa”. Stan grupy „KOPad” zostaje,
// bo bez niej mapowanie nie dotrze na czytnik.
function padIntro(k) {
  const on = S.state.devices.filter(d => d.groups && d.groups.kopad).map(d => d.name);
  const text = k === 1 ? "Wybierz układ pada i ustaw rolę każdej kontrolki. Zapisujemy tylko różnice względem domyślnych."
    : "Ustaw, co rola robi podczas czytania. Akcja należy do roli, nie do przycisku.";
  return [
    h("p", { class: "muted small padintro" }, text + " ", h("button", { type: "button", class: "linkbtn", onclick: () => showHow("kopad") }, "Jak to działa ›")),
    k === 1 && h("p", { class: "muted small padintro" }, on.length ? `Grupa „KOPad” jest włączona na: ${on.join(", ")}.`
      : "Grupa „KOPad” nie jest włączona na żadnym urządzeniu — włącz ją w „Co synchronizować”, żeby mapowanie dotarło na czytnik.")];
}

// Zawartość zakładki „Przyciski” karty KOPada (TASK-41: wcześniej osobna karta).
function padmapBody() {
  if (typeof Padmap === "undefined") return null;
  const g = catalogGroup("kopad");
  if (!g || g.secret) return null;
  const P = S.pad, saved = padSaved(), base = padBase(saved), acts = padActs(saved);
  const head = padIntro(1);
  if (saved.state === "loading") return [head, h("p", { class: "muted small" }, "Wczytuję…")];
  if (base === null) {
    return [head,
      h("div", { class: "padwarn", role: "alert" },
        h("p", {}, h("strong", {}, "Zapisana wartość mapowania jest w formacie, którego ten edytor nie rozumie")),
        h("p", { class: "small" }, `Powód: ${saved.reason}. Nie zmieniam jej po cichu — możesz ją obejrzeć w Ustawienia czytników → „Zaawansowane” (klucz kopad.lua | padmap) albo zacząć od zera: pierwszy zapis zastąpi dotychczasową wartość.`),
        h("button", { type: "button", onclick: () => { P.fresh = true; P.drafts = {}; P.actDraft = null; render(); } }, "Zacznij od zera"))];
  }
  const L = P.layout, map = P.drafts[L] || Padmap.effective(base, L);
  const dirty = !!P.drafts[L] && Padmap.differs(base, L, P.drafts[L]);
  const modified = Padmap.changed(L, map).length > 0;
  return [head,
    P.fresh && saved.state === "bad" && h("div", { class: "padwarn" },
      h("p", { class: "small" }, "Zaczynasz od zera: pierwszy zapis zastąpi zapisaną wartość, której edytor nie rozumiał."),
      h("button", { type: "button", onclick: () => { P.fresh = false; P.drafts = {}; P.actDraft = null; render(); } }, "Wróć bez zmian")),
    padTablist(base),
    h("div", { id: "padpanel", role: "tabpanel", "aria-labelledby": "padtab-" + L, class: "padpanel" },
      h("p", { class: "muted small" }, Padmap.LAYOUT_LABELS[L] + ". " + PAD_LAYOUT_NOTES[L]),
      h("div", { class: "padgrid" },
        padSvg(L, map, acts),
        h("div", { class: "padlist" }, Padmap.CONTROL_IDS.map(c => padRow(L, c, map, acts)))),
      h("div", { class: "row padactions" },
        h("button", { type: "button", class: "primary", disabled: !dirty || P.busy, onclick: () => padSave(L) },
          P.busy ? "Zapisuję…" : "Zapisz układ"),
        h("button", { type: "button", disabled: !dirty || P.busy, onclick: () => { delete P.drafts[L]; P.msg = null; render(); } }, "Odrzuć zmiany"),
        h("button", { type: "button", disabled: !modified || P.busy, onclick: () => { P.drafts[L] = Padmap.defaultMap(L); P.msg = null; render(); } },
          "Przywróć domyślne"),
        dirty && h("span", { class: "muted small" }, "Niezapisane zmiany.")),
      P.msg && h("p", { class: (P.msg.ok ? "ok" : "err") + " small", role: "status" }, P.msg.text))];
}

// ------------------------------------------------ gamepad: akcje ról w czytaniu (TASK-27, PC-014)
//
// Druga warstwa po układzie: rola → akcja. Dotyczy ROLI, nie kontrolki, więc jest wspólna
// dla wszystkich układów; KOPad stosuje ją tylko w „czystym czytaniu” (bez zaznaczenia,
// słownika i menu), w pozostałych sytuacjach rola robi to, co zawsze.

// Które drukowane przyciski pełnią daną rolę na układzie wybranym w karcie układów.
function padRoleHint(layout, role) {
  const P = Padmap, base = padBase(padSaved());
  const map = S.pad.drafts[layout] || (base ? P.effective(base, layout) : P.defaultMap(layout));
  const ctl = P.controlsFor(map, role);
  return `${P.LAYOUT_SHORT[layout]}: ` + (ctl.length ? ctl.map(c => P.printed(layout, c)).join(", ") : "żaden przycisk");
}

function padActRow(role, map) {
  const P = Padmap, id = `padact-${role}`;
  const def = P.DEFAULT_ACTIONS[role], cur = map[role] ?? null, changed = cur !== def;
  // B nie ma domyślnej akcji KOPada (działa Wstecz KOReadera) — ma osobną pozycję „domyślnie”
  const opt = (a, text) => h("option", { value: a === null ? "" : a, selected: cur === a }, text);
  return h("div", { class: "padrow" + (changed ? " chg" : "") },
    h("label", { for: id },
      h("span", { class: "pk" }, P.roleName(role)),
      h("span", { class: "muted small" }, padRoleHint(S.pad.layout, role))),
    h("select", { id, onchange: ev => { S.pad.actDraft = { ...map, [role]: ev.target.value === "" ? null : ev.target.value }; S.pad.actMsg = null; render(); } },
      def === null ? opt(null, P.actionLabel(null) + " — domyślnie") : null,
      P.ACTION_GROUPS.map(g => h("optgroup", { label: g.label },
        g.ids.map(a => opt(a, P.ACTION_LABELS[a] + (a === def ? " — domyślnie" : "")))))),
    changed && h("span", { class: "padnote muted small" }, "● zmienione · domyślnie: " + P.actionLabel(def) + " ",
      h("button", { type: "button", class: "linkbtn", onclick: () => { S.pad.actDraft = { ...map, [role]: def }; S.pad.actMsg = null; render(); } }, "↺ przywróć")));
}

async function padSaveActions() {
  const P = S.pad, saved = padSaved(), base = padBase(saved);
  if (!P.actDraft || base === null) return;
  // wartość składana z ŚWIEŻEGO stanu serwera: zapisane układy zostają nietknięte
  const lit = Padmap.toLiteral(base, Padmap.actionOverrides(P.actDraft));
  P.busy = true; P.actMsg = null; render();
  try {
    if (lit === null) {
      if (saved.state !== "absent") await api("POST", "/api/admin/values", { delete: [Padmap.ID] });
    } else {
      await api("POST", "/api/admin/values", { set: { [Padmap.ID]: lit } });
    }
    P.actDraft = null;
    P.fresh = false;
    P.actMsg = { ok: true, text: lit === null
      ? "Zapisane — ani żadna akcja, ani żaden układ nie ma już nadpisań, więc wspólna wartość została usunięta. Czytniki wrócą do domyślnych."
      : "Zapisane — czytniki z włączoną grupą „KOPad” dostaną to przy najbliższej synchronizacji." };
  } catch (e) {
    P.actMsg = { ok: false, text: e.message };
  }
  P.busy = false;
  await refresh();
  document.getElementById("padact-save")?.focus();
}

// Zawartość zakładki „Akcje w czytaniu” karty KOPada.
function padActionsBody() {
  if (typeof Padmap === "undefined" || typeof Padmap.ACTION_IDS === "undefined") return null;
  const g = catalogGroup("kopad");
  if (!g || g.secret) return null;
  const P = S.pad, saved = padSaved(), base = padBase(saved);
  const head = padIntro(2);
  if (saved.state === "loading") return [head, h("p", { class: "muted small" }, "Wczytuję…")];
  if (base === null) {
    return [head, h("p", { class: "muted small", role: "status" }, "Zapisana wartość mapowania jest w formacie, którego ten edytor nie rozumie — rozwiąż to w zakładce „Przyciski”.")];
  }
  const savedActs = padSavedActions(saved);
  const map = P.actDraft || Padmap.effectiveActions(savedActs);
  const dirty = !!P.actDraft && Padmap.actionsDiffer(savedActs, P.actDraft);
  const modified = Padmap.changedActions(map).length > 0;
  return [head,
    h("div", { class: "padlist" }, Padmap.ROLE_IDS.map(r => padActRow(r, map))),
    h("div", { class: "row padactions" },
      h("button", { type: "button", id: "padact-save", class: "primary", disabled: !dirty || P.busy, onclick: () => padSaveActions() },
        P.busy ? "Zapisuję…" : "Zapisz akcje"),
      h("button", { type: "button", disabled: !dirty || P.busy, onclick: () => { P.actDraft = null; P.actMsg = null; render(); } }, "Odrzuć zmiany"),
      h("button", { type: "button", disabled: !modified || P.busy, onclick: () => { P.actDraft = { ...Padmap.DEFAULT_ACTIONS }; P.actMsg = null; render(); } },
        "Przywróć domyślne"),
      dirty && h("span", { class: "muted small" }, "Niezapisane zmiany.")),
    P.actMsg && h("p", { class: (P.actMsg.ok ? "ok" : "err") + " small", role: "status" }, P.actMsg.text)];
}

// Jedna karta KOPada z zakładkami „Przyciski” i „Akcje w czytaniu” (TASK-41). Szkice obu żyją w S.pad,
// więc przełączanie zakładek ich nie gubi; kropka „niezapisane” stoi na zakładce z niezapisaną zmianą.
const PAD_VIEWS = [["btn", "Przyciski"], ["act", "Akcje w czytaniu"]];
function showPadView(id) { S.pad.view = id; render(); document.getElementById("padview-" + id)?.focus(); }
function kopadCard() {
  const btn = padmapBody();
  if (!btn) return h("p", { class: "muted" }, "Ten serwer nie zna ustawień KOPada.");
  const act = padActionsBody();
  const v = act && S.pad.view === "act" ? "act" : "btn";
  const saved = padSaved(), base = padBase(saved);
  const dirty = { btn: !!base && Object.keys(S.pad.drafts).some(id => Padmap.differs(base, id, S.pad.drafts[id])),
    act: !!base && !!S.pad.actDraft && Padmap.actionsDiffer(padSavedActions(saved), S.pad.actDraft) };
  return h("section", { class: "card padcard", "aria-label": "KOPad" },
    act && h("div", { class: "tabs", role: "tablist", "aria-label": "Karta KOPada" },
      PAD_VIEWS.map(([id, label], i) => h("button", {
        type: "button", role: "tab", id: "padview-" + id, "aria-selected": String(v === id), "aria-controls": "padviewpanel",
        tabindex: v === id ? "0" : "-1", class: "tab" + (v === id ? " selected" : ""),
        onclick: () => showPadView(id),
        onkeydown: ev => {
          const d = { ArrowRight: 1, ArrowLeft: -1 }[ev.key];
          if (d == null && ev.key !== "Home" && ev.key !== "End") return;
          ev.preventDefault();
          showPadView(PAD_VIEWS[ev.key === "Home" ? 0 : ev.key === "End" ? PAD_VIEWS.length - 1 : (i + d + PAD_VIEWS.length) % PAD_VIEWS.length][0]);
        },
      }, label, dirty[id] && h("span", { class: "dirty", title: "niezapisane zmiany" }, "●", h("span", { class: "sr" }, " niezapisane zmiany"))))),
    h("div", { id: "padviewpanel", role: act ? "tabpanel" : null, "aria-labelledby": act ? "padview-" + v : null, class: v === "act" ? "actcard" : "" },
      v === "act" ? act : btn));
}

// ------------------------------------------------ zakładka: jak to działa

// TASK-34: „Jak to działa” — osobne tematy zamiast jednej ściany tekstu. Kolejność i treść zatwierdzone w
// selektorze (wybor/jak). Przykład i tabela biorą nazwy z prawdziwego stanu panelu.
function howNames() {
  const d = (S.state?.devices || []).map(x => x.name || x.model).filter(Boolean);
  return [d[0] || "pierwszy czytnik", d[1] || "drugi czytnik"];
}
function howServerName() {
  return S.mode === "desktop" && S.local?.mode === "local" ? "Ten komputer" : "Twój serwer";
}
function howTable() {
  const row = (...c) => h("tr", {}, h("th", { scope: "row" }, c[0]), c.slice(1).map(x => h("td", {}, x)));
  return h("table", { class: "how-table" },
    h("thead", {}, h("tr", {}, h("th", {}, "Co"), h("th", {}, "Czytnik"), h("th", {}, howServerName()), h("th", {}, "Serwer autora"))),
    h("tbody", {},
      row("Ustawienia i adresy kont", h("b", {}, "tak"), h("b", {}, "tak"), "nie"),
      row("Hasła Wallabag i kosync", h("b", {}, "tak"), h("b", {}, "tak, leżą tu"), "nie"),
      row("Książki", h("b", {}, "tak"), "nie, koligilo ich nie rusza", "nie"),
      row("Model czytnika, adres serwera, klucz", h("b", {}, "tak"), h("b", {}, "tak"),
        h("b", {}, "do 10 min, w pamięci, tylko przy parowaniu kodem z innej sieci"))));
}
const HOW_TOPICS = [
  ["why", "Po co to jest", "Po co", () => [
    h("p", {}, "KOReader każe wpisywać adresy i hasła na każdym urządzeniu osobno, a gesty, stopka i słowniki w ogóle się nie przenoszą. koligilo rozwozi je za Ciebie.")]],
  ["pair", "Jak dodać czytnik", "Nowy czytnik", () => [
    h("p", {}, "Plugin koligilo instalujesz na czytniku raz, a potem łączysz go z tym panelem kodem: ",
      h("b", {}, "Menu → Narzędzia → koligilo → Połącz z komputerem…"), " Kroki krok po kroku są w ",
      h("button", { type: "button", class: "linkbtn", onclick: () => showTab("urzadzenia") }, "Urządzenia → Dodaj czytnik"), ".")]],
  ["flow", "Jak przebiega synchronizacja", "Przebieg", () => {
    const [a, b] = howNames();
    return [
      h("p", {}, "Przykład: zmieniasz ustawienie stopki na czytniku „", a, "”."),
      h("ol", { class: "how-ex" },
        h("li", {}, "„", a, "” po połączeniu z Wi-Fi (albo po „Synchronizuj teraz”) wysyła tę zmianę na ", S.mode === "desktop" && S.local?.mode === "local" ? "ten komputer" : "serwer", "."),
        h("li", {}, "„", b, "” przy swojej synchronizacji ją pobiera. Nie musi być wtedy włączony ten sam czytnik."),
        h("li", {}, "„", b, "” prosi o ponowne uruchomienie KOReadera i dopiero wtedy ma nową stopkę."))];
  }],
  ["conf", "Gdy dwa czytniki zmienią to samo", "Konflikty", () => [
    h("p", {}, "Jeśli dwa czytniki zmienią to samo ustawienie w międzyczasie, wygrywa zmiana, która pierwsza dotrze na serwer. Drugi czytnik przy następnej synchronizacji przyjmie wersję wspólną.")]],
  ["books", "Co z postępem czytania i książkami?", "Książki", () => [
    h("p", {}, "Postęp czytania i statystyki dalej synchronizuje sam KOReader. koligilo tylko ustawia mu adres serwera i login. Książek nie rusza: te przenosi Libraro albo Syncthing.")]],
  ["plug", "Wtyczki", "Wtyczki", () => [
    h("p", {}, "W panelu przypisujesz czytnikowi wtyczki, ale instaluje je dopiero sam czytnik. Najpierw włączasz na nim „Pozwól instalować wtyczki”, potem potwierdzasz każdą instalację i aktualizację. Wtyczka to program z pełnym dostępem do czytnika, więc koligilo nigdy nie instaluje jej bez Twojej zgody na czytniku.")]],
  ["fonts", "Czcionki", "Czcionki", () => [
    h("p", {}, "Czcionki to zwykłe pliki (TTF, OTF), więc koligilo rozsyła je jako dane, nie jako kod. Wgrywasz je w panelu albo dodajesz z katalogu polecanych: serwer pobiera je wtedy sam, z przypiętych adresów autorów, i odrzuca plik o innej sumie niż w katalogu."),
    h("p", {}, "Czytnik dostaje czcionki dopiero wtedy, gdy sam na to pozwolisz: ", h("b", {}, "Menu → Narzędzia → koligilo → Zgody → Synchronizuj czcionki"), ". Zgodę da się włączyć tylko na czytniku, nigdy z panelu."),
    h("ul", {},
      h("li", {}, "Pliki trafiają do katalogu fonts/koligilo i pojawiają się w KOReaderze po jego ponownym uruchomieniu. Czcionek dodanych ręcznie koligilo nie rusza."),
      h("li", {}, "Nowy plik o tej samej nazwie zastępuje poprzedni na czytnikach. Limit to 40 MB na plik i 150 MB pobrań na jedną synchronizację."),
      h("li", {}, "Czcionka wysłana z czytnika czeka na Twoją akceptację w panelu, zanim trafi na inne urządzenia."),
      h("li", {}, "W zakładce „Czytniki” możesz wyłączyć rodzinę na wybranym czytniku. Dostaje ją wtedy tylko reszta, a ten czytnik usuwa jej pliki (tylko te od koligilo) przy następnej synchronizacji."))]],
  ["dicts", "Słowniki", "Słowniki", () => [
    h("p", {}, "Słowniki StarDict (te, których używa KOReader w oknie tłumaczenia) to zwykłe pliki, więc koligilo rozsyła je jako dane, nie jako kod. Możesz je wgrać (archiwum zip, tar.gz, tar.bz2, tar.zst albo luźne pliki .ifo, .idx i .dict.dz) albo pobrać z katalogu, który pochodzi z listy samego KOReadera."),
    h("p", {}, "Pobiera Twój serwer, w chwili kliknięcia, i robi to w tle (duże słowniki mają dziesiątki MB). Adresy z katalogu często wskazują „najnowsze wydanie”, więc zawartość może się zmienić od ostatniego razu. Serwer sprawdza, że to naprawdę StarDict, a pliki spoza słownika wycina, w tym .lua: KOReader uruchamia je jako kod, a kod koligilo instaluje wyłącznie za potwierdzeniem na czytniku."),
    h("p", {}, "Czytnik dostaje słowniki dopiero wtedy, gdy sam na to pozwolisz: ", h("b", {}, "Menu → Narzędzia → koligilo → Zgody → Synchronizuj słowniki"), ". Zgodę da się włączyć tylko na czytniku, nigdy z panelu."),
    h("ul", {},
      h("li", {}, "Słowniki trafiają do katalogu data/dict/koligilo i są widoczne w KOReaderze po jego ponownym uruchomieniu. Słowników dodanych ręcznie koligilo nie rusza."),
      h("li", {}, "Każdy czytnik ze zgodą dostaje wszystkie słowniki z panelu. Limit to 300 MB na słownik i 150 MB pobrań na jedną synchronizację, więc duży zestaw dociąga się w kilku."),
      h("li", {}, "Nowa wersja słownika o tej samej nazwie zastępuje starą na czytnikach. „Aktualizuj” w katalogu pobiera go ponownie."),
      h("li", {}, "Kolejność słowników i wyłączone słowniki to osobna grupa „Słowniki” w „Co synchronizować”; ta zakładka dostarcza same pliki."))]],
  ["kopad", "Gamepad (KOPad)", "KOPad", () => [
    h("p", {}, "Zakładka „Przyciski”: wybierz układ pada, który Cię interesuje, i ustaw, jaką rolę pełni każda kontrolka. Role mają nazwy z Xboksa, tak jak w dokumentacji KOPada (np. „A” to dolny przycisk). Zapisujemy tylko różnice względem domyślnego mapowania układu."),
    h("p", {}, "Który układ ma pad na danym urządzeniu, wybierasz na nim samym (menu KOPada → „Gamepad layout (this device)”); włączenie KOPada też zostaje lokalne. Krzyżak, drążki, Guide, L3 i R3 nie są przemapowywane."),
    h("p", {}, "Zakładka „Akcje w czytaniu”: tu ustawiasz, co dana rola robi, gdy po prostu czytasz książkę, np. RB może otwierać menu górne (a w nim ustawienia) zamiast przewracać stronę. Akcja należy do roli, nie do konkretnego przycisku, więc zostaje, gdy zmienisz pad albo układ. Pod nazwą roli widać, który przycisk pełni ją na układzie wybranym w zakładce „Przyciski”."),
    h("p", {}, "Zmiana działa tylko w czytaniu, bez otwartego zaznaczenia, słownika i menu. Tam rola robi to samo co zawsze (RB rozszerza zaznaczenie i przełącza kategorie menu, LT/RT zmieniają stronę menu), a kombinacje z X (X + krzyżak, X + LB/RB) zostają bez zmian. W przeglądarce plików przyciski działają jak dotąd."),
    h("p", { class: "muted small" }, "Mapowanie dociera na czytnik tylko wtedy, gdy grupa „KOPad” jest włączona w „Co synchronizować”.")]],
  ["sec", "Bezpieczeństwo", "Bezpieczeństwo", () => [
    h("div", { class: "how-tw" }, howTable()),
    h("ul", {},
      h("li", {}, "Każdy czytnik ma własny klucz; „Zapomnij” unieważnia go od razu."),
      h("li", {}, "Czytnik nie uruchamia niczego z serwera: ustawienia to same dane.")),
    h("p", { class: "muted small" }, "Szyfrowanie haseł przed wysłaniem w trybie Dropbox/WebDAV: wkrótce. Własny punkt kontaktowy zamiast serwera autora: opis w README.")]],
  ["fail", "Gdy coś pójdzie nie tak", "Awarie", () => [
    h("p", {}, "Gdy naraz zniknie ponad połowa synchronizowanych ustawień (np. uszkodzony plik), czytnik wstrzymuje synchronizację i nic nie wysyła. Nieczytelnych plików nie traktuje jak pustych.")]],
];
// Pasek „Twoja konfiguracja”: odpowiedź na „czemu mój czytnik nie widzi zmian” zależy od trybu.
// Dane już są w stanie panelu (to samo pokazuje stopka okna), nic nie dochodzi.
function howFacts() {
  const st = S.state, local = S.mode === "desktop" && S.local?.mode === "local";
  const head = local ? "Ten komputer jest serwerem"
    : S.mode === "desktop" ? "Czytniki łączą się z własnym serwerem" : "Ten panel działa na serwerze";
  const addr = local ? (S.local.public_url || "brak adresu w sieci") : S.mode === "desktop" ? S.local.server : location.origin;
  const last = (st.devices || []).filter(d => d.last_sync).sort((a, b) => new Date(b.last_sync.at) - new Date(a.last_sync.at))[0];
  const rule = local ? "Czytniki synchronizują się tylko wtedy, gdy ten komputer jest włączony i widoczny w sieci."
    : S.mode === "desktop" ? "Czytniki łączą się z serwerem bezpośrednio, a ten komputer jest tylko panelem."
      : "Czytniki łączą się z tym serwerem bezpośrednio.";
  return h("div", { class: "how-facts" },
    h("p", {}, h("b", {}, head), " · ", addr, " · ", VIEW_SUB.urzadzenia(st),
      last ? ` · ostatnia synchronizacja ${ago(last.last_sync.at)}` : ""),
    h("p", { class: "muted small" }, rule));
}
// „?” przy nagłówku widoku (TASK-34) prowadzi do tematu w „Jak to działa”. Widoki bez wpisu go nie mają.
const HOW_HELP = { urzadzenia: "pair", grupy: "conf", wspolne: "conf", konta: "books", wtyczki: "plug", czcionki: "fonts", slowniki: "dicts" };
function helpMark(topic) {
  const t = HOW_TOPICS.find(x => x[0] === topic)[1];
  return h("button", {
    type: "button", class: "help-q", title: `Jak to działa: ${t}`,
    "aria-label": `Jak to działa: ${t}`, onclick: () => showHow(topic),
  }, "?");
}
// Przejście do tematu: ze spisu, a z „?” przy nagłówkach innych widoków (showHow) także z innej zakładki.
function howGo(id) { S.howTopic = id; S.howScroll = id; render(); }
function showHow(id) { S.howTopic = id; S.howScroll = id; showTab("jak"); }
function howTab() {
  const cur = S.howTopic || HOW_TOPICS[0][0];
  if (S.howScroll) {
    const id = S.howScroll; S.howScroll = null;
    requestAnimationFrame(() => document.getElementById("how-" + id)?.scrollIntoView({ block: "start" }));
  }
  return h("div", { class: "how-wrap" },
    h("nav", { class: "how-toc", "aria-label": "Tematy" },
      HOW_TOPICS.map(([id, , nav]) => h("button", {
        type: "button", "aria-current": id === cur ? "true" : null, onclick: () => howGo(id),
      }, nav))),
    h("section", { class: "card prose how" },
      howFacts(),
      HOW_TOPICS.map(([id, title, , body], i) => h("div", { class: "how-topic", id: "how-" + id },
        h("h3", i === 0 ? { style: "margin-top:0" } : {}, title), body()))));
}

// ------------------------------------------------ zakładka: wtyczki (TASK-11)
//
// Tabela urządzenie × wtyczka: dla każdego urządzenia zestawiamy stan
// docelowy (d.plugins: katalog → sha256, ustawia panel) ze zgłoszonym
// inwentarzem czytnika (d.plugin_inventory) i ostatnimi wynikami operacji
// (d.plugin_results). "Zarządzana" pochodzi wyłącznie od czytnika (znacznik
// .koligilo) — panel nigdy go nie zgaduje. Usuwanie z panelu wolno tylko dla
// wtyczek, które są (albo będą) zarządzane przez koligilo (PC-004, AC TASK-11.2).

function pluginByHash(sha) {
  return (S.plugins || []).find(v => v.sha256 === sha);
}

// Nazwy wtyczek „po ludzku”. `fullname` z _meta.lua to to, co KOReader pokazuje
// w swoim menu („Simple UI”, „KOPad”); nazwa katalogu (SimpleUI.koplugin) jest
// szczegółem technicznym — idzie drobnym drukiem pod spodem, a nie w nagłówek.
// Kolejność źródeł: najnowsza wersja w magazynie → inwentarz czytnika (nowsze pluginy
// zgłaszają fullname także wtyczek wbudowanych i ręcznych) → nazwa katalogu bez „.koplugin”.
const pluginBase = dir => String(dir || "").replace(/\.koplugin$/i, "");
const pluginVerName = v => (v && v.fullname) || pluginBase(v && v.dir);
function pluginTitle(dir) {
  const v = (S.plugins || []).filter(x => x.dir === dir && x.fullname)
    .sort((a, b) => String(b.added).localeCompare(String(a.added)))[0];
  if (v) return v.fullname;
  for (const d of (S.state && S.state.devices) || []) {
    const p = (d.plugin_inventory || []).find(x => x.dir === dir && x.fullname);
    if (p) return p.fullname;
  }
  return pluginBase(dir);
}
const nameKey = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
// Nazwa + (tylko jeśli coś dodaje) nazwa katalogu: „KOPad” nie potrzebuje dopisku
// „kopad.koplugin”, ale „Simple UI” — „SimpleUI.koplugin” — już tak.
function pluginLabel(dir, title = pluginTitle(dir)) {
  return [h("span", { class: "pname" }, title),
    nameKey(title) !== nameKey(pluginBase(dir)) && h("small", { class: "pdir", title: "Nazwa katalogu wtyczki na czytniku" }, dir)];
}
// Repozytorium galerii: fullname, jeśli wtyczka jest już w magazynie; inaczej nazwa
// repozytorium bez „koreader-”/„.koplugin” i bez myślników („koreader-kopad” → „Kopad”).
function galleryTitle(full) {
  const prefix = String(full).toLowerCase() + "@";
  const v = (S.plugins || []).find(x => x.fullname && x.source === "galeria" && (x.source_ref || "").toLowerCase().startsWith(prefix));
  if (v) return v.fullname;
  const raw = String(full).split("/").pop();
  const words = raw.replace(/\.koplugin$/i, "").replace(/^koreader[-_.]?/i, "").replace(/[-_.]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : raw;
}

// Tabele wtyczek w wąskim oknie (≤ 620 px, patrz style.css) rozpadają się na „karty”:
// każda komórka dostaje etykietę z nagłówka swojej kolumny (data-label → ::before),
// a sam nagłówek zostaje w DOM dla czytników ekranu.
function labelCells(table) {
  const heads = [...table.querySelectorAll("thead th")].map(t => t.textContent);
  for (const tr of table.querySelectorAll("tbody tr")) [...tr.children].forEach((td, i) => { if (!td.hasAttribute("data-label")) td.setAttribute("data-label", heads[i] || ""); }); // gotowa etykieta (np. sama nazwa czytnika) wygrywa z tekstem nagłówka
  return table;
}
// TASK-33: „Wtyczki” to jedna strona — macierz „Zainstalowane”, kartka „Trzy kroki”
// i przycisk „＋ Dodaj wtyczkę” (arkusz, patrz addSheet()). „Ustawienia wtyczek”
// (TASK-26) to osobny ekran z przyciskiem powrotu. Panel tylko przypisuje stan
// docelowy — instalację i tak zawsze potwierdza czytnik (PC-004).

function showPlugView(v) {
  S.plugView = v;
  S.plugSel = null;
  app.scrollTop = 0;
  return refresh();
}

function setSteps(on) {
  S.plugSteps = on;
  stepsSet(on);
  render();
}

function stepsCard() {
  return h("section", { class: "card steps3", "aria-labelledby": "steps3-title" },
    h("h3", { id: "steps3-title" }, "Jak dodać wtyczki na czytnik — trzy kroki"),
    h("ol", { class: "steps" },
      h("li", {}, h("b", {}, "Na czytniku pozwól na wtyczki. "),
        `${MENU_PATH} → Zgody → Pozwól instalować wtyczki. Raz na każdy czytnik — z panelu się tego nie da.`),
      h("li", {}, h("b", {}, "W panelu wybierz wtyczki. "),
        "„＋ Dodaj wtyczkę”: z galerii (możesz wybrać kilka naraz), z pliku .zip albo spośród tych, które panel już ma, a potem zaznacz czytniki. Panel tylko wskazuje, co ma być zainstalowane."),
      h("li", {}, h("b", {}, "Na czytniku zatwierdź. "),
        "Wybierz „Synchronizuj teraz” i potwierdź listę wtyczek — dopiero wtedy czytnik je instaluje.")),
    h("p", { class: "muted small" }, "Wtyczka to kod Lua z pełnymi uprawnieniami na czytniku, dlatego koligilo nigdy nie instaluje jej samo."),
    h("button", { type: "button", id: "b-steps-ok", onclick: () => setSteps(false) }, "Zrozumiano"));
}

function pluginsTab() {
  if (S.plugView === PLUGSET) {
    return h("section", {},
      h("div", { class: "row plughead" },
        h("button", { type: "button", id: "b-plugback", onclick: () => showPlugView("main") }, "← Wtyczki")),
      pluginSettingsPanel());
  }
  return h("section", {},
    h("div", { class: "row plughead" },
      h("button", { type: "button", id: "b-add", class: "primary", onclick: () => openAddSheet("galeria") }, "＋ Dodaj wtyczkę"),
      h("button", { type: "button", id: "b-plugset", onclick: () => showPlugView(PLUGSET) }, "Ustawienia wtyczek"),
      !S.plugSteps && h("button", { type: "button", id: "b-steps", class: "linkbtn", onclick: () => setSteps(true) }, "Jak to działa? Trzy kroki")),
    S.plugSteps && stepsCard(),
    !S.plugins ? h("p", { class: "loading" }, "Wczytuję wtyczki…") : installedPanel(),
    S.addSheet && addSheet(),
    S.plugToast && plugToastBox());
}

// ------------------------------------------------ zakładka: zainstalowane (TASK-33)
//
// Jedna macierz wtyczka × czytnik zamiast dawnych „Wg urządzeń” i „Wg wtyczek”.
// Komórka to stan z zestawienia: stan docelowy (d.plugins: katalog → sha256, ustawia
// panel), inwentarz zgłoszony przez czytnik (d.plugin_inventory) i ostatnie wyniki
// operacji (d.plugin_results). „Zarządzana” pochodzi wyłącznie od czytnika (znacznik
// .koligilo) — panel jej nie zgaduje. Usuwać z panelu wolno tylko wtyczki zarządzane
// (PC-004, AC TASK-11.2); ręczne i wbudowane są tylko pokazane. Instalację i tak
// zawsze potwierdza czytnik, więc panel wyłącznie przypisuje.

const MENU_PATH = "Menu → Narzędzia → koligilo — synchronizacja ustawień";
const SYNC_HINT = `Na czytniku: ${MENU_PATH} → Synchronizuj teraz, potem zatwierdź listę wtyczek.`;
// stan komórki: znak (kształt niesie stan także bez koloru), zdanie, wskazówka co zrobić
const PLUG_STATE = {
  ok: { g: "✓", text: "zainstalowana" },
  upd: { g: "↑", text: "nowsza wersja czeka na potwierdzenie na czytniku", hint: SYNC_HINT },
  wait: { g: "…", text: "czeka na potwierdzenie na czytniku", hint: SYNC_HINT },
  consent: { g: "!", text: "czytnik jeszcze nie pozwolił na wtyczki", hint: `Na czytniku: ${MENU_PATH} → Zgody → Pozwól instalować wtyczki.` },
  rm: { g: "−", text: "usunięcie czeka na potwierdzenie na czytniku", hint: SYNC_HINT },
  rejected: { g: "✕", text: "odrzucona na czytniku", hint: "Przypisz ją ponownie albo usuń z czytnika." },
  err: { g: "✕", text: "błąd na czytniku" },
  manual: { g: "▫", text: "ręczna lub wbudowana — koligilo jej nie rusza" }, // gdy czytnik zgłosił pochodzenie: plugStateText/ORIGIN_TEXT
  none: { g: "＋", text: "nie ma na tym czytniku" },
};
const CONSENT_SHORT = "czytnik jeszcze nie pozwolił na wtyczki";

function plugCell(d, dir) {
  const inv = (d.plugin_inventory || []).find(p => p.dir === dir);
  const res = (d.plugin_results || []).find(r => r.dir === dir);
  const sha = (d.plugins || {})[dir];
  const tv = sha ? pluginByHash(sha) : null;
  let k = "none";
  if (res && res.status === "error") k = "err";
  else if (res && res.status === "rejected") k = "rejected";
  else if (sha && !d.plugins_allowed) k = "consent";
  else if (sha && inv && inv.sha256 === sha) k = "ok";
  else if (sha && inv) k = "upd";
  else if (sha) k = "wait";
  else if (inv) k = inv.managed ? "rm" : "manual";
  return { k, inv, sha, tv, res, canRemove: !!sha && (!inv || inv.managed) };
}
function plugVer(c) {
  const t = c.tv ? (c.tv.version || c.sha.slice(0, 12)) : "";
  const i = c.inv ? (c.inv.version || "?") : "";
  if (c.k === "upd" || ((c.k === "consent" || c.k === "rejected") && i && t && i !== t)) return `${i} → ${t || "?"}`;
  if (c.k === "wait" || c.k === "consent") return t ? "→ " + t : i;
  return i || t;
}
// TASK-43: czytnik zgłasza pochodzenie wtyczki (origin) — "builtin" | "manual" | brak (nieustalone).
const ORIGIN_TEXT = {
  builtin: "wbudowana w KOReadera — koligilo jej nie rusza",
  manual: "ręczna — koligilo jej nie rusza",
};
function plugStateText(c) {
  if (c.k === "err") return "błąd na czytniku: " + ((c.res && c.res.error) || "?");
  if (c.k === "manual" && c.inv && ORIGIN_TEXT[c.inv.origin]) return ORIGIN_TEXT[c.inv.origin];
  return PLUG_STATE[c.k].text;
}
// Jak ręczną wtyczkę oddać pod zarządzanie koligilo (droga już istnieje, TASK-13; zgoda zawsze na czytniku, PC-004).
const TAKEOVER_HINT = `Żeby zarządzać taką wtyczką razem z koligilo: na czytniku ${MENU_PATH} → Wyślij wtyczkę na serwer… → wybierz ją; potem zatwierdź ją tutaj w tabeli (znaczek „czeka na akceptację”). Wtyczki nie da się przejąć z panelu.`;

function latestApproved(dir) {
  return (S.plugins || []).filter(v => v.dir === dir && v.approved)
    .sort((a, b) => String(b.added).localeCompare(String(a.added)))[0];
}
function pendingVersions(dir) { return (S.plugins || []).filter(v => v.dir === dir && v.source === "urządzenie" && !v.approved); }
function updateFor(dir) {
  const u = S.galUpdates && (S.galUpdates.updates || []).find(x => x.dir === dir && x.update_available);
  return u || null;
}

// Wiersze macierzy: wtyczki z magazynu, przypisane gdziekolwiek albo zarządzane przez
// koligilo na jakimś czytniku. Reszta inwentarza (ręczne i WBUDOWANE — kilkadziesiąt
// na czytnik) idzie do zwiniętej listy pod tabelą.
function pluginRows() {
  const devs = S.state.devices, managed = new Set((S.plugins || []).map(v => v.dir));
  for (const d of devs) {
    Object.keys(d.plugins || {}).forEach(x => managed.add(x));
    (d.plugin_inventory || []).filter(p => p.managed).forEach(p => managed.add(p.dir));
  }
  // other: dir → { ids: czytniki, builtin: czy KAŻDY zgłaszający uznał ją za wbudowaną }.
  // Ręczna na choć jednym czytniku, albo pochodzenie nieustalone (stary plugin, Kindle/Kobo
  // bez rozpoznania po nazwie) → ląduje wśród ręcznych (TASK-43).
  const other = new Map();
  for (const d of devs) for (const p of d.plugin_inventory || []) {
    if (managed.has(p.dir)) continue;
    if (!other.has(p.dir)) other.set(p.dir, { ids: new Set(), builtin: true });
    const o = other.get(p.dir);
    o.ids.add(d.id);
    if (p.origin !== "builtin") o.builtin = false;
  }
  const versions = S.plugins || [];
  const rows = [...managed].sort((a, b) => {
    const fa = dirIsFavorite(a, versions.filter(v => v.dir === a)), fb = dirIsFavorite(b, versions.filter(v => v.dir === b));
    return (fb - fa) || pluginTitle(a).localeCompare(pluginTitle(b), "pl");
  }).filter(dir => !S.favOnly || dirIsFavorite(dir, versions.filter(v => v.dir === dir)));
  return { rows, other };
}

function plugGlyph(k) { return h("span", { class: "pg " + k, "aria-hidden": "true" }, PLUG_STATE[k].g); }

// Skrócone nazwy znaków w legendzie; pełne zdania (PLUG_STATE.text) są w dymkach komórek i w szczegółach wtyczki.
const PLUG_SHORT = { ok: "jest", upd: "nowsza", wait: "czeka", consent: "brak zgody", manual: "ręczna" };
const PLUG_ATTN = new Set(["upd", "wait", "consent", "rm", "rejected", "err"]);

// Wiersz „wymaga uwagi”: coś czeka na czytniku albo błąd, jest aktualizacja z galerii
// albo wersja z czytnika czeka na akceptację w panelu.
function plugNeedsAttn(dir, devs) {
  return !!updateFor(dir) || pendingVersions(dir).length > 0 || devs.some(d => PLUG_ATTN.has(plugCell(d, dir).k));
}

// Jedno zdanie stanu nad tabelą (z tych samych komórek, co macierz; nic nowego w danych).
function plugSentence(rows, devs) {
  const cnt = {};
  for (const dir of rows) for (const d of devs) { const k = plugCell(d, dir).k; cnt[k] = (cnt[k] || 0) + 1; }
  const p = [], n = k => cnt[k] || 0;
  if (n("wait")) p.push(`${n("wait")} ${plPl(n("wait"), "wtyczka czeka", "wtyczki czekają", "wtyczek czeka")} na potwierdzenie na czytniku`);
  if (n("upd")) p.push(`${n("upd")} ${plPl(n("upd"), "aktualizacja czeka", "aktualizacje czekają", "aktualizacji czeka")} na potwierdzenie`);
  if (n("rm")) p.push(`${n("rm")} ${plPl(n("rm"), "usunięcie czeka", "usunięcia czekają", "usunięć czeka")} na potwierdzenie`);
  const bad = n("err") + n("rejected");
  if (bad) p.push(`${bad} ${plPl(bad, "błąd lub odrzucenie", "błędy lub odrzucenia", "błędów lub odrzuceń")} na czytniku`);
  const nc = devs.filter(d => !d.plugins_allowed).length;
  if (nc) p.push(`${nc} ${plPl(nc, "czytnik bez zgody", "czytniki bez zgody", "czytników bez zgody")} na wtyczki`);
  return p.length ? p.join(" · ") + "." : "Wszystko zainstalowane na czytnikach ze zgodą.";
}

// Macierz wtyczka × czytnik: zwarta (znak i wersja w jednej linii), wiersze z uwagami na górze.
function pluginTable(rows, devs) {
  const need = rows.filter(dir => plugNeedsAttn(dir, devs)), rest = rows.filter(dir => !need.includes(dir));
  const both = need.length > 0 && rest.length > 0;
  const grp = (label, list) => h("tr", { class: "grp" },
    h("th", { scope: "colgroup", colspan: String(devs.length + 1) }, `${label} (${list.length})`));
  return [
    h("p", { class: "plugsent", id: "plug-sentence" }, plugSentence(rows, devs)),
    h("div", { class: "matrix-wrap" }, h("table", { class: "matrix pmx dense", "aria-label": "Wtyczki na czytnikach" },
      h("thead", {}, h("tr", {},
        h("th", { scope: "col" }, "Wtyczka"),
        devs.map(d => h("th", { scope: "col", class: "cell" }, d.name,
          !d.plugins_allowed && h("span", { class: "badge warn", title: CONSENT_SHORT + ". " + PLUG_STATE.consent.hint }, "bez zgody na wtyczki"))))),
      h("tbody", {},
        both && grp("Wymaga uwagi na czytniku", need), need.map(dir => pluginMatrixRow(dir, devs)),
        both && grp("Bez zmian", rest), rest.map(dir => pluginMatrixRow(dir, devs)))))];
}

// Listy poza tabelą (koligilo ich nie rusza, lista tylko pokazuje, co zgłosiły czytniki), osobno (TASK-43):
//   "manual"  — ręczne (i nieustalone), domyślnie rozwinięte, z podpowiedzią jak je przejąć,
//   "builtin" — wbudowane w KOReadera (kilkadziesiąt na czytnik), zwinięte.
// Nazwy w kolumnach, przy każdej kropki ●/○ w kolejności czytników (kształt, nie kolor), szukanie i filtr „tylko na części”.
const OTHER_KIND = {
  manual: { pre: "manual", id: "f-manualq", cls: "otherplug manualplug", noun: "ręcznych", title: n => `Ręczne na czytnikach (${n})` },
  builtin: { pre: "other", id: "f-otherq", cls: "otherplug", noun: "wbudowanych", title: n => `Wbudowane w KOReadera (${n})` },
};
function otherPluginsBlock(other, devs, kind) {
  const K = OTHER_KIND[kind], key = x => K.pre + x;
  const all = [...other].filter(([, o]) => o.builtin === (kind === "builtin")).map(([dir, o]) => ({ dir, ids: o.ids, label: pluginTitle(dir) }))
    .sort((a, b) => a.label.localeCompare(b.label, "pl"));
  if (all.length === 0) return null;
  const partial = x => x.ids.size < devs.length;
  const q = S[key("Q")].trim().toLowerCase();
  const hits = all.filter(x => (!S[key("Part")] || partial(x)) && (!q || (x.label + " " + x.dir).toLowerCase().includes(q)));
  const nPart = all.filter(partial).length;
  const dots = x => h("span", { class: "dots", "aria-label": devs.map(d => `${d.name}: ${x.ids.has(d.id) ? "jest" : "brak"}`).join(", "),
    title: devs.map(d => `${d.name}: ${x.ids.has(d.id) ? "jest" : "brak"}`).join("\n") }, devs.map(d => x.ids.has(d.id) ? "●" : "○").join(""));
  return h("details", { class: K.cls, open: S[key("Open")], ontoggle: ev => { S[key("Open")] = ev.target.open; } },
    h("summary", {}, K.title(all.length)),
    kind === "manual"
      ? h("p", { class: "muted small takeover" }, "koligilo ich nie aktualizuje ani nie usuwa, dopóki nie trafią na serwer. " + TAKEOVER_HINT)
      : h("p", { class: "muted small" }, "Wbudowane w KOReadera — koligilo ich nie rusza i nie da się ich przejąć. Lista tylko pokazuje, co czytniki zgłosiły."),
    h("div", { class: "row otherbar" },
      h("input", { type: "search", id: K.id, "aria-label": "Szukaj wśród " + K.noun, placeholder: `Szukaj wśród ${all.length}…`, value: S[key("Q")],
        oninput: ev => {
          const pos = ev.target.selectionStart;
          S[key("Q")] = ev.target.value; render();
          const el = document.getElementById(K.id);
          if (el) { el.focus(); el.setSelectionRange(pos, pos); }
        } }),
      h("button", { type: "button", class: "chip" + (!S[key("Part")] ? " on" : ""), "aria-pressed": String(!S[key("Part")]),
        onclick: () => { S[key("Part")] = false; render(); } }, `Wszystkie (${all.length})`),
      h("button", { type: "button", class: "chip" + (S[key("Part")] ? " on" : ""), "aria-pressed": String(S[key("Part")]),
        title: "Wtyczki, których nie ma na wszystkich czytnikach", onclick: () => { S[key("Part")] = true; render(); } }, `Tylko na części (${nPart})`)),
    h("p", { class: "muted small" }, "● jest na czytniku, ○ nie ma. Kolejność: " + devs.map(d => d.name).join(", ") + "."),
    kind === "manual" && h("p", { class: "muted small" }, "Czytnik, który nie rozróżnia katalogów (np. Kindle, Kobo) albo ma starszy plugin, nie zgłasza pochodzenia — wtedy wbudowana wtyczka spoza naszej listy też może trafić tutaj."),
    hits.length === 0 ? h("p", { class: "muted" }, q ? `Nic nie pasuje do „${S[key("Q")].trim()}”.` : "Brak wtyczek do pokazania.")
      : h("div", { class: "othercols" }, hits.map(x => h("div", {}, x.label, " ", dots(x)))));
}

function installedPanel() {
  const devs = S.state.devices, { rows, other } = pluginRows();
  const g = S.galUpdates, versions = S.plugins || [];
  const nUpd = (g && (g.updates || []).filter(u => u.update_available).length) || 0;
  const extraFav = favoriteReposNotInstalled(versions);
  const msg = S.plugMsg;
  return h("div", { class: "plugmatrix" },
    h("div", { class: "row plugbar" },
      h("button", { type: "button", class: "chip" + (S.favOnly ? " on" : ""), "aria-pressed": String(!!S.favOnly),
        onclick: () => { S.favOnly = !S.favOnly; render(); } }, "★ Tylko ulubione"),
      h("button", { type: "button", disabled: S.galUpdatesBusy, onclick: checkGalleryUpdates }, S.galUpdatesBusy ? "Sprawdzam…" : "Sprawdź aktualizacje"),
      h("span", { class: "muted small" }, !g ? "Aktualizacji jeszcze nie sprawdzano w tej sesji."
        : nUpd ? `${nUpd} ${plPl(nUpd, "wtyczka ma nowszą wersję", "wtyczki mają nowszą wersję", "wtyczek ma nowszą wersję")}.`
        : "Wszystkie wtyczki z galerii są aktualne." + (g.updated_at && !g.updated_at.startsWith("0001") ? " Sprawdzono: " + ago(g.updated_at) + "." : ""))),
    msg && h("p", { class: (msg.ok ? "ok" : "err") + " small", role: "status" }, msg.text),
    freshDevices().map(newDeviceCard),
    devs.length === 0
      ? h("p", { class: "muted" }, "Brak połączonych urządzeń — dodaj czytnik w zakładce „Urządzenia”.")
      : rows.length === 0
        ? h("p", { class: "muted" }, S.favOnly ? "Brak ulubionych wtyczek w magazynie."
            : "Panel nie ma jeszcze żadnej wtyczki — zacznij od „＋ Dodaj wtyczkę”.")
        : pluginTable(rows, devs),
    S.plugSel && plugDetail(),
    h("div", { class: "legend small muted", "aria-label": "Znaczenie znaków" },
      ["ok", "upd", "wait", "consent", "manual"].map(k => h("span", { title: PLUG_STATE[k].text }, plugGlyph(k), PLUG_SHORT[k])),
      h("span", { title: "Trafia do każdego nowego czytnika i do wszystkich obecnych" }, h("b", {}, "⇄"), " wspólna")),
    other.size > 0 && otherPluginsBlock(other, devs, "manual"),
    other.size > 0 && otherPluginsBlock(other, devs, "builtin"),
    !S.favOnly && extraFav.length > 0 && h("section", { class: "card", style: "margin-top:var(--card-gap)" },
      h("h3", { style: "margin-top:0" }, "Ulubione z galerii (jeszcze niezainstalowane)"),
      h("p", { class: "muted small", style: "margin-top:0" }, "Gwiazdka nie instaluje wtyczki — to tylko zakładka."),
      extraFav.map(full => h("div", { class: "row", style: "justify-content:space-between;align-items:center;padding:6px 0;border-top:1px solid var(--line)" },
        h("div", { style: "display:flex;align-items:center;gap:8px" }, favStar("gh:" + full),
          h("span", {}, h("span", { class: "pname" }, galleryTitle(full)), h("small", { class: "pdir" }, full))),
        h("button", { type: "button", onclick: () => openGalleryFor(full) }, "Znajdź w galerii")))));
}

// ------------------------------------------------ nowy czytnik: karta „3 kroki” (TASK-33)
//
// Czytnik, który jeszcze nie ma żadnej wtyczki od koligilo (ani przypisanej, ani zainstalowanej),
// dostaje nad macierzą listę kontrolną: zgoda na czytniku → wybór wtyczek → zatwierdzenie na
// czytniku. Krok 2 to skróty tego samego POST /api/admin/devices/{id}/plugins co ＋ w macierzy
// („Jak <inny czytnik>”, „Wszystkie z magazynu”) albo arkusz „Dodaj wtyczkę” dla jednego czytnika.
// Zgodę (krok 1) i zatwierdzenie (krok 3) robi się wyłącznie na czytniku — panel je tylko pokazuje (PC-004).

const NOPLUG_KEY = "koligilo.noPlugins.";
function noPlugGet(id) { try { return localStorage.getItem(NOPLUG_KEY + id) === "1"; } catch { return false; } }
function noPlugSet(id) { try { localStorage.setItem(NOPLUG_KEY + id, "1"); } catch {} render(); }

function freshDevices() {
  return S.state.devices.filter(d => !noPlugGet(d.id) && !(d.plugin_inventory || []).some(p => p.managed));
}

// zestaw do przypisania „jak na innym czytniku”: tylko wersje, które panel ma zaakceptowane
function plugSetFrom(other) {
  const out = {};
  for (const [dir, sha] of Object.entries(other.plugins || {})) if (pluginByHash(sha) && pluginByHash(sha).approved) out[dir] = sha;
  return out;
}
function plugSetAll() {
  const out = {};
  for (const dir of new Set((S.plugins || []).filter(v => v.approved).map(v => v.dir))) out[dir] = latestApproved(dir).sha256;
  return out;
}

function newDeviceCard(d) {
  const targets = Object.keys(d.plugins || {});
  const picked = targets.length > 0;
  const done3 = picked && targets.every(dir => plugCell(d, dir).k === "ok");
  const mark = ok => h("span", { class: "ckm" + (ok ? " done" : ""), "aria-hidden": "true" }, ok ? "☑" : "☐");
  const others = S.state.devices.filter(o => o.id !== d.id)
    .map(o => ({ o, set: plugSetFrom(o) })).filter(x => Object.keys(x.set).length > 0).slice(0, 2);
  const all = plugSetAll(), nAll = Object.keys(all).length;
  const busy = S.devPluginBusy === d.id;
  return h("section", { class: "card newdev", "aria-label": `Nowy czytnik ${d.name}` },
    h("h3", { style: "margin-top:0" }, `Czytnik „${d.name}” — trzy kroki do wtyczek`),
    h("ol", { class: "checklist" },
      h("li", {}, mark(d.plugins_allowed),
        h("div", {}, h("b", {}, d.plugins_allowed ? "Czytnik pozwolił na wtyczki" : "Na czytniku pozwól na wtyczki"),
          !d.plugins_allowed && h("div", { class: "muted small" }, `${MENU_PATH} → Zgody → Pozwól instalować wtyczki.`))),
      h("li", {}, mark(picked),
        h("div", {}, h("b", {}, picked ? `Wybrane wtyczki: ${targets.map(pluginTitle).join(", ")}` : "W panelu wybierz wtyczki"),
          !picked && h("div", { class: "row", style: "margin-top:6px" },
            others.map(x => h("button", { type: "button", disabled: busy, onclick: () => saveDevicePlugins(d, x.set) },
              `Jak ${x.o.name} (${Object.keys(x.set).length})`)),
            nAll > 0 && h("button", { type: "button", disabled: busy, onclick: () => saveDevicePlugins(d, all) }, `Wszystkie z magazynu (${nAll})`),
            h("button", { type: "button", disabled: busy, onclick: () => openAddSheet(nAll > 0 ? "magazyn" : "galeria", null, [d.id]) }, "Wybiorę sam…")))),
      h("li", {}, mark(done3),
        h("div", {}, h("b", {}, done3 ? "Zatwierdzone na czytniku" : "Na czytniku zatwierdź"),
          !done3 && h("div", { class: "muted small" }, picked ? SYNC_HINT : "Po wyborze wtyczek: Synchronizuj teraz i zatwierdź listę.")))),
    h("button", { type: "button", class: "linkbtn small", onclick: () => noPlugSet(d.id) }, "Ten czytnik nie potrzebuje wtyczek"));
}

function pluginMatrixRow(dir, devs) {
  const versions = (S.plugins || []).filter(v => v.dir === dir);
  const upd = updateFor(dir), pend = pendingVersions(dir);
  const sel = S.plugSel && S.plugSel.dir === dir;
  const shared = !!(S.state.shared_plugins || {})[dir];
  return h("tr", { class: (sel ? "sel" : "") + (S.plugFlash && S.plugFlash.has(dir) ? " flash" : "") },
    h("th", { scope: "row" },
      h("span", { class: "pmname" }, favStar("dir:" + dir),
        h("button", { type: "button", class: "linkbtn pmopen", "aria-expanded": String(!!(sel && !S.plugSel.dev)),
          onclick: () => plugSelect(dir, null) }, pluginLabel(dir)),
        h("button", { type: "button", class: "chip pin" + (shared ? " on" : ""), "aria-pressed": String(shared), disabled: S.sharedBusy,
          title: shared ? "Wspólna: trafia do każdego nowego czytnika i do wszystkich obecnych. Kliknij, żeby przestać (czytniki zachowują ją)."
            : "Dodaj do wtyczek wspólnych: trafi do wszystkich czytników i do każdego nowego.",
          onclick: () => toggleShared(dir) }, "⇄ wspólna"),
        upd && h("span", { class: "badge warn", title: "Nowsza wersja w galerii" }, "↑ " + (upd.latest_tag || upd.latest_sha.slice(0, 7))),
        pend.length > 0 && h("span", { class: "badge warn", title: "Wtyczka wysłana z czytnika czeka na Twoją akceptację" }, "czeka na akceptację"))),
    devs.map(d => {
      const c = plugCell(d, dir), on = S.plugSel && S.plugSel.dir === dir && S.plugSel.dev === d.id;
      const label = `${d.name}: ${pluginTitle(dir)} — ${plugStateText(c)}`;
      if (c.k === "none") {
        const v = latestApproved(dir);
        return h("td", { class: "cell" }, v
          ? h("button", { type: "button", class: "pcell none", title: `Przypisz ${v.version || v.sha256.slice(0, 12)} do ${d.name}`,
              "aria-label": `Przypisz ${pluginTitle(dir)} ${v.version || ""} do ${d.name}`, disabled: S.devPluginBusy === d.id,
              onclick: () => saveDevicePlugins(d, { ...(d.plugins || {}), [dir]: v.sha256 }) }, plugGlyph("none"))
          : h("span", { class: "muted", "aria-label": label, title: "Brak zaakceptowanej wersji" }, "–"));
      }
      return h("td", { class: "cell" }, h("button", { type: "button", class: "pcell " + c.k + (on ? " on" : ""), title: label, "aria-label": label,
        "aria-expanded": String(on), onclick: () => plugSelect(dir, d.id) },
        plugGlyph(c.k), h("span", { class: "vv" }, plugVer(c))));
    }));
}

// Wtyczki wspólne (PC-017): jedna lista dla wszystkich czytników. Zmiana listy dopisuje pozycję
// do stanu docelowego każdego sparowanego czytnika i każdego nowego; zdjęcie z listy niczego nie
// odinstalowuje. Zgodę i potwierdzenie instalacji nadal daje wyłącznie czytnik (PC-004).
async function saveShared(next, okText) {
  S.sharedBusy = true; S.plugMsg = null; render();
  try {
    const out = await api("POST", "/api/admin/shared-plugins", { plugins: next });
    S.plugMsg = { ok: true, text: okText(out.changed || []) };
  } catch (e) {
    S.plugMsg = { ok: false, text: e.message };
  }
  S.sharedBusy = false;
  await refresh();
}

function toggleShared(dir) {
  const shared = { ...(S.state.shared_plugins || {}) }, name = pluginTitle(dir);
  if (shared[dir]) {
    delete shared[dir];
    return saveShared(shared, () => `„${name}” nie jest już wspólna: nowe czytniki jej nie dostaną, a czytniki, które ją mają, ją zachowują.`);
  }
  const v = latestApproved(dir);
  if (!v) { S.plugMsg = { ok: false, text: `„${name}” nie ma zaakceptowanej wersji w panelu — zaakceptuj ją najpierw.` }; return render(); }
  if (!confirm(`Dodać „${name}” do wtyczek wspólnych?\n\nTrafi do wszystkich czytników (${S.state.devices.length}) i do każdego nowego. Czytnik i tak poprosi o potwierdzenie instalacji.`)) return;
  shared[dir] = v.sha256;
  return saveShared(shared, ch => `„${name}” jest wspólna.` + (ch.length ? ` Dopisano ją czytnikom: ${ch.join(", ")}. ${SYNC_HINT}` : " Wszystkie czytniki już ją mają."));
}

function plugSelect(dir, dev) {
  const same = S.plugSel && S.plugSel.dir === dir && S.plugSel.dev === dev;
  S.plugSel = same ? null : { dir, dev };
  S.plugMsg = null;
  render();
}

// Panel pod macierzą: zaznaczona wtyczka (i czytnik) — pełne zdanie stanu z podpowiedzią,
// wersje w magazynie, aktualizacja, akceptacja i usuwanie.
function plugDetail() {
  const { dir, dev } = S.plugSel;
  const d = dev ? S.state.devices.find(x => x.id === dev) : null;
  if (dev && !d) { S.plugSel = null; return null; }
  const versions = (S.plugins || []).filter(v => v.dir === dir)
    .sort((a, b) => String(b.added).localeCompare(String(a.added)));
  const c = d ? plugCell(d, dir) : null, upd = updateFor(dir);
  return h("section", { class: "card plugdetail", "aria-label": "Szczegóły wtyczki" },
    h("div", { class: "row", style: "justify-content:space-between;align-items:flex-start" },
      h("h3", { style: "margin:0" }, pluginLabel(dir), d && h("span", { class: "muted" }, " na " + d.name)),
      h("button", { type: "button", onclick: () => { S.plugSel = null; render(); } }, "Zamknij")),
    c && h("p", { class: "pdstate" }, plugGlyph(c.k), " ", h("b", {}, plugStateText(c)), plugVer(c) && h("span", { class: "vv" }, " · " + plugVer(c)),
      PLUG_STATE[c.k].hint && h("span", { class: "muted small", style: "display:block;margin-top:2px" }, PLUG_STATE[c.k].hint)),
    c && c.k === "manual" && h("p", { class: "muted small" },
      (c.inv && c.inv.origin === "builtin" ? "Wbudowana w KOReadera." : c.inv && c.inv.origin === "manual" ? "Zainstalowana ręcznie." : "Zainstalowana ręcznie albo wbudowana w KOReadera.")
      + " koligilo jej nie aktualizuje ani nie usuwa." + (!c.inv || c.inv.origin !== "builtin" ? " " + TAKEOVER_HINT : "")),
    c && c.k !== "manual" && h("div", { class: "row" },
      c.canRemove && h("button", { type: "button", class: "danger", disabled: S.devPluginBusy === d.id, onclick: () => removeDevicePlugin(d, dir) }, "Usuń z czytnika"),
      !c.canRemove && c.sha && h("span", { class: "muted small" }, "Zainstalowana ręcznie — nie da się usunąć z panelu.")),
    upd && updateRow(upd),
    versions.length > 0 && h("div", { class: "matrix-wrap" }, h("table", { class: "matrix plugins" },
      h("thead", {}, h("tr", {}, h("th", {}, "Wersja w panelu"), h("th", {}, "Źródło"), h("th", {}, "Pochodzenie"), h("th", {}, "Stan"), h("th", {}, "Akcje"))),
      h("tbody", {}, versions.map(v => {
        const pending = v.source === "urządzenie" && !v.approved, isTarget = d && (d.plugins || {})[dir] === v.sha256;
        return h("tr", {},
          h("td", {}, v.version || v.sha256.slice(0, 12)),
          h("td", {}, v.source),
          h("td", { class: "muted small" }, v.source_ref || "—"),
          h("td", {}, pending ? h("span", { class: "badge warn" }, "czeka na akceptację") : isTarget ? h("span", { class: "ok" }, "przypisana") : h("span", { class: "ok" }, "zaakceptowana")),
          h("td", {}, pending
            ? h("button", { type: "button", class: "primary", disabled: S.approveBusy === v.sha256, onclick: () => approvePlugin(v) }, S.approveBusy === v.sha256 ? "Akceptuję…" : "Zaakceptuj")
            : d && !isTarget && h("button", { type: "button", disabled: S.devPluginBusy === d.id,
                onclick: () => saveDevicePlugins(d, { ...(d.plugins || {}), [dir]: v.sha256 }) }, "Przypisz do " + d.name)));
      })))));
}

// Wtyczki → „Ustawienia wtyczek” (TASK-26): ustawienia samych wtyczek, osobno od
// „Ustawień czytników” (urządzenie/KOReader). Każda wtyczka to sekcja z nagłówkiem —
// na razie tylko KOPad (mapowanie przycisków gamepada, PC-011/PC-012). Stan edycji
// (S.pad.drafts) żyje w S, więc przeżywa odświeżanie w tle (interwał na dole pliku
// odświeża tę zakładkę, choć pozostałych zakładek „Wtyczek” nie).
function pluginSettingsPanel() {
  return h("div", { class: "plugset" },
    rosettaSettingsSection(),
    assistantSettingsSection(),
    h("section", { "aria-labelledby": "plugset-kopad" },
      h("h2", { id: "plugset-kopad" }, "KOPad"),
      kopadCard()));
}

// --- Rosetta: ustawienia tłumaczenia (TASK-40) ---
//
// Grupa katalogu „rosetta_ustawienia” (settings/rosetta.lua) miała dotąd tylko surowe
// wartości w „Zaawansowane”. Tu te same klucze dostają zwykłe kontrolki (te same co
// „Ustawienia czytników”: settingRow/control → ctlSave → luaSerialize). Domyślne wartości
// to domyślne wtyczki (rosetta_config.lua). Klucze API i adres modelu to osobna grupa
// (sekret) i żyją w „Konta” → Rosetta; formatting_mode, font_size i book__* zostają poza panelem.
const ROSETTA_FILE = "settings/rosetta.lua";
const ROSETTA_LANGS = [["auto", "wykryj automatycznie"], ["pl", "polski"], ["en", "angielski"], ["de", "niemiecki"], ["fr", "francuski"],
  ["es", "hiszpański"], ["it", "włoski"], ["la", "łacina"], ["el", "grecki"], ["ru", "rosyjski"], ["ar", "arabski"], ["fa", "perski"], ["tr", "turecki"]];
const ROSETTA_OPTS = [
  { key: "backend", kind: "choice", label: "Skąd bierze się tłumaczenie", default: "google",
    values: ["google", "ai", "aligned"], labels: ["Google Translate", "Model AI", "Gotowy przekład"],
    help: ["Google Translate działa od razu i nie wymaga klucza. Model AI tłumaczy z kontekstem (poprzednia i następna strona) i potrzebuje dostępu do modelu — wpisz go w „Konta” → Rosetta.",
      "„Gotowy przekład” podaje ludzkie tłumaczenie z pliku parallel-aligned.json obok książki (paraligilo); akapity, których w nim brakuje, tłumaczy model AI, więc i tu przyda się klucz."] },
  { key: "source_lang", kind: "text", label: "Język oryginału", default: "auto", suggest: ROSETTA_LANGS, placeholder: "auto",
    help: ["Kod języka książki (np. la, el, ar) albo „auto”, żeby wtyczka sama go wykryła."] },
  { key: "target_lang", kind: "text", label: "Język tłumaczenia", default: "en", suggest: ROSETTA_LANGS, placeholder: "pl",
    help: ["Kod języka, na który tłumaczysz (np. pl). Wtyczka domyślnie tłumaczy na angielski."] },
  { key: "auto_translate", kind: "switch", label: "Tłumacz od razu po otwarciu strony", default: true, on: true, off: false,
    help: ["Wyłączone: panel tłumaczenia pokazuje tekst dopiero po ręcznym wywołaniu tłumaczenia."] },
  { key: "panel_height_ratio", kind: "choice", label: "Wysokość panelu tłumaczenia", default: 0.5,
    values: [0.3, 0.4, 0.5, 0.6], labels: ["30%", "40%", "50%", "60%"], custom: { min: 0.2, max: 0.8, step: 0.05 },
    help: ["Jaką część ekranu zajmuje panel z tłumaczeniem, jako ułamek: 0,5 to połowa ekranu."] },
  { key: "font_size_percent", kind: "choice", label: "Rozmiar tekstu w panelu", default: 100, unit: "%",
    values: [70, 80, 90, 100, 110], labels: ["70", "80", "90", "100", "110"], custom: { min: 40, max: 200, step: 5 },
    help: ["Rozmiar czcionki w panelu jako procent rozmiaru czcionki książki (100 = taki sam)."] },
  { key: "line_spacing_override", kind: "choice", label: "Interlinia w panelu", default: 0, unit: "%",
    values: [0, 100, 120, 130, 150], labels: ["jak w książce", "100", "120", "130", "150"], custom: { min: 50, max: 200, step: 5 },
    help: ["„Jak w książce” zostawia interlinię książki; liczba to własna interlinia w procentach."] },
  { key: "paragraph_indent_chars", kind: "choice", label: "Wcięcie akapitu w panelu", default: 0, unit: "znaki",
    values: [0, 2, 4, 6], labels: ["brak", "2", "4", "6"], custom: { min: 0, max: 20, step: 1 },
    help: ["Ile spacji dopisać na początku każdego akapitu tłumaczenia."] },
  { key: "font_override", kind: "text", label: "Czcionka panelu", default: "", allowEmpty: true, placeholder: "jak w książce",
    help: ["Nazwa czcionki dokładnie tak, jak w KOReaderze (np. Alegreya Sans). Puste pole: czcionka książki."] },
  { key: "anchor_min_confidence", kind: "choice", label: "Próg pewności dopasowania", default: 0,
    values: [0, 0.5, 0.8], labels: ["pokaż wszystko", "0,5", "0,8"], custom: { min: 0, max: 1, step: 0.05 },
    help: ["Dotyczy tylko „Gotowego przekładu”: pary akapitów dopasowane z mniejszą pewnością są pomijane. 0 pokazuje każdą parę, także niepewną."] },
  { key: "clear_cache_on_start", kind: "switch", label: "Czyść pamięć tłumaczeń przy starcie", default: false, on: true, off: false,
    help: ["Opcja diagnostyczna: po każdym uruchomieniu KOReadera tłumaczenia zapisane na czytniku znikają i wtyczka tłumaczy strony od nowa."] },
];

function rosettaSettingsSection() {
  const g = catalogGroup("rosetta_ustawienia");
  if (!g) return null;
  const byId = new Map(S.state.values.map(v => [v.id, v]));
  const on = S.state.devices.filter(d => d.groups && d.groups.rosetta_ustawienia).map(d => d.name);
  const rows = ROSETTA_OPTS.map(o => {
    const id = idFor(ROSETTA_FILE, o.key);
    return id && settingRow(o, id, byId.get(id), "");
  }).filter(Boolean);
  // backend „Model AI” i „Gotowy przekład” (model na brakujące akapity) potrzebują klucza z „Konta”
  const bid = idFor(ROSETTA_FILE, "backend"), bcv = currentValue(bid && byId.get(bid));
  const backend = bcv.state === "ok" ? bcv.value : "google";
  const noKey = S.acc && (backend === "ai" || backend === "aligned") && !S.acc.rosetta?.has_api_key;
  return h("section", { "aria-labelledby": "plugset-rosetta" },
    h("h2", { id: "plugset-rosetta" }, "Rosetta"),
    h("div", { class: "card sgroup rosettaset" },
      noKey && h("div", { class: "padwarn", role: "alert" },
        h("p", {}, h("strong", {}, "Brakuje klucza do modelu AI")),
        h("p", { class: "small" }, backend === "ai" ? "Wybrano tłumaczenie modelem AI, a w „Konta” nie ma zapisanego klucza, więc Rosetta nie przetłumaczy żadnej strony. "
          : "Akapity, których nie ma w gotowym przekładzie, tłumaczy model AI, a w „Konta” nie ma zapisanego klucza. ",
          h("button", { type: "button", class: "linkbtn", onclick: () => { S.accOpen = "rosetta"; showTab("konta"); } }, "Dodaj klucz"))),
      h("p", { class: "muted small padintro" },
        "Rosetta tłumaczy stronę na żywo i pokazuje przekład w panelu pod tekstem. Tu ustawiasz język, sposób tłumaczenia i wygląd panelu — wartości trafiają na czytniki, które mają włączoną grupę „Rosetta — ustawienia tłumaczenia”. ",
        on.length ? `Teraz dostają ją: ${on.join(", ")}. ` : "Żaden czytnik jej jeszcze nie dostaje — włącz ją w „Co synchronizować”. ",
        "Dostęp do modelu AI (adres, model, klucz) wpisujesz osobno, w „Konta” → Rosetta: ",
        h("button", { type: "button", class: "linkbtn", onclick: () => { S.accOpen = "rosetta"; showTab("konta"); } }, "przejdź do kluczy"), "."),
      rows));
}

// --- Asystent AI: ustawienia wtyczki assistant (TASK-47) ---
//
// Grupa katalogu „asystent” (settings/assistant.lua). Domyślne wartości sprawdzone w źródle wtyczki
// (assistant_settings.lua / assistant_dialog.lua: readSetting("klucz", domyślna)). Pól bez
// potwierdzonej wartości domyślnej (provider, języki) nie wypełniamy: panel pokazuje „nie ustawiono”.
// Klucze API i lista dostawców to configuration.lua w katalogu wtyczki na czytniku — poza katalogiem
// koligilo, więc nigdy nie wędrują. previous_config_ai_provider to wewnętrzny znacznik wtyczki
// (zostaje w „Zaawansowane”).
const ASSISTANT_FILE = "settings/assistant.lua";
const ASSISTANT_LANGS = [["Polish", "polski"], ["English", "angielski"], ["German", "niemiecki"], ["French", "francuski"],
  ["Spanish", "hiszpański"], ["Italian", "włoski"], ["Latin", "łacina"], ["Greek", "grecki"], ["Russian", "rosyjski"], ["Arabic", "arabski"]];
const ASSISTANT_OPTS = [
  { key: "provider", kind: "text", label: "Dostawca AI", placeholder: "np. openai",
    help: ["Nazwa wpisu z listy dostawców w configuration.lua na czytniku (np. openai, anthropic). Jeśli czytnik nie ma dostawcy o takiej nazwie, wtyczka wybierze innego i nadpisze to ustawienie — dlatego włączaj to tylko, gdy czytniki mają te same nazwy dostawców.",
      "Gdy zmienisz dostawcę domyślnego w configuration.lua, wtyczka przy następnym uruchomieniu przełączy się na niego niezależnie od tej wartości."] },
  { key: "response_language", kind: "text", label: "Język odpowiedzi AI", suggest: ASSISTANT_LANGS, placeholder: "język interfejsu",
    help: ["Język, w którym AI ma odpowiadać (nazwa po angielsku trafia do zapytania, np. Polish). Nie ustawiono: język interfejsu KOReadera. Żeby wrócić do tego stanu, użyj „usuń” pod kontrolką."] },
  { key: "dict_language", kind: "text", label: "Język słownika", suggest: ASSISTANT_LANGS, placeholder: "język interfejsu",
    help: ["Język objaśnień w oknie słownika AI. Nie ustawiono: język interfejsu KOReadera. Żeby wrócić do tego stanu, użyj „usuń” pod kontrolką."] },
  { key: "dict_popup_show_dictionary", kind: "switch", label: "„Słownik (AI)” w oknie słownika", default: true, on: true, off: false,
    help: ["Dodaje przycisk Słownik (AI) do okna, które otwiera się po dotknięciu słowa w słowniku KOReadera."] },
  { key: "dict_popup_show_wikipedia", kind: "switch", label: "„Wikipedia (AI)” w oknie słownika", default: true, on: true, off: false,
    help: ["Dodaje przycisk Wikipedia (AI) do tego samego okna."] },
  { key: "use_stream_mode", kind: "switch", label: "Odpowiedź na żywo (strumień)", default: true, on: true, off: false,
    help: ["Odpowiedź pojawia się słowo po słowie, w miarę jak AI ją pisze. Wyłączone: czytnik czeka na całość."] },
  { key: "stream_mode_auto_scroll", kind: "switch", label: "Przewijaj odpowiedź w trakcie pisania", default: true, on: true, off: false,
    help: ["Ma znaczenie tylko przy odpowiedzi na żywo: okno samo przewija się za nowym tekstem."] },
  { key: "large_stream_dialog", kind: "switch", label: "Duże okno odpowiedzi na żywo", default: true, on: true, off: false,
    help: ["Ma znaczenie tylko przy odpowiedzi na żywo: okno strumienia zajmuje większą część ekranu."] },
  { key: "auto_copy_asked_question", kind: "switch", label: "Kopiuj zadane pytanie do schowka", default: true, on: true, off: false,
    help: ["Po wysłaniu pytania jego treść trafia do schowka czytnika. Działa tylko na urządzeniach, które mają schowek."] },
];

function assistantSettingsSection() {
  const g = catalogGroup("asystent");
  if (!g) return null;
  const byId = new Map(S.state.values.map(v => [v.id, v]));
  const on = S.state.devices.filter(d => d.groups && d.groups.asystent).map(d => d.name);
  const rows = ASSISTANT_OPTS.map(o => {
    const id = idFor(ASSISTANT_FILE, o.key);
    return id && settingRow(o, id, byId.get(id), "");
  }).filter(Boolean);
  return h("section", { "aria-labelledby": "plugset-assistant" },
    h("h2", { id: "plugset-assistant" }, "Asystent AI"),
    h("div", { class: "card sgroup assistantset" },
      h("p", { class: "muted small padintro" },
        "Asystent AI odpowiada na pytania o zaznaczony tekst. Tu ustawiasz język, okno odpowiedzi i słownik — wartości trafiają na czytniki, które mają włączoną grupę „Asystent AI (assistant)”. ",
        on.length ? `Teraz dostają ją: ${on.join(", ")}. ` : "Żaden czytnik jej jeszcze nie dostaje — włącz ją w „Co synchronizować”. "),
      h("p", { class: "muted small padintro" },
        "Klucze API i lista dostawców leżą w pliku configuration.lua w katalogu wtyczki na czytniku (assistant.koplugin) i NIE są synchronizowane — każdy czytnik wpisujesz osobno."),
      rows));
}
// --- ulubione (TASK-20) ---
//
// Gwiazdki trzymają się na górze macierzy „Zainstalowane” (filtr „Tylko ulubione”)
// i w arkuszu „Dodaj wtyczkę”. Ulubione ≠ instalacja: to tylko zakładka.

function isFav(key) { return !!(S.state && S.state.favorites && S.state.favorites.includes(key)); }

async function toggleFavorite(key, on) {
  S.favBusy = key; render();
  try { await api(on ? "PUT" : "DELETE", "/api/admin/plugins/favorites", { key }); }
  catch (e) { S.error = e.message; }
  S.favBusy = null;
  refresh();
}

function favStar(key) {
  const on = isFav(key);
  const what = key.startsWith("gh:") ? galleryTitle(key.slice(3)) : key.startsWith("dir:") ? pluginTitle(key.slice(4)) : key;
  return h("button", {
    type: "button", class: "star" + (on ? " on" : ""), "aria-pressed": String(on), disabled: S.favBusy === key,
    "aria-label": (on ? "Usuń z ulubionych: " : "Dodaj do ulubionych: ") + what,
    title: on ? "Ulubione — kliknij, żeby usunąć" : "Dodaj do ulubionych",
    onclick: ev => { ev.stopPropagation(); toggleFavorite(key, !on); },
  }, on ? "★" : "☆");
}

// dirGalleryRepos: repozytoria galerii, z których pochodzi którakolwiek
// wersja tego katalogu (zwykle jedno; monorepo — nieistotne dla ulubionych).
function dirGalleryRepos(versions) {
  const set = new Set();
  for (const v of versions) {
    if (v.source === "galeria" && v.source_ref) {
      const at = v.source_ref.lastIndexOf("@");
      if (at > 0) set.add(v.source_ref.slice(0, at).toLowerCase());
    }
  }
  return [...set];
}

// dirIsFavorite: katalog liczy się jako ulubiony, gdy oznaczono gwiazdką
// wprost ("dir:") albo gdy ulubione jest repozytorium galerii, z którego pochodzi.
function dirIsFavorite(dir, versions) {
  if (isFav("dir:" + dir)) return true;
  return dirGalleryRepos(versions).some(full => isFav("gh:" + full));
}

// favoriteReposNotInstalled: ulubione repozytoria galerii, których jeszcze
// nie ma w magazynie — ulubione ≠ instalacja (TASK-20), więc mogą tu wisieć
// bez żadnej przypisanej wersji.
function favoriteReposNotInstalled(versions) {
  const installed = new Set(dirGalleryRepos(versions));
  return (S.state.favorites || [])
    .filter(k => k.startsWith("gh:"))
    .map(k => k.slice(3))
    .filter(full => !installed.has(full.toLowerCase()))
    .sort();
}

function openGalleryFor(full) {
  openAddSheet("galeria", full);
}
async function approvePlugin(v) {
  if (!confirm(
    `Zaakceptować „${pluginVerName(v)}” (katalog ${v.dir}, wersja ${v.version || v.sha256.slice(0, 12)}) przysłaną z czytnika (${v.source_ref})?\n\n` +
    "To kod z czytnika, nie z galerii ani z ręcznego uploadu — po akceptacji będzie można przypisać go INNYM urządzeniom. Sprawdź, czy to na pewno wtyczka, której się spodziewasz.")) return;
  S.approveBusy = v.sha256; render();
  try {
    await api("POST", `/api/admin/plugins/${v.sha256}/approve`);
  } catch (e) {
    S.error = e.message;
  }
  S.approveBusy = null;
  refresh();
}
function updateRow(u) {
  const key = u.repo;
  const busy = S.galUpdateBusy === key;
  const msg = S.galUpdateMsg[key];
  return h("article", { class: "card", style: "margin-bottom:10px" },
    h("h4", { style: "margin:0 0 4px" }, u.dir ? pluginLabel(u.dir) : galleryTitle(u.repo), " ",
      h("span", { class: "badge warn" }, "dostępna aktualizacja")),
    h("p", { class: "muted small", style: "margin:0 0 6px" },
      `${u.current_version || u.current_sha.slice(0, 12)} → ${u.latest_tag || u.latest_sha.slice(0, 12)}` +
      (u.published_at && !u.published_at.startsWith("0001") ? ` · opublikowano ${ago(u.published_at)}` : "")),
    u.changelog && h("details", {},
      h("summary", {}, "Changelog"),
      h("pre", { class: "changelog" }, u.changelog)),
    h("p", { class: "muted small" },
      h("a", { href: u.html_url, target: "_blank", rel: "noopener" }, "Repozytorium / release na GitHubie ↗")),
    h("p", { class: "muted small", style: "margin:0 0 8px" },
      "Aktualizacja instaluje nowy sha do magazynu i podmienia go w stanie docelowym urządzeń, które miały starą wersję. Czytnik i tak zapyta o osobną zgodę na instalację."),
    h("button", { class: "primary", disabled: busy, onclick: () => applyGalleryUpdate(u) }, busy ? "Aktualizuję…" : "Aktualizuj"),
    msg && h("p", { class: msg.ok ? "ok" : "err" }, msg.text));
}

async function checkGalleryUpdates() {
  S.galUpdatesBusy = true; render();
  try {
    S.galUpdates = await api("POST", "/api/admin/gallery/updates/check");
  } catch (e) {
    S.error = e.message;
  }
  S.galUpdatesBusy = false;
  render();
}

async function applyGalleryUpdate(u) {
  S.galUpdateBusy = u.repo; S.galUpdateMsg[u.repo] = null; render();
  try {
    const out = await api("POST", "/api/admin/gallery/update", { repo: u.repo });
    const devs = out.devices && out.devices.length ? ` Zaktualizowano cel u: ${out.devices.join(", ")}.` : " Żadne urządzenie nie miało jeszcze przypisanej starej wersji.";
    S.galUpdateMsg[u.repo] = { ok: true, text: `Zainstalowano ${out.plugin.version || out.plugin.sha256.slice(0, 12)}.` + devs };
  } catch (e) {
    S.galUpdateMsg[u.repo] = { ok: false, text: e.message };
  }
  S.galUpdateBusy = null;
  await checkGalleryUpdates();
  refresh();
}

// Plik .zip z wtyczką (strefa upuszczania w arkuszu): wgrywa się od razu po upuszczeniu albo wyborze
// pliku, a arkusz przechodzi do kroku 2 z tą wtyczką (wgrana wersja jest od razu zaakceptowana).
async function uploadPlugin(files) {
  files = [...(files || [])];
  const file = files[0];
  if (!file) { S.uploadMsg = { ok: false, text: "Wybierz plik .zip." }; return render(); }
  if (!/\.zip$/i.test(file.name)) { S.uploadMsg = { ok: false, text: `„${file.name}” to nie jest plik .zip.` }; return render(); }
  S.uploadBusy = true; S.uploadMsg = null; render();
  let out = null;
  try {
    const fd = new FormData();
    fd.append("file", file);
    out = await apiUpload("/api/admin/plugins", fd);
  } catch (e) {
    S.uploadMsg = { ok: false, text: e.message };
  }
  S.uploadBusy = false;
  const sh = S.addSheet;
  if (out && sh) {
    Object.assign(sh, newSheet("magazyn"), { devices: sh.devices, picks: sh.picks, shared: sh.shared, sha: out.plugin.sha256, step: 2 });
    sh.msg = { ok: true, text: `Wgrano „${pluginVerName(out.plugin)}” (${out.plugin.version || out.plugin.sha256.slice(0, 12)}).` + (files.length > 1 ? " Wgrałem tylko pierwszy plik — pozostałe wgraj osobno." : "") };
  }
  await refresh();
  document.getElementById(out ? "sh-go" : "f-plugin-pick")?.focus();
}
async function removeDevicePlugin(d, dir) {
  if (!confirm(`Usunąć wtyczkę „${pluginTitle(dir)}” z celu urządzenia „${d.name}”?\n\nPrzy najbliższej synchronizacji czytnik poprosi o potwierdzenie odinstalowania.`)) return;
  const next = { ...(d.plugins || {}) };
  delete next[dir];
  await saveDevicePlugins(d, next);
}

async function saveDevicePlugins(d, next) {
  S.devPluginBusy = d.id; S.plugMsg = null; render();
  try {
    await api("POST", `/api/admin/devices/${d.id}/plugins`, { plugins: next });
    S.plugMsg = { ok: true, text: `Zapisane dla „${d.name}”. Czytnik poprosi o potwierdzenie przy najbliższej synchronizacji.` };
  } catch (e) {
    S.plugMsg = { ok: false, text: e.message };
  }
  S.devPluginBusy = null;
  refresh();
}

// ------------------------------------------------ zakładka: galeria wtyczek (TASK-10)
//
// "Dostępna aktualizacja": od TASK-12 to dane z serwera (GET
// /api/admin/gallery/updates — porównanie sha release'u/commita z sha
// przypiętym w source_ref, patrz gallery.go CheckUpdates), a nie heurystyka
// po numerze wersji z _meta.lua. Dopóki S.galUpdates się nie wczyta (albo dla
// repo, którego jeszcze nie sprawdzono), zostaje przybliżenie po tagu — proste
// i tanie, bez dodatkowego zapytania do GitHuba.

function galleryVersionsFor(repo) {
  const prefix = repo.full_name.toLowerCase() + "@";
  return (S.plugins || []).filter(v => v.source === "galeria" && (v.source_ref || "").toLowerCase().startsWith(prefix));
}

function galleryUpdateAvailable(repo, versions) {
  if (S.galUpdates) {
    const u = (S.galUpdates.updates || []).find(x => x.repo.toLowerCase() === repo.full_name.toLowerCase());
    if (u) return u.update_available;
  }
  if (!repo.latest_release || versions.length === 0) return false;
  const tag = repo.latest_release.replace(/^v/i, "").toLowerCase();
  return !versions.some(v => (v.version || "").replace(/^v/i, "").toLowerCase() === tag);
}

async function refreshGallery() {
  S.galBusy = true; render();
  try { await api("POST", "/api/admin/gallery/refresh"); }
  catch (e) { S.error = e.message; }
  S.galBusy = false;
  refresh();
}

// ------------------------------------------------ arkusz „Dodaj wtyczkę” (TASK-33, TASK-54)
//
// Kreator w dwóch krokach: 1) źródło (kafle: galeria / własny plik .zip / już w panelu) i wybór
// wtyczek — z galerii można zaznaczyć kilka naraz — 2) czytniki, ostrzeżenie i „Dodaj”. To te same
// wywołania co wcześniej (gallery/install, plugins, devices/{id}/plugins, shared-plugins), więc PC-004
// bez zmian: przypisanie to stan docelowy, a instalację potwierdza czytnik. Przed instalacją wtyczek
// spoza koligilo stoi pełne ostrzeżenie o zewnętrznym kodzie (jedno na cały wybór).
// Arkusz mieszka w S.addSheet (przeżywa przerysowania; render() odtwarza przewinięcie i fokus).
// Wybór z galerii (sh.picks) przeżywa szukanie, zmianę strony i zmianę źródła; z magazynu wybiera się jedną
// wtyczkę (sh.sha). Instalacje z galerii idą po kolei, a przypisanie to jeden zapis na czytnik ze
// WSZYSTKIMI nowymi wtyczkami naraz — kolejne zapisy z tego samego stanu urządzenia nadpisywałyby poprzednie.

function newSheet(src) {
  return { src, picks: [], sha: null, devices: null, shared: false, busy: false, prog: null, msg: null, step: 1 };
}

function openAddSheet(src, q, devIds) {
  S.addSheet = newSheet(src || "galeria");
  if (devIds) S.addSheet.devices = new Set(devIds);
  if (q != null) { S.galQ = q; S.galPage = 1; }
  render(); // arkusz od razu; galeria (GitHub) dociąga się w tle
  return refresh().then(() => document.getElementById(S.addSheet && S.addSheet.src === "galeria" ? "f-galq" : "sh-close")?.focus());
}

function closeAddSheet() {
  S.addSheet = null;
  render();
  document.getElementById("b-add")?.focus();
}

function sheetSrc(id) {
  const sh = S.addSheet;
  Object.assign(sh, newSheet(id), { devices: sh.devices, picks: sh.picks, shared: sh.shared });
  S.uploadMsg = null;
  return refresh().then(() => document.getElementById(id === "galeria" ? "f-galq" : "sh-src-" + id)?.focus());
}

// czytniki zaznaczone domyślnie: te, które już pozwoliły na wtyczki (reszta i tak czekałaby na zgodę)
function sheetDevices(sh) {
  if (!sh.devices) sh.devices = new Set(S.state.devices.filter(d => d.plugins_allowed).map(d => d.id));
  return sh.devices;
}

// wybrane wtyczki: z galerii (sh.picks) albo jedna z magazynu (sh.sha)
function sheetPicked(sh) {
  if (sh.src === "galeria") return sh.picks.map(pk => ({ name: galleryTitle(pk.repo.full_name), pk }));
  if (sh.src === "magazyn" && sh.sha) {
    const v = (S.plugins || []).find(x => x.sha256 === sh.sha);
    return v ? [{ name: pluginVerName(v), v }] : [];
  }
  return [];
}
const sheetStep2 = sh => sh.step === 2 && sheetPicked(sh).length > 0;

function sheetGoStep(n) {
  const sh = S.addSheet;
  sh.step = n; sh.msg = null;
  render();
  document.getElementById(n === 2 ? "sh-go" : "sh-next")?.focus();
}

const SHEET_SRCS = [["galeria", "Galeria", "Szukasz w katalogu na GitHubie."], ["zip", "Własny plik .zip", "Masz plik .zip z wtyczką."],
  ["magazyn", "Już w panelu", "Wtyczka jest już w panelu."]];

function sheetTiles(sh) {
  return h("div", { class: "shtiles", role: "group", "aria-label": "Skąd wziąć wtyczkę" },
    SHEET_SRCS.map(([id, label, hint]) => h("button", { type: "button", id: "sh-src-" + id, class: "shtile" + (sh.src === id ? " on" : ""),
      "aria-pressed": String(sh.src === id), disabled: sh.busy, onclick: () => sh.src !== id && sheetSrc(id) },
      h("b", {}, label), h("span", { class: "muted small" }, hint))));
}

function addSheet() {
  const sh = S.addSheet, s2 = sheetStep2(sh);
  return h("div", { class: "sheet-back", onmousedown: ev => { if (ev.target === ev.currentTarget && !sh.busy) closeAddSheet(); } },
    h("div", { class: "sheet addsheet" + (sh.src !== "zip" ? " tall" : ""), role: "dialog", "aria-modal": "true", "aria-labelledby": "sheet-title" },
      h("header", { class: "sheet-head" },
        h("h2", { id: "sheet-title" }, "Dodaj wtyczkę"),
        h("button", { type: "button", id: "sh-close", "aria-label": "Zamknij", disabled: sh.busy, onclick: closeAddSheet }, "×")),
      !s2 && sheetTiles(sh),
      h("div", { class: "sheet-body" },
        s2 ? sheetCards(sh) : sh.src === "galeria" ? sheetGallery(sh) : sh.src === "zip" ? sheetZip(sh) : sheetStore(sh)),
      sheetFoot(sh)));
}

function sheetGallery(sh) {
  const g = S.gallery;
  return h("div", {},
    h("form", { class: "row", onsubmit: ev => { ev.preventDefault(); S.galPage = 1; refresh().then(() => document.getElementById("f-galq")?.focus()); } },
      h("input", { type: "search", id: "f-galq", "aria-label": "Szukaj wtyczek", "aria-keyshortcuts": "/", value: S.galQ,
        placeholder: "szukaj po nazwie lub opisie  ( / )", style: "flex:1;min-width:180px",
        oninput: ev => { S.galQ = ev.target.value; } }),
      h("select", { "aria-label": "Sortowanie", onchange: ev => { S.galSort = ev.target.value; S.galPage = 1; refresh(); } },
        h("option", { value: "stars", selected: S.galSort === "stars" || undefined }, "gwiazdki"),
        h("option", { value: "updated", selected: S.galSort === "updated" || undefined }, "ostatnia aktualizacja")),
      h("button", { type: "submit" }, "Szukaj")),
    h("p", { class: "muted small", style: "margin:8px 0 0" },
      "Wtyczki spoza koligilo to cudzy kod. Ostrzeżenie pojawi się przed dodaniem. Możesz wybrać kilka wtyczek naraz — wybór zostaje przy szukaniu i zmianie strony."),
    !g ? h("p", { class: "loading" }, "Wczytuję galerię…") : [
      g.note && h("p", { class: "muted small" }, g.note),
      g.stale && h("p", { class: "muted small" }, "Dane mogą być nieaktualne (starsze niż 24 h). ",
        h("button", { type: "button", class: "linkbtn", disabled: S.galBusy, onclick: refreshGallery }, S.galBusy ? "Odświeżam…" : "Odśwież z GitHuba")),
      (g.promoted || []).length > 0 && g.page === 1 && h("section", {},
        h("h3", { class: "shhead" }, "Od autora koligilo"),
        (g.promoted || []).map(r => sheetRepoRow(r, true))),
      h("h3", { class: "shhead" }, (g.promoted || []).length > 0 && g.page === 1 ? "Społeczność" : "Wyniki"),
      (g.repos || []).length === 0
        ? h("p", { class: "muted" }, (g.promoted || []).length > 0 ? "Nic więcej nie znaleziono." : "Nic nie znaleziono.")
        : (g.repos || []).map(r => sheetRepoRow(r, false)),
      h("div", { class: "row", style: "margin-top:10px" },
        h("span", { class: "muted small" }, `Repozytoria: ${g.total}, strona ${g.page}` + (g.updated_at && !g.updated_at.startsWith("0001") ? ` · odświeżono ${ago(g.updated_at)}` : "")),
        S.galPage > 1 && h("button", { type: "button", onclick: () => { S.galPage--; refresh(); } }, "← Wstecz"),
        g.total > g.page * 30 && h("button", { type: "button", onclick: () => { S.galPage++; refresh(); } }, "Więcej wyników →"))]);
}

function sheetRepoRow(repo, promoted) {
  const sh = S.addSheet, on = sh.picks.some(p => p.repo.full_name === repo.full_name);
  const versions = galleryVersionsFor(repo), update = galleryUpdateAvailable(repo, versions);
  const id = "sh-r-" + repo.full_name.replace(/\W/g, "_");
  return h("div", { class: "shrow" + (on ? " on" : "") },
    favStar("gh:" + repo.full_name),
    h("div", { class: "grow" },
      h("div", {}, h("b", {}, galleryTitle(repo.full_name)),
        versions.length > 0 && h("span", { class: "badge" }, "w panelu"),
        update && h("span", { class: "badge warn" }, "nowsza wersja")),
      h("div", { class: "muted small" },
        `${repo.full_name} · ★ ${repo.stars} · aktualizacja ${ago(repo.pushed_at)}` + (repo.latest_release ? ` · release ${repo.latest_release}` : "")),
      h("div", { class: "small shdesc" }, repo.description || h("span", { class: "muted" }, "(brak opisu)"))),
    h("div", { class: "shact" },
      h("a", { href: repo.html_url || `https://github.com/${repo.full_name}`, target: "_blank", rel: "noopener",
        "aria-label": `Repozytorium ${repo.full_name} na GitHubie` }, "GitHub ↗"),
      h("button", { type: "button", id, class: on ? "primary" : "", "aria-pressed": String(on), disabled: sh.busy,
        onclick: () => sheetTogglePick(repo, promoted) }, on ? "✓ Wybrano" : "Wybierz")));
}

function sheetTogglePick(repo, promoted) {
  const sh = S.addSheet, i = sh.picks.findIndex(p => p.repo.full_name === repo.full_name);
  if (i >= 0) sh.picks.splice(i, 1);
  else sh.picks.push({ repo, promoted, path: "", candidates: null, err: null });
  sh.msg = null;
  render();
}

function sheetZip(sh) {
  const over = (ev, on) => { ev.preventDefault(); ev.currentTarget.classList.toggle("over", on); };
  return h("div", {},
    h("p", { class: "muted small", style: "margin-top:0" },
      "Wgraj plik .zip z jednym katalogiem *.koplugin (do 20 MB). Potem wybierzesz czytniki."),
    h("div", { class: "dropzone", id: "f-plugin-drop",
      ondragover: ev => over(ev, true), ondragleave: ev => over(ev, false),
      ondrop: ev => { over(ev, false); uploadPlugin(ev.dataTransfer.files); } },
      h("p", {}, h("b", {}, S.uploadBusy ? "Wgrywam…" : "Przeciągnij plik .zip tutaj")),
      h("p", { class: "muted small" }, "albo wybierz plik — wgra się od razu"),
      h("button", { type: "button", id: "f-plugin-pick", class: "primary", disabled: S.uploadBusy, onclick: () => document.getElementById("f-plugin-zip").click() }, "Wybierz plik…"),
      h("input", { type: "file", id: "f-plugin-zip", accept: ".zip", hidden: true, "aria-label": "Plik .zip wtyczki",
        onchange: ev => uploadPlugin(ev.target.files) })),
    S.uploadMsg && h("p", { class: S.uploadMsg.ok ? "ok" : "err", role: "status" }, S.uploadMsg.text));
}

// wtyczki, które panel już ma i może przypisać (tylko zaakceptowane wersje)
const SRC_LABEL = { upload: "wgrany plik .zip", galeria: "z galerii", "urządzenie": "z czytnika" };
function sheetStoreDirs() {
  const by = new Map();
  for (const v of (S.plugins || []).filter(x => x.approved)) {
    if (!by.has(v.dir)) by.set(v.dir, []);
    by.get(v.dir).push(v);
  }
  for (const vs of by.values()) vs.sort((a, b) => String(b.added).localeCompare(String(a.added)));
  return [...by].sort((a, b) => pluginTitle(a[0]).localeCompare(pluginTitle(b[0]), "pl"));
}

function sheetStore(sh) {
  const dirs = sheetStoreDirs();
  if (!S.plugins) return h("p", { class: "loading" }, "Wczytuję wtyczki z panelu…");
  if (dirs.length === 0) return h("p", { class: "muted" }, "Panel nie ma jeszcze żadnych wtyczek — dodaj wtyczkę z galerii albo wgraj plik .zip.");
  return h("div", {},
    h("p", { class: "muted small", style: "margin-top:0" }, "To wtyczki, które już są w panelu. Wybierz jedną."),
    dirs.map(([dir, vs]) => {
      const cur = vs.find(v => v.sha256 === sh.sha), on = !!cur, id = "sh-s-" + dir.replace(/\W/g, "_");
      return h("div", { class: "shrow" + (on ? " on" : "") },
        h("div", { class: "grow" },
          h("b", {}, pluginLabel(dir)),
          h("div", { class: "muted small" }, `${vs[0].version || vs[0].sha256.slice(0, 12)} · ${SRC_LABEL[vs[0].source] || vs[0].source}` + (vs.length > 1 ? ` · ${vs.length} wersje` : "")),
          on && vs.length > 1 && h("select", { "aria-label": "Wersja", onchange: ev => { sh.sha = ev.target.value; render(); } },
            vs.map(v => h("option", { value: v.sha256, selected: v.sha256 === sh.sha || undefined },
              `${v.version || v.sha256.slice(0, 12)} · ${SRC_LABEL[v.source] || v.source}${v.source_ref ? " · " + v.source_ref : ""}`)))),
        h("div", { class: "shact" },
          h("button", { type: "button", id, class: on ? "primary" : "", "aria-pressed": String(on), disabled: sh.busy,
            onclick: () => { sh.sha = on ? null : vs[0].sha256; sh.msg = null; render(); } }, on ? "✓ Wybrano" : "Wybierz")));
    }));
}

// krok 2, lewa część: karty wybranych wtyczek (z galerii: z „×” i, gdy repozytorium ma kilka katalogów *.koplugin, z wyborem katalogu)
function sheetCards(sh) {
  if (sh.src !== "galeria") {
    const x = sheetPicked(sh)[0], v = x.v;
    return h("div", {}, h("div", { class: "shcard" }, h("b", {}, x.name),
      h("div", { class: "muted small" }, `${v.version || v.sha256.slice(0, 12)} · ${SRC_LABEL[v.source] || v.source}`)));
  }
  return h("div", {}, sh.picks.map(pk => {
    const r = pk.repo, name = galleryTitle(r.full_name);
    return h("div", { class: "shcard" + (pk.err ? " bad" : "") },
      h("div", { class: "row", style: "flex-wrap:nowrap;align-items:flex-start" },
        h("div", { class: "grow" },
          h("div", {}, h("b", {}, name), pk.promoted && h("span", { class: "badge soft" }, "od autora koligilo")),
          h("div", { class: "muted small" }, `${r.full_name} · ★ ${r.stars}` + (r.latest_release ? ` · release ${r.latest_release}` : "")),
          h("div", { class: "small shdesc" }, r.description || h("span", { class: "muted" }, "(brak opisu)"))),
        h("button", { type: "button", class: "shx", "aria-label": `Usuń „${name}” z wyboru`, disabled: sh.busy,
          onclick: () => sheetTogglePick(r, pk.promoted) }, "×")),
      pk.candidates && h("label", { class: "field" },
        h("span", {}, "Wiele katalogów *.koplugin w repozytorium — wybierz jeden:"),
        h("select", { disabled: sh.busy, onchange: ev => { pk.path = ev.target.value; } },
          pk.candidates.map(c => h("option", { value: c === "." ? "" : c, selected: (pk.path === (c === "." ? "" : c)) || undefined }, c)))),
      pk.err && h("p", { class: "err small", role: "alert", style: "margin:6px 0 0" }, pk.err));
  }));
}

function sheetBtnLabel(sh, nPlug, nDev) {
  const w = nPlug > 1 ? `${nPlug} ${plPl(nPlug, "wtyczkę", "wtyczki", "wtyczek")}` : "";
  if (sh.shared) return w ? `Dodaj ${w} dla wszystkich` : "Dodaj dla wszystkich";
  if (nDev > 0) return `Dodaj ${w ? w + " " : ""}na ${nDev} ${plPl(nDev, "czytnik", "czytniki", "czytników")}`;
  return w ? `Dodaj ${w} do panelu` : "Dodaj do panelu";
}

function sheetDevChips(sh) {
  const devs = S.state.devices, chosen = sheetDevices(sh);
  if (devs.length === 0) return h("p", { class: "muted small", style: "margin:0" }, "Brak połączonych czytników — wtyczka trafi tylko do panelu.");
  const toggle = id => { if (chosen.has(id)) chosen.delete(id); else chosen.add(id); render(); };
  return h("div", {},
    h("div", { class: "devchips", role: "group", "aria-label": "Dla których czytników" },
      h("span", { class: "muted" }, "Dla których czytników:"),
      devs.map(d => {
        const on = sh.shared || chosen.has(d.id);
        return h("button", { type: "button", class: "devchip" + (on ? " on" : "") + (d.plugins_allowed ? "" : " wait"), "aria-pressed": String(on),
          disabled: sh.busy || sh.shared, title: d.plugins_allowed ? d.name : CONSENT_SHORT + ". " + PLUG_STATE.consent.hint,
          onclick: () => toggle(d.id) }, (on ? "✓ " : "") + d.name + (d.plugins_allowed ? "" : " · bez zgody"));
      }),
      h("button", { type: "button", id: "sh-shared", class: "devchip shared" + (sh.shared ? " on" : ""), "aria-pressed": String(sh.shared), disabled: sh.busy,
        title: "Dla wszystkich czytników, także przyszłych", onclick: () => { sh.shared = !sh.shared; render(); } }, (sh.shared ? "✓ " : "") + "★ wspólna")),
    devs.some(d => !d.plugins_allowed) && h("p", { class: "muted small", style: "margin:6px 0 0" },
      "Czytnik bez zgody dostanie wtyczkę dopiero po tym, jak sam pozwoli na wtyczki."));
}

function sheetWarn(sh) {
  const comm = sh.src === "galeria" ? sh.picks.filter(p => !p.promoted) : [];
  if (comm.length === 0) return null;
  const one = comm.length === 1;
  return h("div", { class: "plugin-warn", role: "note", style: "padding:10px 12px;border-radius:8px" },
    h("b", {}, "⚠ To cudzy kod" + (one ? ". " : ` (${comm.length} z wybranych wtyczek: ${comm.map(p => galleryTitle(p.repo.full_name)).join(", ")}). `)),
    (one ? "Napisał go ktoś spoza koligilo i KOReadera. Na czytniku ma" : "Napisali go ludzie spoza koligilo i KOReadera. Na czytniku mają") +
    " pełny dostęp do plików, sieci i ustawień. " +
    (one ? "Zajrzyj do repozytorium" : "Zajrzyj do repozytoriów") + ", zanim klikniesz „Dodaj”. Czytnik i tak zapyta o zgodę przed instalacją.");
}

function sheetFoot(sh) {
  if (sh.src === "zip") return null;
  const picked = sheetPicked(sh), n = picked.length;
  const msg = sh.msg && h("p", { class: sh.msg.ok ? "ok" : "err", role: "status" }, sh.msg.text);
  if (n === 0) return h("footer", { class: "sheet-foot" },
    h("p", { class: "muted small" }, sh.src === "galeria" ? "Kliknij „Wybierz” przy jednej lub kilku wtyczkach." : "Kliknij „Wybierz” przy wtyczce."), msg);
  if (!sheetStep2(sh)) return h("footer", { class: "sheet-foot" },
    h("div", { class: "row" },
      h("span", { class: "grow shsum" }, `Wybrano ${n > 1 ? n + ": " : ""}`, h("b", {}, picked.map(x => x.name).join(", "))),
      n > 1 && h("button", { type: "button", class: "linkbtn", disabled: sh.busy, onclick: () => { sh.picks = []; render(); } }, "Wyczyść"),
      h("button", { type: "button", id: "sh-next", class: "primary", onclick: () => sheetGoStep(2) }, "Dalej →"),
      h("button", { type: "button", disabled: sh.busy, onclick: closeAddSheet }, "Anuluj")),
    msg);
  const nDev = S.state.devices.filter(d => sheetDevices(sh).has(d.id)).length;
  return h("footer", { class: "sheet-foot" },
    sheetWarn(sh),
    sheetDevChips(sh),
    h("div", { class: "row" },
      h("button", { type: "button", disabled: sh.busy, onclick: () => sheetGoStep(1) }, "← Wstecz"),
      h("button", { type: "button", id: "sh-go", class: "primary", disabled: sh.busy || (sh.src !== "galeria" && nDev === 0 && !sh.shared), onclick: sheetSubmit },
        sh.busy ? (sh.prog || "Pracuję…") : sheetBtnLabel(sh, sh.src === "galeria" ? n : 1, nDev)),
      h("button", { type: "button", disabled: sh.busy, onclick: closeAddSheet }, "Anuluj")),
    msg);
}

// Komunikat po dodaniu (na dole strony, znika sam) i chwilowe podświetlenie nowych wierszy macierzy.
let plugToastTimer = null, plugFlashTimer = null;
function plugToast(text) {
  S.plugToast = text;
  clearTimeout(plugToastTimer);
  plugToastTimer = setTimeout(() => { S.plugToast = null; render(); }, 12000);
}
function plugFlash(dirs) {
  S.plugFlash = new Set(dirs);
  clearTimeout(plugFlashTimer);
  plugFlashTimer = setTimeout(() => { S.plugFlash = null; render(); }, 5000);
}
function plugToastBox() {
  return h("div", { class: "toast", role: "status" },
    h("span", { class: "grow" }, S.plugToast),
    h("button", { type: "button", "aria-label": "Zamknij komunikat", onclick: () => { S.plugToast = null; render(); } }, "×"));
}

async function sheetSubmit() {
  const sh = S.addSheet;
  sh.busy = true; sh.msg = null; sh.prog = null; render();
  const added = [], failed = []; // added: {pk?, plugin}; failed: pk z błędem
  if (sh.src === "galeria") {
    const todo = [...sh.picks];
    for (const [i, pk] of todo.entries()) {
      pk.err = null;
      if (todo.length > 1) { sh.prog = `Pobieram ${i + 1} z ${todo.length}…`; render(); }
      const body = { repo: pk.repo.full_name };
      if (pk.repo.latest_release) body.ref = pk.repo.latest_release;
      if (pk.path) body.path = pk.path;
      try {
        const res = await apiRaw("POST", "/api/admin/gallery/install", body);
        if (res.ok) { added.push({ pk, plugin: res.data.plugin }); continue; }
        if (res.status === 400 && res.data && res.data.candidates) {
          pk.candidates = res.data.candidates;
          if (!pk.path) pk.path = pk.candidates[0] === "." ? "" : pk.candidates[0];
        }
        pk.err = (res.data && res.data.error) || `HTTP ${res.status}`;
      } catch (e) { pk.err = e.message; }
      failed.push(pk);
    }
  } else {
    const v = (S.plugins || []).find(x => x.sha256 === sh.sha);
    if (v) added.push({ plugin: v });
  }
  // jedno przypisanie na czytnik ze wszystkimi nowymi wtyczkami naraz
  const names = [], errs = [];
  const add = Object.fromEntries(added.map(x => [x.plugin.dir, x.plugin.sha256]));
  if (added.length && sh.shared) {
    const r = await apiRaw("POST", "/api/admin/shared-plugins", { plugins: { ...(S.state.shared_plugins || {}), ...add } });
    if (r.ok) names.push(...((r.data && r.data.changed) || [])); else errs.push(`wtyczki wspólne: ${(r.data && r.data.error) || r.status}`);
  } else if (added.length) {
    for (const devId of sheetDevices(sh)) {
      const d = S.state.devices.find(x => x.id === devId);
      if (!d) continue;
      const r = await apiRaw("POST", `/api/admin/devices/${devId}/plugins`, { plugins: { ...(d.plugins || {}), ...add } });
      if (r.ok) names.push(d.name); else errs.push(`${d.name}: ${(r.data && r.data.error) || r.status}`);
    }
  }
  sh.busy = false; sh.prog = null;
  const one = added.length === 1 ? added[0].plugin : null;
  const what = one ? `„${pluginVerName(one)}” (${one.version || one.sha256.slice(0, 12)})`
    : `${added.length} ${plPl(added.length, "wtyczkę", "wtyczki", "wtyczek")}: ${added.map(x => pluginVerName(x.plugin)).join(", ")}`;
  if (sh.src === "galeria") { const ok = new Set(added.map(x => x.pk)); sh.picks = sh.picks.filter(p => !ok.has(p)); }
  if (failed.length || errs.length) {
    const parts = [];
    if (added.length) parts.push(`Dodano ${what}${errs.length ? ", ale nie udało się przypisać do: " + errs.join("; ") : names.length ? " i przypisano do: " + names.join(", ") : " do panelu"}.`);
    if (failed.length) parts.push(`Nie udało się dodać: ${failed.map(pk => galleryTitle(pk.repo.full_name)).join(", ")} — szczegóły na kartach powyżej.`);
    sh.msg = { ok: false, text: parts.join(" ") };
    render();
    refresh();
    return;
  }
  S.addSheet = null;
  S.plugSel = null;
  S.plugMsg = null;
  plugFlash(added.map(x => x.plugin.dir));
  plugToast(names.length
    ? `Dodano ${what}${sh.shared ? " jako wspólne" : ""} i przypisano do: ${names.join(", ")}. ${SYNC_HINT}`
    : sh.shared ? `Dodano ${what} jako wspólne — wszystkie czytniki już je mają.`
    : `Dodano ${what} do panelu. Przypisz ${added.length > 1 ? "je" : "ją"} czytnikom w tabeli (znak ＋).`);
  await refresh();
  document.querySelector("tr.flash")?.scrollIntoView({ block: "center" }); // środek, żeby komunikat u dołu nie zasłonił wiersza
  document.getElementById("b-add")?.focus();
}

// ---------------------------------------------------------------- start

// ------------------------------------------------ zakładka: czcionki (TASK-36, PC-018)
//
// Pliki TTF/OTF trafiają na czytniki, które w menu koligilo włączyły „Synchronizuj czcionki”.
// Czcionka to dane, nie kod, więc nie ma potwierdzenia każdej zmiany na czytniku — zgoda jest
// jedna i tylko tam (panel nie może jej włączyć). Wybór czcionki w książce to osobna grupa
// „Wybór czcionek” w „Co synchronizować”; ta zakładka dostarcza same pliki.

function fmtSize(n) {
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1).replace(".", ",") + " MB";
  return Math.max(1, Math.round(n / 1024)) + " KB";
}
const FONT_SRC = { upload: "wgrana z panelu", "urządzenie": "z czytnika", "katalog": "z katalogu polecanych" };
const FONT_SCRIPTS = [["all", "Wszystkie"], ["lat", "Łacina"], ["cyr", "Cyrylica"], ["grc", "Greka"], ["ara", "Arabski"], ["ipa", "IPA"], ["acc", "Dostępność"]];

// TASK-38: zakładka „Czcionki” w trzech widokach wewnętrznych (Biblioteka · Katalog · Czytniki), z banerem
// „czeka na akceptację” nad nimi. Kolejność i warianty zatwierdzone w selektorze (wybor/czcionki-panel).

// Rodzina pliku: z serwera (f.family), a bez niej zgadnięta z nazwy („Literata-Bold.ttf” → „Literata”).
function fontFamily(f) {
  if (f.family) return f.family;
  if (f.source === "katalog" && f.source_ref) return f.source_ref; // katalog zapisuje tu nazwę rodziny
  const stem = f.file.replace(/\.[^.]+$/, "");
  return (stem.split("-")[0].replace(/_/g, " ").trim()) || stem;
}
function fontGroups(fonts) {
  const m = new Map();
  for (const f of fonts) {
    const n = fontFamily(f);
    if (!m.has(n)) m.set(n, { name: n, files: [] });
    m.get(n).files.push(f);
  }
  return [...m.values()].map(g => {
    g.files.sort((a, b) => a.file.localeCompare(b.file));
    g.size = g.files.reduce((n, f) => n + f.size, 0);
    g.pending = g.files.filter(f => !f.approved);
    g.active = g.files.filter(f => f.active);
    const f0 = g.files[0];
    g.src = (FONT_SRC[f0.source] || f0.source) + (f0.source === "urządzenie" && f0.source_ref ? " · " + f0.source_ref.replace(/ \(.*\)$/, "") : "");
    return g;
  }).sort((a, b) => a.name.localeCompare(b.name, "pl"));
}

async function uploadFonts(files) {
  files = [...(files || [])];
  if (!files.length) { S.fontMsg = { ok: false, text: "Wybierz plik czcionki (.ttf, .otf, .ttc, .otc)." }; return render(); }
  S.fontBusy = true; S.fontMsg = null; render();
  const done = [], bad = [];
  for (const f of files) {
    try {
      const fd = new FormData();
      fd.append("file", f);
      await apiUpload("/api/admin/fonts", fd);
      done.push(f.name);
    } catch (e) { bad.push(`${f.name}: ${e.message}`); }
  }
  S.fontBusy = false;
  S.fontMsg = bad.length
    ? { ok: false, text: (done.length ? `Wgrano ${done.length}. ` : "") + "Nie udało się: " + bad.join("; ") }
    : { ok: true, text: `Wgrano: ${done.join(", ")}. Trafią na czytniki przy ich następnej synchronizacji.` };
  await refresh();
}

// Katalog polecanych (TASK-37): serwer sam pobiera pliki z przypiętych adresów i sprawdza ich sumy.
async function addCatalogFamilies(fams) {
  S.fontCatBusy = fams.map(f => f.id); S.fontMsg = null; render();
  let added = 0;
  const bad = [];
  for (const f of fams) {
    try { added += (await api("POST", `/api/admin/font-catalog/${f.id}`)).added; }
    catch (e) { bad.push(`${f.name}: ${e.message}`); }
  }
  S.fontCatBusy = null;
  const names = fams.map(f => f.name).join(", ");
  S.fontMsg = bad.length
    ? { ok: false, text: "Nie udało się pobrać: " + bad.join("; ") }
    : { ok: true, text: `Dodano: ${names} (${added} ${plPl(added, "plik", "pliki", "plików")}). Trafią na czytniki przy ich następnej synchronizacji.` };
  await refresh();
}

async function approveFonts(list) {
  const bad = [];
  for (const f of list) {
    try { await api("POST", `/api/admin/fonts/${f.sha256}/approve`); } catch (e) { bad.push(`${f.file}: ${e.message}`); }
  }
  S.fontMsg = bad.length ? { ok: false, text: "Nie udało się zaakceptować: " + bad.join("; ") }
    : { ok: true, text: list.length === 1 ? `Zaakceptowano „${list[0].file}”.` : `Zaakceptowano ${list.length} ${plPl(list.length, "plik", "pliki", "plików")}.` };
  return refresh();
}

async function deleteFonts(list, what) {
  const n = list.length;
  if (!confirm(`Usunąć ${n === 1 ? `czcionkę „${list[0].file}”` : `„${what}” (${n} ${plPl(n, "plik", "pliki", "plików")})`} z panelu?\n\nCzytniki, które ${n === 1 ? "ją mają" : "je mają"}, usuną ${n === 1 ? "ten plik" : "te pliki"} przy najbliższej synchronizacji (czcionek dodanych ręcznie to nie dotyczy).`)) return;
  const bad = [];
  for (const f of list) {
    try { await api("DELETE", `/api/admin/fonts/${f.sha256}`); } catch (e) { bad.push(`${f.file}: ${e.message}`); }
  }
  S.fontMsg = bad.length ? { ok: false, text: "Nie udało się usunąć: " + bad.join("; ") }
    : { ok: true, text: n === 1 ? `Usunięto „${list[0].file}”.` : `Usunięto „${what}” (${n} ${plPl(n, "plik", "pliki", "plików")}).` };
  return refresh();
}

function fontBanner(pending) {
  if (!pending.length) return null;
  const n = pending.length, first = pending[0];
  const who = (first.source_ref || "czytnik").replace(/ \(.*\)$/, "");
  const text = n === 1 ? `1 czcionka od czytnika czeka na akceptację: ${first.file} (${who})`
    : `${n} ${plPl(n, "czcionka", "czcionki", "czcionek")} od czytników czeka na akceptację: ${first.file} i ${n - 1} ${plPl(n - 1, "inna", "inne", "innych")}`;
  return h("div", { class: "font-banner", role: "status" },
    h("span", { class: "grow" }, h("b", {}, text)),
    h("button", { type: "button", id: "b-font-approve", onclick: () => approveFonts(pending) }, n === 1 ? "Zaakceptuj" : "Zaakceptuj wszystkie"),
    h("button", { type: "button", class: "ghost", onclick: () => deleteFonts(pending, "czcionki od czytników") }, "Usuń"));
}

// Jedno zdanie stanu pod tytułem: ile plików, kto czeka, co wymaga uwagi.
function fontSentence(fonts, active, pending) {
  const devs = S.state.devices || [];
  const reported = d => d.font_report_at && !d.font_report_at.startsWith("0001");
  const p = [];
  const fams = new Set(fonts.filter(f => f.approved).map(fontFamily)).size;
  p.push(active.length ? `${active.length} ${plPl(active.length, "plik", "pliki", "plików")} z ${fams} ${plPl(fams, "rodziny", "rodzin", "rodzin")}` : "brak czcionek w panelu");
  const wait = devs.filter(d => d.fonts_allowed && active.length && !reported(d)).length;
  if (wait) p.push(`${wait} ${plPl(wait, "czytnik czeka", "czytniki czekają", "czytników czeka")} na pierwszą synchronizację`);
  const noc = devs.filter(d => !d.fonts_allowed).length;
  if (noc) p.push(`${noc} ${plPl(noc, "czytnik bez zgody", "czytniki bez zgody", "czytników bez zgody")}`);
  if (pending.length) p.push(`${pending.length} ${plPl(pending.length, "czcionka czeka", "czcionki czekają", "czcionek czeka")} na akceptację`);
  return h("p", { class: "muted", id: "font-sentence" }, p.join(" · "));
}

const FONT_VIEWS = [["lib", "Biblioteka"], ["cat", "Katalog"], ["dev", "Czytniki"]];
function showFontView(id) { S.fontView = id; render(); document.getElementById("fonttab-" + id)?.focus(); }
function fontTablist(cur, counts) {
  return h("div", { class: "tabs", role: "tablist", "aria-label": "Czcionki" },
    FONT_VIEWS.map(([id, label], i) => h("button", {
      type: "button", role: "tab", id: "fonttab-" + id, "aria-selected": String(cur === id),
      "aria-controls": "fontpanel", tabindex: cur === id ? "0" : "-1", class: "tab" + (cur === id ? " selected" : ""),
      onclick: () => showFontView(id),
      onkeydown: ev => {
        const d = { ArrowRight: 1, ArrowLeft: -1 }[ev.key], home = ev.key === "Home", end = ev.key === "End";
        if (d == null && !home && !end) return;
        ev.preventDefault();
        showFontView(FONT_VIEWS[home ? 0 : end ? FONT_VIEWS.length - 1 : (i + d + FONT_VIEWS.length) % FONT_VIEWS.length][0]);
      },
    }, label, counts[id] != null && ` (${counts[id]})`)));
}

function fontDropzone() {
  const over = (ev, on) => { ev.preventDefault(); ev.currentTarget.classList.toggle("over", on); };
  return h("section", { class: "card" },
    h("h3", { style: "margin-top:0" }, "Wgraj czcionkę"),
    h("div", { class: "dropzone", id: "f-drop",
      ondragover: ev => over(ev, true), ondragleave: ev => over(ev, false),
      ondrop: ev => { over(ev, false); uploadFonts(ev.dataTransfer.files); } },
      h("p", {}, h("b", {}, S.fontBusy ? "Wgrywam…" : "Przeciągnij tu pliki czcionek")),
      h("p", { class: "muted small" }, "albo"),
      h("button", { type: "button", class: "primary", disabled: S.fontBusy, onclick: () => document.getElementById("f-font-files").click() }, "Wybierz pliki…"),
      h("input", { type: "file", id: "f-font-files", accept: ".ttf,.otf,.ttc,.otc", multiple: true, hidden: true, "aria-label": "Pliki czcionek",
        onchange: ev => uploadFonts(ev.target.files) })),
    h("p", { class: "muted small", style: "margin-bottom:0" }, "TTF, OTF, TTC, OTC, do 40 MB każdy. Nowy plik o tej samej nazwie zastępuje poprzedni. ",
      h("button", { type: "button", class: "linkbtn", onclick: () => showHow("fonts") }, "Jak to działa ›")));
}

// Próbka kroju (TASK-38): bajty idą z GET /api/admin/fonts/{sha}/file przez
// fetch z nagłówkiem panelu (token admina nie może trafić do <link>/@font-face),
// a przeglądarka dostaje je jako FontFace z bufora. Ładujemy tylko jeden plik na
// rodzinę (styl podstawowy), raz na sha.
const FONT_SAMPLE = "Zażółć gęślą jaźń · Pchnąć w tę łódź jeża · 0123456789";
const fontFaces = new Map(); // sha → nazwa rodziny | Promise | null (nie wyszło)
function sampleFile(g) {
  const plain = f => !/bold|italic|oblique|black|light|thin|medium|semibold|heavy/i.test(f.file);
  return g.files.find(f => /regular|roman|book/i.test(f.file) && plain(f)) || g.files.find(plain) || g.files[0];
}
function loadFontFace(f) {
  if (fontFaces.has(f.sha256)) return Promise.resolve(fontFaces.get(f.sha256));
  const headers = { [HDR]: "1" };
  if (S.mode === "serve") headers.Authorization = "Bearer " + adminToken();
  const name = "kg-" + f.sha256.slice(0, 12);
  const p = fetch(`/api/admin/fonts/${f.sha256}/file`, { headers })
    .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); })
    .then(buf => new FontFace(name, buf).load())
    .then(face => { document.fonts.add(face); fontFaces.set(f.sha256, name); return name; })
    .catch(() => { fontFaces.set(f.sha256, null); return null; });
  fontFaces.set(f.sha256, p);
  return p;
}
function fontSample(g) {
  const f = sampleFile(g);
  if (!f) return null;
  const el = h("div", { class: "fsample muted", "aria-hidden": "true" }, FONT_SAMPLE);
  const apply = name => { if (name) { el.style.fontFamily = `"${name}", serif`; el.classList.remove("muted"); } else el.hidden = true; };
  const cur = fontFaces.get(f.sha256);
  if (typeof cur === "string" || cur === null) apply(cur);
  else loadFontFace(f).then(apply);
  return el;
}

// Rodzina jako kafelek (TASK-41): nazwa i odznaka, próbka kroju, meta, „Pliki ▸” i „Usuń”.
// Otwarty kafelek zajmuje obie kolumny, bo w środku jest lista plików.
function fontFamilyTile(g) {
  const open = !!S.fontOpen[g.name], n = g.files.length;
  const badge = g.pending.length ? h("span", { class: "badge warn" }, "czeka na akceptację")
    : g.active.length ? h("span", { class: "badge" }, "na czytnikach")
      : h("span", { class: "badge soon", title: "Jest nowsza wersja pliku o tej samej nazwie" }, "zastąpiona");
  return h("div", { class: "ftile" + (open ? " open" : "") },
    h("div", { class: "row" }, h("b", { class: "grow" }, g.name), badge),
    fontSample(g),
    h("div", { class: "muted small" }, `${n} ${plPl(n, "plik", "pliki", "plików")} · ${fmtSize(g.size)} · ${g.src}`),
    h("div", { class: "row" },
      h("button", { type: "button", class: "linkbtn", "aria-expanded": String(open),
        onclick: () => { S.fontOpen[g.name] = !open; render(); } }, open ? "Pliki ▾" : "Pliki ▸"),
      h("span", { class: "grow" }),
      h("button", { type: "button", class: "linkbtn danger", onclick: () => deleteFonts(g.files, g.name) }, n > 1 ? "Usuń rodzinę" : "Usuń")),
    open && h("ul", { class: "plain fam-files" }, g.files.map(f => h("li", { class: "row" },
      h("span", { class: "grow" }, h("b", {}, f.file)),
      h("span", { class: "muted small" }, fmtSize(f.size)),
      h("button", { type: "button", class: "danger", onclick: () => deleteFonts([f], f.file) }, "Usuń")))));
}

function fontLibraryPane(fonts) {
  const groups = fontGroups(fonts);
  return [
    fontDropzone(),
    h("section", { class: "card" },
      h("h3", { style: "margin-top:0" }, "Czcionki w panelu"),
      groups.length === 0
        ? h("p", { class: "muted" }, "Nic tu jeszcze nie ma. Wgraj plik, dodaj kroje z katalogu albo wyślij czcionkę z czytnika (menu koligilo → Wyślij czcionkę na serwer).")
        : h("div", { class: "ftiles" }, groups.map(fontFamilyTile)))];
}

function fontCatalogRow(f, busy, name) {
  const done = f.have === f.files, working = busy.includes(f.id);
  return h("li", { class: "row" },
    h("div", { class: "grow" },
      h("b", {}, f.name),
      h("span", { class: "muted small" }, ` · ${f.scripts} · ${fmtSize(f.size)} · `),
      h("a", { href: f.source, target: "_blank", rel: "noopener noreferrer", class: "small" }, f.license),
      !name && h("div", { class: "muted small" }, f.description)),
    h("button", { type: "button", disabled: done || busy.length > 0, onclick: () => addCatalogFamilies([f]) },
      done ? "Dodana" : working ? "Pobieram…" : f.have > 0 ? "Dopełnij" : "Dodaj"));
}

function fontCatalogPane() {
  const cat = S.fontCat, busy = S.fontCatBusy || [];
  if (!cat) return h("p", { class: "loading" }, "Wczytuję katalog…");
  const done = f => f.have === f.files, sc = S.fontScript || "all";
  const hasTag = (f, id) => id === "all" || (f.tags || []).includes(id);
  const starterTodo = cat.filter(f => f.starter && !done(f));
  const added = cat.filter(done), todo = cat.filter(f => !done(f) && hasTag(f, sc));
  return h("section", { class: "card" },
    h("h3", { style: "margin-top:0" }, "Polecane do czytania"),
    h("p", { class: "muted small", style: "margin-top:0" }, "Kroje o otwartej licencji (SIL OFL), po cztery style. Serwer pobiera je sam z przypiętych adresów. ",
      h("button", { type: "button", class: "linkbtn", onclick: () => showHow("fonts") }, "Jak to działa ›")),
    h("div", { class: "fchips", role: "group", "aria-label": "Filtr pisma" }, FONT_SCRIPTS.map(([id, label]) => {
      const n = cat.filter(f => !done(f) && hasTag(f, id)).length;
      if (!n && sc !== id) return null; // pusty filtr nic nie daje
      return h("button", { type: "button", "aria-pressed": String(sc === id), onclick: () => { S.fontScript = id; render(); } }, `${label} (${n})`);
    })),
    cat.some(f => f.starter) && h("div", { class: "row", style: "margin-bottom:8px" },
      h("button", { type: "button", class: "primary", disabled: busy.length > 0 || starterTodo.length === 0, onclick: () => addCatalogFamilies(starterTodo) },
        starterTodo.length === 0 ? "Zestaw startowy jest dodany"
          : busy.length ? "Pobieram…" : `Dodaj zestaw startowy (${starterTodo.map(f => f.name).join(", ")} · ${fmtSize(starterTodo.reduce((n, f) => n + f.size, 0))})`)),
    added.length > 0 && h("div", {},
      h("button", { type: "button", class: "linkbtn", "aria-expanded": String(!!S.fontAddedOpen), onclick: () => { S.fontAddedOpen = !S.fontAddedOpen; render(); } },
        `${S.fontAddedOpen ? "▾" : "▸"} Dodane (${added.length}): ${added.map(f => f.name).join(", ")}`),
      S.fontAddedOpen && h("ul", { class: "plain" }, added.map(f => fontCatalogRow(f, busy, true)))),
    todo.length === 0 ? h("p", { class: "muted" }, sc === "all" ? "Wszystko z katalogu jest już dodane." : "Wszystko z tego filtra jest już dodane.")
      : h("ul", { class: "plain" }, todo.map(f => fontCatalogRow(f, busy, false))));
}

function fontDeviceRow(d, active) {
  const inv = new Map((d.font_inventory || []).map(x => [x.file, x.sha256]));
  const have = active.filter(f => inv.get(f.file) === f.sha256).length;
  const reported = d.font_report_at && !d.font_report_at.startsWith("0001");
  let state, cls = "muted small";
  if (!d.fonts_allowed) state = `bez zgody — na czytniku: ${MENU_PATH} → Zgody → Synchronizuj czcionki`;
  else if (!active.length) state = "zgoda jest, w panelu nie ma jeszcze czcionek";
  else if (!reported) state = "zgoda jest, czeka na pierwszą synchronizację";
  else if (have === active.length) { state = `wszystkie (${have}) zainstalowane`; cls = "ok small"; }
  else state = `zainstalowane ${have} z ${active.length} — reszta przy następnej synchronizacji`;
  return h("li", {}, h("b", {}, d.name), " — ", h("span", { class: cls }, state));
}

// Przydział rodzin do czytników (TASK-38): przełącznik wyłącza rodzinę tylko
// jako filtr stanu docelowego — czytnik usunie jej pliki z manifestu koligilo
// przy następnej synchronizacji. Czytnik bez zgody na czcionki dostaje „—”.
async function assignFont(dev, family, on, text) {
  try {
    await api("POST", "/api/admin/fonts/assign", { device: dev, family, on });
    S.fontMsg = { ok: true, text };
  } catch (e) { S.fontMsg = { ok: false, text: `Nie udało się: ${e.message}` }; }
  return refresh();
}

function fontMatrix(groups, devs) {
  const on = (d, name) => !(d.fonts_off || []).includes(name);
  const ready = devs.filter(d => d.fonts_allowed);
  const head = h("thead", {}, h("tr", {},
    h("th", { scope: "col" }, "Rodzina"),
    devs.map(d => h("th", { scope: "col" }, d.name)),
    ready.length > 1 && h("th", { scope: "col" }, "Wszystkie")));
  const rows = groups.map(g => {
    const n = ready.filter(d => on(d, g.name)).length;
    const all = h("input", { type: "checkbox", checked: n === ready.length,
      "aria-label": `${g.name} na wszystkich czytnikach`,
      onchange: ev => assignFont("*", g.name, ev.target.checked,
        `${ev.target.checked ? "Włączono" : "Wyłączono"} „${g.name}” na wszystkich czytnikach.`) });
    all.indeterminate = n > 0 && n < ready.length;
    return h("tr", {},
      h("th", { scope: "row", class: "gname" }, g.name),
      devs.map(d => h("td", { class: "cell" }, !d.fonts_allowed
        ? h("span", { class: "muted", title: "Czytnik nie dał zgody na czcionki" }, "—")
        : h("label", { class: "switch", title: `${g.name} — ${d.name}` },
          h("input", { type: "checkbox", checked: on(d, g.name), "aria-label": `${g.name} na ${d.name}`,
            onchange: ev => assignFont(d.id, g.name, ev.target.checked, ev.target.checked
              ? `Włączono „${g.name}” na ${d.name}. Pliki trafią na czytnik przy następnej synchronizacji.`
              : `Wyłączono „${g.name}” na ${d.name}. Czytnik usunie jej pliki przy następnej synchronizacji.`) }),
          h("span", {}))),
      ),
      ready.length > 1 && h("td", { class: "cell" },
        h("label", { class: "switch" + (all.indeterminate ? " part" : ""), title: "Wszystkie czytniki" }, all, h("span", {}))));
  });
  return h("div", { class: "matrix-wrap" },
    h("table", { class: "matrix", "aria-label": "Rodziny czcionek na czytnikach" }, head, h("tbody", {}, rows)));
}

function fontDevicesPane(active, fonts) {
  const devs = S.state.devices, groups = fontGroups(fonts).filter(g => g.active.length);
  return [
    h("section", { class: "card" },
      h("h3", { style: "margin-top:0" }, "Czytniki"),
      devs.length === 0 ? h("p", { class: "muted" }, "Nie połączono jeszcze żadnego czytnika.")
        : h("ul", { class: "plain" }, devs.map(d => fontDeviceRow(d, active)))),
    devs.length > 0 && groups.length > 0 && h("section", { class: "card" },
      h("h3", { style: "margin-top:0" }, "Co gdzie"),
      h("p", { class: "muted small", style: "margin-top:0" }, "Domyślnie każdy czytnik ze zgodą dostaje wszystkie rodziny. Wyłącz rodzinę tam, gdzie jej nie chcesz."),
      fontMatrix(groups, devs))];
}

function fontsTab() {
  const fonts = S.state.fonts || [];
  const active = fonts.filter(f => f.active);
  const pending = fonts.filter(f => !f.approved);
  const cur = FONT_VIEWS.some(([id]) => id === S.fontView) ? S.fontView : "lib";
  const body = cur === "lib" ? fontLibraryPane(fonts) : cur === "cat" ? fontCatalogPane() : fontDevicesPane(active, fonts);
  return h("div", {},
    fontBanner(pending),
    fontSentence(fonts, active, pending),
    fontTablist(cur, { lib: fonts.length, dev: S.state.devices.length }),
    S.fontMsg && h("p", { class: S.fontMsg.ok ? "ok" : "err", role: "status" }, S.fontMsg.text),
    h("div", { id: "fontpanel", role: "tabpanel", "aria-labelledby": "fonttab-" + cur }, body));
}

// ------------------------------------------------ zakładka: słowniki (TASK-55, PC-020)
//
// Słowniki StarDict trafiają na czytniki, które w menu koligilo włączyły „Synchronizuj słowniki”.
// Jak czcionki: dane, nie kod, jedna zgoda i tylko na czytniku. Źródła: wgranie z panelu albo
// katalog z listy KOReadera — serwer pobiera wtedy plik sam, w tle (to minuty i dziesiątki MB,
// więc POST tylko startuje zadanie, a panel odpytuje /api/admin/dicts co 2 s, dopóki któreś trwa).
// Logika bez DOM (filtry, stan czytnika, postęp) jest w web/dicts.js.

const DICT_SRC = { upload: "wgrany z panelu", "katalog": "z katalogu KOReadera" };
const DICT_PAGE = 50;
const DICT_ARCHIVE = /\.(zip|tar|tgz|tar\.gz|tar\.bz2|tar\.zst)$/i;

let langNames = null;
try { langNames = new Intl.DisplayNames(["pl"], { type: "language" }); } catch { /* stare przeglądarki: zostają kody */ }
function langName(code) {
  if (!code) return "";
  // Nieznany kod przeglądarka oddaje w postaci kodu (czasem skróconego do 2 liter) — wtedy zostaje nasz.
  try { const n = langNames && langNames.of(code); return n && !/^[a-z]{2,3}$/i.test(n) ? n : code; } catch { return code; }
}
const fmtCount = n => Number(n).toLocaleString("pl");
const hasWords = n => `${fmtCount(n)} ${plPl(n, "hasło", "hasła", "haseł")}`;

async function dictsLoad() {
  try {
    const r = await api("GET", "/api/admin/dicts");
    const done = Dicts.finished(S.dictJobs, r.jobs);
    S.dicts = r.dicts || [];
    S.dictJobs = r.jobs || {};
    const got = done.map(id => S.dicts.find(d => d.source === "katalog" && d.source_ref === id)).filter(Boolean);
    if (got.length) S.dictMsg = { ok: true, text: `Pobrano: ${got.map(d => d.title || d.name).join(", ")}. Trafi na czytniki przy ich następnej synchronizacji.` };
  } catch (e) {
    if (S.tab === "slowniki") S.error = e.message; // starszy serwer bez słowników nie psuje innych zakładek
  }
  dictPollSync();
}

async function dictCatLoad() {
  if (S.dictCat) return;
  try { S.dictCat = (await api("GET", "/api/admin/dict-catalog")).dicts; } catch (e) { S.error = e.message; }
}

// Odpytywanie co 2 s, dopóki któreś pobieranie trwa i jesteśmy w tej zakładce. Nie przerysowuje,
// gdy ktoś pisze w polu (szukajka) — postęp dogoni po wyjściu z pola.
let dictPollTimer = null;
function dictPollStop() { if (dictPollTimer) { clearInterval(dictPollTimer); dictPollTimer = null; } }
function dictPollSync() {
  const want = S.tab === "slowniki" && Dicts.running(S.dictJobs);
  if (!want) return dictPollStop();
  if (dictPollTimer) return;
  dictPollTimer = setInterval(async () => {
    if (S.tab !== "slowniki") return dictPollStop();
    await dictsLoad();
    const a = document.activeElement;
    if (!(a && a.tagName === "INPUT" && a.type !== "checkbox")) render();
  }, 2000);
}

// Start kilku pobrań naraz (TASK-58): wszystkie POST-y idą od razu, a serwer pobiera po dwa (reszta czeka w jego puli).
async function startDictJobs(cs) {
  S.dictMsg = null;
  const bad = [];
  for (const c of cs) {
    try {
      const r = await api("POST", `/api/admin/dict-catalog/${c.id}`);
      S.dictJobs = { ...S.dictJobs, [c.id]: r.job };
      S.dictPick.delete(c.id);
    } catch (e) { bad.push(`„${c.name}”: ${e.message}`); }
  }
  if (bad.length) S.dictMsg = { ok: false, text: `Nie udało się zacząć pobierania: ${bad.join("; ")}` };
  dictPollSync();
  render();
}

// Wgranie: jedno archiwum albo komplet luźnych plików StarDict w jednym żądaniu (tak woła serwer);
// kilka archiwów naraz idzie osobnymi żądaniami.
async function uploadDicts(files) {
  files = [...(files || [])];
  if (!files.length) { S.dictMsg = { ok: false, text: "Wybierz archiwum słownika albo pliki .ifo, .idx i .dict.dz." }; return render(); }
  const archives = files.filter(f => DICT_ARCHIVE.test(f.name));
  if (files.length > 1 && archives.length && archives.length < files.length) {
    S.dictMsg = { ok: false, text: "Wybierz albo archiwa (po jednym na słownik), albo luźne pliki jednego słownika — nie oba naraz." };
    return render();
  }
  // Luźne pliki muszą tworzyć komplet — inaczej serwer zgłosiłby tylko „nierozpoznany format”.
  if (!archives.length) {
    const has = re => files.some(f => re.test(f.name));
    if (!has(/\.ifo$/i) || !has(/\.idx(\.gz)?$/i) || !has(/\.dict(\.dz)?$/i)) {
      S.dictMsg = { ok: false, text: "Luźne pliki słownika muszą być razem: .ifo, .idx i .dict.dz (albo .dict). Wybierz je wszystkie naraz albo wgraj archiwum." };
      return render();
    }
  }
  const name = (document.getElementById("f-dict-name")?.value || "").trim();
  const batches = archives.length ? files.map(f => [f]) : [files];
  S.dictBusy = true; S.dictMsg = null; render();
  const done = [], bad = [];
  for (const b of batches) {
    try {
      const fd = new FormData();
      for (const f of b) fd.append("file", f);
      if (name && batches.length === 1) fd.append("name", name);
      const r = await apiUpload("/api/admin/dicts", fd);
      done.push(r.dict.title || r.dict.name);
    } catch (e) { bad.push(`${b.length === 1 ? b[0].name : "pliki słownika"}: ${e.message}`); }
  }
  S.dictBusy = false;
  S.dictMsg = bad.length
    ? { ok: false, text: (done.length ? `Wgrano ${done.length}. ` : "") + "Nie udało się: " + bad.join("; ") }
    : { ok: true, text: `Wgrano: ${done.join(", ")}. Trafi na czytniki przy ich następnej synchronizacji.` };
  await refresh();
}

// Usuwanie zbiorcze (TASK-60): jedno potwierdzenie z listą nazw, ale osobne DELETE na każdy słownik — serwer nie ma
// zbiorczego wywołania, a częściowa porażka ma zostawić resztę usuniętą i nazwać te, które zostały.
async function deleteDicts(list) {
  if (!list.length) return;
  const names = list.map(d => d.title || d.name);
  const shown = names.slice(0, 8).map(n => `• ${n}`).join("\n") + (names.length > 8 ? `\n… i ${names.length - 8} ${plPl(names.length - 8, "inny", "inne", "innych")}` : "");
  if (!confirm(`Usunąć z panelu ${list.length === 1 ? "słownik" : `${list.length} ${plPl(list.length, "słownik", "słowniki", "słowników")}`}?\n\n${shown}\n\nCzytniki, które je mają, usuną ich pliki (tylko te od koligilo) przy najbliższej synchronizacji. Słowników dodanych ręcznie to nie dotyczy.`)) return;
  const bad = [];
  for (const d of list) {
    try { await api("DELETE", `/api/admin/dicts/${d.sha256}`); S.dictSel.delete(d.sha256); }
    catch (e) { bad.push(`${d.title || d.name} (${e.message})`); }
  }
  S.dictMsg = bad.length
    ? { ok: false, text: `Nie udało się usunąć: ${bad.join("; ")}.` + (bad.length < list.length ? ` Reszta usunięta (${list.length - bad.length}).` : "") }
    : { ok: true, text: list.length === 1 ? `Usunięto „${names[0]}”.` : `Usunięto ${list.length} ${plPl(list.length, "słownik", "słowniki", "słowników")}.` };
  return refresh();
}

// Stały pasek zadań (TASK-58): widoczny w każdym widoku (i w arkuszu „Dodaj słownik”). Pokazuje trwające
// pobierania z postępem, błędy zadań i ostatni komunikat (S.dictMsg — pamiętany tylko w tej karcie przeglądarki).
// Brak „Anuluj”: serwer nie umie przerwać pobierania. Kolejka serwera (po dwa naraz) nie odróżnia czekających
// od aktywnych — wszystkie mają stan „pobieranie”.
function dictJobBar(inSheet) {
  const jobs = Object.entries(S.dictJobs || {}), cat = S.dictCat || [];
  const nameOf = id => (cat.find(c => c.id === id) || {}).name || id;
  const run = jobs.filter(([, j]) => j.state !== "błąd"), bad = jobs.filter(([, j]) => j.state === "błąd");
  if (!run.length && !bad.length && !S.dictMsg) return null;
  return h("div", { class: "djobs", id: inSheet ? "dict-jobs-sheet" : "dict-jobs", role: "status" },
    run.length > 0 && h("div", {}, h("b", {}, "⬇ Pobieranie"), ` — ${run.length} ${plPl(run.length, "słownik", "słowniki", "słowników")}`),
    run.slice(0, 3).map(([id, j]) => h("div", { class: "small djob" },
      j.state === "pobieranie" && j.total > 0 && h("progress", { max: j.total, value: j.done, "aria-label": `Pobieranie: ${nameOf(id)}` }),
      `${nameOf(id)} · ${Dicts.jobText(j, fmtSize)}`)),
    run.length > 3 && h("div", { class: "muted small" }, `i ${run.length - 3} ${plPl(run.length - 3, "inny", "inne", "innych")}`),
    bad.map(([id, j]) => h("div", { class: "err small", role: "alert" }, `Nie udało się: ${nameOf(id)} — ${j.error}`)),
    S.dictMsg && h("div", { class: "row" },
      h("span", { class: S.dictMsg.ok ? "ok" : "err" }, (S.dictMsg.ok ? "✓ " : "") + S.dictMsg.text),
      h("button", { type: "button", class: "linkbtn", onclick: () => { S.dictMsg = null; render(); } }, "Ukryj")));
}

// Kafle na górze (TASK-58): słowniki · MB w panelu · czytniki ze zgodą. Trwające pobieranie ma własny pasek (dictJobBar).
function dictTiles(dicts, active) {
  const devs = S.state.devices || [];
  const zip = active.reduce((n, d) => n + d.size, 0);
  const ok = devs.filter(d => d.dicts_allowed).length;
  const tile = (big, label) => h("div", { class: "dtile" }, h("b", {}, big), h("span", { class: "muted small" }, label));
  return h("div", { class: "dtiles", id: "dict-tiles", role: "group", "aria-label": "Podsumowanie słowników" },
    tile(String(active.length), plPl(active.length, "słownik", "słowniki", "słowników")),
    tile(fmtSize(zip), "w panelu"),
    tile(devs.length ? `${ok} z ${devs.length}` : "0", devs.length ? plPl(devs.length, "czytnik ze zgodą", "czytniki ze zgodą", "czytników ze zgodą") : "czytników"));
}

// Wgrywanie własnego słownika (TASK-58): druga zakładka arkusza „Dodaj słownik” („Z katalogu” · „Własny plik”).
// Na stronie jest jedno wejście („＋ Dodaj słownik”); wcześniej osobny kafelek na końcu listy dublował przycisk.
function dictOwnTab() {
  const over = (ev, on) => { ev.preventDefault(); ev.currentTarget.classList.toggle("over", on); };
  return h("div", { id: "addpanel-wlasny", role: "tabpanel", "aria-labelledby": "dtab-wlasny" },
    h("div", { class: "dropzone", id: "f-dict-drop",
      ondragover: ev => over(ev, true), ondragleave: ev => over(ev, false),
      ondrop: ev => { over(ev, false); uploadDicts(ev.dataTransfer.files); } },
      h("p", {}, h("b", {}, S.dictBusy ? "Wgrywam…" : "Upuść tu archiwum słownika albo jego pliki")),
      h("p", { class: "muted small" }, "albo"),
      h("button", { type: "button", class: "primary", id: "b-dict-pick", disabled: S.dictBusy, onclick: () => document.getElementById("f-dict-files").click() }, "Wybierz pliki…"),
      h("input", { type: "file", id: "f-dict-files", multiple: true, hidden: true, "aria-label": "Pliki słownika",
        accept: ".zip,.tar,.tgz,.gz,.bz2,.zst,.ifo,.idx,.dict,.dz,.syn,.css",
        onchange: ev => uploadDicts(ev.target.files) })),
    h("label", { class: "field", style: "margin:12px 0 0" },
      h("span", {}, "Nazwa katalogu na czytniku (opcjonalnie)"),
      h("input", { type: "text", id: "f-dict-name", maxlength: 96, placeholder: "domyślnie z nazwy pliku", style: "max-width:26em" })),
    h("p", { class: "muted small" }, "Archiwum zip, tar.gz, tar.bz2 albo tar.zst jednego słownika (do 300 MB) albo luźne pliki StarDict: .ifo, .idx, .dict.dz (i .syn). Pliki spoza słownika, w tym .lua, są pomijane. ",
      h("button", { type: "button", class: "linkbtn", onclick: () => showHow("dicts") }, "Jak to działa ›")));
}

// Biblioteka jako tabela (TASK-60, wybory wybor/slowniki3 i slowniki4): ☐ · Słownik · Język (dwa wiersze „z”/„na”) ·
// Hasła / rozmiar (dwa wiersze + pasek) · Źr. (ikona) · po jednej kolumnie na czytnik. Usuwa się zbiorczo
// („Usuń zaznaczone”), nie przyciskiem w wierszu. Język serwer zapisuje tylko w katalogu, więc słownik z katalogu
// bierze go przez source_ref, a wgrany pokazuje „—”.
const DICT_ICON = {
  katalog: ["M5 12.5h6a3 3 0 0 0 .4-5.97A4 4 0 0 0 3.7 7.2 2.7 2.7 0 0 0 5 12.5zM8 6.8v4.2M6.4 9.5 8 11l1.6-1.5", "z katalogu"],
  upload: ["M4 1.8h5l3 3v9.4H4zM8 12V7.6M6.4 9.2 8 7.6l1.6 1.6", "wgrany z panelu"],
};
function dictSrcIcon(src) {
  const [path, text] = DICT_ICON[src] || DICT_ICON.upload;
  const s = h("span", { class: "dsrc", title: text, role: "img", "aria-label": text });
  s.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
  return s;
}
let dictCatMapFor = null, dictCatMap = null;
function dictCatById() {
  if (!S.dictCat) return null;
  if (dictCatMapFor !== S.dictCat) { dictCatMapFor = S.dictCat; dictCatMap = new Map(S.dictCat.map(c => [c.id, c])); }
  return dictCatMap;
}
function dictLangCell(d) {
  const l = Dicts.dictLangs(d, dictCatById());
  if (!l) return h("span", { class: "muted", title: d.source === "katalog" && !S.dictCat ? "katalog się wczytuje" : "język znamy tylko dla słowników z katalogu" }, "—");
  if (l.a === l.b) return h("span", { class: "dst" }, langName(l.a));
  return h("div", {}, h("span", { class: "dst" }, h("i", {}, "z"), langName(l.a)), h("span", { class: "dst" }, h("i", {}, "na"), langName(l.b)));
}
function dictSizeCell(d, maxWords) {
  const full = [d.words > 0 ? hasWords(d.words) : null, `${fmtSize(d.size)} (${fmtSize(d.unpacked)} po rozpakowaniu)`].filter(Boolean).join(" · ");
  return h("div", { class: "dnum", title: full },
    d.words > 0 ? [h("span", { class: "dn1" }, `${Dicts.shortCount(d.words)} ${d.words < 1000 ? plPl(d.words, "hasło", "hasła", "haseł") : "haseł"}`),
      h("i", { class: "dbar", style: `width:${Dicts.logBar(d.words, maxWords)}%` })] : h("span", { class: "dn1 muted" }, "— haseł"),
    h("span", { class: "dn2" }, fmtSize(d.size)));
}

function dictLibrary(dicts, active) {
  const list = [...dicts].sort((a, b) => (a.title || a.name).localeCompare(b.title || b.name, "pl"));
  const devs = S.state.devices || [];
  const sel = list.filter(d => S.dictSel.has(d.sha256));
  const maxWords = Math.max(0, ...list.map(d => d.words || 0));
  const allOn = list.length > 0 && sel.length === list.length;
  const rerender = id => { render(); document.getElementById(id)?.focus(); };
  const allBox = h("input", { type: "checkbox", id: "dl-all", checked: allOn, "aria-label": "Zaznacz wszystkie słowniki",
    onchange: ev => { if (ev.target.checked) list.forEach(d => S.dictSel.add(d.sha256)); else S.dictSel.clear(); rerender("dl-all"); } });
  allBox.indeterminate = sel.length > 0 && !allOn; // tylko właściwość, nie atrybut
  const head = h("thead", {}, h("tr", {},
    h("th", { scope: "col", class: "ctr" }, allBox),
    h("th", { scope: "col", class: "dname" }, "Słownik"),
    h("th", { scope: "col" }, "Język"),
    h("th", { scope: "col", class: "num" }, "Hasła / rozmiar"),
    h("th", { scope: "col", class: "ctr", title: "Skąd słownik jest w panelu" }, "Źr."),
    devs.map(dev => {
      const st = Dicts.deviceState(dev, active);
      const sub = st.kind === "no-consent" ? "bez zgody" : st.kind === "waiting" ? "czeka na synchronizację" : `${st.have} z ${st.total}`;
      return h("th", { scope: "col", class: "ctr dev" }, dev.name, h("div", { class: "muted small", style: "font-weight:400" }, sub));
    })));
  const body = list.map(d => {
    const id = "dl-" + d.sha256.slice(0, 12), isActive = d.active && d.approved;
    return h("tr", { class: S.dictSel.has(d.sha256) ? "sel" : "", "data-sha": d.sha256 },
      h("td", { class: "ctr" }, h("input", { type: "checkbox", id, checked: S.dictSel.has(d.sha256), "aria-label": `Zaznacz: ${d.title || d.name}`,
        onchange: ev => { if (ev.target.checked) S.dictSel.add(d.sha256); else S.dictSel.delete(d.sha256); rerender(id); } })),
      h("td", { class: "dname", title: [d.added && "Dodano " + new Date(d.added).toLocaleDateString("pl"), d.name].filter(Boolean).join(" · ") },
        h("b", {}, d.title || d.name),
        d.title && d.title !== d.name && h("div", { class: "muted small" }, d.name),
        d.dropped > 0 && h("div", { class: "dwarn small" }, `⚠ Pominięto ${d.dropped} ${plPl(d.dropped, "plik", "pliki", "plików")} spoza słownika (m.in. .lua — KOReader wykonuje je jako kod).`)),
      h("td", { class: "dlang" }, dictLangCell(d)),
      h("td", { class: "num" }, dictSizeCell(d, maxWords)),
      h("td", { class: "ctr" }, dictSrcIcon(d.source)),
      devs.map(dev => {
        if (!isActive) return h("td", { class: "cell ctr muted" }, "—");
        const [sym, text] = DICT_CELL[Dicts.cellState(dev, d)];
        return h("td", { class: "cell ctr", title: text, "data-label": dev.name }, h("span", { "aria-hidden": "true" }, sym), h("span", { class: "sr" }, text));
      }));
  });
  const noc = devs.filter(d => !d.dicts_allowed);
  return h("section", { class: "card", id: "dict-library" },
    h("h3", { style: "margin-top:0" }, "Słowniki w panelu"),
    list.length === 0
      ? h("p", { class: "muted" }, "Nic tu jeszcze nie ma. „＋ Dodaj słownik” pobierze go z katalogu albo wgra Twój plik.")
      : [sel.length > 0 && h("div", { class: "dbulk", id: "dict-bulk", role: "region", "aria-label": "Zaznaczone słowniki" },
          h("b", {}, `Zaznaczono ${sel.length}`),
          h("button", { type: "button", class: "linkbtn", onclick: () => { S.dictSel.clear(); render(); } }, "Wyczyść"),
          h("button", { type: "button", class: "danger", id: "b-dict-del", onclick: () => deleteDicts(sel) }, "Usuń zaznaczone")),
        h("div", { class: "matrix-wrap" },
          labelCells(h("table", { class: "matrix pmx dense dtable dictmx", "aria-label": "Słowniki w panelu" }, head, h("tbody", {}, body)))),
        h("p", { class: "muted small dlegend" },
          h("span", {}, dictSrcIcon("katalog"), " z katalogu"), h("span", {}, dictSrcIcon("upload"), " wgrany z panelu"),
          devs.length > 0 && active.length > 0 && h("span", {}, "● jest na czytniku · ○ czeka na synchronizację · ↻ starsza wersja · ⊘ czytnik bez zgody")),
        devs.length === 0 && h("p", { class: "muted small" }, "Nie połączono jeszcze żadnego czytnika — po połączeniu dostanie wszystkie słowniki z panelu (do 150 MB na jedną synchronizację)."),
        devs.length > 0 && h("p", { class: "muted small" }, "Każdy czytnik ze zgodą dostaje wszystkie słowniki z panelu (do 150 MB na jedną synchronizację). Niczego tu nie zmieniasz — zgodę daje czytnik."),
        noc.length > 0 && h("p", { class: "muted small", style: "margin-bottom:0" },
          `Bez zgody: ${noc.map(d => d.name).join(", ")}. Zgodę daje się na czytniku: ${MENU_PATH} → Zgody → Synchronizuj słowniki.`)]);
}

// Katalog jako tabela (TASK-60): ☐ · Słownik · Para · Hasła · Źr. (monogram pochodzenia: K = KOReader, W = WikDict,
// kd = koreader-dicts; legenda pod tabelą). Stan pobierania zostaje pod nazwą, a „pobrany” jest plakietką (po nazwie).
const ORIGIN_MONO = { koreader: "K", wikdict: "W", "koreader-dicts": "kd" };
function dictCatalogRow(c, have, job, maxEntries) {
  const busy = job && job.state !== "błąd", failed = job && job.state === "błąd";
  const origin = (Dicts.ORIGINS.find(o => o[0] === c.origin) || [0, c.origin])[1];
  const id = "dp-" + c.id;
  return h("tr", { class: "dcat" + (S.dictPick.has(c.id) && !busy ? " sel" : ""), "data-dict": c.id },
    h("td", { class: "ctr" }, h("input", { type: "checkbox", id, checked: S.dictPick.has(c.id) && !busy, disabled: busy, "aria-label": `Zaznacz: ${c.name}`,
      onchange: ev => { if (ev.target.checked) S.dictPick.add(c.id); else S.dictPick.delete(c.id); render(); document.getElementById(id)?.focus(); } })),
    h("td", { class: "dname", title: c.license ? "Licencja: " + c.license : null },
      h("b", {}, c.name), have && h("span", { class: "badge" }, " pobrany"),
      busy && h("div", { class: "small", role: "status" },
        job.state === "pobieranie" && job.total > 0 && h("progress", { max: job.total, value: job.done, "aria-label": `Pobieranie: ${c.name}`, style: "width:10em;margin-right:8px" }),
        Dicts.jobText(job, fmtSize)),
      failed && h("div", { class: "err small", role: "alert" }, `Nie udało się: ${job.error} `,
        h("button", { type: "button", class: "linkbtn", onclick: () => startDictJobs([c]) }, "Spróbuj ponownie"))),
    h("td", { class: "dlang" }, c.lang_in === c.lang_out ? langName(c.lang_in) : `${langName(c.lang_in)} → ${langName(c.lang_out)}`),
    h("td", { class: "num" }, c.entries > 0
      ? h("div", { class: "dnum", title: hasWords(c.entries) }, h("span", { class: "dn1" }, Dicts.shortCount(c.entries)), h("i", { class: "dbar", style: `width:${Dicts.logBar(c.entries, maxEntries)}%` }))
      : h("span", { class: "muted" }, "—")),
    h("td", { class: "ctr" }, h("span", { class: "mg", title: origin, role: "img", "aria-label": origin }, ORIGIN_MONO[c.origin] || "?")));
}

// Wybór wielu języków (TASK-58): pole z żetonami i podpowiedziami. W obrębie jednego pola języki się sumują
// (polski LUB angielski), a „z” i „na” łączą się iloczynem. Podpowiedzi jednego pola pokazują tylko języki,
// które mają parę z wybranymi w drugim; wybrane, które przestają ją mieć, są zdejmowane.
const dictLangSet = which => which === "in" ? S.dictIn : S.dictOut;
function dictLangOptions(cat, which) {
  const other = dictLangSet(which === "in" ? "out" : "in");
  const key = which === "in" ? "lang_in" : "lang_out";
  return Dicts.langCounts(other.length ? Dicts.filterCatalog(cat, which === "in" ? { outL: other } : { inL: other }) : cat, key);
}
function dictLangPrune(cat, which) {
  const have = new Set(dictLangOptions(cat, which).map(([code]) => code));
  const kept = dictLangSet(which).filter(code => have.has(code));
  if (which === "in") S.dictIn = kept; else S.dictOut = kept;
}
function dictLangSuggest(cat, which) {
  const q = Dicts.fold(S.dictLangQ[which]), mine = new Set(dictLangSet(which));
  return dictLangOptions(cat, which).filter(([code]) => !mine.has(code) && (!q || Dicts.fold(langName(code)).includes(q) || code.includes(q)))
    .slice(0, q ? 12 : 8);
}
function dictLangRefocus(which) { const el = document.getElementById("f-dict-" + which); if (el) { el.focus({ preventScroll: true }); el.setSelectionRange(el.value.length, el.value.length); } }
function dictLangApply(cat, which, codes) {
  if (which === "in") S.dictIn = codes; else S.dictOut = codes;
  dictLangPrune(cat, which === "in" ? "out" : "in");
  S.dictShown = DICT_PAGE;
}
function dictLangField(cat, which) {
  const label = which === "in" ? "Z języka" : "Na język", id = "f-dict-" + which;
  const mine = dictLangSet(which), open = S.dictLangOpen === which;
  const sug = open ? dictLangSuggest(cat, which) : [];
  const hi = Math.min(S.dictLangHi, Math.max(0, sug.length - 1));
  const add = code => { dictLangApply(cat, which, [...dictLangSet(which), code]); S.dictLangQ[which] = ""; S.dictLangHi = 0; render(); dictLangRefocus(which); };
  const drop = code => { dictLangApply(cat, which, dictLangSet(which).filter(c => c !== code)); render(); dictLangRefocus(which); };
  return h("div", { class: "langfield", "data-lang": which },
    h("label", { class: "lab2", for: id }, label),
    h("div", { class: "tagbox" + (open ? " focus" : "") },
      mine.map(code => h("span", { class: "lchip" }, langName(code),
        h("button", { type: "button", "aria-label": `Usuń język: ${langName(code)}`, onclick: () => drop(code) }, "×"))),
      h("input", { type: "text", id, class: "langin", autocomplete: "off", role: "combobox", "aria-expanded": String(open && sug.length > 0),
        "aria-controls": "dict-sug-" + which, "aria-activedescendant": open && sug.length ? `dsug-${which}-${sug[hi][0]}` : null,
        placeholder: which === "in" || mine.length ? "dodaj język…" : "dowolny — wpisz, żeby zawęzić", value: S.dictLangQ[which],
        onclick: () => { if (S.dictLangOpen !== which) { S.dictLangOpen = which; S.dictLangHi = 0; render(); dictLangRefocus(which); } },
        oninput: ev => { S.dictLangQ[which] = ev.target.value; S.dictLangOpen = which; S.dictLangHi = 0; render(); dictLangRefocus(which); },
        onkeydown: ev => {
          if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
            ev.preventDefault();
            S.dictLangOpen = which;
            S.dictLangHi = sug.length ? (hi + (ev.key === "ArrowDown" ? 1 : sug.length - 1)) % sug.length : 0;
            render(); dictLangRefocus(which);
          } else if (ev.key === "Enter") {
            ev.preventDefault();
            if (open && sug.length) add(sug[hi][0]);
          } else if (ev.key === "Backspace" && !ev.target.value && mine.length) {
            drop(mine[mine.length - 1]);
          } else if (ev.key === "Tab") { S.dictLangOpen = null; }
        } })),
    open && h("div", { class: "sugg", id: "dict-sug-" + which, role: "listbox", "aria-label": `${label}: podpowiedzi` },
      sug.length === 0 ? h("div", { class: "muted small" }, S.dictLangQ[which] ? "Nic nie pasuje do wpisanego tekstu." : "Brak więcej języków do wyboru.")
        : sug.map(([code, n], i) => h("div", { class: "opt" + (i === hi ? " on" : ""), role: "option", id: `dsug-${which}-${code}`, "aria-selected": String(i === hi),
          onmousedown: ev => { ev.preventDefault(); add(code); } },
          h("span", {}, langName(code)), h("span", { class: "muted" }, String(n))))));
}

function dictFilterBar(cat) {
  return h("div", {},
    h("div", { class: "row", style: "gap:8px;flex-wrap:wrap;margin:6px 0 10px" },
      h("input", { type: "search", id: "f-dictq", "aria-label": "Szukaj słownika", placeholder: "Szukaj słownika, języka…", value: S.dictQ, style: "flex:1 1 14em",
        oninput: ev => {
          const pos = ev.target.selectionStart;
          S.dictQ = ev.target.value; S.dictShown = DICT_PAGE; render();
          const el = document.getElementById("f-dictq");
          if (el) { el.focus(); el.setSelectionRange(pos, pos); }
        } }),
      h("select", { id: "f-dict-origin", "aria-label": "Pochodzenie", onchange: ev => { S.dictOrigin = ev.target.value; S.dictShown = DICT_PAGE; render(); document.getElementById("f-dict-origin")?.focus(); } },
        h("option", { value: "" }, "Każde pochodzenie"),
        Dicts.ORIGINS.map(([id, label]) => h("option", { value: id, selected: id === S.dictOrigin }, label))),
      h("label", { class: "row", style: "font-weight:400;gap:4px" },
        h("input", { type: "checkbox", id: "f-dict-only", checked: S.dictOnly, onchange: ev => { S.dictOnly = ev.target.checked; S.dictShown = DICT_PAGE; render(); document.getElementById("f-dict-only")?.focus(); } }),
        "tylko pobrane")),
    h("div", { class: "row langrow" }, dictLangField(cat, "in"), dictLangField(cat, "out")));
}

function dictCatalogPane(inSheet) {
  const cat = S.dictCat;
  if (!cat) return h("p", { class: "loading" }, "Wczytuję katalog…");
  const haveIds = new Set((S.dicts || []).filter(d => d.source === "katalog").map(d => d.source_ref));
  const filtered = !!(S.dictQ || S.dictIn.length || S.dictOut.length || S.dictOrigin || S.dictOnly);
  // Bez filtra nie rysujemy 1,7 tys. pozycji w kolejności kodów języków (pierwsze byłyby afarski i abchaski):
  // najpierw wybór języka, potem lista od największego słownika.
  const hits = filtered ? Dicts.sortCatalog(Dicts.filterCatalog(cat, { q: S.dictQ, inL: S.dictIn, outL: S.dictOut, origin: S.dictOrigin, only: S.dictOnly }, haveIds, langName), S.dictSort) : [];
  const maxEntries = Math.max(0, ...hits.map(c => c.entries || 0));
  const shown = hits.slice(0, S.dictShown);
  const picks = cat.filter(c => S.dictPick.has(c.id) && !(S.dictJobs[c.id] && S.dictJobs[c.id].state !== "błąd"));
  const langs = new Set(); for (const c of cat) { langs.add(c.lang_in); langs.add(c.lang_out); }
  return h(inSheet ? "div" : "section", { class: inSheet ? "" : "card" },
    !inSheet && h("h3", { style: "margin-top:0" }, "Katalog słowników"),
    h("p", { class: "muted small", style: "margin-top:0" }, "Lista pochodzi z KOReadera; pliki pobiera Twój serwer w chwili kliknięcia — wersje „latest” mogą się zmienić; serwer sprawdza format i nie instaluje plików .lua ani innych spoza słownika. ",
      h("button", { type: "button", class: "linkbtn", onclick: () => showHow("dicts") }, "Jak to działa ›")),
    dictFilterBar(cat),
    h("p", { class: "muted small", id: "dict-count", role: "status" },
      filtered ? `Pasuje ${fmtCount(hits.length)} z ${fmtCount(cat.length)}` : `${fmtCount(cat.length)} słowników w ${fmtCount(langs.size)} językach`,
      filtered && h("button", { type: "button", class: "linkbtn", style: "margin-left:8px",
        onclick: () => { S.dictQ = ""; S.dictIn = []; S.dictOut = []; S.dictLangOpen = null; S.dictLangQ = { in: "", out: "" }; S.dictOrigin = ""; S.dictOnly = false; S.dictShown = DICT_PAGE; render(); } }, "Wyczyść filtry")),
    filtered && hits.length > 1 && h("div", { class: "dseg", role: "group", "aria-label": "Kolejność" },
      [["size", "Największe"], ["name", "A–Z"]].map(([k, label]) => h("button", { type: "button", id: "b-dsort-" + k, "aria-pressed": String(S.dictSort === k),
        onclick: () => { S.dictSort = k; S.dictShown = DICT_PAGE; render(); document.getElementById("b-dsort-" + k)?.focus(); } }, label))),
    !filtered ? h("p", { class: "muted", id: "dict-prompt" }, "Wybierz języki „z” albo „na” (możesz kilka) albo wpisz nazwę — pokażę pasujące słowniki, największe pierwsze.")
      : hits.length === 0 ? h("p", { class: "muted" }, "Nic nie pasuje do filtrów.")
      : [h("div", { class: "matrix-wrap" }, labelCells(h("table", { class: "matrix pmx dense dtable dcattable", "aria-label": "Katalog słowników" },
          h("thead", {}, h("tr", {}, h("th", { scope: "col", class: "ctr" }, h("span", { class: "sr" }, "Zaznacz")), h("th", { scope: "col", class: "dname" }, "Słownik"), h("th", { scope: "col" }, "Para"),
            h("th", { scope: "col", class: "num" }, "Hasła"), h("th", { scope: "col", class: "ctr", title: "Skąd pochodzi pozycja katalogu" }, "Źr."))),
          h("tbody", {}, shown.map(c => dictCatalogRow(c, haveIds.has(c.id), S.dictJobs[c.id], maxEntries)))))),
        h("p", { class: "muted small dlegend" }, Dicts.ORIGINS.map(([id, label]) => h("span", {}, h("span", { class: "mg" }, ORIGIN_MONO[id]), " " + label)))],
    hits.length > shown.length && h("p", {},
      h("button", { type: "button", id: "b-dict-more", onclick: () => { S.dictShown += DICT_PAGE; render(); } },
        `Pokaż więcej (${fmtCount(hits.length - shown.length)} ${plPl(hits.length - shown.length, "została", "zostały", "zostało")})`)),
    picks.length > 0 && h("div", { class: "dmulti", id: "dict-multi", role: "region", "aria-label": "Zaznaczone słowniki" },
      h("b", {}, `Zaznaczono ${picks.length}`),
      h("span", { class: "small" }, "rozmiar poznasz po pobraniu; serwer pobiera po dwa naraz"),
      h("button", { type: "button", class: "linkbtn", onclick: () => { S.dictPick.clear(); render(); } }, "Wyczyść"),
      h("button", { type: "button", class: "primary", id: "b-dict-pick-go", onclick: () => startDictJobs(picks) }, "Pobierz zaznaczone")));
}

// Macierz słownik × czytnik (TASK-58): ● jest · ○ czeka na synchronizację · ↻ inna wersja · ⊘ czytnik bez zgody.
// Niczego tu nie zmieniasz — zgodę na słowniki daje wyłącznie czytnik (menu koligilo → Zgody).
const DICT_CELL = {
  ok: ["●", "jest na czytniku"], missing: ["○", "czeka na synchronizację"],
  stale: ["↻", "czytnik ma starszą wersję"], "no-consent": ["⊘", "czytnik bez zgody na słowniki"],
};
// Arkusz „Dodaj słownik” (TASK-58): katalog z filtrami i wyborem wielu słowników; pasek zadań widać też w nim,
// bo arkusz zasłania stronę, a pobieranie startuje właśnie stąd. Zostaje otwarty po „Pobierz zaznaczone”.
function openDictSheet() { S.dictSheet = true; S.dictTab = "cat"; render(); document.getElementById("f-dictq")?.focus(); }
function closeDictSheet() { S.dictSheet = false; S.dictLangOpen = null; S.dictTab = "cat"; render(); document.getElementById("b-dict-add")?.focus(); }
const DICT_TABS = [["cat", "Z katalogu", "dtab-cat"], ["wlasny", "Własny plik", "dtab-wlasny"]];
function dictTablist() {
  const go = (id, focus) => { S.dictTab = id; S.dictLangOpen = null; render(); if (focus) document.getElementById(DICT_TABS.find(t => t[0] === id)[2])?.focus(); };
  return h("div", { class: "tabs dsheet-tabs", role: "tablist", "aria-label": "Skąd wziąć słownik" },
    DICT_TABS.map(([id, label, tid], i) => h("button", {
      type: "button", role: "tab", id: tid, "aria-selected": String(S.dictTab === id), tabindex: S.dictTab === id ? "0" : "-1",
      class: "tab" + (S.dictTab === id ? " selected" : ""), onclick: () => go(id, false),
      onkeydown: ev => {
        const d = { ArrowRight: 1, ArrowLeft: -1 }[ev.key], home = ev.key === "Home", end = ev.key === "End";
        if (d == null && !home && !end) return;
        ev.preventDefault();
        go(DICT_TABS[home ? 0 : end ? DICT_TABS.length - 1 : (i + d + DICT_TABS.length) % DICT_TABS.length][0], true);
      } }, label)));
}
function dictSheet() {
  const bar = dictJobBar(true);
  return h("div", { class: "sheet-back", onmousedown: ev => { if (ev.target === ev.currentTarget) closeDictSheet(); } },
    h("div", { class: "sheet addsheet tall", role: "dialog", "aria-modal": "true", "aria-labelledby": "dsheet-title" },
      h("header", { class: "sheet-head" },
        h("h2", { id: "dsheet-title" }, "Dodaj słownik"),
        h("button", { type: "button", id: "dsh-close", "aria-label": "Zamknij", onclick: closeDictSheet }, "×")),
      bar && h("div", { class: "sheet-src" }, bar),
      dictTablist(),
      h("div", { class: "sheet-body" }, S.dictTab === "wlasny" ? dictOwnTab() : dictCatalogPane(true))));
}

function dictsTab() {
  const dicts = S.dicts || [];
  const active = dicts.filter(d => d.active && d.approved);
  return h("div", {},
    dictTiles(dicts, active),
    dictJobBar(false),
    h("div", { class: "row", style: "margin:0 0 14px" },
      h("button", { type: "button", class: "primary", id: "b-dict-add", onclick: openDictSheet }, "＋ Dodaj słownik")),
    dictLibrary(dicts, active),
    S.dictSheet && dictSheet());
}

const TABS = VIEWS.map(v => v[0]);

function showTab(id) {
  const changed = S.tab !== id;
  S.tab = id;
  history.replaceState(null, "", "#" + id);
  if (changed) { app.scrollTop = 0; S.devEdit = null; S.devMenu = null; S.addReader = null; S.rvMsg = null; S.usbMsg = null; S.addSheet = null; S.dictSheet = false; S.dictTab = "cat"; }
  if (id === "konta" || id === "wtyczki" || id === "czcionki" || id === "slowniki") return refresh();
  render();
}

// Stary hash #galeria (dawna osobna pozycja nawigacji) → „Wtyczki” z otwartym
// arkuszem „Dodaj wtyczkę” na galerii (TASK-19, TASK-33).
if (location.hash === "#galeria") { S.tab = "wtyczki"; S.addSheet = newSheet("galeria"); }
else if (TABS.includes(location.hash.slice(1)) || location.hash === "#ustawienia") S.tab = location.hash.slice(1);

// Klik poza polem języka zamyka podpowiedzi (nie używamy blur: render() podmienia DOM i zrywał by fokus).
document.addEventListener("click", ev => {
  if (S.dictLangOpen && !ev.target.closest(".langfield")) { S.dictLangOpen = null; render(); }
});

// Skróty: Alt+1…9 — widoki; „/” — wyszukiwarka galerii (arkusz „Dodaj wtyczkę”); Esc — zamyka arkusz; Tab krąży w arkuszu.
document.addEventListener("keydown", ev => {
  const inNav = document.getElementById("nav").contains(ev.target);
  const navReady = !document.getElementById("shell").classList.contains("bare");
  const digit = /^Digit([1-9])$/.exec(ev.code);
  if (navReady && ev.altKey && !ev.ctrlKey && !ev.metaKey && digit && TABS[digit[1] - 1]) {
    ev.preventDefault();
    showTab(TABS[digit[1] - 1]);
    return;
  }
  const dsheet = S.dictSheet && S.tab === "slowniki";
  const asheet = S.state && addSheetOpen();
  if (dsheet && S.dictLangOpen && ev.key === "Escape") {
    ev.preventDefault();
    const w = S.dictLangOpen; S.dictLangOpen = null; render(); document.getElementById("f-dict-" + w)?.focus();
    return;
  }
  if (dsheet || asheet || (S.addSheet && S.tab === "wtyczki")) {
    if (ev.key === "Escape" && (dsheet || asheet || !S.addSheet.busy)) { ev.preventDefault(); if (asheet) closeAddReader(); else if (dsheet) closeDictSheet(); else closeAddSheet(); return; }
    if (ev.key === "Tab") {
      const sheet = document.querySelector(".sheet");
      const f = sheet ? [...sheet.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]')] : [];
      if (f.length) {
        const first = f[0], last = f[f.length - 1], at = document.activeElement;
        if (!sheet.contains(at) || (ev.shiftKey && at === first)) { ev.preventDefault(); (ev.shiftKey ? last : first).focus(); }
        else if (!ev.shiftKey && at === last) { ev.preventDefault(); first.focus(); }
      }
      return;
    }
  }
  const t = ev.target, editing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  if (navReady && ev.key === "?" && !editing && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
    ev.preventDefault();
    openKeys();
    return;
  }
  if (navReady && ev.key === "/" && !editing && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
    ev.preventDefault();
    // „Wtyczki” → arkusz „Dodaj wtyczkę” na galerii; refresh() zwraca
    // obietnicę — pole wyszukiwania jest w DOM dopiero po niej.
    const need = S.tab !== "wtyczki" || S.plugView !== "main" || !S.addSheet || S.addSheet.src !== "galeria";
    S.tab = "wtyczki";
    history.replaceState(null, "", "#wtyczki");
    S.plugView = "main";
    if (need) S.addSheet = newSheet("galeria");
    Promise.resolve(need ? refresh() : null)
      .then(() => document.getElementById("f-galq")?.focus());
    return;
  }
  if (inNav && ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(ev.key)) {
    const items = [...document.querySelectorAll("#nav .nav-item")];
    const i = items.indexOf(document.activeElement);
    const next = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: items.length - 1 }[ev.key];
    items[(next + items.length) % items.length]?.focus();
    ev.preventDefault();
  }
});

(async () => {
  await detectMode();
  await refresh();
  if (S.addSheet) document.getElementById("f-galq")?.focus();
  // prośby o parowanie pojawiają się same — odpytujemy co 3 s, ale nie
  // przerysowujemy, gdy użytkownik pisze w formularzu
  setInterval(() => {
    const typing = document.activeElement && document.activeElement.tagName === "INPUT"
      && document.activeElement.type !== "checkbox";
    // na zakładce kont i w zakładkach Wtyczek (poza „Ustawieniami wtyczek”) nie odświeżamy
    // w tle — formularze i wybory urządzeń/wersji zmieniają się tylko po zapisie.
    // „Ustawienia wtyczek” (jak „Ustawienia czytników”) odświeżają się: cały stan edycji
    // jest w S (S.pad.drafts), a wartość może się zmienić z innego czytnika.
    // W „Ustawieniach czytników” i „Ustawieniach wtyczek” nie zabieramy fokusu kontrolce (klawiatura)
    const plugSet = S.tab === "wtyczki" && S.plugView === PLUGSET;
    const focusedCtl = (S.tab === "wspolne" || plugSet) && document.activeElement !== app && app.contains(document.activeElement);
    if (!typing && !focusedCtl && !S.busy && !S.srvBusy && !S.pad.busy
      && (plugSet || (S.tab !== "konta" && S.tab !== "wtyczki"))) refresh();
  }, 3000);
})();
