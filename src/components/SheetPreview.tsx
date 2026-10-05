import { X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { printPages, type PrintPage } from '../client/export-file'
import { useLocale } from '../hooks/useLocale'
import { tr } from '../i18n'

const SHEET_WIDTH = 794

interface Props {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** PNG is one long image; PDF and CSV show the sheet the way the PDF prints it. */
  isImage: boolean
  /** The panel's sheet, already laid out: pages are cut where the PDF cuts it. */
  source: RefObject<HTMLDivElement | null>
  /** The same sheet without a ref, drawn once per page. */
  children: ReactNode
}

interface Layout { pages: PrintPage[]; pageHeight: number }

function layoutOf(node: HTMLDivElement | null, isImage: boolean): Layout {
  if (!node) return { pages: [], pageHeight: 0 }
  if (isImage) return { pages: [{ start: 0, end: node.offsetHeight, top: 0 }], pageHeight: node.offsetHeight }
  return printPages(node)
}

/** The sheet at reading size, page by page as it will print (or as the one image it will be shared as). */
export function SheetPreview({ isOpen, onOpenChange, isImage, source, children }: Props) {
  const { t } = useLocale()
  return (
    <ModalOverlay className="qdialog__overlay" isOpen={isOpen} onOpenChange={onOpenChange} isDismissable>
      <Modal className="qdialog pvw">
        <Dialog className="qdialog__body">
          {({ close }) => (
            <>
              <button type="button" className="qdialog__close" aria-label={t.ui.close} onClick={close}><X size={16} aria-hidden="true" /></button>
              <Heading slot="title" className="qdialog__title">{t.ui.previewTitle}</Heading>
              <Pages layout={layoutOf(source.current, isImage)} isImage={isImage}>{children}</Pages>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}

/** Each page draws the whole sheet shifted to its slice, with white above and below the slice, as the PDF does. */
function Pages({ layout, isImage, children }: { layout: Layout; isImage: boolean; children: ReactNode }) {
  const { t } = useLocale()
  const boxRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  useEffect(() => {
    const box = boxRef.current
    if (!box || typeof ResizeObserver === 'undefined') return
    const measure = () => setScale(Math.min(1, box.clientWidth / SHEET_WIDTH))
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    measure()
    return () => observer.disconnect()
  }, [])

  const count = layout.pages.length
  return (
    <div ref={boxRef} className="pvw__pages">
      {layout.pages.map((page, i) => (
        <figure key={page.start} className="pvw__item">
          <div className="pvw__page" style={{ height: layout.pageHeight * scale }} aria-hidden="true">
            <div className="pvw__frame" style={{ height: layout.pageHeight, transform: `scale(${scale})` }}>
              <div className="pvw__sheet" style={{ top: page.top - page.start }}>{children}</div>
              <div className="pvw__mask" style={{ top: 0, height: page.top }} />
              <div className="pvw__mask" style={{ top: page.top + page.end - page.start, bottom: 0 }} />
            </div>
          </div>
          <figcaption className="pvw__caption">{isImage ? t.ui.previewImage : tr(t, 'previewPage', { page: i + 1, pages: count })}</figcaption>
        </figure>
      ))}
    </div>
  )
}
