# AGENTS.md

食べたものを記録して、カロリーと栄養の過不足・ひとことアドバイス・次の食事の献立・減量の目標を出す PWA「たべたメモ」。GitHub Pages で公開（main の /）。記録は端末の中（localStorage）だけ。

## 準備（最初に一度）

```bash
bash scripts/setup.sh   # 検査の道具（Playwright）
```

## push する前の確認

```bash
node qa/run.mjs
```

## 決まり

- 食品の栄養値（data/foods.json）は文部科学省「日本食品標準成分表（八訂）増補2023年」の公式 Excel から `tools/build_foods.py` で作る。手で書き換えない。作り直すときは Actions「Foods data」（クラウドのセッションから文科省に届かないため）。
- 1日の目安（data/dri.js）は「日本人の食事摂取基準（2025年版）」の数をそのまま写す。減量の目安（DIET）は肥満症診療ガイドライン2022 の「3〜6か月で現体重の3%」と 7,000kcal/kg。基礎代謝より下げない・BMI 18.5 未満には減量の目標を出さない・たんぱく質やビタミンの目安は減らさない。
- 運動のメッツ（data/exercise.js）は厚生労働省のメッツ表の値をそのまま写す。使うエネルギーは (メッツ − 1) × 時間 × 体重 で、その日の目安に足す。歩数はふだんの動きとして「体の動かし方」にふくまれるので目安に足さない（2026-11-22 satou さんが「手で入れる」を選んだ。PWA はスマホの歩数を直接読めない）。
- 写真から探す（主）：satou さんが 2026-11-22 カードで「端末の中のAIで認識」を選んだ。MobileCLIP S0 の画像のモデル（fp16）を transformers.js 3.8.1（vendor/、ONNX Runtime を含む transformers.min.js）で端末の中で動かし、data/photo-labels.js の説明文の埋め込み（data/photo-emb.json）と近い順に候補を出す。写真は外へ送らない。モデル・埋め込み・vendor は Actions「Photo model」が作って枝 photo-model に置く（クラウドから huggingface.co に届かないため）。量子化した型（q8・uint8）は見本の写真で全部はずれたので使わない。候補の品を足すときは photo-labels.js に英語の説明文を足して Photo model を回す（ログの TRY 行で見本の写真の当たりを見る）。
- 写真から入れる（Claude）：Claude のアプリに写真を送り、返ってきた「たべたメモ:[...]」の1行を貼る形も残す（量の見積もりが要るとき）。品名は成分表に当て、当たらないものだけ Claude の見積もりを使う。
- 見やすさの設定は shared-workflows の template/a11y の写し（src/a11y.js・a11y.css。CSP で埋め込みのスクリプトを許さないため分けた）。直すときはひな形を直して `bash tools/sync_a11y.sh ../shared-workflows`。
- 見た目を変えたら `node qa/shots.mjs <フォルダ> light` と `dark` で写して見る。
- 「茶碗1杯」などの量・料理の配合・献立（data/common.js・data/menus.js）は目安。成分表の食品番号だけを持ち、栄養値は持たない。
- コンビニの組み合わせは商品の種類だけ。会社名・商品名を入れない（2026-11-22 satou さんが「近くの店＋選び方」を選んだ。商品は入れ替わりが激しく、各社のサイトから集めるのは規約の問題がある）。
- 外へ通信するのは「近くのコンビニ・スーパーを探す」を押したときの Overpass API（OpenStreetMap）だけ。位置は小数3けた（約100m）に丸める。CSP の connect-src をこれ以上広げない。
- アドバイスは責めない言い方にし、極端な制限・食事を抜くことをすすめない（qa/run.mjs が見る）。医療の代わりではないこと・相談先を「このアプリ」に出し続ける。
- 機能を足す・直すたびに qa/run.mjs に検査も足す。

## 共通のきまり

- PR の作り方・マージの仕方は satou-aaaaa/shared-workflows の `routines/pr.md`、全体のきまりは `routines/common.md` に従う。
- Claude 以外の AI・人が作業するときは、shared-workflows の `routines/tool-map.md` と `routines/without-claude.md` を読む。
