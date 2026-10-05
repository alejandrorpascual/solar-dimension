import { describe, expect, test } from 'vitest'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { computeProject, summarizeProjects } from './project-summary'
import type { Project } from './schema'
import { compute } from './sizing'

const project = (id: string, qty: Record<string, number>, patch: Partial<Project> = {}): Project => ({
  id, name: id, qty, custom: [], hours: 10, volts: 48, chemistry: 'lifepo4', batteryUnit: null, requester: null, updatedAt: 0, ...patch,
})

describe('computeProject', () => {
  test('sizes a saved project exactly as the kit step does', () => {
    const p = project('home', { fridge: 1, tv: 2 }, { hours: 6, volts: 24, batteryUnit: '24-100' })
    expect(computeProject(p, CATALOG_SNAPSHOT)).toEqual(
      compute({ qty: p.qty, custom: p.custom, hours: 6, volts: 24, chemistry: 'lifepo4', batteryUnit: '24-100' }, CATALOG_SNAPSHOT),
    )
  })
})

describe('summarizeProjects', () => {
  test('scales each load bar to the heaviest project', () => {
    const [light, heavy] = summarizeProjects([project('a', { tv: 1 }), project('b', { tv: 4 })], CATALOG_SNAPSHOT)
    expect(heavy!.loadShare).toBe(1)
    expect(light!.loadShare).toBeCloseTo(0.25)
  })

  test('lists the heaviest appliances first and counts the rest', () => {
    const [s] = summarizeProjects([project('a', { fridge: 1, tv: 1, router: 1, phone: 3, laptop: 1 })], CATALOG_SNAPSHOT)
    const watts = s!.heaviest.map((i) => i.totalWatts)
    expect(s!.heaviest).toHaveLength(3)
    expect(watts).toEqual([...watts].sort((x, y) => y - x))
    expect(s!.moreCount).toBe(2)
  })

  test('an empty project has no bar, no items and nothing more', () => {
    const [s] = summarizeProjects([project('empty', {})], CATALOG_SNAPSHOT)
    expect(s!.loadShare).toBe(0)
    expect(s!.heaviest).toEqual([])
    expect(s!.moreCount).toBe(0)
    expect(s!.result.empty).toBe(true)
  })

  test('keeps the store order and honours a smaller top list', () => {
    const list = summarizeProjects([project('x', { tv: 1, fridge: 1 }), project('y', { tv: 1 })], CATALOG_SNAPSHOT, 1)
    expect(list.map((s) => s.project.id)).toEqual(['x', 'y'])
    expect(list[0]!.heaviest).toHaveLength(1)
    expect(list[0]!.moreCount).toBe(1)
  })
})
