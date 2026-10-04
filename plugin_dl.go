package main

import (
	"archive/zip"
	"embed"
	"io/fs"
	"net/http"
	"path"
)

// Plugin wbudowany w binarkę: czytnik (albo człowiek w przeglądarce czytnika)
// pobiera go z serwera jednym linkiem — bez kabla i MTP na Androidzie.
// „all:” — bez niego embed pomija pliki od „_”, czyli _meta.lua.
//
//go:embed all:plugin/koligilo.koplugin
var pluginFS embed.FS

func servePluginZip(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="koligilo.koplugin-`+Version+`.zip"`)
	zw := zip.NewWriter(w)
	defer zw.Close()
	fs.WalkDir(pluginFS, "plugin", func(p string, d fs.DirEntry, err error) error {
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
}
