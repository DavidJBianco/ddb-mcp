# PDF Export Feasibility Probe Results

Date: 2026-08-23

## Decision

**Go for a Claude-first production implementation.** Claude Desktop can render
and download a synthetic PDF through an MCP App, and the live rendered D&D
Beyond export workflow returns a valid PDF. Codex Desktop compatibility remains
an explicit follow-up and does not block the initial Claude-only feature.

The production delivery contract should use an MCP App with an inline PDF
viewer and an app-only byte-reading tool. A plain embedded
`application/pdf` resource must not be used as the primary Claude contract: the
client rejected it while validating the tool result as an image content block.
A custom-scheme resource link exposed metadata but was not dereferenceable by
the client.

## Client Delivery Probe

| Client | Version | Result |
| --- | --- | --- |
| Claude Desktop | 1.34493.1 | Pass through an MCP App: the one-page synthetic PDF rendered inline, its download control worked, and the downloaded file contained the expected phrase. |
| Codex Desktop | Not tested | Deferred to a separate compatibility TODO after difficulty establishing an equivalent local-client probe. |

The deterministic synthetic file was 1,681 bytes, had SHA-256
`f92d4927473514ac1bf520a034f557da09149d3825783899dcf3f2717ed82ec7`,
and contained `MYSTERIUM-PDF-PROBE-2026`.

The successful temporary bundle reused the published inline viewer from
`@modelcontextprotocol/server-pdf` 1.7.5. The package identifies its code as
MIT-licensed and its bundled PDF.js 5.7.284 dependency as Apache-2.0. The probe
included both the attribution notice and license text. No viewer code or probe
bundle is retained in the repository.

## Live Acquisition Probe

The read-only probe used the saved helper-managed Docker session volume mounted
read-only. It selected an available owned character without logging identifying
values, followed the rendered **Manage** → **Export to PDF** workflow, and
fetched the exact generated same-origin `/sheet-pdfs/` link exposed by that
workflow.

| Check | Result |
| --- | --- |
| HTTP status | 200 |
| Content type | `application/pdf` |
| PDF signature | `%PDF` present |
| Size | 674,675 bytes (below 25 MiB limit) |
| SHA-256 | `d5f9e1b0ecd5403d1a6f9dddf1cb3af735992051122150d81d41b8d5bde6bdcb` |
| Page structure | 4 pages reported by `pdfinfo` |
| Timeout | Completed within the 90-second acquisition limit |
| Cleanup | Captured PDF and mode-restricted temporary directory removed unconditionally |

No character names, IDs, URLs, PDF contents, session values, or other account
details were logged or retained.

## Commands Used

The temporary probes were invoked directly and did not add Makefile targets:

```text
node tmp/pdf-probe-mcpb/verify.mjs
mcpb validate tmp/pdf-probe-mcpb
mcpb pack tmp/pdf-probe-mcpb tmp/mysterium-pdf-download-probe.mcpb
node tmp/pdf-live-probe/run.mjs
make test
```

All probe server files, runner files, fixtures, generated PDFs, and packaging
artifacts were removed after recording these results. The temporary Claude MCP
App was uninstalled from Claude Desktop after testing.
