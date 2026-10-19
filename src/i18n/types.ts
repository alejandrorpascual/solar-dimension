import type { Category, ChemistryId, LoadKind, Voltage } from '../lib/catalog'
import type { ItemId } from '../lib/quote-items'
import type { InverterNote, ParallelNote, WarningCode, WarningParams } from '../lib/sizing'
import type { quotesEn } from './quotes-en'
import type { requesterEn } from './requester-en'

export type Locale = 'en' | 'es'

export interface Dictionary {
  locale: Locale
  ui: Record<UiKey, string>
  categories: Record<Category | 'All', string>
  chemistries: Record<ChemistryId, string>
  voltageHints: Record<Voltage, string>
  warnings: Record<WarningCode, (p: WarningParams) => string>
  parts: Record<'inverter' | 'batteries' | 'mainCable' | 'interconnects' | 'stringLeads' | 'fuse' | 'stringFuses' | 'solarPanels' | 'chargeController' | 'pvCable' | 'pvDisconnect' | 'mounting', string>
  /** Load kinds as the schedule groups them. */
  kinds: Record<LoadKind, string>
  /** Installation notes a bank with parallel strings carries. */
  parallelNotes: Record<ParallelNote, string>
  inverterNotes: Record<InverterNote, string>
  privacy: LegalPage
  terms: LegalPage
  quotes: Record<QuoteKey, string>
  quoteItems: Record<ItemId, string>
  /** Item names as they read inside a sentence: "does your quote include a battery charger?" */
  quoteItemsInline: Record<ItemId, string>
  quoteItemsShort: Record<ItemId, string>
  /** Item names in a comma list: "Includes charger, Wi-Fi and installation". */
  quoteItemsList: Record<ItemId, string>
  requester: Record<RequesterKey, string>
}

/** `{email}` in a body is replaced with the contact address as a mailto link; `{date}` in `updated` with the date. */
export interface LegalPage { title: string; updated: string; sections: readonly { heading: string; body: string }[] }

export type UiKey =
  | 'step1' | 'step2' | 'step3' | 'step4' | 'stepOf'
  | 'project' | 'projectName' | 'newProject' | 'duplicate' | 'delete' | 'untitled'
  | 'q1' | 'q1Help' | 'acInverter' | 'acInverterHelp' | 'acConventional' | 'acConventionalHelp' | 'acSizeOne' | 'acSizeMany'
  | 'search' | 'nothingMatches' | 'sectionAdded' | 'add' | 'addOne' | 'qtyOf' | 'removeOne' | 'remove'
  | 'running' | 'surge' | 'runningSurgeLine' | 'splitPhase'
  | 'customTitle' | 'customHelp' | 'watts' | 'voltsAmps' | 'name' | 'runningW' | 'volts' | 'amps' | 'surgeOptional' | 'sameAsRunning' | 'dutyPctLabel' | 'addAppliance'
  | 'errName' | 'errNameLong' | 'errVa' | 'errWatts' | 'errSurge' | 'errThousands' | 'errDuty'
  | 'customUnreadOne' | 'customUnreadMany' | 'customUnreadClearOne' | 'customUnreadClearMany'
  | 'q2' | 'q2Help' | 'hoursLabel' | 'step2Empty' | 'step2Summary' | 'batteryVoltage' | 'batteryChemistry' | 'usableCapacity'
  | 'kitFor' | 'kitEmpty' | 'kitSummary' | 'editAppliances' | 'editWindow'
  | 'runningLoad' | 'averageDraw' | 'startupPeak' | 'batteryNeeded' | 'runtime'
  | 'part' | 'specification' | 'quantity' | 'nothingSelected'
  | 'inverterSpec' | 'inverterNote' | 'inverterNoteTight' | 'inverterNoteTightPeak' | 'inverterNoteUnder' | 'inverterNotePeak' | 'inverterSurge' | 'inverterSurgeSet' | 'inverterParallelNote' | 'batteriesNote' | 'mainCableSpec' | 'mainCableNote' | 'interconnectsSpec' | 'seriesLinksNote' | 'seriesLinksSharedNote' | 'stringLeadsSpec' | 'stringLeadsNote' | 'fuseSpec' | 'fuseNote' | 'perRun' | 'perInverter' | 'perRunOfInverter'
  | 'legal' | 'estimateNotice' | 'fine'
  | 'batterySize' | 'batterySizeHelp' | 'batteryAuto' | 'batteryRecommended' | 'batteryGroup' | 'batteryInSeries' | 'manyStrings'
  | 'batteryCountOne' | 'batteryCountMany' | 'panelCountOne' | 'panelCountMany' | 'inverterSizeOne' | 'inverterSizeMany'
  | 'footer1' | 'footer2' | 'footer3' | 'footerEmpty'
  | 'back' | 'next' | 'buildKit' | 'startOver'
  | 'continueGoogle' | 'orDivider' | 'googleExists' | 'googleFailed' | 'connectGoogle' | 'signOutFailed'
  | 'signIn' | 'signUp' | 'signOut' | 'email' | 'password' | 'noAccount' | 'haveAccount' | 'authFailed' | 'signedInAs' | 'syncing' | 'syncFailed' | 'language'
  | 'notFound' | 'backHome' | 'errorTitle' | 'serverError' | 'reload' | 'updating'
  | 'projects' | 'projectsCount' | 'current' | 'quickEdit' | 'done' | 'projectMeta' | 'heaviestMore' | 'bank' | 'inverter' | 'close'
  | 'appliancesCount' | 'windowLabel' | 'hourLess' | 'hourMore' | 'hoursShort' | 'saved' | 'undo' | 'allAppliances'
  | 'addApplianceSearch' | 'noSearchMatch'
  | 'download' | 'downloadFor' | 'format' | 'include' | 'preview' | 'previewOpen' | 'previewTitle' | 'previewPage' | 'previewImage'
  | 'fmtPdf' | 'fmtPdfHint' | 'fmtPng' | 'fmtPngHint' | 'fmtCsv' | 'fmtCsvHint'
  | 'incSummary' | 'incAppliances' | 'incParts' | 'incNotes' | 'incRequester'
  | 'downloadPdf' | 'downloadPng' | 'downloadCsv' | 'share' | 'making' | 'downloadReady' | 'exportFailed'
  | 'sheetAttention' | 'sheetAttentionChecks' | 'sheetAttentionNotes' | 'sheetNotes'
  | 'sheetTitle' | 'loadSchedule' | 'appliance' | 'each' | 'overHours' | 'total' | 'note' | 'eachW' | 'runningWatts' | 'whOver'
  | 'q3' | 'q3Help' | 'solarNo' | 'solarNoHelp' | 'solarYes' | 'solarYesHelp' | 'solarSkipped'
  | 'roofSpace' | 'roofLess' | 'roofMore' | 'roofFitsOne' | 'roofFitsMany' | 'roofHint' | 'plannerLabel' | 'plannerTile' | 'addPanel' | 'removePanel'
  | 'panelsLine' | 'recommendedPill' | 'recommendedPillLimited' | 'backToRecommended' | 'sunHours' | 'sunHint'
  | 'clearDay' | 'flowSun' | 'flowBank' | 'flowHome' | 'coverFull' | 'coverPart' | 'coverAxis'
  | 'refillSameDay' | 'refillDays' | 'noPanelsYet' | 'cloudyDay' | 'cloudyNote' | 'solarAssumptions'
  | 'solarRecharge' | 'solarRechargeSub' | 'nextSolar' | 'footerSolar' | 'footerSolarNone' | 'footer4Solar'
  | 'solarPanelsSpec' | 'solarPanelsNote' | 'chargeControllerSpec' | 'chargeControllerNote' | 'pvCableSpec' | 'pvCableNote'
  | 'pvDisconnectSpec' | 'pvDisconnectNote' | 'mountingSpec' | 'mountingNote' | 'solarTag' | 'fineSolar'
  | 'stringsOne' | 'stringsMany'
  | 'average' | 'averageWatts' | 'kind'
  | 'runsLabel' | 'dutyOf' | 'dutyOption' | 'dutyTypical' | 'dutyNonstop'
  | 'rename' | 'projectActions' | 'stepLocked' | 'stepGo' | 'dutyRuns' | 'dutyBursts' | 'dutyTypicalAt' | 'averageDrawFor'
  | 'startsLabel' | 'startsOne' | 'startsOneHelp' | 'startsTwo' | 'startsTwoHelp' | 'startsAll' | 'startsAllHelp'
  | 'cableRun' | 'cableSummary' | 'cableBundledShort' | 'runLength' | 'ambientLabel' | 'ambient30' | 'ambient40' | 'ambient50'
  | 'bundledLabel' | 'bundledHelp' | 'insulationLabel' | 'insulation75' | 'insulation90'
  | 'runtimeRange'
  | 'checks' | 'incChecks' | 'checkPass' | 'checkWarn'
  | 'checkSurge' | 'checkSurgeOk' | 'checkSurgeOkMany' | 'checkSurgeContributors' | 'checkBatteryContinuous' | 'checkBatteryContinuousOk' | 'checkBatteryContinuousOkMany'
  | 'checkBatteryPeak' | 'checkBatteryPeakOk' | 'checkParallel' | 'checkParallelOk' | 'checkParallelSingle'
  | 'checkFuse' | 'checkFuseOk' | 'checkCable' | 'checkCableOk'
  | 'fuseAicNote' | 'stringFuseSpec' | 'stringFuseNote' | 'batteriesCurrentNote'
  | 'fineStartsOne' | 'fineStartsTwo' | 'fineStartsAll' | 'fineBundled' | 'fineRatings'

export type QuoteKey = keyof typeof quotesEn
export type RequesterKey = keyof typeof requesterEn
