# Live read-only testing

Live tests are a local release gate, not a GitHub Actions job. They make
authenticated, read-only requests to D&D Beyond. The suite never performs a
fresh login, clicks account controls, fills forms, or modifies D&D Beyond data.

Invoking `make live-test`, `make live-test-host`, or `make test-release` is the
explicit opt-in. No additional authorization environment flag is required.

For complete release-candidate verification, run:

```bash
make test-release
```

This runs every non-live test, builds one candidate image, and then reuses that
exact image for the read-only Docker live suite.

## Docker live suite

The normal Docker suite uses the helper-managed `mysterium-session` volume.
Authenticate first if necessary, then run:

```bash
make login
make live-test
```

`make live-test` builds the candidate image, verifies that the volume exists
and has the `mysterium-auth` ownership labels, and then runs that image. The volume is
mounted read-only at `/home/mcp/.config/mysterium`; session state is never
copied to a host test file. Override the volume only when deliberately using a
separately helper-managed volume:

```bash
MYSTERIUM_SESSION_VOLUME=another-managed-volume make live-test
```

The Docker command uses `mysterium:test` by default. Set `TEST_IMAGE` when a
different local candidate tag is required. Within `make test-release`, Make
builds that image once and both the offline Docker and live suites reuse it.
The test container has a recognizable `mysterium-live-test-<runner-pid>` name
and an `org.mysterium.test-suite=live` label. Normal MCP shutdown removes it
through Docker's `--rm`; the runner also force-removes that exact name after
failures or incomplete child shutdown.

## Host diagnostic suite

The secondary host suite requires an external Playwright storage-state file:

```bash
MYSTERIUM_SESSION_PATH=/absolute/path/to/session.json make live-test-host
```

The path must identify an existing file outside the repository. Do not copy it
into a fixture, container layer, log, CI secret, or artifact.

## Coverage and privacy

The suite reuses one MCP server/browser context and runs sequentially. It
checks session restoration, character list/API retrieval/rendered fallback,
rendered character-sheet PDF export and bounded byte reconstruction, campaign list/detail, safe navigation and
current-page retrieval, search, one public catalog monster lookup and rendered
stat-block shape, library listing, sourcebook book/chapter
outlines, bounded chapter content, deterministic chapter and section cursor
continuation, section retrieval by ID and unique heading, image metadata shape,
and a screenshot-only generic interaction.

Assertions inspect shapes only. Test output must not contain names, IDs,
private URLs, character JSON or PDF contents, stat-block prose, campaign or sourcebook text, cookies, or the
session path. On failure, the suite prints only allowlisted diagnostics such as
the failing tool, error category, HTTP status, redacted D&D Beyond endpoint,
and safe error code; successful tests remain quiet. The PDF is reconstructed
only in the existing mode-restricted host temporary directory, checked against
its reported size and SHA-256, `%PDF-` signature, and `pdfinfo` page count, then
deleted unconditionally. The Docker session mount is read-only. Account-dependent cases
are explicitly skipped when the account has no character, campaign, or
sourcebook; a release remains blocked unless those required skips are accepted
and recorded as an exception.

Fresh interactive login remains a manual release check. Do not automate live
click or fill operations until a disposable, verifiably safe account state is
available.

For releases that include the host authentication helper, also run
`mysterium-auth validate --live`
against the labeled helper volume and record the result separately. The helper
login itself is an interactive manual check; it must never run in GitHub
Actions or print captured browser state.

## Mutating live-test isolation

The repository currently has no mutating live tests. If an explicitly
authorized write workflow gains live coverage, keep it out of both read-only
commands above. Expose separate host and Docker Make targets named
`make live-test-write-host` and `make live-test-write`, and require a dedicated
write-test authorization flag in addition to the normal live-session
prerequisites.

The Docker write-test runner must build or select the same release-candidate
image without embedding session state, mount the helper-managed volume read-only,
and remain independently runnable from `make live-test`. Before
either write command is run, its documentation must identify the exact account
changes, disposable-data requirements, dry run, before/after checks, cleanup,
and expected partial-failure behavior. A write suite is never part of the
default release gate unless the user explicitly authorizes that exact run.

## Release record

Add a record like this to the `dev` to `main` release PR:

```text
Live test commit: <full commit SHA>
Command: make test-release
Result: pass | fail
Skips: none | <structural test names and approved reason>
Manual fresh-login check: pass | not run with approved exception
Helper volume validation: mysterium-auth validate --live => pass | fail | not run
```

Never paste the real session path or any returned account content into the PR.
