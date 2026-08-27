package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
)

type browserCandidate struct {
	Name         string   `json:"name"`
	Path         string   `json:"path"`
	UserDataDirs []string `json:"-"`
}

var dialTimeout = net.DialTimeout
var probeCandidate = probeBrowser
var findExistingEndpoint = waitForEndpoint
var browserAppearsRunning = plausiblyRunning
var performExistingLogin = loginInExistingBrowser
var performEphemeralLogin = loginInEphemeralBrowser

const ddbLoginURL = "https://www.dndbeyond.com/login"

func existingLoginArgs() []string {
	return []string{"--new-tab", ddbLoginURL}
}

func ephemeralLoginArgs(profile string) []string {
	return []string{
		"--user-data-dir=" + profile,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-background-mode",
		"--new-window",
		ddbLoginURL,
	}
}

func existingFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func addCandidate(result []browserCandidate, seen map[string]bool, name, path string, dataDirs ...string) []browserCandidate {
	if path == "" || !existingFile(path) {
		return result
	}
	abs, err := filepath.Abs(path)
	if err != nil || seen[abs] {
		return result
	}
	seen[abs] = true
	return append(result, browserCandidate{Name: name, Path: abs, UserDataDirs: dataDirs})
}

func discoverBrowsers(explicit string) ([]browserCandidate, error) {
	if explicit != "" {
		if !existingFile(explicit) {
			return nil, fmt.Errorf("the browser path does not identify an executable file")
		}
		return []browserCandidate{{Name: "Custom Chromium", Path: explicit}}, nil
	}

	home, _ := os.UserHomeDir()
	seen := map[string]bool{}
	result := []browserCandidate{}
	switch runtime.GOOS {
	case "darwin":
		library := filepath.Join(home, "Library", "Application Support")
		result = addCandidate(result, seen, "Google Chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", filepath.Join(library, "Google", "Chrome"))
		result = addCandidate(result, seen, "Microsoft Edge", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", filepath.Join(library, "Microsoft Edge"))
		result = addCandidate(result, seen, "Brave", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", filepath.Join(library, "BraveSoftware", "Brave-Browser"))
		result = addCandidate(result, seen, "Vivaldi", "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi", filepath.Join(library, "Vivaldi"))
		result = addCandidate(result, seen, "Chromium", "/Applications/Chromium.app/Contents/MacOS/Chromium", filepath.Join(library, "Chromium"))
	case "windows":
		local := os.Getenv("LOCALAPPDATA")
		programFiles := []string{os.Getenv("PROGRAMFILES"), os.Getenv("PROGRAMFILES(X86)"), local}
		for _, base := range programFiles {
			result = addCandidate(result, seen, "Google Chrome", filepath.Join(base, "Google", "Chrome", "Application", "chrome.exe"), filepath.Join(local, "Google", "Chrome", "User Data"))
			result = addCandidate(result, seen, "Microsoft Edge", filepath.Join(base, "Microsoft", "Edge", "Application", "msedge.exe"), filepath.Join(local, "Microsoft", "Edge", "User Data"))
			result = addCandidate(result, seen, "Brave", filepath.Join(base, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"), filepath.Join(local, "BraveSoftware", "Brave-Browser", "User Data"))
			result = addCandidate(result, seen, "Vivaldi", filepath.Join(base, "Vivaldi", "Application", "vivaldi.exe"), filepath.Join(local, "Vivaldi", "User Data"))
		}
	case "linux":
		commands := []struct{ name, command, config string }{
			{"Google Chrome", "google-chrome", "google-chrome"},
			{"Google Chrome", "google-chrome-stable", "google-chrome"},
			{"Microsoft Edge", "microsoft-edge", "microsoft-edge"},
			{"Microsoft Edge", "microsoft-edge-stable", "microsoft-edge"},
			{"Brave", "brave-browser", "BraveSoftware/Brave-Browser"},
			{"Chromium", "chromium", "chromium"},
			{"Chromium", "chromium-browser", "chromium"},
			{"Vivaldi", "vivaldi", "vivaldi"},
		}
		for _, item := range commands {
			if path, err := exec.LookPath(item.command); err == nil {
				result = addCandidate(result, seen, item.name, path, filepath.Join(home, ".config", item.config))
			}
		}
	default:
		return nil, fmt.Errorf("unsupported host operating system: %s", runtime.GOOS)
	}
	if len(result) == 0 {
		return nil, fmt.Errorf("no supported Chromium browser was detected; install Google Chrome, Microsoft Edge, or Chromium and retry")
	}
	return result, nil
}

func endpointFromActivePort(dataDirs []string) (string, bool) {
	for _, dir := range dataDirs {
		data, err := os.ReadFile(filepath.Join(dir, "DevToolsActivePort"))
		if err != nil {
			continue
		}
		lines := strings.Fields(string(data))
		if len(lines) < 2 {
			continue
		}
		port, err := strconv.Atoi(lines[0])
		if err != nil || port < 1 || port > 65535 {
			continue
		}
		if conn, err := dialTimeout("tcp", net.JoinHostPort("127.0.0.1", lines[0]), 300*time.Millisecond); err == nil {
			_ = conn.Close()
			return fmt.Sprintf("ws://127.0.0.1:%d%s", port, lines[1]), true
		}
	}
	return "", false
}

func plausiblyRunning(candidate browserCandidate) bool {
	if _, ok := endpointFromActivePort(candidate.UserDataDirs); ok {
		return true
	}
	for _, dir := range candidate.UserDataDirs {
		for _, marker := range []string{"SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile"} {
			if _, err := os.Lstat(filepath.Join(dir, marker)); err == nil {
				return true
			}
		}
	}
	return false
}

func promptExisting(reader *bufio.Reader, writer io.Writer, browser browserCandidate) bool {
	fmt.Fprintf(writer, "A running %s may be able to reuse your existing sign-in and password-manager session.\n", browser.Name)
	fmt.Fprintln(writer, "Debugging access technically permits inspecting all tabs; this helper opens and controls only a new D&D Beyond tab and does not log existing tabs.")
	fmt.Fprint(writer, "Approve temporary debugging access and try to reuse it? [y/N] ")
	answer, _ := reader.ReadString('\n')
	answer = strings.ToLower(strings.TrimSpace(answer))
	return answer == "y" || answer == "yes"
}

func temporaryProfile(prefix string) (string, func(), error) {
	profile, err := os.MkdirTemp("", prefix)
	if err != nil {
		return "", nil, err
	}
	return profile, func() { _ = os.RemoveAll(profile) }, nil
}

func probeBrowser(ctx context.Context, candidate browserCandidate) error {
	profile, cleanup, err := temporaryProfile("mysterium-auth-probe-")
	if err != nil {
		return err
	}
	defer cleanup()
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.ExecPath(candidate.Path),
		chromedp.UserDataDir(profile),
		chromedp.Flag("headless", true),
		chromedp.Flag("no-first-run", true),
		chromedp.Flag("no-default-browser-check", true),
	)
	allocatorContext, cancelAllocator := chromedp.NewExecAllocator(ctx, opts...)
	defer cancelAllocator()
	browserContext, cancelBrowser := chromedp.NewContext(allocatorContext)
	defer cancelBrowser()
	var value string
	if err := chromedp.Run(browserContext, chromedp.Navigate("about:blank"), chromedp.Evaluate(`"mysterium-cdp"`, &value)); err != nil {
		return err
	}
	if value != "mysterium-cdp" {
		return errors.New("CDP evaluation returned an unexpected result")
	}
	return nil
}

func selectCapableBrowser(ctx context.Context, candidates []browserCandidate) (browserCandidate, error) {
	var failures []string
	for _, candidate := range candidates {
		probeContext, cancel := context.WithTimeout(ctx, 10*time.Second)
		err := probeCandidate(probeContext, candidate)
		cancel()
		if err == nil {
			return candidate, nil
		}
		failures = append(failures, candidate.Name)
	}
	return browserCandidate{}, fmt.Errorf("no detected Chromium browser passed the local debugging capability probe (%s); install or update Google Chrome, Microsoft Edge, or Chromium", strings.Join(failures, ", "))
}

func waitForEndpoint(ctx context.Context, candidate browserCandidate) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if endpoint, ok := endpointFromActivePort(candidate.UserDataDirs); ok {
		return endpoint, nil
	}
	return "", errors.New("running browser does not expose a compatible standard CDP endpoint")
}

func captureBrowserSession(ctx context.Context, candidate browserCandidate, endpoint, profile string) (storageState, error) {
	var allocatorContext context.Context
	var cancelAllocator context.CancelFunc
	if endpoint != "" {
		allocatorContext, cancelAllocator = chromedp.NewRemoteAllocator(ctx, endpoint)
	} else {
		if profile == "" {
			return storageState{}, errors.New("temporary browser profile is required for local capture")
		}
		opts := []chromedp.ExecAllocatorOption{
			chromedp.ExecPath(candidate.Path),
			chromedp.UserDataDir(profile),
			chromedp.Headless,
			chromedp.NoFirstRun,
			chromedp.NoDefaultBrowserCheck,
		}
		allocatorContext, cancelAllocator = chromedp.NewExecAllocator(ctx, opts...)
	}
	defer cancelAllocator()

	browserContext, cancelBrowser := chromedp.NewContext(allocatorContext)
	defer cancelBrowser()
	fmt.Fprintln(os.Stderr, "Verifying the completed D&D Beyond login...")
	var initialLocation string
	if err := chromedp.Run(browserContext,
		network.Enable(),
		chromedp.Navigate("https://www.dndbeyond.com"),
		page.BringToFront(),
		chromedp.Location(&initialLocation),
		chromedp.Sleep(2*time.Second),
	); err != nil {
		return storageState{}, fmt.Errorf("verify D&D Beyond login: %w", err)
	}
	if !isDDBLocation(initialLocation) {
		return storageState{}, errors.New("D&D Beyond redirected away during login verification")
	}
	var location string
	var signedIn bool
	script := `(() => !Array.from(document.querySelectorAll('a,button')).some((el) => ['sign in','log in'].includes((el.textContent || '').trim().toLowerCase())))()`
	if err := chromedp.Run(browserContext, chromedp.Location(&location), chromedp.Evaluate(script, &signedIn)); err != nil {
		return storageState{}, fmt.Errorf("inspect D&D Beyond login: %w", err)
	}
	if !isAuthenticatedDDBLocation(location, signedIn) {
		return storageState{}, errors.New("D&D Beyond is not signed in; complete authentication in the uncontrolled browser window before continuing")
	}
	var cookies []*network.Cookie
	if err := chromedp.Run(browserContext, chromedp.ActionFunc(func(actionContext context.Context) error {
		var cookieErr error
		cookies, cookieErr = network.GetCookies().WithURLs([]string{
			"https://www.dndbeyond.com", "https://character-service.dndbeyond.com",
		}).Do(actionContext)
		return cookieErr
	})); err != nil {
		return storageState{}, fmt.Errorf("read D&D Beyond cookies: %w", err)
	}
	localStorage := map[string]string{}
	if err := chromedp.Run(browserContext, chromedp.Evaluate(`Object.fromEntries(Object.entries(localStorage))`, &localStorage)); err != nil {
		return storageState{}, fmt.Errorf("read D&D Beyond local storage: %w", err)
	}
	return stateFromBrowser(cookies, localStorage)
}

func loginInExistingBrowser(ctx context.Context, candidate browserCandidate, endpoint string, reader *bufio.Reader) (storageState, error) {
	command := exec.Command(candidate.Path, existingLoginArgs()...)
	if err := command.Start(); err != nil {
		return storageState{}, fmt.Errorf("open uncontrolled D&D Beyond login tab: %w", err)
	}
	_ = command.Process.Release()
	fmt.Fprint(os.Stderr, "Complete D&D Beyond sign-in in the new browser tab, then press Enter here to continue: ")
	if _, err := reader.ReadString('\n'); err != nil {
		return storageState{}, fmt.Errorf("wait for login confirmation: %w", err)
	}
	fmt.Fprintln(os.Stderr, "Chrome may now ask you to allow the brief debugging connection used to export D&D Beyond state.")
	return captureBrowserSession(ctx, candidate, endpoint, "")
}

func loginInEphemeralBrowser(ctx context.Context, candidate browserCandidate, reader *bufio.Reader) (storageState, error) {
	profile, cleanup, err := temporaryProfile("mysterium-auth-browser-")
	if err != nil {
		return storageState{}, fmt.Errorf("create temporary browser profile: %w", err)
	}
	defer cleanup()
	command := exec.Command(candidate.Path, ephemeralLoginArgs(profile)...)
	if err := command.Start(); err != nil {
		return storageState{}, fmt.Errorf("open uncontrolled temporary browser: %w", err)
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	fmt.Fprint(os.Stderr, "Complete D&D Beyond sign-in, then press Enter here; the helper will close only its temporary browser: ")
	inputDone := make(chan error, 1)
	go func() {
		_, readErr := reader.ReadString('\n')
		inputDone <- readErr
	}()
	select {
	case <-ctx.Done():
		_ = command.Process.Kill()
		<-done
		return storageState{}, fmt.Errorf("login timed out: %w", ctx.Err())
	case <-done:
	case readErr := <-inputDone:
		if readErr != nil {
			_ = command.Process.Kill()
			<-done
			return storageState{}, fmt.Errorf("wait for login confirmation: %w", readErr)
		}
		_ = command.Process.Signal(os.Interrupt)
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			_ = command.Process.Kill()
			<-done
		}
	}
	return captureBrowserSession(ctx, candidate, "", profile)
}

func isAuthenticatedDDBLocation(location string, signedIn bool) bool {
	if !signedIn {
		return false
	}
	if !isDDBLocation(location) {
		return false
	}
	parsed, _ := url.Parse(location)
	path := strings.ToLower(parsed.Path)
	return path != "/login" && !strings.HasPrefix(path, "/login/") &&
		path != "/sign-in" && !strings.HasPrefix(path, "/sign-in/")
}

func isDDBLocation(location string) bool {
	parsed, err := url.Parse(location)
	if err != nil || parsed.Scheme != "https" || (parsed.Hostname() != "www.dndbeyond.com" && parsed.Hostname() != "dndbeyond.com") {
		return false
	}
	return true
}

func loginWithFallback(ctx context.Context, candidate browserCandidate, ephemeral bool, reader *bufio.Reader) (storageState, string, error) {
	if !ephemeral && browserAppearsRunning(candidate) {
		endpoint, endpointErr := findExistingEndpoint(ctx, candidate)
		if endpointErr == nil && promptExisting(reader, os.Stderr, candidate) {
			state, loginErr := performExistingLogin(ctx, candidate, endpoint, reader)
			if loginErr == nil {
				return state, "existing", nil
			}
			fmt.Fprintln(os.Stderr, "Existing-browser attachment failed; using a temporary browser profile instead.")
		} else if endpointErr != nil {
			fmt.Fprintln(os.Stderr, "The running browser does not expose a compatible debugging endpoint; using a temporary browser profile instead.")
		}
	}
	state, err := performEphemeralLogin(ctx, candidate, reader)
	return state, "ephemeral", err
}
