# D&D Beyond MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that gives Claude direct access to your D&D Beyond account — characters, campaigns, sourcebooks, spells, monsters, and more.

## Features

| Tool | Description |
|------|-------------|
| `ddb_login` | Authenticate with D&D Beyond (Wizards ID). Run once to save your session to disk. |
| `ddb_list_characters` | List all characters in your account with ID, level, race, and class. |
| `ddb_get_character` | Fetch full character JSON from the D&D Beyond character API. |
| `ddb_download_character` | Save a character's full JSON data to a local file. |
| `ddb_list_campaigns` | List all campaigns you're part of (as DM or player). |
| `ddb_get_campaign` | Fetch campaign details — DM, description, and active characters. |
| `ddb_list_library` | List sourcebooks you own or can access through sharing, including their slugs. |
| `ddb_read_book` | Discover book/chapter outlines and read bounded chapter or section content with cursor pagination. |
| `ddb_search` | Search D&D Beyond indexes for spells, monsters, magic items, races, classes, feats, or general results. |
| `ddb_navigate` | Navigate to any D&D Beyond URL and return its text content. |
| `ddb_interact` | Click, fill, or screenshot the currently loaded browser page. |
| `ddb_current_page` | Return the text content of whatever page is currently loaded. |

## Prerequisites

- [Node.js](https://nodejs.org) 18 or later
- [Claude Code](https://claude.ai/claude-code) CLI

## Installation

### Option A — Install directly from GitHub (recommended)

```bash
npm install -g "https://github.com/ddb-mcp/ddb-mcp/archive/refs/heads/main.tar.gz"
```

Then install the browser:

```bash
npx playwright install chromium
```

Find the install path and register with Claude Code:

```bash
npm root -g
# outputs something like /usr/local/lib/node_modules
```

```bash
claude mcp add dndbeyond node /usr/local/lib/node_modules/ddb-mcp/dist/index.js
```

---

### Option B — Clone and build manually

```bash
git clone https://github.com/ddb-mcp/ddb-mcp.git
cd ddb-mcp
npm install
npx playwright install chromium
```

Register with Claude Code:

```bash
claude mcp add dndbeyond node /absolute/path/to/ddb-mcp/dist/index.js
```

Or edit `~/.claude/settings.json` manually:

```json
{
  "mcpServers": {
    "dndbeyond": {
      "command": "node",
      "args": ["/absolute/path/to/ddb-mcp/dist/index.js"]
    }
  }
}
```

## Usage

### First-time login

The first time you use the server, you need to authenticate:

```
ddb_login
```

A browser window (Chrome for Testing) will open and navigate to the D&D Beyond login page. Complete the login using your Wizards ID account. Once you're redirected back to D&D Beyond, your session is automatically saved to `~/.config/ddb-mcp/session.json` and reused on all future calls.

You only need to log in once. If your session expires, just run `ddb_login` again.

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

Search results are standalone D&D Beyond URLs and do not necessarily identify
a parent sourcebook. Use `ddb_list_library` and book outlines to navigate
within a sourcebook. Image bytes are not downloaded or embedded.

## Upgrading

To upgrade to the latest release, run the install command again — npm will overwrite the existing installation:

```bash
npm install -g "https://github.com/ddb-mcp/ddb-mcp/archive/refs/heads/main.tar.gz"
```

To install a specific tagged version:

```bash
npm install -g "https://github.com/ddb-mcp/ddb-mcp/archive/refs/tags/v1.0.2.tar.gz"
```

Then restart Claude Code and run `/mcp` to reconnect the server.

## Session storage

Your session is saved to `~/.config/ddb-mcp/session.json`. This file contains browser cookies and local storage from your D&D Beyond login. Keep this file private — it grants access to your account.

To log out or reset your session, delete the file:

```bash
rm ~/.config/ddb-mcp/session.json
```

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
