import type { ConductorKind, WarningParams } from '../lib/sizing'
import { hasBms, isInverterSet as isSet } from '../lib/sizing/warnings'
import type { Dictionary } from './types'
import { quoteItemsEn, quoteItemsInlineEn, quoteItemsListEn, quoteItemsShortEn, quotesEn } from './quotes-en'
import { requesterEn } from './requester-en'

/** What a bank with no BMS (AGM) does past its rating, said where a lithium bank's BMS would cut out. */
const NO_BMS = 'its voltage may sag enough to trip the inverter'

/** The cable rows as a warning names them mid-sentence. */
const CONDUCTORS: Record<ConductorKind, string> = { mainCable: 'main cable', interconnects: 'interconnects', stringLeads: 'string leads' }

/** The fuse as a warning names it: bare on the main run, with its cable when it sits on a string lead. */
const fuseOn = (p: WarningParams): string => (p.conductor === 'stringLeads' ? 'fuse on the string lead' : 'fuse')

/** What to do about a cable row that falls short: only the ways out the engine says would work for it, ending with the one that always does. */
function cableRemedy(p: WarningParams): string {
  const ways = [
    ...(p.canCool ? ['move the bank somewhere cooler'] : []),
    ...(p.canRaiseInsulation ? ['use 90 °C cable'] : []),
    ...(p.nextVolts ? [`raise the voltage to ${p.nextVolts} V`] : []),
    'trim the load',
  ]
  const list = ways.length > 1 ? `${ways.slice(0, -1).join(', ')} or ${ways[ways.length - 1]}` : ways[0]!
  return `${list[0]!.toUpperCase()}${list.slice(1)}.`
}

export const en: Dictionary = {
  locale: 'en',
  ui: {
    siteDescription: 'Size an off-grid solar backup kit: pick the appliances to keep on, set the hours, and get the inverter, batteries, cables and parts list.',
    step1: 'Appliances', step2: 'Backup window', step3: 'Solar panels', step4: 'Your kit', stepOf: 'Step {n} of 4',
    project: 'Project', projectName: 'Project name', newProject: '+ New project', duplicate: 'Duplicate', delete: 'Delete', untitled: 'Untitled',
    firstProject: 'Home', projectNumbered: 'Project {n}', copySuffix: ' copy', customTag: 'Custom',
    deleteProject: "Delete “{name}”? This can't be undone.",
    deleteProjectOne: "Delete “{name}” and its 1 quote? Its file goes too. This can't be undone.",
    deleteProjectMany: "Delete “{name}” and its {count} quotes? Their files go too. This can't be undone.",
    deleteProjectAny: "Delete “{name}” and any quotes it has? Their files go too. This can't be undone.",
    deleteProjectYes: 'Delete project',
    acInverter: 'Inverter air conditioning', acInverterHelp: 'Soft start. Easy on the inverter.', acConventional: 'Conventional air conditioning', acConventionalHelp: 'Starts at ~3× its running power. Needs a bigger inverter.', acSizeOne: '{tons} ton · {btu}k BTU', acSizeMany: '{tons} ton · {btu}k BTU',
    q1: 'Which appliances need to stay on?', q1Help: 'Add each one and set how many. Running watts drive the battery, surge watts drive the inverter.',
    search: 'Search appliances', nothingMatches: 'Nothing matches. Try another word or add it below.', sectionAdded: '{count} added',
    add: 'Add', addOne: 'Add {name}', qtyOf: 'Quantity of {name}', removeOne: 'Remove one {name}', remove: 'Remove {name}',
    running: 'running', surge: 'surge', runningSurgeLine: '{watts} W running · {surge} surge', splitPhase: 'Needs a 240 V / split-phase inverter', checkNameplate240: 'Check the nameplate for 240 V',
    customTitle: 'Something not on the list?', customHelp: 'Type the watts from the label, or the volts and amps and we multiply them.',
    watts: 'Watts', voltsAmps: 'Volts × amps', name: 'Name', runningW: 'Running W', volts: 'Volts', amps: 'Amps', surgeOptional: 'Surge W (optional)', sameAsRunning: 'same as running', dutyPctLabel: 'Runs % of each hour', addAppliance: 'Add appliance',
    errName: 'Give the appliance a name.', errNameLong: 'Keep the name to {max} characters or fewer.', errVa: 'Enter volts and amps that make 1 to {maxW} watts.', errWatts: 'Enter 1 to {maxW} running watts.', errSurge: 'Surge must be from the running watts up to {maxSurge} W.',
    errThousands: 'Write watts as a whole number with no separator: 1500, not 1.500 or 1,500.',
    errDuty: 'Enter how much of each hour it runs, from {min} to 100%. Leave it empty if it never stops.',
    customUnreadOne: '1 custom appliance in this project could not be loaded, so the kit leaves it out. Add it again below, then remove the one that did not load.',
    customUnreadMany: '{count} custom appliances in this project could not be loaded, so the kit leaves them out. Add them again below, then remove the ones that did not load.',
    customUnreadClearOne: 'Remove the one that did not load', customUnreadClearMany: 'Remove the ones that did not load',
    q2: 'How long should the backup last?', q2Help: 'The bank is sized for this many hours of your selected load, at the voltage you pick. Every appliance counts in every hour of the window.',
    hoursLabel: 'Hours without the grid', step2Empty: 'Go back and add at least one appliance.',
    step2Summary: 'Your {count} appliances draw {running} and use about {load} over {hours} hours. We size the bank to {need} after inverter losses and depth of discharge.',
    batteryVoltage: 'Battery voltage', batteryChemistry: 'Battery chemistry', usableCapacity: '{pct}% usable capacity',
    fewInvertersNote: 'Few inverters are sold for {volts} V, so most kits come out oversized: a larger inverter than the load needs, and a bank big enough to carry its current.',
    kitFor: 'Kit for {name}', kitEmpty: 'Add appliances first.', kitSummary: 'Backs up {count} appliances for {hours} hours on a {volts} V {chemistry} bank.',
    editAppliances: 'Edit appliances', editWindow: 'Edit window',
    runningLoad: 'Running load', averageDraw: '~{w} average', startupPeak: 'Start-up peak', batteryNeeded: 'Battery needed', runtime: 'Runtime',
    part: 'Part', specification: 'Specification', quantity: 'Quantity', nothingSelected: '{name} has nothing selected yet.',
    inverterSpec: '{w} continuous, not VA, pure sine, {volts} V DC input{output}', splitPhaseOutput: ', 120/240 V split-phase output', inverterNote: '{surge} · covers {running} running, {peak} peak',
    inverterNoteTight: '{surge} · {running} running leaves {pct}% headroom, {peak} peak', inverterNoteUnder: '{surge} · smaller than the {running} running load',
    inverterNotePeak: '{surge} · covers {running} running, not the {peak} peak',
    inverterNoteTightPeak: '{surge} · {running} running leaves {pct}% headroom, {peak} peak not covered',
    inverterSurge: '{surge} surge', inverterSurgeSet: '{surge} surge together',
    inverterParallelNote: '{count} in parallel work as one {total} inverter, drawing up to {amps} A from the bus bars',
    batteriesNote: '{series} in series × {parallel} in parallel ({config}) · {bank} bank, {usable} usable',
    mainCableSpec: '{gauge} ({mm2} mm²) copper, {length} m each', mainCableNote: 'Battery to inverter · {amps} A design current{perRun} · {ampacity} A after derating · {runDrop}% drop, {drop}% at start-up',
    mainCableParallelNote: 'Equal length, identical lugs',
    interconnectsSpec: '{gauge} jumpers, {cm} cm each',
    seriesLinksNote: 'Between batteries in series · {amps} A design current · {ampacity} A after derating',
    seriesLinksSharedNote: 'Between batteries in series · {each} identical jumpers side by side at every link · {amps} A design current each · {ampacity} A after derating',
    stringLeadsSpec: '{gauge} ({mm2} mm²) copper, {cm} cm each',
    stringLeadsNote: 'A positive and a negative from each string to the bus bars (bus bars not listed) · {amps} A design current · {ampacity} A after derating',
    fuseSpec: '{amps} A class {class}{perRun}', fuseNote: 'Inline on the positive lead, as close to the bank as possible', perRun: ' per run', perInverter: ' per inverter', perRunOfInverter: ' per run, {n} runs to each inverter',
    fuseAicNote: '{aic} kA interrupting rating', stringFuseSpec: '{amps} A class {class}, one per parallel string', stringFuseNote: "On each string's positive lead, so a shorted string drops out alone",
    batteriesCurrentNote: '{cont} A continuous, {peak} A peak from the bank (assumed ratings)',
    batteriesForContinuous: '{parallel} in parallel for the continuous current; the energy alone needs {energy}',
    batteriesForPeak: '{parallel} in parallel for the peak current; the energy alone needs {energy}',
    batteriesForLead: "{parallel} in parallel so no string's leads carry more than they can; the energy alone needs {energy}",
    oversizeNote: 'This bank holds {ratio}× the {need} the load needs: it has to carry the full current of a {inverter} inverter. At {volts} V the kit would size a {bank} bank, the smallest that passes the same checks.',
    oversizeNoteSmallest: 'This bank holds {ratio}× the {need} the load needs: the kit cannot build a smaller bank at {kitVolts} V. At {volts} V the kit would size a {bank} bank, the smallest that passes the same checks.',
    batterySize: 'Battery size', batterySizeHelp: 'Pick the battery you plan to buy. Auto takes the size that passes the most checks, then the fewest batteries. When no size can feed the inverter, it takes the one that gives the most current.', batteryAuto: 'Auto',
    batteryRecommended: 'Best fit', batteryGroup: '{v} V batteries', batteryInSeries: '{n} in series', manyStrings: 'Many parallel strings',
    lowContinuous: 'Continuous current too low', lowPeak: 'Peak current too low',
    batteryCountOne: '{count} battery', batteryCountMany: '{count} batteries', panelCountOne: '{count} panel', panelCountMany: '{count} panels',
    inverterSizeOne: '{w} inverter', inverterSizeMany: '{count} × {w} inverters',
    legal: 'Legal',
    estimateNotice: 'An estimate for requesting quotes, not an installation design. Have a licensed electrician verify it against the actual equipment and your local electrical code before you buy or install anything.',
    fine: 'Every appliance counts in every hour of the window. Assumes {efficiency}% inverter efficiency, {headroom}% inverter headroom, {dod}% depth of discharge, {perTon} per ton of cooling, {starts}, copper cable with {insulation} °C insulation at {ambient} °C{bundled}. NEC ampacity tables; verify against local code. Inverter sizes are continuous watts, not VA, at room temperature; the {headroom}% headroom covers power factor and heat.',
    fineStartsOne: 'one motor starting at a time', fineStartsTwo: 'two motors starting together', fineStartsAll: 'every motor starting at once', fineBundled: ', bundled',
    fineAcDuty: ' Air conditioning runs {typical} of each hour on a typical day and {hard} on a hard day.',
    fineRatings: " Assumed ratings, not a maker's datasheet: each {battery} battery gives {cont} A continuous and {peak} A peak for {peakSeconds} s, at most {parallel} in parallel, and {shortCircuit} A per Ah into a short; each {inverter} inverter surges to {surge} for {surgeSeconds} s.",
    footer1: '{name} · {count} appliances · {running} running · {peak} peak', footer2: '{hours} h at {volts} V · {load} of load', footer3: '{batteries} · {inverter} · {gauge}', footerEmpty: 'Nothing selected yet',
    back: 'Back', next: 'Next: backup window', nextSolar: 'Next: solar panels', buildKit: 'Build my kit', startOver: 'Start over',
    continueGoogle: 'Continue with Google', orDivider: 'or', googleExists: 'This email already has an account. Sign in with your password, then connect Google from the account menu.', googleFailed: "Google sign-in didn't finish. Try again.", connectGoogle: 'Connect Google',
    signOutFailed: 'Could not sign out. You are still signed in. Try again.',
    signIn: 'Sign in', signUp: 'Create account', signOut: 'Sign out', email: 'Email', password: 'Password', noAccount: 'No account yet? Create one', haveAccount: 'Already have an account? Sign in', authFailed: 'That did not work. Check the email and password.', signedInAs: 'Signed in as {email}', syncing: 'Syncing your projects…', syncFailed: 'Could not save to your account. Changes are kept on this device.', language: 'Language',
    recoverAccess: "Forgot your password? We can't reset it here yet. Write to {email} and we'll help you get back in.",
    quotesNeedGoogle: 'Uploading quotes needs a Google account. An email account still saves your projects.',
    notFound: 'Page not found', backHome: 'Back to the kit builder', errorTitle: 'Something interrupted the kit builder.', serverError: 'Server error. Reference', reload: 'Reload', updating: 'Loading the latest version…',
    accountUnreachable: 'Could not reach your account. You can keep building the kit; changes stay on this page only.',
    projects: 'Projects', projectsCount: 'Projects · {count}', current: 'Current', quickEdit: 'Quick edit', done: 'Done',
    projectMeta: '{volts} V · {hours} h · {count} appliances', heaviestMore: '{list} and {count} more', bank: 'Bank', inverter: 'Inverter', close: 'Close',
    appliancesCount: 'Appliances · {count}', windowLabel: 'Window', hourLess: 'One hour less', hourMore: 'One hour more', hoursShort: '{hours} h',
    saved: 'Saved', undo: 'Undo', allAppliances: 'All appliances',
    addApplianceSearch: 'Add an appliance', noSearchMatch: 'Nothing matches. Find it under All appliances, or add your own there.',
    download: 'Download', downloadFor: 'Download {name}', format: 'Format', include: 'Include', preview: 'Preview of the file', previewOpen: 'View larger', previewTitle: 'Preview', previewPage: 'Page {page} of {pages}', previewImage: 'The whole sheet in one image',
    fmtPdf: 'Spec sheet (PDF)', fmtPdfHint: 'For the installer: parts list first, load schedule after.', fmtPng: 'Summary image (PNG)', fmtPngHint: 'The sheet as one image. Good for WhatsApp.',
    fmtCsv: 'Parts list (CSV)', fmtCsvHint: 'Opens in Excel. For a supplier quote. Uses the appliance and parts lists.',
    incSummary: 'Summary figures', incAppliances: 'Appliance list', incParts: 'Parts list', incNotes: 'Assumptions', incRequester: 'Client details',
    downloadPdf: 'Download PDF', downloadPng: 'Download image', downloadCsv: 'Download CSV', share: 'Share', making: 'Preparing the file…', downloadReady: 'File ready. Download started.',
    exportFailed: 'Could not create the file. Try again.',
    sheetAttention: 'Read before quoting', sheetAttentionChecks: 'Checks to resolve: {count}', sheetAttentionNotes: 'Notes: {count}', sheetNotes: 'Notes',
    sheetTitle: 'Backup kit · spec sheet', sheetEstimate: 'Estimate', date: 'Date', loadSchedule: 'Load schedule', appliance: 'Appliance', each: 'Each', overHours: 'Over {hours} h', total: 'Total', note: 'Note',
    eachW: 'Each (W)', runningWatts: 'Running (W)', whOver: 'Wh over {hours} h',
    q3: 'Do you have roof space for panels?', q3Help: 'Panels recharge the bank on sunny days; how much depends on the sun and your roof. You can skip this and keep a battery-only kit.',
    solarNo: 'No, batteries only', solarNoHelp: 'The bank refills from the grid or a generator', solarYes: 'Yes, add panels', solarYesHelp: 'Enter your roof space, then adjust the panels',
    solarSkipped: 'Fine. The kit stays as it is. You can come back to this step any time.',
    roofSpace: 'Roof space available', roofLess: 'Five square metres less', roofMore: 'Five square metres more', roofFitsOne: 'Fits {panels} with walkways.', roofFitsMany: 'Fits {panels} with walkways.', roofHint: 'Not sure? Pace it out: one panel is about a door on its side.',
    plannerLabel: 'Roof planner · tap to add or remove', plannerTile: '1 tile = one {w} panel', addPanel: 'Add panel {n}', removePanel: 'Remove panel {n}',
    panelsLine: '{panels} · {kw}', recommendedPill: 'Recommended · refills the bank in a day', recommendedPillLimited: 'Recommended · the most your roof fits', backToRecommended: 'Back to recommended · {n}',
    sunHours: 'Peak sun hours a day', sunHint: 'Caracas averages about 4.8 h. Go lower for a roof facing away from the sun or shaded by trees.',
    clearDay: 'On a clear day', flowSun: 'of peak sun', flowBank: '{volts} V bank · {batteries}', flowHome: '{count} appliances · {hours} h',
    coverHead: "Clear-day yield against a day's use", coverAxis: "a day's use · {use}",
    refillSameDay: 'Bank full after about {hours} of sun, with {spare} to spare.', refillDays: 'Bank refills over about {days} days of sun.', noPanelsYet: 'No panels yet. Tap the roof.',
    cloudyDay: 'Cloudy day (40%)', cloudyNote: "{wh}, about {pct}% of a day's use.",
    solarAssumptions: 'Assumes 75% efficiency from panel to battery and no shade at midday. Your kit gains panels, an MPPT charge controller with its cable and fuse to the battery, PV cable, a DC disconnect and mounting.',
    solarRecharge: 'Solar recharge', solarRechargeSub: '{wh} a clear day',
    footerSolar: '{hours} h at {volts} V · {load} of load · {panels}, {kw}', footerSolarNone: '{hours} h at {volts} V · {load} of load · no panels', footer4Solar: '{batteries} · {inverter} · {gauge} · {panels}',
    solarPanelsSpec: '{w} monocrystalline, {size}', solarPanelsNote: '{strings} · {kw} array · about {m2} m² with walkways',
    chargeControllerSpec: 'MPPT {amps} A · {voc} V max PV · {volts} V bank', chargeControllerNote: '{chargeA} A into the bank at full sun · {stringVoc} V open-circuit per string',
    controllerBatterySpec: '{fuse} A class {class} fuse · {gauge} ({mm2} mm²) copper',
    controllerBatteryNote: "Fuse at least 1.25 × the {amps} A controller · cable carries {ampacity} A after derating, in open air · check it fits the controller's terminals · join on the battery side with its own fuse",
    pvCableSpec: '{mm2} mm² ({awg}) solar cable, {length} m each', pvCableNote: 'Roof to controller · one pair per string · MC4 ends',
    pvDisconnectSpec: '{amps} A DC breaker, 500 V', pvDisconnectNote: 'Between the panels and the controller, reachable from the ground',
    mountingSpec: 'Aluminium rails and mid/end clamps for {panels}', mountingNote: 'Tilt 10° facing south on a flat roof; flush on a pitched one',
    solarTag: 'Solar', fineSolar: ' Solar assumes {w} panels, 75% panel-to-battery efficiency and {sun} peak sun hours a day.',
    solarNotSized: "This kit does not size the solar side's ground-fault and surge protection, grounding, the controller's voltage window or the roof structure; a qualified installer designs them.",
    stringsOne: '1 string of {n} in series', stringsMany: '{strings} strings of {n} in series',
    average: 'Average', averageWatts: 'Average (W)', kind: 'Kind',
    runsLabel: 'Runs', dutyOf: '{name}: share of each hour it runs', dutyOption: '{pct}% of each hour', dutyTypical: '{pct}% · typical', dutyNonstop: '100% · never stops',
    rename: 'Rename', projectActions: 'More actions for {name}', stepLocked: 'Add at least one appliance first', stepGo: 'Step {n}: {label}', dutyRuns: 'Runs · {pct}% of each hour', dutyBursts: '~{min} min an hour', dutyTypicalAt: 'typical {pct}%', averageDrawFor: '~{w} average for {qty}',
    startsLabel: 'Motors starting at once',
    startsOne: 'One at a time', startsOneHelp: 'Typical: the biggest motor starts while the rest run.',
    startsTwo: 'Two together', startsTwoHelp: 'Fridge and AC can start in the same second.',
    startsAll: 'All at once', startsAllHelp: 'Everything restarts together when the grid drops.',
    cableRun: 'Cable run', cableSummary: '{length} m · {ambient} °C · {insulation} °C cable{bundled}', cableBundledShort: ' · bundled',
    runLength: 'Battery to inverter, one way', ambientLabel: 'Air around the cables',
    ambient30: '30 °C · cool room', ambient40: '40 °C · garage, utility room', ambient50: '50 °C · attic or sunlit box',
    bundledLabel: 'Cables share a conduit or are tied together', bundledHelp: 'Bundling factor on the main cable: {factor}%',
    insulationLabel: 'Cable insulation', insulation75: '75 °C · THW, welding cable', insulation90: '90 °C · THHN, XHHW-2, most battery cable',
    runtimeRange: '{worst} on a hard day · {best} on a light day',
    checks: 'Checks', incChecks: 'Checks', checkPass: 'Passes', checkWarn: 'Needs attention',
    checksAttentionOne: '1 check needs attention', checksAttentionMany: '{count} checks need attention',
    checkSurge: 'Inverter size', checkSurgeOk: '{running} running on a {inverter} inverter · {peak} for {seconds} s, within its assumed {rating} surge rating',
    checkSurgeOkMany: '{running} running on {count} × {unit} inverters ({inverter} together) · {peak} for {seconds} s, within their assumed {rating} surge rating',
    checkSurgeOkNoStart: '{running} running on a {inverter} inverter · no start-up surge, within its assumed {rating} surge rating',
    checkSurgeOkManyNoStart: '{running} running on {count} × {unit} inverters ({inverter} together) · no start-up surge, within their assumed {rating} surge rating',
    checkSurgeContributors: '{running} running + {list} starting',
    checkBatteryContinuous: 'Battery continuous current', checkBatteryContinuousOk: 'Bank gives an assumed {bankA} A continuous; the inverter draws up to {needA} A',
    checkBatteryContinuousOkMany: 'Bank gives an assumed {bankA} A continuous; the {count} inverters draw up to {needA} A together',
    checkBatteryPeak: 'Battery peak current', checkBatteryPeakOk: 'Bank peak of an assumed {bankA} A covers the {needA} A start-up for {seconds} s',
    checkBatteryPeakOkNoStart: 'Bank peak of an assumed {bankA} A covers the {needA} A it draws',
    checkParallel: 'Parallel strings', checkParallelOk: '{parallel} in parallel, within the assumed limit of {max}', checkParallelSingle: 'One string, nothing to balance · assumed limit of {max} in parallel',
    checkFuse: 'Fuse', checkFuseOk: "{amps} A class {class}: under the cable's {ampacity} A, {aic} kA interrupting against an estimated {fault} A short circuit, start-up {startA} A within what it holds",
    checkCable: 'Cable', checkCableOk: '{gauge} carries {ampacity} A after derating ({ambient} °C{bundled}) for a {designA} A design current{perRun} · {runDrop}% drop, {drop}% at start-up',
  },
  categories: { All: 'All', Kitchen: 'Kitchen', Living: 'Living', Climate: 'Climate', 'Air conditioning': 'Air conditioning', Work: 'Work', Utility: 'Utility', Security: 'Security', Personal: 'Personal', Custom: 'Custom' },
  chemistries: { lifepo4: 'LiFePO₄ lithium', agm: 'AGM lead-acid' },
  voltageHints: { 12: 'Small systems up to ~2 kW', 24: 'Mid-size, up to ~5 kW', 36: 'Uncommon; golf-cart banks', 48: 'Whole-home, 3 kW and up' },
  warnings: {
    inverterVoltage: (p) => `${p.unitW?.toLocaleString('en-US')} W inverters are normally built for ${p.voltsList} V. Change the battery voltage or trim the load.`,
    highCurrent: (p) => `${p.amps?.toLocaleString('en-US')} A ${isSet(p) ? 'to each inverter' : 'on the DC side'} at ${p.volts} V is hard to wire safely${p.nextVolts ? `. Consider ${p.nextVolts} V.` : '.'}`,
    parallelStrings: (p) => `${p.strings} parallel strings drift out of balance. Prefer bigger units or a higher voltage.`,
    dominantLoad: (p) => `${p.itemName} is ${p.sharePct}% of the energy. Dropping it is the cheapest way to shrink the bank.`,
    splitPhase: (p) => `${p.itemName} usually runs on 240 V. You need a split-phase (240 V) inverter or two stacked units.`,
    lockedRotor: (p) => `${p.itemName}: the start-up surge is a rule of thumb, and the nameplate's locked-rotor amps can be higher. Check locked-rotor amps × volts against the inverter's surge, or fit a soft starter.`,
    inverterUndersized: (p) => {
      const [inverter, unit, running] = [p.inverterW ?? 0, p.unitW ?? 0, p.runningW ?? 0].map((n) => n.toLocaleString('en-US'))
      const isUnder = (p.inverterW ?? 0) < (p.runningW ?? 0)
      // A set is already the most the list can put in parallel, so the advice no longer points there.
      if (isSet(p)) {
        const advice = 'Trim the load, or ask an installer about a system built for it.'
        const set = `The ${p.inverters} × ${unit} W inverters in parallel (${inverter} W)`
        return isUnder
          ? `${set} are smaller than the ${running} W running load and cannot carry it. ${advice}`
          : `${set} leave ${p.headroomPct}% headroom over the ${running} W running load; this kit plans for ${p.needPct}%. ${advice}`
      }
      const advice = 'Trim the load, or ask an installer about a larger inverter or units built to run in parallel.'
      return isUnder
        ? `The ${inverter} W inverter is smaller than the ${running} W running load and cannot carry it. ${advice}`
        : `The ${inverter} W inverter leaves ${p.headroomPct}% headroom over the ${running} W running load; this kit plans for ${p.needPct}%. ${advice}`
    },
    surgeDuration: (p) => {
      const start = `A ${p.surgeW?.toLocaleString('en-US')} W start-up`
      const [rated, surge] = [p.ratedW, p.inverterSurgeW].map((n) => n?.toLocaleString('en-US'))
      // A set is already the most the list can put in parallel, so the advice no longer offers a bigger inverter.
      if (isSet(p)) {
        const set = `the ${p.inverters} × ${p.unitW?.toLocaleString('en-US')} W inverters`
        const reason = p.tooLong
          ? `${start} lasting ${p.seconds} s is longer than the surge window of ${set}; together they only hold ${rated} W that long.`
          : `${start} is more than the ${surge} W surge rating of ${set} together.`
        return `${reason} Let fewer motors start at once.`
      }
      const inverter = `the ${p.inverterW?.toLocaleString('en-US')} W inverter's`
      const reason = p.tooLong
        ? `${start} lasting ${p.seconds} s is longer than ${inverter} surge window; it only holds ${rated} W that long.`
        : `${start} is more than ${inverter} ${surge} W surge rating.`
      return `${reason} Choose a bigger inverter or let fewer motors start at once.`
    },
    bankDischarge: (p) => `${isSet(p) ? `The ${p.inverters} inverters draw up to ${p.needA?.toLocaleString('en-US')} A together` : `The inverter draws up to ${p.needA?.toLocaleString('en-US')} A`} at full load; ${p.strings} × ${p.unitLabel} allows ${p.maxA?.toLocaleString('en-US')} A continuous and ${hasBms(p) ? 'its BMS would cut out' : NO_BMS}. Pick a larger unit or a higher voltage.`,
    bankPeak: (p) => {
      const peak = `${p.maxA?.toLocaleString('en-US')} A peak`
      const limit = hasBms(p) ? `the bank's BMS allows ${peak} and may shut off` : `the bank allows ${peak} and ${NO_BMS}`
      return `Start-up pulls ${p.needA?.toLocaleString('en-US')} A for ${p.seconds} s; ${limit}. Let fewer motors start at once or add a string.`
    },
    fuseAboveBank: (p) => {
      const fuse = `${(p.count ?? 1) > 1 ? 'a' : 'the'} fuse`
      const overload = hasBms(p) ? `the BMS, not ${fuse}, would trip on an overload` : `an overload would strain the batteries before ${fuse} blows`
      const source = p.conductor === 'stringLeads' ? 'one string' : 'the bank'
      return `${(p.count ?? 1) > 1 ? `The ${p.count} × ${p.fuseA} A fuses are` : `The ${p.fuseA} A ${fuseOn(p)} is`} sized for more than the ${p.maxA?.toLocaleString('en-US')} A ${source} can deliver, so ${overload}. Pick a bank that delivers more.`
    },
    fuseAboveCable: (p) => {
      const maxA = p.maxA?.toLocaleString('en-US')
      const way = 'Raise the voltage or trim the load.'
      if (p.conductor === 'stringLeads') return `Even the largest cable carries only ${maxA} A, under the ${p.fuseA} A ${fuseOn(p)}. ${way}`
      if ((p.count ?? 1) === 1) return `The largest cable carries only ${maxA} A, under the ${p.fuseA} A fuse it needs. ${way}`
      return `Even ${p.count} runs of the largest cable carry only ${maxA} A each, under the ${p.fuseA} A fuse they need. ${way}`
    },
    fuseSurge: (p) => `Start-up pushes ${p.surgeA?.toLocaleString('en-US')} A through a ${p.fuseA} A ${fuseOn(p)} for ${p.seconds} s; it may blow on a normal start.`,
    fuseInterrupt: (p) => p.conductor === 'stringLeads'
      ? `A shorted battery can deliver an estimated ${p.shortCircuitA?.toLocaleString('en-US')} A, more than the ${p.aicA?.toLocaleString('en-US')} A interrupting rating of the ${fuseOn(p)}. Use a fuse rated for it.`
      : `A shorted bank can deliver an estimated ${p.shortCircuitA?.toLocaleString('en-US')} A, more than the fuse's ${p.aicA?.toLocaleString('en-US')} A interrupting rating. Use a fuse rated for it or fewer strings.`,
    fuseVoltage: (p) => `The ${p.fuseA} A ${fuseOn(p)} is listed for only ${p.maxVdc} V DC, and a ${p.volts} V bank needs ${p.needVdc} V DC or more: it may not break a fault. Use a fuse listed for at least ${p.needVdc} V DC.`,
    cableDrop: (p) => `The cable drops ${p.dropPct}% at full load, more than the ${p.maxDropPct}% it is sized for, even on the largest gauge. Shorten the run or pick a higher bank voltage.`,
    startupDrop: (p) => `The cable drops ${p.dropPct}% at start-up current; the inverter may cut out when a motor starts. Shorten the run or go up a gauge.`,
    cableAmbient: (p) => `No cable in the table is rated for ${p.ambientC} °C air. Move the run somewhere cooler.`,
    cableUndersized: (p) => `${p.gauge} for the ${CONDUCTORS[p.conductor!]} carries only ${p.maxA?.toLocaleString('en-US')} A after derating, under the ${p.needA?.toLocaleString('en-US')} A design current of each cable. ${cableRemedy(p)}`,
    missingAppliances: (p) => p.count === 1
      ? '1 appliance in this project could not be loaded, so this kit leaves it out. Reload in a minute; if it is still missing, add it again.'
      : `${p.count} appliances in this project could not be loaded, so this kit leaves them out. Reload in a minute; if they are still missing, add them again.`,
    roofLimited: (p) => `Your roof holds ${p.fit} panels; ${p.need} would refill the bank in one clear day. It still refills over more days of sun.`,
    stringTooShort: (p) => p.volts === 36
      ? `At 36 V one panel is marginal: on a hot day it falls short of the voltage the controller charges at, and the roof holds only ${p.fit}. This kit lists no panels; make room for ${p.count} in series.`
      : `A string needs at least ${p.count} panels in series to charge a ${p.volts} V bank, and the roof holds only ${p.fit}. This kit lists no panels; make room for ${p.count} or more.`,
  },
  parts: { inverter: 'Inverter', batteries: 'Batteries', mainCable: 'Main cable', interconnects: 'Interconnects', stringLeads: 'String leads', fuse: 'Fuse', stringFuses: 'String fuses', solarPanels: 'Solar panels', chargeController: 'Charge controller', controllerBattery: 'Controller to battery: cable and fuse', pvCable: 'PV cable', pvDisconnect: 'PV disconnect', mounting: 'Mounting'  },
  kinds: { continuous: 'Always on', cycling: 'Cycles on and off', momentary: 'Short bursts' },
  parallelNotes: {
    sameModelAge: 'Same model and age in every string',
    equalLeadsOrBusbar: 'Equal cable lengths to the bus bars',
    stringFuses: 'A fuse on each string',
    bmsComms: 'BMS units linked (CAN or RS485) so they share the load',
  },
  inverterNotes: {
    builtForParallel: 'Same model, built and linked to run in parallel',
    ownRunAndFuse: 'Each on its own fused cables, of equal length, from the bus bars',
  },
  privacy: {
    title: 'Privacy',
    updated: 'Last updated {date}',
    sections: [
      { heading: 'What we store', body: 'Your email and name, and, if you sign in with Google, your Google account ID. We also store the projects you save: appliances, hours, voltage and battery choices, and, if you add them, the client details for the spec sheet (name, ID number, phone, email and address). Clients you keep with "Save to my clients", and a client form you closed without saving, stay in this browser only. If you upload installer quotes, we store the files and the prices and items we read from them.' },
      { heading: 'Why', body: 'To sign you in and keep your projects across devices. If you upload installer quotes, we also read them for comparison with your kit (see Quotes below).' },
      { heading: 'Sharing', body: "We don't sell or share your data except with the providers that run the app: Vercel and Neon for hosting and the database, and, if you upload installer quotes, OpenAI to read them (see Quotes below)." },
      { heading: 'Quotes', body: "If you upload installer quotes, we store the files privately with Vercel and send each one to OpenAI to read its prices and items, sending it again if a read fails or you retry. OpenAI doesn't train on data sent through its API. OpenAI may keep each file we send for up to 30 days to check for abuse, or longer if the law requires it or it is needed to prevent harm. We keep a count of your uploads each month to apply the monthly limit; that count stays when you delete a quote. Deleting a quote, or the project it belongs to, deletes the file." },
      { heading: 'Google data', body: "We only request your basic profile (name and email). We don't access Gmail, Drive or anything else in your Google account." },
      { heading: 'Cookies', body: 'One sign-in session cookie and one language cookie. No ads or tracking.' },
      { heading: 'Deleting your data', body: "Email {email} and we'll delete your account and projects." },
    ],
  },
  terms: {
    title: 'Terms of use',
    updated: 'Last updated {date}',
    sections: [
      { heading: 'What this is', body: "Solar Dimension estimates the inverter, batteries, cables and fuses for a backup power system from the appliances and hours you enter. It's free to use." },
      { heading: 'Estimates, not an installation plan', body: 'Results are estimates based on typical appliance ratings and the assumptions shown on the kit page. Have a licensed electrician check the design against your local electrical code before you buy or install anything. Batteries and DC wiring can cause fire or injury if installed incorrectly.' },
      { heading: 'No warranty', body: 'The app is provided "as is", without warranties of any kind. We don\'t guarantee that results are accurate, complete or right for your situation.' },
      { heading: 'Limitation of liability', body: "To the extent the law allows, we aren't liable for any loss or damage from using the app or relying on its results." },
      { heading: 'Your account', body: 'Keep your password private. You can ask us to delete your account at any time (see Privacy).' },
      { heading: 'Changes', body: 'We may update these terms. The date at the top shows the current version.' },
      { heading: 'Contact', body: '{email}' },
    ],
  },
  quotes: quotesEn,
  requester: requesterEn,
  quoteItems: quoteItemsEn,
  quoteItemsInline: quoteItemsInlineEn,
  quoteItemsShort: quoteItemsShortEn,
  quoteItemsList: quoteItemsListEn,
}
