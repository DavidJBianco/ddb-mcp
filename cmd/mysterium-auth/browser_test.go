package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type syntheticConnection struct{ net.Conn }

func (syntheticConnection) Close() error { return nil }

func TestExplicitBrowserPath(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "chromium")
	if err := os.WriteFile(path, []byte("synthetic"), 0o700); err != nil {
		t.Fatal(err)
	}
	browsers, err := discoverBrowsers(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(browsers) != 1 || browsers[0].Path != path {
		t.Fatalf("unexpected discovery: %#v", browsers)
	}
	if _, err := discoverBrowsers(filepath.Join(directory, "missing")); err == nil {
		t.Fatal("missing explicit browser path should fail")
	}
}

func TestEndpointFromActivePortRequiresLiveLocalEndpoint(t *testing.T) {
	directory := t.TempDir()
	port := 43123
	originalDial := dialTimeout
	t.Cleanup(func() { dialTimeout = originalDial })
	dialTimeout = func(string, string, time.Duration) (net.Conn, error) { return syntheticConnection{}, nil }
	if err := os.WriteFile(filepath.Join(directory, "DevToolsActivePort"), []byte(fmt.Sprintf("%d\n/devtools/browser/synthetic\n", port)), 0o600); err != nil {
		t.Fatal(err)
	}
	endpoint, ok := endpointFromActivePort([]string{directory})
	if !ok || endpoint != fmt.Sprintf("ws://127.0.0.1:%d/devtools/browser/synthetic", port) {
		t.Fatalf("unexpected endpoint: %q %v", endpoint, ok)
	}
	dialTimeout = func(string, string, time.Duration) (net.Conn, error) { return nil, fmt.Errorf("closed") }
	if _, ok := endpointFromActivePort([]string{directory}); ok {
		t.Fatal("closed endpoint must be rejected")
	}
}

func TestDDBDomainMatching(t *testing.T) {
	for _, domain := range []string{"dndbeyond.com", ".dndbeyond.com", "character-service.dndbeyond.com"} {
		if !isDDBDomain(domain) {
			t.Fatalf("expected D&D Beyond domain: %s", domain)
		}
	}
	for _, domain := range []string{"example.com", "dndbeyond.com.example.com"} {
		if isDDBDomain(domain) {
			t.Fatalf("unexpected D&D Beyond domain: %s", domain)
		}
	}
}

func TestPromptExistingRequiresAffirmativeConsentAndExplainsScope(t *testing.T) {
	var output strings.Builder
	if promptExisting(bufio.NewReader(strings.NewReader("no\n")), &output, browserCandidate{Name: "Chromium"}) {
		t.Fatal("negative response must decline attachment")
	}
	if !strings.Contains(output.String(), "all tabs") || !strings.Contains(output.String(), "only a new D&D Beyond tab") {
		t.Fatalf("scope was not explained: %s", output.String())
	}
	if !strings.HasSuffix(output.String(), "[y/N] ") {
		t.Fatalf("consent question is not an inline prompt: %q", output.String())
	}
	if !promptExisting(bufio.NewReader(strings.NewReader("yes\n")), io.Discard, browserCandidate{Name: "Chromium"}) {
		t.Fatal("affirmative response must allow attachment")
	}
}

func TestCapabilitySelectionSkipsUnsupportedCandidates(t *testing.T) {
	original := probeCandidate
	t.Cleanup(func() { probeCandidate = original })
	probeCandidate = func(_ context.Context, candidate browserCandidate) error {
		if candidate.Name == "Unsupported" {
			return fmt.Errorf("no CDP")
		}
		return nil
	}
	selected, err := selectCapableBrowser(context.Background(), []browserCandidate{{Name: "Unsupported"}, {Name: "Supported"}})
	if err != nil || selected.Name != "Supported" {
		t.Fatalf("unexpected selection: %#v %v", selected, err)
	}
}

func TestLoginFallbackPaths(t *testing.T) {
	originalEndpoint := findExistingEndpoint
	originalExisting := performExistingLogin
	originalEphemeral := performEphemeralLogin
	originalRunning := browserAppearsRunning
	t.Cleanup(func() {
		findExistingEndpoint = originalEndpoint
		performExistingLogin = originalExisting
		performEphemeralLogin = originalEphemeral
		browserAppearsRunning = originalRunning
	})
	browserAppearsRunning = func(browserCandidate) bool { return true }
	candidate := browserCandidate{Name: "Chromium"}
	wanted := storageState{Cookies: []storageCookie{{Domain: ".dndbeyond.com"}}, Origins: []storageOrigin{}}

	endpointCalls := 0
	findExistingEndpoint = func(context.Context, browserCandidate) (string, error) {
		endpointCalls++
		return "ws://127.0.0.1/devtools/browser/test", nil
	}
	var calls []string
	performExistingLogin = func(_ context.Context, _ browserCandidate, endpoint string, _ *bufio.Reader) (storageState, error) {
		calls = append(calls, "existing:"+endpoint)
		return wanted, nil
	}
	performEphemeralLogin = func(_ context.Context, _ browserCandidate, _ *bufio.Reader) (storageState, error) {
		calls = append(calls, "ephemeral")
		return wanted, nil
	}
	_, mode, err := loginWithFallback(context.Background(), candidate, false, bufio.NewReader(strings.NewReader("no\n")))
	if err != nil || mode != "ephemeral" || endpointCalls != 1 || len(calls) != 1 || calls[0] != "ephemeral" {
		t.Fatalf("decline fallback failed: mode=%s endpointCalls=%d calls=%v err=%v", mode, endpointCalls, calls, err)
	}

	calls = nil
	findExistingEndpoint = func(context.Context, browserCandidate) (string, error) { return "", fmt.Errorf("unsupported") }
	_, mode, err = loginWithFallback(context.Background(), candidate, false, bufio.NewReader(strings.NewReader("yes\n")))
	if err != nil || mode != "ephemeral" || len(calls) != 1 || calls[0] != "ephemeral" {
		t.Fatalf("unsupported attachment fallback failed: mode=%s calls=%v err=%v", mode, calls, err)
	}

	calls = nil
	findExistingEndpoint = func(context.Context, browserCandidate) (string, error) { return "ws://existing", nil }
	_, mode, err = loginWithFallback(context.Background(), candidate, false, bufio.NewReader(strings.NewReader("yes\n\n")))
	if err != nil || mode != "existing" || len(calls) != 1 || calls[0] != "existing:ws://existing" {
		t.Fatalf("attachment path failed: mode=%s calls=%v err=%v", mode, calls, err)
	}
}

func TestUnavailableExistingEndpointFallsBackWithoutWaiting(t *testing.T) {
	started := time.Now()
	_, err := waitForEndpoint(context.Background(), browserCandidate{Name: "Chromium"})
	if err == nil || !strings.Contains(err.Error(), "standard CDP endpoint") {
		t.Fatalf("unexpected result: %v", err)
	}
	if time.Since(started) > time.Second {
		t.Fatal("unavailable endpoint should be rejected immediately")
	}
}

func TestPlausibleRunningBrowserUsesProfileMarkers(t *testing.T) {
	directory := t.TempDir()
	candidate := browserCandidate{UserDataDirs: []string{directory}}
	if plausiblyRunning(candidate) {
		t.Fatal("empty profile must not appear to be running")
	}
	if err := os.WriteFile(filepath.Join(directory, "SingletonLock"), []byte("synthetic"), 0o600); err != nil {
		t.Fatal(err)
	}
	if !plausiblyRunning(candidate) {
		t.Fatal("profile singleton marker should indicate a plausible running browser")
	}
}

func TestLoginTimeoutIsReported(t *testing.T) {
	originalLogin := performEphemeralLogin
	t.Cleanup(func() { performEphemeralLogin = originalLogin })
	performEphemeralLogin = func(ctx context.Context, _ browserCandidate, _ *bufio.Reader) (storageState, error) {
		<-ctx.Done()
		return storageState{}, ctx.Err()
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	_, _, err := loginWithFallback(ctx, browserCandidate{Name: "Chromium"}, true, bufio.NewReader(strings.NewReader("")))
	if err == nil || !strings.Contains(err.Error(), "deadline") {
		t.Fatalf("unexpected timeout error: %v", err)
	}
}

func TestSyntheticLoginRedirectClassification(t *testing.T) {
	for _, location := range []string{
		"https://www.dndbeyond.com/login",
		"https://www.dndbeyond.com/sign-in?returnUrl=%2Fcharacters",
		"https://www.dndbeyond.com.evil.example/characters",
		"https://accounts.google.com/o/oauth2/auth",
	} {
		if isAuthenticatedDDBLocation(location, true) {
			t.Fatalf("login redirect was accepted: %s", location)
		}
	}
	if isAuthenticatedDDBLocation("https://www.dndbeyond.com/characters", false) {
		t.Fatal("signed-out page was accepted")
	}
	if !isAuthenticatedDDBLocation("https://www.dndbeyond.com/characters", true) {
		t.Fatal("authenticated D&D Beyond page was rejected")
	}
}

func TestTemporaryProfileCleanup(t *testing.T) {
	profile, cleanup, err := temporaryProfile("mysterium-auth-cleanup-test-")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(profile, "marker"), []byte("synthetic"), 0o600); err != nil {
		t.Fatal(err)
	}
	cleanup()
	if _, err := os.Stat(profile); !os.IsNotExist(err) {
		t.Fatalf("temporary profile still exists: %v", err)
	}
}

func TestInteractiveLoginLaunchesWithoutAutomationFlags(t *testing.T) {
	for _, args := range [][]string{existingLoginArgs(), ephemeralLoginArgs("/tmp/synthetic-profile")} {
		joined := strings.Join(args, " ")
		for _, forbidden := range []string{"enable-automation", "remote-debugging", "headless"} {
			if strings.Contains(joined, forbidden) {
				t.Fatalf("interactive login contains %q: %s", forbidden, joined)
			}
		}
		if !strings.Contains(joined, ddbLoginURL) {
			t.Fatalf("interactive login omitted D&D Beyond: %s", joined)
		}
	}
}
