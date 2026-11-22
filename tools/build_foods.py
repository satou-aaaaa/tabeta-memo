#!/usr/bin/env python3
"""日本食品標準成分表（八訂）増補2023年 の本表（Excel）から data/foods.json を作る。

使い方: python3 tools/build_foods.py <本表の xlsx> data/foods.json
- 文部科学省の公式 Excel をそのまま読む（値を手で書き換えない）。
- 「Tr」「(Tr)」は 0、「(数)」は推定値として数、「-」「*」など数でないものは null。
- 列は Excel の成分識別子の行（ENERC_KCAL など）で探す。並びが変わっても読める。見つからない列があれば止める。
- openpyxl が要る（CI では pip で入れる）。
"""
import json, re, sys
from openpyxl import load_workbook

# 使う成分（アプリでのキー: 成分識別子の候補）。単位は成分表のまま（100g あたり）
WANT = {
    "kcal": ["ENERC_KCAL"],
    "prot": ["PROT-"],          # たんぱく質
    "fat": ["FAT-"],            # 脂質
    "carb": ["CHOCDF-"],        # 炭水化物
    "fib": ["FIB-", "FIB-SDFS", "FIBTG"],  # 食物繊維総量
    "na": ["NA"],
    "k": ["K"],
    "ca": ["CA"],
    "mg": ["MG"],
    "fe": ["FE"],
    "zn": ["ZN"],
    "vita": ["VITA_RAE"],       # μg
    "vitd": ["VITD"],           # μg
    "vitb1": ["THIA"],          # mg
    "vitb2": ["RIBF"],          # mg
    "vitc": ["VITC"],           # mg
    "salt": ["NACL_EQ"],        # g
}

def num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return round(float(v), 3)
    s = str(v).strip().replace("（", "(").replace("）", ")")
    s = s.strip("()")
    if s in ("Tr", "TR", "tr"):
        return 0.0
    try:
        return round(float(s), 3)
    except ValueError:
        return None

def main(src, dst):
    wb = load_workbook(src, read_only=True, data_only=True)
    ws = max(wb.worksheets, key=lambda w: w.max_row or 0)
    rows = list(ws.iter_rows(values_only=True))
    print(f"シート: {ws.title} 行数: {len(rows)}")
    for i, r in enumerate(rows[:14]):
        print(i, [c for c in r[:12]])
    hdr = next((i for i, r in enumerate(rows) if any(str(c).strip() == "ENERC_KCAL" for c in r if c is not None)), None)
    if hdr is None:
        sys.exit("::error::成分識別子の行（ENERC_KCAL）が見つからない")
    ids = [str(c).strip() if c is not None else "" for c in rows[hdr]]
    print("成分識別子:", [x for x in ids if x])
    col = {}
    for key, cands in WANT.items():
        hit = next((ids.index(c) for c in cands if c in ids), None)
        if hit is None:
            hit = next((j for j, x in enumerate(ids) if x.startswith(cands[0])), None)
        if hit is None:
            sys.exit(f"::error::{key} の列（{cands}）が無い")
        col[key] = hit
    print("列:", col)
    foods = []
    for r in rows[hdr + 1:]:
        cells = [c for c in r]
        code_j = next((j for j, c in enumerate(cells[:4]) if c is not None and re.fullmatch(r"\d{5}", str(c).strip())), None)
        if code_j is None:
            continue
        code = str(cells[code_j]).strip()
        name = next((str(c).strip() for c in cells[code_j + 1:code_j + 4] if isinstance(c, str) and not re.fullmatch(r"[\d\s]+", c)), None)
        if not name:
            continue
        f = {"id": code, "g": int(code[:2]), "name": re.sub(r"\s+", " ", name.replace("　", " ")).strip()}
        for key, j in col.items():
            f[key] = num(cells[j]) if j < len(cells) else None
        if f["kcal"] is None:
            continue
        foods.append(f)
    if len(foods) < 2000:
        sys.exit(f"::error::食品が {len(foods)} しかない（2000 以上のはず）")
    print("食品数:", len(foods))
    for f in foods[:3] + [x for x in foods if x["id"] in ("01088", "12004", "06267")]:
        print(f)
    meta = {"source": "日本食品標準成分表（八訂）増補2023年（文部科学省）", "url": "https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html",
            "unit": "可食部100gあたり", "keys": list(WANT.keys())}
    with open(dst, "w", encoding="utf-8") as fp:
        json.dump({"meta": meta, "foods": foods}, fp, ensure_ascii=False, separators=(",", ":"))
        fp.write("\n")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
