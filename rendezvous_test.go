package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Jeden adres nie może zapchać punktu kontaktowego: po rvPerIP sesjach
// dostaje 429, a inny adres dalej otwiera sesje.
func TestRendezvousPerIPLimit(t *testing.T) {
	mux := http.NewServeMux()
	NewRendezvous().Routes(mux)
	open := func(addr string) int {
		req := httptest.NewRequest("POST", "/api/v1/rv", strings.NewReader(`{"name":"Kobo"}`))
		req.RemoteAddr = addr
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec.Code
	}
	for i := 0; i < rvPerIP; i++ {
		if c := open("203.0.113.7:1234"); c != 200 {
			t.Fatalf("sesja %d: kod %d", i+1, c)
		}
	}
	if c := open("203.0.113.7:1234"); c != 429 {
		t.Fatalf("ponad limit: kod %d, chcę 429", c)
	}
	if c := open("198.51.100.9:1234"); c != 200 {
		t.Fatalf("inny adres: kod %d, chcę 200", c)
	}
}
