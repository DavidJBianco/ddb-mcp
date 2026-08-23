package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/chromedp/cdproto/network"
)

const sessionSchemaVersion = 1

type storageCookie struct {
	Name     string  `json:"name"`
	Value    string  `json:"value"`
	Domain   string  `json:"domain"`
	Path     string  `json:"path"`
	Expires  float64 `json:"expires"`
	HTTPOnly bool    `json:"httpOnly"`
	Secure   bool    `json:"secure"`
	SameSite string  `json:"sameSite"`
}

type localStorageItem struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type storageOrigin struct {
	Origin       string             `json:"origin"`
	LocalStorage []localStorageItem `json:"localStorage"`
}

type storageState struct {
	Cookies []storageCookie `json:"cookies"`
	Origins []storageOrigin `json:"origins"`
}

func isDDBDomain(domain string) bool {
	normalized := strings.TrimPrefix(strings.ToLower(domain), ".")
	return normalized == "dndbeyond.com" || strings.HasSuffix(normalized, ".dndbeyond.com")
}

func cookieExpiry(cookie *network.Cookie) float64 {
	if cookie.Expires == 0 {
		return -1
	}
	return cookie.Expires
}

func stateFromBrowser(cookies []*network.Cookie, localStorage map[string]string) (storageState, error) {
	state := storageState{Cookies: []storageCookie{}, Origins: []storageOrigin{}}
	for _, cookie := range cookies {
		if !isDDBDomain(cookie.Domain) {
			continue
		}
		sameSite := string(cookie.SameSite)
		if sameSite == "" {
			sameSite = "Lax"
		}
		state.Cookies = append(state.Cookies, storageCookie{
			Name: cookie.Name, Value: cookie.Value, Domain: cookie.Domain, Path: cookie.Path,
			Expires: cookieExpiry(cookie), HTTPOnly: cookie.HTTPOnly, Secure: cookie.Secure, SameSite: sameSite,
		})
	}
	if len(state.Cookies) == 0 {
		return storageState{}, fmt.Errorf("the authenticated browser returned no D&D Beyond cookies")
	}
	items := make([]localStorageItem, 0, len(localStorage))
	for name, value := range localStorage {
		items = append(items, localStorageItem{Name: name, Value: value})
	}
	if len(items) > 0 {
		state.Origins = append(state.Origins, storageOrigin{Origin: "https://www.dndbeyond.com", LocalStorage: items})
	}
	return state, nil
}

func (state storageState) marshal() ([]byte, error) {
	data, err := json.Marshal(state)
	if err != nil {
		return nil, fmt.Errorf("encode session state: %w", err)
	}
	if len(data) > 1_048_576 {
		return nil, fmt.Errorf("session state exceeds the 1 MiB safety limit")
	}
	return data, nil
}

func cookiesObviouslyExpired(state storageState, now time.Time) bool {
	for _, cookie := range state.Cookies {
		if cookie.Expires < 0 || cookie.Expires > float64(now.Unix()) {
			return false
		}
	}
	return len(state.Cookies) > 0
}
