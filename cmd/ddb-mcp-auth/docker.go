package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

const (
	defaultVolume = "ddb-mcp-session"
	purposeLabel  = "io.github.davidjbianco.ddb-mcp.purpose=session"
	managerLabel  = "io.github.davidjbianco.ddb-mcp.managed-by=ddb-mcp-auth"
)

type commandRunner interface {
	Run(stdin []byte, name string, args ...string) ([]byte, []byte, error)
}

type execRunner struct{}

func (execRunner) Run(stdin []byte, name string, args ...string) ([]byte, []byte, error) {
	command := exec.Command(name, args...)
	if stdin != nil {
		command.Stdin = bytes.NewReader(stdin)
	}
	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	err := command.Run()
	return stdout.Bytes(), stderr.Bytes(), err
}

type dockerClient struct {
	runner        commandRunner
	image         string
	volume        string
	helperVersion string
}

type volumeInspection struct {
	Name   string            `json:"Name"`
	Labels map[string]string `json:"Labels"`
}

type adminResult struct {
	OK            bool   `json:"ok"`
	Status        string `json:"status"`
	SchemaVersion int    `json:"schemaVersion"`
	HelperVersion string `json:"helperVersion,omitempty"`
	CreatedAt     string `json:"createdAt,omitempty"`
}

func safeCommandError(action string, stderr []byte, err error) error {
	message := strings.TrimSpace(string(stderr))
	if message == "" {
		message = err.Error()
	}
	if len(message) > 500 {
		message = message[:500]
	}
	return fmt.Errorf("%s: %s", action, message)
}

func (client dockerClient) docker(stdin []byte, args ...string) ([]byte, error) {
	stdout, stderr, err := client.runner.Run(stdin, "docker", args...)
	if err != nil {
		return nil, safeCommandError("Docker command failed", stderr, err)
	}
	return stdout, nil
}

func (client dockerClient) check() (string, error) {
	if _, err := client.docker(nil, "version", "--format", "{{.Server.Version}}"); err != nil {
		return "", fmt.Errorf("Docker is unavailable: %w", err)
	}
	output, err := client.docker(nil, "context", "show")
	return strings.TrimSpace(string(output)), err
}

func (client dockerClient) inspectVolume() (*volumeInspection, error) {
	stdout, stderr, err := client.runner.Run(nil, "docker", "volume", "inspect", client.volume)
	if err != nil {
		if strings.Contains(string(stderr), "No such volume") || strings.Contains(string(stderr), "no such volume") {
			return nil, nil
		}
		return nil, safeCommandError("inspect Docker volume", stderr, err)
	}
	var values []volumeInspection
	if err := json.Unmarshal(stdout, &values); err != nil || len(values) != 1 {
		return nil, fmt.Errorf("Docker returned an invalid volume inspection")
	}
	return &values[0], nil
}

func labelsOwned(labels map[string]string) bool {
	return labels["io.github.davidjbianco.ddb-mcp.purpose"] == "session" &&
		labels["io.github.davidjbianco.ddb-mcp.managed-by"] == "ddb-mcp-auth"
}

func (client dockerClient) createVolume() error {
	_, err := client.docker(nil, "volume", "create", "--label", purposeLabel, "--label", managerLabel, client.volume)
	return err
}

func (client dockerClient) ensureImage() error {
	if _, _, err := client.runner.Run(nil, "docker", "image", "inspect", client.image); err == nil {
		return nil
	}
	fmt.Fprintf(os.Stderr, "Pulling matching session administration image %s...\n", client.image)
	_, err := client.docker(nil, "pull", client.image)
	return err
}

func (client dockerClient) ensureCompatibleImage() error {
	if err := client.ensureImage(); err != nil {
		return err
	}
	_, stderr, err := client.runner.Run(nil, "docker", "run", "--rm", "--network", "none",
		"--entrypoint", "node", client.image, "--input-type=module", "--eval",
		"await import('/app/dist/session-admin.js')")
	if err != nil {
		return fmt.Errorf("image %q is not compatible with this authentication helper; rebuild it from the current source or use the image from the same release: %w",
			client.image, safeCommandError("session administration preflight failed", stderr, err))
	}
	return nil
}

func (client dockerClient) imagePresent() bool {
	_, _, err := client.runner.Run(nil, "docker", "image", "inspect", client.image)
	return err == nil
}

func (client dockerClient) requireOwnedVolume() (*volumeInspection, error) {
	inspection, err := client.inspectVolume()
	if err != nil {
		return nil, err
	}
	if inspection == nil {
		return nil, fmt.Errorf("the labeled session volume %q does not exist", client.volume)
	}
	if !labelsOwned(inspection.Labels) {
		return nil, fmt.Errorf("volume %q is not labeled as ddb-mcp-auth state; refusing to modify it", client.volume)
	}
	return inspection, nil
}

func (client dockerClient) runAdmin(stdin []byte, command string, live, writable bool) (adminResult, error) {
	mount := fmt.Sprintf("type=volume,src=%s,dst=/home/mcp/.config/ddb-mcp", client.volume)
	if !writable {
		mount += ",readonly"
	}
	args := []string{"run", "--rm", "--interactive", "--mount", mount,
		"--env", "DDB_MCP_AUTH_HELPER_VERSION=" + client.helperVersion,
		"--entrypoint", "node"}
	if !live {
		args = append(args, "--network", "none")
	}
	args = append(args, client.image, "dist/session-admin.js", command)
	if live {
		args = append(args, "--live")
	}
	stdout, stderr, err := client.runner.Run(stdin, "docker", args...)
	if err != nil {
		return adminResult{}, safeCommandError("session administration failed", stderr, err)
	}
	var result adminResult
	if err := json.Unmarshal(bytes.TrimSpace(stdout), &result); err != nil || !result.OK {
		return adminResult{}, fmt.Errorf("session administration returned an invalid result")
	}
	return result, nil
}

func (client dockerClient) ensureVolume() error {
	inspection, err := client.inspectVolume()
	if err != nil {
		return err
	}
	if inspection == nil {
		return client.createVolume()
	}
	if labelsOwned(inspection.Labels) {
		return nil
	}
	result, statusErr := client.runAdmin(nil, "status", false, false)
	if statusErr == nil && result.Status == "empty" {
		if _, err := client.docker(nil, "volume", "rm", client.volume); err != nil {
			return fmt.Errorf("replace unlabeled empty volume: %w", err)
		}
		return client.createVolume()
	}
	return fmt.Errorf("volume %q is not labeled as ddb-mcp-auth state and is not empty; refusing to adopt or overwrite it", client.volume)
}

func (client dockerClient) importState(state []byte) (adminResult, error) {
	return client.runAdmin(state, "import", true, true)
}

func (client dockerClient) validate(live bool) (adminResult, error) {
	return client.runAdmin(nil, "validate", live, false)
}

func (client dockerClient) reset() error {
	_, err := client.runAdmin(nil, "reset", false, true)
	return err
}

func (client dockerClient) removeVolume() error {
	if _, err := client.requireOwnedVolume(); err != nil {
		return err
	}
	containers, err := client.docker(nil, "ps", "--filter", "volume="+client.volume, "--format", "{{.ID}}")
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(containers)) != "" {
		return fmt.Errorf("volume %q is mounted by a container; disable or stop the MCP server before removing it", client.volume)
	}
	_, err = client.docker(nil, "volume", "rm", client.volume)
	return err
}
