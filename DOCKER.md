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

## Preserve the D&D Beyond session

The container stores Playwright browser state at:

```text
/home/mcp/.config/ddb-mcp/session.json
```

The supplied `docker-mcp.yaml` mounts the named volume `ddb-mcp-session` at
that directory. Do not add `session.json` to the repository or container image;
it grants access to the associated D&D Beyond account.

The container's browser runs on a virtual display, so initial interactive login
is best completed with the server running locally:

1. Build and register the local Node server with an MCP client.
2. Call `ddb_login` and complete the visible Wizards ID login.
3. Copy the resulting local session into the named Docker volume:

```bash
DDB_MCP_SESSION_FILE="${HOME}/.config/ddb-mcp/session.json"

docker volume create ddb-mcp-session

docker run --rm \
  --volume ddb-mcp-session:/target \
  --mount "type=bind,src=${DDB_MCP_SESSION_FILE},dst=/source/session.json,readonly" \
  alpine:3.22 \
  sh -c 'cp /source/session.json /target/session.json && chown 10001:10001 /target/session.json && chmod 600 /target/session.json'
```

Change `DDB_MCP_SESSION_FILE` to the session's actual absolute path when it is
stored elsewhere.

Repeat the local login and copy if the saved session expires. Do not transmit a
Wizards password through an MCP tool call or bake the session into an image.

### Use a non-default session for read-only live tests

The container does not automatically load a host session file. If an existing
`session.json` is stored outside the default host location, bind that exact file
into the container for an explicitly requested read-only live test:

```bash
DDB_MCP_SESSION_FILE=/absolute/path/to/session.json

docker run --rm --interactive \
  --mount "type=bind,src=${DDB_MCP_SESSION_FILE},dst=/home/mcp/.config/ddb-mcp/session.json,readonly" \
  ddb-mcp-local:latest
```

Keep the session outside the repository, even when repository ignore rules
would exclude it. The read-only bind is suitable for retrieval and scraping
tests, but not for `ddb_login`: login saves refreshed browser state and requires
a writable session directory. For normal Toolkit use or session refreshes, copy
the file into the dedicated `ddb-mcp-session` named volume as described above.

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
  --volume ddb-mcp-session:/home/mcp/.config/ddb-mcp \
  ddb-mcp-local:latest
```

The container needs outbound HTTPS access to D&D Beyond and the Wizards login
service. No host directories are mounted by the supplied Toolkit definition;
only the named session volume is writable.
