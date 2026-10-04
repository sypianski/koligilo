#!/bin/bash
# Buduje dist/koligilo.app i dist/koligilo-<wersja>.dmg — uruchamiać NA MACU
# (swiftc, lipo, iconutil, hdiutil). Binarka Go w środku jest uniwersalna
# (arm64 + x86_64).
#   make mac-app                 podpis ad hoc — działa tylko na tym komputerze
#   make mac-app NOTARIZE=1        Developer ID + notaryzacja (do wydania);
#                                tylko z Terminal.app, bo przez SSH pęk kluczy
#                                jest zablokowany. Profil notarytool jak w diktilo:
#                                xcrun notarytool store-credentials diktilo-notary ...
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(grep -o 'Version = "[^"]*"' main.go | cut -d'"' -f2)
BUILD=$(date +%Y%m%d%H%M)
OUT=dist
APP=$OUT/koligilo.app
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "== binarka Go (uniwersalna)"
for a in arm64 amd64; do
  CGO_ENABLED=0 GOOS=darwin GOARCH=$a go build -trimpath -ldflags "-s -w" -o "$TMP/koligilo-$a" .
done
lipo -create -output "$APP/Contents/Resources/koligilo" "$TMP/koligilo-arm64" "$TMP/koligilo-amd64"

echo "== nakładka Swift (uniwersalna)"
for t in arm64 x86_64; do
  swiftc -O -swift-version 5 -target $t-apple-macos13 -o "$TMP/app-$t" macapp/main.swift
done
lipo -create -output "$APP/Contents/MacOS/koligilo-app" "$TMP/app-arm64" "$TMP/app-x86_64"

echo "== ikona"
python3 macapp/icon.py "$TMP/icon.png" 2>/dev/null || { echo "brak PIL — używam dołączonej macapp/icon.png"; cp macapp/icon.png "$TMP/icon.png"; }
ICONSET="$TMP/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$TMP/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$TMP/icon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

sed -e "s/@VERSION@/$VERSION/" -e "s/@BUILD@/$BUILD/" macapp/Info.plist > "$APP/Contents/Info.plist"

NOTARIZE=${NOTARIZE:-}
NOTARY_PROFILE=${NOTARY_PROFILE:-diktilo-notary}
if [ -n "$NOTARIZE" ]; then
  IDENTITY=$(security find-identity -v -p codesigning | grep -o '"Developer ID Application[^"]*"' | head -1 | tr -d '"')
  [ -n "$IDENTITY" ] || { echo "brak certyfikatu „Developer ID Application” w pęku kluczy"; exit 1; }
  echo "== podpis: $IDENTITY"
  SIGN=(--sign "$IDENTITY" --timestamp)
else
  echo "== podpis ad hoc"
  SIGN=(--sign -)
fi
codesign --force "${SIGN[@]}" --options runtime "$APP/Contents/Resources/koligilo"
codesign --force "${SIGN[@]}" --options runtime "$APP"
codesign --verify --deep --strict "$APP"

echo "== dmg"
DMG=$OUT/koligilo-$VERSION.dmg
STAGE="$TMP/dmg"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Aplikacje"
rm -f "$DMG"
hdiutil create -quiet -volname "koligilo $VERSION" -srcfolder "$STAGE" -format UDZO "$DMG"

if [ -n "$NOTARIZE" ]; then
  codesign --force "${SIGN[@]}" "$DMG"
  echo "== notaryzacja (kilka minut)"
  xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG"
  spctl -a -t open --context context:primary-signature -v "$DMG"
fi
echo "  $APP"
echo "  $DMG"
