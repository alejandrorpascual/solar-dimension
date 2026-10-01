# Quotes that offer several systems ("options"): design

**Date:** 2026-10-01
**Status:** Draft, waiting for review
**Branch:** `claude/quote-options`, stacked on PR #6 (`claude/budget-quote-upload-design-5f3048`)

## Why

The user uploaded a real quote from SUNA M.P. It offers **two alternative systems**, each priced on its own, and leaves the total empty:

| Line | Price |
|---|---|
| "Inversor de corriente 3 kW … incluye 2 baterías de litio 5.12 kWh … transfer y flete" | USD 2,600 |
| "Inversor de corriente 10 kW … incluye baterías de litio 200 Ah, controlador solar 80 A/48 V" | USD 6,200 |

The document has a total, tax and taxable-base section, but all three are blank. A person reads this at once: two kits to choose from, one of them sized for the project being compared.

The app gets it wrong in three ways:

1. **The reader has no idea of alternatives.** `SYSTEM_PROMPT` (`src/server/quotes/model.ts`) only knows "optional extras", so both systems come back as included lines. `checkInverter` and `checkBattery` (`src/lib/quote-items.ts`) add every included line together: a 13 kW inverter, and both kits' batteries as one bank.
2. **No total costs two reads, then a dead end.**
   - The model writes `total: 0`, so `checkExtraction` fails with `no_total` and the fallback model reads the quote again (`src/server/quotes/process.ts:68-70`).
   - The quote ends as `needs_review` and asks the user for "the total". There isn't one: there are two prices.
   - If the user types 6,200, the sizing still counts both kits.
3. **A line that bundles several components loses the batteries.** "Inverter … includes 2 lithium batteries" is a single `inverter` line. The battery check only looks at `battery` lines, so those batteries read as "not mentioned".

## What stays true

- **The AI reads; code decides.** The model only says which lines belong to which alternative, and what each costs, when the document writes it. Grouping, prices, fit and ranking are computed in `src/lib`.
- **Never infer.** The prompt still forbids estimating. Splitting a bundled line copies what is written; it doesn't add anything.
- **One system per quote keeps working exactly as today:** same entries, same totals, same checks.
- **The rest:** EN and ES ship together, immutable helpers, sentence case, and the Global Constraints of `docs/superpowers/plans/2026-09-29-quote-verdict-b.md`.

## 1. Extraction: `src/lib/quote-schema.ts` and the prompt

Two new fields, both required in the structured output, because OpenAI's strict mode needs every field present:

```ts
options: z.array(z.object({ id: z.string(), label: z.string(), total: z.number().nullable() })),
// on each line:
option: z.string().nullable(),
```

- **`options`** lists the alternative systems the document offers.
  - It is empty when the document offers one system.
  - Each option's `label` is short and in the document's language, e.g. "Inversor 10 kW".
  - Each option's `total` is null unless the document writes it.
- **`line.option`** is the id of the option the line belongs to. It is null for lines that apply to every option, such as shared installation or transport, and for every line of a single-system quote.
- **`normalizeExtraction`** caps `options` at 5, cuts labels to 60 characters, and nulls any `line.option` that names no listed option.

New prompt rules, added after the `optional` rule:

1. When the document offers alternative systems or packages to choose from, each priced on its own, list each in `options` and set each line's `option` to its id.
   - Examples: "Option 1 / Option 2", or two complete kits (each with its own inverter) listed one after another with no total that adds them up.
   - Lines that apply to every alternative get option null.
   - When the document offers one system, `options` is empty and every option is null.
2. When one line describes several components (for example an inverter that includes batteries or a charger), write one line per component.
   - Each gets its own kind and specs, the same `source`, and the same `option`.
   - The first gets the written price; the others get lineTotal 0.

**`MAX_OUTPUT_TOKENS`** grows by about 300 tokens (5 options × ~60 tokens). Its doc comment's arithmetic is updated to match.

**Stored quotes.** Extractions saved before this change have neither field, because `jsonb` is read as is (`src/server/quotes/api.ts:31`).
- A new pure helper, `withOptionDefaults(x)` in `quote-schema.ts`, fills `options: []` and `option: null`.
- It runs where rows become `QuoteView`s.
- Nothing is migrated.

## 2. Checks: `src/lib/quote-checks.ts`

A new helper, `optionPrices(x): { id: string; total: number | null }[]`, gives each option its price. That is the option's written `total`, or else the sum of its own included lines plus the shared ones (option null) when that sum is above 0.

With two or more options:

- **`no_total` fails only when no option has a price.** The SUNA quote now passes, so it isn't sent to the fallback model for a second read.
- **`total_mismatch` is skipped.** Alternatives don't add up to anything. The per-line check (`qty × unitPrice` against `lineTotal`) still runs.

With fewer than two options, `checkExtraction` is unchanged.

## 3. Ranking: one entry per option (`src/lib/quote-compare.ts`)

A quote with two or more options becomes **one entry per option**.

- **Lines:** the option's own lines plus the shared ones.
- **Price:** from `optionPrices`.
- **Ranking:** the entries rank like separate quotes, so the cheapest option that meets every must-have wins. An option clearly meant for another project shows up as "Doesn't fit" with its gap, which is what the user sees on paper.
- **A quote with fewer than two options** is one entry, built exactly as today.

### Types

`RankedQuote` and `UnrankedQuote` gain:

- `optionId: string | null`
- `optionLabel: string | null`
- `optionCount: number` (0 for a single-system quote)

A new `entryKey(e)` returns `quote.id`, plus `:${optionId}` for an option.

Every place that compares entries by `quote.id` switches to `entryKey`:
- `isBest` in `quote-text.ts`;
- the `others` filter, the React keys, `worthAsking`, and `errorFor`'s key in `VerdictView`;
- `QuoteRow`'s `isAsking`.

### Inside a quote, the user's edits

- **Overrides** ("Included" / "Not included") stay per quote and apply to all its options. The cards say nothing different; a vendor's "the charger is included" usually covers every kit it offers.
- **`totalOverride`** stays a single-system feature. An option without a price becomes an unranked entry with a new reason, **`no_price`**. It shows the pill "No price for this option" / "Sin precio para esta opción" and no total form. A total typed for the whole document wouldn't belong to either kit.
- **`readCount`, `failedCount` and the tray** keep counting quotes (files), not entries.

### Project line and job summary

`summarizeProject` (`quote-jobs.ts`) names the best entry. For an option that's "SUNA M.P. · Inversor 10 kW", using a new text builder, `entryName(t, e)`.

## 4. Cards

The cards are variant A's. Only the second line changes.

- **`quoteSubtitle` becomes `entrySubtitle(t, e)`** in `quote-text.ts`:
  - for an option: "Option 2 of 2 · Inversor 10 kW · suna.pdf" / "Opción 2 de 2 · Inversor 10 kW · suna.pdf";
  - otherwise: the file name, as today.
- **The heading** keeps the vendor name, so "SUNA M.P." and "Option 2 of 2" read together.
- **Delete** on an option card deletes the whole file. The confirmation says so: "Delete this quote, its {count} options and its file?" / "¿Borrar esta cotización, sus {count} opciones y su archivo?"

## 5. Reading a quote again

Quotes read before this change, such as the user's SUNA quote, stay as they were stored. They have no options and wait for a total.

To fix them without a delete and re-upload, **Retry is also offered for `needs_review` quotes**:

- `RETRYABLE = ['failed', 'needs_review']`.
- The same limits apply: `MAX_RETRIES` and the daily read budget, checked by the server in the same update as today.
- A read that ends `ready` replaces the stored extraction. A total the user typed (`totalOverride`) is kept and still wins for a single-system quote.
- The button shows on the unranked card next to the total form. Its label is "Read again" / "Leer de nuevo", because "Retry" reads oddly on a quote that didn't fail.

## 6. Testing

- **Unit:**
  - `withOptionDefaults` on an old-shaped extraction.
  - `normalizeExtraction` caps options and clears an unknown `line.option`.
  - `optionPrices` with a written total, with prices only on lines, with shared lines, and with an unpriced option.
  - `checkExtraction` for the SUNA shape: it passes, with no `no_total` and no `total_mismatch`.
  - `compareQuotes`:
    - the SUNA fixture gives two entries;
    - only the 10 kW option can fit the sample kit;
    - an unpriced option is `no_price`;
    - overrides reach both options;
    - `readCount` counts files.
  - `entryKey`, `entryName` and `entrySubtitle` in EN and ES.
  - `retryOffer` for `needs_review`.
- **Fixture:** `SAMPLE_QUOTES.suna` in `quote-fixtures.ts` mirrors the real quote. It has two options, the bundled batteries split into their own lines, and `total: 0`. The stub model returns it for `suna.pdf`.
- **E2E** (`e2e/quotes.spec.ts`): upload `suna.pdf` with SolarTec. The verdict shows two SUNA cards, "Option 1 of 2" and "Option 2 of 2", each with its own price and gauges. Neither card asks for a total.
- **Prompt:** this spec doesn't claim that a real model splits the SUNA PDF correctly.
  - After deploying to the Preview, the user reads the real SUNA quote again with "Read again" and checks the two cards.
  - That is the acceptance test for the prompt rules.

## Out of scope

- A typed price per option. That needs a per-option override column and a migration. Add it only if unpriced options turn up.
- Telling apart prices that include tax and prices that don't. The SUNA quote's 16 % IVA line is blank; options are compared as written, like every quote today.
- Inferring a battery's voltage from the system voltage written elsewhere, such as the "48 V" on the controller. That's an inference the prompt forbids. That battery stays "not stated", so the 10 kW option is "worth asking".
- Grouping a quote's options under one card. They're separate cards for now; revisit if the list gets long.
