import { Check, CircleHelp, X } from 'lucide-react'
import type { ItemStatus } from '../../lib/quote-items'

/** A status dot that always carries its own word for screen readers. */
export function ItemMark({ status, label }: { status: ItemStatus; label: string }) {
  const Icon = status === 'ok' ? Check : status === 'unknown' ? CircleHelp : X
  return (
    <span className={`qmark qmark--${status}`} role="img" aria-label={label}>
      <Icon size={13} strokeWidth={3} aria-hidden="true" />
    </span>
  )
}
