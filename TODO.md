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
- [ ] Add Docker tests for the unprivileged runtime user, writable session
  volume, read-only externally mounted session, missing session, file
  permissions, process shutdown, and absence of credentials in image layers.
- [ ] Add Docker MCP Toolkit integration coverage beyond a plain `docker run`,
  including catalog loading and an MCP call through a Toolkit profile where
  the test environment supports it.

## Live test suite

- [ ] Create a separately invoked, explicit-opt-in `npm run test:live` suite.
  It must never run in GitHub Actions and must never print or upload session or
  account content.
- [ ] Define safe live coverage for every read-only tool: restored-session
  detection, character listing/retrieval, character download to a temporary
  path, campaign listing/retrieval, navigation/current-page retrieval, search,
  library listing, and sourcebook reading.
- [ ] Decide and document safe live coverage for `ddb_login` and generic
  `ddb_interact`. Interactive login may require a manual release check;
  interaction tests must use non-destructive controls or disposable data.
- [ ] Test both character API success and rendered-page fallback without
  recording private character content in assertions or logs.
- [ ] Make live tests fail clearly on missing or expired sessions, while never
  initiating an unexpected login or weakening the offline suite.
- [ ] Record the live command, commit SHA, result, and skips in each release PR.

## Sourcebook discovery and pagination

- [ ] Remove the fixed 12,000-character `ddb_read_book` truncation dead end.
- [ ] Add table-of-contents discovery and structured heading discovery.
- [ ] Add deterministic cursor-based chunk retrieval with opaque
  `nextCursor` and `done` fields.
- [ ] Test cursor encoding, validation, book/chapter binding, stable retries,
  block-aware boundaries, oversized blocks, lists, tables, repeated headings,
  malformed cursors, and changed content.
- [ ] Add section-level sourcebook retrieval and search after the pagination
  contract is stable.
- [ ] Preserve document structure without mutating the rendered live DOM or
  persisting copyrighted sourcebook text.

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

- [ ] Replace prefix-based D&D Beyond URL checks with parsed origin validation
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
- [ ] Evaluate a configurable external session path or documented import helper
  for non-default host sessions without ever copying session data into the
  repository or image.
