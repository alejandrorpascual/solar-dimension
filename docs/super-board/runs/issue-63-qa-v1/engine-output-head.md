# Issue #63 QA probe: engine output

## AC2 · 1,500 W load at 12 V, default 1.5 m run (2 kW inverter)
inverter 1 x 2000 W · runs 2 · gauge 1/0 AWG · drop 0.8% · start-up 0.6% · warnings [dominantLoad]
EN main cable row: 1/0 AWG (53.5 mm²) copper, 1.5 m each | qty 4 | Battery to inverter · 116 A design current per run · 150 A after derating · 0.8% drop, 0.6% at start-up · Equal length, identical lugs
ES main cable row: 1/0 AWG (53.5 mm²) de cobre, 1.5 m cada uno | qty 4 | De batería a inversor · 116 A de corriente de diseño por tramo · 150 A tras la corrección · 0.8% de caída, 0.6% al arrancar · Mismo largo y terminales idénticos
EN Cable check: pass · 2 × 1/0 AWG carries 150 A after derating (30 °C) for a 116 A design current per run · 0.8% drop, 0.6% at start-up
ES Cable check: pass · 2 × 1/0 AWG soporta 150 A tras la corrección (30 °C) para 116 A de diseño por tramo · 0.8% de caída, 0.6% al arrancar

## AC3 · 2,000 W load at 12 V, 10 m run (3 kW inverter)
inverter 1 x 3000 W · runs 2 · gauge 4/0 AWG · drop 3.7% · start-up 2.5% · warnings [dominantLoad, cableDrop]
EN main cable row: 4/0 AWG (107.2 mm²) copper, 10 m each | qty 4 | Battery to inverter · 174 A design current per run · 230 A after derating · 3.7% drop, 2.5% at start-up · Equal length, identical lugs
ES main cable row: 4/0 AWG (107.2 mm²) de cobre, 10 m cada uno | qty 4 | De batería a inversor · 174 A de corriente de diseño por tramo · 230 A tras la corrección · 3.7% de caída, 2.5% al arrancar · Mismo largo y terminales idénticos
EN Cable check: warn · The cable drops 3.7% at full load, more than the 3% it is sized for, even on the largest gauge. Shorten the run or pick a higher bank voltage.
ES Cable check: warn · El cable cae 3.7% a plena carga, más del 3% previsto, aun con el calibre más grueso. Acorta el tramo o elige un voltaje de banco mayor.

## AC3 back · 2,000 W load at 12 V, 1.5 m run
inverter 1 x 3000 W · runs 2 · gauge 2/0 AWG · drop 0.9% · start-up 0.6% · warnings [dominantLoad]
EN main cable row: 2/0 AWG (67.4 mm²) copper, 1.5 m each | qty 4 | Battery to inverter · 174 A design current per run · 175 A after derating · 0.9% drop, 0.6% at start-up · Equal length, identical lugs
ES main cable row: 2/0 AWG (67.4 mm²) de cobre, 1.5 m cada uno | qty 4 | De batería a inversor · 174 A de corriente de diseño por tramo · 175 A tras la corrección · 0.9% de caída, 0.6% al arrancar · Mismo largo y terminales idénticos
EN Cable check: pass · 2 × 2/0 AWG carries 175 A after derating (30 °C) for a 174 A design current per run · 0.9% drop, 0.6% at start-up
ES Cable check: pass · 2 × 2/0 AWG soporta 175 A tras la corrección (30 °C) para 174 A de diseño por tramo · 0.9% de caída, 0.6% al arrancar

## Issue example · 12 V, 4 kW inverter, 10 m run
inverter 1 x 4000 W · runs 3 · gauge 4/0 AWG · drop 3.3% · start-up 2.4% · warnings [inverterVoltage, highCurrent, dominantLoad, cableDrop]
EN main cable row: 4/0 AWG (107.2 mm²) copper, 10 m each | qty 6 | Battery to inverter · 154 A design current per run · 230 A after derating · 3.3% drop, 2.4% at start-up · Equal length, identical lugs
ES main cable row: 4/0 AWG (107.2 mm²) de cobre, 10 m cada uno | qty 6 | De batería a inversor · 154 A de corriente de diseño por tramo · 230 A tras la corrección · 3.3% de caída, 2.4% al arrancar · Mismo largo y terminales idénticos
EN Cable check: warn · 370 A on the DC side at 12 V is hard to wire safely. Consider 24 V. / The cable drops 3.3% at full load, more than the 3% it is sized for, even on the largest gauge. Shorten the run or pick a higher bank voltage.
ES Cable check: warn · 370 A en el lado de CC a 12 V es difícil de cablear con seguridad. Considera 24 V. / El cable cae 3.3% a plena carga, más del 3% previsto, aun con el calibre más grueso. Acorta el tramo o elige un voltaje de banco mayor.

## Single run · default 48 V kit
inverter 1 x 3000 W · runs 1 · gauge 2 AWG · drop 0.2% · start-up 0.1% · warnings []
EN main cable row: 2 AWG (33.6 mm²) copper, 1.5 m each | qty 2 | Battery to inverter · 87 A design current · 115 A after derating · 0.2% drop, 0.1% at start-up
ES main cable row: 2 AWG (33.6 mm²) de cobre, 1.5 m cada uno | qty 2 | De batería a inversor · 87 A de corriente de diseño · 115 A tras la corrección · 0.2% de caída, 0.1% al arrancar
EN Cable check: pass · 2 AWG carries 115 A after derating (30 °C) for a 87 A design current · 0.2% drop, 0.1% at start-up
ES Cable check: pass · 2 AWG soporta 115 A tras la corrección (30 °C) para 87 A de diseño · 0.2% de caída, 0.1% al arrancar

## AC1 independent sweep (250 W steps × 12/24/48 V × -10/30/40/50 °C × 75/90 °C × open/bundled × 1.5/5/10 m)
kits 27648 · more than one run per inverter 25482 · of those with 2+ inverters 20352 · under 1/0 AWG 0
12 V 9750 W 2 inv 10 runs 3/0 AWG
12 V 9750 W 2 inv 10 runs 3/0 AWG
12 V 9750 W 2 inv 10 runs 4/0 AWG
12 V 9750 W 2 inv 12 runs 4/0 AWG
12 V 9750 W 2 inv 12 runs 4/0 AWG
