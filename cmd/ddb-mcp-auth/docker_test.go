package main

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

type recordedCall struct {
	stdin []byte
	name  string
	args  []string
}

type fakeResponse struct {
	stdout string
	stderr string
	err    error
}

type fakeRunner struct {
	calls     []recordedCall
	responses []fakeResponse
}

func (runner *fakeRunner) Run(stdin []byte, name string, args ...string) ([]byte, []byte, error) {
	runner.calls = append(runner.calls, recordedCall{stdin: stdin, name: name, args: append([]string{}, args...)})
	if len(runner.responses) == 0 {
		return nil, nil, errors.New("unexpected command")
	}
	response := runner.responses[0]
	runner.responses = runner.responses[1:]
	return []byte(response.stdout), []byte(response.stderr), response.err
}

func TestEnsureVolumeCreatesLabeledVolume(t *testing.T) {
	runner := &fakeRunner{responses: []fakeResponse{
		{stderr: "Error: No such volume", err: errors.New("exit 1")},
		{stdout: "ddb-mcp-session\n"},
	}}
	client := dockerClient{runner: runner, image: "image:v1", volume: defaultVolume, helperVersion: "1.0.0"}
	if err := client.ensureVolume(); err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(runner.calls[1].args, " ")
	if !strings.Contains(joined, purposeLabel) || !strings.Contains(joined, managerLabel) {
		t.Fatalf("missing labels in command: %s", joined)
	}
}

func TestEnsureVolumeRecreatesOnlyUnlabeledEmptyVolume(t *testing.T) {
	runner := &fakeRunner{responses: []fakeResponse{
		{stdout: `[{"Name":"volume","Labels":{}}]`},
		{stdout: `{"ok":true,"status":"empty","schemaVersion":1}`},
		{stdout: "volume\n"},
		{stdout: "volume\n"},
	}}
	client := dockerClient{runner: runner, image: "image:v1", volume: "volume"}
	if err := client.ensureVolume(); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(runner.calls[2].args, " "); got != "volume rm volume" {
		t.Fatalf("unexpected removal: %s", got)
	}
	if got := strings.Join(runner.calls[3].args, " "); !strings.Contains(got, purposeLabel) || !strings.Contains(got, managerLabel) {
		t.Fatalf("replacement volume was not labeled: %s", got)
	}
}

func TestEnsureVolumeRefusesUnlabeledNonemptyVolume(t *testing.T) {
	runner := &fakeRunner{responses: []fakeResponse{
		{stdout: `[{"Name":"volume","Labels":{}}]`},
		{stdout: `{"ok":true,"status":"nonempty-invalid","schemaVersion":1}`},
	}}
	client := dockerClient{runner: runner, image: "image:v1", volume: "volume"}
	err := client.ensureVolume()
	if err == nil || !strings.Contains(err.Error(), "refusing") {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(runner.calls) != 2 {
		t.Fatalf("nonempty volume must not be modified: %#v", runner.calls)
	}
}

func TestRunAdminUsesReadonlyAndNoNetworkForValidation(t *testing.T) {
	runner := &fakeRunner{responses: []fakeResponse{{stdout: `{"ok":true,"status":"valid","schemaVersion":1}`}}}
	client := dockerClient{runner: runner, image: "image:v1", volume: "volume", helperVersion: "1.0.0"}
	if _, err := client.validate(false); err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(runner.calls[0].args, " ")
	if !strings.Contains(joined, "readonly") || !strings.Contains(joined, "--network none") {
		t.Fatalf("unsafe validation command: %s", joined)
	}
}

func TestEnsureCompatibleImagePreflightsSessionAdminWithoutNetwork(t *testing.T) {
	runner := &fakeRunner{responses: []fakeResponse{
		{stdout: `[{"Id":"sha256:image"}]`},
		{},
	}}
	client := dockerClient{runner: runner, image: "image:v1"}
	if err := client.ensureCompatibleImage(); err != nil {
		t.Fatal(err)
	}
	if len(runner.calls) != 2 {
		t.Fatalf("unexpected command count: %d", len(runner.calls))
	}
	joined := strings.Join(runner.calls[1].args, " ")
	if !strings.Contains(joined, "run --rm --network none") ||
		!strings.Contains(joined, "--entrypoint node image:v1") ||
		!strings.Contains(joined, "/app/dist/session-admin.js") {
		t.Fatalf("unsafe or incomplete preflight command: %s", joined)
	}
}

func TestEnsureCompatibleImageExplainsImageMismatch(t *testing.T) {
	runner := &fakeRunner{responses: []fakeResponse{
		{stdout: `[{"Id":"sha256:image"}]`},
		{stderr: "Cannot find module '/app/dist/session-admin.js'", err: errors.New("exit 1")},
	}}
	client := dockerClient{runner: runner, image: "old:image"}
	err := client.ensureCompatibleImage()
	if err == nil || !strings.Contains(err.Error(), "same release") || !strings.Contains(err.Error(), "old:image") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestImportStreamsStateWithoutCommandLineSecret(t *testing.T) {
	secret := []byte(`{"cookies":[{"value":"private-value"}]}`)
	runner := &fakeRunner{responses: []fakeResponse{{stdout: `{"ok":true,"status":"authenticated","schemaVersion":1}`}}}
	client := dockerClient{runner: runner, image: "image:v1", volume: "volume", helperVersion: "1.0.0"}
	if _, err := client.importState(secret); err != nil {
		t.Fatal(err)
	}
	if string(runner.calls[0].stdin) != string(secret) {
		t.Fatal("candidate state was not streamed on stdin")
	}
	if strings.Contains(strings.Join(runner.calls[0].args, " "), "private-value") {
		t.Fatal("secret leaked into Docker arguments")
	}
}

func TestRemoveVolumeRefusesMountedVolume(t *testing.T) {
	runner := &fakeRunner{responses: []fakeResponse{
		{stdout: `[{"Name":"volume","Labels":{"io.github.davidjbianco.ddb-mcp.purpose":"session","io.github.davidjbianco.ddb-mcp.managed-by":"ddb-mcp-auth"}}]`},
		{stdout: "container-id\n"},
	}}
	client := dockerClient{runner: runner, volume: "volume"}
	err := client.removeVolume()
	if err == nil || !strings.Contains(err.Error(), "mounted") {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(runner.calls) != 2 {
		t.Fatalf("unexpected removal call: %d", len(runner.calls))
	}
}

func TestSafeCommandErrorTruncatesOutput(t *testing.T) {
	err := safeCommandError("action", []byte(strings.Repeat("x", 700)), fmt.Errorf("failed"))
	if len(err.Error()) > 520 {
		t.Fatalf("error was not bounded: %d", len(err.Error()))
	}
}
