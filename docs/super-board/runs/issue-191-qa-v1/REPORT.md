# Issue 191 QA v1
- e2e kit-builder chips/presets at 360 and 390 px, desktop + phone projects: 4/4 pass
- Same spec against base CSS (origin/main): 2/2 phone fail ("category chips hidden past the right edge")
- typecheck pass, build pass; test:coverage 2146/2149, 3 timeouts in solar.test.ts and kit-conductors.test.ts under load, 44/44 pass rerun alone
- Screenshots: 360/390/1440 px, steps 1 and 2
