# Requester details on the spec sheet (variant B)

Design canvas: https://claude.ai/artifact/85pxKokpPDZ3GDQUQ5ug9U, board "B · Tarjeta + hoja con los datos".

## What it does

The Download panel gets a **Solicitante / Client** section between the sheet preview and Format:

- No requester yet: a dashed button, "Añadir solicitante / Add client details", with the hint "Nombre, documento y teléfono para la ficha".
- Requester saved: a card with initials, the name, "RIF J-40123456-7 · +58 414 555 0192" (or the kind, when there's no ID), and an **Editar / Edit** button.

Either button opens a dialog (a bottom sheet on phones) titled **Datos del solicitante / Client details**:

1. Persona / Empresa toggle (Individual / Company).
2. País: Venezuela, Estados Unidos, Otro país. The default is Venezuela in Spanish and the United States in English.
3. Name: "Nombre y apellido" for a person, "Razón social" for a company.
4. Persona de contacto (company only, optional).
5. ID, by country:
   - **Venezuela, person:** Cédula. Letter V or E plus 5–9 digits. Printed `C.I. V-18.456.789`.
   - **Venezuela, company:** RIF. Letter J, G, C or V plus 8 digits and a check digit. Printed `RIF J-40123456-7`.
   - **United States, person:** no ID field. A note explains none is needed.
   - **United States, company:** EIN, optional, 9 digits. Printed `EIN 12-3456789`.
   - **Other country:** free text, optional ("Documento de identidad" or "Registro fiscal").
   - Pasting the letter with the number ("J-40123456-7") moves the letter into the letter picker.
6. Teléfono, Correo (optional), Dirección de la instalación (optional).
7. A checkbox, on by default: **"Usar estos datos en mis otros proyectos"**.
8. **Guardar** (Save), plus **Quitar** (Remove) when the project already has a requester.

Only the name is required. Errors show after the first Save attempt, then update live as you type. Nothing reaches the project until Save. Closing the dialog or pressing Escape discards the draft.

**On the PDF / PNG:** a "Datos del solicitante" band sits under the header, before the summary figures. On the right of its heading is "Empresa · Venezuela". Below is a 3-column grid of label/value cells on a light fill:

- Name: 2 columns wide.
- ID, contact person, phone, email: 1 column each.
- Address: the full width.

Cells the requester left blank are left out. A new Include checkbox, "Datos del solicitante", takes the band off the sheet. Like Summary figures, it's disabled for CSV.

## Decisions

- **Stored on the project.** A nullable `requester` on `Project` syncs to the account with the rest of the project, through a new nullable `jsonb` column on `projects`. Duplicating a project copies its requester; a new project starts with none.
- **"Use in my other projects" is per device and per account.** It writes the last saved requester to `localStorage` (`solar-dimension.requester.v1`) along with its owner (the account id, or null signed out), and only offers it back to that owner, so another account on a shared browser never sees it. It never applies itself: it only fills the form when a project that has no requester opens it. Unticking the box and saving forgets it.
- **Tolerant parsing.** A requester that fails validation when the store loads becomes `null` (`.catch(null)`), so one bad field never drops every saved project.
- **Native `<select>` for country and ID letter.** These are 3–4 option lists with nothing to compare, and the dialog may already sit over the phone rail sheet. The OS picker avoids a third layered popover. The grouped react-aria Select preference applies to option lists people compare (battery sizes).
- **The dialog reuses the `.qdialog` styles.** It is centered on desktop and a bottom sheet on phones, and its z-index of 60 sits above the rail sheet's 50.
- **Privacy:** the privacy page lists the requester details as stored data, and says the "use in other projects" copy stays in this browser.

## Out of scope

- The requester in the CSV.
- A per-account address book.
- Showing the requester on project cards.
- Validating Venezuelan RIF check digits.

## Accepted risk

During a deploy, a tab still running the old bundle can save a project and wipe its requester. The upsert writes `requester = excluded.requester`, and the old client sends none. This is the same last-write-wins rule every other project field already follows, and the stale-chunk auto-reload shortens the window.
