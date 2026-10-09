import { tr, type Dictionary, type Locale } from '../i18n'
import { fmtHours } from '../i18n/format'
import type { RuntimeScenarios } from '../lib/sizing'

interface Props { runtime: RuntimeScenarios; t: Dictionary; locale: Locale; className?: string }

/** The worst and best case around the typical runtime, as one line under the headline figure. */
export function RuntimeRange({ runtime, t, locale, className }: Props) {
  if (runtime.typical <= 0) return null
  return <span className={className}>{tr(t, 'runtimeRange', { worst: fmtHours(runtime.worst, locale), best: fmtHours(runtime.optimistic, locale) })}</span>
}
