# Solar Dimension · Kit builder
![CI](https://github.com/alejandrorpascual/solar-dimension/actions/workflows/ci.yml/badge.svg)

Pick the appliances that must stay on during an outage, set how long the backup must last, and get the inverter, the battery bank (12 / 24 / 36 / 48 V) and the DC cabling you need.

## Develop

    npm install
    npm run dev          # http://localhost:3000
    npm run typecheck
    npm run test         # unit tests (Vitest)
    npm run test:coverage
    npm run e2e          # Playwright (builds and serves the app itself)

## Deploy (Vercel)

1. Push to GitHub.
2. In Vercel choose **Add New → Project**, import the repo, keep the detected **TanStack Start** framework settings (`vercel.json` makes detection explicit).
3. Deploy. Nitro's output becomes Vercel Functions plus static assets.

## Accounts and data

Anonymous use keeps projects in the browser's local storage. Signing in (email and password, via Better Auth) merges those projects into the account on the first sign-in and keeps every later change in Postgres, so the same projects show up on any device.

- **Database:** Neon Postgres, provisioned through the Vercel Marketplace. The app reads `DATABASE_URL`; Better Auth also needs `BETTER_AUTH_SECRET`. The server fails fast with a clear error when either is missing.
- **Migrations:** Drizzle ORM with SQL migrations committed in `drizzle/`. After changing `src/db/schema.ts`, run `npm run db:generate` and commit the new migration. `npm run db:migrate` applies pending migrations; Vercel runs it as part of the build command (`vercel.json`) and CI runs it before the tests.
- **Local secrets:** run `vercel env pull .env.local` to fetch `DATABASE_URL` and `BETTER_AUTH_SECRET` from the Vercel project. `.env.local` is git-ignored and is loaded by `vite.config.ts`, `drizzle.config.ts` and `npm run start`.
- **End-to-end tests:** e2e runs sign up users, save projects and write catalog rows, so they need a database of their own: a Neon branch just for tests. Put its `DATABASE_URL` in `.env.test.local` (git-ignored); `playwright.config.ts` loads it ahead of `.env.local` and refuses to run without it, when it points at the same database as `.env.local`, or when it is the production database. Playwright never reuses a running server, since its database cannot be checked. It starts two servers from one build: the main one on `E2E_PORT` (default 3000) and, on the next port, one whose daily read budget is 1, so the daily-limit tests never pause reads for the rest of the suite. Create the branch from `main` so the migrations and seeded catalog are there, and run `DATABASE_URL=<test branch url> npm run db:migrate` after adding a migration. Tests delete the `e2e-*` appliances they create; `node --env-file=<env file> scripts/delete-e2e-appliances.mjs` lists any that are left and prints a fingerprint of that exact set; `--yes=<fingerprint>` deletes those rows, and nothing if the set changed or a saved project uses one.
- **CI:** the workflow expects the repository secrets `DATABASE_URL` and `BETTER_AUTH_SECRET` so the account end-to-end test (`e2e/account.spec.ts`) can sign up, save a project and sign back in. `DATABASE_URL` there must be a test branch too, never production: CI runs both the migrations and the e2e suite against it, and its first step fails if the secret is the production database.

## Quotes

Signed-in users upload installer quotes (PDF, JPG, PNG or WebP, up to 4 MB, PDFs up to 5 pages) on the kit step. They are read in the background by an OpenAI model into structured lines. Plain code then compares each quote with the project's kit and picks the cheapest that meets every must-have. Specs: `docs/superpowers/specs/2026-09-26-quote-comparison-design.md` and `docs/superpowers/specs/2026-09-29-quote-verdict-b-design.md`.

| var | purpose |
|---|---|
| `OPENAI_API_KEY` | extraction |
| `QUOTES_MODEL_PRIMARY`, `QUOTES_MODEL_FALLBACK` | models; default `gpt-6-luna` then `gpt-6-sol` |
| `BLOB_READ_WRITE_TOKEN` | private Vercel Blob store for the files |
| `CRON_SECRET` | authenticates the daily `/api/quotes/sweep` cron |
| `QUOTES_DAILY_READS` | model reads admitted per UTC day across every account (uploads and retries); default `100`; set `0` to pause reading. Anything but a whole number falls back to the default, with one warning in the logs |
| `QUOTES_TRUSTED_EMAILS` | comma-separated emails that may upload without a verified email. For previews and tests only: ignored when `VERCEL_ENV` is `production` |

Abuse limits, so nobody can burn the OpenAI budget:

- **Verified accounts only.** Email sign-up does not confirm the address, so only an account whose email is verified, or whose Google account's stored `id_token` says Google verified that same email (`email_verified: true`, compared case-insensitively), can upload or retry. A Google account row alone is not enough: a Google sign-up creates one whatever Google says about the email, and connecting Google to a password account does not mark its email verified. Anyone else keeps read and delete access to what they already have; the kit card and the verdict page show a note and a Connect Google button instead of uploading, and no Retry. On deployments without Google (previews) the note stands alone, and `QUOTES_TRUSTED_EMAILS` lets listed accounts through; production ignores that list.
- **Per account:** 10 quotes per project, 20 uploads per UTC month (deleted quotes still count), 3 retries per failed quote.
- **Per file:** 4 MB, 5 pages per PDF; the model's answer is capped at 12,000 output tokens.
- **Across every account:** `QUOTES_DAILY_READS` reads per UTC day, counted in `quote_daily_usage`; once they are spent, uploads and retries are refused until the next UTC day. Worst case per admitted read: up to 3 attempts, each a primary call and a fallback call, either one repeated once right away on a transient error, so at most 12 model calls.

For development, `QUOTES_STORAGE=local` keeps files in `.data/quotes/`, and `QUOTES_MODEL_STUB=1` answers from the sample quotes in `src/lib/quote-fixtures.ts`. The file name picks the sample, as in `solartec.pdf`. The stub never runs on Vercel.

## Languages

The UI, appliance names and notes, and the engine warnings are available in English (default) and Latin American Spanish. The language is stored in the `lang` cookie: it is detected from the browser's `Accept-Language` header on the first visit and can be changed from the switch in the header. Numbers follow the active locale (`1,100 W`, `3.7 kWh` in both).

To add a language: add a dictionary in `src/i18n/` (typed against `Dictionary` in `src/i18n/types.ts`), add it to the `Locale` union in `src/i18n/types.ts`, register it in `LOCALES` and `DICTIONARIES` in `src/i18n/index.ts`, and add its number-formatting tag to `TAGS` in `src/i18n/format.ts`.

## Sizing assumptions

Inverter efficiency 90%, inverter headroom 25%, LiFePO₄ depth of discharge 85% (AGM 50%), 1,100 W per ton of cooling, conventional compressors 3× start surge (inverter compressors 1.3×). The engine (`src/lib/sizing.ts`, split into `src/lib/sizing/*`) then applies the rules below, with the hardware specs it needs as typed constants in `src/lib/catalog.ts` (passed to `compute()` as a `HardwareCatalog`, so a managed table can replace them later):

- **Start-up peak:** the running load plus the surge of the motors assumed to start together (one by default; two or all, per project). Each appliance has a surge class (inrush ~20 ms, motor ~1 s, compressor ~3 s), derived from its compressor type and surge ratio unless the catalog states one, and each inverter holds its surge for a stated number of seconds, so a long compressor start is checked against the right rating.
- **Battery bank:** strings follow the largest of the energy, the inverter's continuous DC draw and its surge, within what the unit's maker allows in parallel; each unit states its BMS continuous and peak current, peak window and parallel limit. A bank that cannot feed the inverter is flagged, not hidden.
- **Runtime:** typical is the headline figure; a worst case runs cycling loads 30% harder at 85% efficiency (with Peukert capacity loss for AGM) and reads 0 h when the bank cannot carry the full load; an optimistic case runs them 20% lighter at 93%.
- **Cable (NEC):** design current = continuous DC amps × 1.25; ampacity from the 310.16 copper table at 75 °C or 90 °C (90 °C capped at the 75 °C terminations), corrected for ambient (310.15(B)(1)) and for bundled runs (310.15(C)(1)); 3% drop at continuous current and a warning above 10% at start-up. The run length, ambient, bundling and insulation are per project (step 2).
- **Bank wiring:** a link between batteries in series carries its whole string's current, so it copies the conductor that string feeds: the string lead when strings are in parallel, otherwise the main cable, with one jumper for each of its runs. Parallel strings each get a fused positive and a negative lead to the bus bars, sized for the string's share. Every battery-side cable row (main cable, interconnects, string leads) is held to the same 1.25× rule, and the cable check fails if one cannot meet it. The bus bars themselves are not sized or listed.
- **Fuse:** the standard class T rating ≥ 1.25× the continuous current and ≤ the cable's corrected ampacity, checked against the bank's continuous current (so the fuse opens before the BMS), the start-up current it must hold, and the bank's prospective short-circuit current against its 20 kA interrupting rating; one fuse per parallel string.
- **Load kinds:** appliances are continuous, cycling or momentary (gates and barriers: burst seconds × cycles per hour); users can change a cycling appliance's duty on the kit.

Verify conductor sizes against local code before building anything.
