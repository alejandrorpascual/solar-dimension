// Prints the battery and inverter ratings in a checkout's src/lib/catalog.ts as the README table rows.
const root = process.argv[2]
const { CHEMISTRIES, INVERTERS } = await import(`${root}/src/lib/catalog.ts`)
const name: Record<string, string> = { lifepo4: 'LiFePO₄', agm: 'AGM' }
console.log('| Chemistry | Unit | Continuous A | Peak A | Peak s | Max parallel | Short circuit A/Ah | Unit override A |')
for (const [id, c] of Object.entries<any>(CHEMISTRIES)) for (const u of c.units)
  console.log(`| ${name[id] ?? id} | ${u.v} V ${u.ah} Ah | ${u.maxContinuousA} | ${u.peakA} | ${u.peakSeconds} | ${u.maxParallel} | ${c.shortCircuitPerAh} | ${u.shortCircuitA ?? '-'} |`)
console.log('| W | Surge W | Surge s | Long surge | Max parallel |')
for (const i of INVERTERS) console.log(`| ${i.w} | ${i.surge} | ${i.surgeSeconds} | ${i.surgeLong ? `${i.surgeLong.w} W for ${i.surgeLong.seconds} s` : '-'} | ${i.maxParallel ?? '-'} |`)
