import { Upload } from 'lucide-react'
import { useRef } from 'react'
import { QUOTE_MIMES } from '../../lib/quote-limits'

interface Props { label: string; isDisabled?: boolean; describedBy?: string; onFiles: (files: File[]) => void }

/** A real button that opens the file picker; the input itself stays out of the tab order. */
export function FilePickButton({ label, isDisabled = false, describedBy, onFiles }: Props) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className="qbtn" disabled={isDisabled} aria-describedby={describedBy} onClick={() => input.current?.click()}>
        <Upload size={16} aria-hidden="true" />{label}
      </button>
      <input ref={input} type="file" multiple accept={QUOTE_MIMES.join(',')} className="visually-hidden" tabIndex={-1} aria-hidden="true"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) onFiles(files)
        }} />
    </>
  )
}
