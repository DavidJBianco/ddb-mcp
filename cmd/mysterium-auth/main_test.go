package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestVersionMatchesServerPackage(t *testing.T) {
	contents, err := os.ReadFile("../../package.json")
	if err != nil {
		t.Fatalf("read package.json: %v", err)
	}
	var manifest struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(contents, &manifest); err != nil {
		t.Fatalf("parse package.json: %v", err)
	}
	if version != manifest.Version {
		t.Fatalf("helper version %q does not match server version %q", version, manifest.Version)
	}
}

func TestHelpDocumentsCommands(t *testing.T) {
	var output strings.Builder
	printHelp(&output)
	for _, command := range []string{"login", "validate", "info", "reset", "volume remove", "version", "help"} {
		if !strings.Contains(output.String(), command) {
			t.Fatalf("help omitted %q: %s", command, output.String())
		}
	}
}

func TestHelpAliasesExitSuccessfully(t *testing.T) {
	for _, alias := range []string{"help", "--help", "-h"} {
		if err := run([]string{alias}); err != nil {
			t.Fatalf("%s failed: %v", alias, err)
		}
	}
	if err := run([]string{"login", "--help"}); err != nil {
		t.Fatalf("subcommand --help failed: %v", err)
	}
}
