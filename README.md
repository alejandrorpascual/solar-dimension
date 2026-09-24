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
- **CI:** the workflow expects the repository secrets `DATABASE_URL` and `BETTER_AUTH_SECRET` so the account end-to-end test (`e2e/account.spec.ts`) can sign up, save a project and sign back in.

## Languages

The UI, appliance names and notes, and the engine warnings are available in English (default) and Latin American Spanish. The language is stored in the `lang` cookie: it is detected from the browser's `Accept-Language` header on the first visit and can be changed from the switch in the header. Numbers follow the active locale (`1,100 W`, `3.7 kWh` in both).

To add a language: add a dictionary in `src/i18n/` (typed against `Dictionary` in `src/i18n/types.ts`), add it to the `Locale` union in `src/i18n/types.ts`, register it in `LOCALES` and `DICTIONARIES` in `src/i18n/index.ts`, and add its number-formatting tag to `TAGS` in `src/i18n/format.ts`.

## Sizing assumptions

Inverter efficiency 90%, inverter headroom 25%, surge = running load + the largest single motor start-up delta, LiFePO₄ depth of discharge 85% (AGM 50%), 1,100 W per ton of cooling, conventional compressors 3× start surge (inverter compressors 1.3×), copper cable ampacity at 105 °C insulation, 3% maximum voltage drop, class T fuse ≥ 1.1× current. Verify conductor sizes against local code before building anything.
