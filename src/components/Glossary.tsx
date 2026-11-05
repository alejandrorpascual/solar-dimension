import { useLocale } from '../hooks/useLocale'
import { glossaryEntries } from '../i18n'
import { Fold } from './Fold'

/** The kit's terms in plain words. Closed by default, in the same box as the cable settings so it reads as something that opens. */
export function Glossary() {
  const { t } = useLocale()
  return (
    <Fold className="gloss" title={t.glossary.title}>
      <dl className="gloss__list">
        {glossaryEntries(t).map((e) => (
          <div key={e.term}>
            <dt>{e.term}</dt>
            <dd className="muted">{e.body}</dd>
          </div>
        ))}
      </dl>
    </Fold>
  )
}
