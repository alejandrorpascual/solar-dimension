# Product library: reference spec sheets for inverters and batteries

Status: draft. It builds on the spike in `scripts/product-search/` (three runs on 2026-10-09; results under Cost).

## Goals

1. The kit step shows up to 4 inverters and 4 batteries that fit the project's kit.
2. Each product has a spec sheet the user can refer to. Every value is copied from the maker's datasheet and links to the page it came from. Beside each value is what the kit needs.
3. Products live in a shared library in Postgres. A product is researched once and then graded against any kit by code.
4. When fewer than 4 of a kind fit, a signed-in user can ask for a web search. It runs in the background and adds what it finds to the library.

Prices are secondary. A price the search happens to see is kept with its seller and date, and shown last.

Out of scope:
- shopping, price tracking and price comparison;
- panels and charge controllers;
- "use this product in my kit", which reruns the engine with the product's real specs (see Later);
- the pairing rule beyond voltage and chemistry (see Open questions).

## Decisions

- **The AI finds and copies; code decides.** This is the same split as the quote reader. The model returns products and the specs their datasheets state, each with its source URL. Whether a product fits is pure code (`src/lib/product-fit.ts`), run on every view. Nothing about fit is stored.
- **A shared library, not per-project results.** In the spike, about 90% of a search's cost was the per-call web search fee ($0.01 a call, 14–16 calls a run); tokens were about $0.02. Each search's products are stored, so cost grows with the number of distinct products, not with users or kits. Runs pick different products, which helps the library fill out: three runs on the same kit found 8 distinct inverters and 10 distinct batteries.
- **Seed the library first, with an admin skill.** A `/research-product` Claude Code skill, like `/research-appliance`, adds products through a token-protected endpoint. It runs on the subscription with a dry run and a confirm step. About 20 common inverters and batteries should cover most kits without any paid search. User searches only fill gaps.
- **A product needs a datasheet.** A found product without a datasheet URL, or whose datasheet does not load at ingest, is dropped. The goal is a reference users can trust. The spike found datasheets for 23 of 24 products, and every one loaded. The one without, an SRNE inverter, also lacked a surge duration.
- **Surge is a list of levels.** EG4's 6000XP states "12,000W for ≈3.5 seconds | 11,000W for ≈5 seconds". With one surge field, two runs copied different, correct halves of that line. Each level keeps its watts, seconds, the datasheet's own words and its source. Fit reads the levels as the engine's `surgeRatedFor` does: the highest level that lasts as long as the kit's start-up, else the continuous rating.
- **Datasheet voltage maps to a system class.** A "48 V" LiFePO₄ unit's datasheet says 51.2 V (16 × 3.2 V cells). A nominal voltage within 10% of 12, 24, 36 or 48 V is that class, which is how `src/lib/catalog.ts` already labels its units.
- **Search country is US for now** (`PRODUCT_SEARCH_COUNTRY`). Products don't vary by user, and the US market is where both runs found full datasheets. A per-market library can come later.
- **Model `gpt-6-luna`** (`PRODUCTS_MODEL`), through the Responses API with the `web_search` tool, structured output and `store: false`. The request is streamed: a non-streamed request that sat silent for minutes was dropped in the spike.

## Admin research skill (`.claude/skills/research-product/SKILL.md`)

This works like `/research-appliance`. It runs on the subscription with Claude Code's own web search and fetch, and it writes through a token-protected endpoint after a dry run and an explicit yes.

**Inputs:** `/research-product <what> [--target local|prod] [--replace]`. `<what>` is one of:

1. **Named models:** `EG4 6000XP, Pytes V5`. Research exactly these. This is the main way to seed the library and to fix a product.
2. **A need:** `48 V inverter, ≥ 6 kW, split-phase` or `48 V LiFePO4 rack battery, ≥ 5 kWh`. Find up to 4 current models that meet it, then research each as in 1.
3. **A saved search run:** `--from <run.json>` (a spike or app search). Verify each product it found against its datasheet, then import it. The spike's three runs are the first seed: 8 inverters and 10 batteries.

**For each product:**
1. Find the maker's product page and datasheet.
2. Read the datasheet itself. A PDF is fetched and its pages are read, not summarised.
3. Fill the product schema. Every stated spec carries `{ value, source, asWritten }`: `asWritten` is the datasheet's own line, so each number can be checked against its words.
4. List the library (`GET /api/catalog/products`) to find duplicates by key.
5. Dry run: `POST /api/catalog/products?dryRun=true`. The API answers per product with a `status`:
   - `new`;
   - `updated`, listing the null values it fills (`fills`) and the values it overwrites (`replaced`, each `{ field, stored, found }`): with `--replace` any stated value, and a changed price always;
   - `conflicts`, listing the differing values (`conflicts`, each `{ field, stored, found }`);
   - `unchanged`.

   A product can carry both: an `updated` product can also list `conflicts`. Two more lists never change the status: `cleared` (fields whose stored conflicts the write settles) and `dropped` (`extraSpecs.<name>` for each new extra line not stored because the product already holds 8). An invalid product gets a 422 with its issues, and a flag other than `dryRun` or `replace`, each `true` or `false`, a 400 that names it.
6. Show a table: kind, brand and model, status, and each spec's value, `asWritten` and source, then what the write would overwrite (`replaced`, stored → found) and the dropped lines. Flag products with no datasheet (rejected), a VA-only surge, or no parallel limit.
7. Wait for an explicit yes, then `POST` and report what was created, updated and left in conflict. The answer is `{ created, updated, unchanged, conflicts }`. A product whose change has conflicts is in `conflicts` whatever its status, so a write that fills one field and finds another differing lists it under `updated` and under `conflicts`.

**Merging:** stated values are kept unless `--replace` is given. With it, the admin's values overwrite stated ones and clear their conflicts. The one exception is the price: it is dated and goes stale, so a different price always replaces the stored one, and the change reports it under `replaced` with both values; a first price is a fill.

**Targets:** the same warning as `/research-appliance`. `--target local` writes to whatever database the local server uses, which is production unless dev has its own Neon branch.

**Endpoint** (`src/routes/api/catalog/products.ts`): `GET` and `POST` (`?dryRun=true`, `?replace=true`; any other parameter, or a value other than `true` or `false`, is refused with a 400 before the body is read, so a mistyped flag never writes), behind `authorize()` from `catalog-api.ts` with `CATALOG_API_TOKEN`. The Zod schema in `src/lib/product-schema.ts` is shared by this endpoint, the in-app search and the fit rules.

## Flow

```
kit step ─> listProducts() (server fn, non-retired library) ─> productFit(kit, product) in the browser
   └─ fewer than 4 inverters or batteries fit ─> "Find more" (signed in)
        └─ POST /api/products/searches { projectId }
             ├─ a ready search for the same fingerprint in the last 30 days ─> reuse it, no call
             └─ admitted (budgets below) ─> product_searches row: queued ─> waitUntil(runProductSearch)
runProductSearch: model + web search (streamed) ─> Zod ─> drop products without a loading datasheet
                  ─> upsert into products ─> ready (or failed)
client polls the search every 3 s; the daily sweep re-kicks stale ones
```

The **fingerprint** is the kit's needs rounded up to steps, so that nearby kits share one search:
- inverter watts to 500 W and surge watts to 1,000 W;
- surge seconds;
- bank volts, chemistry, and usable energy to 2.5 kWh;
- split-phase, and solar array watts to 1 kW;
- country.

**`runProductSearch` must not upsert into `products` until writes are guarded against a concurrent writer.** The merge reads the stored rows and writes in a second statement, so two writers to one product can lose a fill or a conflict. Today the only writer is one admin through the skill. The guard is a `version` column checked in the upsert, with a retry.

## Data model

`products`:

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `kind` | text | `inverter` or `battery` |
| `key` | text unique | kind + brand + model, lowercased, spaces and punctuation removed |
| `brand`, `model` | text | |
| `maker_url`, `datasheet_url` | text | datasheet required |
| `specs` | jsonb | per kind, Zod-checked on read; each spec `{ value, source, asWritten }`, surge as levels |
| `extra_specs` | jsonb | up to 8 `{ name, value, source }` lines as written (transfer time, IP rating, temperature…) |
| `price` | jsonb null | `{ amount, currency, seller, url, seenOn }` |
| `origin` | text | `search` or `admin` |
| `conflicts` | jsonb | values a later search read differently, for admin review |
| `updated_by` | text | who last changed the row (`api-token` for the admin skill); a product sent again unchanged leaves it alone |
| `created_at`, `updated_at`, `last_seen_at`, `retired_at` | timestamptz | |

`product_searches`: `id`, `user_id`, `project_id`, `fingerprint`, `needs` (jsonb), `country`, `status` (`queued | processing | ready | failed`), `attempts`, `claimed_at`, `model_used`, `usage` (tokens and search calls by action), `product_ids` (jsonb), `error`, `created_at`, `processed_at`. A partial unique index on `fingerprint` where status is `queued` or `processing` stops two searches for the same kit running at once.

`product_search_daily_usage`: `day`, `searches`. It works like `quote_daily_usage`.

**Merging a product found again:**
- Stated values are never overwritten. A value that was null is filled in.
- A different value for a spec that is already stated goes to `conflicts`.
- `last_seen_at` moves forward for every product found again, changed or not. An unchanged product changes nothing else (`updated_at` and `updated_by` stay).
- A price is the exception to the first rule: a different price replaces the stored one without `?replace=true`, and the change reports it as replaced.
- New extra lines past the cap of 8 are not stored; the change lists them as `dropped`.
- Admin writes always win.

## Fit (`src/lib/product-fit.ts`, pure)

These rules come from the spike's `grade.ts`.

**Inverter:**
- continuous watts ≥ the running load × `SIZING.HEADROOM`;
- surge rating for the kit's surge seconds ≥ the kit's surge watts;
- battery volts = the kit's volts;
- split-phase when the kit needs it;
- solar input ≥ the array watts when the kit has panels.

**Battery:**
- chemistry matches;
- the system class divides the kit's volts;
- strings = the larger of what energy needs and what current needs;
- strings ≤ the maker's parallel limit.

Each check is `ok`, `fails` or `unclear` (the datasheet does not say). A product fits when nothing fails. An unclear product is shown with a "Check" badge that names what's missing.

**Surge levels that don't give watts and a duration are unclear:**
- A level in VA only (Sol-Ark states "30,000VA" for 100 ms) is not converted to watts.
- A level in watts with no duration (SRNE's "24000W") is also unclear.

**Bank counts use the app's depth of discharge** (`CHEMISTRIES[chem].dod`, 85% for LiFePO₄), not each maker's. This keeps them the same as the kit sheet's. The maker's figure (80–100% in the spike) is shown on the spec sheet as an extra line.

**Ranking within a kind:**
1. All `ok` before any `unclear`.
2. Then the closest fit: the smallest continuous-to-need ratio, or the fewest battery units.
3. Then the most specs stated.

## UI

The design comes first: three variants on a design canvas, as for the quote verdict. Constraints:
- A "Matching products" card on the kit step, near the quotes card. On phones the inverters and batteries are two stacked lists; there's no 4×4 grid and no side scrolling.
- Each row shows the brand and model, a fit badge, the two specs that decide fit against the kit's need (for example "6 kW · 11 kW for 5 s"), and for batteries the bank ("3 × 5.4 kWh").
- A row opens the spec sheet:
  - every spec beside the kit's need, each with a link to its source;
  - the surge levels as written;
  - the extra datasheet lines;
  - the datasheet link;
  - price last, as "seen at {seller} on {date}";
  - the line "Specs copied from the maker's datasheet by AI. Check the datasheet before you buy."
- The empty state when nothing fits: "Find more" for signed-in users, a sign-in prompt for others. While searching: a progress line, since a search takes 2–3 minutes.
- English and Spanish text, as everywhere.

## Limits and errors

- Per user: 10 searches a month. Per project: 3.
- Across accounts: `PRODUCT_SEARCHES_DAILY`, default 50, which is at most about $9 a day at the spike's cost.
- Who can search: the same access rule as quote reading (`quote-access.ts`).
- A failed or cut-short answer is retried once, then marked `failed` with a message. The library keeps whatever was stored before.

## Testing

- **Unit:**
  - fit rules, including 51.2 V → 48 V, the 6000XP's two surge levels, a VA-only surge (unclear) and a too-small parallel limit (fails);
  - the fingerprint;
  - merge rules;
  - ranking.
- **Repo:** upsert and the conflict path, and the unique running search.
- **E2E:** a stub model (`PRODUCTS_MODEL_STUB=1`, as `QUOTES_MODEL_STUB`) returns fixed products. Check the cards, the spec sheet, "Find more" and polling, on desktop and phone.
- **Eval before launch:** five kits (12 V small, 24 V, 48 V home, split-phase, with solar), one search each. Check two datasheets per run by hand, field by field.

## Environment

| name | value |
|---|---|
| `OPENAI_API_KEY` | already set for quotes |
| `PRODUCTS_MODEL` | default `gpt-6-luna` |
| `PRODUCT_SEARCH_COUNTRY` | default `US` |
| `PRODUCT_SEARCHES_DAILY` | default 50 |
| `PRODUCTS_MODEL_STUB` | `1` in e2e |
| `CATALOG_API_TOKEN` | already set; reused by the product admin endpoint |

## Cost

Spike runs with `gpt-6-luna`, US, one kit (2,065 W running, 3,115 W surge for 3 s, 48 V, 13.1 kWh usable):

| run | prompt | time | search calls | tokens in / out | cost |
|---|---|---|---|---|---|
| 1 | shopping-flavoured | 143 s | 14 | 128k / 14k | $0.160 |
| 2 | specs first | 153 s | 16 | 113k / 14k | $0.178 |
| 3 | specs first, surge levels | 122 s | 15 | 127k / 15k | $0.170 |

About $0.17 a search, or about $170 per 1,000. A search that reuses a fingerprint, or a kit served from the library alone, costs nothing.

**What the runs showed:**
- **Coverage:** run 2 stated 95% of specs and run 3 91%, all with a source.
- **Datasheets:** 23 of 24 products had one, and all loaded.
- **Accuracy:** I checked the EG4 6000XP datasheet by hand. All 15 fields matched run 2.
- **Surge levels:** in run 3, the 6000XP's two surge levels came back word for word. Sol-Ark's VA-only surge and SRNE's surge with no duration both read as unclear, as the fit rules intend.

## Open questions

1. **Pairing rule.** When are an inverter and a battery a pair: matching voltage and chemistry, or only when the inverter maker lists the battery's brand? Is a CAN-only inverter with an RS485-only battery "no" or "check"? This is `pairStatus` in the spike's `grade.ts`.
2. **Country.** Should US stay the only market, or should Venezuelan users get a VE search once the library has US coverage?

## Later

- **Use in my kit.** Pass a chosen product to `compute()` as its `hardware` catalog, so the engine's checks run against real specs. Battery fields already match `BatteryUnit`: `maxContinuousA`, `peakA`, `peakSeconds`, `maxParallel`, `bmsComms`. Surge levels map to `surge` and `surgeLong`.
- **An admin page** for products, with retire and restore, and the conflicts list.
