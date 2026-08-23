package main

import (
	"strings"
	"testing"
)

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
