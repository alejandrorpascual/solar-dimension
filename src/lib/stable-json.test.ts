import { describe, expect, test } from 'vitest'
import { stable } from './stable-json'

describe('stable', () => {
  test('writes object keys in sorted order, at every depth', () => {
    const value = { b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } }
    expect(stable(value)).toBe('{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}')
  })

  test('does not care what order the keys came in, at any depth', () => {
    const stored = { specs: { w: 6000, v: { x: 1, y: 2 } }, kind: 'inverter' }
    const reordered = { kind: 'inverter', specs: { v: { y: 2, x: 1 }, w: 6000 } }
    expect(stable(stored)).toBe(stable(reordered))
  })

  test('does care what order an array is in, even when its items are objects', () => {
    expect(stable([1, 2])).not.toBe(stable([2, 1]))
    expect(stable([{ a: 1 }, { a: 2 }])).not.toBe(stable([{ a: 2 }, { a: 1 }]))
  })

  test('reads a field a stored record never had (undefined) as null, the same as the schema default', () => {
    expect(stable(undefined)).toBe(stable(null))
    expect(stable({ a: undefined })).toBe(stable({ a: null }))
  })

  test('keeps different values different', () => {
    const values = [1, '1', true, 'true', null, 0, false, '', [], {}, [null], { a: null }]
    const written = values.map(stable)
    expect(new Set(written).size).toBe(values.length)
  })

  test('escapes keys, so a key cannot pass for structure', () => {
    expect(stable({ 'a":1,"b': 2 })).not.toBe(stable({ a: 1, b: 2 }))
  })
})
