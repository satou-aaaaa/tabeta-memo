// 見た目の点検用：見本の記録で各画面を写す。使い方：node qa/shots.mjs <出力フォルダ> [light|dark]（CHROMIUM は /opt/pw-browsers/chromium）
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
const root = process.cwd(), out = process.argv[2], scheme = process.argv[3] || "light";
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".mjs": "text/javascript", ".wasm": "application/wasm", ".png": "image/png" };
const server = createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html"; const f = path.join(root, p); if (!existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); res.end(readFileSync(f)); }).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, locale: "ja-JP", timezoneId: "Asia/Tokyo", colorScheme: scheme });
await ctx.addInitScript(() => { const T0 = new Date("2026-11-22T19:00:00+09:00").getTime(), D = Date, off = T0 - D.now(); window.Date = class extends D { constructor(...a) { super(...(a.length ? a : [D.now() + off])); } static now() { return D.now() + off; } }; });
const st = { v: 1, helped: true, profile: { sex: "m", age: 38, act: "1", height: 172, weight: 74, goal: "lose", pace: "std" }, custom: [], recent: [], fav: [], moves: { "2026-11-22": [{ id: "walk2", min: 30 }] }, steps: { "2026-11-22": 7200 },
  weights: { "2026-11-02": 74.4, "2026-11-05": 74.1, "2026-11-08": 74.3, "2026-11-11": 73.8, "2026-11-14": 73.6, "2026-11-17": 73.7, "2026-11-20": 73.2, "2026-11-22": 73.0 },
  days: { "2026-11-22": [{ key: "f:01088", amt: 150, meal: "b" }, { key: "f:04046", amt: 45, meal: "b" }, { key: "d:みそ汁（豆腐とわかめ）", amt: 1, meal: "b" }, { key: "d:親子丼", amt: 1, meal: "l" }, { key: "f:07107", amt: 100, meal: "s" }],
    "2026-11-21": [{ key: "d:カレーライス", amt: 1, meal: "d" }, { key: "f:06061", amt: 50, meal: "d" }], "2026-11-20": [{ key: "f:01088", amt: 150, meal: "l" }, { key: "f:11289", amt: 120, meal: "l" }], "2026-11-19": [{ key: "d:ざるそば", amt: 1, meal: "l" }] } };
await ctx.addInitScript((s) => { if (!localStorage.getItem("tabeta-memo:v1")) localStorage.setItem("tabeta-memo:v1", s); }, JSON.stringify(st));
const page = await ctx.newPage();
await page.goto(base); await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/${scheme}-today.png`, fullPage: true });
await page.click('.meal[data-meal=d] button.add'); await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/${scheme}-add.png` });
await page.click("#addclose");
for (const v of ["week", "settings", "about"]) { await page.click(`nav.tabs button[data-view=${v}]`); await page.waitForTimeout(200); await page.screenshot({ path: `${out}/${scheme}-${v}.png`, fullPage: true }); }
await b.close(); server.close();
