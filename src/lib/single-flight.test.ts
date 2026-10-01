import { describe, expect, it } from 'vitest'
import { createSingleFlight } from './single-flight'

describe('createSingleFlight', () => {
  it('lets the first caller in and turns the second away until it is released', () => {
    // Arrange
    const gate = createSingleFlight()
    // Act
    const first = gate.tryEnter()
    const second = gate.tryEnter()
    // Assert
    expect(first).toBe(true)
    expect(second).toBe(false)
  })

  it('lets a caller in again after release', () => {
    const gate = createSingleFlight()
    gate.tryEnter()
    gate.release()
    expect(gate.tryEnter()).toBe(true)
  })

  it('reports whether a run is in progress', () => {
    const gate = createSingleFlight()
    expect(gate.isBusy()).toBe(false)
    gate.tryEnter()
    expect(gate.isBusy()).toBe(true)
    gate.release()
    expect(gate.isBusy()).toBe(false)
  })
})
