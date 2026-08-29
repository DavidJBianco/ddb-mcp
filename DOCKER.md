# Docker MCP Toolkit

This repository builds a local Docker image from the checked-out source. The
image does not clone the upstream repository, so changes made in this fork are
included in the build.

## Build the image

From the repository root:

```bash
make build
```

This regenerates the committed TypeScript output, builds
`mysterium:local`, and creates a matching host executable at
`bin/mysterium-auth`. Use `make image` or `make helper` when only one artifact
is needed. Override the local image tag with `make build IMAGE=example:tag`;
the selected tag is embedded as the helper's default administration image.

The image installs the Chromium version matched to the locked Playwright
dependency and runs the MCP server over standard input/output under Xvfb. The
runtime process uses the unprivileged `mcp` user (UID 10001).

Run every non-live test, including the container integration suite, with:

```bash
make test
```

`make test` builds the current server, viewers, helper, and candidate image,
then runs linting, type checks, offline MCP tests, synthetic headless-Chromium
MCP App tests, Go helper tests, and the container suite. Use `make test-docker`
to build and run only the container bundle while iterating.

The suite exercises MCP initialization through the normal image entrypoint and
uses a read-only mounted synthetic Playwright backend for browser-backed tool
calls, including normalized character listing/detail, bounded portrait image
delivery, character PDF export and byte reconstruction, normalized
search attribution, stat-block resolution and rendered extraction, and both
accessible and catalog sourcebook-search scopes. It also verifies bounded
shared-page cursor continuation and in-memory MCP PNG screenshot delivery; no
screenshot path is written inside the container.
Container networking is disabled, and test fixtures are not copied into the
production image. It also checks the non-root runtime and session mounts.
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
ghcr.io/davidjbianco/mysterium:vX.Y.Z
ghcr.io/davidjbianco/mysterium:latest
```

Prefer the immutable release version in durable configuration:

```bash
docker pull ghcr.io/davidjbianco/mysterium:vX.Y.Z
```

The checked-in `mysterium.yaml` references `mysterium:local` for source builds.
Each GitHub Release includes another `mysterium.yaml` with the same server name
and an image reference pinned to that release's immutable SemVer tag. Nothing
in the checked-in catalog needs to be edited for an ordinary release.

## Preserve the D&D Beyond session

The container stores Playwright browser state at:

```text
/home/mcp/.config/mysterium/session.json
```

The supplied `mysterium.yaml` mounts the named volume `mysterium-session`
read-only at that directory. Do not add `session.json` to the repository or
container image; it grants access to the associated D&D Beyond account.

Download the standalone `mysterium-auth` executable from the same GitHub Release
as the image, then authenticate on the Docker host:

```bash
mysterium-auth login
```

The helper creates and labels `mysterium-session` when necessary, uses an
installed Chromium-compatible browser for the interactive login, streams only
D&D Beyond state to a short-lived session-administration invocation of the
matching image, and validates the candidate before atomically replacing prior
state. The helper's administration container is the only component that mounts
the volume read-write.

The helper checks image compatibility before opening a login browser. If a
local source build reports an incompatible image, rebuild it with
`make build`; released helpers should use the
image from the same GitHub Release.
The helper's `version` command is generated from the server's `package.json`;
`make test` rejects a stale generated version before running the Go suite.

Existing-browser reuse is optional. Chrome 144 and later require “Allow remote
debugging for this browser instance” at `chrome://inspect/#remote-debugging`.
The helper offers reuse only when it detects a usable standard CDP endpoint;
permission-proxy-only or otherwise incompatible browser versions fall back
immediately to the isolated temporary profile, which needs no browser setting.
Authentication itself occurs before automation is attached, so OAuth providers
and password managers interact with an ordinary browser window. The helper
uses CDP only after the user confirms that D&D Beyond is signed in.

Run `mysterium-auth info`, `mysterium-auth validate`, or the explicitly live
`mysterium-auth validate --live` to diagnose it. Reauthenticate with `login` when
the session expires. Never transmit a password or cookie through an MCP tool.
Use `--json` with diagnostics for machine-readable output. The helper also
accepts `--browser-path`, `--volume`, `--image`, and `--timeout` overrides.

`mysterium-auth reset` removes saved files but preserves the volume and does not
revoke the server-side D&D Beyond session. `mysterium-auth volume remove` removes
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
cp mysterium.yaml "$HOME/.docker/mcp/catalogs/mysterium.yaml"

docker mcp profile create --name mysterium
docker mcp profile server add mysterium \
  --server file://mysterium.yaml
```

Connect the desired MCP client to the `mysterium` profile using Docker
Desktop or the Docker MCP CLI. Current Docker Desktop releases may require the
profiles feature to be enabled first.

The current Toolkit gateway path does not forward Claude Desktop's
`io.modelcontextprotocol/ui` capability to Mysterium. Toolkit-routed PDF export
and stat-block viewing therefore fail closed before browser acquisition; the
non-App tools, including JSON stat-block lookup, remain available. Use the
direct container configuration below when inline MCP App viewing is required.

## Direct container use

An MCP client can also launch the image directly over stdio:

```bash
docker run --rm --interactive \
  --volume mysterium-session:/home/mcp/.config/mysterium:ro \
  mysterium:local
```

For a source build in Claude Desktop, add that command and arguments to
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mysterium": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "--interactive",
        "--volume",
        "mysterium-session:/home/mcp/.config/mysterium:ro",
        "mysterium:local"
      ]
    }
  }
}
```

Restart Claude Desktop after changing this file. The `mysterium` object key is
only Claude's connection namespace; the server still registers tool names such
as `mysterium_export_character_pdf`.

The container needs outbound HTTPS access to D&D Beyond. Authentication-provider
traffic occurs only in the host browser. No host directories are mounted by the
supplied Toolkit definition; the named session volume is read-only in the
normal MCP runtime.

The image contains Mysterium's source-built, read-only PDF viewer. It uses a
directly pinned Mozilla PDF.js build and MCP Apps patterns adapted from the
official Model Context Protocol PDF example. PDF.js, Vite, and other viewer
build dependencies are pruned from the runtime image; only Mysterium, the
self-contained viewer artifact, and required license notices remain. PDF
exports are held in bounded server memory and are not written into the image or
a container volume. A gzip-compressed copy is returned in app-private MCP Apps
metadata so the host can restore the viewer across server restarts without
placing the bytes in model-visible tool content.

The image also contains Mysterium's self-contained stat-block viewer. Its
Vanilla TypeScript application and bundled rasterizer use no remote assets.
Stat-block text is retrieved from the authenticated rendered page on demand and
is not cached or persisted. PNG generation occurs inside the app; downloads use
the host-mediated MCP Apps download method when the client supports it.

Dependabot targets dependency updates at `dev`. PDF.js updates require review
of upstream rendering and security changes, regenerated self-contained viewer
artifacts, the automated suite, and manual inline-view and download checks.
