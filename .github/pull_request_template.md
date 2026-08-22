## Summary

<!-- Describe the change and its user-visible effect. -->

## Verification

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] Relevant Docker checks, if container behavior changed

## Release checklist (`dev` → `main` only)

<!-- Leave this section unchecked for ordinary PRs into dev. -->

- [ ] This PR's head is `dev` and its base is `main`.
- [ ] `package.json` and `package-lock.json` contain the intended SemVer release.
- [ ] All required offline GitHub CI checks pass.
- [ ] The complete live suite was run locally against this commit; GitHub did
      not receive the D&D Beyond session.
- [ ] The live-test command, commit SHA, results, and any skips are recorded in
      this PR.
- [ ] Fresh interactive login was checked manually, or its approved exception
      is recorded in this PR.
- [ ] No credentials, cookies, session state, or private account data are in
      the diff, logs, fixtures, or artifacts.
- [ ] The release is approved for merge.
