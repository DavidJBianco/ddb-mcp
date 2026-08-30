# Mysterium

Mysterium is a Docker-first [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for authenticated D&D Beyond content. It gives MCP clients access to a user's characters, campaigns, sourcebooks, cataloged monster and NPC stat blocks, and rendered rules indexes through a persistent browser session.

Mysterium is an independent fork of the MIT-licensed [ddb-mcp](https://github.com/ddb-mcp/ddb-mcp) project. The original project established the core D&D Beyond browser integration; this fork has a distinct name and direction so users can tell the two projects apart.

Mysterium is not affiliated with, endorsed by, or sponsored by D&D Beyond, Wizards of the Coast, or Hasbro. D&D Beyond does not provide a supported public developer API for this use case, so site changes may occasionally require updates.

## How Mysterium differs

- Docker is the supported runtime and distribution model. Users do not install Node.js, npm, Playwright, or Chromium dependencies for the server.
- A separate `mysterium-auth` host helper performs visible browser login, validates the resulting session with the matching container image, and stores it in a Docker volume.
- The normal server mounts authentication state read-only and runs as an unprivileged container user.
- Sourcebook support includes library discovery, outlines, stable section identifiers, bounded Markdown chunks, and cursor-based continuation.
- Search results use consistent JSON envelopes and expose normalized source attribution when D&D Beyond renders it.
- Deterministic stat-block lookup covers monsters, named NPCs, and generic NPCs in D&D Beyond's monster catalog, with a selectable-text MCP App viewer and local PNG export.
- Offline MCP contract tests, synthetic browser tests, container hardening checks, and Docker MCP Toolkit compatibility checks are part of the project workflow.

## Tools

| Tool | Description |
| --- | --- |
| `mysterium_list_characters` | List normalized character summaries with composable filters and deterministic sorting. |
| `mysterium_get_character` | Retrieve complete character data with provenance and a normalized nullable portrait URL. |
| `mysterium_get_character_portrait` | Return a configured character portrait as validated, display-ready MCP image content. |
| `mysterium_export_character_pdf` | Export an owned character sheet through D&D Beyond's rendered workflow and display it in a read-only MCP App PDF viewer. |
| `mysterium_list_campaigns` | List normalized campaign summaries with composable filters and deterministic sorting. |
| `mysterium_get_campaign` | Retrieve permission-aware campaign metadata, participants, notes, and explicitly requested safe links. |
| `mysterium_list_library` | List accessible sourcebooks and their slugs. |
| `mysterium_read_book` | Discover outlines or read bounded chapter and section content with cursor pagination. |
| `mysterium_search` | Search rendered D&D Beyond indexes and global results, optionally filtered to one accessible sourcebook and by Legacy status. |
| `mysterium_get_stat_block` | Resolve a cataloged monster or NPC and return its normalized rendered stat block as JSON and Markdown. |
| `mysterium_view_stat_block` | Resolve a cataloged monster or NPC and open its stat block in an MCP App viewer with copy and PNG export actions. |
| `mysterium_read_page` | Navigate to and read a D&D Beyond page, read the current page, or continue bounded rendered text with a cursor. |
| `mysterium_capture_page` | Return the current viewport or one visible element as bounded MCP PNG image content. |

`read_pdf_bytes` and `read_stat_block_for_app` are app-only helpers used by the
inline viewers. Compatible clients hide them from the model-facing tool list.

### Structured response contracts

The mature model-facing JSON tools publish MCP output schemas and return the
same result in both `structuredContent` and the JSON text content block:

- `mysterium_list_library` returns `{ count, books }`.
- `mysterium_list_characters` returns `{ count, total, filters, sort, characters }`.
- `mysterium_get_character` returns `{ source, schemaVersion, portraitUrl, character }`.
- `mysterium_get_character_portrait` returns portrait metadata as structured
  content and adds an MCP image block when a portrait is configured.
- `mysterium_list_campaigns` returns `{ count, total, filters, sort, campaigns }`.
- `mysterium_get_campaign` returns a versioned `{ source, schemaVersion,
  partial, campaign }` envelope with explicit availability and provenance.
- `mysterium_search` returns bounded, cursor-paginated results with normalized
  filters, rendered snippets, Legacy status, source attribution, and direct
  sourcebook locations where D&D Beyond exposes them.
- `mysterium_read_book` returns a `kind: "outline"` discovery result or a
  `kind: "content"` result with bounded text, images, and cursor state.
- `mysterium_get_stat_block` returns `kind: "stat_block"`, `"candidates"`, or
  `"not_found"`.
- `mysterium_read_page` returns a versioned rendered-page envelope with page
  identity, bounded text, and cursor state.
- `mysterium_capture_page` returns screenshot metadata as structured content and
  adds the in-memory PNG as MCP image content.

Successful results are validated before delivery; failures remain MCP tool
errors with `isError: true`. MCP App entry points and app-private transport
tools also publish exact output schemas, but retain concise text summaries so
PDF bytes and complete rendering payloads are not duplicated.

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

For Claude Desktop PDF and stat-block viewing, configure the released container as a direct
stdio server. The configuration key becomes Claude's tool namespace; it does
not change Mysterium's registered tool names.

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
        "ghcr.io/davidjbianco/mysterium:vX.Y.Z"
      ]
    }
  }
}
```

Restart Claude Desktop after changing its configuration. In the manually
verified client configuration, direct stdio preserved Claude's MCP Apps
capability and rendered the PDF inline. The Docker MCP Toolkit gateway did not
forward that capability, so Toolkit-routed calls were safely rejected before
contacting D&D Beyond. Toolkit remains usable for Mysterium's non-App tools,
including `mysterium_get_stat_block`.

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

Other MCP clients that launch containers directly can use the equivalent stdio command:

```bash
docker run --rm --interactive \
  --volume mysterium-session:/home/mcp/.config/mysterium:ro \
  "ghcr.io/davidjbianco/mysterium:v${MYSTERIUM_VERSION}"
```

The server needs outbound HTTPS access to D&D Beyond. The session volume is mounted read-only during normal operation.

See [DOCKER.md](DOCKER.md) for local image builds, Docker MCP Toolkit details, and container verification.

## Listing characters and retrieving portraits

`mysterium_list_characters` returns every character summary after exhausting
the account's read-only list response. Filters in different categories combine
with AND; values within `names`, `classes`, `species`, or `campaign_ids`
combine with OR. Name matching is case-insensitive substring matching, class
matching uses exact multiclass components, and species and campaign matching
are exact after normalization:

```json
{
  "classes": ["Bard"],
  "species": ["Elf"],
  "min_level": 3,
  "sort_by": "modified",
  "sort_direction": "desc"
}
```

Use an ID from `characters` with `mysterium_get_character`. The response keeps
the complete character-service `data` object under `character`, identifies its
source/schema version, and promotes `character.decorations.avatarUrl` to the
nullable `portraitUrl` field. There is no rendered-sheet fallback: service,
authentication, or schema failures are explicit MCP errors.

Call `mysterium_get_character_portrait` with the same ID when the client should
receive the configured portrait as image content. The tool validates the
remote response, derives the display MIME type from its recognized image
signature when D&D Beyond's supported image header is inaccurate, and limits
it to 5 MiB. A character without a portrait returns
`available: false` successfully and does not substitute a frame, backdrop, or
placeholder. Portrait URL query parameters are treated as opaque and are not
rewritten. Portraits are held only for the current call and are never cached or
written to disk.

## Listing and retrieving campaigns

`mysterium_list_campaigns` normalizes the fields already rendered on the
account's campaign-list page without opening each campaign. It supports
case-insensitive name substrings, exact campaign IDs and viewer roles,
inclusive creation-date and player-count bounds, and exact content-sharing
state. Filter categories combine with AND; multiple names, IDs, or roles use
OR. Results can be sorted by `name`, `role`, `created`, `players`, or
`content_sharing` in either direction:

```json
{
  "roles": ["dungeon_master"],
  "created_on_or_after": "2025-01-01",
  "min_players": 2,
  "content_sharing_enabled": true,
  "sort_by": "players",
  "sort_direction": "desc"
}
```

Pass a returned ID to `mysterium_get_campaign`. Normal page navigation loads
read-only campaign metadata and short-character responses; Mysterium validates
those page-issued responses and combines them with permission-aware rendered
content. Optional sections use `available`, `empty`, or `unavailable` states
and identify their provenance. A safe rendered fallback retains the same
schema with `partial: true` when structured metadata is unavailable.

Visible private DM notes are requested by default; set
`include_private_notes` to `false` to prevent their extraction. An unavailable
result never distinguishes unrequested, unauthorized, hidden, or unrendered
content. Invite and administration links default to excluded. Request them
individually with `include_invite_link` or
`include_administration_links`; invite URLs are sensitive, and administration
results contain only validated navigation destinations. Delete, deactivate,
remove, reset, leave, and other state-changing controls are always omitted.

## Exporting a character sheet PDF

Call `mysterium_export_character_pdf` with the decimal character ID returned by
`mysterium_list_characters`:

```json
{
  "character_id": "12345678"
}
```

The tool uses the rendered character sheet's **Manage** → **Export to PDF**
workflow, validates the generated response, and opens a read-only inline viewer
with page, zoom, search, fullscreen, and download controls. It requires an MCP
client that advertises MCP Apps support; unsupported clients receive an error
before Mysterium contacts D&D Beyond.

PDF data is limited to 25 MiB and retained in a bounded in-memory server cache
for up to 60 minutes of inactivity. The export result also carries a
gzip-compressed copy in app-private `_meta`, allowing a supporting host to
restore the viewer after the MCP server restarts without exposing the bytes to
the model. The PDF is never written to the normal container filesystem.
Mysterium's source-owned viewer uses Mozilla PDF.js and may request
version-matched PDF.js Standard-14 font data from
`unpkg.com` when the exported PDF does not embed a required standard font.

## Looking up stat blocks

Use `mysterium_get_stat_block` when the model needs structured JSON or faithful
Markdown. Supply exactly one of a creature name or an ID:

```json
{
  "query": "Guard",
  "legacy": "include"
}
```

`legacy` defaults to `include`, which prefers a sole current exact-name match
and falls back to a sole entry bearing D&D Beyond's rendered Legacy badge. Use
`exclude` or `only` to restrict that badge status. Edition labels such as `5e`
and `5.5e` are reported separately and never used to infer Legacy status.
Ambiguous exact names return candidates rather than silently choosing different
rules content. An inaccessible preferred match likewise returns its failure and
available alternatives. Creature IDs are intended to be reused from a candidate
or monster-search result in the current server session; after restarting the
server, resolve the creature by name again so Mysterium can recover and validate
its canonical slugged URL.

Use `mysterium_view_stat_block` with the same arguments for a D&D-inspired,
accessible MCP App presentation. Its selectable-text viewer supports zoom,
fullscreen, text and JSON copying, opening the canonical D&D Beyond page, and
local 2x PNG generation. Very tall blocks are divided at section boundaries
into numbered panels. The self-contained viewer requests only clipboard
permission and fetches the rendered stat block on demand; Mysterium does not
persist or cache its text. Version 1 covers entries discoverable under D&D
Beyond's monster catalog, including NPC-tagged entries, but not stat blocks
found only in sourcebook prose or homebrew-only discovery.

## Reading sourcebooks

Use `mysterium_search` without `book_slug` to search D&D Beyond's rendered
global index. Add an accessible `book_slug` to filter those same global results
to direct source paths and standalone entries attributed to that book; Mysterium
does not crawl every chapter. `legacy` accepts `include` (the default, meaning
both), `exclude` (current only), or `only`. Continue bounded results with the
returned opaque `nextCursor`. Each ordinary result includes bounded `snippets`,
a rendered `legacy` boolean, and nullable `bookLocation`. When `bookLocation`
contains a chapter and section-title hint, use those values with
`mysterium_read_book`; standalone entries retain their canonical URL and source
attribution even when reader coordinates are unavailable.

Scoped search accepts either the exact accessible-library slug or one bare
final slug segment. A unique final-segment match is normalized to its canonical
full slug in `filters.bookSlug`; an ambiguous match returns the canonical
choices. Library metadata is cached in memory for one hour. Pass
`refresh: true` with `book_slug` to replace that snapshot before resolving the
book. Global search results themselves are never cached.

Call `mysterium_list_library` to discover accessible book slugs. Calling `mysterium_read_book` with only `book_slug` returns the book outline. Use a chapter path with `mode: "outline"` to discover stable section IDs:

```json
{
  "book_slug": "dnd/phb-2024",
  "chapter_slug": "character-classes/barbarian",
  "mode": "outline"
}
```

## Discovery metadata caches

Mysterium keeps small normalized discovery snapshots in memory per
authenticated browser context. Accessible library metadata is cached for one
hour; character and campaign summaries are cached for five minutes. Detail
responses, global search results, sourcebook content, and stat blocks are not
cached. Each affected list tool accepts `refresh: true` to fetch current data
and replace its snapshot before applying filters and sorting. A failed refresh
returns an error rather than silently serving stale data.

For content, omit `mode` or set it to `"content"`. Responses contain bounded Markdown in `text`, an opaque `nextCursor`, and a `done` flag. Return `nextCursor` as `cursor` with the same book, chapter, section, and character limit until `done` is `true`.

The default limit is 10,000 Markdown characters and the maximum is 25,000. You can restrict a read to a section ID from the outline or to an exact, unique heading.

## Reading and capturing the shared browser page

`mysterium_read_page` is a read-only escape hatch for D&D Beyond pages that do
not have a dedicated structured tool. Browser-backed tools reuse one page, so
each call may leave it at a different URL. Pass `url` to navigate and return the
first bounded text chunk, omit it to read the current page, or pass the returned
`nextCursor` back to the same tool until `done` is true. `url` and `cursor`
cannot be combined. The opaque cursor is bound to
the final URL, normalized page content, and character limit; it fails closed if
another tool navigates or the rendered content changes.

Extraction operates on a cloned content subtree and does not remove elements
from the live page. Generic click and fill interaction is intentionally not
exposed because arbitrary selectors cannot provide reliable mutation safety.

Use `mysterium_capture_page` only for an explicit visual-inspection request. It
captures the visible viewport by default, or one uniquely matched visible
element with `scope: "element"` and `selector`. Screenshots are returned directly
as MCP PNG image content, are never written to disk, and are limited by image
dimensions, pixel count, and a 5 MiB byte cap. Authenticated screenshots may
contain private account information or copyrighted material.

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
# Explicit authenticated release verification only:
make test-release
```

`make build` regenerates `dist/`, builds `mysterium:local`, and writes a
matching host helper to `bin/mysterium-auth`. `make test` builds the current
server, viewer, helper, and candidate image before running every non-live host,
browser, and Docker test. `IMAGE`, `TEST_IMAGE`, and `BIN_DIR` can be overridden
on the command line; run `make help` for the complete target list. CI uses the
same targeted bundles without duplicating its architecture-specific Docker
jobs.

`make test` includes the synthetic MCP App browser tests in headless Chromium;
these remain fully offline and never read the saved D&D Beyond session. Use
`make test-browser` to run only that focused UI suite while iterating.

Authenticated tests are deliberately separate, read-only, and explicitly opted into. See [LIVE_TESTING.md](LIVE_TESTING.md). Never place a D&D Beyond session in the repository or GitHub Actions.

## License

MIT.
