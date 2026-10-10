import { describe, expect, test } from 'vitest'
import { renameOutcome, type Renaming } from './project-rename'

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
