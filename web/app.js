// Panel koligilo — vanilla JS, bez zależności. Dwa tryby:
//  • desktop (`koligilo`): /api/local/* istnieje; w trybie komputera (TASK-15)
//    /api/admin/* obsługuje wbudowany serwer, w trybie „Mój serwer” proxy
//    z tokenem doklejanym przez lokalny proces,
//  • serwer (`koligilo serve`): token administratora w localStorage.
"use strict";

const app = document.getElementById("app");
const S = {
  mode: null,          // "desktop" | "serve"
  local: null,         // /api/local/config: {mode, chosen, server, public_url, moved_to, …}
  state: null,         // /api/admin/state
  tab: "urzadzenia",
  error: null,
  wizardChoice: "local",
  srvMsg: null,        // widok „Serwer”: {ok, text}
  srvBusy: false,
  busy: false,
  usb: null,           // {readers, adb} — tylko tryb desktop
  usbBusy: null,       // id czytnika w trakcie parowania
  usbMsg: null,
  rvCode: "",          // wpisywany kod z czytnika
  rvFound: null,       // {name, platform, ...} po sprawdzeniu kodu
  rvMsg: null,
  rvBusy: false,
  acc: null,           // /api/admin/accounts
  dr: {},              // szkice formularzy kont (przeżywają przerysowanie)
  accMsg: {},          // komunikaty per formularz: {ok, text}
  accBusy: null,       // który formularz się zapisuje
  valDrafts: {},       // edytory wartości: id -> {type, text, bool, error, isNew}
  valMsg: {},          // komunikaty per wartość: {ok, text}
  valBusy: null,       // id wartości w trakcie zapisu/wczytywania
  valNew: {},          // szkice nowych wartości (klucz spoza katalogu): groupId -> {key, type, text, bool, error}
  valSel: null,        // zaznaczone ustawienie (id) — otwiera panel podglądu strony (TASK-23, web/preview.js)
  valFull: {},         // pełne literały przyciętych podglądów: id -> {t, lit}
  valAdv: false,       // sekcja „Zaawansowane” rozwinięta?
  valOpen: {},         // rozwinięte kategorie/opisy w widoku ustawień: klucz -> true
  ctl: {},             // szkice pól liczbowych/tekstowych kontrolek: id(+część) -> tekst

  // wtyczki (TASK-10/11); TASK-19: jedna pozycja nawigacji z zakładkami
  // wewnętrznymi (S.pluginTab), TASK-20: gwiazdki ulubionych.
  plugins: null,       // /api/admin/plugins → lista PluginVersion
  pluginTab: pluginTabGet(), // "urzadzenia" | "wtyczki" | "galeria" — zapamiętane lokalnie
  favBusy: null,       // klucz ulubionej w trakcie zapisu
  favOnly: false,      // filtr „Tylko ulubione” w zakładce „Wg wtyczek” (TASK-20 AC2)
  gallery: null,       // /api/admin/gallery → {repos, total, page, updated_at, note, stale}
  galQ: "",
  galSort: "stars",
  galPage: 1,
  galBusy: false,
  galInstall: {},       // per repo full_name: {devices:Set, busy, msg, candidates, path}
  uploadBusy: false,
  uploadMsg: null,
  devPluginDraft: {},   // per device id: {sha}
  devPluginBusy: null,
  devPluginMsg: {},
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

const ICONS = {
  urzadzenia: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 7.5h6M9 11h6M9 14.5h3.5"/>',
  grupy: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  konta: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M15.5 7.5l3 3"/>',
  wspolne: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  wtyczki: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
  galeria: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  serwer: '<rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/><path d="M8 7.5h.01M8 16.5h.01"/>',
  jak: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.7.3-1.2.9-1.2 1.6v.5M12 17h.01"/>',
  auto: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  dark: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/>',
  ustawienia: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.6M12 18.4V21M21 12h-2.6M5.6 12H3M18.02 5.98l-1.84 1.84M7.82 16.18l-1.84 1.84M18.02 18.02l-1.84-1.84M7.82 7.82L5.98 5.98"/>',
};
function icon(name) {
  const s = h("span", { class: "ico", "aria-hidden": "true" });
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return s.firstChild;
}

// Widoki: [id, etykieta, licznik?]. Kolejność = skróty Alt+1…7. „Aplikacja”
// (dawne „Ustawienia” w stopce paska) to zwykła zakładka; „Ustawienia czytników”
// to dawne „Wspólne ustawienia” — dwie różne rzeczy, więc dwie różne nazwy.
// TASK-19: "Wtyczki" i dawna "Galeria wtyczek" to teraz jedna pozycja z
// zakładkami wewnętrznymi (S.pluginTab, patrz pluginsTab()).
const VIEWS = [
  ["urzadzenia", "Urządzenia", st => st.devices.length],
  ["grupy", "Co synchronizować"],
  ["konta", "Konta"],
  ["wspolne", "Ustawienia czytników", st => st.values.filter(v => !v.deleted).length],
  ["wtyczki", "Wtyczki"],
  ["jak", "Jak to działa"],
  ["ustawienia", "Aplikacja"],
];

// Zakładka wtyczek zapamiętana w tej przeglądarce (wzorzec jak themeGet/Set).
const PLUGTAB_KEY = "koligilo.pluginTab";
function pluginTabGet() { try { return localStorage.getItem(PLUGTAB_KEY) || "urzadzenia"; } catch { return "urzadzenia"; } }
function pluginTabSet(id) { try { localStorage.setItem(PLUGTAB_KEY, id); } catch {} }

// Motyw: "auto" (wg prefers-color-scheme) | "light" (papier) | "dark" (odwrócony e-ink).
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

function renderNav() {
  const ready = !!S.state && !needsWizard() && !(S.mode === "serve" && !adminToken());
  document.getElementById("shell").classList.toggle("bare", !ready);
  const nav = document.getElementById("nav");
  if (!ready) { nav.replaceChildren(); return; }
  nav.replaceChildren(h("ul", {}, VIEWS.map(([id, label, count], i) => h("li", {},
    h("button", {
      type: "button", class: "nav-item", id: "nav-" + id, "data-view": id, "aria-label": label,
      "aria-current": S.tab === id ? "page" : null, "aria-keyshortcuts": "Alt+" + (i + 1),
      title: `${label} (Alt+${i + 1})`, onclick: () => showTab(id),
    },
      icon(id), h("span", { class: "label" }, label),
      id === "urzadzenia" && S.state.pending.length > 0 && h("span", { class: "pend", title: "Czytnik czeka na połączenie" }),
      count && h("span", { class: "count" }, count(S.state)))))));
}

function renderSync() {
  const el = document.getElementById("sync");
  const last = (S.state?.devices || []).filter(d => d.last_sync).sort((a, b) => new Date(b.last_sync.at) - new Date(a.last_sync.at))[0];
  el.textContent = !S.state ? "" : last ? `Ostatnia synchronizacja: ${ago(last.last_sync.at)} (${last.name || last.model})` : "Jeszcze bez synchronizacji";
}

function explain(...paras) {
  return h("div", { class: "explain" }, paras.map(p => h("p", {}, p)));
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
    if (S.tab === "wspolne") await valLoadFull();
    if (S.tab === "konta") {
      try { S.acc = await api("GET", "/api/admin/accounts"); } catch (e) { S.acc = null; S.error = e.message; }
    }
    if (S.tab === "wtyczki") {
      try { S.plugins = (await api("GET", "/api/admin/plugins")).plugins; } catch (e) { S.plugins = null; S.error = e.message; }
    }
    if (S.tab === "wtyczki" && !S.galUpdates) {
      try { S.galUpdates = await api("GET", "/api/admin/gallery/updates"); } catch (e) { S.galUpdates = null; S.error = e.message; }
    }
    if (S.tab === "wtyczki" && S.pluginTab === "galeria") {
      const qs = new URLSearchParams({ q: S.galQ, sort: S.galSort, page: String(S.galPage) });
      try { S.gallery = await api("GET", "/api/admin/gallery?" + qs); } catch (e) { S.gallery = null; S.error = e.message; }
    }
    if (S.mode === "desktop" && S.tab === "urzadzenia" && !S.usbBusy) {
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
  if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
  // panel podglądu żyje poza #app (ramki nie przeładowują się co 3 s)
  if (typeof Preview !== "undefined") {
    if (S.tab === "wspolne" && S.state && !needsWizard()) Preview.update(pvSettings(), S.state.devices);
    else Preview.close();
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
    c.replaceChildren(h("button", { type: "button", onclick: () => showTab("ustawienia"), title: "Aplikacja → Serwer" }, dot, label));
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

function ustawieniaTab() {
  return h("div", {},
    h("section", { class: "card" },
      h("h3", { style: "margin-top:0" }, "Wygląd"),
      h("p", { class: "muted small", style: "margin-top:0" }, "Motyw panelu — zapamiętywany w tej przeglądarce."),
      themeControl()),
    h("section", { class: "card", style: "margin-top:16px" },
      h("h3", { style: "margin-top:0" }, "Serwer"),
      S.mode === "desktop" ? serverTab() : serverTabServe()),
    h("section", { class: "card prose", style: "margin-top:16px" },
      h("h3", { style: "margin-top:0" }, "O aplikacji"),
      h("p", { style: "margin-top:0" }, "koligilo ", S.state ? S.state.version : "…"),
      h("h4", {}, "Skróty klawiszowe"),
      shortcutsList()));
}

// Tryb serwera (VPS, koligilo serve): panel zarządza serwerem, na którym sam działa —
// nie ma tu „zmiany serwera” jak w trybie komputera (S.local), sekcja jest okrojona.
function serverTabServe() {
  return explain(`Ten panel działa na serwerze pod adresem ${location.origin} i nim zarządza. Token administratora, który wpisano przy wejściu, jest zapamiętany tylko w tej przeglądarce.`);
}

function shortcutsList() {
  return h("dl", { class: "shortcuts" },
    h("dt", {}, h("kbd", {}, "Alt"), "+", h("kbd", {}, "1"), "…", h("kbd", {}, "7")), h("dd", {}, "przełącz zakładkę"),
    h("dt", {}, h("kbd", {}, "/")), h("dd", {}, "szukaj w Galerii wtyczek"),
    h("dt", {}, h("kbd", {}, "←"), " ", h("kbd", {}, "→"), " ", h("kbd", {}, "Home"), " ", h("kbd", {}, "End")), h("dd", {}, "po zakładkach, gdy jest na nich fokus"));
}

// ------------------------------------------------ sekcja „Serwer” (tryb desktop, TASK-15)

function serverTab() {
  const L = S.local, local = L.mode === "local";
  return h("div", {},
    explain(local
      ? "Ten komputer jest serwerem koligilo. Czytniki synchronizują się tylko wtedy, gdy jest włączony i widoczny — w tej samej sieci Wi-Fi albo przez Tailscale. Do tego czasu zmiany czekają na czytniku i dojdą przy następnym połączeniu."
      : "Panel pokazuje Twój własny serwer. Dane tego komputera leżą nietknięte — możesz w każdej chwili wrócić do trybu „Ten komputer”."),
    L.moved_to && h("section", { class: "card", style: "margin-bottom:16px" },
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
    S.srvMsg && h("p", { class: S.srvMsg.ok ? "ok" : "err" }, S.srvMsg.text),
    local ? localCards() : remoteCards(),
    h("section", { class: "card", style: "margin-top:16px" },
      h("h3", { style: "margin-top:0" }, "Kopia danych tego komputera"),
      h("p", { class: "muted small", style: "margin-top:0" }, "Urządzenia, ustawienia czytników, wtyczki i galeria w jednym pliku .tar.gz (", h("code", {}, L.data_dir), "). Na serwerze wczytasz ją poleceniem ", h("code", {}, "koligilo import --data KATALOG plik.tar.gz"), "."),
      h("button", { onclick: downloadExport }, "Pobierz kopię")));
}

function localCards() {
  const L = S.local;
  return [
    h("section", { class: "card", style: "margin-top:16px" },
      h("h3", { style: "margin-top:0" }, "Adres dla czytników"),
      L.device_error ? h("p", { class: "err" }, L.device_error)
        : h("p", { style: "margin-top:0" }, "Czytniki łączą się z ", h("code", {}, L.public_url || "(nie znam adresu tego komputera w sieci)"),
          L.public_override ? " (wpisany ręcznie)." : " (wykryty automatycznie; Tailscale ma pierwszeństwo, a czytnik w tej samej sieci Wi-Fi dostaje adres z tej sieci)."),
      h("form", { class: "row", onsubmit: savePublicURL },
        h("input", { type: "text", name: "url", id: "f-puburl", placeholder: "http://192.168.1.10:" + (L.device_port || 7210), style: "max-width:320px" }),
        h("button", { type: "submit", disabled: S.srvBusy }, "Zapisz adres"),
        L.public_override && h("button", { type: "button", disabled: S.srvBusy, onclick: () => savePublicURL(null, "") }, "Wykrywaj sam"))),
    h("form", { class: "card", style: "margin-top:16px", onsubmit: moveOut },
      h("h3", { style: "margin-top:0" }, "Przenieś na mój serwer"),
      h("p", { class: "muted small", style: "margin-top:0" }, "Urządzenia, ustawienia czytników i wtyczki trafią na serwer. Czytniki przy następnej synchronizacji same dostaną nowy adres — nie trzeba ich łączyć od nowa. Ten komputer zostanie panelem serwera."),
      h("label", { class: "field" }, h("span", {}, "Adres serwera"),
        h("input", { type: "text", id: "f-mvserver", name: "server", placeholder: "koligilo.twojadomena.pl", required: true, value: L.server || "" })),
      h("label", { class: "field" }, h("span", {}, "Token administratora"),
        h("input", { type: "password", id: "f-mvtoken", name: "token", placeholder: "kol-…", autocomplete: "off", required: true })),
      h("button", { class: "primary", type: "submit", disabled: S.srvBusy }, S.srvBusy ? "Przenoszę…" : "Przenieś dane")),
  ];
}

function remoteCards() {
  return [
    h("section", { class: "card", style: "margin-top:16px" },
      h("h3", { style: "margin-top:0" }, "Przenieś dane na ten komputer"),
      h("p", { class: "muted small", style: "margin-top:0" }, "Urządzenia, ustawienia i wtyczki z serwera trafią tutaj, a serwer zacznie kierować czytniki pod adres tego komputera. Potem czytniki synchronizują się tylko, gdy ten komputer jest włączony i widoczny."),
      h("button", { class: "primary", disabled: S.srvBusy, onclick: moveHere }, S.srvBusy ? "Przenoszę…" : "Przenieś na ten komputer")),
    h("form", { class: "card", style: "margin-top:16px", onsubmit: saveServer },
      h("h3", { style: "margin-top:0" }, "Inny serwer"),
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
    S.srvMsg = { ok: false, text: "Podaj adres i token swojego serwera w formularzu „Przenieś na mój serwer” albo wybierz go w kreatorze." };
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

async function downloadExport() {
  try {
    const r = await fetch("/api/local/export", { headers: { [HDR]: "1" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const a = h("a", { href: URL.createObjectURL(await r.blob()), download: `koligilo-komputer-${new Date().toISOString().slice(0, 10)}.tar.gz` });
    document.body.append(a); a.click(); a.remove();
  } catch (e) { S.srvMsg = { ok: false, text: "Nie udało się pobrać kopii: " + e.message }; render(); }
}

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
    h("header", { class: "view-head", "data-drag": true }, h("h1", { id: "view-title" }, view[1])),
    st.pending.map(pairBanner),
    S.error && h("p", { class: "err" }, S.error),
    { urzadzenia: devicesTab, grupy: groupsTab, konta: accountsTab, wspolne: valuesTab,
      wtyczki: pluginsTab, jak: howTab, ustawienia: ustawieniaTab }[S.tab]());
}

function pairBanner(p) {
  return h("section", { class: "card pair", "aria-live": "polite" },
    h("div", { class: "code", "aria-label": "Kod parowania " + p.code.split("").join(" ") }, p.code),
    h("div", { class: "what" },
      h("h3", {}, `„${p.name || p.model}” chce dołączyć`),
      h("p", {}, [p.platform, p.ko_version && "KOReader " + p.ko_version].filter(Boolean).join(" · ")),
      h("p", { class: "muted small" }, "Porównaj kod z tym na ekranie czytnika. Jeśli jest inny albo nikt teraz niczego nie łączy — odrzuć."),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: () => decide(p.id, true) }, "Kody się zgadzają — połącz"),
        h("button", { onclick: () => decide(p.id, false) }, "Odrzuć"))));
}

async function decide(id, approve) {
  try { await api("POST", `/api/admin/pair/${id}`, { approve }); if (approve) showTab("grupy"); }
  catch (e) { S.error = e.message; }
  refresh();
}

// ------------------------------------------------ zakładka: urządzenia

function devicesTab() {
  const devs = S.state.devices;
  return h("section", {},
    explain(
      "Czytniki połączone z tym serwerem. Każdy po połączeniu z Wi-Fi sam wysyła swoje zmiany i odbiera zmiany z pozostałych.",
      "„Zapomnij” odcina urządzenie od synchronizacji — jego ustawienia zostają takie, jakie są."),
    devs.length ? h("div", { class: "devices", role: "list", "aria-label": "Urządzenia", style: "margin-bottom:16px" }, devs.map(deviceCard)) : null,
    codeCard(),
    S.mode === "desktop" && usbCard(),
    addDeviceCard(devs.length === 0));
}

function codeCard() {
  return h("section", { class: "card", style: "margin-bottom:16px" },
    h("h3", { style: "margin-top:0" }, "Dodaj czytnik kodem"),
    h("p", { class: "muted small", style: "margin-top:0" },
      "Na czytniku: Menu → Narzędzia → koligilo → Połącz z komputerem. Czytnik pokaże sześciocyfrowy kod — wpisz go tutaj. Działa z każdej sieci (także uczelnianej, hotelowej, przez VPN)."),
    h("p", { class: "muted small" },
      "Kod przechodzi przez punkt kontaktowy koligilo.sypian.ski — serwer autora koligilo. Na czas parowania (najwyżej 10 minut, tylko w pamięci) trafia tam model czytnika oraz adres tego komputera i klucz dla czytnika; po odebraniu przez czytnik są kasowane. Ustawień ani książek ten serwer nie widzi. W tej samej sieci Wi-Fi albo po kablu parowanie go nie używa."),
    h("form", { class: "row", onsubmit: ev => { ev.preventDefault(); rvLookup(); } },
      h("input", { type: "text", id: "f-rvcode", inputmode: "numeric", autocomplete: "off",
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

function usbCard() {
  const readers = S.usb?.readers || [];
  return h("section", { class: "card usb", style: "margin-bottom:16px" },
    h("h3", { style: "margin-top:0" }, "Podłączony kablem"),
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

function deviceCard(d) {
  const ls = d.last_sync;
  const sub = [[d.platform, d.model].filter(Boolean).join(" · ") || "?", "KOReader " + (d.ko_version || "?"),
    ls ? `wysłał ${ls.sent}, pobrał ${ls.received}` : `połączony ${ago(d.paired_at)}`].join(" · ");
  // wiersz jak pozycja spisu treści: nazwa … kropki … kiedy ostatnio synchronizował
  return h("div", { class: "drow", role: "listitem" },
    h("div", { class: "toc" },
      h("span", { class: "dname" }, d.name),
      h("span", { class: "dots", "aria-hidden": "true" }),
      h("span", { class: "when" + (ls ? "" : " never"), title: "Ostatnio widziany " + ago(d.last_seen) },
        ls ? ago(ls.at) : "jeszcze nie")),
    h("div", { class: "dsub" },
      h("span", { class: "dmeta" }, sub),
      h("span", { class: "dact" },
        h("button", { onclick: () => rename(d), "aria-label": "Zmień nazwę " + d.name }, "Zmień nazwę"),
        h("button", { class: "danger", onclick: () => forget(d), "aria-label": "Zapomnij " + d.name }, "Zapomnij"))));
}

function addDeviceCard(empty) {
  return h("section", { class: "card", style: "margin-top:16px" },
    h("h3", { style: "margin-top:0" }, empty ? "Połącz pierwszy czytnik" : "Dodaj kolejny czytnik"),
    h("ol", { class: "steps" },
      h("li", {}, "Zainstaluj na czytniku plugin: otwórz w przeglądarce czytnika ",
        h("code", {}, serverURL() + "/koligilo.koplugin.zip"),
        ", rozpakuj do ", h("code", {}, "koreader/plugins/"), " (na Androidzie: ", h("code", {}, "/sdcard/koreader/plugins/"), ") i uruchom KOReader ponownie."),
      h("li", {}, "Na czytniku: ", h("b", {}, "Menu → Narzędzia → koligilo → Połącz z komputerem…")),
      h("li", {}, "W tej samej sieci domowej czytnik sam znajdzie ten komputer — pojawi się tu prośba z czterocyfrowym kodem do porównania. W każdej innej sieci czytnik pokaże sześciocyfrowy kod — wpisz go w polu „Dodaj czytnik kodem” powyżej."),
      h("li", {}, "Na czytniku potwierdź pierwszą synchronizację. Gotowe.")));
}

function serverURL() {
  if (S.mode !== "desktop") return S.state?.public_url || location.origin;
  return S.local?.mode === "local" ? (S.local.public_url || "") : (S.local?.server || "");
}

async function rename(d) {
  const name = prompt("Nowa nazwa urządzenia (np. „Kobo w sypialni”):", d.name);
  if (!name || name === d.name) return;
  try { await api("POST", `/api/admin/devices/${d.id}/rename`, { name }); } catch (e) { S.error = e.message; }
  refresh();
}

async function forget(d) {
  if (!confirm(`Zapomnieć „${d.name}”?\n\nUrządzenie przestanie się synchronizować. Jego ustawienia zostaną takie, jakie są. Żeby je znowu połączyć, trzeba będzie sparować je od nowa.`)) return;
  try { await api("DELETE", `/api/admin/devices/${d.id}`); } catch (e) { S.error = e.message; }
  refresh();
}

// ------------------------------------------------ zakładka: grupy

function groupsTab() {
  const { catalog, devices, never } = S.state;
  return h("section", {},
    explain(
      "Wybierz, które rodzaje ustawień mają być wspólne — osobno dla każdego urządzenia. Włączona grupa działa w obie strony: urządzenie wysyła swoje zmiany i przyjmuje zmiany innych.",
      "Gdy włączasz grupę na urządzeniu, które już ma swoje wartości, przy najbliższej synchronizacji przyjmie wersję wspólną. Jeśli dwa urządzenia zmienią to samo ustawienie w międzyczasie, wygrywa zmiana, która pierwsza dotrze na serwer."),
    devices.length === 0
      ? h("p", { class: "muted" }, "Na razie nie ma połączonych urządzeń — tabela pokaże się po sparowaniu pierwszego czytnika.")
      : h("div", { class: "card matrix-wrap" }, groupMatrix(catalog, devices)),
    h("div", { class: "card never" },
      h("h3", {}, "Zostaje na każdym urządzeniu osobno"),
      h("p", { class: "muted small", style: "margin-top:0" }, "Tych ustawień koligilo nigdy nie przenosi — nawet gdyby ktoś próbował:"),
      h("ul", {}, never.map(n => h("li", {}, h("b", {}, n.name), " — ", n.reason)))));
}

function groupMatrix(catalog, devices) {
  const head = h("thead", {}, h("tr", {},
    h("th", {}, "Ustawienia"),
    devices.map(d => h("th", { scope: "col" }, d.name))));
  const body = h("tbody", {}, catalog.map(g => h("tr", {},
    groupLabel(g),
    devices.map(d => h("td", { class: "cell" }, groupSwitch(g, d))))));
  return h("table", { class: "matrix" }, head, body);
}

function groupLabel(g) {
  return h("th", { scope: "row", style: "text-align:left;font-weight:400" },
    h("div", { class: "gname" }, g.name,
      g.secret && h("span", { class: "badge key", title: "Zawiera hasła lub tokeny" }, "🔑 dane logowania")),
    h("div", { class: "gdesc" }, g.description),
    g.warning && h("div", { class: "gwarn" }, "⚠ ", g.warning));
}

function groupSwitch(g, d) {
  return h("label", { class: "switch", title: `${g.name} — ${d.name}` },
    h("input", {
      type: "checkbox", checked: d.groups[g.id],
      "aria-label": `${g.name} na ${d.name}`,
      onchange: ev => setGroup(d.id, g.id, ev.target.checked),
    }),
    h("span", {}));
}

async function setGroup(dev, group, on) {
  try { await api("POST", `/api/admin/devices/${dev}/groups`, { group, on }); }
  catch (e) { S.error = e.message; }
  refresh();
}

// ------------------------------------------------ zakładka: konta

const KEPT = "••••••  zapisane — zostaw puste, żeby nie zmieniać";

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

function accountsTab() {
  if (!S.acc) return h("p", { class: "loading" }, "Wczytuję konta…");
  return h("section", {},
    explain(
      "Konta wpisujesz tu raz, a czytniki odbierają je przy najbliższej synchronizacji — tak samo, jakby wpisano je na innym czytniku. Dostają je tylko urządzenia z włączoną odpowiednią grupą w zakładce „Co synchronizować”.",
      "Hasła i tokeny nigdy nie wracają do przeglądarki. Przy edycji puste pole hasła znaczy: bez zmian."),
    kosyncCard(), wallabagCard(), cloudCard(), targetsCard(), rosettaCard());
}

// Stan karty konta: z którego urządzenia (albo panelu) przyszła ostatnia
// zmiana dowolnej wartości grupy, i kiedy — z tych samych danych, które
// zakładka „Wspólne ustawienia” pokazuje per-wartość (S.state.values).
// Treść pozostaje ukryta (Preview zamaskowany po stronie serwera), widać
// tylko metadane, więc to nie łamie niezmiennika „sekrety nie do przeglądarki”.
function acctStatus(groupId) {
  const vs = (S.state.values || []).filter(v => v.group === groupId && !v.deleted);
  if (!vs.length) return null;
  const latest = vs.reduce((a, b) => (new Date(b.t) > new Date(a.t) ? b : a));
  return h("p", { class: "muted small" },
    `Skonfigurowane · z: ${latest.from || "urządzenia, które już usunięto"} · ${ago(latest.t)}`);
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

function kosyncCard() {
  const cur = S.acc.kosync;
  const extraKeys = ["auto_sync", "sync_forward", "sync_backward", "checksum_method"];
  // Braki (null z GET — nieskonfigurowane albo nieoczekiwany typ w stanie)
  // pokazujemy jako domyślne wartości KOReadera, ale _orig też je pamięta w
  // tej postaci, więc dopóki użytkownik nie tknie selecta, nic się nie wyśle.
  const extra = { auto_sync: cur?.auto_sync ?? false, sync_forward: cur?.sync_forward ?? 1,
    sync_backward: cur?.sync_backward ?? 3, checksum_method: cur?.checksum_method ?? 0 };
  const d = draft("kosync", () => ({ server: cur?.server || "", username: cur?.username || "", password: "",
    ...extra, _orig: extra }));
  return h("form", { class: "card acc", onsubmit: ev => { ev.preventDefault();
      accSave("kosync", "PUT", "/api/admin/accounts/kosync",
        { server: d.server, username: d.username, password: d.password, ...changedOnly(d, extraKeys) }); } },
    h("h3", {}, "Synchronizacja postępu czytania (kosync)"),
    h("p", { class: "muted small" }, "Dzięki temu każdy czytnik otworzy książkę na stronie, na której skończyłeś na innym. Konto zakładasz raz — np. w KOReaderze: Narzędzia → Synchronizacja postępu → Zarejestruj."),
    cur && acctStatus("konto_kosync"),
    field(d, "server", "Serwer", { form: "ks", placeholder: "puste = serwer KOReadera (sync.koreader.rocks)" }),
    field(d, "username", "Login", { form: "ks" }),
    field(d, "password", "Hasło", { form: "ks", type: "password", placeholder: cur?.has_password ? KEPT : "",
      hint: "Serwer zapisze tylko skrót hasła (md5) — tak jak KOReader." }),
    h("details", { class: "help" },
      h("summary", {}, "Więcej opcji"),
      checkboxField(d, "auto_sync", "Automatyczna synchronizacja postępu"),
      selectField(d, "sync_forward", "Przeskok do nowszej pozycji (na innym czytniku przeczytano dalej)", SYNC_STRATEGY_OPTS),
      selectField(d, "sync_backward", "Przeskok do starszej pozycji (na innym czytniku jest wcześniej)", SYNC_STRATEGY_OPTS),
      selectField(d, "checksum_method", "Metoda sumy kontrolnej", CHECKSUM_METHOD_OPTS)),
    h("div", { class: "row" },
      h("button", { class: "primary", type: "submit", disabled: S.accBusy === "kosync" }, "Zapisz"),
      cur && h("button", { type: "button", class: "danger", onclick: () => {
        if (confirm("Usunąć konto kosync ze wszystkich czytników?")) accSave("kosync", "DELETE", "/api/admin/accounts/kosync");
      } }, "Usuń z czytników")),
    accMsg("kosync"));
}

function wallabagCard() {
  const cur = S.acc.wallabag;
  const extraKeys = ["filter_tag", "ignore_tags", "auto_tags", "articles_per_sync",
    "is_delete_finished", "is_delete_read", "is_auto_delete", "send_review_as_tags"];
  const extra = { filter_tag: cur?.filter_tag ?? "", ignore_tags: cur?.ignore_tags ?? "",
    auto_tags: cur?.auto_tags ?? "", articles_per_sync: cur?.articles_per_sync ?? "",
    is_delete_finished: cur?.is_delete_finished ?? false, is_delete_read: cur?.is_delete_read ?? false,
    is_auto_delete: cur?.is_auto_delete ?? false, send_review_as_tags: cur?.send_review_as_tags ?? false };
  const d = draft("wallabag", () => ({ server_url: cur?.server_url || "", client_id: cur?.client_id || "",
    client_secret: "", username: cur?.username || "", password: "", ...extra, _orig: extra }));
  return h("form", { class: "card acc", onsubmit: ev => { ev.preventDefault();
      accSave("wallabag", "PUT", "/api/admin/accounts/wallabag",
        { server_url: d.server_url, client_id: d.client_id, client_secret: d.client_secret,
          username: d.username, password: d.password, ...changedOnly(d, extraKeys) }); } },
    h("h3", {}, "Wallabag"),
    h("p", { class: "muted small" }, "Client ID i secret założysz w Wallabagu: Zarządzanie klientami API → Utwórz nowego klienta. Folder pobierania artykułów zostaje osobny na każdym czytniku."),
    cur && acctStatus("konto_wallabag"),
    field(d, "server_url", "Serwer", { form: "wb", placeholder: "https://app.wallabag.it" }),
    h("div", { class: "grid2" },
      field(d, "client_id", "Client ID", { form: "wb" }),
      field(d, "client_secret", "Client secret", { form: "wb", type: "password", placeholder: cur?.has_client_secret ? KEPT : "" })),
    h("div", { class: "grid2" },
      field(d, "username", "Login", { form: "wb" }),
      field(d, "password", "Hasło", { form: "wb", type: "password", placeholder: cur?.has_password ? KEPT : "" })),
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
    h("div", { class: "row" },
      h("button", { class: "primary", type: "submit", disabled: S.accBusy === "wallabag" }, "Zapisz"),
      cur && h("button", { type: "button", class: "danger", onclick: () => {
        if (confirm("Usunąć konto Wallabag ze wszystkich czytników?")) accSave("wallabag", "DELETE", "/api/admin/accounts/wallabag");
      } }, "Usuń z czytników")),
    accMsg("wallabag"));
}

const CLOUD_TYPES = { dropbox: "Dropbox", webdav: "WebDAV", ftp: "FTP" };

function cloudCard() {
  const list = S.acc.cloud || [];
  const d = S.dr.cloud;
  return h("section", { class: "card acc" },
    h("h3", {}, "Konta w chmurze"),
    list.length > 0 && acctStatus("konta_chmura"),
    h("p", { class: "muted small" }, "To samo co Menu → Chmura w KOReaderze: miejsca, z których czytnik pobiera książki i w których statystyki oraz słowniczek trzymają wspólną bazę. Na czytnikach pojawią się pod tymi samymi nazwami."),
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

function cloudForm(d, cur) {
  const isNew = d.index < 0;
  return h("form", { class: "subform", onsubmit: ev => { ev.preventDefault();
      accSave("cloud", "POST", "/api/admin/accounts/cloud", d); } },
    h("h4", {}, isNew ? "Nowe konto" : `Edycja: ${cur?.name}`),
    isNew && h("div", { class: "row", role: "radiogroup", style: "margin-bottom:10px" },
      Object.entries(CLOUD_TYPES).map(([t, label]) => h("button", {
        type: "button", role: "radio", "aria-checked": String(d.type === t),
        class: d.type === t ? "primary" : "", onclick: () => { d.type = t; render(); },
      }, label))),
    field(d, "name", "Nazwa", { form: "cl", placeholder: d.type === "dropbox" ? "Dropbox" : "np. Koofr",
      hint: "Tak konto będzie się nazywać w menu Chmura na czytnikach." }),
    d.type === "dropbox" ? dropboxFields(d, cur) : [
      field(d, "address", "Adres", { form: "cl", placeholder: d.type === "webdav" ? "https://app.koofr.net/dav/Koofr" : "ftp://example.com" }),
      h("div", { class: "grid2" },
        field(d, "username", "Login", { form: "cl" }),
        field(d, "password", "Hasło", { form: "cl", type: "password", placeholder: cur?.has_password ? KEPT : "" })),
    ],
    field(d, "folder", "Folder startowy", { form: "cl", placeholder: "/", hint: "Gdzie czytnik otworzy to konto w menu Chmura." }),
    h("div", { class: "row" },
      h("button", { class: "primary", type: "submit", disabled: S.accBusy === "cloud" },
        S.accBusy === "cloud" ? "Zapisuję…" : "Zapisz konto"),
      h("button", { type: "button", onclick: () => { delete S.dr.cloud; S.accMsg.cloud = null; render(); } }, "Anuluj")));
}

function dropboxFields(d, cur) {
  const needToken = !cur || !cur.has_password || cur.broken;
  return [
    h("details", { class: "help", open: !cur || undefined },
      h("summary", {}, "Skąd wziąć App key i App secret?"),
      h("ol", {},
        h("li", {}, "Otwórz ", h("a", { href: "https://www.dropbox.com/developers/apps", target: "_blank", rel: "noopener" }, "dropbox.com/developers/apps"),
          " → Create app → Scoped access → App folder → dowolna nazwa (np. „koreader-twoje-imie”)."),
        h("li", {}, "W zakładce Permissions zaznacz files.metadata.read, files.content.read i files.content.write, potem Submit."),
        h("li", {}, "W zakładce Settings skopiuj App key i App secret tutaj."),
        h("li", {}, "Masz już aplikację dla KOReadera? Użyj tej samej — czytniki zobaczą te same pliki."))),
    h("div", { class: "grid2" },
      field(d, "app_key", "App key", { form: "cl" }),
      field(d, "app_secret", "App secret", { form: "cl", type: "password", placeholder: cur?.has_app_secret ? KEPT : "" })),
    h("div", { class: "field" },
      h("span", {}, needToken ? "Połącz z Dropboxem" : "Połączenie z Dropboxem"),
      !needToken && h("small", { style: "display:block;margin-bottom:6px" }, "Konto jest połączone. Połącz ponownie tylko, jeśli czytniki zgłaszają błąd logowania."),
      h("div", { class: "row" },
        h("button", { type: "button", disabled: !d.app_key.trim(), onclick: () => window.open(dropboxAuthURL(d.app_key), "_blank", "noopener") },
          "1. Otwórz Dropbox i kliknij „Zezwól”"),
        h("input", { id: "f-cl-code", type: "text", value: d.code, placeholder: "2. wklej kod z Dropboxa", autocomplete: "off",
          style: "flex:1;min-width:200px", oninput: ev => { d.code = ev.target.value; } })),
      h("small", {}, "Kod działa raz i tylko kilka minut — zapisz konto zaraz po wklejeniu. ",
        h("a", { href: "#", onclick: ev => { ev.preventDefault(); d.manual = !d.manual; render(); } },
          d.manual ? "Ukryj pole refresh tokenu" : "Mam już refresh token"))),
    d.manual && field(d, "refresh_token", "Refresh token", { form: "cl", type: "password" }),
  ];
}

const TARGETS = [
  ["statystyki", "Statystyki czytania", "Wspólna baza statystyk (czas czytania, strony, kalendarz)."],
  ["slowniczek", "Słowniczek (vocabulary builder)", "Wspólna lista słówek do powtórek."],
];

function targetsCard() {
  const list = S.acc.cloud || [];
  return h("section", { class: "card acc" },
    h("h3", {}, "Synchronizacja statystyk i słowniczka"),
    h("p", { class: "muted small" }, "KOReader sam scala te bazy przez konto w chmurze — koligilo tylko ustawia, którego konta i folderu używają. Wszystkie czytniki muszą wskazywać ten sam folder."),
    list.length === 0 && h("p", { class: "muted" }, "Najpierw dodaj konto w chmurze (powyżej)."),
    TARGETS.map(([which, label, desc]) => {
      const cur = S.acc.targets?.[which];
      const d = draft("t-" + which, () => ({ account: cur && cur.account >= 0 ? cur.account : 0, folder: cur?.folder || "" }));
      return h("form", { class: "target", onsubmit: ev => { ev.preventDefault();
          accSave("t-" + which, "PUT", `/api/admin/accounts/target/${which}`, { account: Number(d.account), folder: d.folder }); } },
        h("div", { class: "what" }, h("b", {}, label), h("div", { class: "muted small" }, desc,
          cur ? ` Teraz: ${cur.name} (${CLOUD_TYPES[cur.type] || cur.type}), folder ${cur.folder || "/"}${cur.account < 0 ? " — konto spoza listy" : ""}.` : " Teraz: wyłączone."),
          cur?.broken && h("div", { class: "err small" }, "⚠ Zapisany jest krótkotrwały token — wybierz konto ponownie i zapisz.")),
        list.length > 0 && h("div", { class: "row" },
          h("select", { "aria-label": "Konto dla: " + label, onchange: ev => { d.account = ev.target.value; } },
            list.map((c, i) => h("option", { value: i, selected: Number(d.account) === i || undefined }, `${c.name} (${CLOUD_TYPES[c.type] || c.type})`))),
          h("input", { id: `f-t-${which}`, type: "text", value: d.folder, placeholder: "folder, np. /koreader", style: "max-width:200px",
            oninput: ev => { d.folder = ev.target.value; } }),
          h("button", { class: "primary", type: "submit", disabled: S.accBusy === "t-" + which }, "Zapisz"),
          cur && h("button", { type: "button", onclick: () => accSave("t-" + which, "DELETE", `/api/admin/accounts/target/${which}`) }, "Wyłącz")),
        accMsg("t-" + which));
    }));
}

function rosettaCard() {
  const cur = S.acc.rosetta;
  const extraKeys = ["ai_base_url", "ai_model", "ai_max_tokens", "ai_temperature"];
  const extra = { ai_base_url: cur?.ai_base_url ?? "", ai_model: cur?.ai_model ?? "",
    ai_max_tokens: cur?.ai_max_tokens ?? "", ai_temperature: cur?.ai_temperature ?? "" };
  const d = draft("rosetta", () => ({ ...extra, _orig: extra, api_key: "" }));
  return h("form", { class: "card acc", onsubmit: ev => { ev.preventDefault();
      accSave("rosetta", "PUT", "/api/admin/accounts/rosetta", { ...changedOnly(d, extraKeys), api_key: d.api_key }); } },
    h("h3", {}, "Rosetta — klucze API"),
    h("p", { class: "muted small" }, "Dostęp do backendu AI używanego przez wtyczkę Rosetta (tłumaczenie na żywo). Klucz to sekret — włączaj tę grupę tylko między urządzeniami, którym ufasz."),
    cur && acctStatus("rosetta_klucze"),
    field(d, "ai_base_url", "Adres API", { form: "ro", placeholder: "https://api.example.com/v1" }),
    field(d, "ai_model", "Model", { form: "ro" }),
    h("div", { class: "grid2" },
      field(d, "ai_max_tokens", "Limit tokenów", { form: "ro" }),
      field(d, "ai_temperature", "Temperatura", { form: "ro" })),
    field(d, "api_key", "Klucz API", { form: "ro", type: "password", placeholder: cur?.has_api_key ? KEPT : "" }),
    h("div", { class: "row" },
      h("button", { class: "primary", type: "submit", disabled: S.accBusy === "rosetta" }, "Zapisz"),
      cur && h("button", { type: "button", class: "danger", onclick: () => {
        if (confirm("Usunąć klucze API Rosetty ze wszystkich czytników?")) accSave("rosetta", "DELETE", "/api/admin/accounts/rosetta");
      } }, "Usuń z czytników")),
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

// Pełne literały dla znanych kluczy, których podgląd jest przycięty (np. stopka).
async function valLoadFull() {
  if (typeof KO === "undefined") return;
  const known = new Set(KO.opts.map(o => idFor(o.file, o.key)).filter(Boolean));
  for (const v of S.state.values) {
    if (v.deleted || !known.has(v.id) || !clipped(v) || S.valFull[v.id]?.t === v.t) continue;
    try { S.valFull[v.id] = { t: v.t, lit: (await api("GET", "/api/admin/values/" + encodeURIComponent(v.id))).value }; }
    catch { /* zostaje „wczytuję” — spróbujemy przy następnym odświeżeniu */ }
  }
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
    S.valMsg[id] = { ok: true, text: "Zapisane — czytniki dostaną to przy najbliższej synchronizacji." };
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

function pvOpen(id) {
  if (typeof Preview === "undefined" || typeof KO === "undefined" || !S.state) return;
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
  return h("div", { class: "tweaks" },
    [...cats].map(([cat, list]) => {
      const n = list.filter(t => on.get(t.id) === true).length;
      const ok = "tw:" + cat;
      return h("details", { open: !!S.valOpen[ok] || null, ontoggle: ev => { S.valOpen[ok] = ev.target.open; } },
        h("summary", {}, cat, n > 0 && h("span", { class: "cnt" }, String(n))),
        list.map(t => item(t.id, t.title, t.desc, t.cat.includes(" › ") ? t.cat.split(" › ").slice(1).join(" › ") : null)));
    }),
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

function settingRow(o, id, v, secLabel) {
  const cv = currentValue(v);
  // jedna tabela na sekcję (stopka, poprawki) — bez powtórzonej nazwy
  const wide = (o.kind === "flags" || o.kind === "tweaks") && o.label === secLabel;
  const def = o.default !== undefined ? fmtValue(o, o.default) : null;
  return h("div", { class: "srow" + (S.valSel === id ? " sel" : "") + (cv.state === "absent" ? " absent" : "") + (wide ? " wide" : ""),
      "data-id": id, "aria-label": wide ? o.label : null, onfocusin: () => valSelect(id), onclick: () => valSelect(id) },
    !wide && h("div", { class: "sl" },
      h("div", { class: "sname" }, o.label),
      helpText(o, id)),
    h("div", { class: "sc" },
      control(o, id, cv),
      h("div", { class: "meta" },
        cv.state === "absent"
          ? (def != null ? `nie ustawiono · KOReader domyślnie: ${def}` : "nie ustawiono")
          : `z: ${v.from || "urządzenia, które już usunięto"} · ${ago(v.t)}`,
        cv.state !== "absent" && h("button", { type: "button", class: "linkish", disabled: S.valBusy === id,
          onclick: ev => { ev.stopPropagation(); ctlReset(id, o.label); } }, "usuń")),
      valMsgFor(id)));
}

function valuesTab() {
  // Grupy Secret (konta/poświadczenia) żyją wyłącznie w zakładce „Konta” (TASK-21 AC1).
  const catalog = S.state.catalog.filter(g => !g.secret);
  const secretGroups = new Set(S.state.catalog.filter(g => g.secret).map(g => g.id));
  const values = S.state.values.filter(v => !secretGroups.has(v.group));
  const byId = new Map(values.map(v => [v.id, v]));
  const hasKO = typeof KO !== "undefined";
  const mapped = new Set();
  const sections = hasKO ? KO.sections.map(sec => {
    const rows = KO.opts.filter(o => o.section === sec.id).map(o => {
      const id = idFor(o.file, o.key);
      if (!id) return null;
      mapped.add(id);
      return settingRow(o, id, byId.get(id), sec.label);
    }).filter(Boolean);
    return rows.length && h("section", { class: "card sgroup", "aria-label": sec.label }, h("h3", {}, sec.label), rows);
  }).filter(Boolean) : [];
  const unmapped = values.filter(v => !v.deleted && !mapped.has(v.id)).length;
  return h("section", {},
    explain(
      "Aktualna wspólna wersja ustawień — to, co dostanie urządzenie przy następnej synchronizacji (w grupach, które ma włączone). Nazwy, opisy i przyciski są takie jak w KOReaderze; zmiana tutaj działa tak, jakby zrobiono ją na innym czytniku.",
      "„Nie ustawiono” znaczy, że czytniki zostawiają własne ustawienie (albo domyślne KOReadera). Wszystko, czego ta mapa nie zna, jest w „Zaawansowane” jako surowe wartości."),
    sections,
    h("details", { class: "card adv", open: S.valAdv || null, ontoggle: ev => { S.valAdv = ev.target.open; } },
      h("summary", {}, "Zaawansowane — surowe wartości (literały Lua)",
        unmapped > 0 && h("span", { class: "cnt", title: "wartości spoza mapy KOReadera" }, String(unmapped))),
      h("p", { class: "muted small" }, "Wszystkie wspólne wartości z identyfikatorami plików i kluczy — także te, których nie ma w mapie nazw KOReadera."),
      advancedValues(catalog, values)),
    hasKO && h("p", { class: "muted small kover" },
      `Nazwy i opisy: KOReader ${KO.version}, tłumaczenie polskie (koreader-translations ${KO.l10n.slice(0, 7)}).`));
}

// ------------------------------------------------ zakładka: jak to działa

function howTab() {
  return h("section", { class: "card prose" },
    h("h3", { style: "margin-top:0" }, "Po co to jest"),
    h("p", {}, "KOReader ma kilka osobnych mechanizmów synchronizacji — postęp czytania (kosync), statystyki, Wallabag — ale każdy trzeba skonfigurować na każdym urządzeniu osobno, wpisując adresy i hasła. A gesty, stopka czy słowniki w ogóle się nie przenoszą. koligilo robi to za Ciebie."),
    h("h3", {}, "Jak przebiega synchronizacja"),
    h("ol", {},
      h("li", {}, "Czytnik łączy się z Wi-Fi (albo klikasz „Synchronizuj teraz”)."),
      h("li", {}, "Porównuje swoje ustawienia ze stanem z ostatniej synchronizacji: co zmieniło się tutaj, wysyła; co zmieniło się gdzie indziej, pobiera."),
      h("li", {}, "Jeśli coś pobrał, prosi o ponowne uruchomienie KOReadera — dopiero wtedy wszystkie moduły widzą nowe ustawienia.")),
    h("h3", {}, "Co z postępem czytania i książkami?"),
    h("p", {}, "Postęp czytania i statystyki nadal synchronizują wbudowane mechanizmy KOReadera — koligilo tylko rozwozi ich konfigurację (adres serwera, login), więc nowe urządzenie działa od razu. Same książki przenosi osobne narzędzie (Libraro, Syncthing) — koligilo ich nie dotyka."),
    h("h3", {}, "Bezpieczeństwo"),
    h("ul", {},
      h("li", {}, "Każde urządzenie dostaje przy parowaniu własny klucz; „Zapomnij” natychmiast go unieważnia."),
      h("li", {}, "Czterocyfrowy kod chroni przed tym, by ktoś w tej samej sieci podpiął obce urządzenie — zatwierdzasz tylko prośbę z kodem widocznym na Twoim czytniku."),
      h("li", {}, "Parowanie sześciocyfrowym kodem (z innej sieci) idzie przez punkt kontaktowy koligilo.sypian.ski, czyli serwer autora. Przez najwyżej 10 minut trzyma on w pamięci model czytnika, adres Twojego serwera i klucz dla czytnika, a po odebraniu je kasuje. Ustawień, kont ani książek nie widzi. Zamiast niego można użyć własnego serwera koligilo: na komputerze `koligilo --rendezvous ADRES`, na czytniku klucz `rendezvous` w settings/koligilo.lua."),
      h("li", {}, "Czytnik nie wykonuje niczego, co przyjdzie z serwera: ustawienia przesyłane są jako czyste dane i odczytywane ścisłym parserem."),
      h("li", {}, "Hasła (Wallabag, kosync) leżą na Twoim serwerze. W trybie Dropbox/WebDAV będą szyfrowane przed wysłaniem.")),
    h("h3", {}, "Gdy coś pójdzie nie tak"),
    h("p", {}, "Jeśli czytnik zauważy, że naraz zniknęła ponad połowa synchronizowanych ustawień (np. uszkodzony plik), wstrzymuje synchronizację i nic nie wysyła. Nieczytelne pliki ustawień są pomijane, a nie traktowane jak puste."));
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

// TASK-19: "Wtyczki" i dawna "Galeria wtyczek" żyją teraz pod jedną pozycją
// nawigacji, jako trzy zakładki wewnętrzne (role=tablist/tab/tabpanel,
// sterowanie strzałkami/Home/End — pluginTablist()). Wybór zapamiętany w tej
// przeglądarce (S.pluginTab, localStorage). Panel tylko przypisuje/odpina
// stan docelowy — instalację i tak zawsze potwierdza czytnik (PC-004).

const PLUGIN_TABS = [["urzadzenia", "Wg urządzeń"], ["wtyczki", "Wg wtyczek"], ["galeria", "Galeria"]];

function showPluginTab(id) {
  const changed = S.pluginTab !== id;
  S.pluginTab = id;
  pluginTabSet(id);
  if (changed) app.scrollTop = 0;
  return refresh();
}

function pluginTablist() {
  const cur = S.pluginTab;
  return h("div", { class: "tabs", role: "tablist", "aria-label": "Widok wtyczek" },
    PLUGIN_TABS.map(([id, label], i) => h("button", {
      type: "button", role: "tab", id: "ptab-" + id, "aria-selected": String(cur === id),
      "aria-controls": "ptabpanel-" + id, tabindex: cur === id ? "0" : "-1",
      class: "tab" + (cur === id ? " selected" : ""),
      onclick: () => showPluginTab(id),
      onkeydown: ev => {
        const d = { ArrowRight: 1, ArrowLeft: -1 }[ev.key];
        const home = ev.key === "Home", end = ev.key === "End";
        if (d == null && !home && !end) return;
        ev.preventDefault();
        const ni = home ? 0 : end ? PLUGIN_TABS.length - 1 : (i + d + PLUGIN_TABS.length) % PLUGIN_TABS.length;
        const nid = PLUGIN_TABS[ni][0];
        Promise.resolve(showPluginTab(nid)).then(() => document.getElementById("ptab-" + nid)?.focus());
      },
    }, label)));
}

function pluginsTab() {
  const sub = S.pluginTab === "galeria" ? "galeria" : S.pluginTab === "urzadzenia" ? "urzadzenia" : "wtyczki";
  return h("section", {},
    explain(
      "Wtyczka KOReadera to kod Lua z pełnymi uprawnieniami na czytniku — koligilo nigdy nie instaluje jej samo: tylko przypisuje wersję jako „stan docelowy”. Instalację, aktualizację i usunięcie zawsze potwierdza człowiek na czytniku (Menu → Narzędzia → koligilo).",
      "Zgodę na instalowanie wtyczek („Pozwól instalować wtyczki”) włącza się wyłącznie na czytniku — panel nie może jej tu ustawić."),
    pluginTablist(),
    h("div", { id: "ptabpanel-" + sub, role: "tabpanel", "aria-labelledby": "ptab-" + sub, tabindex: "0", class: "tabpanel" },
      sub === "galeria" ? galleryTab()
        : !S.plugins ? h("p", { class: "loading" }, "Wczytuję wtyczki…")
        : sub === "urzadzenia" ? byDevicePanel() : byPluginPanel()));
}

function byDevicePanel() {
  return h("div", {},
    S.state.devices.length === 0
      ? h("p", { class: "muted" }, "Brak połączonych urządzeń — dodaj czytnik w zakładce „Urządzenia”.")
      : S.state.devices.map(devicePluginCard));
}

// --- zakładka: wg wtyczek (TASK-19) ---
//
// Ten sam magazyn i te same urządzenia co „Wg urządzeń”, tylko odwrócone:
// wiersz to wtyczka (katalog *.koplugin), nie urządzenie. Magazyn i wgrywanie
// ZIP-a mieszkają tutaj (były w dawnej zakładce „Wtyczki”). Ulubione
// (TASK-20) trzymają się na górze listy i mają filtr „Tylko ulubione”.

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
  return h("button", {
    type: "button", class: "star" + (on ? " on" : ""), "aria-pressed": String(on), disabled: S.favBusy === key,
    "aria-label": (on ? "Usuń z ulubionych: " : "Dodaj do ulubionych: ") + key.replace(/^(gh:|dir:)/, ""),
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
  S.galQ = full; S.galPage = 1;
  showPluginTab("galeria");
}

function byPluginPanel() {
  const versions = S.plugins || [];
  const dirs = [...new Set(versions.map(v => v.dir))];
  let sorted = dirs.slice().sort((a, b) => {
    const va = versions.filter(v => v.dir === a), vb = versions.filter(v => v.dir === b);
    const fa = dirIsFavorite(a, va), fb = dirIsFavorite(b, vb);
    return (fb - fa) || a.localeCompare(b);
  });
  if (S.favOnly) sorted = sorted.filter(dir => dirIsFavorite(dir, versions.filter(v => v.dir === dir)));
  const extraFav = favoriteReposNotInstalled(versions);
  return h("div", {},
    h("div", { class: "row", style: "margin:0 0 14px" },
      h("button", {
        type: "button", class: "chip" + (S.favOnly ? " on" : ""), "aria-pressed": String(!!S.favOnly),
        onclick: () => { S.favOnly = !S.favOnly; render(); },
      }, "★ Tylko ulubione")),
    uploadCard(),
    updatesCard(),
    storeCard(),
    !S.favOnly && extraFav.length > 0 && h("section", { class: "card", style: "margin-bottom:16px" },
      h("h3", { style: "margin-top:0" }, "Ulubione z galerii (jeszcze niezainstalowane)"),
      h("p", { class: "muted small", style: "margin-top:0" }, "Gwiazdka nie instaluje wtyczki — to tylko zakładka."),
      extraFav.map(full => h("div", { class: "row", style: "justify-content:space-between;align-items:center;padding:6px 0;border-top:1px solid var(--line)" },
        h("div", { style: "display:flex;align-items:center;gap:8px" }, favStar("gh:" + full), full),
        h("button", { type: "button", onclick: () => openGalleryFor(full) }, "Otwórz w Galerii")))),
    sorted.length === 0
      ? h("p", { class: "muted" }, S.favOnly ? "Brak ulubionych wtyczek w magazynie." : "Magazyn jest pusty — wgraj ZIP albo dodaj wtyczkę z zakładki „Galeria”.")
      : sorted.map(dir => pluginDirCard(dir, versions.filter(v => v.dir === dir))));
}

function pluginDirCard(dir, versions) {
  const approved = versions.filter(v => v.approved);
  const invMap = d => new Map((d.plugin_inventory || []).map(p => [p.dir, p]));
  const resMap = d => new Map((d.plugin_results || []).map(r => [r.dir, r]));
  const withDir = S.state.devices.filter(d => (d.plugins || {})[dir] || invMap(d).has(dir));
  const without = S.state.devices.filter(d => !withDir.includes(d));
  const repo = dirGalleryRepos(versions)[0];
  return h("article", { class: "card", style: "margin-bottom:14px" },
    h("h3", { style: "margin:0 0 4px;display:flex;align-items:center;gap:8px" }, favStar("dir:" + dir), dir),
    repo && h("p", { class: "muted small", style: "margin:0 0 8px" },
      "Z galerii: ", h("a", { href: "https://github.com/" + repo, target: "_blank", rel: "noopener" }, repo, " ↗"),
      " ", favStar("gh:" + repo)),
    withDir.length === 0
      ? h("p", { class: "muted small" }, "Nie przypisana ani zainstalowana na żadnym urządzeniu.")
      : h("div", { class: "matrix-wrap" }, h("table", { class: "matrix plugins" },
          h("thead", {}, h("tr", {},
            h("th", {}, "Urządzenie"), h("th", {}, "Zainstalowana"), h("th", {}, "Docelowa"),
            h("th", {}, "Stan"), h("th", {}, "Zarządzana"), h("th", {}, "Akcje"))),
          h("tbody", {}, withDir.map(d => pluginDeviceRow(d, dir, invMap(d).get(dir), resMap(d).get(dir)))))),
    without.length > 0 && approved.length > 0 && assignToDeviceForm(dir, approved, without));
}

// pluginDeviceRow: jak pluginRow (devicePluginCard), ale pierwsza kolumna to
// nazwa urządzenia, nie katalog wtyczki — tabela jest już wewnątrz karty
// jednej wtyczki, więc kolumna z jej nazwą byłaby powtórzeniem.
function pluginDeviceRow(d, dir, inv, lastResult) {
  const targetSha = (d.plugins || {})[dir];
  const targetV = targetSha ? pluginByHash(targetSha) : null;
  const status = pluginStatus(d, targetSha, inv, lastResult);
  const managed = inv ? (inv.managed ? "tak" : "nie") : (targetSha ? "(po instalacji)" : "—");
  const canRemove = !!targetSha && (!inv || inv.managed);
  return h("tr", {},
    h("td", {}, d.name),
    h("td", {}, inv ? (inv.version || "?") : "—"),
    h("td", {}, targetV ? (targetV.version || targetSha.slice(0, 12)) : "—"),
    h("td", { class: status.cls }, status.text),
    h("td", {}, managed),
    h("td", {}, !targetSha ? null
      : canRemove
        ? h("button", { class: "danger", disabled: S.devPluginBusy === d.id, onclick: () => removeDevicePlugin(d, dir) }, "Usuń")
        : h("button", { disabled: true, title: "Zainstalowana ręcznie na czytniku — nie da się usunąć z panelu" }, "Usuń")));
}

function assignToDeviceForm(dir, approved, devices) {
  const dkey = "byplug:" + dir;
  const draft = S.devPluginDraft[dkey] || (S.devPluginDraft[dkey] = { sha: approved[0].sha256, dev: devices[0].id });
  if (!approved.some(v => v.sha256 === draft.sha)) draft.sha = approved[0].sha256;
  if (!devices.some(d => d.id === draft.dev)) draft.dev = devices[0].id;
  const msg = S.devPluginMsg[draft.dev];
  return h("div", { class: "row", style: "margin-top:12px;padding-top:10px;border-top:1px dashed var(--line)" },
    h("select", { "aria-label": "Wybierz urządzenie do przypisania " + dir, onchange: ev => { draft.dev = ev.target.value; } },
      devices.map(d => h("option", { value: d.id, selected: draft.dev === d.id }, d.name))),
    h("select", { "aria-label": "Wybierz wersję " + dir, onchange: ev => { draft.sha = ev.target.value; } },
      approved.map(v => h("option", { value: v.sha256, selected: draft.sha === v.sha256 }, `${v.version || v.sha256.slice(0, 12)} (${v.source})`))),
    h("button", { class: "primary", disabled: S.devPluginBusy === draft.dev, onclick: () => assignPluginToDevice(dir, draft) },
      S.devPluginBusy === draft.dev ? "Przypisuję…" : "Przypisz do urządzenia"),
    msg && h("span", { class: (msg.ok ? "ok" : "err") + " small" }, msg.text));
}

async function assignPluginToDevice(dir, draft) {
  const d = S.state.devices.find(x => x.id === draft.dev);
  if (!d) return;
  await saveDevicePlugins(d, { ...(d.plugins || {}), [dir]: draft.sha });
}

// storeCard: pełna lista wersji w magazynie (TASK-12, dodatek do TASK-13) —
// wersje wysłane z czytnika (source == "urządzenie") czekają na akceptację
// admina, zanim będzie można je przypisać innym urządzeniom (addPluginForm
// już je filtruje — patrz opts poniżej).
function storeCard() {
  const versions = S.plugins || [];
  if (versions.length === 0) return null;
  return h("section", { class: "card", style: "margin-bottom:16px" },
    h("h3", { style: "margin-top:0" }, "Wersje w magazynie"),
    h("div", { class: "matrix-wrap" }, h("table", { class: "matrix plugins" },
      h("thead", {}, h("tr", {},
        h("th", {}, "Wtyczka"), h("th", {}, "Wersja"), h("th", {}, "Źródło"),
        h("th", {}, "Pochodzenie"), h("th", {}, "Stan"), h("th", {}, "Akcje"))),
      h("tbody", {}, versions.map(storeRow)))));
}

function storeRow(v) {
  const pending = v.source === "urządzenie" && !v.approved;
  return h("tr", {},
    h("td", {}, v.dir),
    h("td", {}, v.version || v.sha256.slice(0, 12)),
    h("td", {}, v.source),
    h("td", { class: "muted small" }, v.source_ref || "—"),
    h("td", {}, pending
      ? h("span", { class: "badge warn" }, "czeka na akceptację")
      : h("span", { class: "ok" }, "zaakceptowana")),
    h("td", {}, pending
      ? h("button", { class: "primary", disabled: S.approveBusy === v.sha256, onclick: () => approvePlugin(v) },
          S.approveBusy === v.sha256 ? "Akceptuję…" : "Zaakceptuj")
      : null));
}

async function approvePlugin(v) {
  if (!confirm(
    `Zaakceptować „${v.dir}” (${v.version || v.sha256.slice(0, 12)}) przysłaną z czytnika (${v.source_ref})?\n\n` +
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

// ------------------------------------------------ zakładka: wtyczki — aktualizacje z galerii (TASK-12)

function updatesCard() {
  const g = S.galUpdates;
  return h("section", { class: "card", style: "margin-bottom:16px" },
    h("div", { class: "row", style: "justify-content:space-between;align-items:center" },
      h("h3", { style: "margin:0" }, "Dostępne aktualizacje"),
      h("button", { disabled: S.galUpdatesBusy, onclick: checkGalleryUpdates }, S.galUpdatesBusy ? "Sprawdzam…" : "Sprawdź teraz")),
    !g
      ? h("p", { class: "muted small" }, "Nie sprawdzano jeszcze aktualizacji w tej sesji.")
      : updatesBody(g));
}

function updatesBody(g) {
  const avail = (g.updates || []).filter(u => u.update_available);
  return h("div", {},
    g.note && h("p", { class: "muted small" }, g.note),
    g.updated_at && !g.updated_at.startsWith("0001") && h("p", { class: "muted small" }, "Ostatnio sprawdzono: ", ago(g.updated_at)),
    avail.length === 0
      ? h("p", { class: "muted small" }, "Wszystkie wtyczki z galerii są aktualne.")
      : avail.map(updateRow));
}

function updateRow(u) {
  const key = u.repo;
  const busy = S.galUpdateBusy === key;
  const msg = S.galUpdateMsg[key];
  return h("article", { class: "card", style: "margin-bottom:10px" },
    h("h4", { style: "margin:0 0 4px" }, u.dir || u.repo,
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

function uploadCard() {
  return h("section", { class: "card", style: "margin-bottom:16px" },
    h("h3", { style: "margin-top:0" }, "Wgraj własny ZIP"),
    h("p", { class: "muted small", style: "margin-top:0" },
      "ZIP musi zawierać jeden katalog *.koplugin z plikami _meta.lua i main.lua — tak samo jak wtyczka z galerii (do 20 MB)."),
    h("div", { class: "row" },
      h("input", { type: "file", id: "f-plugin-zip", accept: ".zip" }),
      h("button", { class: "primary", disabled: S.uploadBusy, onclick: uploadPlugin }, S.uploadBusy ? "Wgrywam…" : "Wgraj")),
    S.uploadMsg && h("p", { class: S.uploadMsg.ok ? "ok" : "err" }, S.uploadMsg.text));
}

async function uploadPlugin() {
  const inp = document.getElementById("f-plugin-zip");
  const file = inp && inp.files && inp.files[0];
  if (!file) { S.uploadMsg = { ok: false, text: "Wybierz plik ZIP." }; return render(); }
  S.uploadBusy = true; S.uploadMsg = null; render();
  try {
    const fd = new FormData();
    fd.append("file", file);
    const out = await apiUpload("/api/admin/plugins", fd);
    S.uploadMsg = { ok: true, text: `Wgrano „${out.plugin.dir}” (${out.plugin.version || out.plugin.sha256.slice(0, 12)}). Przypisz ją niżej do urządzenia.` };
  } catch (e) {
    S.uploadMsg = { ok: false, text: e.message };
  }
  S.uploadBusy = false;
  refresh();
}

function pluginStatus(d, targetSha, inv, lastResult) {
  if (lastResult && lastResult.status === "error") return { text: "błąd: " + (lastResult.error || "?"), cls: "err small" };
  if (lastResult && lastResult.status === "rejected") return { text: "odrzucona na czytniku", cls: "warn" };
  if (targetSha && !d.plugins_allowed) return { text: "oczekuje na zgodę na czytniku", cls: "warn" };
  if (targetSha && inv && inv.sha256 === targetSha) return { text: "zainstalowana", cls: "ok" };
  if (targetSha && inv && inv.sha256 && inv.sha256 !== targetSha) return { text: "czeka na aktualizację", cls: "warn" };
  if (targetSha && !inv) return { text: "czeka na instalację", cls: "warn" };
  if (!targetSha && inv) return { text: "zainstalowana ręcznie / poza koligilo", cls: "" };
  return { text: "—", cls: "" };
}

function devicePluginCard(d) {
  const inv = new Map((d.plugin_inventory || []).map(p => [p.dir, p]));
  const results = new Map((d.plugin_results || []).map(r => [r.dir, r]));
  const dirs = new Set([...Object.keys(d.plugins || {}), ...inv.keys()]);
  return h("article", { class: "card device", style: "margin-bottom:14px" },
    h("h3", { style: "margin:0 0 4px" }, d.name,
      !d.plugins_allowed && h("span", { class: "badge warn",
        title: "Włącz na czytniku: menu koligilo → Pozwól instalować wtyczki" }, "brak zgody na czytniku")),
    d.plugin_report_at && h("p", { class: "muted small", style: "margin:0 0 10px" }, "Ostatni raport z czytnika: ", ago(d.plugin_report_at)),
    dirs.size === 0
      ? h("p", { class: "muted small" }, "Brak wtyczek — ani przypisanych, ani zgłoszonych przez czytnik.")
      : h("div", { class: "matrix-wrap" }, h("table", { class: "matrix plugins" },
          h("thead", {}, h("tr", {},
            h("th", {}, "Wtyczka"), h("th", {}, "Zainstalowana"), h("th", {}, "Docelowa"),
            h("th", {}, "Stan"), h("th", {}, "Zarządzana"), h("th", {}, "Akcje"))),
          h("tbody", {}, [...dirs].sort().map(dir => pluginRow(d, dir, inv.get(dir), results.get(dir)))))),
    addPluginForm(d));
}

function pluginRow(d, dir, inv, lastResult) {
  const targetSha = (d.plugins || {})[dir];
  const targetV = targetSha ? pluginByHash(targetSha) : null;
  const status = pluginStatus(d, targetSha, inv, lastResult);
  const managed = inv ? (inv.managed ? "tak" : "nie") : (targetSha ? "(po instalacji)" : "—");
  const canRemove = !!targetSha && (!inv || inv.managed);
  return h("tr", {},
    h("td", {}, dir),
    h("td", {}, inv ? (inv.version || "?") : "—"),
    h("td", {}, targetV ? (targetV.version || targetSha.slice(0, 12)) : "—"),
    h("td", { class: status.cls }, status.text),
    h("td", {}, managed),
    h("td", {}, !targetSha ? null
      : canRemove
        ? h("button", { class: "danger", disabled: S.devPluginBusy === d.id, onclick: () => removeDevicePlugin(d, dir) }, "Usuń")
        : h("button", { disabled: true, title: "Zainstalowana ręcznie na czytniku — nie da się usunąć z panelu" }, "Usuń")));
}

function addPluginForm(d) {
  const opts = (S.plugins || []).filter(v => v.approved);
  if (opts.length === 0) return h("p", { class: "muted small", style: "margin-top:10px" }, "Magazyn jest pusty — wgraj ZIP albo dodaj wtyczkę z galerii.");
  const key = d.id;
  const draft = S.devPluginDraft[key] || (S.devPluginDraft[key] = { sha: opts[0].sha256 });
  if (!opts.some(v => v.sha256 === draft.sha)) draft.sha = opts[0].sha256;
  return h("div", { class: "row", style: "margin-top:12px;padding-top:10px;border-top:1px dashed var(--line)" },
    h("select", { "aria-label": "Wybierz wtyczkę do dodania na " + d.name, onchange: ev => { draft.sha = ev.target.value; } },
      opts.map(v => h("option", { value: v.sha256, selected: draft.sha === v.sha256 },
        `${v.dir} — ${v.version || v.sha256.slice(0, 12)} (${v.source})`))),
    h("button", { class: "primary", disabled: S.devPluginBusy === key, onclick: () => addDevicePlugin(d, draft.sha) },
      S.devPluginBusy === key ? "Dodaję…" : "Dodaj do urządzenia"),
    S.devPluginMsg[key] && h("span", { class: (S.devPluginMsg[key].ok ? "ok" : "err") + " small" }, S.devPluginMsg[key].text));
}

async function addDevicePlugin(d, sha) {
  const v = pluginByHash(sha);
  if (!v) return;
  await saveDevicePlugins(d, { ...(d.plugins || {}), [v.dir]: sha });
}

async function removeDevicePlugin(d, dir) {
  if (!confirm(`Usunąć „${dir}” z celu tego urządzenia?\n\nPrzy najbliższej synchronizacji czytnik poprosi o potwierdzenie odinstalowania.`)) return;
  const next = { ...(d.plugins || {}) };
  delete next[dir];
  await saveDevicePlugins(d, next);
}

async function saveDevicePlugins(d, next) {
  S.devPluginBusy = d.id; S.devPluginMsg[d.id] = null; render();
  try {
    await api("POST", `/api/admin/devices/${d.id}/plugins`, { plugins: next });
    S.devPluginMsg[d.id] = { ok: true, text: "Zapisane. Czytnik poprosi o potwierdzenie przy najbliższej synchronizacji." };
  } catch (e) {
    S.devPluginMsg[d.id] = { ok: false, text: e.message };
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

function galleryTab() {
  if (!S.gallery) return h("p", { class: "loading" }, "Wczytuję galerię…");
  const g = S.gallery;
  return h("section", {},
    h("div", { class: "card plugin-warn" },
      h("h3", { style: "margin-top:0" }, "⚠ Zewnętrzny kod z pełnymi uprawnieniami"),
      h("p", { style: "margin:0" },
        "Wtyczki w galerii (poza sekcją „Od autora koligilo”) pisze społeczność, nie autorzy koligilo ani KOReadera. Na czytniku mają te same uprawnienia co reszta systemu — dostęp do plików, sieci, ustawień. Sprawdź repozytorium (opis, gwiazdki, aktywność), zanim wybierzesz „Zainstaluj”. Instalacja i tak wymaga osobnego potwierdzenia na czytniku.")),
    h("form", { class: "row", style: "margin:16px 0", onsubmit: ev => { ev.preventDefault(); S.galPage = 1; refresh(); } },
      h("input", { type: "search", id: "f-galq", "aria-label": "Szukaj wtyczek", "aria-keyshortcuts": "/", value: S.galQ,
        placeholder: "szukaj po nazwie lub opisie  ( / )", style: "flex:1;min-width:200px",
        oninput: ev => { S.galQ = ev.target.value; } }),
      h("select", { "aria-label": "Sortowanie", onchange: ev => { S.galSort = ev.target.value; S.galPage = 1; refresh(); } },
        h("option", { value: "stars", selected: S.galSort === "stars" || undefined }, "gwiazdki"),
        h("option", { value: "updated", selected: S.galSort === "updated" || undefined }, "ostatnia aktualizacja")),
      h("button", { type: "submit" }, "Szukaj"),
      h("button", { type: "button", disabled: S.galBusy, onclick: refreshGallery }, S.galBusy ? "Odświeżam…" : "Odśwież z GitHuba")),
    g.note && h("p", { class: "muted small" }, g.note),
    g.stale && h("p", { class: "muted small" }, "Dane mogą być nieaktualne (starsze niż 24 h) — kliknij „Odśwież z GitHuba”."),
    (g.promoted || []).length > 0 && g.page === 1 && h("section", { class: "gallery-promoted", style: "margin-bottom:20px" },
      h("h3", {}, "Od autora koligilo"),
      h("div", {}, g.promoted.map(repoCard))),
    (g.promoted || []).length > 0 && g.page === 1 && h("h3", {}, "Społeczność"),
    h("p", { class: "muted small" },
      `Repozytoria: ${g.total}, strona ${g.page}` + (g.updated_at && !g.updated_at.startsWith("0001") ? ` · odświeżono ${ago(g.updated_at)}` : "")),
    (g.repos || []).length === 0
      ? h("p", { class: "muted" }, (g.promoted || []).length > 0 ? "Nic więcej nie znaleziono." : "Nic nie znaleziono.")
      : h("div", {}, (g.repos || []).map(repoCard)),
    h("div", { class: "row", style: "margin-top:12px" },
      S.galPage > 1 && h("button", { onclick: () => { S.galPage--; refresh(); } }, "← Wstecz"),
      g.total > g.page * 30 && h("button", { onclick: () => { S.galPage++; refresh(); } }, "Więcej wyników →")));
}

async function refreshGallery() {
  S.galBusy = true; render();
  try { await api("POST", "/api/admin/gallery/refresh"); }
  catch (e) { S.error = e.message; }
  S.galBusy = false;
  refresh();
}

function repoCard(repo) {
  const key = repo.full_name;
  const versions = galleryVersionsFor(repo);
  const installed = versions.length > 0;
  const update = galleryUpdateAvailable(repo, versions);
  const inst = S.galInstall[key];
  return h("article", { class: "card gallery-repo", style: "margin-bottom:12px" },
    h("div", { class: "row", style: "justify-content:space-between;align-items:flex-start;flex-wrap:wrap" },
      h("div", { style: "flex:1;min-width:240px" },
        h("h3", { style: "margin:0 0 2px;display:flex;align-items:center;gap:8px" }, favStar("gh:" + repo.full_name), repo.full_name,
          installed && h("span", { class: "badge" }, "w magazynie"),
          update && h("span", { class: "badge warn" }, "dostępna aktualizacja")),
        h("p", { class: "muted small", style: "margin:2px 0 6px" },
          `★ ${repo.stars} · aktualizacja ${ago(repo.pushed_at)}` + (repo.latest_release ? ` · release ${repo.latest_release}` : "")),
        h("p", { style: "margin:0 0 8px" }, repo.description || h("span", { class: "muted" }, "(brak opisu)"))),
      h("a", { href: repo.html_url || `https://github.com/${repo.full_name}`, target: "_blank", rel: "noopener" }, "Repozytorium na GitHubie ↗")),
    inst ? galleryInstallPanel(repo, inst)
      : h("button", { class: "primary", onclick: () => { S.galInstall[key] = { devices: new Set(), busy: false, msg: null, candidates: null, path: "" }; render(); } },
          "Zainstaluj na…"));
}

function galleryInstallPanel(repo, inst) {
  const devices = S.state.devices;
  return h("div", { class: "subform" },
    h("p", { class: "muted small", style: "margin-top:0" },
      "Wybierz urządzenia. Instalacja wymaga potwierdzenia na czytniku przy najbliższej synchronizacji."),
    devices.length === 0
      ? h("p", { class: "muted" }, "Brak połączonych urządzeń.")
      : h("div", { class: "devpick" }, devices.map(d => h("label", {
          class: "row" + (d.plugins_allowed ? "" : " disabled"),
          title: d.plugins_allowed ? "" : "Włącz na czytniku: menu koligilo → Pozwól instalować wtyczki",
        },
          h("input", { type: "checkbox", disabled: !d.plugins_allowed, checked: inst.devices.has(d.id),
            onchange: ev => { if (ev.target.checked) inst.devices.add(d.id); else inst.devices.delete(d.id); render(); } }),
          d.name,
          !d.plugins_allowed && h("span", { class: "muted small" }, " (brak zgody na czytniku)")))),
    inst.candidates && h("div", { class: "field" },
      h("span", {}, "Wiele katalogów *.koplugin w repozytorium — wybierz jeden:"),
      h("select", { onchange: ev => { inst.path = ev.target.value; } },
        inst.candidates.map(c => h("option", { value: c === "." ? "" : c, selected: (inst.path === (c === "." ? "" : c)) || undefined }, c)))),
    h("div", { class: "row", style: "margin-top:10px" },
      h("button", { class: "primary", disabled: inst.busy || inst.devices.size === 0, onclick: () => installFromGallery(repo, inst) },
        inst.busy ? "Instaluję…" : "Zainstaluj"),
      h("button", { type: "button", onclick: () => { delete S.galInstall[repo.full_name]; render(); } }, "Anuluj")),
    inst.msg && h("p", { class: inst.msg.ok ? "ok" : "err" }, inst.msg.text));
}

async function installFromGallery(repo, inst) {
  inst.busy = true; inst.msg = null; render();
  const body = { repo: repo.full_name };
  if (repo.latest_release) body.ref = repo.latest_release;
  if (inst.path) body.path = inst.path;
  const res = await apiRaw("POST", "/api/admin/gallery/install", body);
  if (!res.ok) {
    if (res.status === 400 && res.data && res.data.candidates) {
      inst.candidates = res.data.candidates;
      if (!inst.path) inst.path = inst.candidates[0] === "." ? "" : inst.candidates[0];
      inst.msg = { ok: false, text: res.data.error };
    } else {
      inst.msg = { ok: false, text: (res.data && res.data.error) || `HTTP ${res.status}` };
    }
    inst.busy = false; render();
    return;
  }
  const plugin = res.data.plugin;
  const errs = [];
  for (const devId of inst.devices) {
    const d = S.state.devices.find(x => x.id === devId);
    if (!d) continue;
    const next = { ...(d.plugins || {}), [plugin.dir]: plugin.sha256 };
    const r2 = await apiRaw("POST", `/api/admin/devices/${devId}/plugins`, { plugins: next });
    if (!r2.ok) errs.push(`${d.name}: ${(r2.data && r2.data.error) || r2.status}`);
  }
  inst.busy = false;
  if (errs.length) {
    inst.msg = { ok: false, text: "Wtyczka trafiła do magazynu, ale nie udało się przypisać do: " + errs.join("; ") };
  } else {
    inst.msg = { ok: true, text: `Zainstalowano „${plugin.dir}” (${plugin.version || plugin.sha256.slice(0, 12)}) na wybranych urządzeniach. Potwierdź na czytniku przy najbliższej synchronizacji.` };
    delete S.galInstall[repo.full_name];
  }
  render();
  refresh();
}

// ---------------------------------------------------------------- start

const TABS = VIEWS.map(v => v[0]);

function showTab(id) {
  const changed = S.tab !== id;
  S.tab = id;
  history.replaceState(null, "", "#" + id);
  if (changed) app.scrollTop = 0;
  if (id === "konta" || id === "wtyczki") return refresh();
  render();
}

// Stary hash #galeria (dawna osobna pozycja nawigacji) → zakładka „Wtyczki”,
// wewnętrzna zakładka „Galeria” (TASK-19).
if (location.hash === "#galeria") { S.tab = "wtyczki"; S.pluginTab = "galeria"; }
else if (TABS.includes(location.hash.slice(1)) || location.hash === "#ustawienia") S.tab = location.hash.slice(1);

// Skróty: Alt+1…7 — widoki; „/” — wyszukiwarka galerii; strzałki/Home/End w pasku zakładek.
document.addEventListener("keydown", ev => {
  const inNav = document.getElementById("nav").contains(ev.target);
  const navReady = !document.getElementById("shell").classList.contains("bare");
  const digit = /^Digit([1-9])$/.exec(ev.code);
  if (navReady && ev.altKey && !ev.ctrlKey && !ev.metaKey && digit && TABS[digit[1] - 1]) {
    ev.preventDefault();
    showTab(TABS[digit[1] - 1]);
    return;
  }
  const t = ev.target, editing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  if (navReady && ev.key === "/" && !editing && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
    ev.preventDefault();
    // Zakładka „Wtyczki” → wewnętrzna zakładka „Galeria”; refresh() zwraca
    // obietnicę — pole wyszukiwania jest w DOM dopiero po niej.
    const need = S.tab !== "wtyczki" || S.pluginTab !== "galeria";
    S.tab = "wtyczki";
    history.replaceState(null, "", "#wtyczki");
    S.pluginTab = "galeria";
    pluginTabSet("galeria");
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
  // prośby o parowanie pojawiają się same — odpytujemy co 3 s, ale nie
  // przerysowujemy, gdy użytkownik pisze w formularzu
  setInterval(() => {
    const typing = document.activeElement && document.activeElement.tagName === "INPUT"
      && document.activeElement.type !== "checkbox";
    // na zakładce kont/wtyczek/galerii nie odświeżamy w tle — formularze i wybory
    // urządzeń/wersji zmieniają się tylko po zapisie
    // w „Wspólnych ustawieniach” nie zabieramy fokusu kontrolce (klawiatura)
    const focusedCtl = S.tab === "wspolne" && document.activeElement !== app && app.contains(document.activeElement);
    if (!typing && !focusedCtl && !S.busy && !S.srvBusy && S.tab !== "konta" && S.tab !== "wtyczki") refresh();
  }, 3000);
})();
