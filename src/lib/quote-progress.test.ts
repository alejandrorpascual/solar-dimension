import { describe, expect, test } from 'vitest'
import { en } from '../i18n/en'
import { es } from '../i18n/es'
import { MAX_RETRIES } from './quote-guards'
import { handoffRowMeta, handoffRowState, handoffSummary, readSteps, readyInText, stepLabel, triesLeftText } from './quote-progress'

describe('handoffRowState', () => {
  test('a refused upload is rejected, whatever the job says', () => {
    expect(handoffRowState({ state: 'rejected' }, null)).toBe('rejected')
  })
  test('a file still uploading, or waiting for or being read, is working', () => {
    expect(handoffRowState({ state: 'uploading' }, null)).toBe('working')
    expect(handoffRowState({ state: 'accepted' }, null)).toBe('working')
    expect(handoffRowState({ state: 'accepted' }, 'queued')).toBe('working')
    expect(handoffRowState({ state: 'accepted' }, 'processing')).toBe('working')
  })
  test('a finished read is done, to check, or failed', () => {
    expect(handoffRowState({ state: 'accepted' }, 'ready')).toBe('done')
    expect(handoffRowState({ state: 'accepted' }, 'needs_review')).toBe('review')
    expect(handoffRowState({ state: 'accepted' }, 'failed')).toBe('failed')
  })
})

describe('handoffSummary', () => {
  test('counts what is reading, what needs attention and what is read, leaving out empty groups', () => {
    expect(handoffSummary(en, ['working', 'failed'])).toBe('1 reading · 1 needs your attention')
    expect(handoffSummary(en, ['working', 'working', 'rejected', 'review', 'done'])).toBe('2 reading · 2 need your attention · 1 read')
    expect(handoffSummary(en, ['done', 'done'])).toBe('2 read')
    expect(handoffSummary(en, [])).toBe('')
  })
  test('in Spanish', () => {
    expect(handoffSummary(es, ['working', 'failed'])).toBe('1 leyendo · 1 necesita tu atención')
    expect(handoffSummary(es, ['failed', 'rejected', 'done'])).toBe('2 necesitan tu atención · 1 leída')
  })
})

describe('handoffRowMeta', () => {
  test('a working file says what it is doing, about how long it takes, and how long it has taken so far', () => {
    expect(handoffRowMeta(en, 'working', 'processing', null, 12)).toBe('Reading · about 30 s · 0:12 so far')
    expect(handoffRowMeta(es, 'working', 'queued', null, 0)).toBe('En espera · unos 30 s · 0:00 hasta ahora')
    expect(handoffRowMeta(en, 'working', 'uploading', null, 75)).toBe('Uploading · about 30 s · 1:15 so far')
  })
  test('a finished file says how it ended; a refused one says why', () => {
    expect(handoffRowMeta(en, 'failed', 'failed', null, 40)).toBe("Couldn't read it")
    expect(handoffRowMeta(en, 'done', 'ready', null, 40)).toBe('Read')
    expect(handoffRowMeta(en, 'review', 'needs_review', null, 40)).toBe('Check the numbers')
    expect(handoffRowMeta(en, 'rejected', 'uploading', { code: 'type' }, 0)).toBe(en.quotes.errType)
    expect(handoffRowMeta(en, 'rejected', 'uploading', null, 0)).toBe(en.quotes.errUpload)
  })
})

describe('readSteps', () => {
  test('a quote waiting for or being read has uploaded, is being read, and is not compared yet', () => {
    for (const status of ['queued', 'processing'] as const) {
      expect(readSteps(status)).toEqual([
        { id: 'uploaded', state: 'done' }, { id: 'read', state: 'active' }, { id: 'compared', state: 'todo' },
      ])
    }
  })
  test('a failed quote stops at the read, which failed', () => {
    expect(readSteps('failed')).toEqual([{ id: 'uploaded', state: 'done' }, { id: 'read', state: 'failed' }])
  })
})

describe('stepLabel', () => {
  test('names each step; the read step says whether it is waiting, reading or failed', () => {
    expect(stepLabel(en, { id: 'uploaded', state: 'done' }, 'processing')).toBe('Uploaded')
    expect(stepLabel(en, { id: 'read', state: 'active' }, 'queued')).toBe('Waiting')
    expect(stepLabel(en, { id: 'read', state: 'active' }, 'processing')).toBe('Reading')
    expect(stepLabel(en, { id: 'read', state: 'failed' }, 'failed')).toBe("Couldn't read it")
    expect(stepLabel(es, { id: 'compared', state: 'todo' }, 'processing')).toBe('Comparada con tu kit')
  })
})

describe('triesLeftText and readyInText', () => {
  test('counts the retries a failed quote has left', () => {
    expect(triesLeftText(en, 0)).toBe(`${MAX_RETRIES} tries left`)
    expect(triesLeftText(en, MAX_RETRIES - 1)).toBe('1 try left')
    expect(triesLeftText(es, 1)).toBe('Te quedan 2 intentos')
    expect(triesLeftText(es, MAX_RETRIES - 1)).toBe('Te queda 1 intento')
  })
  test('says about when a quote being read will be ready, and how long it has taken so far', () => {
    expect(readyInText(en, 0)).toBe('Ready in about 30 s · 0:00 so far')
    expect(readyInText(es, 47)).toBe('Lista en unos 30 s · 0:47 hasta ahora')
  })
})
