# TODO

This is the project backlog for planned work and ideas that need evaluation.
Items are not promises for a particular release unless they are moved into a
release plan or pull request.

## Testing foundation

- [x] Exercise the MCP server through the actual Docker image in offline CI:
  start the image over stdio, complete MCP initialization, list tools, and call
  tools against a synthetic backend with container networking disabled.
- [x] Maintain a coverage matrix for every registered MCP tool. Each tool
  should have, at minimum, an offline successful call, MCP input/schema checks,
  and a representative dependency or browser failure asserted through
  `tools/call`.
- [ ] Add focused offline behavior tests for all tool implementations,
  including successful extraction, empty results, logged-out state, missing or
  changed selectors, navigation failure, timeout, and malformed upstream data.
- [x] Add real-Playwright browser integration tests against small synthetic
  local HTML fixtures. Fixtures must contain no session data, account data, or
  copyrighted sourcebook text.
- [x] Add Docker tests for the unprivileged runtime user, explicit writable
  session administration, read-only MCP session mounts, missing session, file
  permissions, process shutdown, and absence of credentials in image layers.
- [x] Add Docker MCP Toolkit integration coverage beyond a plain `docker run`,
  including catalog loading and an MCP call through a Toolkit profile where
  the test environment supports it.
- [ ] Evaluate making the authoritative non-live suite fully containerized so
  linting, type checks, Node unit/MCP/browser tests, Go helper tests, and
  production-image tests run in a consistent Linux environment on macOS,
  Windows, and Linux hosts. Retain focused host targets for fast iteration,
  reuse the same candidate image across applicable stages, and weigh the added
  Docker requirement and runtime before changing the current test workflow.

## Live test suite

- [x] Create a separately invoked, explicit-opt-in `make live-test-host` suite.
  It must never run in GitHub Actions and must never print or upload session or
  account content.
- [x] Define safe live coverage for every read-only tool: restored-session
  detection, character listing/retrieval, character download to a temporary
  path, campaign listing/retrieval, navigation/current-page retrieval, search,
  library listing, and sourcebook reading.
- [x] Decide and document safe live coverage for the host authentication helper
  and generic `mysterium_interact`. Interactive login requires a manual release
  check; interaction tests must use non-destructive controls or disposable data.
- [x] Test both character API success and rendered-page fallback without
  recording private character content in assertions or logs.
- [x] Make live tests fail clearly on missing or expired sessions, while never
  initiating an unexpected login or weakening the offline suite.
- [ ] Record the live command, commit SHA, result, and skips in each release PR.

## Sourcebook discovery and pagination

- [x] Remove the fixed 12,000-character `mysterium_read_book` truncation dead end.
- [x] Add table-of-contents discovery and structured heading discovery.
- [x] Add deterministic cursor-based chunk retrieval with opaque
  `nextCursor` and `done` fields.
- [x] Test cursor encoding, validation, book/chapter binding, stable retries,
  block-aware boundaries, oversized blocks, lists, tables, repeated headings,
  malformed cursors, and changed content.
- [x] Add section-level sourcebook retrieval with pagination.
- [x] Add sourcebook search and normalized source attribution to `mysterium_search`
  so callers can pivot from standalone results into a sourcebook when D&D
  Beyond exposes that relationship.
- [x] Preserve document structure without mutating the rendered live DOM or
  persisting copyrighted sourcebook text.

## Tool response contracts

- [ ] **Approved:** As each tool is reworked, give every ordinary and empty
  successful response a documented, stable JSON shape with consistent field
  names and types. Publish an MCP output schema and return the object through
  `structuredContent`, with the same JSON serialized in a text content block
  for client compatibility. Prefer a versioned JSON envelope where upstream
  payloads, provenance, pagination, or partial results need context. Keep MCP
  failures as `isError: true`; use another representation only when the caller
  explicitly requests a non-JSON artifact such as a PDF.
- [ ] Add contract tests for each reworked tool's JSON schema, empty result,
  partial result, upstream-shape change, and MCP error shape. Do not silently
  switch schemas when a fallback path is used.
- [x] Publish exact output schemas and structured/JSON-text parity for the
  mature `mysterium_list_library`, `mysterium_search`, `mysterium_read_book`,
  and `mysterium_get_stat_block` response families. Validate MCP App results
  through exact schemas while retaining concise App summaries rather than
  duplicating PDF bytes or full renderer payloads.
- [ ] When reviewing the deferred `mysterium_list_characters`,
  `mysterium_get_character`, `mysterium_list_campaigns`,
  `mysterium_get_campaign`, `mysterium_navigate`, `mysterium_current_page`, and
  `mysterium_interact` designs, define each stable success envelope, empty and
  partial result semantics, exact output schema, `structuredContent`, JSON-text
  behavior, and contract tests before considering the tool release-ready.

## Character and campaign retrieval

- [ ] **`mysterium_list_characters` filtering and sorting:** Replace DOM-card parsing
  with normalized summaries from the read-only character-list request while
  preserving authentication checks and explicit upstream-failure handling.
  Return a stable JSON envelope such as `{ count, total, filters, sort,
  characters }`; do not return the upstream service wrapper unchanged. Each
  character should expose stable ID, name, numeric level, class description,
  species/race name, campaign ID/name when present, status, and created/modified
  dates. Do not expose image URLs or other fields unless a use case requires
  them.
- [ ] Add optional composable `mysterium_list_characters` filters. At
  minimum, support name, class (including multiclass characters), species or
  race, minimum/maximum or exact level, and one or more campaign IDs. Apply
  filters to the normalized list inside the MCP server with documented
  case-folding, partial versus exact matching, AND/OR semantics, and validation
  so requests such as “Bards of level 3 or higher who are elves” are
  deterministic. Support the upstream sort modes where useful: created, name,
  level, and modified date in ascending or descending order.
- [ ] Define and test the character-list filter contract before implementation:
  case-insensitive matching; exact campaign IDs; documented exact-versus-
  substring behavior for name/class/species; all supplied filter categories
  combined with AND; multiple values within one category combined with OR;
  inclusive numeric level bounds; deterministic tie-breaking; sensible limits;
  and rejection of contradictory bounds or malformed IDs before browser access.
  Cover no filters, no matches, multiclass matching, campaign-less characters,
  multiple campaigns, upstream pagination, changed response shape, and MCP
  `structuredContent` plus JSON-text parity.
- [x] Investigate the authenticated character-list implementation with a
  structural probe that retains no session, cookie, note, or character payload
  values. The page performs a read-only
  `character/v5/characters/list` request with only the user ID, receives a
  complete paginated list, and filters client-side. Each summary already has
  stable `id`, `name`, numeric `level`, `classDescription`, `raceName`,
  `campaignId`, `campaignName`, status, and created/modified dates. Therefore
  campaign filtering does not require fetching campaign pages or issuing N+1
  full-character requests. Preserve a rendered-page fallback for the list only
  if needed for resilience, and test pagination rather than assuming every
  account fits one response.
- [ ] **`mysterium_get_character` contract cleanup:** Remove the public
  `fallback_scrape` argument, the rendered-sheet scraper, its tests, and its
  documentation. The fallback's partial schema is not compatible with the full
  character response and should not be returned silently. Continue using the
  authenticated read-only character-detail request and return an explicit MCP
  error on failure.
- [ ] Normalize `mysterium_get_character` into a documented JSON envelope rather than
  exposing the upstream wrapper as the tool contract. Preserve the full useful
  character payload initially to avoid accidental data loss, but identify
  provenance/schema version and keep upstream transport fields such as request
  IDs, messages, and pagination out of the public response. Add tests for a
  complete character, missing/inaccessible ID, authentication failure,
  upstream schema change, large payload handling, and structured/text parity.
- [x] The live feasibility check confirmed that the read-only character-detail
  service returns the complete payload for an owned character, while the
  scraper provides only name, level, race, class, HP, abilities, and skills. A
  separately named partial-summary tool can be reconsidered only if a concrete
  use case emerges.
- [ ] **`mysterium_list_campaigns` contract:** Review campaign-list retrieval
  alongside the campaign detail design. Define a stable normalized envelope,
  empty-list behavior, exact output schema, structured/JSON-text parity, and
  changed-upstream-shape tests without exposing administrative links or invite
  secrets.
- [x] **Focused PDF client-compatibility probe:** Claude Desktop 1.34493.1
  rejected a plain embedded `application/pdf` resource and could not
  dereference the custom-scheme resource link, but successfully rendered and
  downloaded the deterministic synthetic PDF through a temporary MCP App with
  an inline viewer. This passes the minimum Claude gate and establishes the
  MCP App delivery contract; see `PDF_PROBE_RESULTS.md`.
- [x] **Focused live PDF acquisition probe:** The external
  authenticated session and D&D Beyond's visible “Export to PDF” workflow for
  one owned character returned HTTP 200 and `application/pdf`; the bounded file
  had a `%PDF` signature and four pages. The secure temporary capture was
  deleted unconditionally, and no character values or PDF contents were
  reported. This remains an explicit-opt-in local workflow and must never run
  in GitHub Actions; see `PDF_PROBE_RESULTS.md`.
- [ ] **Codex Desktop PDF compatibility:** Build a focused local-client probe
  for the production MCP App contract and verify inline viewing plus download
  in Codex Desktop. Record the exact client version and results. This follow-up
  does not block the initial Claude-only PDF export implementation.
- [ ] **Docker MCP Toolkit PDF App compatibility:** Retest after Docker MCP
  Gateway forwards the standardized `io.modelcontextprotocol/ui` capability to
  downstream servers. Until then, use Claude Desktop's direct container stdio
  configuration for PDF viewing; Toolkit-routed calls fail closed before
  browser acquisition.
- [x] After both probes pass, remove `mysterium_download_character` and add a clearly
  named read-only character-sheet PDF export tool. Drive the documented visible
  export workflow, enforce timeout and size limits, and deliver the PDF through
  a Claude-compatible MCP App with an inline viewer, download control, app-only
  byte-reading tool, and small structured JSON metadata. Never persist it in
  the normal container. Cover missing characters,
  unavailable export controls, popup/download failures, invalid or oversized
  responses, cleanup, redaction, Claude delivery, and a bounded live success.
  Keep the viewer and its dependencies license-compliant, self-contained, and
  inside the production container; do not introduce an external helper app.
  Implemented with a source-owned shared Mysterium viewer shell and read-only
  Mozilla PDF.js renderer, a two-entry/50 MiB in-memory cache with 60-minute
  sliding expiry, gzip-compressed app-private restoration, app-only bounded
  byte reads, searchable page text and form values, and direct-container Claude
  Desktop delivery. Offline, Docker, audit, live acquisition, inline rendering,
  viewer controls, download, and downloaded-file opening were verified; Codex
  and Toolkit Apps forwarding remain follow-ups.
- [ ] **`mysterium_get_campaign` enrichment:** Use the observed read-only campaign
  details and short-character data plus permission-aware rendered extraction.
  Return a stable JSON envelope containing campaign ID/name/status/creation
  date, DM and viewer role, content- and item-sharing status, active player and
  character summaries with stable IDs, description, public notes, and
  DM-private notes only when visible and explicitly requested. Label every
  notes field by visibility and provenance. Deliberately exclude invite codes,
  reset/remove/deactivate links, and other administrative secrets or mutation
  controls.
- [ ] Define `mysterium_get_campaign` options and permissions before implementation.
  Private DM notes should default to excluded and require an explicit
  `include_private_notes` request; public notes and description may be included
  by default when visible. Represent missing, empty, hidden, and inaccessible
  fields distinctly without revealing that hidden content exists to an
  unauthorized viewer. Test DM and player views, campaigns with no characters
  or notes, private characters, content sharing on/off, changed selectors,
  upstream-detail failure with safe rendered fallback, exact output schema,
  `structuredContent`, JSON-text parity, and contract validation. Keep game-log
  retrieval and all mutations out of scope.

## Future Maps and Journals exploration

- [ ] Revisit D&D Beyond Maps as a separate read-only integration after its
  product and rendered UI stabilize. Inventory campaign/map discovery,
  encounters or scenes, tokens, and other viewer-visible state without adding
  creation, editing, movement, sharing, or other mutations. Define privacy,
  copyrighted-map, request-volume, and role-based access boundaries before any
  implementation.
- [ ] Revisit Campaign Journals as a distinct permission-aware read tool, not a
  field added incidentally to `mysterium_get_campaign`. Determine the eventual DM and
  player journal model, campaign binding, visibility labels, pagination, and
  rendered retrieval path. Default to excluding DM-private entries unless
  explicitly requested and authorized; do not add create/edit/delete support
  without the repository's full write-operation safeguards.

## Generic browser tools

- [ ] Review `mysterium_navigate`, `mysterium_current_page`, and `mysterium_interact` as a
  separate project before extending them. Reassess their stateful shared-page
  contract, documentation, stable JSON response envelopes, exact output
  schemas, structured/JSON-text behavior, truncation, non-mutating DOM
  extraction, click/fill safeguards, sensitive-value redaction, redirect
  checks, and whether screenshots should be returned directly as MCP image
  content instead of an inaccessible container-local `/tmp` path.

## Character creation and modification

- [ ] Design structured character creation through visible Playwright browser
  workflows; do not use undocumented mutation endpoints by default.
- [ ] Design structured character modification through visible Playwright
  browser workflows.
- [ ] Require validation, an exact dry-run plan, explicit execution, and
  before/after verification for every write operation.
- [ ] Define disposable live-test data and rollback/cleanup expectations before
  enabling any automated live write test.
- [ ] Report partial failures and post-write verification failures distinctly.

## Security and robustness

- [x] Replace prefix-based D&D Beyond URL checks with parsed origin validation
  and add tests for lookalike hosts, credentials in URLs, alternate ports,
  fragments, redirects, and allowed canonical hosts.
- [ ] Validate identifiers, slugs, output paths, and screenshot behavior at the
  MCP boundary; add traversal and unsafe-path regression tests where relevant.
- [ ] Test that diagnostics never corrupt MCP stdout and that errors and logs
  redact cookies, authorization data, local paths, and private page content.
- [ ] Review DOM extraction for destructive operations and clone or otherwise
  preserve live page state before removing elements.
- [ ] Replace brittle fixed waits with bounded waits for meaningful page state
  as tool-specific tests make those changes safe.

## Packaging and releases

- [ ] Complete the first governed `dev` to `main` release, including the local
  live suite, SemVer update, release approval, tag, GitHub Release, and GHCR
  publication.
- [ ] Pull and smoke-test the published immutable GHCR tag on both supported
  architectures where runners or hardware are available.
- [ ] Verify the published image's provenance, SBOM, OCI labels, non-root user,
  entrypoint, and absence of session or credential material.
- [ ] Configure GitHub branch protection/rulesets so required offline checks
  and the `dev` to `main` release flow are enforced by the repository host as
  well as documented in `AGENTS.md`.
- [x] Evaluate a configurable external session path or documented import helper
  for non-default host sessions without ever copying session data into the
  repository or image.
