// 写真の候補の埋め込みと、ブラウザで動かす部品をそろえる（Actions「Photo model」から動かす。HF に届く所で）。
// - data/photo-emb.json：data/photo-labels.js の説明文を MobileCLIP S0 の文のモデル（fp32）で数の並びにしたもの（長さ1にそろえる）
// - models/Xenova/mobileclip_s0/：ブラウザで写真を読む画像のモデル（vision_model_quantized.onnx 約12MB）と設定・LICENSE
// - vendor/：transformers.js（3.8.1）と ONNX Runtime の wasm（同じサイトから読むため。外の CDN を使わない）
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { AutoTokenizer, CLIPTextModelWithProjection, AutoProcessor, CLIPVisionModelWithProjection, RawImage } from "@huggingface/transformers";

const root = process.argv[2] || ".";
const MODEL = "Xenova/mobileclip_s0";
const UA = "satou-aaaaa-tabeta-memo/1.0 (+https://github.com/satou-aaaaa/tabeta-memo)";

// --try：Wikimedia Commons の見本の写真で、ブラウザと同じ画像のモデル（量子化）と埋め込みを使って上位5つを出す（ログで見るだけ）
if (process.argv.includes("--try")) {
  const emb = JSON.parse(readFileSync(path.join(root, "data/photo-emb.json"), "utf8"));
  const proc = await AutoProcessor.from_pretrained(MODEL);
  const vis = await CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: "quantized" });
  for (const u of ["https://upload.wikimedia.org/wikipedia/commons/8/8a/Banana-Single.jpg", "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Natto_on_rice.jpg/640px-Natto_on_rice.jpg", "https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Japanese_curry_rice.jpg/640px-Japanese_curry_rice.jpg"]) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": UA } });
      if (!r.ok) { console.log(u, "HTTP", r.status); continue; }
      const img = await RawImage.fromBlob(await r.blob());
      const { image_embeds } = await vis(await proc(img));
      const v = image_embeds.normalize(2, -1).data;
      const sc = emb.vectors.map((t, i) => [emb.keys[i], t.reduce((a, x, j) => a + x * v[j], 0)]).sort((a, b) => b[1] - a[1]).slice(0, 5);
      console.log(u.split("/").pop(), sc.map(([k, s]) => k + " " + s.toFixed(3)).join(" / "));
    } catch (e) { console.log(u, String(e)); }
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
for (const f of ["config.json", "preprocessor_config.json", "LICENSE", "onnx/vision_model_quantized.onnx"]) {
  const r = await fetch(base + f, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
  writeFileSync(path.join(dir, f), Buffer.from(await r.arrayBuffer()));
  console.log("取った", f);
}
// ブラウザ用の部品
const dist = path.join(root, "tools/node_modules/@huggingface/transformers/dist");
mkdirSync(path.join(root, "vendor"), { recursive: true });
for (const f of ["transformers.web.min.js", "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]) copyFileSync(path.join(dist, f), path.join(root, "vendor", f));
copyFileSync(path.join(root, "tools/node_modules/@huggingface/transformers/LICENSE"), path.join(root, "vendor/LICENSE-transformers.txt"));
console.log("vendor に写した");
