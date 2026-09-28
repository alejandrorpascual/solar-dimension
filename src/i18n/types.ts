import type { Category, ChemistryId, Voltage } from '../lib/catalog'
import type { WarningCode, WarningParams } from '../lib/sizing'

export type Locale = 'en' | 'es'

export interface Dictionary {
  locale: Locale
  ui: Record<UiKey, string>
  categories: Record<Category | 'All', string>
  chemistries: Record<ChemistryId, string>
  voltageHints: Record<Voltage, string>
  warnings: Record<WarningCode, (p: WarningParams) => string>
  parts: Record<'inverter' | 'batteries' | 'mainCable' | 'interconnects' | 'fuse', string>
  privacy: LegalPage
  terms: LegalPage
}

/** `{email}` in a body is replaced with the contact address as a mailto link; `{date}` in `updated` with the date. */
export interface LegalPage { title: string; updated: string; sections: readonly { heading: string; body: string }[] }

export type UiKey =
  | 'step1' | 'step2' | 'step3' | 'stepOf'
  | 'project' | 'projectName' | 'newProject' | 'duplicate' | 'delete' | 'untitled'
  | 'q1' | 'q1Help' | 'acInverter' | 'acInverterHelp' | 'acConventional' | 'acConventionalHelp' | 'acSizeOne' | 'acSizeMany'
  | 'search' | 'nothingMatches' | 'sectionAdded' | 'add' | 'addOne' | 'qtyOf' | 'removeOne' | 'remove'
  | 'running' | 'surge' | 'runningSurgeLine' | 'splitPhase'
  | 'customTitle' | 'customHelp' | 'watts' | 'voltsAmps' | 'name' | 'runningW' | 'volts' | 'amps' | 'surgeOptional' | 'sameAsRunning' | 'addAppliance'
  | 'errName' | 'errVa' | 'errWatts' | 'errSurge'
  | 'q2' | 'q2Help' | 'hoursLabel' | 'step2Empty' | 'step2Summary' | 'batteryVoltage' | 'batteryChemistry' | 'usableCapacity'
  | 'kitFor' | 'kitEmpty' | 'kitSummary' | 'editAppliances' | 'editWindow'
  | 'runningLoad' | 'averageDraw' | 'startupPeak' | 'batteryNeeded' | 'runtime'
  | 'part' | 'specification' | 'quantity' | 'nothingSelected'
  | 'inverterSpec' | 'inverterNote' | 'batteriesNote' | 'mainCableSpec' | 'mainCableNote' | 'interconnectsSpec' | 'interconnectsNote' | 'fuseSpec' | 'fuseNote' | 'perRun'
  | 'fine'
  | 'batterySize' | 'batterySizeHelp' | 'batteryAuto' | 'batteryRecommended' | 'batteryGroup' | 'batteryInSeries' | 'manyStrings'
  | 'batteryCountOne' | 'batteryCountMany'
  | 'footer1' | 'footer2' | 'footer3' | 'footerEmpty'
  | 'back' | 'next' | 'buildKit' | 'startOver'
  | 'continueGoogle' | 'orDivider' | 'googleExists' | 'googleFailed' | 'connectGoogle'
  | 'signIn' | 'signUp' | 'signOut' | 'email' | 'password' | 'noAccount' | 'haveAccount' | 'authFailed' | 'signedInAs' | 'syncing' | 'syncFailed' | 'language'
  | 'notFound' | 'backHome' | 'errorTitle' | 'reload' | 'updating'
  | 'projects' | 'projectsCount' | 'current' | 'quickEdit' | 'done' | 'projectMeta' | 'heaviestMore' | 'bank' | 'inverter' | 'close'
  | 'appliancesCount' | 'windowLabel' | 'hourLess' | 'hourMore' | 'hoursShort' | 'saved' | 'undo' | 'allAppliances'
  | 'addApplianceSearch' | 'noSearchMatch'
  | 'download' | 'downloadFor' | 'format' | 'include' | 'preview'
  | 'fmtPdf' | 'fmtPdfHint' | 'fmtPng' | 'fmtPngHint' | 'fmtCsv' | 'fmtCsvHint'
  | 'incSummary' | 'incAppliances' | 'incParts' | 'incNotes'
  | 'downloadPdf' | 'downloadPng' | 'downloadCsv' | 'share' | 'making' | 'exportFailed'
  | 'sheetTitle' | 'loadSchedule' | 'appliance' | 'each' | 'overHours' | 'total' | 'note' | 'eachW' | 'runningWatts' | 'whOver'
