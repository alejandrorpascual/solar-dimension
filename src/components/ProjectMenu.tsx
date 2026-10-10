import { Copy, Ellipsis, Pencil, Trash2 } from 'lucide-react'
import { Button, Menu, MenuItem, MenuTrigger, Popover, Separator, type Key } from 'react-aria-components'
import { useLocale } from '../hooks/useLocale'
import { tr } from '../i18n'

interface Props {
  name: string
  /** The last project cannot be deleted, so the item is left out. */
  canDelete: boolean
  onRename: () => void
  onDuplicate: () => void
  onDelete: () => void
}

/** The open project's ··· menu on its rail card: rename, duplicate and delete in one place. */
export function ProjectMenu({ name, canDelete, onRename, onDuplicate, onDelete }: Props) {
  const { t } = useLocale()
  const label = tr(t, 'projectActions', { name })
  const act = (key: Key) => {
    if (key === 'rename') onRename()
    if (key === 'duplicate') onDuplicate()
    if (key === 'delete') onDelete()
  }
  return (
    <MenuTrigger>
      <Button className="pcard__more" aria-label={label}>
        <Ellipsis size={18} aria-hidden="true" />
      </Button>
      <Popover className="hmenu__pop" placement="bottom end" offset={6}>
        <Menu className="hmenu__list" aria-label={label} onAction={act}>
          <MenuItem id="rename" className="hmenu__item" textValue={t.ui.rename}>
            <Pencil size={16} aria-hidden="true" /><span className="hmenu__label">{t.ui.rename}</span>
          </MenuItem>
          <MenuItem id="duplicate" className="hmenu__item" textValue={t.ui.duplicate}>
            <Copy size={16} aria-hidden="true" /><span className="hmenu__label">{t.ui.duplicate}</span>
          </MenuItem>
          {canDelete && <Separator className="hmenu__sep" />}
          {canDelete && (
            <MenuItem id="delete" className="hmenu__item hmenu__item--danger" textValue={t.ui.delete}>
              <Trash2 size={16} aria-hidden="true" /><span className="hmenu__label">{t.ui.delete}</span>
            </MenuItem>
          )}
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
