import { describe, expect, test } from 'vitest'
import { parseWriteFlags } from './api-flags'

const parse = (query: string) => parseWriteFlags(new URLSearchParams(query))
const refusal = (name: string) => ({ ok: false, error: expect.stringContaining(`"${name}"`) })

describe('parseWriteFlags', () => {
  test('no parameters means a real write that does not replace', () => {
    expect(parse('')).toEqual({ ok: true, dryRun: false, replace: false })
  })

  test('reads dryRun and replace as true or false', () => {
    expect(parse('dryRun=true')).toEqual({ ok: true, dryRun: true, replace: false })
    expect(parse('replace=true')).toEqual({ ok: true, dryRun: false, replace: true })
    expect(parse('dryRun=true&replace=true')).toEqual({ ok: true, dryRun: true, replace: true })
    expect(parse('dryRun=false&replace=false')).toEqual({ ok: true, dryRun: false, replace: false })
  })

  test.each(['1', 'True', 'TRUE', 'yes', 'on', '0', ''])('refuses dryRun=%j and names dryRun', (value) => {
    expect(parse(`dryRun=${value}`)).toEqual(refusal('dryRun'))
  })

  test('refuses a replace value that is not true or false and names replace', () => {
    expect(parse('replace=1')).toEqual(refusal('replace'))
    expect(parse('dryRun=true&replace=yes')).toEqual(refusal('replace'))
  })

  test('refuses a flag with no value', () => {
    expect(parse('dryRun')).toEqual(refusal('dryRun'))
  })

  test('refuses a mistyped name instead of treating it as absent', () => {
    expect(parse('dryrun=true')).toEqual(refusal('dryrun'))
    expect(parse('dry_run=true')).toEqual(refusal('dry_run'))
    expect(parse('dryRun=true&force=true')).toEqual(refusal('force'))
  })

  test('refuses a flag given twice, even with the same value', () => {
    expect(parse('dryRun=true&dryRun=false')).toEqual(refusal('dryRun'))
    expect(parse('replace=true&replace=true')).toEqual(refusal('replace'))
  })
})
