import { expect, test } from 'vitest'
import type { Project } from './schema'
import { initialStore, patchCurrent } from './store'
import { diffProjects } from './sync'
import { edited, isClean, listRead, NOT_SYNCED, readAnswered, readSent, saveAnswered, saveFailed, saveOf, type TabSync } from './tab-sync'

const home = initialStore().projects
const HOME_ID = home[0]!.id

/** An edit of the first project from `prev` with `patch`, recorded in `sync`, and the save it starts. */
function editAndSave(sync: TabSync, prev: readonly Project[], patch: Partial<Project>) {
  const next = patchCurrent({ ...initialStore(), projects: [...prev] }, patch).projects
  const change = diffProjects(prev, next)
  const edit = edited(sync, prev, change.upserts)
  return { next, sync: edit.sync, save: saveOf(edit.sync, next, change, edit.edits) }
}
const namedIn = (save: { named: Record<string, object> }): string[] => Object.keys(save.named[HOME_ID] ?? {})

test('a save that failed is carried by the next one, fields and all, and nothing is carried once a save is answered', () => {
  const first = editAndSave(listRead(NOT_SYNCED, home), home, { hours: 24 })

  const second = editAndSave(saveFailed(first.sync, first.save), first.next, { volts: 24 })
  expect(namedIn(second.save)).toEqual(['hours', 'volts'])

  const third = editAndSave(saveAnswered(second.sync, second.save.projects), second.next, { name: 'Casa' })
  expect(namedIn(third.save)).toEqual(['name'])
})

test('a tab is clean once a list was read and while nothing failed since', () => {
  expect(isClean(NOT_SYNCED)).toBe(false)
  const read = listRead(NOT_SYNCED, home)
  expect(isClean(read)).toBe(true)

  const { sync, save } = editAndSave(read, home, { hours: 24 })
  expect(isClean(saveFailed(sync, save))).toBe(false)
  expect(isClean(saveAnswered(saveFailed(sync, save), save.projects))).toBe(true)
})

test("an edit made while a read is out is laid over the read's answer, which keeps the account's other fields", () => {
  const during = editAndSave(readSent(listRead(NOT_SYNCED, home)), home, { hours: 24 })
  const account = home.map((p): Project => ({ ...p, volts: 12, updatedAt: 3 }))

  const answer = readAnswered(during.sync, account, home, during.next, false)

  expect(answer.projects.map((p) => [p.hours, p.volts])).toEqual([[24, 12]])
})
