import { describe, expect, test } from 'vitest'
import { renameOutcome } from './project-rename'

describe('renameOutcome', () => {
  test('Escape puts the starting name back, since every keystroke was already saved', () => {
    // Arrange / Act
    const outcome = renameOutcome('escape')

    // Assert
    expect(outcome.shouldRestore).toBe(true)
  })

  test('Enter and leaving the field keep what was typed', () => {
    expect(renameOutcome('enter').shouldRestore).toBe(false)
    expect(renameOutcome('blur').shouldRestore).toBe(false)
  })

  test('Enter and Escape hand focus to the title, so the keyboard is not stranded where the field was', () => {
    expect(renameOutcome('enter').shouldFocusTitle).toBe(true)
    expect(renameOutcome('escape').shouldFocusTitle).toBe(true)
  })

  test('leaving the field does not pull focus back from wherever it went', () => {
    expect(renameOutcome('blur').shouldFocusTitle).toBe(false)
  })
})
