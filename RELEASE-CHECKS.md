# Source release checks — 25 September 2026

Status: local release candidate. The public repository https://github.com/Olwifofficial/olwif has been created, but the code upload is pending GitHub authentication for the organisation owner. No source has been pushed yet.

## Scope

- Current research website, backend, rating logic, reviewed unit tests, database schema and migration SQL.
- No historical browser extension, automatic trader, wallet custody data, private reports, local databases, credentials, browser profiles or original Git history.
- Host configuration contains only example/local binding names, not an existing deployment identifier.
- AGPL-3.0-only software licence; brand assets and third-party notices are described in README.md.
- Header-based owner authentication requires an explicit trusted-proxy opt-in; disabled by default in this release copy.

## Completed checks

- 394 Node unit tests passed; zero failures, cancellations or skips.
- TypeScript `tsc --noEmit` passed.
- Production build completed successfully.
- All three database migrations applied successfully, in documented order, to a fresh isolated local database.
- Git ignore rules checked for private environment files, runtime state, local certificates, dependencies, generated output and private hosting metadata.
- Reviewed the allowlisted source for known credential patterns, personal configuration and local paths. No matching private values were found in this candidate. This bounded review is not a full security audit or a guarantee that no vulnerability exists.

Validation ran on an isolated copy using the existing lockfile-matched installed dependencies. A fresh dependency installation on another machine and a hosted end-to-end deployment have not been verified. No production service, production database or live domain was changed.

## Before publishing

- Repository destination confirmed: `Olwifofficial/olwif`, public, under the user's separate organisation.
- Complete the organisation owner's Git authentication before uploading; do not reuse an unrelated account's credentials.
- Recheck the exact files staged for upload; never upload the entire working workspace.
- Keep private configuration and runtime data out of both the initial commit and later history.
- Update the source-release status and add the real repository URL only after successful publication.
- Do not describe this source release as an independent audit, token endorsement, or full product launch.
