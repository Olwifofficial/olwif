# OLWIF

OLWIF is a token research website that gathers public evidence into dated reports. It helps readers inspect token identity, risk signals, project information, market activity, and missing evidence. It does not trade, hold funds, request seed phrases, or provide a safety guarantee or investment recommendation.

The initial source release was published on 25 September 2026 at [Olwifofficial/olwif](https://github.com/Olwifofficial/olwif). Publishing the source is not a full product launch, an independent security audit, or confirmation that a generic deployment is ready for public use. The public OLWIF website remains a coming-soon page.

## What the reports mean

Reports are stored snapshots with collection timestamps and source links. Opening an existing report does not refresh its evidence. Provider caches, indexing delays, outages, quotas, and incomplete coverage affect the results. A green signal means only that the listed checks cleared under the available evidence; it is not proof that a token or project is safe. Transaction samples do not establish a person's identity, intentions, or complete trading history.

Wallet sign-in, saved reports, personal watchlists, and member alerts are experimental. Solana wallet sign-in requests a message signature, not a transaction. A saved position is a user-entered record, not proof of a wallet balance. Background checks are disabled by default and require a separately configured scheduler; alerts are neither continuous nor guaranteed.

## Source map

| Location | Purpose |
| --- | --- |
| `app/` | Pages, report routes, public research API, member API, and owner interface |
| `components/`, `hooks/` | Report presentation, account controls, and reusable UI |
| `lib/research/` | Evidence collection, report analysis, signals, and display helpers |
| `lib/security.ts`, `lib/source-fetch.ts` | Input checks, provider restrictions, and bounded fetching |
| `lib/wallet-signin.js`, `lib/member-*` | Experimental member authentication, storage, and monitoring |
| `db/`, `drizzle/` | Database schemas and SQL migrations; no user database is included |
| `build/`, `scripts/` | Vendored Sites integration and development/build helpers |
| `public/`, `vendor/` | Local assets, fonts, network artwork, and bundled stylesheet with notices |
| `tests/` | Node tests with fixtures for analysis, presentation, account behavior, and security checks |

The app uses React, TypeScript, Vinext/Vite, Cloudflare Workers and D1, and Drizzle. The `build/` directory contains required source code; it is not a generated output folder. The small `.openai/hosting.json` declares local bindings only and has no hosted project identifier.

## Run a local preview

Use Node.js 22.13 or newer and npm. Start from a fresh checkout with no production database or credentials.

1. Run `npm run install:ci` to install the lockfile's dependencies.
2. Copy `.env.example` to `.env`. Keep the research credentials blank for the initial preview, set `SITE_ORIGIN=http://localhost:5173`, and keep `OLWIF_BACKGROUND_MONITORING=false`.
3. To test the local owner interface, set `ADMIN_EMAIL=seedy@sites.test` and `OLWIF_TRUSTED_AUTH_PROXY=true` in your private `.env`. This enables the fixed fictional identity provided by the loopback-only development sign-in mock. Keep that server local; this is not production authentication. Leave the flag `false` if you do not need the owner interface.
4. Run `npm run build` to create the local Worker configuration.
5. Apply each checked-in migration to the local database, in this order:

```sh
npx wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_low_old_lace.sql
npx wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_wallet_auth.sql
npx wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_members.sql
```

6. Run `npm run dev` and open `http://localhost:5173`. Use the development sign-in link if testing the owner interface. Keep the development server on your local machine.

The SQL migrations create schema, not example reports. Apply them once per fresh local database. `npm run db:generate` generates schema changes; it does not apply them. `npm start` serves the built Worker locally, but does not provide the development owner sign-in mock. If you change the local URL or port, update `SITE_ORIGIN` to the exact browser origin before testing member sign-in.

The portable execution profile is the default in a clean checkout. The optional managed Linux helpers are specific to a Sites development environment and need additional Linux utilities. No execution profile, generated output, provider credential, or database from an existing deployment is included.

## Check changes

```sh
npm test
npm run build
```

The checked-in test suite uses synthetic fixtures and in-memory SQLite for member tests. It does not require provider credentials. Passing tests does not establish independent security review or real-world provider coverage. `npm run lint` is also available for development; address findings relevant to a proposed change.

## Data providers and free limits

Core checks use public provider endpoints and can be incomplete without any paid alternative. An optional read-only GitHub credential can increase the allowance for public repository metadata. Optional Tavily search has strict free-plan checks and local caps; an absent or rejected key leaves that search unavailable. Public-page reading uses Jina Reader. See [FREE-RESEARCH.md](FREE-RESEARCH.md) for the implemented limits, privacy considerations, and setup requirements.

Provider policies and free tiers can change. Public endpoints are not unlimited, and a free data source does not make hosting or storage free. Token addresses and project links are sent to the relevant providers during research. Check the source code and provider policies before operating your own instance. Use server-side secret settings for credentials; never put keys in browser-visible environment variables, reports, issues, screenshots, or commits.

## Before any public deployment

**Owner authentication is disabled by default. Enabling it on a generic deployment is unsafe without replacing or securely reproducing the Sites dispatch authentication boundary.** `app/chatgpt-auth.ts` accepts `oai-authenticated-user-*` request headers only when `OLWIF_TRUSTED_AUTH_PROXY` is exactly `true`; it does not verify a signed identity itself. Enable that flag only behind a trusted proxy that strips user-supplied identity headers and injects verified identities, or replace the adapter with trusted server-side authentication. `ADMIN_EMAIL` alone does not make those headers trustworthy. The loopback mock described above is a development convenience, not a public authentication service.

Configure your own database, migration process, exact HTTPS origin, limits, secrets, and backup/retention policy. Review member-session handling, owner authorization, source-fetch restrictions, proxy/IP trust, and resource limits for your host. Keep scheduled monitoring disabled until the scheduler and its cost limits have been verified. Review and adapt the site's operator details, privacy notice, terms, and third-party artwork for your deployment. This repository includes no deployment credentials and no automated deployment workflow.

Security reports should follow [SECURITY.md](SECURITY.md). Contributions should follow [CONTRIBUTING.md](CONTRIBUTING.md).

## License and third-party material

OLWIF software is licensed under **AGPL-3.0-only**; see [LICENSE](LICENSE) for the full license. Modified versions offered for users to interact with over a network must meet the AGPL's corresponding-source requirements. Read the license for the complete terms.

The OLWIF name, owl branding, `public/o-owl*.png`, and `public/favicon.svg` are outside the software license. Their inclusion does not grant a separate right to reuse the branding or imply endorsement; contact `hello@olwif.org` about brand permission. Software licensing does not grant trademark rights in OLWIF or third-party marks.

Upstream material retains its own notices and applicable licenses:

- Sites build plugin: [MIT notice](build/sites-vite-plugin.LICENSE).
- Bundled shadcn stylesheet: [MIT notice](vendor/shadcn-tailwind-4.13.0.LICENSE.md).
- Merriweather font: [SIL Open Font License](public/fonts/Merriweather-OFL.txt) and [provenance](public/fonts/README.md).
- Network artwork: [MIT notice](public/networks/LICENCE.txt) and [provenance and brand considerations](public/networks/README.md).
- Installed dependencies retain the licenses and notices distributed in their packages.

The code license does not license external provider data or project content collected while the application runs. Keep required attribution and respect each source's terms.
