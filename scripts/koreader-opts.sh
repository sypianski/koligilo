#!/bin/bash
# Odświeża web/koreader_opts.js ze źródeł KOReadera przypiętych do tagu (TASK-22).
#   scripts/koreader-opts.sh [TAG]      (domyślnie tag zapisany w obecnym pliku)
# Tłumaczenia bierzemy z commitu submodułu l10n TEGO tagu, nie z gałęzi.
# Źródła lądują w cache (KOREADER_SRC_CACHE, domyślnie ~/.cache/koligilo-koreader), nie w repo.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=web/koreader_opts.js
TAG=${1:-$(grep -o 'version: "[^"]*"' "$OUT" 2>/dev/null | cut -d'"' -f2 || true)}
[ -n "$TAG" ] || { echo "podaj tag KOReadera, np. v2026.07.2" >&2; exit 1; }
CACHE=${KOREADER_SRC_CACHE:-$HOME/.cache/koligilo-koreader}
SRC=$CACHE/koreader-$TAG
L10N_DIR=$CACHE/translations

if [ ! -d "$SRC" ]; then
  mkdir -p "$CACHE"
  git clone -q --depth 1 --branch "$TAG" https://github.com/koreader/koreader.git "$SRC"
fi
L10N=$(git -C "$SRC" ls-tree HEAD l10n | awk '{print $3}')
[ -d "$L10N_DIR/.git" ] || git clone -q https://github.com/koreader/koreader-translations.git "$L10N_DIR"
git -C "$L10N_DIR" cat-file -e "$L10N^{commit}" 2>/dev/null || git -C "$L10N_DIR" fetch -q origin "$L10N"
git -C "$L10N_DIR" checkout -q "$L10N"

# crengine (domyślny arkusz epub.css) — commit przypięty w submodule base tego tagu
BASE=$(git -C "$SRC" ls-tree HEAD base | awk '{print $3}')
CRE_SHA_FILE=$CACHE/crengine-of-base-$BASE
[ -s "$CRE_SHA_FILE" ] || curl -sfL "https://api.github.com/repos/koreader/koreader-base/contents/thirdparty/kpvcrlib/crengine?ref=$BASE" \
  | grep -o '"sha": *"[0-9a-f]*"' | head -1 | grep -o '[0-9a-f]\{40\}' > "$CRE_SHA_FILE"
CRENGINE=$(cat "$CRE_SHA_FILE")
[ -n "$CRENGINE" ] || { echo "nie ustalono commitu crengine dla base $BASE" >&2; rm -f "$CRE_SHA_FILE"; exit 1; }
EPUB_CSS=$CACHE/crengine-$CRENGINE-epub.css
[ -s "$EPUB_CSS" ] || curl -sfL "https://raw.githubusercontent.com/koreader/crengine/$CRENGINE/cr3gui/data/epub.css" -o "$EPUB_CSS"

lua scripts/koreader-opts.lua "$SRC" "$L10N_DIR/pl/koreader.po" "$TAG" "$L10N" "$EPUB_CSS" "$CRENGINE" > "$OUT.tmp.js"
node --check "$OUT.tmp.js"
mv "$OUT.tmp.js" "$OUT"
echo "zapisano $OUT (KOReader $TAG, l10n ${L10N:0:12})"
