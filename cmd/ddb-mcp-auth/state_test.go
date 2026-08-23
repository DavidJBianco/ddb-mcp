package main

import (
	"strings"
	"testing"
	"time"

	"github.com/chromedp/cdproto/network"
)

func TestStateFromBrowserFiltersNonDDBState(t *testing.T) {
	cookies := []*network.Cookie{
		{Name: "ddb", Value: "secret", Domain: ".dndbeyond.com", Path: "/", Expires: 4_102_444_800, HTTPOnly: true, Secure: true, SameSite: network.CookieSameSiteLax},
		{Name: "google", Value: "do-not-export", Domain: ".google.com", Path: "/", Expires: 4_102_444_800},
	}
	state, err := stateFromBrowser(cookies, map[string]string{"theme": "dark"})
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Cookies) != 1 || state.Cookies[0].Name != "ddb" {
		t.Fatalf("unexpected filtered cookies: %#v", state.Cookies)
	}
	encoded, err := state.marshal()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "do-not-export") || !strings.Contains(string(encoded), "dndbeyond.com") {
		t.Fatalf("unexpected exported state: %s", encoded)
	}
}

func TestStateRequiresDDBCookie(t *testing.T) {
	_, err := stateFromBrowser([]*network.Cookie{{Name: "external", Domain: ".google.com"}}, nil)
	if err == nil || !strings.Contains(err.Error(), "no D&D Beyond cookies") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestObviouslyExpired(t *testing.T) {
	now := time.Unix(2_000, 0)
	if !cookiesObviouslyExpired(storageState{Cookies: []storageCookie{{Expires: 1_000}}}, now) {
		t.Fatal("expected expired state")
	}
	if cookiesObviouslyExpired(storageState{Cookies: []storageCookie{{Expires: -1}}}, now) {
		t.Fatal("session cookie must not be treated as obviously expired")
	}
}
