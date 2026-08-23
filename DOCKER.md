# Docker MCP Toolkit

This repository builds a local Docker image from the checked-out source. The
image does not clone the upstream repository, so changes made in this fork are
included in the build.

## Build the image

From the repository root:

```bash
docker build --tag ddb-mcp-local:latest .
```

The image installs the Chromium version matched to the locked Playwright
dependency and runs the MCP server over standard input/output under Xvfb. The
runtime process uses the unprivileged `mcp` user (UID 10001).

Run the offline container integration suite with:

```bash
npm run test:docker
```

The suite exercises MCP initialization through the normal image entrypoint and
uses a read-only mounted synthetic Playwright backend for browser-backed tool
calls, including normalized search attribution and both accessible and catalog
sourcebook-search scopes. Container networking is disabled, and test fixtures
are not copied into the production image. It also checks the non-root runtime
and session mounts.
CI runs the complete browser suite natively on AMD64. The ARM64 image runs the
same runtime-hardening checks and an exact MCP initialization/tool-list smoke
test under QEMU; Chromium itself is not treated as reliable under emulation.

When Docker MCP Toolkit is installed and its Docker Desktop runtime is
available, the suite asks the Toolkit gateway to accept the candidate image,
connects an MCP client through an isolated profile, verifies the tool manifest,
and sends a validation-only tool call through the gateway. Runners without
Toolkit report that check as skipped; the ordinary production-entrypoint tests
still run everywhere.

## Released images

Each SemVer release publishes a multi-platform image for `linux/amd64` and
`linux/arm64` to GitHub Container Registry:

```text
ghcr.io/davidjbianco/ddb-mcp:vX.Y.Z
ghcr.io/davidjbianco/ddb-mcp:latest
```

Prefer the immutable release version in durable configuration:

```bash
docker pull ghcr.io/davidjbianco/ddb-mcp:v2.0.0
```

The local `docker-mcp.yaml` deliberately continues to reference
`ddb-mcp-local:latest` so development and unreleased source builds cannot be
confused with published releases.

## Preserve the D&D Beyond session

The container stores Playwright browser state at:

```text
/home/mcp/.config/ddb-mcp/session.json
```

The supplied `docker-mcp.yaml` mounts the named volume `ddb-mcp-session`
read-only at that directory. Do not add `session.json` to the repository or
container image; it grants access to the associated D&D Beyond account.

Download the standalone `ddb-mcp-auth` executable from the same GitHub Release
as the image, then authenticate on the Docker host:

```bash
ddb-mcp-auth login
```

The helper creates and labels `ddb-mcp-session` when necessary, uses an
installed Chromium-compatible browser for the interactive login, streams only
D&D Beyond state to a short-lived session-administration invocation of the
matching image, and validates the candidate before atomically replacing prior
state. The helper's administration container is the only component that mounts
the volume read-write.

The helper checks image compatibility before opening a login browser. If a
local source build reports an incompatible image, rebuild it with
`docker build --tag ddb-mcp-local:latest .`; released helpers should use the
image from the same GitHub Release.

Existing-browser reuse is optional. Chrome 144 and later require “Allow remote
debugging for this browser instance” at `chrome://inspect/#remote-debugging`.
The helper offers reuse only when it detects a usable standard CDP endpoint;
permission-proxy-only or otherwise incompatible browser versions fall back
immediately to the isolated temporary profile, which needs no browser setting.
Authentication itself occurs before automation is attached, so OAuth providers
and password managers interact with an ordinary browser window. The helper
uses CDP only after the user confirms that D&D Beyond is signed in.

Run `ddb-mcp-auth info`, `ddb-mcp-auth validate`, or the explicitly live
`ddb-mcp-auth validate --live` to diagnose it. Reauthenticate with `login` when
the session expires. Never transmit a password or cookie through an MCP tool.
Use `--json` with diagnostics for machine-readable output. The helper also
accepts `--browser-path`, `--volume`, `--image`, and `--timeout` overrides.

`ddb-mcp-auth reset` removes saved files but preserves the volume and does not
revoke the server-side D&D Beyond session. `ddb-mcp-auth volume remove` removes
the whole helper-owned volume and refuses while a running container mounts it;
both commands prompt unless `--force` is supplied. An unlabeled empty volume is
recreated with the helper labels. An unlabeled nonempty volume is never adopted
or overwritten; use `info` to identify that condition and resolve it manually.

The explicit opt-in commands and release record are documented in
[`LIVE_TESTING.md`](LIVE_TESTING.md).

## Add the image to Docker MCP Toolkit

Docker MCP Toolkit accepts a local server definition from its trusted catalog
directory. After building the image:

```bash
mkdir -p "$HOME/.docker/mcp/catalogs"
cp docker-mcp.yaml "$HOME/.docker/mcp/catalogs/ddb-mcp-local.yaml"

docker mcp profile create --name ddb-development
docker mcp profile server add ddb-development \
  --server file://ddb-mcp-local.yaml
```

Connect the desired MCP client to the `ddb-development` profile using Docker
Desktop or the Docker MCP CLI. Current Docker Desktop releases may require the
profiles feature to be enabled first.

## Direct container use

An MCP client can also launch the image directly over stdio:

```bash
docker run --rm --interactive \
  --volume ddb-mcp-session:/home/mcp/.config/ddb-mcp:ro \
  ddb-mcp-local:latest
```

The container needs outbound HTTPS access to D&D Beyond. Authentication-provider
traffic occurs only in the host browser. No host directories are mounted by the
supplied Toolkit definition; the named session volume is read-only in the
normal MCP runtime.
