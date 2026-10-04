// TASK-22 AC3: literał z kontrolek panelu (web/lua.js) == Sync.serialize bajt w bajt.
// node tests/luaser_test.js (z katalogu repo; wymaga `lua` w PATH).
"use strict";
const { spawnSync } = require("child_process");
const { luaSerialize, luaParse } = require("../web/lua.js");
const KO = require("../web/koreader_opts.js");

const M = ents => new Map(ents);
const cases = [
  0, -0, 1, -3, 100, 22.5, 0.1, 1 / 3, -2.5, 1e20, 1e21, 1e-5, 1.5e-7, 1e-4, 0.00012345,
  123456.789, 2 ** 53, 2 ** 53 + 2, 2 ** 60, 1 + 2 ** -17, 5e-324, 1.7976931348623157e308,
  1e16, 1e17, 12345678901234567890, 0.3, 1.45, 15.0, -0.25,
  "", "zwykły", 'a"b\\c\n\t\r\x01\x7f', "zażółć 😀  ∑",
  true, false,
  [95, 75], [10, 10], [], [1, "dwa", true, [3.5]],
  { b: true, a: false, B: 1, "": 1, "😀": 2, "ą": 3, "klucz.z.kropką": 7 },
  M([[1, "a"], ["1", "b"], [2.5, true], [-1, 0], ["x", M([[1, [5, 5]]])]]),
  { time: true, battery: false, text_font_size: 14, item_prefix: "icons", nested: { deep: { er: [0.8, 1.9] } } },
];
// + wszystkie presety i domyślne z mapy KOReadera (to, co faktycznie klikają kontrolki)
for (const o of KO.opts) for (const v of [...(o.values || []), o.default, o.on, o.off]) if (v !== undefined) cases.push(v);
cases.push(Object.fromEntries(KO.tweaks.map(t => [t.id, true])));

// mapa KOReadera: każda opcja ma nazwę, opisy bez znaczników punktorów z KOReadera
let mapErr = 0;
for (const o of KO.opts) {
  if (typeof o.label !== "string" || !o.label.trim() || o.label === o.key) { mapErr++; console.log("FAIL brak etykiety: " + o.key); }
  for (const b of (o.help || []).flat()) if (/^\s*[-•▶▸*]\s/.test(b)) { mapErr++; console.log(`FAIL znacznik w opisie ${o.key}: ${b.slice(0, 40)}`); }
}

function tokens(v) {
  if (typeof v === "number") return ["n", String(v)];
  if (typeof v === "string") return ["s", "x" + Buffer.from(v, "utf8").toString("hex")];
  if (typeof v === "boolean") return ["b", v ? "1" : "0"];
  const ents = v instanceof Map ? [...v] : Array.isArray(v) ? v.map((x, i) => [i + 1, x]) : Object.entries(v);
  return ["t", String(ents.length), ...ents.flatMap(([k, x]) => [...tokens(k), ...tokens(x)])];
}

function lua(mode, lines) {
  const r = spawnSync("lua", ["tests/luaser_ref.lua", mode], { input: lines.join("\n") + "\n", encoding: "utf8" });
  if (r.status !== 0) throw new Error("lua: " + r.stderr);
  return r.stdout.split("\n").slice(0, lines.length);
}

const js = cases.map(v => luaSerialize(v));
const ref = lua("values", cases.map(v => tokens(v).join(" ")));
const fix = lua("fix", js);
let failed = mapErr;
cases.forEach((v, i) => {
  const again = luaSerialize(luaParse(js[i]));
  for (const [what, got, want] of [["Sync.serialize", js[i], ref[i]], ["deserialize∘serialize", fix[i], js[i]], ["luaParse", again, js[i]]]) {
    if (got !== want) { failed++; console.log(`FAIL ${what} #${i}:\n  js   ${js[i]}\n  got  ${got}\n  want ${want}`); }
  }
});
for (const evil of ["os.exit(1)", "{[1]=print}", "{[1]=1", '"\\300"', "1 2", "function() end"]) {
  try { luaParse(evil); failed++; console.log("FAIL luaParse przyjął " + evil); } catch { /* ok */ }
}
console.log(`luaser: ${cases.length} wartości, ${failed ? failed + " błędów" : "zgodne z Sync.serialize"}`);
process.exit(failed ? 1 : 0);
