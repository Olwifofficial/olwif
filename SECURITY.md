# Security

Please report suspected vulnerabilities privately to **hello@olwif.org**. Include the affected source version, a clear description, expected and observed behavior, and minimal steps to reproduce against a local instance. Redact credentials and personal information.

Do not publish working exploits or other people's account details in a public issue. Do not send seed phrases, private keys, provider secrets, authentication cookies, user databases, or full saved member records. Use synthetic data and accounts you control. No bug bounty, response deadline, or independent security-audit status is promised.

## Known deployment boundary

Owner sign-in is disabled unless `OLWIF_TRUSTED_AUTH_PROXY` is exactly `true`. When enabled, it trusts identity headers supplied by the Sites dispatch layer; the application does not independently authenticate those headers. A direct or generic deployment must replace that adapter or enforce a trusted authentication boundary that strips incoming identity headers and supplies verified values before enabling it. Setting `ADMIN_EMAIL` is not sufficient. The flag may also enable the loopback-only development mock documented in the README, but that mock must never serve as public authentication.

Wallet sign-in, saved reports, watches, and alerts are experimental. Review authentication, origin validation, session storage, rate limits, provider restrictions, database access, and retention before using real member data. Tests are useful evidence of behavior, not an independent security audit.

## Handling sensitive data

Store secrets only in private local configuration or server-side secret settings. Keep all runtime databases, sessions, logs, generated reports, private operational notes, and hosting identifiers out of source control. If a credential is exposed, revoke or rotate it with the provider; deleting it from a commit does not undo the disclosure.
