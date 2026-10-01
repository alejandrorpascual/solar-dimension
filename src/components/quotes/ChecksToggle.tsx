import { ChevronDown } from 'lucide-react'
import { useLocale } from '../../hooks/useLocale'
import { trq } from '../../i18n'

interface Props { name: string; isOpen: boolean; controls: string; onToggle: () => void; variant: 'button' | 'link' }

/** Show or hide a quote's checks. The quote's name is in the accessible name but hidden, so the visible label stays short. */
export function ChecksToggle({ name, isOpen, controls, onToggle, variant }: Props) {
  const { t } = useLocale()
  return (
    <button type="button" className={variant === 'button' ? 'qbtn qchecks' : 'qlink qchecks'} aria-expanded={isOpen}
      aria-controls={controls} onClick={onToggle}>
      {isOpen ? t.quotes.hideChecks : t.quotes.showChecks}{' '}
      <span className="visually-hidden">{trq(t, 'checksOf', { name })}</span>
      <ChevronDown size={16} aria-hidden="true" className="qchecks__chev" />
    </button>
  )
}
