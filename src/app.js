// たべたメモ：食べたものを記録して、1日の栄養の目安と比べ、ひとことアドバイスを出す。
// 記録は端末の中（localStorage）だけに置き、外へ送らない。栄養値は文科省の成分表（data/foods.json）、目安は食事摂取基準（data/dri.js）。
"use strict";
(() => {
  const KEY = "tabeta-memo:v1";
  const MEALS = [["b", "朝ごはん"], ["l", "昼ごはん"], ["d", "夜ごはん"], ["s", "間食"]];
  const ACTS = [["0", "低い（座っていることが多い）"], ["1", "ふつう（立ち仕事・通勤や家事で動く）"], ["2", "高い（体を動かす仕事・よく運動する）"]];
  // 画面に出す栄養素。type: range（範囲）・min（これ以上）・max（これ未満）
  const NUTS = [
    { k: "kcal", label: "エネルギー", unit: "kcal", type: "range", d: 0 },
    { k: "prot", label: "たんぱく質", unit: "g", type: "range", d: 1 },
    { k: "fat", label: "脂質", unit: "g", type: "range", d: 1 },
    { k: "carb", label: "炭水化物", unit: "g", type: "range", d: 1 },
    { k: "fib", label: "食物繊維", unit: "g", type: "min", d: 1 },
    { k: "salt", label: "食塩相当量", unit: "g", type: "max", d: 1 },
    { k: "k", label: "カリウム", unit: "mg", type: "min", d: 0 },
    { k: "ca", label: "カルシウム", unit: "mg", type: "min", d: 0 },
    { k: "fe", label: "鉄", unit: "mg", type: "min", d: 1 },
    { k: "vita", label: "ビタミンA", unit: "μg", type: "min", d: 0 },
    { k: "vitb1", label: "ビタミンB1", unit: "mg", type: "min", d: 2 },
    { k: "vitb2", label: "ビタミンB2", unit: "mg", type: "min", d: 2 },
    { k: "vitc", label: "ビタミンC", unit: "mg", type: "min", d: 0 },
    { k: "vitd", label: "ビタミンD", unit: "μg", type: "min", d: 1 },
  ];
  const NKEYS = NUTS.map((n) => n.k);
  // 増やす食品の例から外す食品群（菓子・し好飲料・調味料・油脂）
  const NOT_SUGGEST = new Set([14, 15, 16, 17]);

  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (v, d = 0) => (v == null || isNaN(v) ? "-" : Number(v).toLocaleString("ja-JP", { maximumFractionDigits: d, minimumFractionDigits: 0 }));
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); return ymd(new Date(y, m - 1, d + n)); };
  const dayLabel = (s) => { const [y, m, d] = s.split("-").map(Number); const w = "日月火水木金土"[new Date(y, m - 1, d).getDay()]; return `${m}月${d}日（${w}）`; };

  // ---- 保存 ----
  let saveOk = true;
  const blank = () => ({ v: 1, profile: null, days: {}, custom: [], recent: [], fav: [], weights: {}, moves: {}, steps: {}, sets: [] });
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      const s = JSON.parse(raw);
      return Object.assign(blank(), s && typeof s === "object" ? s : {});
    } catch (e) { saveOk = false; return blank(); }
  }
  let S = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); saveOk = true; } catch (e) { saveOk = false; }
    $("#savewarn").hidden = saveOk;
  }

  // ---- 食品 ----
  let FOODS = new Map();
  let foodsMeta = null;
  const COMMON = window.COMMON.map(([name, id, unit, g, kw]) => ({ name, id, unit, g, kw }));
  const DISHES = window.DISHES.map(([name, unit, parts, kw]) => ({ name, unit, parts, kw }));
  const prettyName = (n) => n.replace(/^＜[^＞]*＞\s*/, "").replace(/\s+/g, " ");
  const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const norm = (s) => toHira(String(s).normalize("NFKC").toLowerCase()).replace(/[\s　［］＜＞（）\[\]<>()・、,]/g, "");

  // 記録1件の栄養（100g あたりの値 × 量）
  function nutOf(e) {
    const out = Object.fromEntries(NKEYS.map((k) => [k, 0]));
    const addFood = (id, g) => { const f = FOODS.get(id); if (!f) return; for (const k of NKEYS) out[k] += ((f[k] || 0) * g) / 100; };
    const [t, ref] = splitKey(e.key);
    if (t === "f") addFood(ref, e.amt);
    else if (t === "d") { const d = DISHES.find((x) => x.name === ref); if (d) for (const [id, g] of d.parts) addFood(id, g * e.amt); }
    else if (t === "c") { const c = S.custom.find((x) => x.id === ref); if (c) for (const k of NKEYS) out[k] += (c.n[k] || 0) * e.amt; }
    else if (t === "x" && e.n) for (const k of NKEYS) out[k] += e.n[k] || 0;   // 写真から：成分表に当たらなかった品（Claude の見積もり）
    return out;
  }
  const splitKey = (key) => { const i = key.indexOf(":"); return [key.slice(0, i), key.slice(i + 1)]; };
  function nameOf(key, label) {
    if (label) return label;
    const [t, ref] = splitKey(key);
    if (t === "f") { const c = COMMON.find((x) => x.id === ref); if (c) return c.name; const f = FOODS.get(ref); return f ? prettyName(f.name) : "（見つからない食品）"; }
    if (t === "d") return ref;
    const c = S.custom.find((x) => x.id === ref); return c ? c.name : "（消した食品）";
  }
  function amtText(e) {
    const [t] = splitKey(e.key);
    if (t === "f") return `${fmt(e.amt, 0)}g`;
    if (t === "x") return e.g ? `${fmt(e.g)}g（見積もり）` : "見積もり";
    const d = t === "d" ? DISHES.find((x) => x.name === splitKey(e.key)[1]) : S.custom.find((x) => x.id === splitKey(e.key)[1]);
    const unit = d ? d.unit : "1食";
    return e.amt === 1 ? unit : `${unit}×${fmt(e.amt, 2)}`;
  }
  function sum(entries) {
    const t = Object.fromEntries(NKEYS.map((k) => [k, 0]));
    for (const e of entries) { const n = nutOf(e); for (const k of NKEYS) t[k] += n[k]; }
    return t;
  }

  // ---- 1日の目安（食事摂取基準 2025年版） ----
  function ageId(age) { return (window.DRI.ages.find((a) => age >= a.min && age <= a.max) || {}).id; }
  // いまの体重（記録の最後の値。無ければ設定の体重）
  function weightNow(upto) {
    const ds = Object.keys(S.weights || {}).filter((d) => !upto || d <= upto).sort();
    return ds.length ? S.weights[ds[ds.length - 1]] : S.profile && S.profile.weight;
  }
  const bmiOf = (w, h) => (w && h ? w / ((h / 100) ** 2) : null);
  // 1日の目安。体重と身長があれば「基礎代謝基準値 × 体重 × 身体活動レベル」（BMI 25 をこえる分の体重は入れない：
  // 基礎代謝基準値は肥満の人では多めに出るため）。無ければ参照体位の推定エネルギー必要量の表。
  // 減量を選んだ人は、目標（DIET.paces）の分だけ減らす。ただし基礎代謝より下げない。
  function targets(p, wNow, extra = 0) {
    const D = window.DRI, a = ageId(p.age), s = p.sex === "m" ? 0 : 1;
    let act = Number(p.act);
    if (D.eer[a][s][act] == null) act = 1;
    const w = wNow || p.weight, h = p.height;
    let E, bmr = null, wEff = null;
    if (w && h) {
      wEff = Math.min(w, 25 * (h / 100) ** 2);
      bmr = D.bmrStd[a][s] * wEff;
      E = Math.round(bmr * D.pal[a][act] / 10) * 10;
    } else E = D.eer[a][s][act];
    const keep = E;
    let diet = null;
    const bmi = bmiOf(w, h);
    if (p.goal === "lose" && w && h) {
      const pace = window.DIET.paces.find((x) => x.id === p.pace) || window.DIET.paces[1];
      if (bmi < window.DIET.minBmi) diet = { blocked: "low" };
      else if (pace.minBmi && bmi < pace.minBmi) diet = { blocked: "pace" };
      else {
        const kg = (w * pace.pct) / 100, cut = Math.round((kg * window.DIET.kcalPerKg) / pace.days / 10) * 10;
        const floor = Math.ceil(bmr / 10) * 10;
        E = Math.max(keep - cut, floor);
        diet = { pace, kg, cut: keep - E, floored: keep - cut < floor, goalW: Math.round((w - kg) * 10) / 10 };
      }
    }
    E += extra;   // 運動で使った分（安静時を引いた分）を足す
    const T = {};
    T._extra = extra;
    T._keep = keep; T._diet = diet; T._bmi = bmi; T._bmr = bmr;
    T.kcal = { lo: E * 0.9, hi: E * 1.1, goal: E };
    const pMin = Math.max(D.protRda[a][s], (E * D.protMinPct[a]) / 100 / 4);
    T.prot = { lo: pMin, hi: (E * 0.2) / 4 };
    T.fat = { lo: (E * D.fatPct[0]) / 100 / 9, hi: (E * D.fatPct[1]) / 100 / 9 };
    T.carb = { lo: (E * D.carbPct[0]) / 100 / 4, hi: (E * D.carbPct[1]) / 100 / 4 };
    T.fib = { lo: D.fib[a][s] };
    T.salt = { hi: D.salt[s] };
    T.k = { lo: D.k[s] };
    T.ca = { lo: D.ca[a][s] };
    const fe = D.fe[a][s === 0 ? 0 : p.menses && D.fe[a][2] != null ? 2 : 1];
    T.fe = { lo: fe };
    T.vita = { lo: D.vita[a][s] };
    T.vitb1 = { lo: D.vitb1[a][s] };
    T.vitb2 = { lo: D.vitb2[a][s] };
    T.vitc = { lo: D.vitc[s] };
    T.vitd = { lo: D.vitd[s] };
    T._E = E; T._actUsed = act;
    return T;
  }
  // 目安に対する状態：ok・low・high
  function status(n, v, t) {
    if (n.type === "max") return v < t.hi ? "ok" : "high";
    if (n.type === "min") return v >= t.lo ? "ok" : "low";
    return v < t.lo ? "low" : v > t.hi ? "high" : "ok";
  }
  function targetText(n, t) {
    if (n.type === "max") return `${fmt(t.hi, n.d)}${n.unit} 未満`;
    if (n.type === "min") return `${fmt(t.lo, n.d)}${n.unit} 以上`;
    if (n.k === "kcal") return `${fmt(t.goal, 0)}kcal 前後`;
    return `${fmt(t.lo, 0)}〜${fmt(t.hi, 0)}${n.unit}`;
  }

  // ---- アドバイス（責めない言い方。極端な制限はすすめない） ----
  function perPortion(c, k) { const f = FOODS.get(c.id); return f ? ((f[k] || 0) * c.g) / 100 : 0; }
  function suggestFoods(k, n = 3) {
    return COMMON.filter((c) => { const f = FOODS.get(c.id); return f && !NOT_SUGGEST.has(f.g); })
      .map((c) => ({ c, v: perPortion(c, k), kcal: perPortion(c, "kcal") }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v / Math.max(b.kcal, 20) - a.v / Math.max(a.kcal, 20))
      .slice(0, n);
  }
  function advise(tot, T, entries, isPast) {
    const out = [];
    if (!entries.length) return [{ kind: "info", text: "食べたものを記録すると、ここにひとことが出ます。まずは1食だけでも大丈夫です。" }];
    const meals = new Set(entries.map((e) => e.meal));
    const partial = !isPast && meals.size < 3;
    const good = NUTS.filter((n) => n.k !== "kcal" && status(n, tot[n.k], T[n.k]) === "ok" && tot[n.k] > 0).map((n) => n.label);
    if (good.length) out.push({ kind: "good", text: `${good.slice(0, 4).join("・")}は目安に届いています。いい調子です。` });
    const lows = NUTS.filter((n) => (n.type === "min" || (n.type === "range" && n.k !== "kcal" && n.k !== "carb" && n.k !== "fat")) && status(n, tot[n.k], T[n.k]) === "low")
      .map((n) => ({ n, r: tot[n.k] / T[n.k].lo })).sort((a, b) => a.r - b.r);
    for (const { n, r } of lows.slice(0, partial ? 2 : 3)) {
      const ex = suggestFoods(n.k).map((x) => `${x.c.name}（${x.c.unit}で${fmt(x.v, n.d)}${n.unit}）`);
      const head = partial ? `${n.label}は今のところ目安の${Math.round(r * 100)}%です。` : `${n.label}が目安の${Math.round(r * 100)}%でした。`;
      out.push({ kind: "tip", text: `${head}${ex.length ? "たとえば " + ex.join("、") + " で増やせます。" : ""}` });
    }
    if (status(NUTS[5], tot.salt, T.salt) === "high") {
      out.push({ kind: "tip", text: `食塩が目安（${fmt(T.salt.hi, 1)}g未満）をこえています。汁物の汁を半分残す・しょうゆはかけずにつける・野菜や果物でカリウムをとる、が手軽です。` });
    }
    if (tot.kcal > 0 && (tot.fat * 9) / tot.kcal > 0.3 && !partial) {
      out.push({ kind: "tip", text: "脂質の割合が高めです。揚げ物を焼く・蒸す料理にかえると、ほかの栄養はそのままで減らせます。" });
    }
    if (!partial) {
      const r = tot.kcal / T._E;
      if (r < 0.7) out.push({ kind: "info", text: "エネルギーが目安よりかなり少なめでした。食べる量を減らしすぎると体調をくずしやすいので、主食（ごはん・パン・めん）も食べましょう。" });
      else if (r > 1.2) out.push({ kind: "info", text: "エネルギーが目安より多めの日でした。1日で決めず、1週間の平均で見れば大丈夫です。" });
    }
    return out;
  }

  // ---- 画面 ----
  let day = ymd(new Date());
  let view = "today";
  const entriesOf = (d) => (S.days[d] || []);

  function render() {
    for (const b of document.querySelectorAll("nav.tabs button")) b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false");
    for (const s of document.querySelectorAll("main > section")) s.hidden = s.id !== "v-" + view;
    if (!S.profile && view !== "about") { view = "settings"; renderSettings(true); for (const s of document.querySelectorAll("main > section")) s.hidden = s.id !== "v-settings"; return; }
    if (view === "today") renderToday();
    else if (view === "week") renderWeek();
    else if (view === "settings") renderSettings(false);
    else if (view === "about") renderAbout();
  }

  function bar(n, v, t) {
    const st = status(n, v, t);
    const ref = n.type === "max" ? t.hi : n.k === "kcal" ? t.goal : t.lo;
    const pct = ref ? Math.min(150, (v / ref) * 100) : 0;
    const word = st === "ok" ? "目安どおり" : st === "low" ? "少なめ" : "多め";
    return `<div class="nut ${st}" data-k="${n.k}">
      <div class="nut-h"><span class="nut-l">${n.label}</span><span class="nut-v">${fmt(v, n.d)}${n.unit}</span></div>
      <div class="meter" role="img" aria-label="${n.label} ${fmt(v, n.d)}${n.unit}、目安は${targetText(n, t)}、${word}"><i style="width:${(pct / 150) * 100}%"></i><b style="left:${(100 / 150) * 100}%"></b></div>
      <div class="nut-t">目安 ${targetText(n, t)}<span class="badge">${word}</span></div></div>`;
  }

  // 運動：消費エネルギー = (メッツ − 1) × 時間 × 体重（安静にしていても使う 1 メッツ分を引く。重ねて数えないため）
  function bodyW(d) { const D = window.DRI; const a = ageId(S.profile.age); return weightNow(d) || D.refWeight[a][S.profile.sex === "m" ? 0 : 1]; }
  function moveKcal(m, w) { const x = window.EXERCISES.find((e) => e.id === m.id); return x ? Math.round((x.mets - 1) * (m.min / 60) * w) : 0; }
  function exerciseKcal(d) { const w = bodyW(d); return ((S.moves || {})[d] || []).reduce((t, m) => t + moveKcal(m, w), 0); }
  function renderMoves(T) {
    const list = (S.moves[day] || []), w = bodyW(day);
    $("#movelist").innerHTML = list.map((m, i) => { const x = window.EXERCISES.find((e) => e.id === m.id); return `<li><span class="fn">${esc(x ? x.label : "（運動）")} ${fmt(m.min)}分</span><span class="fa">${fmt(moveKcal(m, w))}kcal</span><button class="delmove" data-i="${i}" aria-label="${esc(x ? x.label : "運動")}を消す">×</button></li>`; }).join("");
    $("#movetotal").textContent = T._extra ? `運動で ${fmt(T._extra)}kcal 使ったので、きょうの目安に足しています。` : "";
    const st = S.steps[day];
    $("#steps").value = st || "";
    $("#stepsinfo").textContent = st ? (st >= 8000 ? `${fmt(st)}歩。1日 8,000歩の目安に届いています。` : `${fmt(st)}歩。1日 8,000歩の目安まであと ${fmt(8000 - st)}歩。`) : "";
  }

  // 目安までの残りを輪で見せる（こえても赤くしない。責めない言い方）
  function ring(v, E) {
    const r = 52, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, v / E)), left = Math.round(E - v);
    return `<div class="ring" role="img" aria-label="目安 ${fmt(E)}kcal のうち ${fmt(v)}kcal。${left >= 0 ? `あと ${fmt(left)}kcal` : `目安より ${fmt(-left)}kcal 多い`}">
      <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="${r}" class="ring-bg"/><circle cx="60" cy="60" r="${r}" class="ring-fg${left < 0 ? " over" : ""}" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 60 60)"/></svg>
      <div class="ring-t"><small>${left >= 0 ? "あと" : "目安より"}</small><b>${fmt(Math.abs(left))}</b><small>${left >= 0 ? "kcal" : "kcal 多め"}</small></div></div>`;
  }

  function renderToday() {
    const T = targets(S.profile, weightNow(day), exerciseKcal(day));
    const es = entriesOf(day);
    const tot = sum(es);
    const isPast = day < ymd(new Date());
    $("#daylabel").textContent = dayLabel(day) + (day === ymd(new Date()) ? " きょう" : "");
    $("#next").disabled = day >= ymd(new Date());
    const E = T._E, pfcK = tot.prot * 4 + tot.fat * 9 + tot.carb * 4;
    const pfc = pfcK ? [tot.prot * 4, tot.fat * 9, tot.carb * 4].map((x) => Math.round((x / pfcK) * 100)) : [0, 0, 0];
    $("#summary").innerHTML = `
      <div class="ring-row">
        ${ring(tot.kcal, E)}
        <dl class="kcalsum">
          <div><dt>食べた</dt><dd><span id="kcal">${fmt(tot.kcal)}</span>kcal</dd></div>
          <div><dt>${T._diet && !T._diet.blocked ? "減量の目安" : "目安"}</dt><dd>${fmt(E)}kcal</dd></div>
          ${T._extra ? `<div><dt>うち運動</dt><dd>＋${fmt(T._extra)}kcal</dd></div>` : ""}
        </dl>
      </div>
      <div class="pfc" aria-label="エネルギーのうちわけ">
        <span class="p">たんぱく質 ${pfc[0]}%</span><span class="f">脂質 ${pfc[1]}%</span><span class="c">炭水化物 ${pfc[2]}%</span>
      </div>
      <div class="pfcbar" aria-hidden="true"><i class="p" style="width:${pfc[0]}%"></i><i class="f" style="width:${pfc[1]}%"></i><i class="c" style="width:${pfc[2]}%"></i></div>
      <p class="hint pfcnote">目安 たんぱく質 ${Math.round((T.prot.lo * 4 / E) * 100)}〜20%・脂質 20〜30%・炭水化物 50〜65%</p>`;
    $("#firsthelp").hidden = !!S.helped || Object.values(S.days).some((d) => d.length);
    renderDiet(T);
    renderMoves(T);
    renderSuggest(T, tot, es);
    $("#meals").innerHTML = MEALS.map(([m, label]) => {
      const list = es.map((e, i) => ({ e, i })).filter((x) => x.e.meal === m);
      const mk = sum(list.map((x) => x.e)).kcal;
      return `<div class="meal" data-meal="${m}"><div class="meal-h"><h3><span class="mi" aria-hidden="true">${{ b: "🌅", l: "☀️", d: "🌙", s: "🍪" }[m] || ""}</span>${label}</h3><span>${fmt(mk)}kcal</span></div>
        <ul>${list.map(({ e, i }) => `<li><button class="edit" data-i="${i}" aria-label="${esc(nameOf(e.key, e.label))}の量を直す"><span class="fn">${esc(nameOf(e.key, e.label))}</span><span class="fa">${esc(amtText(e))}・${fmt(nutOf(e).kcal)}kcal</span></button>
          <button class="del" data-i="${i}" aria-label="${esc(nameOf(e.key, e.label))}を消す">×</button></li>`).join("")}</ul>
        ${quickRow(m, list.map((x) => x.e.key))}
        ${list.filter((x) => !x.e.key.startsWith("x:")).length >= 2 && !setOf(m, list.map((x) => x.e).filter((e) => !e.key.startsWith("x:"))) ? `<button class="mkset" data-meal="${m}">＋ この${label}をセットに保存（次から1回で入る）</button>` : ""}
        ${!list.length && lastMeal(m) ? `<button class="copy" data-meal="${m}">↺ ${esc(dayShort(lastMeal(m)))}の${label}と同じ（${fmt(sum(entriesOf(lastMeal(m)).filter((e) => e.meal === m)).kcal)}kcal）</button>` : ""}
        <div class="addrow"><button class="add" data-meal="${m}">＋ ${label}をたす</button><button class="roughbtn" data-meal="${m}" aria-label="${label}をざっくり記録">⚡ ざっくり</button></div></div>`;
    }).join("");
    const adv = advise(tot, T, es, isPast);
    // ひとことは2つまで見せ、残りは「ほかに○件」で開く（長い画面を短くする）
    $("#advice").innerHTML = adv.map((a, i) => `<li class="${a.kind}${i >= 2 ? " more" : ""}">${esc(a.text)}</li>`).join("")
      + (adv.length > 2 ? `<li class="moreli"><button class="morebtn" type="button" aria-expanded="false">ほかに ${adv.length - 2} 件</button></li>` : "");
    const met = NUTS.filter((n) => status(n, tot[n.k], T[n.k]) === "ok").length;
    $("#metcount").textContent = es.length ? `目安どおりの項目 ${met} / ${NUTS.length}` : "";
    // 主な5つ（たんぱく質・脂質・炭水化物・食物繊維・食塩）を先に。エネルギーは上の輪で見るので、ビタミン・ミネラルと一緒にたたむ
    const MAIN = ["prot", "fat", "carb", "fib", "salt"];
    const rest = NUTS.filter((n) => !MAIN.includes(n.k));
    const restLow = rest.filter((n) => n.k !== "kcal" && status(n, tot[n.k], T[n.k]) !== "ok").length;
    const roughN = es.filter((e) => e.rough).length;
    $("#roughnote").hidden = !roughN;
    $("#nuts").innerHTML = MAIN.map((k) => NUTS.find((n) => n.k === k)).map((n) => bar(n, tot[n.k], T[n.k])).join("")
      + `<details class="nutmore"><summary>ほかの ${rest.length} 項目${es.length ? `（目安の外 ${restLow}）` : ""}</summary>${rest.map((n) => bar(n, tot[n.k], T[n.k])).join("")}</details>`;
  }

  // 同じ食事を前に食べた日（7日前まで）。毎朝同じ・作り置きを1回で入れるため
  function lastMeal(m) {
    for (let i = 1; i <= 7; i++) { const d = addDays(day, -i); if (entriesOf(d).some((e) => e.meal === m)) return d; }
    return null;
  }
  const dayShort = (d) => (d === addDays(day, -1) ? "前の日" : dayLabel(d).replace(/（.）$/, ""));
  // ---- 手入力を減らす（2026-11-23 satou さん「ほとんど手動入力になる」）----
  // 記録の手間が続かない一番の理由（Cordeiro ら CHI 2015）なので、よく食べるものはワンタップ・組み合わせは1回で入れる。
  // いつもの：この食事（朝・昼など）で30日のうちによく入れた品。量は前に入れた量。
  function usualFor(m, have) {
    const cnt = new Map();
    for (let i = 1; i <= 30; i++) {
      for (const e of entriesOf(addDays(day, -i))) {
        if (e.meal !== m || e.key.startsWith("x:")) continue;
        const c = cnt.get(e.key) || { n: 0, amt: e.amt, label: e.label };
        c.n++; cnt.set(e.key, c);
      }
    }
    return [...cnt].filter(([k, c]) => c.n >= 2 && !have.includes(k) && itemOf(k)).sort((a, b) => b[1].n - a[1].n).slice(0, 4);
  }
  const setKey = (items) => items.map((e) => e.key).sort().join("|");
  function setOf(m, items) { const k = setKey(items); return (S.sets || []).find((x) => setKey(x.items) === k); }
  function quickRow(m, have) {
    const sets = (S.sets || []).filter((x) => x.meal === m || !x.meal);
    const us = usualFor(m, have);
    if (!sets.length && !us.length) return "";
    return `<div class="quick" aria-label="ワンタップで入れる">${sets.map((x) => `<button class="chip set" data-set="${esc(x.id)}" data-meal="${m}">📦 ${esc(x.name)}<small>${fmt(sum(x.items).kcal)}kcal</small></button>`).join("")}
      ${us.map(([k, c]) => `<button class="chip" data-key="${esc(k)}" data-amt="${c.amt}" data-meal="${m}">＋ ${esc(nameOf(k, c.label))}<small>${esc(amtText({ key: k, amt: c.amt }))}</small></button>`).join("")}</div>`;
  }
  function addQuick(b) {
    const es = (S.days[day] = S.days[day] || []);
    if (b.dataset.set) {
      const x = (S.sets || []).find((y) => y.id === b.dataset.set); if (!x) return;
      es.push(...x.items.map((e) => ({ key: e.key, amt: e.amt, meal: b.dataset.meal, ...(e.label ? { label: e.label } : {}) })));
      save(); render(); toast(`セット「${x.name}」の ${x.items.length} 品を入れました`); return;
    }
    es.push({ key: b.dataset.key, amt: Number(b.dataset.amt), meal: b.dataset.meal });
    save(); render(); toast(`${nameOf(b.dataset.key)}を入れました。量は品をおすと直せます`);
  }
  function makeSet(m) {
    const items = entriesOf(day).filter((e) => e.meal === m && !e.key.startsWith("x:")).map((e) => ({ key: e.key, amt: e.amt, ...(e.label ? { label: e.label } : {}) }));
    if (items.length < 2) return;
    const name = items.slice(0, 3).map((e) => nameOf(e.key, e.label).replace(/（.*?）/g, "")).join("・") + (items.length > 3 ? "ほか" : "");
    S.sets = (S.sets || []).concat({ id: "s" + Date.now().toString(36), name, meal: m, items }).slice(-20);
    save(); render(); toast(`セット「${name}」を保存しました。次からこの食事の上に出ます`);
  }

  // ざっくり記録（2026-11-23 satou さんがカードで選択）：品を選ばず「種類」と「量」の2回のタップで1食を入れる。
  // 細かい記録と減量の効果が同じくらいだった小さな研究（JMIR Formative Research 2022）にならい、忙しい日でも続けられるように。
  // 値は種類ごとに代表の料理（成分表の組み合わせ）を当て、軽め×0.7・ふつう×1・多め×1.3。
  const ROUGH = [
    ["定食", "d:生姜焼き定食", 1], ["丼もの", "d:親子丼", 1], ["カレー", "d:カレーライス", 1], ["うどん・そば", "d:きつねうどん", 1],
    ["ラーメン", "d:ラーメン（しょうゆ）", 1], ["パスタ", "d:ミートソーススパゲッティ", 1], ["パン・サンド", "d:サンドイッチ（ハム・卵）", 1],
    ["おにぎり2個", "d:鮭おにぎり", 2], ["ハンバーガー", "d:ハンバーガー", 1], ["お菓子", "f:15103", 30], ["菓子パン・ケーキ", "f:15069", 90],
  ];
  const ROUGH_SIZE = [["軽め", 0.7], ["ふつう", 1], ["多め", 1.3]];
  let roughMeal = "b", roughSize = 1;
  function openRough(m) {
    roughMeal = m; roughSize = 1;
    $("#roughtitle").textContent = `${MEALS.find((x) => x[0] === m)[1]}をざっくり記録`;
    renderRough();
    $("#roughdlg").showModal ? $("#roughdlg").showModal() : $("#roughdlg").setAttribute("open", "");
  }
  function renderRough() {
    $("#roughsize").innerHTML = ROUGH_SIZE.map(([l], i) => `<button type="button" data-size="${i}" aria-pressed="${i === roughSize}">${l}</button>`).join("");
    const mul = ROUGH_SIZE[roughSize][1];
    $("#roughtypes").innerHTML = ROUGH.map(([l, k, a], i) => `<button type="button" data-type="${i}"><b>${esc(l)}</b><small>約 ${fmt(Math.round(nutOf({ key: k, amt: a * mul }).kcal / 10) * 10)}kcal</small></button>`).join("");
  }
  function addRough(i) {
    const [l, k, a] = ROUGH[i], [sl, mul] = ROUGH_SIZE[roughSize];
    (S.days[day] = S.days[day] || []).push({ key: k, amt: Math.round(a * mul * 100) / 100, meal: roughMeal, label: `ざっくり：${l}（${sl}）`, rough: 1 });
    save(); $("#roughdlg").close ? $("#roughdlg").close() : $("#roughdlg").removeAttribute("open"); render();
    toast(`${l}（${sl}）を入れました。あとで品をおすと量を直せます`);
  }

  function copyMeal(m) {
    const from = lastMeal(m); if (!from) return;
    const add = entriesOf(from).filter((e) => e.meal === m).map((e) => JSON.parse(JSON.stringify(e)));
    (S.days[day] = S.days[day] || []).push(...add);
    save(); render(); toast(`${add.length} 品を入れました。ちがう品は × で消せます`);
  }

  // 減量の目標と体重
  function renderDiet(T) {
    const d = T._diet, w = S.weights[day];
    $("#wt").value = w || "";
    let html = "";
    if (S.profile.goal === "lose") {
      if (!d) html = "減量の目標を出すには、設定で身長と体重を入れてください。";
      else if (d.blocked === "low") html = "BMI が 18.5 未満（低体重）なので、減量の目標は出しません。体重を保つ目安を出しています。";
      else if (d.blocked === "pace") html = "「早め」は BMI 25 以上の人向けです。設定で「ふつう」か「ゆっくり」を選んでください。いまは体重を保つ目安です。";
      else {
        html = `<b>減量の目安：1日 ${fmt(T._E - T._extra)}kcal</b>（目標 ${fmt(d.goalW, 1)}kg）<br><small>体重を保つ量 ${fmt(T._keep)}kcal より ${fmt(d.cut)}kcal 少なく（${esc(d.pace.label)}）。${T._extra ? `運動の ${fmt(T._extra)}kcal を足して、きょうは ${fmt(T._E)}kcal。` : ""}`;
        if (d.floored) html += "基礎代謝より下げないよう、減らす量をおさえています。";
        const ds = Object.keys(S.weights).sort();
        if (ds.length >= 2) { const diff = S.weights[ds[ds.length - 1]] - S.weights[ds[0]]; html += ` 記録の最初から ${diff <= 0 ? "−" : "＋"}${Math.abs(diff).toFixed(1)}kg。`; }
        html += "</small>";
      }
    }
    $("#dietline").innerHTML = html;
    $("#dietline").hidden = !html;
  }

  // 次の食事の提案：残りのエネルギーにおさまり、足りない栄養素を多くおぎなう献立を選ぶ
  function nextMeal(es) {
    const has = new Set(es.map((e) => e.meal));
    const h = new Date().getHours();
    const order = day < ymd(new Date()) ? ["b", "l", "d"] : h < 10 ? ["b", "l", "d"] : h < 15 ? ["l", "d"] : ["d"];
    return order.find((m) => !has.has(m)) || null;
  }
  function menuNut(m) { return sum(m.items.map(([key, amt]) => ({ key, amt }))); }
  function rankMenus(T, tot, meal, shop) {
    const left = ["b", "l", "d"].filter((m) => m === meal || !entriesOf(day).some((e) => e.meal === m) && "bld".indexOf(m) > "bld".indexOf(meal)).length || 1;
    const budget = Math.max(0, T._E - tot.kcal) / left;
    return window.MENUS.filter((m) => m.meal.includes(meal) && !!m.shop === shop).map((m) => {
      const n = menuNut(m);
      let score = 0;
      for (const x of NUTS) {
        if (x.k === "kcal" || x.type === "max") continue;
        const lo = T[x.k].lo; if (!lo) continue;
        score += Math.min(1, (tot[x.k] + n[x.k]) / lo) - Math.min(1, tot[x.k] / lo);
      }
      score -= Math.max(0, n.kcal - budget * 1.15) / 100;   // 予算をこえる分は大きく減点
      score -= Math.max(0, tot.salt + n.salt - T.salt.hi) * 0.5;
      return { m, n, score };
    }).sort((a, b) => b.score - a.score);
  }
  function renderSuggest(T, tot, es) {
    const meal = nextMeal(es);
    const box = $("#suggest");
    if (!meal) { box.hidden = true; return; }
    box.hidden = false;
    const label = MEALS.find((x) => x[0] === meal)[1];
    const left = Math.max(0, T._E - tot.kcal);
    $("#suggesthead").textContent = `${label}のおすすめ（残り ${fmt(left)}kcal）`;
    const card = (r, i, shop) => `<li><div class="mn"><b>${esc(r.m.name)}</b><span>${fmt(r.n.kcal)}kcal・たんぱく質 ${fmt(r.n.prot, 0)}g・食塩 ${fmt(r.n.salt, 1)}g</span>
      <small>${r.m.items.map(([k, a, l]) => esc(l || nameOf(k))).join("・")}</small></div>
      <button class="usemenu" data-name="${esc(r.m.name)}" data-meal="${meal}">この献立を記録</button></li>`;
    $("#suggestlist").innerHTML = rankMenus(T, tot, meal, false).slice(0, 3).map((r, i) => card(r, i)).join("");
    $("#shoplist").innerHTML = rankMenus(T, tot, meal, true).slice(0, 2).map((r, i) => card(r, i, true)).join("") || `<li class="empty">この時間の組み合わせはまだありません。</li>`;
  }
  function useMenu(name, meal) {
    const m = window.MENUS.find((x) => x.name === name); if (!m) return;
    const list = (S.days[day] = S.days[day] || []);
    for (const [key, amt, label] of m.items) list.push(label ? { key, amt, meal, label } : { key, amt, meal });
    save(); render(); toast(`「${m.name}」を記録しました。量がちがうところは消して入れ直せます`);
  }

  // 近くのお店（押したときだけ位置を使い、OpenStreetMap のデータを Overpass API で探す。位置は約100m に丸めて送る）
  const OVERPASS = "https://overpass-api.de/api/interpreter";
  function distM(a, b, c, d) { const R = 6371000, r = Math.PI / 180; const x = (d - b) * r * Math.cos(((a + c) / 2) * r), y = (c - a) * r; return Math.round(Math.sqrt(x * x + y * y) * R); }
  async function findShops() {
    const out = $("#shops");
    if (!navigator.geolocation) { out.innerHTML = `<li class="empty">この端末では位置を使えません。</li>`; return; }
    out.innerHTML = `<li class="empty">位置を確かめています…</li>`;
    let pos;
    try { pos = await new Promise((ok, ng) => navigator.geolocation.getCurrentPosition(ok, ng, { timeout: 15000, maximumAge: 300000 })); }
    catch (e) { out.innerHTML = `<li class="empty">位置を使えませんでした（許可されていないか、電波が届かない）。</li>`; return; }
    const lat = Math.round(pos.coords.latitude * 1000) / 1000, lon = Math.round(pos.coords.longitude * 1000) / 1000;
    out.innerHTML = `<li class="empty">近くのお店を探しています…</li>`;
    const q = `[out:json][timeout:20];nwr(around:800,${lat},${lon})[shop~"^(convenience|supermarket)$"];out center 40;`;
    try {
      const r = await fetch(OVERPASS, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      const shops = (j.elements || []).map((e) => {
        const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon, t = e.tags || {};
        return { name: t.name || t.brand || (t.shop === "supermarket" ? "スーパー" : "コンビニ"), kind: t.shop, d: distM(lat, lon, la, lo) };
      }).filter((x) => isFinite(x.d)).sort((a, b) => a.d - b.d).slice(0, 8);
      if (!shops.length) { out.innerHTML = `<li class="empty">800m 以内にコンビニ・スーパーが見つかりませんでした（地図のデータに無いこともあります）。</li>`; return; }
      out.innerHTML = shops.map((x) => `<li><b>${esc(x.name)}</b> <span>${x.kind === "supermarket" ? "スーパー" : "コンビニ"}・約${fmt(x.d)}m</span>
        <small>${x.kind === "supermarket" ? SHOP_TIPS.supermarket : SHOP_TIPS.convenience}</small></li>`).join("");
    } catch (e) { out.innerHTML = `<li class="empty">お店を探せませんでした。時間をおいてもう一度押してください。</li>`; }
  }
  const SHOP_TIPS = {
    convenience: "選び方：主食（おにぎり・そば）＋たんぱく質（サラダチキン・ゆで卵・豆腐）＋野菜（サラダ・おひたし）。揚げ物と菓子パンは控えめに。袋の栄養成分表示を見て、食塩は1食 2〜2.5g までが目安。",
    supermarket: "選び方：お惣菜なら焼き魚・冷奴・おひたし・サラダ。主食は小さめのおにぎりか、ごはんのパック。揚げ物は1品まで。",
  };

  function renderWeek() {
    const T = targets(S.profile, weightNow(day));
    const end = day, days = [];
    for (let i = 6; i >= 0; i--) days.push(addDays(end, -i));
    const tots = days.map((d) => ({ d, n: entriesOf(d).length, t: sum(entriesOf(d)) }));
    const logged = tots.filter((x) => x.n);
    const max = Math.max(T._E * 1.3, ...tots.map((x) => x.t.kcal));
    $("#weekchart").innerHTML = `<div class="bars">${tots.map((x) => `<div class="col" title="${dayLabel(x.d)} ${fmt(x.t.kcal)}kcal"><span class="v">${x.n ? fmt(x.t.kcal) : ""}</span><i style="height:${(x.t.kcal / max) * 85}%"></i></div>`).join("")}
      <b class="line" style="bottom:${(T._E / max) * 85}%"><span>目安 ${fmt(T._E)}</span></b></div>
      <div class="labels">${tots.map((x) => { const [, m, dd] = x.d.split("-").map(Number); return `<span>${m}/${dd}</span>`; }).join("")}</div>`;
    $("#weekinfo").textContent = logged.length ? `記録のある ${logged.length} 日の平均です（記録の無い日は入れません）。` : "この7日間はまだ記録がありません。";
    const avg = Object.fromEntries(NKEYS.map((k) => [k, logged.length ? logged.reduce((s, x) => s + x.t[k], 0) / logged.length : 0]));
    $("#weeknuts").innerHTML = NUTS.map((n) => bar(n, avg[n.k], T[n.k])).join("");
    renderWeightChart();
  }

  // 体重の移り変わり（30日）。毎日の上下より、7日の平均の線で見る
  function renderWeightChart() {
    const ds = []; for (let i = 29; i >= 0; i--) ds.push(addDays(day, -i));
    const pts = ds.map((d, i) => [i, S.weights[d]]).filter(([, w]) => w);
    const box = $("#wchart");
    if (pts.length < 2) { box.innerHTML = `<p class="hint">体重を2日以上記録すると、ここに30日の移り変わりが出ます（きょうの画面の「体重」）。</p>`; return; }
    const ws = pts.map(([, w]) => w), lo = Math.floor(Math.min(...ws) - 0.5), hi = Math.ceil(Math.max(...ws) + 0.5);
    const W = 300, H = 120, x = (i) => 8 + (i / 29) * (W - 16), y = (w) => 8 + ((hi - w) / (hi - lo)) * (H - 24);
    const avg = pts.map(([i]) => { const near = pts.filter(([j]) => j <= i && j > i - 7).map(([, w]) => w); return [i, near.reduce((a, b) => a + b, 0) / near.length]; });
    const line = (a) => a.map(([i, w], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(w).toFixed(1)}`).join("");
    const first = pts[0][1], last = pts[pts.length - 1][1], diff = last - first;
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="30日の体重。${fmt(first, 1)}kg から ${fmt(last, 1)}kg">
      <text x="${W - 4}" y="12" text-anchor="end" class="ax">${hi}kg</text><text x="${W - 4}" y="${H - 14}" text-anchor="end" class="ax">${lo}kg</text>
      ${pts.map(([i, w]) => `<circle cx="${x(i).toFixed(1)}" cy="${y(w).toFixed(1)}" r="2.5" class="dot"/>`).join("")}
      <path d="${line(avg)}" class="avg"/></svg>
      <p class="hint">点は記録した日、線は7日の平均。30日で ${diff <= 0 ? "−" : "＋"}${Math.abs(diff).toFixed(1)}kg（${fmt(first, 1)} → ${fmt(last, 1)}kg）。1日の上下は水分で変わるので、線の向きを見てください。</p>`;
  }

  function renderSettings(first) {
    const p = S.profile || { sex: "f", age: 30, act: "1", menses: true };
    $("#firstnote").hidden = !first; $("#saved").textContent = "";
    const f = $("#profile");
    f.sex.value = p.sex; f.age.value = p.age; f.act.value = p.act; f.menses.checked = !!p.menses;
    f.height.value = p.height || ""; f.weight.value = p.weight || ""; f.goal.value = p.goal || "keep"; f.pace.value = p.pace || "std";
    syncMenses();
    $("#datainfo").textContent = `記録のある日：${Object.keys(S.days).filter((d) => S.days[d].length).length}日・自分で足した食品：${S.custom.length}件`;
  }
  function syncMenses() {
    const f = $("#profile");
    $("#mensesrow").hidden = !(f.sex.value === "f" && Number(f.age.value) < 65);
    $("#paceRow").hidden = f.goal.value !== "lose";
    const bmi = bmiOf(Number(f.weight.value), Number(f.height.value));
    $("#bmiinfo").textContent = bmi ? `BMI ${fmt(bmi, 1)}（18.5 未満は低体重、25 以上は肥満の目安：日本肥満学会）` : "";
    $("#losewarn").hidden = !(f.goal.value === "lose" && bmi && bmi < window.DIET.minBmi);
    // 「早め」は BMI 25 以上の人だけ。選べないときは選べなくし、選んでいたら知らせる（だまって体重を保つ目安にしない）
    const fast = window.DIET.paces.find((x) => x.id === "fast");
    const fastNg = !!(fast && fast.minBmi && bmi && bmi < fast.minBmi);
    f.pace.querySelector('option[value="fast"]').disabled = fastNg;
    $("#pacewarn").hidden = !(f.goal.value === "lose" && fastNg && f.pace.value === "fast");
  }

  function renderAbout() {
    $("#srcfoods").textContent = foodsMeta ? `${foodsMeta.source}（${FOODS.size}食品・${foodsMeta.unit}）` : "読み込み中";
  }

  // ---- 食べたものをたす ----
  let addMeal = "b", picked = null, tab = "common", editIdx = -1;
  function openAdd(meal) {
    addMeal = meal; picked = null; editIdx = -1;
    $("#addok").textContent = "記録する";
    $("#addmeal").value = meal;
    $("#q").value = "";
    $("#photobox").hidden = true; $("#aibox").hidden = true; $("#photocode").value = ""; $("#photoprev").innerHTML = ""; $("#photook").hidden = true;
    $("#pick").hidden = true; $("#results").hidden = false; $("#customform").hidden = true;
    $("#adddlg").showModal ? $("#adddlg").showModal() : $("#adddlg").setAttribute("open", "");
    showList();
    setTimeout(() => $("#q").focus(), 0);
  }
  function closeAdd() { $("#adddlg").close ? $("#adddlg").close() : $("#adddlg").removeAttribute("open"); }

  function itemRow(it) {
    const fav = S.fav.includes(it.key);
    return `<li><button class="pickbtn" data-key="${esc(it.key)}"><span class="fn">${esc(it.name)}</span><span class="fa">${esc(it.sub)}</span></button>
      <button class="star" data-key="${esc(it.key)}" aria-pressed="${fav}" aria-label="${esc(it.name)}をお気に入りに">${fav ? "★" : "☆"}</button></li>`;
  }
  function itemOf(key) {
    const [t, ref] = splitKey(key);
    if (t === "f") {
      const c = COMMON.find((x) => x.id === ref), f = FOODS.get(ref);
      if (!f) return null;
      const g = c ? c.g : 100;
      return { key, name: c ? c.name : prettyName(f.name), sub: `${c && c.unit !== g + "g" ? c.unit + " " : ""}${g}g ${fmt((f.kcal * g) / 100)}kcal`, g, unit: c ? c.unit : null };
    }
    if (t === "d") { const d = DISHES.find((x) => x.name === ref); if (!d) return null; return { key, name: d.name, sub: `${d.unit} ${fmt(nutOf({ key, amt: 1 }).kcal)}kcal（目安の配合）`, unit: d.unit }; }
    const c = S.custom.find((x) => x.id === ref); if (!c) return null;
    return { key, name: c.name, sub: `${c.unit} ${fmt(c.n.kcal)}kcal（自分で足した食品）`, unit: c.unit };
  }
  function showList() {
    const q = $("#q").value.trim();
    for (const b of document.querySelectorAll("#addtabs button")) b.setAttribute("aria-pressed", String(b.dataset.tab === tab && !q));
    $("#addtabs").hidden = !!q;
    let items;
    renderBulk(q);
    if (q) items = search(q);
    else if (tab === "recent") items = S.recent.map(itemOf).filter(Boolean);
    else if (tab === "fav") items = S.fav.map(itemOf).filter(Boolean);
    else items = DISHES.map((d) => itemOf("d:" + d.name)).concat(COMMON.map((c) => itemOf("f:" + c.id))).concat(S.custom.map((c) => itemOf("c:" + c.id))).filter(Boolean);
    const empty = q ? "見つかりませんでした。ひらがなや別の言い方でも探せます。無いときは下の「成分表に無いものを足す」から入れられます。"
      : tab === "recent" ? "まだありません。記録すると、ここからすぐ選べます。" : "☆を押した食品がここに出ます。";
    $("#list").innerHTML = items.length ? items.map(itemRow).join("") : `<li class="empty">${empty}</li>`;
  }
  // まとめて入力：「ごはん、納豆、みそ汁」（区切り：、・，+／改行。空白だけで区切って何も見つからないときも）
  let bulk = [];
  function bulkParts(q) {
    let parts = q.split(/[、,，・+＋/／\n]+/).map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) { const sp = q.split(/[\s　]+/).filter(Boolean); if (sp.length >= 2 && !search(q).length) parts = sp; }
    return parts.length >= 2 ? parts.slice(0, 10) : [];
  }
  function renderBulk(q) {
    const parts = q ? bulkParts(q) : [];
    bulk = parts.map((t) => { const m = /^(.*?)[×xX*]?\s*([0-9.]+)\s*(個|杯|枚|本|皿|つ)?$/.exec(t.normalize("NFKC")); const name = m && m[1] ? m[1] : t, mul = m && m[1] ? Number(m[2]) : 1; return { t, hit: search(name)[0] || null, mul: mul > 0 && mul <= 10 ? mul : 1 }; });
    const box = $("#bulk");
    if (!bulk.length) { box.hidden = true; return; }
    box.hidden = false;
    $("#bulklist").innerHTML = bulk.map((b, i) => b.hit ? `<li><label><input type="checkbox" data-i="${i}" checked> <b>${esc(b.hit.name)}</b></label><span>${esc(b.t)} → ${b.hit.key.startsWith("f:") ? `${Math.round((b.hit.g || 100) * b.mul)}g` : `${b.mul}${esc(b.hit.unit || "")}`}・${fmt(nutOf({ key: b.hit.key, amt: b.hit.key.startsWith("f:") ? (b.hit.g || 100) * b.mul : b.mul }).kcal)}kcal</span></li>`
      : `<li class="empty">「${esc(b.t)}」は見つかりませんでした（別の言い方で）</li>`).join("");
    $("#bulkok").hidden = !bulk.some((b) => b.hit);
  }
  function commitBulk() {
    const meal = $("#addmeal").value, es = (S.days[day] = S.days[day] || []);
    let n = 0;
    bulk.forEach((b, i) => {
      const c = $(`#bulklist input[data-i="${i}"]`);
      if (!b.hit || !c || !c.checked) return;
      const amt = b.hit.key.startsWith("f:") ? Math.round((b.hit.g || 100) * b.mul) : b.mul;
      es.push({ key: b.hit.key, amt, meal });
      S.recent = [b.hit.key].concat(S.recent.filter((k) => k !== b.hit.key)).slice(0, 30);
      n++;
    });
    if (!n) return;
    save(); closeAdd(); render(); toast(`${n} 品をまとめて入れました。量は品をおすと直せます`);
  }
  function search(q) {
    const raw = q.normalize("NFKC");
    let alt = raw;
    for (const [a, b] of window.ALIASES) alt = alt.split(a).join(" " + b + " ");
    const toks = (s) => s.split(/[\s　]+/).map(norm).filter(Boolean);
    const t1 = toks(raw), t2 = toks(alt);
    const hit = (hay, ts) => ts.length && ts.every((t) => hay.includes(t));
    const res = [], seen = new Set();
    const push = (key) => { if (seen.has(key)) return; const it = itemOf(key); if (it) { seen.add(key); res.push(it); } };
    const first = [];
    for (const c of S.custom) if (hit(norm(c.name), t1)) first.push([norm(c.name), "c:" + c.id]);
    for (const d of DISHES) if (hit(norm(d.name + d.kw), t1)) first.push([norm(d.name + d.kw), "d:" + d.name]);
    for (const c of COMMON) if (hit(norm(c.name + " " + c.kw), t1) || hit(norm(c.name + " " + c.kw), t2)) first.push([norm(c.name + c.kw), "f:" + c.id]);
    // 名前か探す言葉の先頭が当たるものを前に（「なっとう」で納豆ごはんより納豆を先に）
    first.sort((a, b) => (a[0].startsWith(t1[0]) ? 0 : 1) - (b[0].startsWith(t1[0]) ? 0 : 1) || a[0].length - b[0].length);
    for (const [, k] of first) push(k);
    const scored = [];
    for (const f of FOODS.values()) {
      const h = norm(f.name);
      if (hit(h, t1) || hit(h, t2)) scored.push([h.length + (f.g === 18 ? -5 : 0), f.id]);
    }
    scored.sort((a, b) => a[0] - b[0]);
    for (const [, id] of scored.slice(0, 60)) push("f:" + id);
    return res;
  }
  function pick(key) {
    picked = itemOf(key);
    if (!picked) return;
    const [t] = splitKey(key);
    $("#results").hidden = true; $("#pick").hidden = false;
    $("#pickname").textContent = picked.name;
    const isG = t === "f";
    $("#amtlabel").textContent = isG ? "量（g）" : `量（${picked.unit}がいくつ分）`;
    $("#amt").value = isG ? picked.g : 1;
    $("#amt").step = isG ? "1" : "0.5";
    $("#portions").innerHTML = (isG ? [0.5, 1, 1.5, 2].map((m) => [m, `${picked.unit ? picked.unit + (m === 1 ? "" : "×" + m) : m * 100 + "g"}`, Math.round(picked.g * m)])
      : [0.5, 1, 1.5, 2].map((m) => [m, `×${m}`, m])).map(([, l, v]) => `<button type="button" data-v="${v}">${esc(l)}</button>`).join("");
    previewPick();
  }
  function previewPick() {
    if (!picked) return;
    const amt = Number($("#amt").value) || 0;
    const n = nutOf({ key: picked.key, amt });
    $("#pickinfo").textContent = `${fmt(n.kcal)}kcal・たんぱく質 ${fmt(n.prot, 1)}g・脂質 ${fmt(n.fat, 1)}g・炭水化物 ${fmt(n.carb, 1)}g・食塩 ${fmt(n.salt, 1)}g`;
  }
  // 記録した品をおして、量・食事を直す（消して入れ直さなくてよいように）
  function openEdit(i) {
    const e = entriesOf(day)[i];
    if (!e) return;
    const [t] = splitKey(e.key);
    if (t === "x") { toast("写真の見積もりの品は量を直せません。消して入れ直してください"); return; }
    openAdd(e.meal);
    pick(e.key);
    if (!picked) { closeAdd(); return; }
    editIdx = i;
    $("#amt").value = e.amt;
    $("#addok").textContent = "直す";
    previewPick();
  }
  function commitPick() {
    const amt = Number($("#amt").value);
    if (!picked || !(amt > 0) || amt > 5000) { $("#amt").focus(); return; }
    const es = (S.days[day] = S.days[day] || []);
    if (editIdx >= 0 && es[editIdx] && es[editIdx].key === picked.key) {
      Object.assign(es[editIdx], { amt, meal: $("#addmeal").value });
      editIdx = -1; save(); closeAdd(); render(); toast(`${picked.name}の量を直しました`); return;
    }
    es.push({ key: picked.key, amt, meal: $("#addmeal").value });
    S.recent = [picked.key].concat(S.recent.filter((k) => k !== picked.key)).slice(0, 30);
    save(); closeAdd(); render();
    toast(`${picked.name}を記録しました`);
  }
  function commitCustom(ev) {
    ev.preventDefault();
    const f = $("#customform");
    const name = f.cname.value.trim();
    if (!name) { f.cname.focus(); return; }
    const n = Object.fromEntries(NKEYS.map((k) => [k, 0]));
    for (const k of ["kcal", "prot", "fat", "carb", "salt"]) n[k] = Math.max(0, Number(f["c" + k].value) || 0);
    const c = { id: "u" + Date.now().toString(36), name, unit: f.cunit.value.trim() || "1食", n };
    S.custom.push(c);
    save();
    f.reset();
    pick("c:" + c.id);
    $("#customform").hidden = true;
  }

  // ---- 写真から（Claude に写真を送り、返ってきた「たべたメモ:」の1行を貼る） ----
  const PHOTO_PROMPT = "この写真の食事を品目ごとに分けて、日本食品標準成分表の食品名に近い言い方（例：ごはん、納豆、鶏のから揚げ、キャベツ）で、食べた量の重さ（g）を見積もってください。それぞれのエネルギー（kcal）・たんぱく質・脂質・炭水化物・食塩相当量（g）の見積もりも付けて、答えは次の形の1行だけにしてください。\nたべたメモ:[{\"name\":\"ごはん\",\"g\":150,\"kcal\":234,\"p\":3.8,\"f\":0.5,\"c\":55.7,\"salt\":0}]";
  function parsePhotoCode(text) {
    const i = text.indexOf("たべたメモ:");
    if (i < 0) return null;
    const rest = text.slice(i + 6).trim();
    const end = rest.lastIndexOf("]");
    if (!rest.startsWith("[") || end < 0) return null;
    let arr;
    try { arr = JSON.parse(rest.slice(0, end + 1)); } catch (e) { return null; }
    if (!Array.isArray(arr)) return null;
    return arr.filter((x) => x && typeof x.name === "string" && x.name.trim()).slice(0, 20).map((x) => {
      const g = Math.max(0, Math.min(2000, Number(x.g) || 0));
      const hit = search(x.name.trim()).find((it) => it.key.startsWith("f:") || it.key.startsWith("d:"));
      const num = (v) => Math.max(0, Math.min(5000, Number(v) || 0));
      const est = { kcal: num(x.kcal), prot: num(x.p), fat: num(x.f), carb: num(x.c), salt: num(x.salt) };
      return { name: x.name.trim().slice(0, 40), g, hit, est };
    });
  }
  let photoItems = [];
  function showPhotoPreview() {
    const items = parsePhotoCode($("#photocode").value);
    photoItems = items || [];
    if (!items) { $("#photoprev").innerHTML = `<li class="empty">「たべたメモ:」で始まる1行が見つかりません。Claude の答えをそのまま全部貼ってください。</li>`; $("#photook").hidden = true; return; }
    $("#photoprev").innerHTML = items.map((it, i) => {
      const isDish = it.hit && it.hit.key.startsWith("d:");
      const amt = isDish ? 1 : it.g || (it.hit && it.hit.g) || 100;
      const n = it.hit ? nutOf({ key: it.hit.key, amt }) : it.est;
      return `<li><label><input type="checkbox" data-i="${i}" checked> <b>${esc(it.name)}</b></label>
        <span>${it.hit ? `→ ${esc(it.hit.name)}（成分表）` : "→ 成分表に無いので Claude の見積もり"}</span>
        <span>${isDish ? `<input type="hidden" data-g="${i}" value="1">1人前` : `<input type="number" inputmode="decimal" min="1" max="2000" data-g="${i}" value="${Math.round(amt)}" aria-label="${esc(it.name)}の量（g）"> g`}・${fmt(n.kcal)}kcal</span></li>`;
    }).join("") || `<li class="empty">品目がありませんでした。</li>`;
    $("#photook").hidden = !items.length;
  }
  function commitPhoto(items, box) {
    if (!Array.isArray(items)) { items = photoItems; box = "#photoprev"; }
    const meal = $("#addmeal").value, list = (S.days[day] = S.days[day] || []);
    let n = 0;
    items.forEach((it, i) => {
      if (!$(`${box} input[data-i="${i}"]`).checked) return;
      const amt = Number($(`${box} input[data-g="${i}"]`).value) || 0;
      if (!(amt > 0)) return;
      if (it.hit) list.push({ key: it.hit.key, amt, meal, label: it.name });
      else {
        const r = it.g ? amt / it.g : 1;
        const est = Object.fromEntries(NKEYS.map((k) => [k, 0]));
        for (const k of ["kcal", "prot", "fat", "carb", "salt"]) est[k] = it.est[k] * r;
        list.push({ key: "x:photo", amt: 1, g: amt, n: est, meal, label: it.name });
      }
      n++;
    });
    if (!n) return;
    save(); closeAdd(); render(); toast(`写真から ${n} 品を記録しました。量がちがうものは消して入れ直せます`);
  }

  // ---- 写真から探す（端末の中の画像AI：MobileCLIP S0。写真と、食品の説明文の埋め込みを照らし合わせて近い順に出す） ----
  // 部品（vendor/・models/・data/photo-emb.json）は Actions「Photo model」が作る。押したときだけ読む。外へは何も送らない。
  let ai = null, aiItems = [];
  async function loadAI() {
    if (ai) return ai;
    const T = await import(new URL("vendor/transformers.min.js", document.baseURI).href);
    T.env.allowRemoteModels = false;
    T.env.allowLocalModels = true;
    T.env.localModelPath = new URL("models/", document.baseURI).href;
    T.env.backends.onnx.wasm.wasmPaths = new URL("vendor/", document.baseURI).href;
    T.env.backends.onnx.wasm.numThreads = 1;
    T.env.backends.onnx.wasm.proxy = false;
    const [proc, vis, emb] = await Promise.all([
      T.AutoProcessor.from_pretrained("Xenova/mobileclip_s0"),
      T.CLIPVisionModelWithProjection.from_pretrained("Xenova/mobileclip_s0", { dtype: "fp16", device: "wasm" }),
      fetch("data/photo-emb.json").then((r) => { if (!r.ok) throw new Error("emb " + r.status); return r.json(); }),
    ]);
    ai = { T, proc, vis, emb };
    return ai;
  }
  // 画像の埋め込み（長さ1）と、説明文の埋め込みの内積を、近い順に並べる。同じ品は1つにまとめる。
  function rankByEmbedding(vec, emb, top) {
    let n = 0; for (const x of vec) n += x * x; n = Math.sqrt(n) || 1;
    const best = new Map();
    emb.vectors.forEach((t, i) => {
      let d = 0; for (let j = 0; j < t.length; j++) d += t[j] * vec[j];
      const k = emb.keys[i], s = d / n;
      if (!best.has(k) || best.get(k) < s) best.set(k, s);
    });
    return [...best].sort((a, b) => b[1] - a[1]).slice(0, top || 6);
  }
  async function readPhotoAI(file) {
    if (!file) return;
    $("#aibox").hidden = false; $("#aiok").hidden = true; $("#aiprev").innerHTML = "";
    const img = $("#aiimg");
    if (img.src) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(file);
    $("#aistat").textContent = ai ? "写真を読んでいます…" : "はじめの1回は AI の部品を読み込みます（少し時間がかかります）…";
    try {
      const A = await loadAI();
      $("#aistat").textContent = "写真を読んでいます…";
      const raw = await A.T.RawImage.fromBlob(file);
      const { image_embeds } = await A.vis(await A.proc(raw));
      showAI(rankByEmbedding(Array.from(image_embeds.data), A.emb, 6));
    } catch (e) {
      console.warn(e);
      $("#aistat").textContent = "この端末では AI を動かせませんでした。名前で探すか、下の「Claude で読み取る」を使ってください。";
    }
  }
  function showAI(ranked) {
    aiItems = ranked.map(([k]) => itemOf(k)).filter(Boolean).map((hit) => ({ name: hit.name, g: hit.g || 0, hit }));
    $("#aistat").textContent = aiItems.length ? "近い順の候補です。合うものにチェックしてください（いくつでも）。" : "候補が見つかりませんでした。";
    $("#aiprev").innerHTML = aiItems.map((it, i) => {
      const isDish = it.hit.key.startsWith("d:");
      const amt = isDish ? 1 : it.g || 100;
      return `<li><label><input type="checkbox" data-i="${i}"${i ? "" : " checked"}> <b>${esc(it.name)}</b></label>
        <span>${isDish ? `<input type="hidden" data-g="${i}" value="1">1人前（目安）` : `<input type="number" inputmode="decimal" min="1" max="2000" data-g="${i}" value="${Math.round(amt)}" aria-label="${esc(it.name)}の量（g）"> g`}・${fmt(nutOf({ key: it.hit.key, amt }).kcal)}kcal</span></li>`;
    }).join("");
    $("#aiok").hidden = !aiItems.length;
  }

  let toastT;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2200); }

  // ---- 書き出し・読み込み ----
  function exportData() {
    const blob = new Blob([JSON.stringify(S, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tabeta-memo-${ymd(new Date())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importData(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const s = JSON.parse(r.result);
        if (!s || typeof s !== "object" || !s.days || typeof s.days !== "object") throw new Error("形がちがう");
        S = Object.assign(blank(), s);
        save(); render(); toast("読み込みました");
      } catch (e) { toast("読み込めませんでした（たべたメモで書き出したファイルを選んでください）"); }
    };
    r.readAsText(file);
  }

  // ---- つなぐ ----
  function wire() {
    document.querySelector("nav.tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-view]"); if (b) { view = b.dataset.view; render(); window.scrollTo(0, 0); } });
    $("#prev").onclick = () => { day = addDays(day, -1); render(); };
    $("#next").onclick = () => { if (day < ymd(new Date())) { day = addDays(day, 1); render(); } };
    $("#todaybtn").onclick = () => { day = ymd(new Date()); render(); };
    $("#meals").addEventListener("click", (e) => {
      const a = e.target.closest("button.add"); if (a) return openAdd(a.dataset.meal);
      const rb = e.target.closest("button.roughbtn"); if (rb) return openRough(rb.dataset.meal);
      const c = e.target.closest("button.copy"); if (c) return copyMeal(c.dataset.meal);
      const q = e.target.closest("button.chip"); if (q) return addQuick(q);
      const ms = e.target.closest("button.mkset"); if (ms) return makeSet(ms.dataset.meal);
      const ed = e.target.closest("button.edit"); if (ed) return openEdit(Number(ed.dataset.i));
      const d = e.target.closest("button.del");
      if (d) { const es = S.days[day]; const [x] = es.splice(Number(d.dataset.i), 1); save(); render(); toast(`${nameOf(x.key, x.label)}を消しました`); }
    });
    $("#q").addEventListener("input", () => { $("#pick").hidden = true; $("#results").hidden = false; showList(); });
    $("#addtabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (b) { tab = b.dataset.tab; showList(); } });
    $("#list").addEventListener("click", (e) => {
      const s = e.target.closest("button.star");
      if (s) { const k = s.dataset.key; S.fav = S.fav.includes(k) ? S.fav.filter((x) => x !== k) : [k].concat(S.fav); save(); showList(); return; }
      const p = e.target.closest("button.pickbtn"); if (p) pick(p.dataset.key);
    });
    $("#portions").addEventListener("click", (e) => { const b = e.target.closest("button[data-v]"); if (b) { $("#amt").value = b.dataset.v; previewPick(); } });
    $("#amt").addEventListener("input", previewPick);
    $("#addok").onclick = commitPick;
    $("#back").onclick = () => { $("#pick").hidden = true; $("#results").hidden = false; };
    $("#addclose").onclick = closeAdd;
    $("#bulkok").onclick = commitBulk;
    $("#roughsize").addEventListener("click", (e) => { const b = e.target.closest("button[data-size]"); if (b) { roughSize = Number(b.dataset.size); renderRough(); } });
    $("#roughtypes").addEventListener("click", (e) => { const b = e.target.closest("button[data-type]"); if (b) addRough(Number(b.dataset.type)); });
    $("#roughclose").onclick = () => ($("#roughdlg").close ? $("#roughdlg").close() : $("#roughdlg").removeAttribute("open"));
    $("#firstok").onclick = () => { S.helped = true; save(); render(); };
    $("#openphoto").onclick = () => { $("#photobox").hidden = !$("#photobox").hidden; $("#photoprompt").value = PHOTO_PROMPT; };
    $("#photocopy").onclick = async () => { try { await navigator.clipboard.writeText(PHOTO_PROMPT); toast("コピーしました。Claude に写真といっしょに送ってください"); } catch (e) { $("#photoprompt").select(); toast("下の文を長押ししてコピーしてください"); } };
    $("#photocode").addEventListener("input", showPhotoPreview);
    $("#photook").onclick = () => commitPhoto();
    $("#aifile").addEventListener("change", (e) => { readPhotoAI(e.target.files[0]); e.target.value = ""; });
    $("#aiok").onclick = () => commitPhoto(aiItems, "#aiprev");
    $("#opencustom").onclick = () => { $("#customform").hidden = false; $("#customform").cname.value = $("#q").value.trim(); $("#customform").cname.focus(); };
    $("#customform").addEventListener("submit", commitCustom);
    const pf = $("#profile");
    pf.addEventListener("input", syncMenses);
    // 設定は変えたらすぐ使う（「目安を出す」を押さずにほかの画面へ移ると、減量を選んでも前の目安のままだった。2026-11-23 satou さん）
    const applyProfile = (go) => {
      const age = Math.floor(Number(pf.age.value));
      if (!(age >= 18 && age <= 120)) { $("#ageerr").hidden = false; pf.age.focus(); return; }
      $("#ageerr").hidden = true;
      const height = Number(pf.height.value) || null, weight = Number(pf.weight.value) || null;
      // 範囲の外の値をだまって捨てない（身長を m で入れた・体重を g で入れたなど。捨てると減量の目標が出なくなる）
      const hBad = height != null && !(height >= 100 && height <= 230), wBad = weight != null && !(weight >= 25 && weight <= 300);
      $("#hwerr").hidden = !(hBad || wBad);
      if (hBad) { pf.height.focus(); return; }
      if (wBad) { pf.weight.focus(); return; }
      if (pf.goal.value === "lose" && !(height && weight)) { $("#needhw").hidden = false; pf.height.focus(); return; }
      $("#needhw").hidden = true;
      if (pf.goal.value === "lose" && !$("#pacewarn").hidden) { pf.pace.focus(); return; }
      S.profile = { sex: pf.sex.value, age, act: pf.act.value, menses: pf.sex.value === "f" && age < 65 && pf.menses.checked,
        height: height && height >= 100 && height <= 230 ? height : null, weight: weight && weight >= 25 && weight <= 300 ? weight : null,
        goal: pf.goal.value, pace: pf.pace.value };
      // 設定で入れた体重は、きょうの体重として記録する（前に入れた古い体重のままで目安を出さない）
      if (S.profile.weight) S.weights[ymd(new Date())] = S.profile.weight;
      save();
      const T = targets(S.profile, weightNow());
      if (!go) { $("#saved").textContent = `保存しました：1日の目安 ${fmt(T._E)}kcal${T._diet && !T._diet.blocked ? "（減量）" : ""}`; return; }
      toast(T._diet && !T._diet.blocked ? `減量の目安を 1日 ${fmt(T._E)}kcal にしました（体重を保つ量より ${fmt(T._diet.cut)}kcal 少なく）` : `1日の目安を ${fmt(T._E)}kcal にしました`);
      view = "today"; render();
    };
    pf.addEventListener("submit", (e) => { e.preventDefault(); applyProfile(true); });
    pf.addEventListener("change", () => { if (S.profile) applyProfile(false); });
    $("#export").onclick = exportData;
    $("#moveadd").onclick = () => {
      const min = Number($("#movemin").value);
      if (!(min > 0 && min <= 600)) { $("#movemin").focus(); toast("運動した時間を分で入れてください"); return; }
      (S.moves[day] = S.moves[day] || []).push({ id: $("#movetype").value, min: Math.round(min) });
      $("#movemin").value = ""; save(); render(); toast("運動を記録しました");
    };
    $("#movelist").addEventListener("click", (e) => { const b = e.target.closest("button.delmove"); if (b) { S.moves[day].splice(Number(b.dataset.i), 1); save(); render(); } });
    $("#stepssave").onclick = () => {
      const v = Math.round(Number($("#steps").value));
      if (!(v >= 0 && v <= 100000)) { $("#steps").focus(); return; }
      if (v) S.steps[day] = v; else delete S.steps[day];
      save(); render(); toast("歩数を記録しました");
    };
    $("#advice").addEventListener("click", (e) => { const b = e.target.closest("button.morebtn"); if (!b) return; const open = $("#advice").classList.toggle("open"); b.setAttribute("aria-expanded", open); b.textContent = open ? "とじる" : `ほかに ${$("#advice").querySelectorAll("li.more").length} 件`; });
    $("#suggest").addEventListener("click", (e) => { const b = e.target.closest("button.usemenu"); if (b) useMenu(b.dataset.name, b.dataset.meal); });
    $("#findshops").onclick = findShops;
    $("#wtsave").onclick = () => {
      const v = Number($("#wt").value);
      if (!(v >= 25 && v <= 300)) { $("#wt").focus(); toast("体重は kg で入れてください（例 62.4）"); return; }
      S.weights[day] = Math.round(v * 10) / 10; save(); render(); toast("体重を記録しました");
    };
    $("#importfile").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) importData(f); e.target.value = ""; });
    let armed = false;
    $("#wipe").onclick = () => {
      if (!armed) { armed = true; $("#wipe").textContent = "もう一度押すと全部消えます（元に戻せません）"; setTimeout(() => { armed = false; $("#wipe").textContent = "記録を全部消す"; }, 5000); return; }
      S = blank(); save(); armed = false; $("#wipe").textContent = "記録を全部消す"; render(); toast("全部消しました");
    };
  }

  async function start() {
    $("#act").innerHTML = ACTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    $("#movetype").innerHTML = window.EXERCISES.map((e) => `<option value="${e.id}">${esc(e.label)}（${e.mets}メッツ）</option>`).join("");
    $("#addmeal").innerHTML = MEALS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    wire();
    $("#savewarn").hidden = saveOk;
    try {
      const r = await fetch("data/foods.json");
      const j = await r.json();
      foodsMeta = j.meta;
      FOODS = new Map(j.foods.map((f) => [f.id, f]));
    } catch (e) {
      $("#loaderr").hidden = false;
    }
    document.body.classList.add("ready");
    render();
  }
  window.TABETA = { rankByEmbedding, usualFor, bulkParts, copyMeal, openEdit, showAI, targets, advise, sum, search: (q) => search(q), nutOf, get state() { return S; } };
  start();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
