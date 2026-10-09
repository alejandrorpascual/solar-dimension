# Saved clients and a form that keeps its draft

Design canvas: https://claude.ai/artifact/BeJLsUPHGca4jHmUbvWMTy. This combines B's draft autosave and resume banner (boards B2) with A's saved-clients list (board A1).

## The problems

1. **Closing the form loses the typing.** `RequesterSheet` keeps the draft in React state. Tapping outside, X or Escape closes the dialog and the draft is gone.
2. **Only one client is remembered.** "Use these details in my other projects" keeps the last saved requester in `localStorage`. People who make sheets for several clients retype them every time.

## What it does

### The Download panel card

- No requester: unchanged, "Añadir solicitante / Add client details".
- Requester set: the card's button reads **Cambiar / Change** (aria-label "Change: {name}") instead of Edit.

Either button opens the sheet. Where it starts:

1. A draft kept for this project → **the form**, with the resume banner.
2. Otherwise, saved clients exist → **the list**.
3. Otherwise → **the form**: the project's requester, or a blank one.

### The list: "¿Para quién es la ficha? / Who is this spec sheet for?"

- Help line: "Tus clientes guardados. Elige uno y sus datos salen en el PDF."
- A radio group, "Clientes guardados / Saved clients". Each row shows initials, the name, and the ID · phone line the card already uses, with an edit (pencil) button labelled "Editar: {name}". Rows are ordered most recently used first.
- If the project's requester matches none of the saved clients, it gets a first row tagged **"Solo en este proyecto / Only in this project"**.
- The row for the project's requester starts selected.
- **Nuevo cliente / New client** opens a blank form.
- Primary: **Usar en la ficha / Use on the sheet**. It puts the chosen client on the project, marks the client as just used, and closes. It's disabled until a row is chosen.
- When the project has a requester: a text button, **Quitar de la ficha / Remove from the sheet**.

### The form

Same fields and validation as today, plus:

- **Back to the list:** when saved clients exist, a back button, "‹ Mis clientes / My clients". Going back drops the draft, since it is a deliberate step.
- **Resume banner:** when the form opens from a kept draft, it shows **"Seguimos donde lo dejaste / Picking up where you left off"**, "Cerraste el formulario sin guardar. Lo que escribiste sigue aquí.", and **Empezar de cero / Start over**. Start over drops the draft and resets the fields to what the form started from.
- **Draft indicator:** while the fields differ from where they started, a quiet line under the title reads "Borrador guardado en este dispositivo / Draft saved on this device".
- **Checkbox "Guardar en mis clientes / Save to my clients",** on by default, for a new client or the project's own requester. It replaces "Use these details in my other projects".
- **Editing a saved client** (the pencil): there's no checkbox, because Save updates that client. Save goes back to the list with that client selected; it doesn't put it on the project by itself. A text button, **Eliminar de mis clientes / Delete from my clients**, removes the client and goes back to the list. The project keeps its own copy.
- **New client, or the project's requester:** Save puts the requester on the project and closes. With the box ticked, it's also added to the saved clients, or updates the one it matches.
- **Quitar / Remove** stays for the project's own requester.

## Decisions

- **Saved clients live in this browser, per account.** The key is `solar-dimension.clients.v1:{accountId|guest}`, so a shared browser never shows one account's clients to another. Each entry is `{ id, requester, usedAt }`, read leniently: invalid entries are dropped, not the whole list. There are at most 50; the least recently used goes first. Syncing clients to the account is left for later (see Out of scope). It would need a table, a migration and a signed-out→signed-in merge, and the per-device copy already shipped with PR #8.
- **The old remembered requester moves over.** If an account has no list yet, the requester remembered under `solar-dimension.requester.v1` for the same owner shows as its first client. The old key is deleted the first time the list is written.
- **One draft slot.** `solar-dimension.requester-draft.v1` holds `{ owner, projectId, target, draft }`. `target` is `new`, `project` or `{ client: id }`. It is written on every change that leaves the fields different from where they started. It is cleared when they match again, and on Save, Start over, Back and Delete. It's offered back only to the same owner on the same project. A draft for a deleted client opens as a new client. Typing in another project's form replaces it. The draft is parsed with a lenient schema: same fields and length caps, no required name, no ID checks.
- **Matching a client** (`isSameClient`): the same kind and country, then the same ID (letter and digits) when both have one; otherwise the same name, ignoring case, accents and extra spaces. Saving a new client that matches an existing one updates it rather than adding a duplicate.
- **Pure logic in `src/lib`.** `saved-clients.ts` covers matching, upsert, delete, ordering and the cap. `requester-draft.ts` covers the draft's schema, target and dirty check. `persistence.ts` reads and writes both keys, swallowing storage errors like the other keys. The components only wire these together.
- **Components:**
  - `RequesterSheet` owns the view (`list | form`) and the dialog.
  - `ClientList` is new.
  - `RequesterForm` moves to its own file.
  - Everything keeps reusing `.qdialog` and the `rq-*` styles.
- **Privacy page:** it says saved clients and an unsaved form stay in this browser.

## Out of scope

- Syncing saved clients to the account across devices.
- Searching the list (the cap is 50 and rows are short).
- Undo for Delete.
- Showing the draft in the list (A2's amber card). The form opens on the draft instead.
