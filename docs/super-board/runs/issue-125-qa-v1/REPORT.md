# QA #125 v1 (head a72153d)

Verify: `npm ci && npm run typecheck && npm run test:coverage -- --testTimeout=60000 && npm run build`, 135 files / 2158 tests pass, 90.4% lines, build ok.
The default 5 s timeout failed 4 heavy matrix tests (auth, kit-conductors x2, solar panel matrix) at load average 85; they are timeouts, not assertions.

Mutants (`mutants.txt`): 7 of 7 killed. The PR #14 spare and chart-limit regressions, the cloudy share, the bar fill, and kit-checks recomputing start-up amps (total and per run) all fail a new test.

Printed text, base 75840c1 vs head (`figures-base-75840c1.json` vs `figures.json`): identical for the solar flow at 5, 2 and 12 panels (en, es) and the kit checks (en, es).
