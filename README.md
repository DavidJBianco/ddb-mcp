# Mysterium

Mysterium connects an AI assistant to the D&D Beyond content you can access. It
runs locally through the [Model Context Protocol (MCP)](https://modelcontextprotocol.io)
and can work with characters, campaigns, sourcebooks, monster and NPC stat
blocks, and other D&D Beyond pages.

> **Important:** D&D Beyond does not provide a supported public API for this
> use case. Mysterium uses the website and services available to your signed-in
> browser. A D&D Beyond update can temporarily break a feature until Mysterium
> is updated.

Mysterium is an independent, MIT-licensed fork of
[ddb-mcp](https://github.com/ddb-mcp/ddb-mcp). It is not affiliated with,
endorsed by, or sponsored by D&D Beyond, Wizards of the Coast, or Hasbro.

## What you can do with Mysterium

Mysterium keeps the useful D&D Beyond access introduced by `ddb-mcp` and
extends it into a Docker-based assistant for more complete play and campaign
workflows:

- **Work with characters.** List and filter your characters, retrieve complete
  character data, access a character that is shared with you through a
  campaign, show a configured character portrait, and export an owned
  character sheet as a PDF.
- **Review campaigns.** List your campaigns and retrieve the participants,
  notes, and other information D&D Beyond makes visible to your account.
  Permission-sensitive information stays unavailable when the site does not
  expose it to you.
- **Use your sourcebooks.** Discover books available through purchases and
  content sharing, inspect their outlines, read a specific chapter or section,
  continue long passages in manageable chunks, and search globally or within
  one accessible book.
- **Look up monsters and NPCs.** Resolve catalog entries to structured stat
  blocks, distinguish current and Legacy entries, or open a readable viewer
  with copy and PNG export controls.
- **Read or inspect other pages.** Extract bounded text from a D&D Beyond page
  or capture the visible page when a visual check is genuinely useful.
- **Run with Docker.** Docker provides everything Mysterium needs, so you do
  not need to install any additional programming languages or software
  packages.
- **Sign in through a normal browser.** The included helper opens a visible
  browser for D&D Beyond login. Mysterium never asks an AI model for your
  password.

## Quickstart

### 1. Install Docker Desktop

[Install Docker Desktop](https://www.docker.com/products/docker-desktop/) if it
is not already available on your computer, then start it.

Advanced users can use Docker Engine and the Docker CLI instead. The rest of
this guide assumes Docker Desktop.

### 2. Download Mysterium

Open the [Mysterium releases page](https://github.com/DavidJBianco/mysterium/releases)
and choose a release. Download the authentication helper for your computer:

- **Mac with Apple silicon (M1 or newer):**
  `mysterium-auth_darwin_arm64.tar.gz`
- **Mac with an Intel processor:** `mysterium-auth_darwin_amd64.tar.gz`
- **Windows on a 64-bit Intel or AMD processor:**
  `mysterium-auth_windows_amd64.zip`
- **Linux on a 64-bit Intel or AMD processor:**
  `mysterium-auth_linux_amd64.tar.gz`
- **Linux on a 64-bit ARM processor:** `mysterium-auth_linux_arm64.tar.gz`

Download `checksums.txt` from the same release if you want to verify the
archive, then extract the helper and place the executable somewhere on your
`PATH`.

You do not need to run `docker pull` yourself. The authentication helper
automatically downloads its matching Mysterium image the first time it is
needed. Docker also downloads a missing image automatically when your MCP
client starts Mysterium, so the first launch may take a little longer.

The helper and container should always use the same version. Released helpers
default to their matching immutable image, and `mysterium-auth version` shows
the installed helper version.

Mysterium authentication supports Chrome, Edge, Brave, Vivaldi, and Chromium.
Safari and Firefox are not currently supported for login.

### 3. Sign in to D&D Beyond

```bash
mysterium-auth login
```

The helper opens a visible browser. Complete the normal D&D Beyond sign-in
there, then let the helper validate and save the session in the
`mysterium-session` Docker volume.

If you need to check the saved session later, use:

```bash
mysterium-auth info
mysterium-auth validate
mysterium-auth validate --live
```

`validate` checks the local setup. `validate --live` makes one bounded,
read-only D&D Beyond request. If the session expires, run
`mysterium-auth login` again.

### 4. Connect your MCP client

#### ChatGPT desktop and Codex

The ChatGPT desktop app and local Codex clients share MCP configuration. In the
desktop app, open **Settings** → **MCP servers**, select **Add server**, choose
**STDIO**, and enter this command, replacing `X.Y.Z` with the release version:

```bash
docker run --rm --interactive --volume mysterium-session:/home/mcp/.config/mysterium:ro ghcr.io/davidjbianco/mysterium:vX.Y.Z
```

You can make the same configuration directly in `~/.codex/config.toml`:

```toml
[mcp_servers.mysterium]
command = "docker"
args = [
  "run",
  "--rm",
  "--interactive",
  "--volume",
  "mysterium-session:/home/mcp/.config/mysterium:ro",
  "ghcr.io/davidjbianco/mysterium:vX.Y.Z",
]
```

Save the server and restart the app. Enter `/mcp` in the composer to confirm
that Mysterium is connected. See the official
[OpenAI MCP configuration guide](https://developers.openai.com/codex/mcp/)
for more about shared desktop and Codex configuration. This local Docker setup
does not apply to ChatGPT on the web.

#### Claude Desktop

For Claude Desktop, add Mysterium as a direct stdio server in your MCP
configuration:

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

Replace `X.Y.Z` with the same version used above, save the configuration, and
restart Claude Desktop. Other MCP clients that can launch a stdio server can
use the equivalent command:

```bash
docker run --rm --interactive \
  --volume mysterium-session:/home/mcp/.config/mysterium:ro \
  ghcr.io/davidjbianco/mysterium:vX.Y.Z
```

The server needs outbound HTTPS access to D&D Beyond.

### 5. Try it

You can ask your assistant questions such as:

- “List my D&D Beyond characters.”
- “Show me the portrait and details for my bard.”
- “Who is in the campaign I run?”
- “Search my available sourcebooks for the rules on exhaustion.”
- “Show me the current stat block for an owlbear.”
- “Open the Player's Handbook outline and summarize the section on resting.”

The assistant decides which Mysterium tools to call and can ask you to clarify
when more than one result matches.

## Feature guide

### Characters and portraits

Character lists can be filtered by name, class, species, campaign, and level,
then sorted by name, level, creation date, or modification date. Filters in
different categories combine with AND; multiple values within one category
combine with OR. Class filtering understands multiclass characters.

Character detail preserves the complete data D&D Beyond provides and includes
a stable, nullable `portraitUrl` convenience field. The portrait tool returns
the configured portrait as display-ready image content. It does not substitute
a decorative frame, backdrop, or generic placeholder when no portrait exists.

Portrait downloads are limited to supported D&D Beyond image hosts and to
5 MiB. They are validated as JPEG, PNG, WebP, or GIF, retained only for the
current request, and never cached or written to disk.

Character PDF export follows D&D Beyond's rendered **Manage** → **Export to
PDF** workflow. It currently applies to owned characters and requires an MCP
client with MCP Apps support. The read-only viewer includes page, zoom, search,
fullscreen, and download controls. PDF data is limited to 25 MiB, held in a
bounded in-memory cache, and not written to the normal container filesystem.

### Campaigns

Campaign lists can be filtered by name, campaign ID, your role, creation date,
player count, and content-sharing state. Detail results combine the structured
information issued by the campaign page with permission-aware rendered
content.

Visible private DM notes are included by default; callers can explicitly
exclude them. Invite and administration links are excluded by default and
must be requested individually. Destructive controls such as delete,
deactivate, remove, reset, and leave are always omitted.

### Sourcebooks and search

Mysterium can list sourcebooks currently accessible to your account, including
books made available through content sharing. It can return a book or chapter
outline before reading content, which helps an assistant select a relevant
chapter or stable section instead of loading an entire book.

Long reads return bounded Markdown plus a continuation cursor. The default
limit is 10,000 characters and the maximum is 25,000. Content is not persisted
or cached. Search can use D&D Beyond's global rendered index or restrict
results to one accessible book, and can include, exclude, or select only
entries marked Legacy by D&D Beyond.

Only small discovery summaries are cached in memory: library metadata for one
hour and character and campaign summaries for five minutes. Detail responses,
search results, sourcebook text, portraits, and stat blocks are not cached.

### Monsters and NPC stat blocks

Mysterium resolves monsters and NPCs found in D&D Beyond's monster catalog.
When a name is ambiguous, it returns candidates instead of silently choosing
one. Current and Legacy entries remain distinguishable, and edition labels are
reported separately.

Use structured stat-block results when the assistant needs JSON or faithful
Markdown. Clients with MCP Apps support can instead open a selectable-text
viewer with zoom, fullscreen, copy, canonical-page, and local PNG controls.
This does not cover stat blocks found only in sourcebook prose or entries that
are discoverable only as homebrew.

### Other D&D Beyond pages

The page reader is a read-only escape hatch for pages without a dedicated
tool. It can navigate to an allowed D&D Beyond URL, read the current page, and
continue long rendered text with a cursor. Extraction does not alter the live
page.

Page capture returns the visible viewport or one uniquely matched visible
element as in-memory PNG content. Captures are size-limited and never written
to disk. Because authenticated screenshots can contain private or copyrighted
information, use this only when a visual inspection is needed.

## Tool reference

| Tool | What it provides |
| --- | --- |
| `mysterium_list_characters` | Filtered, deterministically sorted character summaries. |
| `mysterium_get_character` | Complete character data and a nullable portrait URL. |
| `mysterium_get_character_portrait` | A validated, display-ready character portrait when configured. |
| `mysterium_export_character_pdf` | An owned character sheet in a read-only PDF viewer. |
| `mysterium_list_campaigns` | Filtered, deterministically sorted campaign summaries. |
| `mysterium_get_campaign` | Permission-aware campaign details, participants, notes, and requested safe links. |
| `mysterium_list_library` | Accessible sourcebooks and their identifiers. |
| `mysterium_read_book` | Book and chapter outlines or bounded section content with continuation. |
| `mysterium_search` | Bounded global or sourcebook-scoped D&D Beyond search results. |
| `mysterium_get_stat_block` | A normalized monster or NPC stat block, candidates, or a not-found result. |
| `mysterium_view_stat_block` | An interactive, read-only stat-block viewer. |
| `mysterium_read_page` | Bounded rendered text from an allowed page or the current page. |
| `mysterium_capture_page` | A bounded in-memory screenshot of the current page or one element. |

`read_pdf_bytes` and `read_stat_block_for_app` are private helpers for the
inline viewers. Compatible clients hide them from the model-facing tool list.

Machine-readable tools publish exact MCP output schemas. Successful JSON
results are returned identically as structured content and as a JSON text
block; failures are returned as MCP tool errors. Image-producing tools add an
independent MCP image content block when an image is available.

## Docker MCP Toolkit and other clients

Direct stdio is recommended for clients that support MCP Apps, including
Claude Desktop PDF and stat-block viewing. In manual verification, Docker MCP
Toolkit did not forward the MCP Apps capability, so app-only calls were safely
rejected before contacting D&D Beyond. Toolkit remains usable for non-App
tools, including structured stat-block retrieval.

Docker MCP Toolkit users can download `mysterium.yaml` from the same GitHub
release as the helper. The released catalog is pinned to that release's image:

```bash
mkdir -p "$HOME/.docker/mcp/catalogs"
cp /path/to/downloaded/mysterium.yaml "$HOME/.docker/mcp/catalogs/mysterium.yaml"

docker mcp profile create --name mysterium
docker mcp profile server add mysterium --server file://mysterium.yaml
```

The checked-in [`mysterium.yaml`](mysterium.yaml) is intended for source builds
and points to the locally built `mysterium:local` image. See
[`DOCKER.md`](DOCKER.md) for local builds, Docker MCP Toolkit details, and
container verification.

## Session safety and removal

The `mysterium-session` volume contains cookies and browser storage that grant
access to the associated D&D Beyond account. Do not copy, inspect, log,
publish, or bake it into an image. Mysterium does not accept D&D Beyond
credentials through MCP tool arguments.

To remove saved session files while preserving the helper-managed volume:

```bash
mysterium-auth reset
```

To remove the entire volume:

```bash
mysterium-auth volume remove
```

Neither operation revokes the server-side D&D Beyond session. Use D&D Beyond
account controls if you need to revoke it.

## Troubleshooting

- **The assistant cannot find Mysterium:** confirm Docker Desktop is running,
  check the MCP configuration, and restart the MCP client after changing it.
- **Authentication is missing or expired:** run
  `mysterium-auth validate --live`, then run `mysterium-auth login` again if
  validation fails.
- **The helper and server disagree:** confirm that the helper archive and image
  tag came from the same Mysterium release.
- **A previously working feature fails after a site update:** check the
  [Mysterium issues](https://github.com/DavidJBianco/mysterium/issues) and
  releases. D&D Beyond markup and unsupported services can change without
  notice.
- **A PDF or stat-block viewer will not open:** connect through direct stdio
  and confirm that the MCP client supports MCP Apps.

## Development and verification

End users only need Docker and the authentication helper. Contributors use the
locked Node and Go toolchains through the Makefile:

```bash
make build
make test
# Explicit authenticated release verification only:
make test-release
```

`make test` is fully offline and does not read a saved D&D Beyond session.
Authenticated tests are separate, read-only, and opt-in; see
[`LIVE_TESTING.md`](LIVE_TESTING.md).

## License

MIT.
