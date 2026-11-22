// 写真の候補の埋め込みと、ブラウザで動かす部品をそろえる（Actions「Photo model」から動かす。HF に届く所で）。
// - data/photo-emb.json：data/photo-labels.js の説明文を MobileCLIP S0 の文のモデル（fp32）で数の並びにしたもの（長さ1にそろえる）
// - models/Xenova/mobileclip_s0/：ブラウザで写真を読む画像のモデル（vision_model_fp16.onnx。量子化した型は答えがはずれるので使わない）と設定・LICENSE
// - vendor/：transformers.js（3.8.1 の、ONNX Runtime を中に含む transformers.min.js）と ONNX Runtime の wasm（同じサイトから読むため。外の CDN を使わない）
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { AutoTokenizer, CLIPTextModelWithProjection, AutoProcessor, CLIPVisionModelWithProjection, RawImage } from "@huggingface/transformers";

const root = process.argv[2] || ".";
const MODEL = "Xenova/mobileclip_s0";
const UA = "satou-aaaaa-tabeta-memo/1.0 (+https://github.com/satou-aaaaa/tabeta-memo)";

// --try：Wikimedia Commons で見本の写真を探し、画像のモデルの型ごとに上位3つを出す（ログで見るだけ）。
// 2026-11-22 に比べた結果：fp32・fp16 は16枚中13枚で正しい品が3位以内。q8・uint8（量子化）は全部はずれた（使わない）。ブラウザは fp16 を使う。
if (process.argv.includes("--try")) {
  const emb = JSON.parse(readFileSync(path.join(root, "data/photo-emb.json"), "utf8"));
  const proc = await AutoProcessor.from_pretrained(MODEL);
  const QS = ["banana fruit", "natto rice", "Japanese curry rice", "miso soup", "onigiri", "karaage", "ramen", "gyoza", "tonkatsu", "salmon grilled", "oyakodon", "spaghetti bolognese", "strawberry shortcake", "melonpan", "edamame", "boiled egg"];
  const imgs = [];
  for (const q of QS) {
    try {
      const api = "https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=1&gsrsearch=" + encodeURIComponent(q + " filetype:bitmap") + "&prop=imageinfo&iiprop=url&iiurlwidth=512";
      const j = await (await fetch(api, { headers: { "User-Agent": UA } })).json();
      const pg = Object.values(j.query.pages)[0];
      const u = pg.imageinfo[0].thumburl;
      const r = await fetch(u, { headers: { "User-Agent": UA } });
      if (!r.ok) { console.log(q, "HTTP", r.status); continue; }
      imgs.push([q, pg.title, await RawImage.fromBlob(await r.blob())]);
      await new Promise((ok) => setTimeout(ok, 500));
    } catch (e) { console.log(q, String(e)); }
  }
  for (const dtype of ["fp16", "fp32"]) {
    let vis;
    try { vis = await CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype }); } catch (e) { console.log(dtype, "読めない", String(e).slice(0, 80)); continue; }
    console.log("== 型", dtype);
    for (const [q, title, img] of imgs) {
      const { image_embeds } = await vis(await proc(img));
      const v = image_embeds.normalize(2, -1).data;
      const sc = emb.vectors.map((t, i) => [emb.keys[i], t.reduce((a, x, j) => a + x * v[j], 0)]).sort((a, b) => b[1] - a[1]).slice(0, 3);
      console.log("TRY", dtype, q, "|", title.slice(5, 45), "|", sc.map(([k, s]) => k + " " + s.toFixed(3)).join(" / "));
    }
  }
  process.exit(0);
}
const ctx = { window: {} };
vm.runInNewContext(readFileSync(path.join(root, "data/photo-labels.js"), "utf8"), ctx);
const labels = ctx.window.PHOTO_LABELS;
const tok = await AutoTokenizer.from_pretrained(MODEL);
const textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: "fp32" });
const inputs = tok(labels.map(([, t]) => "a photo of " + t + ", a type of food."), { padding: "max_length", truncation: true });
const { text_embeds } = await textModel(inputs);
const n = text_embeds.normalize(2, -1);
const dim = n.dims[1];
const data = Array.from(n.data);
const vectors = labels.map((_, i) => data.slice(i * dim, (i + 1) * dim).map((v) => Math.round(v * 10000) / 10000));
writeFileSync(path.join(root, "data/photo-emb.json"), JSON.stringify({ model: MODEL, dim, keys: labels.map(([k]) => k), vectors }) + "\n");
console.log("埋め込み", labels.length, "×", dim);

// 画像のモデルを取る（HF から。名乗る）
const base = `https://huggingface.co/${MODEL}/resolve/main/`;
const dir = path.join(root, "models", MODEL);
mkdirSync(path.join(dir, "onnx"), { recursive: true });
for (const f of ["config.json", "preprocessor_config.json", "LICENSE", "onnx/vision_model_fp16.onnx"]) {
  const r = await fetch(base + f, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
  writeFileSync(path.join(dir, f), Buffer.from(await r.arrayBuffer()));
  console.log("取った", f);
}
// ブラウザ用の部品
const dist = path.join(root, "tools/node_modules/@huggingface/transformers/dist");
mkdirSync(path.join(root, "vendor"), { recursive: true });
for (const f of ["transformers.min.js", "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]) copyFileSync(path.join(dist, f), path.join(root, "vendor", f));
copyFileSync(path.join(root, "tools/node_modules/@huggingface/transformers/LICENSE"), path.join(root, "vendor/LICENSE-transformers.txt"));
console.log("vendor に写した");
