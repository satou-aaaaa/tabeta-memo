// たべたメモの検査。データ（成分表の値・よく食べるものの食品番号・食事摂取基準の数）・外へ通信しないこと・PWA・
// 画面（はじめの設定・記録・探す・料理・自分の食品・消す・アドバイス・1週間・書き出し・保存して開き直し・スマホ幅）を見る。
// 使い方: node qa/run.mjs   失敗があれば終了コード 1。結果は qa-report/report.md。
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import path from "node:path";
import { checkSwStall } from "./sw-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) });
const read = (f) => readFileSync(path.join(root, f), "utf8");

// ---- 1. ブラウザを使わない検査 ----
const { meta, foods } = JSON.parse(read("data/foods.json"));
const F = new Map(foods.map((f) => [f.id, f]));
check("成分表：2,000 食品以上・出典が文科省の成分表", foods.length >= 2000 && /日本食品標準成分表/.test(meta.source) && /mext\.go\.jp/.test(meta.url), `${foods.length} ${meta.source}`);
check("成分表：食品番号が5けたで重ならない", F.size === foods.length && foods.every((f) => /^\d{5}$/.test(f.id)));
// 公式の表の値と同じか（手で書き換えていないか）。見本は成分表 八訂増補2023年の本表の値
const samples = [["01088", "kcal", 156], ["01088", "prot", 2.5], ["12004", "kcal", 142], ["12004", "salt", 0.4], ["12004", "vita", 210], ["06267", "vitc", 35], ["06267", "fe", 2.0], ["01001", "fib", 7.4]];
const bad = samples.filter(([id, k, v]) => !F.has(id) || F.get(id)[k] !== v).map(([id, k, v]) => `${id}.${k}=${F.get(id)?.[k]}（${v}のはず）`);
check("成分表：見本の値が公式の表と同じ（ごはん・卵・ほうれんそう・アマランサス）", bad.length === 0, bad.join(" "));
const ctx = { window: {} };
vm.runInNewContext(read("data/dri.js") + read("data/common.js") + read("data/menus.js") + read("data/exercise.js"), ctx);
const { DRI, COMMON, DISHES, MENUS, DIET, EXERCISES } = ctx.window;
const missing = COMMON.filter((c) => !F.has(c[1])).map((c) => c[0]).concat(DISHES.flatMap((d) => d[2].filter(([id]) => !F.has(id)).map(([id]) => `${d[0]}:${id}`)));
check("よく食べるもの・料理：食品番号が全部成分表にある", missing.length === 0, missing.join(" "));
const names = COMMON.map((c) => c[0]).concat(DISHES.map((d) => d[0]));
check("よく食べるもの・料理：名前が重ならない・量が正の数", new Set(names).size === names.length && COMMON.every((c) => c[3] > 0) && DISHES.every((d) => d[2].every(([, g]) => g > 0)));
{
  const badM = MENUS.flatMap((m) => m.items.filter(([k, a]) => !(a > 0) || (k.startsWith("f:") ? !F.has(k.slice(2)) : k.startsWith("d:") ? !DISHES.some((d) => d[0] === k.slice(2)) : true)).map(([k]) => `${m.name}:${k}`));
  check("献立：品物が全部成分表か料理にある・量が正の数・名前が重ならない", badM.length === 0 && new Set(MENUS.map((m) => m.name)).size === MENUS.length, badM.join(" "));
  check("献立：朝・昼・夜それぞれに家の献立が2つ以上、コンビニの組み合わせが1つ以上", ["b", "l", "d"].every((x) => MENUS.filter((m) => m.meal.includes(x) && !m.shop).length >= 2 && MENUS.filter((m) => m.meal.includes(x) && m.shop).length >= 1));
  check("コンビニの組み合わせに会社の名前・商品名を入れない（種類だけ）", MENUS.filter((m) => m.shop).every((m) => !/セブン|ローソン|ファミリーマート|ファミマ|ミニストップ|デイリー/.test(JSON.stringify(m))));
  // 体重から出す式（基礎代謝基準値 × 参照体重 × 身体活動レベル）が、推定エネルギー必要量の表とほぼ同じになるか（写し間違いの検出）
  const off = [];
  for (const a of DRI.ages) for (const s of [0, 1]) for (const l of [0, 1, 2]) {
    const t = DRI.eer[a.id][s][l]; if (t == null) continue;
    const c = DRI.bmrStd[a.id][s] * DRI.refWeight[a.id][s] * DRI.pal[a.id][l];
    if (Math.abs(c - t) > 60) off.push(`${a.id}/${s}/${l}: ${Math.round(c)}≠${t}`);
  }
  check("食事摂取基準：基礎代謝基準値×参照体重×身体活動レベル が推定エネルギー必要量の表と ±60kcal で合う", off.length === 0, off.join(" "));
  check("減量の目安：体重の3%・3〜6か月・7,000kcal/kg・BMI 18.5 未満は出さない", DIET.kcalPerKg === 7000 && DIET.minBmi === 18.5 && DIET.paces.some((p) => p.pct === 3 && p.days === 90) && DIET.paces.some((p) => p.pct === 3 && p.days === 180));
}
check("運動：メッツ表の見本の値（ふつうに歩く 3.0・やや速歩 4.3・ジョギング 7.0・ヨガ 2.5）・id が重ならない",
  EXERCISES.find((e) => e.id === "walk")?.mets === 3.0 && EXERCISES.find((e) => e.id === "brisk")?.mets === 4.3 && EXERCISES.find((e) => e.id === "jog")?.mets === 7.0 && EXERCISES.find((e) => e.id === "yoga")?.mets === 2.5 && new Set(EXERCISES.map((e) => e.id)).size === EXERCISES.length);
check("食事摂取基準：見本の数が2025年版と同じ（30〜49歳女性ふつう 2,050kcal・食塩 7.5/6.5g・75歳以上の「高い」は無し）",
  DRI.eer["30"][1][1] === 2050 && DRI.eer["18"][0][2] === 3000 && DRI.salt[0] === 7.5 && DRI.salt[1] === 6.5 && DRI.eer["75"][0][2] === null && DRI.fe["30"][2] === 10.5 && DRI.fib["30"][0] === 22);
{
  const idx = read("index.html");
  check("index.html の CSP：通信先は自分と、近くのお店を探す Overpass API だけ", /connect-src 'self' https:\/\/overpass-api\.de;/.test(idx));
  check("index.html は外のサイトから何も読み込まない", !/<(script|link|img)[^>]+(src|href)="https?:/i.test(idx));
  check("index.html の最初の行が <!doctype html>", idx.startsWith("<!doctype html>"));
  check("出典と注意書き（医療の代わりではない・相談先）がある", /mext\.go\.jp/.test(idx) && /mhlw\.go\.jp/.test(idx) && /代わりにはなりません/.test(idx) && /摂食障害/.test(idx));
  const app = read("src/app.js");
  check("アプリが外へ送るのはお店を探すときの Overpass だけ（fetch は3か所：食品・写真の候補・Overpass。XMLHttpRequest・sendBeacon を使わない）", (app.match(/fetch\(/g) || []).length === 3 && /fetch\("data\/foods\.json"\)/.test(app) && /fetch\("data\/photo-emb\.json"\)/.test(app) && /fetch\(OVERPASS/.test(app) && !/XMLHttpRequest|sendBeacon|WebSocket/.test(app));
  check("写真の AI：モデルは同じサイトからだけ読む（allowRemoteModels = false・外の CDN を使わない）・CSP は wasm を動かすだけ広げる", /allowRemoteModels = false/.test(app) && /localModelPath = new URL\("models\/"/.test(app) && /wasmPaths = new URL\("vendor\/"/.test(app) && /script-src 'self' 'wasm-unsafe-eval';/.test(idx) && !/cdn\.|huggingface/.test(app));
  {
    const emb = JSON.parse(read("data/photo-emb.json"));
    const ctx = { window: {} }; vm.runInNewContext(read("data/photo-labels.js"), ctx);
    const L = ctx.window.PHOTO_LABELS;
    const okKeys = L.every(([k]) => k.startsWith("d:") ? DISHES.some((d) => d[0] === k.slice(2)) : k.startsWith("f:") && F.has(k.slice(2)));
    check("写真の候補：説明文の品が全部成分表か料理にあり、埋め込みが同じ順・同じ数・長さ1", okKeys && emb.keys.length === L.length && emb.keys.every((k, i) => k === L[i][0]) && emb.vectors.every((v) => v.length === emb.dim && Math.abs(Math.hypot(...v) - 1) < 0.01), `${emb.keys.length}/${L.length}`);
    check("写真の AI：部品がそろい、モデルのライセンス（Apple）と transformers.js のライセンスを一緒に置く", ["models/Xenova/mobileclip_s0/onnx/vision_model_fp16.onnx", "models/Xenova/mobileclip_s0/config.json", "models/Xenova/mobileclip_s0/preprocessor_config.json", "vendor/transformers.min.js", "vendor/ort-wasm-simd-threaded.jsep.mjs", "vendor/ort-wasm-simd-threaded.jsep.wasm"].every((f) => existsSync(path.join(root, f))) && /Apple/.test(read("models/Xenova/mobileclip_s0/LICENSE")) && existsSync(path.join(root, "vendor/LICENSE-transformers.txt")));
  }
}
{
  const sw = read("sw.js");
  const shell = JSON.parse(/const SHELL = (\[[^\]]*\])/.exec(sw)[1].replace(/'/g, '"'));
  const used = ["src/style.css", "src/app.js", "data/dri.js", "data/common.js", "data/foods.json"];
  check("PWA：保存するファイルが全部あり、画面で使うファイルを全部保存する", shell.filter((f) => f !== "./").every((f) => existsSync(path.join(root, f))) && used.every((f) => shell.includes("./" + f)), shell.join(" "));
  const st = await checkSwStall(sw);
  check("PWA：通信が止まっても保存した画面に切り替わる（shared-workflows template/qa/sw-check.mjs）", st.ok, JSON.stringify(st));
}

// ---- 2. ブラウザで ----
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".css": "text/css", ".mjs": "text/javascript", ".wasm": "application/wasm" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(root, p);
  if (!f.startsWith(root) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: "ja-JP", timezoneId: "Asia/Tokyo", acceptDownloads: true, geolocation: { latitude: 35.712345, longitude: 139.612345 }, permissions: ["geolocation"] });
  // Overpass API は本物に送らず、作り話のお店を返す
  const overpass = [];
  await context.route("https://overpass-api.de/**", (route) => { overpass.push(route.request().postData() || ""); route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ elements: [
    { type: "node", lat: 35.7130, lon: 139.6120, tags: { shop: "convenience", name: "見本コンビニ 駅前店" } },
    { type: "way", center: { lat: 35.7150, lon: 139.6140 }, tags: { shop: "supermarket", name: "見本スーパー" } } ] }) }); });
  // 日付を決める（2026-11-22 の昼）
  await context.addInitScript(() => { const T0 = new Date("2026-11-22T12:00:00+09:00").getTime(), D = Date, off = T0 - D.now(); window.Date = class extends D { constructor(...a) { super(...(a.length ? a : [D.now() + off])); } static now() { return D.now() + off; } }; });
  const page = await context.newPage();
  const errors = [], outside = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("request", (r) => { if (!r.url().startsWith(base) && !r.url().startsWith("data:") && !r.url().startsWith("blob:") && !r.url().startsWith("https://overpass-api.de/")) outside.push(r.url()); });
  await page.goto(base);
  await page.waitForSelector("body.ready");
  check("はじめて開くと設定（あなたのこと）が出る", await page.isVisible("#v-settings") && await page.isVisible("#firstnote"));
  // 17歳は止める
  await page.check("input[name=sex][value=f]");
  await page.fill("input[name=age]", "17");
  await page.click("#profile button[type=submit]");
  check("18歳未満は目安を出さず、わけを出す", await page.isVisible("#ageerr") && await page.isVisible("#v-settings"));
  await page.fill("input[name=age]", "35");
  await page.selectOption("#act", "1");
  check("女性・65歳未満では月経の欄が出る", await page.isVisible("#mensesrow"));
  await page.check("input[name=menses]");
  await page.click("#profile button[type=submit]");
  check("設定すると「きょう」に移り、目安が 2,050kcal（35歳女性・ふつう）", await page.isVisible("#v-today") && /2,050kcal/.test(await page.textContent("#summary")));
  check("はじめての案内（3つの手順）が出て、「わかった」で消え、開き直しても出ない", await page.isVisible("#firsthelp") && (await page.locator("#firsthelp li").count()) === 3 && await (async () => { await page.click("#firstok"); await page.reload(); return page.isHidden("#firsthelp"); })());
  check("記録が無いときのひとことが出る", /まずは1食/.test(await page.textContent("#advice")));

  // よく食べるものから、朝にごはん
  await page.click('.meal[data-meal=b] button.add');
  check("たす画面が開き、よく食べるものが出る", await page.isVisible("#adddlg") && (await page.locator("#list li").count()) > 50);
  await page.click('#list button.pickbtn[data-key="f:01088"]');
  check("ごはんを選ぶと 茶碗1杯 150g が入っている", (await page.inputValue("#amt")) === "150" && /234kcal/.test(await page.textContent("#pickinfo")), await page.textContent("#pickinfo"));
  await page.click("#addok");
  check("ごはん1杯が朝に入り、234kcal（成分表 156kcal/100g × 150g）", /234/.test(await page.textContent("#kcal")) && /ごはん/.test(await page.textContent('.meal[data-meal=b]')));

  // ひらがなで探す
  await page.click('.meal[data-meal=b] button.add');
  await page.fill("#q", "なっとう");
  check("「なっとう」で納豆が先頭に出る", /納豆/.test(await page.textContent("#list li:first-child")), await page.textContent("#list li:first-child"));
  await page.fill("#q", "豚 ロース");
  check("「豚 ロース」で成分表の「ぶた ロース」が出る", /ぶた|豚ロース/.test(await page.textContent("#list")));
  await page.fill("#q", "ほげほげ");
  check("見つからないときは言いかえと足し方を案内する", /成分表に無いもの/.test(await page.textContent("#list")));
  await page.fill("#q", "なっとう");
  await page.click("#list li:first-child button.pickbtn");
  await page.click("#portions button:nth-child(4)");
  check("量のボタン（×2）で g が2倍になる", (await page.inputValue("#amt")) === "90");
  await page.click("#addok");
  check("納豆2パックが入る（184kcal/100g × 90g = 166kcal）", /166kcal/.test(await page.textContent('.meal[data-meal=b]')));
  check("次の食事（12時なので昼）のおすすめが3つと、コンビニの組み合わせが2つ出る", /昼ごはんのおすすめ/.test(await page.textContent("#suggesthead")) && (await page.locator("#suggestlist li").count()) === 3 && (await page.locator("#shoplist li").count()) === 2);
  check("お店はボタンを押すまで探さない（位置を送らない）", overpass.length === 0);
  check("見やすさ：おすすめ・ビタミンなどはたたんであり、押すと開く", !(await page.getAttribute("#suggest", "open") !== null) && await page.isHidden("#findshops") && await (async () => { await page.click("#suggest > summary"); return page.isVisible("#findshops"); })());
  await page.click("#findshops");
  await page.waitForFunction(() => /見本コンビニ/.test(document.querySelector("#shops").textContent));
  check("近くのお店：近い順に名前・距離・選び方が出る", /見本コンビニ 駅前店[\s\S]*約\d+m[\s\S]*選び方[\s\S]*見本スーパー/.test(await page.textContent("#shops")), await page.textContent("#shops"));
  check("近くのお店：送る位置は約100m（小数3けた）に丸める", overpass.length === 1 && /35\.712%2C139\.612|35\.712,139\.612/.test(overpass[0]), overpass[0]);

  // 料理
  await page.click('.meal[data-meal=l] button.add');
  await page.fill("#q", "かれー");
  await page.click('#list button.pickbtn[data-key="d:カレーライス"]');
  await page.click("#addok");
  const curry = 156 * 2 + 119 * 1.8;
  check(`料理（カレーライス）が昼に入る（ごはん200g＋ビーフカレー180g＝${Math.round(curry)}kcal）`, new RegExp(Math.round(curry) + "kcal").test(await page.textContent('.meal[data-meal=l]')), await page.textContent('.meal[data-meal=l]'));

  // 自分で足す食品
  await page.click('.meal[data-meal=s] button.add');
  await page.fill("#q", "テストのおやつ");
  await page.click("#opencustom");
  await page.fill("input[name=ckcal]", "200");
  await page.fill("input[name=csalt]", "0.3");
  await page.click("#customform button[type=submit]");
  await page.click("#addok");
  check("成分表に無いものを足して記録できる（200kcal）", /テストのおやつ/.test(await page.textContent('.meal[data-meal=s]')) && /200kcal/.test(await page.textContent('.meal[data-meal=s]')));

  // お気に入り
  await page.click('.meal[data-meal=d] button.add');
  await page.click('#list button.star[data-key="f:06268"]');
  await page.click('#addtabs button[data-tab=fav]');
  check("☆でお気に入りに入り、お気に入りの一覧に出る", /ほうれんそう/.test(await page.textContent("#list")));
  await page.click('#addtabs button[data-tab=recent]');
  check("最近の一覧に記録したものが出る", /カレーライス/.test(await page.textContent("#list")) && /納豆/.test(await page.textContent("#list")));
  await page.click("#addclose");

  // アドバイスと栄養
  const adv = await page.textContent("#advice");
  check("アドバイスが出る（足りない栄養素と、増やす食品の例）", /目安の\d+%/.test(adv) && /たとえば/.test(adv), adv);
  check("アドバイスに責める言い方・極端な減量のすすめが無い", !/ダメ|だめ|太り|食べすぎ|我慢|痩せ|やせる|絶食|抜いて/.test(adv), adv);
  check("栄養のようすに14項目が出る", (await page.locator("#nuts .nut").count()) === 14);
  const st = await page.evaluate(() => { const T = window.TABETA.targets({ sex: "m", age: 80, act: "2" }); return [T._E, T._actUsed, T.salt.hi]; });
  check("75歳以上の「高い」は基準に無いので「ふつう」の目安を使う（男性 2,250kcal）", st[0] === 2250 && st[1] === 1 && st[2] === 7.5, st);
  const fe = await page.evaluate(() => [window.TABETA.targets({ sex: "f", age: 35, act: "1", menses: true }).fe.lo, window.TABETA.targets({ sex: "f", age: 35, act: "1", menses: false }).fe.lo]);
  check("鉄の目安が月経のあり・なしで変わる（10.5mg／6.0mg）", fe[0] === 10.5 && fe[1] === 6.0, fe);

  // 消す
  await page.click('.meal[data-meal=s] button.del');
  check("×で記録を消せる", !/テストのおやつ/.test(await page.textContent('.meal[data-meal=s]')));

  // 開き直しても残る
  await page.reload();
  await page.waitForSelector("body.ready");
  check("開き直しても記録が残る（端末の中に保存）", /カレーライス/.test(await page.textContent("#meals")) && await page.isVisible("#v-today"));

  // 前の日
  await page.click("#prev");
  check("前の日に移ると記録が空", /11月21日/.test(await page.textContent("#daylabel")) && (await page.locator("#meals li").count()) === 0);
  check("前の日（すぎた日）は朝のおすすめが出る", /朝ごはんのおすすめ/.test(await page.textContent("#suggesthead")));
  if (await page.isHidden("#suggestlist li:first-child button.usemenu")) await page.click("#suggest > summary");
  await page.click("#suggestlist li:first-child button.usemenu");
  check("おすすめの献立をボタン1つで記録できる（朝に4品）", (await page.locator('.meal[data-meal=b] li').count()) >= 3);
  // 写真から（Claude の答えを貼る）
  await page.click('.meal[data-meal=d] button.add');
  await page.click("#openphoto");
  check("写真から：Claude に送る文が出て、答えの形（たべたメモ:）を書いてある", /たべたメモ:\[/.test(await page.inputValue("#photoprompt")));
  await page.fill("#photocode", "はい、見積もりです。\nたべたメモ:[{\"name\":\"ごはん\",\"g\":180,\"kcal\":281,\"p\":4.5,\"f\":0.5,\"c\":66,\"salt\":0},{\"name\":\"なぞのソース\",\"g\":30,\"kcal\":60,\"p\":0,\"f\":5,\"c\":3,\"salt\":0.8}]");
  check("写真から：ごはんは成分表に当て、無いものは見積もりを使う", (await page.locator("#photoprev li").count()) === 2 && /成分表/.test(await page.textContent("#photoprev li:nth-child(1)")) && /見積もり/.test(await page.textContent("#photoprev li:nth-child(2)")), await page.textContent("#photoprev"));
  await page.click("#photook");
  const dn = await page.textContent('.meal[data-meal=d]');
  check("写真から：2品が夜に入る（ごはん 180g＝281kcal・なぞのソース 60kcal）", /ごはん[\s\S]*281kcal/.test(dn) && /なぞのソース[\s\S]*60kcal/.test(dn), dn);
  await page.click('.meal[data-meal=d] button.add');
  await page.click("#openphoto");
  await page.fill("#photocode", "ごめんなさい、読み取れませんでした");
  check("写真から：形がちがう答えは記録せず、わけを出す", /見つかりません/.test(await page.textContent("#photoprev")) && await page.isHidden("#photook"));
  await page.click("#addclose");
  // 写真から探す（端末の中の AI）。作った絵（黄色い弓なり）を読ませ、候補が出て記録できるかを見る（当たるかは Actions「Photo model」の見本の写真で見る）
  {
    const r = await page.evaluate(() => window.TABETA.rankByEmbedding([1, 0], { keys: ["f:07107", "f:07107", "f:01088"], vectors: [[0.2, 0.9], [0.9, 0.1], [0.5, 0.5]] }, 6));
    check("写真の候補：同じ品は高いほう1つにまとめ、近い順に並べる", r.length === 2 && r[0][0] === "f:07107" && Math.abs(r[0][1] - 0.9) < 1e-9 && r[1][0] === "f:01088", JSON.stringify(r));
    const png = Buffer.from(await page.evaluate(() => { const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 256, 256); g.strokeStyle = "#f2d22e"; g.lineWidth = 40; g.beginPath(); g.arc(128, 40, 120, 0.6, 2.5); g.stroke(); return c.toDataURL("image/png").split(",")[1]; }), "base64");
    await page.click('.meal[data-meal=s] button.add');
    const t0 = Date.now();
    await page.setInputFiles("#aifile", { name: "test.png", mimeType: "image/png", buffer: png });
    await page.waitForFunction(() => document.querySelectorAll("#aiprev li").length > 0 || /動かせません/.test(document.querySelector("#aistat").textContent), null, { timeout: 180000 });
    check("写真から（端末の AI）：候補が6つ出て、1つ目にチェックが入る", (await page.locator("#aiprev li").count()) === 6 && await page.isChecked("#aiprev li:first-child input[type=checkbox]") && await page.isVisible("#aiimg"), `${await page.textContent("#aistat")} ${Date.now() - t0}ms`);
    const first = (await page.textContent("#aiprev li:first-child b")).trim();
    await page.click("#aiok");
    check("写真から（端末の AI）：チェックした品が間食に入る", (await page.textContent('.meal[data-meal=s]')).includes(first), first);
  }
  await page.click("#todaybtn");
  // 前と同じ：前の日の夕食（写真から入れた2品）を、きょうの夕食に1回で入れる
  check("前と同じ：きょうの夕食が空なら「前の日の夕食と同じ」が出る", /前の日の/.test(await page.textContent('.meal[data-meal=d] button.copy')));
  await page.click('.meal[data-meal=d] button.copy');
  check("前と同じ：押すと前の日の2品が入り、ボタンが消える", (await page.locator('.meal[data-meal=d] li').count()) === 2 && (await page.locator('.meal[data-meal=d] button.copy').count()) === 0);
  // 量を直す：ごはん 150g → 200g（156kcal/100g → 312kcal）
  await page.click('.meal[data-meal=b] li:first-child button.edit');
  check("量を直す：品をおすと、今の量（150g）で開く", (await page.inputValue("#amt")) === "150" && /直す/.test(await page.textContent("#addok")));
  await page.fill("#amt", "200");
  await page.click("#addok");
  check("量を直す：200g に変わり、品の数は増えない（312kcal）", /312kcal/.test(await page.textContent('.meal[data-meal=b] li:first-child')) && (await page.locator('.meal[data-meal=b] li').count()) === 2, await page.textContent('.meal[data-meal=b]'));

  // 1週間
  await page.click('nav.tabs button[data-view=week]');
  check("1週間：7日の棒と平均が出る", (await page.locator("#weekchart .col").count()) === 7 && (await page.locator("#weeknuts .nut").count()) === 14 && /\d 日の平均/.test(await page.textContent("#weekinfo")));

  // 書き出し
  await page.click('nav.tabs button[data-view=settings]');
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#export")]);
  const saved = JSON.parse(readFileSync(await dl.path(), "utf8"));
  check("書き出したファイルに記録が入っている", saved.days["2026-11-22"]?.length === 5 && saved.profile?.age === 35);
  await page.click('nav.tabs button[data-view=settings]');

  // 減量
  await page.fill("input[name=height]", "160");
  await page.fill("input[name=weight]", "60");
  await page.selectOption("select[name=goal]", "lose");
  check("減量を選ぶと減らし方が出る・BMI が出る", await page.isVisible("#paceRow") && /BMI 23\.4/.test(await page.textContent("#bmiinfo")));
  check("減量：BMI 25 未満では「早め」を選べない", await page.isDisabled('select[name=pace] option[value=fast]'));
  await page.fill("input[name=height]", "1.6");
  await page.click("#profile button[type=submit]");
  check("身長を m で入れたら（1.6）、だまって捨てず cm で入れるよう知らせる", await page.isVisible("#hwerr") && await page.isVisible("#v-settings"));
  await page.fill("input[name=height]", "160");
  await page.selectOption("select[name=pace]", "std");
  check("設定は変えたらすぐ保存する（保存しましたと減量が出る）", /保存しました[\s\S]*減量/.test(await page.textContent("#saved")), await page.textContent("#saved"));
  // 「目安を出す」を押さずに、きょうへ移っても減量の目安になる（2026-11-23 satou さんの報告）
  await page.click('nav.tabs button[data-view=today]');
  const dl2 = await page.textContent("#dietline");
  check("減量：目安の行は「減量の目安」から始まり、輪の横も「減量の目安」", /^減量の目安：1日 2,160kcal/.test(dl2.trim()) && /減量の目安2,160kcal/.test((await page.textContent("#summary")).replace(/\s+/g, "")), dl2);
  // 21.9 × 60kg × 1.75 = 2,300kcal（体重を保つ）、60kg の3% = 1.8kg × 7,000 ÷ 90日 = 140kcal → 2,160kcal
  check("減量：体重から目安 2,300kcal、3か月で3%（1.8kg）なら 1日 140kcal 減らして 2,160kcal", /2,300kcal/.test(dl2) && /140kcal/.test(dl2) && /2,160kcal/.test(dl2) && /2,160kcal/.test(await page.textContent("#summary")), dl2);
  const low = await page.evaluate(() => window.TABETA.targets({ sex: "f", age: 35, act: "1", height: 160, weight: 45, goal: "lose", pace: "std" }));
  check("減量：BMI 18.5 未満（160cm・45kg）は減量の目標を出さない", low._diet && low._diet.blocked === "low" && low._E === low._keep);
  const fast = await page.evaluate(() => window.TABETA.targets({ sex: "f", age: 35, act: "1", height: 160, weight: 55, goal: "lose", pace: "fast" }));
  check("減量：「早め」は BMI 25 未満の人には出さない", fast._diet && fast._diet.blocked === "pace");
  const big = await page.evaluate(() => window.TABETA.targets({ sex: "f", age: 35, act: "1", height: 160, weight: 100, goal: "lose", pace: "std" }));
  check("減量：BMI 25 をこえる分の体重は目安に入れない（160cm・100kg でも 64kg として計算）", big._keep === Math.round(21.9 * 64 * 1.75 / 10) * 10, big._keep);
  check("減量中もたんぱく質の目安は推奨量（50g）より下げない", big.prot.lo >= 50 && low.prot.lo >= 50);
  await page.fill("#wt", "59.5");
  await page.click("#wtsave");
  check("体重を記録すると目安が変わる（59.5kg：2,280kcal − 140kcal = 2,140kcal）", /2,140kcal/.test(await page.textContent("#dietline")), await page.textContent("#dietline"));
  await page.click("#prev");
  await page.fill("#wt", "60.5");
  await page.click("#wtsave");
  await page.click("#todaybtn");
  check("体重の変化が出る（前の日 60.5kg → きょう 59.5kg で −1.0kg）", /−1\.0kg/.test(await page.textContent("#dietline")), await page.textContent("#dietline"));

  await page.click('nav.tabs button[data-view=week]');
  check("体重のグラフ：2日分の点と7日平均の線が出る", (await page.locator("#wchart circle").count()) === 2 && (await page.locator("#wchart path.avg").count()) === 1 && /−1\.0kg/.test(await page.textContent("#wchart")), await page.textContent("#wchart"));
  await page.click('nav.tabs button[data-view=settings]');
  await page.click("[data-a11y-open]");
  check("見やすさの設定：設定の画面から開ける（文字・色・動き・読み上げ）", await page.isVisible(".a11y-dlg") && /読みやすい文字/.test(await page.textContent(".a11y-dlg")));
  await page.keyboard.press("Escape");
  const fb = await page.getAttribute("#feedback", "href");
  check("感想のフォーム：アプリの名前だけを入れて開く（記録の中身を URL に入れない）", /^https:\/\/docs\.google\.com\/forms\//.test(fb) && /entry\.443796210=/.test(fb) && !/kcal|tabeta-memo:v1|\d{4}-\d\d-\d\d/.test(fb), fb);
  await page.click('nav.tabs button[data-view=today]');

  // 運動（体重 59.5kg・ジョギング 30分：(7.0−1) × 0.5時間 × 59.5kg = 179kcal を目安に足す）
  await page.click("#movecard summary");
  await page.selectOption("#movetype", "jog");
  await page.fill("#movemin", "30");
  await page.click("#moveadd");
  check("運動：ジョギング30分で 179kcal を使い、目安が 2,140 → 2,319kcal になる", /179kcal/.test(await page.textContent("#movelist")) && /2,319kcal/.test(await page.textContent("#summary")), await page.textContent("#summary"));
  await page.fill("#steps", "6500");
  await page.click("#stepssave");
  check("歩数：記録すると 8,000歩の目安まであと何歩かが出て、目安には足さない", /あと 1,500歩/.test(await page.textContent("#stepsinfo")) && /2,319kcal/.test(await page.textContent("#summary")));
  await page.click("#movelist button.delmove");
  check("運動：×で消すと目安がもどる", /2,140kcal/.test(await page.textContent("#summary")));

  // スマホ幅で横にはみ出さない
  for (const v of ["today", "week", "settings", "about"]) {
    await page.click(`nav.tabs button[data-view=${v}]`);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`360px 幅で横にはみ出さない（${v}）`, over <= 0, over);
  }
  // 全部消す（2回押し）
  await page.click('nav.tabs button[data-view=settings]');
  await page.click("#wipe");
  check("全部消すは1回目では消えない", JSON.parse(await page.evaluate(() => localStorage.getItem("tabeta-memo:v1"))).profile !== null);
  await page.click("#wipe");
  check("2回押すと全部消え、はじめの設定にもどる", await page.isVisible("#firstnote"));

  check("外のサイトへ何も送らない", outside.length === 0, outside.join(" "));
  check("エラーが出ない", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  server.close();
}

const ng = results.filter((r) => !r.ok);
mkdirSync(path.join(root, "qa-report"), { recursive: true });
writeFileSync(path.join(root, "qa-report/report.md"), `# QA ${ng.length ? "❌" : "✅"} ${results.length - ng.length}/${results.length}\n\n` + results.map((r) => `- ${r.ok ? "✅" : "❌"} ${r.name}${r.detail && !r.ok ? `\n  - ${r.detail}` : ""}`).join("\n") + "\n");
for (const r of results) console.log(`${r.ok ? "✅" : "❌"} ${r.name}${!r.ok && r.detail ? " — " + r.detail : ""}`);
console.log(`\n${results.length - ng.length}/${results.length}`);
process.exit(ng.length ? 1 : 0);
