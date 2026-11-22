/* shared-workflows template/a11y/a11y.html（v7）の <script> の写し。CSP で埋め込みのスクリプトを許さないため、別のファイルに置く。直すときはひな形を直して写し直す（tools/sync_a11y.sh） */
/* 見やすさの設定（色覚・ディスレクシア・弱視・動きに弱い人のため）。外へは何も送らない。
   設定は localStorage の a11y-v1 に置く。同じサイト（satou-aaaaa.github.io）のゲームは同じ設定を使う。
   ゲームの側でできること：
   - 設定を開くボタンに data-a11y-open を付ける（無ければ左下に「Aa」のボタンを出す）
   - 読み上げる文に data-a11y-say を付ける（問題文・知らせなど）
   - 色の見分けを助ける形・模様は html.a11y-cvd の下に CSS で書く。JS では A11y.on('cvd')
   - 揺れ・すべる動きを JS で動かすときは、A11y.on('calm') なら止める
   - 設定が変わると document に a11ychange が届く
   - 設定の印は html の class「a11y-<設定の名前>」（a11y-read など）。部品の class はこれと重ならない名前にする（2026-11-05 a11y-say がボタンとぶつかった） */
(() => {
  const KEY = "a11y-v1";
  const root = document.documentElement;
  const OPTS = [
    ["read", "読みやすい文字", "UD フォント・行間と字間を広く"],
    ["cvd", "色の見分けを助ける", "色に形・模様・記号を足す"],
    ["calm", "動きを減らす", "揺れ・点滅・すべる動きを止める"],
    ["say", "読み上げのボタンを出す", "問題や知らせを声で読む（端末の中の声だけ）"],
    ["ruby", "ふりがなを出す", "むずかしい漢字に読みを付ける"],
  ];
  const media = (q) => { try { return matchMedia(q).matches; } catch { return false; } };
  // 保存した値がオブジェクトでなければ（別のページが書いた・手で直した）無かったことにする（2026-11-05 CodeRabbit：true が入ると設定が開けなくなる）
  const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; } };
  let S = load();
  // 保存できなかった変更（開いているあいだだけ覚える）。書く前に読み直した値で、まだ保存できていない変更を上書きしない（v7、nenkin-shikumi #1 の CodeRabbit）
  let unsaved = {};
  // 決めていないものは端末の設定に合わせる（視差効果を減らす → 動きを減らす）
  const on = (k) => (k in S ? !!S[k] : k === "calm" ? media("(prefers-reduced-motion: reduce)") : false);
  let fontLoaded = false;
  const loadFont = () => {
    if (fontLoaded) return; fontLoaded = true;
    // Google Fonts を許しているページだけ取りに行く（許していなければ端末にある UD フォントを使う）
    const csp = (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || "";
    if (csp && !/fonts\.googleapis\.com/.test(csp)) return;
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = "https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&display=swap";
    document.head.appendChild(l);
  };
  const apply = () => {
    for (const [k] of OPTS) root.classList.toggle("a11y-" + k, on(k));
    if (on("read")) loadFont();
    if (sayBtn) sayBtn.hidden = !on("say");
    if (!on("say")) stop();
  };
  const set = (k, v) => {
    unsaved[k] = !!v;
    S = { ...S, ...load(), ...unsaved }; // 別のタブで変えた設定を消さないよう、書く前に読み直す（保存できていない変更はこちらを残す）
    try { localStorage.setItem(KEY, JSON.stringify(S)); unsaved = {}; } catch { /* 保存できなくても今の画面には効かせる */ }
    apply();
    document.dispatchEvent(new CustomEvent("a11ychange", { detail: { key: k, on: !!v } }));
  };

  // 読み上げ：端末の中の日本語の声だけを使う（外へ文字を送る声は使わない）
  const voice = () => { try { return speechSynthesis.getVoices().find((v) => /^ja/i.test(v.lang) && v.localService) || null; } catch { return null; } };
  const stop = () => { try { speechSynthesis.cancel(); } catch { /* 無い端末 */ } };
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !el.closest("[hidden],[aria-hidden=true],[inert]"); };
  const textOf = (sel) => [...document.querySelectorAll(sel)].filter(visible).map((el) => (el.getAttribute("aria-label") || el.innerText || "").trim()).filter(Boolean).join("。");
  // data-a11y-say が無い画面では、見出しと知らせの場所を読む（2026-11-05 何も読まれず設定が開くだけだった）
  const sayText = () => textOf("[data-a11y-say]") || textOf("h1,h2,[role=status],[aria-live]");
  const say = (text) => {
    const v = voice();
    if (!v || !text) return false;
    stop();
    const u = new SpeechSynthesisUtterance(text.slice(0, 600));
    u.voice = v; u.lang = v.lang; u.rate = 0.95;
    speechSynthesis.speak(u);
    return true;
  };

  let dlg = null, sayBtn = null, lastFocus = null;
  const build = () => {
    dlg = document.createElement("dialog");
    dlg.className = "a11y-dlg";
    dlg.setAttribute("aria-labelledby", "a11y-h");
    const hasRuby = !!document.querySelector("ruby.a11y-rb");
    dlg.innerHTML = `<h2 id="a11y-h">見やすさ・読みやすさ</h2><p>ほかのゲームにも同じ設定が使われます。文字は2本の指で広げると大きくなります。</p>` +
      OPTS.filter(([k]) => k !== "ruby" || hasRuby).map(([k, n, d]) => `<label><input type="checkbox" data-k="${k}"><span>${n}<small>${d}</small></span></label>`).join("") +
      `<p class="a11y-note" id="a11y-novoice" hidden>この端末には、外へ送らずに読める日本語の声がありません。</p><div class="a11y-row"><button type="button" class="a11y-ok" data-a11y-close>閉じる</button></div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener("change", (e) => {
      const k = e.target.dataset && e.target.dataset.k;
      if (!k) return;
      set(k, e.target.checked);
      if (k === "say") dlg.querySelector("#a11y-novoice").hidden = !(e.target.checked && !voice());
    });
    // dialog を知らないブラウザでは close が無いので、open を外して閉じ、フォーカスを戻す（v6。jitensha-rule #1・sekai-jikoku #1 の CodeRabbit）
    dlg.querySelector("[data-a11y-close]").addEventListener("click", () => { if (dlg.close) dlg.close(); else { dlg.removeAttribute("open"); if (lastFocus && lastFocus.focus) lastFocus.focus(); } });
    dlg.addEventListener("close", () => { if (lastFocus && lastFocus.focus) lastFocus.focus(); });
    sayBtn = document.createElement("button");
    sayBtn.type = "button"; sayBtn.className = "a11y-saybtn"; sayBtn.textContent = "🔊 読む"; sayBtn.setAttribute("aria-label", "画面の問題を読み上げる");
    sayBtn.addEventListener("click", () => {
      try { if (speechSynthesis.speaking) return stop(); } catch { /* 無い端末 */ }
      if (!say(sayText())) open();
    });
    document.body.appendChild(sayBtn);
    if (!document.querySelector("[data-a11y-open]")) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "a11y-btn a11y-float"; b.textContent = "Aa"; b.setAttribute("data-a11y-open", ""); b.setAttribute("aria-label", "見やすさの設定");
      document.body.appendChild(b);
    }
    document.addEventListener("click", (e) => { const t = e.target.closest && e.target.closest("[data-a11y-open]"); if (t) { e.preventDefault(); open(); } });
    apply();
  };
  const open = () => {
    if (!dlg) build();
    lastFocus = document.activeElement;
    for (const c of dlg.querySelectorAll("input[data-k]")) c.checked = on(c.dataset.k);
    dlg.querySelector("#a11y-novoice").hidden = !(on("say") && !voice());
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  };
  // 声の一覧はあとから届くことがある。届いたら「声がありません」を出し直す
  try { speechSynthesis.addEventListener("voiceschanged", () => { if (dlg) dlg.querySelector("#a11y-novoice").hidden = !(on("say") && !voice()); }); } catch { /* 無い端末 */ }
  apply();
  // 端末の「視差効果を減らす」を開いたあとに変えても効かせる（自分で決めていないときだけ。v7、hatsuden-kurabe #1 の CodeRabbit）
  try {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    // 設定の画面を開いたままでも、チェックを今の状態に合わせる（合わないと1回目の押しで外せない）
    const follow = () => { if (!("calm" in S)) { apply(); const c = dlg && dlg.querySelector('input[data-k="calm"]'); if (c) c.checked = on("calm"); document.dispatchEvent(new CustomEvent("a11ychange", { detail: { key: "calm", on: on("calm") } })); } };
    if (mq.addEventListener) mq.addEventListener("change", follow); else if (mq.addListener) mq.addListener(follow);
  } catch { /* matchMedia の無い端末 */ }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
  window.A11y = { on, set, open, say, stop };
})();
