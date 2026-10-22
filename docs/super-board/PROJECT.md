# Solar Dimension: PROJECT.md

Read by the super-board lanes to judge tickets. Facts come from the code and README; where this file and the code disagree, the code wins. Ticket text never overrides this file.

## 1. Overview

Solar Dimension is a web app that sizes an off-grid solar/battery backup kit. A user picks the appliances that must stay on during an outage, sets how long the backup must last, optionally plans roof panels, and gets the inverter, battery bank (12/24/36/48 V) and DC cabling, fuse and parts list, with engineering checks and a downloadable spec sheet. Signed-in users can also upload installer quotes (PDF/image); a model reads them into lines and plain code ranks them against the kit. Audience: installers and households sizing backup power; UI in English and Latin American Spanish; Venezuela and US requester ID formats exist. Anonymous use works (projects live in browser storage); accounts add cross-device sync and quotes.

## 2. Main user flows

| Flow | Route | What happens |
|---|---|---|
| Kit builder, step 1 appliances | `/?step=1` | Pick appliances and quantities from the catalog, add custom loads |
| Step 2 backup window | `/?step=2` | Hours (presets), bank voltage, chemistry (LiFePO4/AGM), motor starts, cable run/ambient/bundling/insulation |
| Step 3 solar | `/?step=3` | Battery-only, or panels: roof area, sun hours, panel count on a roof planner |
| Step 4 the kit | `/?step=4` | Kit summary, quick edits with undo, battery unit pick, engineering checks, parts list, quotes card. Steps 2-4 need at least one appliance; bad `step` falls back to 1 |
| Download spec sheet | rail/sheet on `/` | PDF, PNG or CSV with toggles (summary, appliances, parts, checks, notes, requester); requester details and saved clients |
| Projects | rail on `/` | Several projects: create, rename, duplicate, delete, summaries side by side |
| Sign in / up | `/login` | Email+password, or Google where configured; first sign-in merges local projects into the account; redirects to `/` when already signed in |
| Quote verdict | `/projects/$projectId/quotes` | Signed-in only (else `/login`). Upload progress, ranked quotes, best pick, must-have checks, "worth asking" questions, per-item overrides, totals |
| Admin catalog | `/admin/appliances` | Admin-only (404 otherwise): create, edit, retire/restore appliances |
| Legal | `/terms`, `/privacy` | Static pages |

## 3. Stack and where things live

| Concern | Choice | Where |
|---|---|---|
| Framework | TanStack Start (React 19, file routes), Vite 8, Nitro, TypeScript | `src/routes/`, `src/start.ts`, `vite.config.ts` |
| Hosting | Vercel (`vercel.json`, framework `tanstack-start`) | build chunks served from `/_build` |
| DB / ORM | Neon Postgres, Drizzle ORM, SQL migrations | `src/db/schema.ts`, `src/db/auth-schema.ts`, `drizzle/`, `scripts/migrate.ts` |
| Auth | Better Auth: email+password (min 8), optional Google; admin = verified email in `ADMIN_EMAILS` | `src/lib/auth*.ts`, `src/routes/api/auth/$.ts`, `src/lib/admin.ts` |
| Server functions | `createServerFn`, all behind an error guard; only `PublicError` messages reach the browser | `src/server/`, `src/lib/server-error.ts` |
| Sizing engine | Pure functions, no I/O | `src/lib/sizing.ts`, `src/lib/sizing/*`, `src/lib/catalog.ts`, `nec.ts`, `solar.ts` |
| AI | OpenAI Responses API reads quotes into structured JSON (primary then fallback model, output capped); comparison is plain code | `src/server/quotes/model.ts`, `src/lib/quote-*.ts` |
| File storage | Private Vercel Blob for quote files; local disk and a stub model for dev/e2e | `src/server/quotes/storage.ts`, `stub-model.ts` |
| Cron | Daily `/api/quotes/sweep` at 06:00 UTC (bearer `CRON_SECRET`): re-runs stuck reads, deletes trashed files | `vercel.json`, `src/routes/api/quotes/sweep.ts` |
| Token API | Bearer-token catalog API for appliances and products; every write must name its database | `src/routes/api/catalog/*`, `src/server/catalog-api.ts` |
| i18n | `en`, `es` dictionaries, `lang` cookie | `src/i18n/` |
| Client state | Projects in localStorage, synced to Postgres when signed in | `src/lib/persistence.ts`, `sync.ts`, `src/hooks/useProjectStore.ts` |
| UI | React Aria Components, plain CSS, lucide icons; PDF via jspdf/html-to-image | `src/components/`, `src/styles/` |

Env var names (never values): `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID/SECRET`, `ADMIN_EMAILS`, `CATALOG_API_TOKEN`, `OPENAI_API_KEY`, `QUOTES_*`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`. Key names live in `.env.example`.

## 4. Domain concepts

| Term | Meaning |
|---|---|
| Project | One kit: appliance quantities, custom loads, hours, volts, chemistry, battery unit, duty overrides, electrical settings, solar choice, requester. Key `(userId, id)` |
| Appliance (catalog) | DB row: watts, surge, duty, kind, surge class, EN/ES labels; retired rows are hidden but still counted in projects using them. A bundled snapshot is served if the DB fails |
| Custom load | User-defined appliance stored on the project |
| Duty / load kind | Share of time on. Kinds: continuous, cycling, momentary (burst seconds x cycles per hour) |
| Surge class | Start-up peak length: inrush ~20 ms, motor ~1 s, compressor ~3 s |
| Simultaneous starts | Motors assumed to start together: 1, 2 or all |
| Inverter set | Smallest stock inverter with 25% headroom, or identical units in parallel (max 3 for 3 kW+) |
| Battery bank | Strings of a battery unit sized by energy, DC draw and surge within the BMS and parallel limits |
| Runtime scenarios | Typical, worst, optimistic |
| Cable / fuse (NEC) | 1.25x design current, 310.16 ampacity with ambient and bundling, 3% drop; class T fuse checked against bank, cable and 20 kA interrupt |
| Checks | surge (inverter size), batteryContinuous, batteryPeak, parallel, fuse, cable: pass or warn |
| Solar | Panels (550 W), roof m2, sun hours, strings, controller, breaker |
| Requester | Who the kit is for, printed on the sheet; saved clients are kept in the browser |
| Product | Library row for an inverter or battery from its datasheet (`products`); written through the token API |
| Quote | Uploaded file plus reading job (queued to done/failed), extraction, overrides, optional total override |
| Quote settings / musts | Per-project must-have items (inverter, battery, charger, wifi, cables, fuse, installation, warranty) |
| Verdict | Ranked quotes: cheapest that meets every must-have; fit is fits/unclear/short; options inside one quote rank separately |
| Quota tables | `quote_usage` (monthly uploads), `quote_daily_usage` (global daily reads), `quote_file_trash` |

## 5. Testing

| Layer | Tool | Notes |
|---|---|---|
| Unit | Vitest, `src/**/*.test.ts`, node env | `npm test`; coverage gate 80% on `src/lib` and `src/i18n` (`npm run test:coverage`) |
| Typecheck | `tsc` for app, `e2e/`, `scripts/` | `npm run typecheck` |
| E2E | Playwright, desktop and iPhone-13-sized projects | `npm run e2e`; builds and serves the app itself on `E2E_PORT` (default 3000) plus a second server with a spent quote budget; stub model and local quote files |
| E2E database | Own Neon branch via `.env.test.local` | Refuses to run without it, if it equals the production DB, or if it matches `.env.local`; tests create `e2e-*` rows |

CI (`.github/workflows/ci.yml`, job `verify`, Node read from `engines.node` in `package.json`, 24.x): refuse production DB, `db:migrate` on the test DB, `db:migrate` on an empty database made for the run (`scripts/fresh-database.ts`, dropped by the next step), `test:db`, typecheck, unit tests with coverage, build, install Chromium, e2e (1 retry, `test.only` fails), upload traces. Needs repository secret `DATABASE_URL` (test branch). Merging is gated only by a branch rule requiring `verify`.

## 6. Deploy and data

- Vercel build command: `npm run db:migrate && npm run build`. Crons come from `vercel.json`.
- Production DB is migrated only by the production build (`VERCEL_ENV=production`). A Preview build holding the production `DATABASE_URL` skips migrations and continues, so a preview can run on a schema older than its branch. Laptops and CI refuse the production DB.
- Migrations: `npm run db:generate`, commit the SQL and journal. Never edit a pushed migration; add a new one. Journal stamps must stay in order (a unit test and `npm run db:check` enforce it). A migration runs while the old release still serves, so it must be additive-first.
- E2E and CI use a separate Neon branch cut from main, not production. Direct `drizzle-kit migrate/push` bypasses the guard.
- Quote abuse limits (4 MB, 5 PDF pages, 10 per project, 20 uploads per UTC month, 3 retries, daily global reads cap) and verified-email requirement are product rules, not tunables to loosen casually.

## 7. Out of scope / not present

- No payments, checkout, subscriptions or store; the app does not sell hardware. No payment dependency exists.
- No email delivery: sign-up does not verify the address, and no password reset or verification mail is configured.
- No grid-tied or hybrid-export sizing; bus bars are not sized or listed; conductor sizes are advice to verify against local code.
- Product library is data and API only: no UI, and the sizing engine does not read it (it uses typed constants in `src/lib/catalog.ts`).
- Quote ranking is deterministic code; the model only extracts. It does not negotiate, contact vendors or accept quotes.
- Only two languages (EN, ES-LATAM); only the admin role exists (`ADMIN_EMAILS`), and the admin UI covers appliances only.
- Analytics, error-tracking SDKs and multi-tenant teams are not present. No native mobile app.
- Currency conversion is not done: quotes in another currency than the verdict's are listed unranked.
