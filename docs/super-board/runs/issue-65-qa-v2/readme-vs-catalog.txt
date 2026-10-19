README "Assumed ratings" bullet against src/lib/catalog.ts at 7f01987872a7b2d8f6144d24ac413ee39dbd4033
Rerun: node_modules/.bin/tsx docs/super-board/runs/issue-65-qa-v2/harness/catalog-dump.mts "$PWD"
README.md and src/ are unchanged since v1 (git diff 789771f 7f01987 -- README.md src: empty).
The dump below matches runs/issue-65-qa-v1/readme-vs-catalog.md row for row (diff: empty).

| Chemistry | Unit | Continuous A | Peak A | Peak s | Max parallel | Short circuit A/Ah | Unit override A |
| LiFePO₄ | 12 V 100 Ah | 100 | 200 | 5 | 4 | 25 | - |
| LiFePO₄ | 12 V 200 Ah | 200 | 400 | 5 | 4 | 25 | - |
| LiFePO₄ | 12 V 300 Ah | 200 | 400 | 5 | 4 | 25 | - |
| LiFePO₄ | 12 V 400 Ah | 250 | 500 | 5 | 4 | 25 | - |
| LiFePO₄ | 24 V 100 Ah | 100 | 200 | 5 | 4 | 25 | - |
| LiFePO₄ | 24 V 200 Ah | 200 | 400 | 5 | 4 | 25 | - |
| LiFePO₄ | 48 V 50 Ah | 50 | 100 | 5 | 8 | 25 | - |
| LiFePO₄ | 48 V 100 Ah | 100 | 200 | 5 | 16 | 25 | - |
| LiFePO₄ | 48 V 200 Ah | 200 | 400 | 5 | 16 | 25 | - |
| LiFePO₄ | 48 V 280 Ah | 200 | 400 | 5 | 16 | 25 | - |
| LiFePO₄ | 48 V 300 Ah | 200 | 400 | 5 | 16 | 25 | - |
| LiFePO₄ | 48 V 314 Ah | 200 | 400 | 5 | 16 | 25 | - |
| AGM | 6 V 225 Ah | 68 | 225 | 5 | 4 | 12 | - |
| AGM | 12 V 100 Ah | 30 | 100 | 5 | 4 | 12 | - |
| AGM | 12 V 200 Ah | 60 | 200 | 5 | 4 | 12 | - |
| W | Surge W | Surge s | Long surge | Max parallel |
| 1000 | 2000 | 3 | - | - |
| 1500 | 3000 | 3 | - | - |
| 2000 | 4000 | 3 | - | - |
| 3000 | 6000 | 5 | 4500 W for 30 s | 3 |
| 4000 | 8000 | 5 | 6000 W for 30 s | 3 |
| 5000 | 10000 | 5 | 7500 W for 30 s | 3 |
| 6000 | 12000 | 10 | 9000 W for 30 s | 3 |
| 8000 | 16000 | 10 | 12000 W for 30 s | 3 |
| 10000 | 20000 | 10 | 15000 W for 30 s | 3 |
| 12000 | 24000 | 10 | 18000 W for 30 s | 3 |

README line, read against the dump:
74:- **Assumed ratings:** the battery and inverter ratings in `src/lib/catalog.ts` are generic, not a maker's datasheet. The checks that rest on them say "assumed", and the fine print lists the ones each kit was sized with. LiFePO₄ units give a continuous current of 100 A at 100 Ah, 200 A from 200 to 314 Ah, 250 A for the 12 V 400 Ah and 50 A for the 48 V 50 Ah, and twice that as a peak for 5 s; at most 4 work in parallel, 8 of the 48 V 50 Ah and 16 of the larger 48 V units. AGM units give 0.3C continuous and 1C peak for 5 s, at most 4 in parallel. A shorted unit delivers 25 A per Ah (LiFePO₄) or 12 A per Ah (AGM). Inverters surge to twice their rating for 3 s up to 2 kW, 5 s up to 5 kW and 10 s above, and from 3 kW also hold 1.5× for 30 s. Inverter sizes are continuous watts, not VA, at room temperature; the 25% headroom covers power factor and heat.
