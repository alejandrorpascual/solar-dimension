# AC groups, Security category, typed quantities

**Date:** 2026-09-24 · **Status:** approved

## Problem
- The Air conditioning list shows 12 cards that alternate inverter / conventional by size, so the type flips on every card and the difference between them (start surge) is never explained. Catalog cards do not render `note`.
- There is no way to add CCTV cameras or recorders.
- A condo can have 30+ perimeter cameras, but quantities are entered only with + / − and capped at `SIZING.MAX_QTY = 20`.

## Design

### 1. AC grouped by compressor type
- Wherever AC cards appear (the *Air conditioning* filter and *All*), render two groups in this order:
  - **Inverter**: header `acInverter` + help `acInverterHelp` ("Soft start. Easy on the battery and inverter." / "Arranque suave. Cuida la batería y el inversor.")
  - **Conventional**: header `acConventional` + help `acConventionalHelp` ("Starts at ~3× its running power. Needs a bigger inverter." / "Arranca con ~3× su potencia en marcha. Necesita un inversor más grande.")
- Each group lists its sizes ascending (1, 1.5, 2, 3, 4, 5 tons).
- Inside a group, the card title is the size only: `acSize` → "{tons} ton · {btu}k BTU" / "{tons} tonelada(s) · {btu}k BTU" (Spanish: "tonelada" for 1, "toneladas" otherwise).
- While the search box has text, AC cards are not grouped and keep their full names (`applianceName`), so each result is self-explanatory.
- Parts list, warnings and footer keep full names. No ids, fields or saved data change.

### 2. Security category
- New `Category` value `'Security'`, placed after `'Utility'` in `CATEGORIES`; translations "Security" / "Seguridad".
- New base items (all `duty: 1`, `surge = watts`):

| id | en name | es name | W | note (en) |
|---|---|---|---|---|
| `cctv` | CCTV camera | Cámara de CCTV | 7 | Continuous · includes IR night vision and PoE losses |
| `nvr16` | Recorder (NVR/DVR), up to 16 cameras | Grabador (NVR/DVR), hasta 16 cámaras | 20 | Continuous · 1 hard drive |
| `nvr32` | Recorder (NVR/DVR), 32+ cameras | Grabador (NVR/DVR), 32+ cámaras | 50 | Continuous · 4 hard drives |

### 3. Typed quantities
- In `ApplianceCard`, the number between − and + becomes `<input type="text" inputMode="numeric" pattern="[0-9]*">` labelled `qtyOf` ("Quantity of {name}" / "Cantidad de {name}").
- Commit on blur and on Enter. A value that is empty or not a whole number reverts to the current quantity; otherwise it goes through `setQty`, which clamps to `0..MAX_QTY`. Typing 0 removes the item (the card returns to "Add").
- `SIZING.MAX_QTY` rises from 20 to 100. Saved data stays valid because the limit only grows; client and server share the constant.

## Out of scope
PoE switch as a separate item, per-item quantity caps, alarm/gate/doorbell items.

## Testing
- Unit: `SIZING.MAX_QTY` clamp at 100 in `setQty`; the new items exist with the table's watts in `Security`; both dictionaries translate `Security`, the new items and the new ui keys (existing i18n completeness tests cover keys); an AC grouping helper returns inverter sizes then conventional sizes, ascending.
- E2E: in *Security*, add CCTV camera, type 32, blur → footer shows 32 more appliances and the running load rises by 224 W; the *Air conditioning* filter shows the "Inverter" header before "Conventional", with "1 ton · 12k BTU" under each.
