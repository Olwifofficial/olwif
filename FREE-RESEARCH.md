# Free-only public research

OLWIF's budget is zero. No paid search, model, subscription or automatic upgrade is enabled. Public-source access is limited, and a free API account is not a promise of complete or permanent access.

## What works without a search key

Normal, on-demand token checks can read up to **two** public pages from returned project links. Page reading uses the fixed Jina Reader service without an API key or paid fallback. We respect robots restrictions and do not bypass login walls, private groups or blocked pages.

The report shows limited rule-based observations, exact-address association, collection timestamps and source links. These observations are not LLM-generated investment answers, verified project claims or safety upgrades. Public social-page text is not a verified social-activity feed. No follower-quality, organic-engagement or complete-history claim is made.

Full pages and full search-result snippets are not stored. Source titles and excerpts share a maximum of 25 quoted words per collected page. Short evidence notes, source URLs, timestamps and request status remain in the saved report. A failed or limited source remains an explicit gap.

## Optional free exact-address web search

The owner must set this up personally; OLWIF does not create an account or accept third-party terms for you.

1. Visit the [Tavily dashboard](https://app.tavily.com/) and review the provider's current terms, privacy policy and free-plan limits before creating a free account.
2. Do **not** add a payment card, enable pay-as-you-go, enable auto upgrades, buy credits or select a paid plan. The service must remain on its free account tier. The usage API must identify it as **Free** or **Researcher**, with pay-as-you-go allowance of **zero**, or the separately verified nullable case described below.
3. Create a key in that account. Keep it private: do not paste it into chat, a token search, a report, a screenshot or a browser console.
4. On this local development machine, put it in your private `.env` as `TAVILY_API_KEY=your_private_key`. Do not change `.env.example` to contain a real key. Never use a `NEXT_PUBLIC_` or `VITE_` prefix. For eventual hosting, use the host's server-side secret settings instead.
5. Restart the local development server. The Owner's desk will say a key is configured; this alone is **not** a successful connection or plan check.
6. Run one normal token check. Inspect the Public web research notes and Sources & gaps for the actual result. An older saved report needs a refresh to include the new checks.

Keys must be supplied privately by the owner. A former `BRAVE_SEARCH_API_KEY` is ignored. The retired `/api/web-search` route never calls a search provider, even if an old key remains present.

### Tavily's nullable limits

The official [usage schema](https://docs.tavily.com/documentation/api-reference/openapi.json) documents `key.limit: null` as unlimited. Numeric zero is not treated as unlimited, and missing fields fail closed.

The schema does **not** explain `account.paygo_limit: null`. That case remains blocked by default. After independently checking the account's Billing page shows **Researcher / Free**, **Pay as you go Disabled**, and **Auto upgrade off**, a server-private `TAVILY_FREE_ONLY_KEY_SHA256` may bind that verification to the SHA-256 fingerprint of the exact key. A changed key invalidates the verification. No key or fingerprint is sent to the browser or saved in reports.

This is a separately observed billing configuration, not a claim that every null PAYG value means disabled. Do not set the fingerprint merely to bypass a failed check. Recheck it after any account, billing or key changes; remove it if disabled paid usage cannot be confirmed. Account usage and remaining free credits are still checked before every search, and any positive paid allowance or paid usage stops collection.

## Hard limits and failure behaviour

- One **basic** exact-token-address search per eligible token check; no AI answer (`include_answer: false`) and no deep-search or paid fallback.
- A `/usage` preflight must confirm the free plan, zero pay-as-you-go allowance (or the key-bound, independently verified nullable case) and enough remaining credits. Missing, unknown or contradictory account/usage details stop the search.
- Site-wide hard caps: **30 searches per day** and **900 per month**, shared across visitors. These caps are in addition to provider account limits, including usage outside OLWIF.
- No automatic retry or automatic billing. A timeout, rate limit or exhausted allowance produces an honest unavailable/limited state; other public token checks may still finish.
- Search results are source leads, not investment recommendations. At most four public pages are read across reported links and search-linked results combined.
- In the Owner's desk, **Public-page reading** (`publicweb`) and **Web search** (`websearch`) can be paused separately. New token checks can also be paused globally. Already-started requests may finish.

## Before inviting public users

Provider policies, free quotas and trademark rights can change. Recheck provider terms and intended public/commercial use before launch; a technically reachable page is not permission to republish it. Respect source restrictions, copyright, attribution and any required permissions. The short-quotation limit is a conservative implementation constraint, **not legal clearance**.

Finish the site's operator identity, privacy contact, retention policy and legal review. Confirm hosting/database limits separately: this feature does not authorise paid hosting, paid storage or any other charge. The current privacy notice discloses that token addresses may go to Tavily and public project URLs to Jina Reader; visitors' browser history and cookies are not forwarded to these research providers.
