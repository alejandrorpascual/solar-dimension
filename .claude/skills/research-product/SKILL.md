---
name: research-product
description: Research inverters or batteries from their makers' datasheets and add or update them in the solar-dimension product library through the token-protected API after the user confirms. Use for "/research-product <models | a need | --from file>" or "add <inverter or battery> to the product library".
---

# Research products into the library

Arguments: `<what> [--target local|prod] [--replace]` (default target `local`).

`<what>` is one of:
- **Named models**, e.g. `EG4 6000XP, Pytes V5`: research exactly these.
- **A need**, e.g. `48 V inverter, ≥ 6 kW, split-phase`: search for current models that meet it, pick up to 4 whose maker publishes a datasheet, show the list, then research each.
- **`--from <file.json>`**: a saved search run. Take its products from the JSON's `inverters` and `batteries`, or, in a spike `--out` file, from the `output_text` of its `message` item. Research each one again from its datasheet; the run's values are leads, not answers.

## Setup
- Read `CATALOG_API_TOKEN` from `.env.local`. Base URL: `http://localhost:3000` for local; for prod, `CATALOG_API_URL` from `.env.local`.
- Never print, echo or log the token or any database URL. Pass the token only in the `Authorization: Bearer` header.
- Before any write, follow "Which database a target writes to" in `.claude/skills/research-appliance/SKILL.md`. `--target local` is a production write unless the local server runs on another Neon branch.

## Steps
1. **List the products** to research (see `<what>`).
2. **Find each one's datasheet** on the maker's site. Fetch it. A PDF fetch saves the file and reports its path: `Read` that path with `pages` and read the spec table itself. Take no number from a summary, a reseller page when the datasheet states it, or a similar model. No datasheet found: drop the product and say so.
3. **Fill one item per product** (shape below). Every spec is `{ value, source, asWritten }`:
   - `value`: the number, in W, V, A, s, Ah, kWh, % or years. `source`: the https URL you read it on. `asWritten`: the datasheet's own words for it, copied.
   - Not stated: all three `null`. Never estimate, convert from a similar model or fill a typical value.
   - `surges`: every surge or overload level, shortest first, each `{ w, seconds, asWritten, source }`. "12,000W for ≈3.5 s | 11,000W for ≈5 s" is two levels. "2× Pn, 5 s" gets `w` = 2 × the stated rated power. A level given only in VA gets `w: null`.
   - Battery `nominalV` as written (51.2), not the system class (48). `chemistry` is `lifepo4`, `agm` or `other`.
   - `bmsComms`: the protocols the datasheet names (`can`, `rs485`). Compatible brands: only those the maker lists.
   - `extraSpecs`: up to 8 more lines an installer would check, as written: transfer time, IP rating, operating temperature, dimensions, weight, the maker's depth of discharge.
   - `price`: only if you saw it on a seller's page; `seenOn` is today. Never search for prices.
4. **Check for duplicates:** `curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/catalog/products`. If the product is there under another spelling, use the stored `brand` and `model` exactly.
5. **Dry run:** `POST $BASE/api/catalog/products?dryRun=true` (add `&replace=true` with `--replace`) with a JSON array of items. Each change has `status` (`new`, `updated`, `conflicts`, `unchanged`), `fills`, `replaced`, `cleared` (fields whose stored conflicts this write settles) and `conflicts` (`field`, `stored`, `found`).
6. **Show the user** one table per product: its status and key, then every stated spec with value, `asWritten` and the source's host, then fills, cleared and conflicts (stored → found). Flag: a VA-only or duration-less surge, no parallel limit, any stated value missing `asWritten`. Say "this writes to PRODUCTION" when it does.
7. **Wait for an explicit yes.** Then `POST` the same body to the same path without `dryRun` and report `created`, `updated`, `unchanged` and `conflicts`. Conflicts are kept on the product for review. `--replace` overwrites them; re-sending the stored value with `--replace` keeps it and clears that field's conflicts (`cleared`).
8. **On errors:** 422 → show the per-item issues (index and dotted path), fix, repeat from step 5. 409 → a stored product with that key no longer passes the schema (`keys` lists them); nothing was written; report it, the stored row needs fixing first. 401 → the token is wrong or missing in `.env.local`. 404 → the API is disabled on that target (`CATALOG_API_TOKEN` unset there). 429 → too many failed requests from this IP; wait. 500 → database error; report it and ask the user to retry.

## Item shape

Inverter:
```json
{ "kind": "inverter", "brand": "EG4 Electronics", "model": "6000XP",
  "makerUrl": "https://…", "datasheetUrl": "https://….pdf", "price": null,
  "extraSpecs": [{ "name": "Transfer time", "value": "<15ms @ Single / <30ms @ Parallel", "source": "https://….pdf" }],
  "specs": {
    "continuousW": { "value": 6000, "source": "https://….pdf", "asWritten": "NOMINAL POWER OUTPUT 6000W" },
    "surges": [{ "w": 12000, "seconds": 3.5, "asWritten": "12,000W for ≈3.5 seconds", "source": "https://….pdf" }],
    "batteryVolts": {…}, "splitPhase": {…}, "chargerA": {…}, "pvInputW": {…}, "pvVocMax": {…},
    "maxParallelUnits": {…}, "idleW": {…}, "peakEfficiencyPct": {…}, "warrantyYears": {…},
    "bmsComms": ["can", "rs485"], "compatibleBatteryBrands": [] } }
```

Battery: the same top level with `"kind": "battery"` and
```json
"specs": { "chemistry": {…}, "nominalV": {…}, "ah": {…}, "kWh": {…}, "maxContinuousA": {…}, "peakA": {…},
  "peakSeconds": {…}, "maxParallel": {…}, "cycleLife": {…}, "warrantyYears": {…},
  "bmsComms": [], "compatibleInverterBrands": [] }
```
Every `{…}` is `{ "value", "source", "asWritten" }`. All keys are required; unknown keys are refused.
