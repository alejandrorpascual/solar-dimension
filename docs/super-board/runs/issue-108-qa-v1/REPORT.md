# QA v1 · issue #108 · head 222fa99

| Check | Command | Result |
|---|---|---|
| Verify | `npm ci && npm run typecheck && npm run test:coverage && npm run build` | exit 0 · 136 files, 2167 tests · lines 90.2% |
| DB tests | `npx vitest run --config vitest.db.config.ts src/server/product-repo.db.test.ts` | 8/8 on the test branch |
| Migrations | `scripts/migrate.ts --check` (test branch) | all 19 applied, 0018 included |
| E2E | `E2E_PORT=3460 npx playwright test e2e/admin.spec.ts e2e/catalog-products.spec.ts --project=desktop` | 20/20 |

QA added two e2e tests in `e2e/admin.spec.ts`: an unchanged token write keeps a product verified and the token cannot set the verification fields (422), and a Verify from a page loaded before a token edit shows the reload error and leaves the product unverified. Each one failed against a broken copy of the code first (all keys unverified, the `updated_at` guard removed, the strict schema loosened) and passed once the code was restored.

Screenshots: the admin page at 1920, 1024 and 375 px wide, with row crops, for AC1 (unverified), AC2 (verified, with email and UTC time), AC3 (unverified again after a token edit) and the stale-verify error.
