---
name: research-appliance
description: Research an appliance's running watts, start surge and duty cycle, then add or update it in the solar-dimension catalog through the token-protected API after the user confirms. Use for "/research-appliance <description>" or "add <appliance> to the catalog".
---

# Research an appliance into the catalog

Arguments: `<description> [--target local|prod]` (default `local`).

## Setup
- Read `CATALOG_API_TOKEN` from `.env.local`. Base URL: `http://localhost:3000` for local; for prod, `CATALOG_API_URL` from `.env.local`.
- Never print, echo or log the token or any database URL. Pass the token only in the `Authorization: Bearer` header.

## Which database a target writes to
`--target` picks the server, not the database. The local dev server writes to whatever database `DATABASE_URL` in `.env.local` points at, and `vercel env pull .env.local` fills it with the **production** database. So `--target local` is a production write unless local dev has been moved to its own Neon branch.

Before any write, find out which database the **running** local server uses, as a Neon endpoint id (the first label of the `DATABASE_URL` host, without `-pooler`). Print only that id, never the URL. The production database is `ep-round-sea-auutoq9o`.
1. A `DATABASE_URL` exported in the shell that started the server wins over `.env.local` (dotenv never overrides it). This prints the endpoint from the server's startup environment, or nothing if it isn't there:
   ```bash
   pid=$(lsof -ti tcp:3000 -sTCP:LISTEN | head -1); ps eww -o command= -p "$pid" | tr ' ' '\n' | sed -n 's/^DATABASE_URL=.*@\(ep-[a-z0-9-]*\)\..*/\1/p' | sed 's/-pooler$//' | head -1
   ```
2. If it printed nothing, the server took `DATABASE_URL` from `.env.local`: read the endpoint id from there.
- Production id, no server on :3000, or you can't tell: treat `--target local` as production. Say "this writes to PRODUCTION" in the step 5 table and in the question in step 6. If `.env.local` was edited after the server started, the server still uses the old value: ask the user to restart it, or treat the write as production.
- Different id: local is a separate branch. Say which one, and remember that the item still has to go to prod separately (`--target prod`) to reach real users.

`--target prod` always writes to production.

## Steps
1. **Research** typical values for the described appliance (one row per distinct size or type the user asked for):
   - `watts`: typical running watts (integer).
   - `surge`: start surge in watts (integer, ≥ watts). Resistive loads (heaters, stoves, kettles) have surge = watts; motors and compressors are 2–3×; inverter compressors ~1.3×.
   - `duty`: share of each hour it draws power while in use (0 < duty ≤ 1). Match the existing items: fridge 0.35, microwave 0.08, water heater 0.25.
   - `kind`: `continuous` (duty 1), `cycling` (turns on and off: fridges, AC, heaters) or `momentary` (runs for seconds at a time: gate motors, barriers, garage doors). `null` lets the engine derive it from the duty (1 → continuous, else cycling), so only set it for momentary items or to override.
   - `surgeClass`: how long the start-up lasts: `inrush` (electronics, ~20 ms), `motor` (~1 s: pumps, fans, gates, inverter AC), `compressor` (~3 s: fridges, freezers, conventional AC). `null` lets the engine derive it from the compressor type and the surge ratio; set it when the appliance is unusual. It must be `null` when surge equals watts.
   - Momentary items only: `burstSeconds` (seconds per run, ≤ 600) and `cyclesPerHour` (runs per hour, ≤ 120), with burst × cycles ≤ 3600. The engine uses burst × cycles ÷ 3600 as the duty; set `duty` to that figure too (it is what the admin table shows). Both must be `null` for every other kind.
   - Keep one source (URL or datasheet) for each number.
2. **Write labels** in the same tone as the existing items: EN and ES `name` (short, with size if it matters, e.g. "Induction cooktop, 2 burners") and `note` (how it cycles, e.g. "~10 min per hour of cooking"). Spanish is Latin American.
3. **Check for duplicates:** `curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/catalog/appliances`. Reuse an existing id if the item is already there (that makes it an update). Otherwise make an id with lowercase letters, digits and dashes, 2-48 characters, starting with a letter or digit. Ids shaped like `custom1`, `custom2`, … are reserved for the app's own custom loads and are always rejected.
4. **Dry run:** `POST $BASE/api/catalog/appliances?dryRun=true` with a JSON array of items shaped `{ id, category, watts, surge, duty, tons: null, acType: null, kind: null, surgeClass: null, burstSeconds: null, cyclesPerHour: null, labels: { en: {name, note}, es: {name, note} } }`. Category is one of Kitchen, Living, Climate, Air conditioning, Work, Utility, Security, Personal. The four load-kind keys may be omitted (they default to null); see step 1 for when to set them.
   - For category `Air conditioning`: `tons` (a positive number) and `acType` (`inverter` or `conventional`) are required, not null.
   - For every other category: `tons` and `acType` must both be `null`. The API rejects a request that sets either field outside Air conditioning, or that omits them for it.
5. **Show the user a table:** id, new or changed (with old → new), EN name, ES name, watts, surge, duty, kind and surge class when set (with burst seconds × cycles per hour for momentary items), and the source for each number. Mention any item of 3 kW or more (the app flags it as needing a 240 V split-phase inverter).
6. **Wait for an explicit yes.** Then `POST $BASE/api/catalog/appliances` with the same body and report `created` / `updated`.
7. **On errors:** 422 → show the per-item issues, fix, and repeat from step 4. 401 → the token is wrong or missing in `.env.local`. 404 → the API is disabled on that target (`CATALOG_API_TOKEN` unset there). 429 → too many failed requests on this IP; wait and try again. 500 → database error; report and ask the user to retry.
