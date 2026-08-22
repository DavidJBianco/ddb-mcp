# Live read-only testing

Live tests are a local release gate, not a GitHub Actions job. They use an
external Playwright storage-state file and make authenticated, read-only
requests to D&D Beyond. The suite never performs a fresh login, clicks account
controls, fills forms, or modifies D&D Beyond data.

## Required opt-in

Both environment variables are required:

```bash
export DDB_MCP_LIVE_TESTS=1
export DDB_MCP_SESSION_PATH=/absolute/path/to/session.json
```

`DDB_MCP_SESSION_PATH` must be an existing absolute file path. To deliberately
use the historic default, set it explicitly:

```bash
export DDB_MCP_SESSION_PATH="$HOME/.config/ddb-mcp/session.json"
```

Keep the file outside this repository. Do not copy it into a test fixture,
container layer, log, CI secret, or artifact.

Run against the local Node server:

```bash
npm run test:live
```

Run the release-candidate production image with the session mounted read-only:

```bash
npm run test:live:docker
```

The Docker command builds `ddb-mcp:live` before testing. Set
`DDB_MCP_LIVE_IMAGE` only when a different local candidate tag is required.
To accommodate host session files with mode `0600`, the runner creates a
permission-normalized temporary copy outside the repository, mounts that copy
read-only, and removes it unconditionally when the test process finishes.

## Coverage and privacy

The suite reuses one MCP server/browser context and runs sequentially. It
checks session restoration, character list/API retrieval/rendered fallback,
temporary character download, campaign list/detail, safe navigation and
current-page retrieval, search, library listing, sourcebook reading, and a
screenshot-only generic interaction.

Assertions inspect shapes only. Test output must not contain names, IDs,
private URLs, character JSON, campaign or sourcebook text, cookies, or the
session path. Temporary downloads are removed, and the Docker session mount is
read-only. Account-dependent cases are explicitly skipped when the account has
no character, campaign, or sourcebook; a release remains blocked unless those
required skips are accepted and recorded as an exception.

Fresh interactive login remains a manual release check. Do not automate live
click or fill operations until a disposable, verifiably safe account state is
available.

## Release record

Add a record like this to the `dev` to `main` release PR:

```text
Live test commit: <full commit SHA>
Command: DDB_MCP_LIVE_TESTS=1 DDB_MCP_SESSION_PATH=<external path> npm run test:live:docker
Result: pass | fail
Skips: none | <structural test names and approved reason>
Manual fresh-login check: pass | not run with approved exception
```

Never paste the real session path or any returned account content into the PR.
