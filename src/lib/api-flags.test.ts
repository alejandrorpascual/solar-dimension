import { describe, expect, test } from 'vitest'
import { parseWriteFlags } from './api-flags'

const parse = (query: string) => parseWriteFlags(new URLSearchParams(query), ['dryRun', 'replace'])
const refusal = (name: string) => ({ ok: false, error: expect.stringContaining(`"${name}"`) })

describe('parseWriteFlags for a route that takes dryRun and replace', () => {
  test('no parameters means a real write that does not replace', () => {
    expect(parse('')).toEqual({ ok: true, flags: { dryRun: false, replace: false } })
  })

  test('reads dryRun and replace as true or false', () => {
    expect(parse('dryRun=true')).toEqual({ ok: true, flags: { dryRun: true, replace: false } })
    expect(parse('replace=true')).toEqual({ ok: true, flags: { dryRun: false, replace: true } })
    expect(parse('dryRun=true&replace=true')).toEqual({ ok: true, flags: { dryRun: true, replace: true } })
    expect(parse('dryRun=false&replace=false')).toEqual({ ok: true, flags: { dryRun: false, replace: false } })
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

describe('parseWriteFlags for a route that takes only dryRun', () => {
  const parseDryRun = (query: string) => parseWriteFlags(new URLSearchParams(query), ['dryRun'])

  test('no parameters means a real write', () => {
    expect(parseDryRun('')).toEqual({ ok: true, flags: { dryRun: false } })
  })

  test('reads dryRun as true or false', () => {
    expect(parseDryRun('dryRun=true')).toEqual({ ok: true, flags: { dryRun: true } })
    expect(parseDryRun('dryRun=false')).toEqual({ ok: true, flags: { dryRun: false } })
  })

  test.each(['1', 'True', 'yes', ''])('refuses dryRun=%j instead of writing', (value) => {
    expect(parseDryRun(`dryRun=${value}`)).toEqual(refusal('dryRun'))
  })

  test('refuses a flag another route takes, a mistyped name and a flag given twice', () => {
    expect(parseDryRun('replace=true')).toEqual(refusal('replace'))
    expect(parseDryRun('dry_run=true')).toEqual(refusal('dry_run'))
    expect(parseDryRun('dryRun=true&dryRun=true')).toEqual(refusal('dryRun'))
  })

  test('a refusal says which flag the route does take', () => {
    expect(parseDryRun('dryrun=true')).toEqual({ ok: false, error: expect.stringContaining('use dryRun') })
  })
})

describe('parseWriteFlags for a route that takes no flag', () => {
  const parseNone = (query: string) => parseWriteFlags(new URLSearchParams(query), [])

  test('no parameters is fine', () => {
    expect(parseNone('')).toEqual({ ok: true, flags: {} })
  })

  test('refuses any parameter, so a dry run that does not exist is never a real write', () => {
    expect(parseNone('dryRun=true')).toEqual(refusal('dryRun'))
    expect(parseNone('dryRun=true')).toEqual({ ok: false, error: expect.stringContaining('takes no query parameters') })
  })
})

describe('parseWriteFlags keeps flags apart from its own answer', () => {
  test('a flag may be called ok or error without changing what the answer means', () => {
    const parseOdd = (query: string) => parseWriteFlags(new URLSearchParams(query), ['ok', 'error'])

    expect(parseOdd('')).toEqual({ ok: true, flags: { ok: false, error: false } })
    expect(parseOdd('ok=true')).toEqual({ ok: true, flags: { ok: true, error: false } })
    expect(parseOdd('ok=maybe')).toEqual({ ok: false, error: expect.stringContaining('"ok"') })
  })
})
