/** A turning ring for work in progress. Decorative: the words beside it say what is happening. */
export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg className="qspin" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
