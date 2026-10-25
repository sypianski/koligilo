package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"io/fs"
	"net/http"
	"path"
	"sync"
)

// Plugin wbudowany w binarkę: czytnik (albo człowiek w przeglądarce czytnika)
// pobiera go z serwera jednym linkiem — bez kabla i MTP na Androidzie.
// „all:” — bez niego embed pomija pliki od „_”, czyli _meta.lua.
//
//go:embed all:plugin/koligilo.koplugin
var pluginFS embed.FS

// Zip pluginu budujemy raz na proces: suma sha256, którą serwer podaje czytnikowi
// w synchronizacji (samoaktualizacja, TASK-39), musi zgadzać się co do bajta z tym,
// co potem serwuje /koligilo.koplugin.zip.
var (
	pluginZipOnce sync.Once
	pluginZipData []byte
	pluginZipSHA  string
	pluginZipErr  error
)

func buildPluginZip() ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	err := fs.WalkDir(pluginFS, "plugin", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel := p[len("plugin/"):] // koligilo.koplugin/…
		f, err := zw.Create(path.Clean(rel))
		if err != nil {
			return err
		}
		b, err := pluginFS.ReadFile(p)
		if err != nil {
			return err
		}
		_, err = f.Write(b)
		return err
	})
	if err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func pluginZip() ([]byte, string, error) {
	pluginZipOnce.Do(func() {
		pluginZipData, pluginZipErr = buildPluginZip()
		if pluginZipErr == nil {
			sum := sha256.Sum256(pluginZipData)
			pluginZipSHA = hex.EncodeToString(sum[:])
		}
	})
	return pluginZipData, pluginZipSHA, pluginZipErr
}

// selfUpdateInfo to wskazanie dla czytnika, który sam zgłosił zgodę na aktualizację
// koligilo (?self_update=1). Wersja pochodzi z _meta.lua wbudowanego pluginu — z tego
// samego pliku, który czytnik zobaczy po instalacji — a nie ze stałej Version serwera.
func selfUpdateInfo() map[string]any {
	b, sha, err := pluginZip()
	if err != nil {
		return nil
	}
	ver := embeddedPluginVersion()
	if ver == "" {
		return nil
	}
	return map[string]any{"version": ver, "sha256": sha, "size": len(b), "url": "/koligilo.koplugin.zip"}
}

// embeddedPluginVersion to wersja z _meta.lua wbudowanego pluginu ("" gdy nieczytelna).
// Panel porównuje z nią wersje pluginów na czytnikach (TASK-49).
func embeddedPluginVersion() string {
	meta, err := pluginFS.ReadFile("plugin/koligilo.koplugin/_meta.lua")
	if err != nil {
		return ""
	}
	return parsePluginMeta(string(meta)).Version
}

func servePluginZip(w http.ResponseWriter, r *http.Request) {
	b, _, err := pluginZip()
	if err != nil {
		http.Error(w, "nie udało się spakować pluginu", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="koligilo.koplugin-`+Version+`.zip"`)
	w.Write(b)
}
