import { ChevronDown } from 'lucide-react'
import { useLocale } from '../hooks/useLocale'
import { glossaryEntries } from '../i18n'

/** The kit's terms in plain words. Closed by default, in the same box as the cable settings so it reads as something that opens. */
export function Glossary() {
  const { t } = useLocale()
  return (
    <details className="elec gloss">
      <summary className="elec__summary">
        <span>{t.glossary.title}</span>
        <ChevronDown size={16} aria-hidden="true" className="elec__chev" />
      </summary>
      <dl className="gloss__list">
        {glossaryEntries(t).map((e) => (
          <div key={e.term}>
            <dt>{e.term}</dt>
            <dd className="muted">{e.body}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
