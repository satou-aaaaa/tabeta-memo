#!/usr/bin/env bash
# 見やすさの設定を shared-workflows のひな形から写し直す。使い方：bash tools/sync_a11y.sh <shared-workflows の場所>
set -euo pipefail
T="${1:-../shared-workflows}/template/a11y/a11y.html"
V=$(grep -o 'a11y:begin 見やすさの設定 v[0-9]*' "$T" | grep -o 'v[0-9]*$')
{ echo "/* shared-workflows template/a11y/a11y.html（$V）の <script> の写し。CSP で埋め込みのスクリプトを許さないため、別のファイルに置く。直すときはひな形を直して写し直す（tools/sync_a11y.sh） */"; sed -n '/<script id="a11y-script">/,/<\/script>/p' "$T" | sed '1d;$d'; } > src/a11y.js
{ echo "/* shared-workflows template/a11y/a11y.html（$V）の <style> の写し（tools/sync_a11y.sh） */"; sed -n '/<style id="a11y-css">/,/<\/style>/p' "$T" | sed '1d;$d'; } > src/a11y.css
echo "写した $V"
