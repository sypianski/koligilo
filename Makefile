.PHONY: all build test e2e dist plugin mac-app release-files clean koreader-opts

VERSION := $(shell grep -o 'Version = "[^"]*"' main.go | cut -d'"' -f2)
DIST := dist
PLATFORMS := darwin/arm64 darwin/amd64 linux/amd64 linux/arm64 windows/amd64

all: build

build:
	go build -o koligilo .

# testy: Go (routery, katalog) + czysta logika pluginu (Lua) + składnia UI
# + literały z kontrolek panelu == Sync.serialize (luaser_test.js)
test:
	go vet ./...
	go test ./...
	lua tests/sync_test.lua
	lua tests/installer_test.lua
	node --check web/app.js
	node --check web/lua.js
	node --check web/koreader_opts.js
	node --check web/preview.js
	node tests/preview_test.js
	node tests/luaser_test.js

# mapa ustawień KOReadera (web/koreader_opts.js) ze źródeł przypiętych do tagu
koreader-opts:
	scripts/koreader-opts.sh $(TAG)

# serwer + dwa symulowane czytniki przez prawdziwe HTTP
e2e:
	tests/run_e2e.sh

# binarki na wszystkie systemy (Mac testowany ręcznie, reszta z tego samego kodu)
dist: plugin
	@mkdir -p $(DIST)
	@for p in $(PLATFORMS); do \
		os=$${p%/*}; arch=$${p#*/}; ext=$$([ $$os = windows ] && echo .exe); \
		out=$(DIST)/koligilo-$(VERSION)-$$os-$$arch$$ext; \
		CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch go build -trimpath -ldflags "-s -w" -o $$out . && echo "  $$out"; \
	done

plugin:
	@mkdir -p $(DIST)
	cd plugin && zip -qr ../$(DIST)/koligilo.koplugin-$(VERSION).zip koligilo.koplugin
	@echo "  $(DIST)/koligilo.koplugin-$(VERSION).zip"

# pliki do GitHub Releases pod stałymi nazwami (linki releases/latest/download/…
# na stronie i w README nie zmieniają się między wersjami); DMG dokłada się z Maca
release-files: dist
	@mkdir -p $(DIST)/release
	cp $(DIST)/koligilo-$(VERSION)-windows-amd64.exe $(DIST)/release/koligilo-windows-amd64.exe
	cp $(DIST)/koligilo-$(VERSION)-linux-amd64 $(DIST)/release/koligilo-linux-amd64
	cp $(DIST)/koligilo-$(VERSION)-linux-arm64 $(DIST)/release/koligilo-linux-arm64
	cp $(DIST)/koligilo.koplugin-$(VERSION).zip $(DIST)/release/koligilo.koplugin.zip
	@test -f $(DIST)/koligilo-$(VERSION).dmg && cp $(DIST)/koligilo-$(VERSION).dmg $(DIST)/release/koligilo.dmg || echo "  brak $(DIST)/koligilo-$(VERSION).dmg — zbuduj na Macu: make mac-app NOTARIZE=1"

# koligilo.app + .dmg (tylko na macOS: swiftc, lipo, iconutil, hdiutil)
mac-app:
	NOTARIZE=$(NOTARIZE) scripts/mac-app.sh

clean:
	rm -rf koligilo $(DIST)
