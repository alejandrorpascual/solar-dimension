---
name: research-appliance
description: Research an appliance's running watts, start surge and duty cycle, then add or update it in the solar-dimension catalog through the token-protected API after the user confirms. Use for "/research-appliance <description>" or "add <appliance> to the catalog".
---

# Research an appliance into the catalog

Arguments: `<description> [--target local|prod]` (default `local`).

## Setup
- Read `CATALOG_API_TOKEN` from `.env.local`. Base URL: `http://localhost:3000` for local; for prod, `CATALOG_API_URL` from `.env.local`.
- Never print, echo or log the token. Pass it only in the `Authorization: Bearer` header.

## Steps
1. **Research** typical values for the described appliance (one row per distinct size or type the user asked for):
   - `watts`: typical running watts (integer).
   - `surge`: start surge in watts (integer, ≥ watts). Resistive loads (heaters, stoves, kettles) have surge = watts; motors and compressors are 2–3×; inverter compressors ~1.3×.
   - `duty`: share of each hour it draws power while in use (0 < duty ≤ 1). Match the existing items: fridge 0.35, microwave 0.08, water heater 0.25.
   - Keep one source (URL or datasheet) for each number.
2. **Write labels** in the same tone as the existing items: EN and ES `name` (short, with size if it matters, e.g. "Induction cooktop, 2 burners") and `note` (how it cycles, e.g. "~10 min per hour of cooking"). Spanish is Latin American.
3. **Check for duplicates:** `curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/catalog/appliances`. Reuse an existing id if the item is already there (that makes it an update). Otherwise make an id with lowercase letters, digits and dashes.
4. **Dry run:** `POST $BASE/api/catalog/appliances?dryRun=true` with a JSON array of items shaped `{ id, category, watts, surge, duty, tons: null, acType: null, labels: { en: {name, note}, es: {name, note} } }`. Category is one of Kitchen, Living, Climate, Air conditioning, Work, Utility, Security, Personal.
5. **Show the user a table:** id, new or changed (with old → new), EN name, ES name, watts, surge, duty, and the source for each number. Mention any item of 3 kW or more (the app flags it as needing a 240 V split-phase inverter).
6. **Wait for an explicit yes.** Then `POST $BASE/api/catalog/appliances` with the same body and report `created` / `updated`.
7. **On errors:** 422 → show the per-item issues, fix, and repeat from step 4. 401 → the token is wrong or missing in `.env.local`. 404 → the API is disabled on that target (`CATALOG_API_TOKEN` unset there). 429 → too many failed requests on this IP; wait and try again. 500 → database error; report and ask the user to retry.
