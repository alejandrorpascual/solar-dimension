# Quote-reading eval

How well the real model reads supplier quotes: the evaluation that audit finding AI-01 asks for, with the golden set of
section A8 of the AI pipeline audit. It is run by hand, never in CI, and re-run after any change to the prompt, the
schema or the models.

## What it measures

Each case is a quote document plus the reading a person wrote for it by hand (`expected.json`). The script sends each
document to each configured model, as the app does (`extractRequest` in `src/server/quotes/model.ts`), and scores every
reading (`src/lib/quote-eval.ts`):

| Column | What it counts |
|---|---|
| totals | total and currency, exact |
| lines | each expected line's kind, qty and lineTotal, exact. Lines are paired by kind and amount, so their order doesn't matter |
| specs | the numeric specs the document writes (watts, surgeWatts, batteryVolts, ah, kWh, ...), exact |
| details | every other written value: vendor name, dates, subtotal, tax, unit prices, optional, option, chemistry, gauge, fuse class, page, options, warranties |
| halluc | fields the document leaves blank that came back with a value (A8's hallucination count) |
| missing, extra | expected lines no line of the reading matched, and lines of the reading that match none |
| notes | for cases that expect a note (a conflict, an exclusion), the groups of words the notes mention |
| status | what the app's checks make of the reading (ready or needs review), against the case's `status`. `record` means A8 asks only to record it for now |
| exact | runs right in all of the above |

Each case runs 3 times per model, since no temperature is set. Fractions add up those runs. Below the tables, the script
lists what went wrong in the first imperfect run of each case and model. The results file
(`eval/quotes/results/<time>.json`, not committed) keeps every reading, every difference, each call's tokens and the
commit it ran on.

Some expected values wait on a fix that A8 proposes, such as a nullable total, a `gel` chemistry or a rule for battery
volts on an inverter line. Each case's `case.json` lists them under `pending`, with what is expected today and after the
fix. Fields A8 asks only to record are in `unscored`: they are kept in the results and count nowhere.

## The cases

`cases/<NN-slug>/` holds `case.json` (title, document, expected status, the nulls A8 singles out, notes), `expected.json`
and, for a document built here, `document.json` (its pages).

- **Built here**: cases 1, 4 to 10, 12, and case 11's PDF with the invisible text layer. `npx tsx eval/quotes/build-documents.ts`
  writes them to `eval/quotes/documents/`, which is not committed, and the eval script rebuilds them on every run.
- **Photographed, scanned or exported**: case 2 (a phone photo), case 3 (a scan with no text layer) and case 11's image.
  The script builds a print source for each (`<slug>.print.pdf`). `bash eval/quotes/make-supplied.sh` turns those into
  stand-ins with ImageMagick: the page at an angle with a shadow and noise, three crooked grey pages with no text layer,
  and the page as an image. A real photo or scan reads harder, so a file made as each `case.json`'s `howTo` says can
  replace a stand-in. Until a file is there, its case is skipped with a line saying so.

### Adding a real quote

Take a real quote and change every name, contact, address and price in it. Then:

1. Put the file in `eval/quotes/documents/` (not committed): a PDF of up to 5 pages, or a JPEG, PNG or WebP image, under
   4 MB.
2. Make a folder `cases/20-<slug>/` with a `case.json` whose `document` is
   `{ "source": "supplied", "file": "<the file name>", "uploadName": "cotizacion.pdf" }`. Copy the other fields from a
   case of the same kind.
3. Write `expected.json` by hand: what the quote writes and nothing more, null where it writes nothing. `expected.json`
   is committed, so make sure no real name or price is left in it.
4. Check it with `npx vitest run src/lib/quote-eval-case.test.ts`. A null that holds a value, a path that names no field,
   or a status the app would not give stops the eval before any call.

## Running it

```sh
npx tsx scripts/eval-quotes.ts                    # the plan: how many calls, to which models. Calls nothing
npx tsx scripts/eval-quotes.ts --dry-run --yes    # the whole run with two fake models. Free
OPENAI_API_KEY=... npx tsx scripts/eval-quotes.ts --yes
```

`npm run eval:quotes -- --yes` works too. Without the `--`, npm keeps `--yes` for itself and nothing is called.

- `--model <id>` runs one of the configured models. The models are `QUOTES_MODEL_PRIMARY` and `QUOTES_MODEL_FALLBACK`
  from the shell, with the app's defaults. To try another model, set one of the two for that run.
- `--case <slug or number>` runs one case (`--case 11` runs both variants). `--runs <n>` sets the runs per case and model.
- The key is read from `OPENAI_API_KEY` in the shell only. The script never reads `.env.local`, which points at
  production.
- It refuses to run when `CI` is set.

## What it costs

Calls = cases x models x runs. With the 10 built cases, 2 models and 3 runs, that is 60 calls, or 78 once the three
hand-made files are in. The script prints the number and stops unless `--yes` is given. Each call sends one document: a
PDF goes as its text and an image of each page, and an image goes at high detail. Each call may write up to 12,500 output
tokens. The results file records each call's input and output tokens, so the first run gives the real cost at the
models' prices.

## After a run

After the first real run, record the baseline in `docs/audits`: per model, the exact runs and the share right in each
field class, the hallucinations, missing and extra lines, and the commit from the results file. Re-run the eval after any
change to the prompt, the schema or the models, and compare with the baseline.
