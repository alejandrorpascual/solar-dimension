# super-board pre-flight · Solar Dimension (#1)

Written by `super-board lint` on 16 Oct 2026, 18:15 America/Caracas, against `staging` 320ae18.
Config: `.claude/super-board/configs/solar-dimension.json`. Each `[ ]` below is a halt gate for
`super-board run`. Bullets without a box are information, not gates.

## 🔑 Credentials the loop will need

- [✓] Test database: `DATABASE_URL` is set in the main checkout's `.env.test.local` (key name only), and `scripts/migrate.ts --check` reports all 15 migrations on the e2e Neon branch
- [✓] E2E auth: `playwright.config.ts` sets the auth secret, dummy Google credentials, `ADMIN_EMAILS` and the stub quote model inline; no other key is needed
- [✓] Quote reader cards (#49, #57, #58, #97) run on the stub model: no `OPENAI_API_KEY` needed in CI or e2e
- [✓] Catalog cards (#103–#108) test the token API with the e2e servers' own token (`e2e/catalog-token.ts`); no production token is used
- [✓] GitHub: the active `gh` account is `alejandrorpascual-bot` (scopes `project`, `repo`, `workflow`)

## 🛠 Tools the loop will need

- [✓] `gh` 2.89.0 authenticated (verified)
- [✓] Node 24.15.0 (CI pins Node 24)
- [✓] Playwright 1.63.0 with Chromium 1243 installed
- [✓] `super-board-verification-ready.py` exits 0 for the config
- [✓] Wave script `.claude/workflows/super-board-wave.js` passes `node --check`

## 🌐 Environment

- [✓] No GitHub read halt (`.claude/super-board/github-halt.json` absent in the main checkout)
- [✓] No orphan workers, no legacy `.worktrees/issue-*`, no `.claude/worktrees/issue-*`, no wave lock
- [✓] Board shape: Backlog · Ready · Building · QA · Review · Blocked · Done all present; 39 Ready cards linted
- [✓] GraphQL budget: 4,710 of 5,000 left at 22:15Z (resets 22:17Z)
- [✓] Start the run from a clean checkout on `staging`: the worktree `.claude/worktrees/determined-jang-9e5404` is on `staging`, tracking `origin/staging`, with this file committed. Don't start it from the main checkout, which is on `main` with uncommitted changes

## 🙋 Human steps the loop will hand you (not gates)

- #58: a `needs-you` line to confirm the 300 s function duration on the Vercel plan, and whether the cron log shows 401s
- #89: a `needs-you` line to check PDF, PNG, CSV and Share in iOS Simulator Safari
- #90: a `needs-you` line to open the CSV in Excel with Spanish (Venezuela) regional settings
- #101: a `needs-you` line to set the Vercel project's Node version to 24.x
- Migrations: #105, #107 and #108 will add tables or columns. They are additive, so the robot migrates the test database. `staging` uses `-` (the deploy pipeline applies it). Preview builds skip `db:migrate` on the production database, so a staging preview can run on an older schema until `main` is promoted
- Merges routed to you by `merge_policy`: any PR touching the session read (`src/server/session.ts`, `src/lib/auth*`), which is likely for #92, and any PR over 400 changed lines
- #97 and #108 add admin pages, so each PR updates PROJECT.md §7 (approved in lint)

## Notes for the first wave

- Blocked cards #50–#56 list PR #38 as their blocker. #38 merged, so the wave-start sweep should move them back to Ready. They were not linted here (lint skips Blocked); lint them before they build.
- #63 stays Blocked by #60. #60's matrix now checks only the default cable conditions, so the two no longer wait on each other.
