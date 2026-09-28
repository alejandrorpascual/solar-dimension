# Appliance catalog in Postgres

Project 1 of 2. Project 2 is [quote comparison](2026-09-26-quote-comparison-design.md), which does not depend on this one.

## Goals

1. Add or correct an appliance (for example electric stoves) without a code change or a redeploy.
2. Research new appliances with a Claude Code skill that writes them straight to the database after the admin confirms.
3. Keep a small admin page for occasional manual edits.

Out of scope: user-defined categories, per-project value snapshots, modelling 240 V / split-phase output in the engine, AI calls from inside the app.

## Decisions

- **Always the latest values.** Projects store `applianceId → qty` only. A corrected appliance changes every project's numbers the next time it is opened. Removing an appliance is *retiring* it: hidden from the picker, still counted in projects that use it.
- **Ids never change.** The seed reuses today's ids (`fridge`, `ac-1.5-inv`, …), so no saved project, local or cloud, needs a migration.
- **Categories stay in code.** `Category` remains a TypeScript union with its i18n labels and grouping UI. Stoves go under *Kitchen*.
- **Engine constants stay in code.** `SIZING`, `VOLTAGES`, `CHEMISTRIES`, `INVERTERS`, `GAUGES`, `FUSES` are not content.
- **No AI in the app for the catalog.** Research runs through the admin's own Claude Code subscription (see *Research skill*).
- **Admin identity**: `ADMIN_EMAILS` env var (comma-separated), checked on the server against the signed-in user's email. No role column.

## Data model

Migration `0003` creates `appliances`:

| column | type | rule |
|---|---|---|
| `id` | text PK | lowercase slug, immutable |
| `category` | text | one of `Category` except `Custom`; DB `CHECK` + Zod |
| `watts` | integer | 1 – 30 000 |
| `surge` | integer | `surge ≥ watts` |
| `duty` | real | `0 < duty ≤ 1` |
| `tons` | real null | AC only |
| `ac_type` | text null | `inverter` \| `conventional`, AC only |
| `labels` | jsonb | `{ en: {name, note}, es: {name, note} }`, both locales required |
| `sort_order` | integer | order within the category |
| `retired_at` | timestamptz null | set = hidden from the picker |
| `created_at`, `updated_at` | timestamptz | |
| `updated_by` | text | user id, or `api-token` |

The same migration inserts today's 36 items (24 hand-written + 12 generated AC rows) with their EN and ES text copied word for word from `src/i18n/en.ts` and `src/i18n/es.ts`. `db:migrate` already runs in CI, e2e and the Vercel build, so no environment ever has an empty catalog.

`src/lib/catalog.ts` keeps the `CatalogItem` type and gains `ApplianceSchema` (Zod), shared by the admin page, the API and the tests. `APPLIANCES` becomes `CATALOG_SNAPSHOT` in `src/lib/catalog-snapshot.ts`, the bundled fallback.

## Loading path

```
Neon ─> getCatalog() ─> 60 s in-memory cache ─> root loader (staleTime ∞) ─> useCatalog()
            │ query fails
            └─> CATALOG_SNAPSHOT + server error log with context
```

- `getCatalog()` returns every row, retired included, mapped to `CatalogItem` plus `labels` and `retired`.
- The root loader adds `catalog` to `RootData`, like `googleEnabled`. `staleTime: Infinity` keeps it for the whole visit.
- `useCatalog()` reads it from the root route. Signed-out users get the same catalog; nothing depends on the session.
- The cache lives per server instance. A write clears the instance that handled it; others refresh within 60 s.

## Engine and UI changes

- `sizing.ts` stops importing `APPLIANCES`. `size(input, catalog)` and `catalogFor(catalog, custom)` take it as an argument, replacing the hard-wired `[...APPLIANCES, ...extra]`.
- A `qty` id that is not in the catalog is skipped, never thrown on.
- The picker (`ApplianceGrid`, `appliance-search`, `appliance-groups`) filters out retired items. The engine does not.
- `applianceLabel(item, locale)` returns `labels[locale] ?? labels.en`. The `appliances` block leaves both dictionaries and `Dictionary`.
- Items whose `watts ≥ 3000` show a note on their card and on the kit: "Needs a 240 V / split-phase inverter" (translated). Today that also flags the existing electric water heater (4.5 kW), which is correct. The engine is unchanged.

## Write path

One repository module, `src/server/catalog-repo.ts`:

- `listAppliances()`
- `diffAppliances(items)` → per item: `new` | `changed` (field-level diff) | `unchanged`
- `upsertAppliances(items, actor)` → validates with `ApplianceSchema`, writes, clears the cache
- `retireAppliance(id, actor)` / `restoreAppliance(id, actor)`

Both the admin page and the API call only these functions.

### REST endpoint (`src/routes/api/catalog/`)

| method | path | behaviour |
|---|---|---|
| `GET` | `/api/catalog/appliances` | all items, retired included |
| `POST` | `/api/catalog/appliances?dryRun=true` | body: one item or an array; returns the diff, writes nothing |
| `POST` | `/api/catalog/appliances` | upserts; returns `{ created: [...], updated: [...] }` |
| `POST` | `/api/catalog/appliances/:id/retire` | retires |
| `POST` | `/api/catalog/appliances/:id/restore` | restores |

- **Auth**: `Authorization: Bearer <token>`. The server compares SHA-256 digests of the given token and `CATALOG_API_TOKEN` with `timingSafeEqual`. The token is at least 32 random bytes.
- If `CATALOG_API_TOKEN` is unset, every route returns 404. Previews have it off unless configured.
- Failed auth: 401, logged with IP, and throttled at 10 failures per IP per 10 minutes (in-memory, per instance).
- Validation failure: 422 with the Zod issues per item. Nothing is written if any item fails.
- Writes record `updated_by = 'api-token'`.

### Research skill (`.claude/skills/research-appliance/SKILL.md`)

`/research-appliance <description> [--target local|prod]`

1. Research typical running watts, start surge and duty cycle. Record a source for each number.
2. Write EN and ES name and note, in the tone of the existing items.
3. `GET` the catalog. Reuse an id if the item exists; avoid near-duplicate names.
4. `POST ?dryRun=true` and show a table: new or changed, each value with its source.
5. Wait for the admin's "yes", then `POST` for real and print the created or updated ids.

The skill reads `CATALOG_API_TOKEN` and the base URL from `.env.local` (gitignored) and never prints the token.

### Admin page (`/admin/appliances`)

- `beforeLoad` calls a server function that runs `requireAdmin()`. Anyone else gets a 404.
- The list is grouped by category like the picker, with Edit and Retire / Restore on each row.
- The form has EN/ES name and note, category, watts, surge, duty, and tons/type when the category is *Air conditioning*. The id is a slug of the English name when created and is read-only afterwards.
- Hard errors block saving: a bad range, surge below watts, or missing ES text. Soft warnings do not: watts over 5 kW, or duty 1 on a heating appliance.
- Server functions re-run `requireAdmin()` and `ApplianceSchema` before calling the repository.

## Electric stoves

The first real use of the research skill, after launch:

| item | watts |
|---|---|
| single hot plate | ~1.5 kW |
| 2-burner induction cooktop | ~3.5 kW |
| 4-burner cooktop | ~7 kW |
| built-in oven | ~2.5 kW |
| full range | ~10 kW peak |

Duty and surge are left to the research.

## Errors

- Catalog query fails → snapshot, `console.error` with the error and `getCatalog` context. There is no user banner: the numbers are still valid.
- Admin and API validation errors are returned per field / per item. The UI shows them next to the field.
- An unknown id in a project is skipped by the engine.

## Testing

- **Engine**: the existing `sizing` tests run against a fixture catalog and must produce identical numbers.
- **Unit**:
  - `ApplianceSchema` edge cases (surge < watts, duty 0 and > 1, missing ES, AC fields on non-AC)
  - `diffAppliances`
  - cache TTL and the fallback on a thrown query
  - `applianceLabel` locale fallback
  - token comparison and the throttle
- **Drift**: `CATALOG_SNAPSHOT` equals the rows the migration inserts.
- **E2E**:
  - an admin adds an appliance and it appears in the picker in EN and ES
  - a non-admin gets 404 at `/admin/appliances`
  - a retired item leaves the picker but a project using it keeps its load
  - the API returns 401 without a token and 404 when the token env var is unset
- The coverage gate (80% on `src/lib`, `src/i18n`) stays.

## Environment

| var | where |
|---|---|
| `ADMIN_EMAILS` | Vercel + local |
| `CATALOG_API_TOKEN` | Vercel production + `.env.local` |
