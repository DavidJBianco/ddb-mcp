package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

var defaultImage = "mysterium:local"

type commonOptions struct {
	volume      string
	image       string
	browserPath string
	timeout     time.Duration
	jsonOutput  bool
	force       bool
	ephemeral   bool
	live        bool
}

type report struct {
	OK                bool               `json:"ok"`
	Status            string             `json:"status"`
	Version           string             `json:"version"`
	DockerContext     string             `json:"dockerContext,omitempty"`
	Volume            string             `json:"volume"`
	Image             string             `json:"image"`
	ImagePresent      bool               `json:"imagePresent"`
	VolumeExists      bool               `json:"volumeExists"`
	VolumeOwned       bool               `json:"volumeOwned"`
	SessionStatus     string             `json:"sessionStatus"`
	BrowserStatus     string             `json:"browserStatus"`
	Browsers          []browserCandidate `json:"browsers,omitempty"`
	RecommendedAction string             `json:"recommendedAction,omitempty"`
}

func flagsFor(name string, args []string) (*flag.FlagSet, commonOptions, error) {
	set := flag.NewFlagSet(name, flag.ContinueOnError)
	set.SetOutput(os.Stderr)
	options := commonOptions{}
	set.StringVar(&options.volume, "volume", defaultVolume, "Docker volume containing D&D Beyond session state")
	set.StringVar(&options.image, "image", defaultImage, "matching mysterium image used for session administration")
	set.StringVar(&options.browserPath, "browser-path", "", "absolute path to a Chromium-compatible browser executable")
	set.DurationVar(&options.timeout, "timeout", 5*time.Minute, "interactive login timeout")
	set.BoolVar(&options.jsonOutput, "json", false, "emit machine-readable JSON")
	set.BoolVar(&options.force, "force", false, "skip destructive confirmation")
	set.BoolVar(&options.ephemeral, "ephemeral", false, "skip existing-browser reuse and launch a temporary profile")
	set.BoolVar(&options.live, "live", false, "perform a bounded read-only D&D Beyond authentication check")
	if err := set.Parse(args); err != nil {
		return nil, options, err
	}
	if set.NArg() != 0 {
		return nil, options, fmt.Errorf("unexpected arguments: %s", strings.Join(set.Args(), " "))
	}
	return set, options, nil
}

func clientFor(options commonOptions) dockerClient {
	return dockerClient{runner: execRunner{}, image: options.image, volume: options.volume, helperVersion: version}
}

func printJSON(value any) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func inspect(options commonOptions) (report, error) {
	client := clientFor(options)
	contextName, err := client.check()
	if err != nil {
		return report{}, err
	}
	browsers, browserErr := discoverBrowsers(options.browserPath)
	inspection, volumeErr := client.inspectVolume()
	if volumeErr != nil {
		return report{}, volumeErr
	}
	result := report{OK: true, Status: "ready", Version: version, DockerContext: contextName, Volume: options.volume, Image: options.image, ImagePresent: client.imagePresent(), Browsers: browsers, BrowserStatus: "detected"}
	if inspection != nil {
		result.VolumeExists = true
		result.VolumeOwned = labelsOwned(inspection.Labels)
		if !result.VolumeOwned {
			result.OK = false
			result.Status = "unmanaged-volume"
			result.SessionStatus = "unchecked"
			result.RecommendedAction = fmt.Sprintf("Volume %s is not managed by mysterium-auth; move or remove it manually before login.", options.volume)
		} else if !result.ImagePresent {
			result.SessionStatus = "unchecked"
			result.RecommendedAction = "Run mysterium-auth validate or login."
		} else if _, err := client.validate(false); err == nil {
			result.SessionStatus = "valid"
		} else {
			result.SessionStatus = "missing-or-invalid"
			result.RecommendedAction = "Run mysterium-auth login."
		}
	} else {
		result.SessionStatus = "missing"
		result.RecommendedAction = "Run mysterium-auth login."
	}
	if browserErr != nil {
		result.OK = false
		result.BrowserStatus = "missing-or-invalid"
		result.Browsers = nil
		result.RecommendedAction = strings.TrimSpace(result.RecommendedAction + " " + browserErr.Error())
	}
	return result, nil
}

func confirm(reader *bufio.Reader, message string, force bool) bool {
	if force {
		return true
	}
	fmt.Fprintf(os.Stderr, "%s [y/N] ", message)
	answer, _ := reader.ReadString('\n')
	answer = strings.ToLower(strings.TrimSpace(answer))
	return answer == "y" || answer == "yes"
}

func runLogin(options commonOptions) error {
	client := clientFor(options)
	if _, err := client.check(); err != nil {
		return err
	}
	if err := client.ensureCompatibleImage(); err != nil {
		return err
	}
	if err := client.ensureVolume(); err != nil {
		return err
	}
	browsers, err := discoverBrowsers(options.browserPath)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), options.timeout)
	defer cancel()
	candidate, err := selectCapableBrowser(ctx, browsers)
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "Using %s at %s\n", candidate.Name, candidate.Path)
	state, mode, err := loginWithFallback(ctx, candidate, options.ephemeral, bufio.NewReader(os.Stdin))
	if err != nil {
		return err
	}
	data, err := state.marshal()
	if err != nil {
		return err
	}
	result, err := client.importState(data)
	if err != nil {
		return err
	}
	if options.jsonOutput {
		return printJSON(map[string]any{"ok": true, "status": result.Status, "browserMode": mode, "volume": options.volume, "schemaVersion": result.SchemaVersion})
	}
	fmt.Printf("D&D Beyond authentication saved to Docker volume %s and verified in the MCP container.\n", options.volume)
	return nil
}

func runValidate(options commonOptions, live bool) error {
	client := clientFor(options)
	contextName, err := client.check()
	if err != nil {
		return err
	}
	browsers, err := discoverBrowsers(options.browserPath)
	if err != nil {
		return err
	}
	probeContext, cancelProbe := context.WithTimeout(context.Background(), options.timeout)
	browser, err := selectCapableBrowser(probeContext, browsers)
	cancelProbe()
	if err != nil {
		return err
	}
	if err := client.ensureCompatibleImage(); err != nil {
		return err
	}
	inspection, err := client.inspectVolume()
	if err != nil {
		return err
	}
	if inspection == nil || !labelsOwned(inspection.Labels) {
		return fmt.Errorf("the labeled session volume %q does not exist", options.volume)
	}
	result, err := client.validate(live)
	if err != nil {
		return err
	}
	if options.jsonOutput {
		return printJSON(map[string]any{
			"ok": result.OK, "status": result.Status, "schemaVersion": result.SchemaVersion,
			"helperVersion": result.HelperVersion, "createdAt": result.CreatedAt,
			"dockerContext": contextName, "image": options.image, "volume": options.volume,
			"browser": browser,
		})
	}
	fmt.Printf("Browser %s passed the local debugging probe. Session volume %s is %s.\n", browser.Name, options.volume, result.Status)
	return nil
}

func runInfo(options commonOptions) error {
	result, err := inspect(options)
	if err != nil {
		return err
	}
	if options.jsonOutput {
		return printJSON(result)
	}
	fmt.Printf("mysterium-auth %s\nDocker context: %s\nImage: %s (%s)\nVolume: %s (%s)\nSession: %s\nBrowser: %s\n", result.Version, result.DockerContext, result.Image, map[bool]string{true: "present", false: "missing"}[result.ImagePresent], result.Volume, map[bool]string{true: "present", false: "missing"}[result.VolumeExists], result.SessionStatus, result.BrowserStatus)
	for _, browser := range result.Browsers {
		fmt.Printf("Browser: %s (%s)\n", browser.Name, browser.Path)
	}
	if result.RecommendedAction != "" {
		fmt.Printf("Recommended action: %s\n", result.RecommendedAction)
	}
	return nil
}

func printHelp(writer io.Writer) {
	fmt.Fprintln(writer, `Usage: mysterium-auth <command> [options]

Commands:
  login          Authenticate in a host Chromium browser and import the session
  validate       Validate Docker, browser, volume, metadata, and session state
  info           Report detected configuration and the recommended action
  reset          Remove saved session files while preserving the volume
  volume remove  Remove the helper-owned session volume
  version        Print the helper version
  help           Show this help

Run "mysterium-auth <command> --help" for command options.`)
}

func usage() {
	printHelp(os.Stderr)
}

func run(args []string) error {
	if len(args) == 0 {
		usage()
		return errors.New("a command is required")
	}
	command := args[0]
	if command == "help" || command == "--help" || command == "-h" {
		if len(args) != 1 {
			return errors.New("help does not accept arguments")
		}
		printHelp(os.Stdout)
		return nil
	}
	if command == "version" {
		fmt.Printf("mysterium-auth %s\n", version)
		return nil
	}
	if command == "volume" {
		if len(args) < 2 || args[1] != "remove" {
			return errors.New("usage: mysterium-auth volume remove [options]")
		}
		args = append([]string{"volume-remove"}, args[2:]...)
		command = "volume-remove"
	}
	_, options, err := flagsFor(command, args[1:])
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	switch command {
	case "login":
		return runLogin(options)
	case "validate":
		return runValidate(options, options.live)
	case "info":
		return runInfo(options)
	case "reset":
		reader := bufio.NewReader(os.Stdin)
		if !confirm(reader, "Delete saved D&D Beyond authentication from the volume?", options.force) {
			return errors.New("reset cancelled")
		}
		client := clientFor(options)
		if _, err := client.check(); err != nil {
			return err
		}
		if err := client.ensureCompatibleImage(); err != nil {
			return err
		}
		if _, err := client.requireOwnedVolume(); err != nil {
			return err
		}
		if err := client.reset(); err != nil {
			return err
		}
		fmt.Println("Saved authentication removed. This does not revoke the D&D Beyond server-side session.")
		return nil
	case "volume-remove":
		reader := bufio.NewReader(os.Stdin)
		if !confirm(reader, "Permanently remove the mysterium session volume?", options.force) {
			return errors.New("volume removal cancelled")
		}
		return clientFor(options).removeVolume()
	default:
		usage()
		return fmt.Errorf("unknown command %q", command)
	}
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		for _, argument := range os.Args[1:] {
			if argument == "--json" {
				_ = printJSON(map[string]any{"ok": false, "status": "error", "error": err.Error()})
				os.Exit(1)
			}
		}
		fmt.Fprintf(os.Stderr, "mysterium-auth: %s\n", err)
		os.Exit(1)
	}
}
