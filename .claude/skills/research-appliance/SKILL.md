---
name: research-appliance
description: Research an appliance's running watts, start surge and duty cycle, then add or update it in the solar-dimension catalog through the token-protected API after the user confirms. Use for "/research-appliance <description>" or "add <appliance> to the catalog".
---

# Research an appliance into the catalog

Arguments: `<description> [--target local|prod]` (default `local`).

## Setup
- Never `cat`, `Read`, `rg` or otherwise print any `.env*` file: `.env.local` holds the token and the production database URL. Shell variables don't survive between commands, so start every command that calls the API with:
  ```bash
  TOKEN=$(sed -n 's/^CATALOG_API_TOKEN=//p' .env.local | tr -d '"') && BASE=http://localhost:3000
  ```
  For `--target prod`, use `BASE=$(sed -n 's/^CATALOG_API_URL=//p' .env.local | tr -d '"')` instead.
- Never print, echo or log the token or any database URL. Pass the token only in the `Authorization: Bearer` header.

## Which database a target writes to
`--target` picks the server, not the database: a server writes to the database it was started with. `.env.local` points at the **production** database, and `vercel env pull .env.local` keeps restoring that, so a local server started from it (`npm run dev`, `npm run start`) writes to production. Only a server started on another Neon branch does not.

Before the dry run, ask the server you are about to write to. It answers with the Neon endpoint id of its database (an id, not a credential) and whether that is the production one:
```bash
curl -s -m 10 -w '\n%{http_code}\n' -H "Authorization: Bearer ${TOKEN:?}" "${BASE:?}/api/catalog/database"
```
What it prints decides what you tell the user, in the table you show them and again in the question you ask before writing:
- `{"endpoint":"ep-…","production":true}` then `200`: "this writes to PRODUCTION".
- `"production":false` then `200`: "this writes to `<endpoint>`, not production". The item still has to go to prod separately (`--target prod`) to reach real users.
- Anything else with a status (401, 404, 429, 500, or a 200 without both keys): you can't tell, so say "this writes to PRODUCTION (the server did not name its database)". A 404 from a server whose other catalog routes answer means a build from before this route.
- `000`: no server answered on that target. Say so and stop.
- No status, and the shell says `TOKEN` or `BASE` is `not set`: the Setup line was not part of the command, or `.env.local` has no such key. Say which one and stop. Do not open the file to look.

When the server named its database, add `-H "X-Expect-Database: <endpoint>"` to every POST, the dry run and the write. A server that is no longer on that database (it was restarted, or another one took the port) then answers 412 and does nothing: show the `database` in its answer and start this section again.

That request is the only way to learn the database. Never read `DATABASE_URL` from an env file and never inspect the server's process (`ps`, `lsof`): the first prints production credentials, and neither shows what the running server uses.

With `--target prod` the answer should be `"production":true`. If it is `false`, stop and tell the user: either `CATALOG_API_URL` is not the production site, or the production database moved and `PRODUCTION_DB_ENDPOINT` in `src/lib/db-endpoint.ts` is out of date.

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
6. **Wait for an explicit yes** to a question that says where the write goes (see "Which database a target writes to"). Then `POST $BASE/api/catalog/appliances` with the same body and report `created` / `updated`.
7. **On errors:** 422 → show the per-item issues, fix, and repeat from step 4. 412 → the server is not on the database named in `X-Expect-Database`; it did nothing, see "Which database a target writes to". 401 → the token is wrong or missing in `.env.local`. 404 → the API is disabled on that target (`CATALOG_API_TOKEN` unset there). 429 → too many failed requests on this IP; wait and try again. 500 → database error; report and ask the user to retry.
