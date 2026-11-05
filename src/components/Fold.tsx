import { ChevronDown } from 'lucide-react'
import { useId, type ReactNode } from 'react'

interface Props {
  title: string
  /** The values in effect, said on the closed line so the box need not be opened to read them. */
  values?: ReactNode
  /** Extra classes beside `elec`, the box every fold in the builder shares. */
  className?: string
  children: ReactNode
}

/**
 * The builder's one closed box: a line with its name, the values in effect and a chevron, opening to what it holds.
 * The name is plain text named onto the box (aria-labelledby): a heading inside <summary> is flattened by its button
 * role in VoiceOver and Safari, so it never reached heading navigation anyway.
 */
export function Fold({ title, values, className, children }: Props) {
  const titleId = useId()
  return (
    <details className={className ? `elec ${className}` : 'elec'} aria-labelledby={titleId}>
      <summary className="elec__summary">
        <span className="elec__title" id={titleId}>{title}</span>
        {values !== undefined && <span className="num elec__values">{values}</span>}
        <ChevronDown size={16} aria-hidden="true" className="elec__chev" />
      </summary>
      {children}
    </details>
  )
}
