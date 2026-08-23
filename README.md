# D&D Beyond MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that gives Claude direct access to your D&D Beyond account — characters, campaigns, sourcebooks, spells, monsters, and more.

## Features

| Tool | Description |
|------|-------------|
| `ddb_list_characters` | List all characters in your account with ID, level, race, and class. |
| `ddb_get_character` | Fetch full character JSON from the D&D Beyond character API. |
| `ddb_download_character` | Save a character's full JSON data to a local file. |
| `ddb_list_campaigns` | List all campaigns you're part of (as DM or player). |
| `ddb_get_campaign` | Fetch campaign details — DM, description, and active characters. |
| `ddb_list_library` | List sourcebooks you own or can access through sharing, including their slugs. |
| `ddb_read_book` | Discover book/chapter outlines and read bounded chapter or section content with cursor pagination. |
| `ddb_search` | Search D&D Beyond indexes and accessible or catalog sourcebooks, with normalized source attribution when exposed. |
| `ddb_navigate` | Navigate to any D&D Beyond URL and return its text content. |
| `ddb_interact` | Click, fill, or screenshot the currently loaded browser page. |
| `ddb_current_page` | Return the text content of whatever page is currently loaded. |

## Prerequisites

- Docker Desktop or Docker Engine with the Docker CLI
- An installed desktop Chromium-compatible browser such as Google Chrome,
  Microsoft Edge, Brave, Vivaldi, or Chromium
- The `ddb-mcp-auth` executable matching the container release and host
  platform, downloaded from the repository's GitHub Release

Safari and Firefox are not direct authentication targets in v2. Their users
must also install a Chromium-compatible browser; the helper never downloads a
browser automatically.

## Installation

Pull an immutable release image and download the matching `ddb-mcp-auth`
archive from the same GitHub Release:

```bash
docker pull ghcr.io/davidjbianco/ddb-mcp:v2.0.0
```

Extract the helper, place it on the host `PATH`, and add the image to Docker MCP
Toolkit as described in [`DOCKER.md`](DOCKER.md). The helper is a standalone
binary; users do not need Go, Node.js, npm, or a host Playwright installation.
Verify the archive against `checksums.txt` from the release before installing
it. macOS archives are provided for amd64 and arm64, Linux archives for amd64
and arm64, and Windows for amd64.

## Usage

### First-time login

Run authentication on the Docker host before, or after, starting the MCP server:

```bash
ddb-mcp-auth login
```

The helper discovers an installed Chromium browser. It offers to reuse a
compatible running browser only when that browser already exposes a usable
standard CDP endpoint, and only after explaining and requesting temporary
debugging access. Chrome 144 and later require remote debugging to be enabled
first at `chrome://inspect/#remote-debugging`. Some hardened Chrome versions
expose only a permission proxy rather than a standard endpoint; the helper
detects that condition and immediately falls back. If reuse is declined or
unsupported, it opens the same browser with an isolated temporary profile and
requires no browser setting. In either mode, complete the real D&D Beyond login
in an uncontrolled browser window: no CDP client is attached and no automation
flag is present during password or OAuth authentication. After login, the
helper briefly attaches to the existing browser, or relaunches the closed
temporary profile headlessly, to export D&D Beyond state only. For the temporary
path, the user presses Enter after sign-in and the helper closes only that
temporary browser instance; the user's ordinary browser is unaffected. It then
validates the state in the matching container image and saves it to the labeled
`ddb-mcp-session` Docker volume.

If authentication is missing or expires, account-backed MCP tools return a
clear error telling the AI to ask the user to run `ddb-mcp-auth login` again.
Useful host diagnostics are:

```bash
ddb-mcp-auth info
ddb-mcp-auth validate
ddb-mcp-auth validate --live
ddb-mcp-auth reset
ddb-mcp-auth volume remove
ddb-mcp-auth help
```

`info` lists browser candidates, the active Docker context, helper/image
versions, volume ownership, and the recommended next action without displaying
session data. `validate` performs structural checks and a local browser CDP
probe without contacting D&D Beyond; add `--live` for one bounded read-only
authentication check. `reset` preserves the labeled volume, while
`volume remove` removes it and refuses while a running container has it
mounted. The destructive commands prompt unless `--force` is supplied.

All operational commands accept `--volume`, `--image`, `--browser-path`, and
`--timeout` overrides. `login`, `validate`, and `info` accept `--json` for
machine-readable output. A released helper defaults to the matching immutable
GHCR image, so an image override is normally needed only for local development.
Before opening a login browser, the helper verifies that the selected image
contains the matching session-administration entry point. For a source build,
rebuild `ddb-mcp-local:latest` after changing or rebuilding the helper.

### Example prompts

**List your characters:**
```
List all my D&D Beyond characters
```

**Get full character data:**
```
Get the full character sheet for character ID 140476673
```

**List your campaigns:**
```
What campaigns am I part of on D&D Beyond?
```

**Get campaign details:**
```
Show me the details for campaign 6709239, including all the player characters
```

**Search for spells:**
```
Search D&D Beyond for spells named "Fireball"
```

**Search for monsters:**
```
Find the Beholder stat block on D&D Beyond
```

**Discover and read a sourcebook:**
```
Show me the table of contents for the Player's Handbook
```

```
Read the Barbarian class section from the Player's Handbook
```

**Search accessible sourcebooks by title:**
```json
{
  "query": "Player's Handbook",
  "category": "sourcebooks"
}
```

**Include unavailable catalog sourcebooks:**
```json
{
  "query": "handbook",
  "category": "sourcebooks",
  "source_scope": "all"
}
```

**Download a character:**
```
Download the character data for Roland Stonehelm to my Downloads folder
```

### Finding character and campaign IDs

- **Character ID**: The number in the character URL — `dndbeyond.com/characters/140476673`
- **Campaign ID**: The number in the campaign URL — `dndbeyond.com/campaigns/6709239`

You can also use `ddb_list_characters` and `ddb_list_campaigns` to get IDs without leaving Claude.

### Sourcebook discovery and pagination

Use `ddb_list_library` to get the slug for any book you own. Examples:

| Book | Slug |
|------|------|
| Player's Handbook (2024) | `dnd/phb-2024` |
| Dungeon Master's Guide (2024) | `dnd/dmg-2024` |
| Monster Manual (2024) | `dnd/mm-2024` |
| Player's Handbook (2014) | `dnd/phb-2014` |

`ddb_read_book` returns JSON. With only `book_slug`, it returns the complete
book outline. Add a chapter path with `mode: "outline"` to discover that
chapter's stable section IDs:

```json
{
  "book_slug": "dnd/phb-2024",
  "chapter_slug": "character-classes/barbarian",
  "mode": "outline"
}
```

To read a chapter, omit `mode` or set it to `"content"`. Content responses
contain Markdown in `text`, image descriptions and HTTPS URLs in `images`, an
opaque `nextCursor`, and a `done` flag. Pass `nextCursor` back as `cursor` with
the same book, chapter, section, and character limit until `done` is `true`.

```json
{
  "book_slug": "dnd/phb-2024",
  "chapter_slug": "character-classes/barbarian",
  "max_chars": 10000
}
```

The default content limit is 10,000 Markdown characters and the server maximum
is 25,000. A chunk prefers complete headings, paragraphs, lists, and tables,
but an individually oversized block is split. To read only one section, pass a
stable `section` ID returned by the chapter outline, or an exact heading name
when that name is unique.

`ddb_search` always returns a JSON envelope, including `count: 0` and an empty
`results` array when nothing matches. Ordinary spell, monster, item, race,
class, feat, and general results include a `sources` array. Each normalized
source has nullable `title`, `url`, `bookSlug`, and `chapterSlug` fields. The
array is empty when the rendered D&D Beyond listing does not expose source
attribution; the server does not open every result page to fill it in.

With `category: "sourcebooks"`, `source_scope` defaults to `"accessible"` and
searches owned/shared books by title. Set it to `"all"` to include catalog
books. Sourcebook results have an `access` value of `"accessible"`,
`"unavailable"`, or `"unknown"`. Only pass a result to `ddb_read_book` when
`access` is `"accessible"` and `bookSlug` is non-null. Unavailable results may
instead contain the D&D Beyond store URL. `source_scope` is invalid for every
other category.

Image bytes are not downloaded or embedded.

## Upgrading

Pull the new immutable image and replace `ddb-mcp-auth` with the executable from
the same release. Restart the MCP client or Docker Toolkit profile afterward.

## Session storage

Authentication is stored only in the labeled `ddb-mcp-session` Docker volume,
which contains D&D Beyond cookies and local storage. The normal MCP container
mounts it read-only. Do not copy, inspect, log, or publish its contents.

Use the helper to clear local state:

```bash
ddb-mcp-auth reset
```

This does not revoke the server-side D&D Beyond session. Use D&D Beyond account
controls when server-side revocation is required.

## Development

```bash
# Run in development mode (no build step needed)
npm run dev

# Build
npm run build

# Watch mode
npm run build:watch

# Complete offline unit and MCP contract suite
npm test

# Production-image browser and container integration suite
npm run test:docker

# Standalone host-helper tests
npm run test:go
```

Authenticated read-only release testing is deliberately separate and requires
an explicit local opt-in. See [`LIVE_TESTING.md`](LIVE_TESTING.md); never place
a D&D Beyond session in this repository or GitHub Actions.

## Docker MCP Toolkit

The fork includes a reproducible Docker build, a local Docker MCP server
definition, release images on GitHub Container Registry, and instructions for
persisting authenticated browser state. See [`DOCKER.md`](DOCKER.md).

## License

MIT
