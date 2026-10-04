// Literały Lua w przeglądarce — lustro Sync.serialize/Sync.deserialize
// (plugin/koligilo.koplugin/sync.lua) i luavalue.go. Kontrolki widoku
// „Wspólne ustawienia” zapisują wartości WYŁĄCZNIE przez luaSerialize, bo
// czytnik porównuje literały bajt w bajt — inny zapis tej samej wartości
// wyglądałby jak zmiana (pilnuje tests/luaser_test.js).
//
// Wartości: napis, liczba, prawda/fałsz, tabela = Map (klucze liczba|napis,
// więc 1 i "1" się nie mylą). luaSerialize przyjmuje też tablicę JS
// (klucze 1..n) i zwykły obiekt (klucze-napisy). Parser nigdy nie wykonuje kodu.
"use strict";

function luaQuote(s) {
  let out = '"';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 32 || c === 127) out += "\\" + String(c).padStart(3, "0");
    else out += ch;
  }
  return out + '"';
}

// %.17g z glibc: dokładne rozwinięcie dziesiętne (BigInt) i zaokrąglenie
// połówek do parzystej — Number#toFixed/toPrecision zaokrągla połówki w górę.
function fmtG17(x) {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const bits = dv.getBigUint64(0);
  let e = Number((bits >> 52n) & 0x7ffn);
  let m = bits & ((1n << 52n) - 1n);
  if (e === 0) e = 1; else m |= 1n << 52n;
  e -= 1075; // |x| = m · 2^e
  const D = e >= 0 ? (m << BigInt(e)).toString() : (m * 5n ** BigInt(-e)).toString();
  let X = D.length - 1 + (e >= 0 ? 0 : e); // wykładnik dziesiętny pierwszej cyfry
  let head = D.slice(0, 17).padEnd(17, "0");
  const rest = D.slice(17);
  if (rest && (rest[0] > "5" || (rest[0] === "5" && (/[1-9]/.test(rest.slice(1)) || +head[16] % 2 === 1)))) {
    head = (BigInt(head) + 1n).toString();
    if (head.length > 17) { head = head.slice(0, 17); X++; }
  }
  let out;
  if (X < -4 || X >= 17) {
    const frac = head.slice(1).replace(/0+$/, "");
    out = head[0] + (frac ? "." + frac : "") + "e" + (X < 0 ? "-" : "+") + String(Math.abs(X)).padStart(2, "0");
  } else {
    const int = X >= 0 ? head.slice(0, X + 1) : "0";
    const frac = (X >= 0 ? head.slice(X + 1) : "0".repeat(-X - 1) + head).replace(/0+$/, "");
    out = int + (frac ? "." + frac : "");
  }
  return (x < 0 ? "-" : "") + out;
}

function luaNum(n) {
  if (!Number.isFinite(n)) throw new Error("liczba nieskończona/NaN");
  if (Number.isInteger(n) && Math.abs(n) < 2 ** 53) return n === 0 ? "0" : String(n);
  return fmtG17(n);
}

// Kolejność napisów jak table.sort w Lua (strcmp bajtów UTF-8 = kolejność punktów kodowych).
function cmpCodepoints(a, b) {
  const A = Array.from(a, c => c.codePointAt(0)), B = Array.from(b, c => c.codePointAt(0));
  for (let i = 0; i < Math.min(A.length, B.length); i++) if (A[i] !== B[i]) return A[i] - B[i];
  return A.length - B.length;
}

function luaEntries(v) {
  if (v instanceof Map) return [...v.entries()];
  if (Array.isArray(v)) return v.map((x, i) => [i + 1, x]);
  return Object.entries(v);
}

function luaSerialize(v, depth = 0) {
  if (depth > 32) throw new Error("za głęboko zagnieżdżone");
  if (typeof v === "string") return luaQuote(v);
  if (typeof v === "number") return luaNum(v);
  if (typeof v === "boolean") return String(v);
  if (v && typeof v === "object") {
    const ents = luaEntries(v).filter(([, x]) => x !== undefined && x !== null);
    const nums = ents.filter(([k]) => typeof k === "number").sort((a, b) => a[0] - b[0]);
    const strs = ents.filter(([k]) => typeof k === "string").sort((a, b) => cmpCodepoints(a[0], b[0]));
    if (nums.length + strs.length !== ents.length) throw new Error("klucz nieprzenośnego typu");
    return "{" + nums.concat(strs).map(([k, x]) =>
      "[" + (typeof k === "number" ? luaNum(k) : luaQuote(k)) + "]=" + luaSerialize(x, depth + 1)).join(",") + "}";
  }
  throw new Error("typ " + typeof v);
}

// Parser DOKŁADNIE formatu serialize (jak Sync.deserialize). Rzuca Error.
function luaParse(s) {
  let pos = 0;
  const ws = () => { while (pos < s.length && " \t\r\n".includes(s[pos])) pos++; };
  const fail = msg => { throw new Error(msg + " na " + (pos + 1)); };
  function str() {
    pos++;
    let out = "";
    for (;;) {
      if (pos >= s.length) fail("niedomknięty napis");
      const c = s[pos];
      if (c === '"') { pos++; return out; }
      if (c !== "\\") { out += c; pos++; continue; }
      const e = s[pos + 1];
      const simple = { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" }[e];
      if (simple) { out += simple; pos += 2; continue; }
      const d = /^\d{1,3}/.exec(s.slice(pos + 1, pos + 4));
      if (!d) fail("nieznana sekwencja \\" + e);
      const b = +d[0];
      // bajty ≥128 nie są znakami — kanoniczny zapis ich tak nie koduje
      if (b > 127) fail("bajt spoza ASCII");
      out += String.fromCharCode(b); pos += 1 + d[0].length;
    }
  }
  function value(depth) {
    if (depth > 32) fail("za głęboko");
    ws();
    const c = s[pos];
    if (c === '"') return str();
    if (c === "{") {
      pos++;
      const t = new Map();
      ws();
      if (s[pos] === "}") { pos++; return t; }
      for (;;) {
        ws();
        if (s[pos] !== "[") fail("oczekiwano [");
        pos++;
        const k = value(depth + 1);
        if (typeof k !== "string" && typeof k !== "number") fail("zły klucz");
        ws();
        if (s.slice(pos, pos + 2) !== "]=") fail("oczekiwano ]=");
        pos += 2;
        t.set(k, value(depth + 1));
        ws();
        const d = s[pos++];
        if (d === "}") return t;
        if (d !== ",") fail("oczekiwano , lub }");
      }
    }
    if (s.startsWith("true", pos)) { pos += 4; return true; }
    if (s.startsWith("false", pos)) { pos += 5; return false; }
    const m = /^-?\d+\.?\d*[eE]?[-+]?\d*/.exec(s.slice(pos));
    if (!m || m[0] === "-") fail("nieoczekiwany znak");
    const n = Number(m[0]);
    if (!Number.isFinite(n)) fail("zła liczba " + m[0]);
    pos += m[0].length;
    return n;
  }
  const v = value(0);
  ws();
  if (pos < s.length) fail("śmieci po wartości");
  return v;
}

// Tabela-lista (klucze 1..n) → tablica JS; inaczej null.
function luaList(v) {
  if (Array.isArray(v)) return v;
  if (!(v instanceof Map)) return null;
  const out = [];
  for (let i = 1; i <= v.size; i++) { if (!v.has(i)) return null; out.push(v.get(i)); }
  return out;
}

const luaSame = (a, b) => { try { return luaSerialize(a) === luaSerialize(b); } catch { return false; } };

if (typeof module !== "undefined") module.exports = { luaQuote, luaNum, luaSerialize, luaParse, luaList, luaSame };
