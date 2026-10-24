import { useId } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { useLocale } from '../../hooks/useLocale'
import { FIXED_MUSTS, type ItemId, type Musts } from '../../lib/quote-items'

interface Props {
  isOpen: boolean; onOpenChange: (open: boolean) => void
  /** The items this kit is checked for: solar panels only when it has an array. */
  items: readonly ItemId[]
  musts: Musts; onChange: (item: ItemId, value: boolean) => void; error: string | null
}

function MustRow({ id, isOn, onChange }: { id: ItemId; isOn: boolean; onChange: (v: boolean) => void }) {
  const { t } = useLocale()
  const nameId = useId()
  // The inverter and battery are always must-haves (the help above says so): their switch shows it and can't be turned off.
  const isFixed = FIXED_MUSTS.includes(id)
  return (
    <li className="qmusts__row">
      <span className="qmusts__name" id={nameId}>{t.quoteItems[id]}</span>
      <button type="button" role="switch" className="qmust" aria-checked={isOn} aria-labelledby={nameId} disabled={isFixed}
        onClick={() => onChange(!isOn)}>
        {isOn ? t.quotes.mustHave : t.quotes.niceToHave}
      </button>
    </li>
  )
}

/** One switch per item the kit is checked for; each change saves at once and the verdict behind the sheet updates. */
export function MustsSheet({ isOpen, onOpenChange, items, musts, onChange, error }: Props) {
  const { t } = useLocale()
  return (
    <ModalOverlay className="qdialog__overlay" isOpen={isOpen} onOpenChange={onOpenChange} isDismissable>
      <Modal className="qdialog">
        <Dialog className="qdialog__body">
          {({ close }) => (
            <>
              <Heading slot="title" className="qdialog__title">{t.quotes.mustsTitle}</Heading>
              <p className="qdialog__text">{t.quotes.mustsHelp}</p>
              <ul className="qmusts">
                {items.map((id) => <MustRow key={id} id={id} isOn={musts[id]} onChange={(v) => onChange(id, v)} />)}
              </ul>
              {error && <p className="qerr" role="alert">{error}</p>}
              <div className="qdialog__actions">
                <button type="button" className="btn btn--primary" onClick={close}>{t.quotes.mustsDone}</button>
              </div>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
