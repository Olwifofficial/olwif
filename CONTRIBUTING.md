# Contributing to OLWIF

This source is being prepared for a public release. Use the contribution channels offered by the repository when it is published. Security concerns belong in the private process described in [SECURITY.md](SECURITY.md).

Please explain the problem, the behavior you expect, and the source version involved. Keep contributions focused. Use synthetic examples or public token addresses with an explanation of what is being tested; do not attach user reports, wallet sessions, provider credentials, personal watchlists, or deployment configuration.

OLWIF is a research tool. Preserve timestamps, source attribution, explicit gaps, and the distinction between observed evidence and inferred conclusions. A color or summary must not promise token safety. Keep provider requests bounded, respect source restrictions, and do not introduce paid fallbacks or automatic billing. Wallet features must not request funds, transactions, seed phrases, or private keys.

For changes, install the lockfile dependencies, run `npm test`, and run `npm run build`. Add or update meaningful tests where behavior changes; use mocked provider responses rather than live service calls in unit tests. Include the relevant results and any limitations in your change description. For UI changes, inspect the affected screen at desktop and mobile widths and describe accessibility considerations.

Do not commit `.env`, runtime databases, logs, dependency directories, generated output, private notes, or hosted project identifiers. Preserve upstream license and attribution files. Contributions to the software are expected under AGPL-3.0-only; only submit material you are entitled to contribute. OLWIF and third-party branding remain subject to their separate rights and notices.
