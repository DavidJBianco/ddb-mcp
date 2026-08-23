# Mysterium

Mysterium is a Docker-first [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for authenticated D&D Beyond content. It gives MCP clients access to a user's characters, campaigns, sourcebooks, and rendered rules indexes through a persistent browser session.

Mysterium is an independent fork of the MIT-licensed [ddb-mcp](https://github.com/ddb-mcp/ddb-mcp) project. The original project established the core D&D Beyond browser integration; this fork has a distinct name and direction so users can tell the two projects apart.

Mysterium is not affiliated with, endorsed by, or sponsored by D&D Beyond, Wizards of the Coast, or Hasbro. D&D Beyond does not provide a supported public developer API for this use case, so site changes may occasionally require updates.

## How Mysterium differs

- Docker is the supported runtime and distribution model. Users do not install Node.js, npm, Playwright, or Chromium dependencies for the server.
- A separate `mysterium-auth` host helper performs visible browser login, validates the resulting session with the matching container image, and stores it in a Docker volume.
- The normal server mounts authentication state read-only and runs as an unprivileged container user.
- Sourcebook support includes library discovery, outlines, stable section identifiers, bounded Markdown chunks, and cursor-based continuation.
- Search results use consistent JSON envelopes and expose normalized source attribution when D&D Beyond renders it.
- Offline MCP contract tests, synthetic browser tests, container hardening checks, and Docker MCP Toolkit compatibility checks are part of the project workflow.

## Tools

| Tool | Description |
| --- | --- |
| `mysterium_list_characters` | List the characters available to the authenticated account. |
| `mysterium_get_character` | Retrieve full character data. |
| `mysterium_download_character` | Write character JSON to a requested local path. |
| `mysterium_list_campaigns` | List campaigns in which the account participates. |
| `mysterium_get_campaign` | Retrieve campaign details and active characters. |
| `mysterium_list_library` | List accessible sourcebooks and their slugs. |
| `mysterium_read_book` | Discover outlines or read bounded chapter and section content with cursor pagination. |
| `mysterium_search` | Search rendered D&D Beyond indexes and sourcebook listings. |
| `mysterium_navigate` | Navigate to a D&D Beyond URL and return its rendered text. |
| `mysterium_interact` | Click, fill, or capture a screenshot on the current page. |
| `mysterium_current_page` | Return text from the current browser page. |

## Quickstart

### Requirements

- Docker Desktop or Docker Engine with the Docker CLI
- A desktop Chromium-compatible browser: Chrome, Edge, Brave, Vivaldi, or Chromium
- The `mysterium-auth` archive for your host platform from the same [Mysterium release](https://github.com/DavidJBianco/mysterium/releases) as the image

Safari and Firefox are not authentication targets. The helper uses an installed Chromium-compatible browser and never downloads one onto the host.

### 1. Install a matched image and helper

Set the released Semantic Version you want to install:

```bash
export MYSTERIUM_VERSION=1.2.3
docker pull "ghcr.io/davidjbianco/mysterium:v${MYSTERIUM_VERSION}"
```

Download the matching `mysterium-auth` archive and `checksums.txt` from that release, verify the checksum, extract the executable, and place it on your `PATH`. Released helpers default to their matching immutable image.
`mysterium-auth version` reports the same Semantic Version as the server package
from which it was built.

### 2. Authenticate

```bash
mysterium-auth login
```

The helper opens a visible browser for the real D&D Beyond sign-in, exports only D&D Beyond browser state after login, validates it inside the matching image, and saves it in the labeled `mysterium-session` Docker volume. Passwords are never accepted through MCP tools.

Useful diagnostics:

```bash
mysterium-auth info
mysterium-auth validate
mysterium-auth validate --live
```

`validate` is local; `validate --live` performs one bounded, read-only request to D&D Beyond. If the session expires, run `mysterium-auth login` again.

### 3. Connect an MCP client

Docker MCP Toolkit users should download `mysterium.yaml` from the same GitHub
Release as the helper. That catalog is already pinned to the release's immutable
image, so it can be installed without editing:

```bash
mkdir -p "$HOME/.docker/mcp/catalogs"
cp /path/to/downloaded/mysterium.yaml "$HOME/.docker/mcp/catalogs/mysterium.yaml"

docker mcp profile create --name mysterium
docker mcp profile server add mysterium --server file://mysterium.yaml
```

The checked-in [`mysterium.yaml`](mysterium.yaml) is the source-build variant. It
uses the same `mysterium` server identity and points to `mysterium:local`, the
image produced by `make build`.

An MCP client that launches containers directly can use the equivalent stdio command:

```bash
docker run --rm --interactive \
  --volume mysterium-session:/home/mcp/.config/mysterium:ro \
  "ghcr.io/davidjbianco/mysterium:v${MYSTERIUM_VERSION}"
```

The server needs outbound HTTPS access to D&D Beyond. The session volume is mounted read-only during normal operation.

See [DOCKER.md](DOCKER.md) for local image builds, Docker MCP Toolkit details, and container verification.

## Reading sourcebooks

Call `mysterium_list_library` to discover accessible book slugs. Calling `mysterium_read_book` with only `book_slug` returns the book outline. Use a chapter path with `mode: "outline"` to discover stable section IDs:

```json
{
  "book_slug": "dnd/phb-2024",
  "chapter_slug": "character-classes/barbarian",
  "mode": "outline"
}
```

For content, omit `mode` or set it to `"content"`. Responses contain bounded Markdown in `text`, an opaque `nextCursor`, and a `done` flag. Return `nextCursor` as `cursor` with the same book, chapter, section, and character limit until `done` is `true`.

The default limit is 10,000 Markdown characters and the maximum is 25,000. You can restrict a read to a section ID from the outline or to an exact, unique heading.

## Session safety and reset

The `mysterium-session` volume contains cookies and browser storage that grant access to the associated account. Do not copy, inspect, log, publish, or bake it into an image.

To remove saved session files while preserving the labeled volume:

```bash
mysterium-auth reset
```

To remove the entire helper-owned volume:

```bash
mysterium-auth volume remove
```

Neither operation revokes the server-side D&D Beyond session; use D&D Beyond account controls when revocation is required.

## Development and verification

Development still uses the locked Node and Go toolchains to build and test the project, but the supported end-user runtime is Docker:

```bash
make build
make test
make test-docker
```

`make build` regenerates `dist/`, builds `mysterium:local`, and writes a
matching host helper to `bin/mysterium-auth`. Use `make test-all` for both the
normal and container suites. `IMAGE`, `TEST_IMAGE`, and `BIN_DIR` can be
overridden on the command line; run `make help` for the complete target list.
These same targets are the CI entry points, so local and automated verification
use the same commands.

Authenticated tests are deliberately separate, read-only, and explicitly opted into. See [LIVE_TESTING.md](LIVE_TESTING.md). Never place a D&D Beyond session in the repository or GitHub Actions.

## License

MIT.
