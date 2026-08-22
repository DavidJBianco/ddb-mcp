# AGENTS.md

## Project purpose

`ddb-mcp` is an MIT-licensed TypeScript MCP server that exposes a user's
authenticated D&D Beyond content through Playwright. D&D Beyond does not offer
a supported public developer API, so integrations are inherently sensitive to
site and DOM changes.

Preserve the existing visible-browser authentication flow and saved Playwright
storage state. Prefer browser navigation and rendered-DOM workflows over
reverse-engineered endpoints, especially for any operation that changes data.
The existing authenticated character-service request is a read-only exception;
do not treat it as precedent for mutation endpoints.

Current priorities, in order:

1. Preserve authentication and session reuse.
2. Improve sourcebook discovery and reading: table of contents, headings,
   cursor-based chunks, and later section-level search/retrieval.
3. Package and verify the server as a Docker MCP Toolkit-compatible image.
4. Add structured character creation and modification only when explicitly in
   scope and only with the write safeguards below.

## Branch and release policy

`main` is the protected release branch. `dev` is the integration branch.

- Never commit, merge, or push any change directly to `main` unless the user
  explicitly authorizes that exact exception.
- New feature branches must start from the current `dev` branch and use a
  `feature/<short-name>` name. Merge them back through a pull request to `dev`.
- Bug fixes should normally use a short-lived `fix/<short-name>` branch from
  `dev` and a pull request to `dev`. Direct fixes on `dev` require an explicit
  user instruction; do not infer permission merely because a change is small.
- Use `chore/<short-name>` or `docs/<short-name>` for non-feature work and merge
  it through a pull request to `dev`.
- Dependency automation must target `dev`, not `main`.
- Do not merge a feature branch to `main`, and do not open a release PR from
  any branch other than `dev`.
- Preserve unrelated work on long-lived branches. Delete a short-lived branch
  only after its merge and only when no follow-up work depends on it.

A transition from `dev` to `main` is a release, not an ordinary merge. Every
release requires all of the following before merge:

1. Update `package.json` and `package-lock.json` to the intended Semantic
   Version. Patch versions are compatible fixes, minor versions are compatible
   features, and major versions contain breaking changes.
2. Open a `dev` to `main` pull request and use its release checklist.
3. Pass every required GitHub CI job. GitHub CI is strictly offline: it may use
   mocks, synthetic fixtures, local browser pages, and Docker smoke tests, but
   it must never receive a D&D Beyond session or contact D&D Beyond.
4. Run the complete live test suite locally, outside GitHub Actions, using the
   external session file and the explicit live-test opt-in. Record the command,
   commit SHA, result, and any skipped tests in the release PR. If the live
   suite does not yet exist, cannot run, or does not pass, the release is
   blocked unless the user explicitly accepts that exception.
5. Obtain the user's release approval after the automated and live results are
   available. Merge or squash the release PR; do not rebase-merge it because
   the release workflow compares the release commit with its first parent.

After the release PR merges, automation may tag that exact `main` commit as
`vX.Y.Z`, create the GitHub Release, attach the npm package archive, and publish
`ghcr.io/davidjbianco/ddb-mcp:vX.Y.Z` plus `latest`. Release automation must not
create a version-bump commit or otherwise modify `main`.

## Repository map

- `src/index.ts`: MCP server setup, tool schemas, handlers, and stdio transport.
- `src/browser.ts`: shared headed Chromium instance/context and session storage.
- `src/auth.ts`: interactive D&D Beyond/Wizards login and session persistence.
- `src/tools/library.ts`: owned sourcebook listing and reading.
- `src/tools/character.ts`: character listing, read-only retrieval, and export.
- `src/tools/campaign.ts`: campaign scraping.
- `src/tools/search.ts`: rendered search/listing scraping.
- `src/tools/navigate.ts`: generic D&D Beyond navigation and interaction.
- `dist/`: committed TypeScript build output; update it when source changes.
- `Dockerfile`, `docker-mcp.yaml`, `DOCKER.md`: container and Docker MCP Toolkit
  integration.

## Development commands

Use the locked dependency graph. Do not casually regenerate `package-lock.json`.

```bash
npm ci
npm run dev
npm run lint
npm run typecheck
npm run build
```

There is currently no automated test suite; adding one is a project priority.
For every source change, run at least `npm run lint`, `npm run typecheck`, and
`npm run build`, plus the relevant automated tests once test scripts exist.
Review changes under `dist/` after building and commit the generated files that
correspond to the edited source.

For container-related changes, also run:

```bash
docker build --tag ddb-mcp-local:latest .
```

Do not claim authenticated or live-site behavior was verified unless it was
actually exercised with a suitable local session. Build-only verification is
not live D&D Beyond verification.

## Testing strategy

Automated testing is expected for new behavior and bug fixes. Design code so
that most behavior can be tested without a network connection, a D&D Beyond
account, or a real browser session.

### Default automated tests (mocked/offline)

These tests are safe to run routinely and should form the bulk of the suite:

- Unit-test cursor encoding, decoding, validation, input binding, chunk
  boundaries, `nextCursor`, and `done` semantics with synthetic content.
- Test DOM extraction against saved, synthetic, or heavily redacted HTML
  fixtures. Fixtures must contain no cookies, credentials, personal data,
  copyrighted book text, or full captured authenticated pages.
- Mock the narrow Playwright interfaces used by tool functions rather than
  mocking all of Playwright. Prefer dependency boundaries that accept a `Page`
  or extraction result over globally replacing browser modules.
- Test MCP schemas and handlers for valid input, rejected input, result shape,
  and `isError` behavior without launching Chromium.
- Include regression fixtures for empty pages, missing selectors, oversized
  blocks, repeated headings, tables/lists, malformed cursors, and changed page
  structure.
- Keep offline tests deterministic and independent of execution order, home
  directory contents, saved sessions, and external services.

Expose these through a normal `npm test` script. They must never navigate to
D&D Beyond or read `~/.config/ddb-mcp/session.json`.

### Browser integration tests (local, still mocked)

Where DOM behavior requires a browser, serve synthetic fixture pages locally
and exercise them with Playwright. These tests may launch Chromium but must not
contact D&D Beyond or require authentication. Keep them separately selectable,
for example with an `npm run test:browser` script, if their runtime or browser
dependency makes them unsuitable for the default unit-test loop.

### Live D&D Beyond tests (explicit opt-in)

Live tests are a separate verification tier. They are appropriate only for
selectors, authentication restoration, rendering behavior, and end-to-end
confidence that cannot be established with offline fixtures.

- Name and document them clearly as live tests; expose a separate command such
  as `npm run test:live`. Never include them in `npm test`, build, or ordinary
  CI by default.
- Never execute live tests in GitHub Actions or upload session state to GitHub.
  Live release verification runs locally and its summary is recorded in the
  release pull request.
- Do not run a live test unless the task explicitly calls for it or the user
  approves it after being told what pages and account data it will access.
- Require an explicit opt-in environment flag in addition to the command so an
  accidental invocation skips safely.
- Reuse the normal external session path; never copy session state into the
  repository or test artifacts. Detect a missing/expired session and skip or
  fail with a clear instruction rather than initiating an unexpected login.
- Keep live tests read-only unless the user explicitly authorizes a particular
  write test. Any live write test must also follow the dry-run, validation, and
  before/after safeguards below and use disposable test data where possible.
- Minimize requests and avoid assertions on private content. Assert structural
  properties and redact account-specific values from logs, snapshots, and
  failure output.
- Report offline/mock results and live-test results as separate categories so
  reviewers can tell exactly what was and was not exercised.

Do not compensate for an unavailable live session by weakening offline tests.
When live verification would materially reduce uncertainty, call it out as an
optional or approval-required follow-up rather than silently accessing the
site.

## Coding conventions

- Keep TypeScript strict and follow the existing ESLint configuration.
- This project uses ESM/NodeNext. Relative TypeScript imports must retain the
  `.js` extension used by emitted JavaScript.
- Keep browser and scraping logic in `src/tools/` or the browser/auth modules;
  keep `src/index.ts` focused on MCP schemas, dispatch, and error conversion.
- Validate tool inputs with Zod at the MCP boundary. Return actionable errors
  with `isError: true` from tool handlers.
- The MCP transport uses stdout. Send diagnostics to stderr (`console.error` or
  `process.stderr`), never stdout.
- Reuse the shared browser context and `getPage()` unless isolation is required
  for correctness. Do not break storage-state restoration.
- Prefer semantic, stable selectors and scoped fallbacks. D&D Beyond markup can
  change; avoid selectors based only on generated class names when a role,
  element, URL, `data-testid`, or content landmark is available.
- DOM extraction must not mutate the live page merely to remove unwanted
  elements. Clone the selected content subtree before cleanup, or filter during
  traversal, so subsequent tools can continue using the page.
- Keep waits bounded. Prefer waiting for a meaningful selector or state over
  adding long fixed delays. Account for D&D Beyond's client-side rendering.

## Sourcebook reading contract

Do not reintroduce a fixed truncation response that leaves the caller unable to
continue. Sourcebook reads should evolve around a small, deterministic contract:

- Discover the table of contents and headings separately from body retrieval.
- Return bounded text chunks plus an opaque `nextCursor` and a `done` boolean.
- A cursor must identify the same book/chapter and a stable continuation point;
  reject malformed cursors and cursors used against different input.
- Chunk boundaries should prefer paragraphs, list items, tables, or headings,
  with a hard size fallback for unusually large blocks.
- Preserve useful structure (heading level, lists, and readable table content).
- Keep extraction deterministic so retrying the same request and cursor yields
  the same result for unchanged page content.
- Do not cache or persist copyrighted sourcebook text by default. Return only
  content requested from the user's authenticated browser session.

Start with the smallest compatible extension of `ddb_read_book`; avoid adding
stateful server-side pagination or a large abstraction layer until required.
Section-level search and retrieval are later work unless explicitly requested.

## Authentication and sensitive data

The default host session is stored at:

```text
~/.config/ddb-mcp/session.json
```

The container session is stored at:

```text
/home/mcp/.config/ddb-mcp/session.json
```

These files contain cookies and browser storage that grant account access.

- Never read, print, log, diff, upload, commit, or copy session contents into
  the repository, tests, fixtures, issue text, or build context.
- Never commit credentials, cookies, authorization headers, screenshots that
  expose private account data, or downloaded character JSON.
- Never bake authentication state into an image. Docker must use an external
  volume for session persistence and run as the unprivileged `mcp` user.
- Keep ignore rules for session files and local auth/config directories.
- Do not ask users to provide Wizards credentials through MCP tool arguments.
  Authentication remains an interactive action in the visible browser.
- Use synthetic fixtures when tests are introduced. Redact IDs and personal
  data from diagnostic output and examples.

## Write-operation safeguards

Character creation and modification are not part of sourcebook work and must
not be added incidentally. When a write feature is explicitly requested:

1. Use the visible Playwright UI before considering undocumented mutation APIs.
2. Separate validation and planning from execution.
3. Provide a dry-run that describes the exact intended changes without
   clicking a final submit/save control.
4. Validate IDs, allowed values, prerequisites, and the current page/account
   state before mutation.
5. Capture a minimal before state, perform only the requested mutation, then
   re-read and compare the after state.
6. Report partial failure clearly; never imply success based only on a click.
7. Avoid broad generic interaction changes that make destructive actions easier
   without explicit confirmation and verification.

## Change discipline

- Keep changes narrowly scoped and preserve existing tool behavior unless an
  intentional interface change is documented.
- Do not rewrite or discard unrelated working-tree changes. Inspect `git status`
  before and after work.
- Update `README.md` and `DOCKER.md` when user-facing tool schemas, workflows,
  session paths, or container behavior change.
- Clearly distinguish observed behavior from assumptions about undocumented D&D
  Beyond pages or services. When live verification is unavailable, say so.
