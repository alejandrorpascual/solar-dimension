import type { Category, ChemistryId, Voltage } from '../lib/catalog'
import type { WarningCode, WarningParams } from '../lib/sizing'

export type Locale = 'en' | 'es'

export interface Dictionary {
  locale: Locale
  ui: Record<UiKey, string>
  categories: Record<Category | 'All', string>
  appliances: Record<string, { name: string; note: string }>
  chemistries: Record<ChemistryId, string>
  voltageHints: Record<Voltage, string>
  warnings: Record<WarningCode, (p: WarningParams) => string>
  parts: Record<'inverter' | 'batteries' | 'mainCable' | 'interconnects' | 'fuse', string>
}

export type UiKey =
  | 'brand' | 'step1' | 'step2' | 'step3' | 'stepOf'
  | 'project' | 'projectName' | 'newProject' | 'duplicate' | 'delete' | 'untitled'
  | 'q1' | 'q1Help' | 'acInverter' | 'acInverterHelp' | 'acConventional' | 'acConventionalHelp' | 'acSizeOne' | 'acSizeMany'
  | 'search' | 'nothingMatches' | 'sectionAdded' | 'add' | 'addOne' | 'qtyOf' | 'removeOne' | 'remove'
  | 'running' | 'surge' | 'runningSurgeLine'
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
  | 'signIn' | 'signUp' | 'signOut' | 'email' | 'password' | 'noAccount' | 'haveAccount' | 'authFailed' | 'signedInAs' | 'syncing' | 'syncFailed' | 'language'
  | 'notFound' | 'backHome' | 'errorTitle' | 'reload'
