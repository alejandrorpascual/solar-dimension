# QA v1 · issue 182 · head 6e15eaf

- typecheck (app, e2e, scripts): clean. Both `@ts-expect-error` lines in `src/lib/kit-checks.test.ts:515,517` are used, so the compiler refuses a call without the chemistry.
- `npm run test:coverage`: 138 files, 2166 tests passed.
- `npm run build`: ok.
- Mutation: ignoring the kit's chemistry in `warningText` turns 2 tests red (`kit-checks.test.ts` AGM continuous/peak/fuse case and the new AGM case); restored, green.
- No UI change, so no screenshots.
