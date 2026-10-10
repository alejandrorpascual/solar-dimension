import { describe, expect, test } from 'vitest'
import { renameCloseKey, renameOutcome, type Renaming } from './project-rename'

const EXISTING: Renaming = { id: 'p1', original: 'Home', isNew: false }
const CREATED: Renaming = { id: 'p2', original: 'Project 2', isNew: true }

describe('renameOutcome', () => {
  test('Escape puts the starting name back, since every keystroke was already saved', () => {
    // Arrange / Act
    const outcome = renameOutcome(EXISTING, 'escape')

    // Assert
    expect(outcome.shouldRestore).toBe(true)
  })

  test('Enter and leaving the field keep what was typed', () => {
    expect(renameOutcome(EXISTING, 'enter').shouldRestore).toBe(false)
    expect(renameOutcome(EXISTING, 'blur').shouldRestore).toBe(false)
  })

  test('Enter and Escape hand focus to the title, so the keyboard is not stranded where the field was', () => {
    expect(renameOutcome(EXISTING, 'enter').shouldFocusTitle).toBe(true)
    expect(renameOutcome(EXISTING, 'escape').shouldFocusTitle).toBe(true)
  })

  test('leaving the field does not pull focus back from wherever it went', () => {
    expect(renameOutcome(EXISTING, 'blur').shouldFocusTitle).toBe(false)
  })

  test('Enter in the name field of a project that was just created picks it, which closes the phone sheet', () => {
    expect(renameOutcome(CREATED, 'enter').shouldPick).toBe(true)
  })

  test('Escape and leaving the field never pick, even on a new project', () => {
    expect(renameOutcome(CREATED, 'escape').shouldPick).toBe(false)
    expect(renameOutcome(CREATED, 'blur').shouldPick).toBe(false)
  })

  test('renaming an existing project never picks', () => {
    expect(renameOutcome(EXISTING, 'enter').shouldPick).toBe(false)
    expect(renameOutcome(EXISTING, 'escape').shouldPick).toBe(false)
    expect(renameOutcome(EXISTING, 'blur').shouldPick).toBe(false)
  })
})

describe('renameCloseKey', () => {
  const NOT_COMPOSING = false
  const COMPOSING = true
  /** What browsers report as keyCode for a key an input method is handling. */
  const IME_KEY_CODE = 229
  const ENTER_KEY_CODE = 13

  test('Enter and Escape close the field, each its own way', () => {
    expect(renameCloseKey('Enter', NOT_COMPOSING)).toBe('enter')
    expect(renameCloseKey('Escape', NOT_COMPOSING)).toBe('escape')
  })

  test('any other key leaves the field open', () => {
    expect(renameCloseKey('a', NOT_COMPOSING)).toBeNull()
    expect(renameCloseKey('Tab', NOT_COMPOSING)).toBeNull()
  })

  test('Enter and Escape pressed while an input method is choosing a candidate belong to it, not to the rename', () => {
    expect(renameCloseKey('Enter', COMPOSING)).toBeNull()
    expect(renameCloseKey('Escape', COMPOSING)).toBeNull()
  })

  test('a key the browser marks as handled by an input method is left alone even when composing reads false', () => {
    // Safari ends the composition before the keydown of the Enter that confirmed the candidate, and marks it only by keyCode.
    expect(renameCloseKey('Enter', NOT_COMPOSING, IME_KEY_CODE)).toBeNull()
    expect(renameCloseKey('Enter', NOT_COMPOSING, ENTER_KEY_CODE)).toBe('enter')
  })
})
