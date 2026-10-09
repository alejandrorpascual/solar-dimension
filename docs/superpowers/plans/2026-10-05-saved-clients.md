# Saved clients and draft autosave: plan

Spec: `docs/superpowers/specs/2026-10-05-saved-clients-design.md`.

Each task runs test-first: write the failing test, run it red, implement, run it green.

1. **`src/lib/saved-clients.ts`**
   - `SavedClient`
   - `isSameClient`
   - `upsertClient` (by id, else by match, else append; capped at 50)
   - `removeClient`
   - `touchClient`
   - `byRecent`
   - `matchingClient`
   - Tests: `saved-clients.test.ts`.
2. **`src/lib/requester-draft.ts`**
   - `RequesterDraftSchema`, the lenient form of the requester schema
   - `DraftTarget`
   - `StoredDraftSchema`
   - `isDirty(draft, base)`
   - `resumableDraft(stored, owner, projectId)`
   - Tests: `requester-draft.test.ts`.
3. **`src/lib/persistence.ts`**
   - `loadSavedClients` / `saveSavedClients`: per-owner key, lenient entries, legacy `requester.v1` fallback, legacy key removed on write.
   - `loadRequesterDraft` / `saveRequesterDraft` / `clearRequesterDraft`.
   - Drop `rememberRequester`, `forgetRequester` and `loadRememberedRequester`.
   - Tests: `persistence.test.ts`.
4. **i18n:** new `requester` keys in EN and ES, and the privacy paragraph in both.
5. **Components**
   - `RequesterForm.tsx`: moved out of the sheet; draft autosave, resume banner, indicator, checkbox, Delete, Back.
   - `ClientList.tsx`.
   - `RequesterSheet.tsx`: view state and wiring.
   - `RequesterCard`: Change.
   - `DownloadPanel`: pass `projectId`.
   - CSS in `rail.css`.
6. **e2e** (`e2e/requester.spec.ts`):
   - Update the labels.
   - Replace the "other projects" test with picking a saved client.
   - Add a test that a closed form keeps its draft and Start over clears it.
7. **Verify:** `npm run typecheck`, `npm test`, the requester e2e tests, then a look in the browser at phone width.
