import { TriangleAlert } from 'lucide-react'

/** The id of the checks list on the kit step, where the attention line leads. */
export const CHECKS_ID = 'kit-checks'

/** Scrolls the checks list into view and focuses it, so a screen reader reads it next. */
function goToChecks(): void {
  const checks = document.getElementById(CHECKS_ID)
  if (!checks) return
  const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  checks.scrollIntoView({ behavior: isReduced ? 'auto' : 'smooth', block: 'start' })
  checks.focus({ preventScroll: true })
}

/** "2 checks need attention" while any check fails; tapping it moves to the checks. Nothing when every check passes. */
export function ChecksAttention({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <button type="button" className="attn" onClick={goToChecks}>
      <TriangleAlert size={14} strokeWidth={2.5} aria-hidden="true" />
      <span className="attn__t">{text}</span>
    </button>
  )
}
