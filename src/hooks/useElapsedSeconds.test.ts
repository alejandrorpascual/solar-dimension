import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { prepareReactInNode, stubContainer } from './react-in-node'
import { useElapsedSeconds } from './useElapsedSeconds'

// Issue #144: while a quote is read, every reading screen shows how long it has taken so far, so the screen changes
// even when Reduce Motion stops its spinner. This hook is the clock behind that line.

let root: Root | null = null
let seconds: number | null = null

function Probe({ isRunning }: { isRunning: boolean }): null {
  seconds = useElapsedSeconds(isRunning)
  return null
}

async function render(isRunning: boolean): Promise<void> {
  root ??= createRoot(stubContainer())
  const mounted = root
  await act(async () => { mounted.render(createElement(Probe, { isRunning })) })
}

async function wait(ms: number): Promise<void> {
  await act(async () => { vi.advanceTimersByTime(ms) })
}

beforeEach(() => {
  prepareReactInNode()
  vi.useFakeTimers()
})

afterEach(async () => {
  const mounted = root
  if (mounted) await act(async () => mounted.unmount())
  root = null
  seconds = null
  vi.useRealTimers()
})

test('counts the whole seconds since the read started, so two looks 2 s apart differ', async () => {
  await render(true)
  expect(seconds).toBe(0)
  await wait(2000)
  expect(seconds).toBe(2)
  await wait(61_000)
  expect(seconds).toBe(63)
})

test('stands at 0 while nothing is being read', async () => {
  await render(false)
  await wait(5000)
  expect(seconds).toBe(0)
})

test('starts again from 0 when a new read starts after the last one ended', async () => {
  await render(true)
  await wait(7000)
  expect(seconds).toBe(7)
  await render(false)
  expect(seconds).toBe(0)
  await wait(3000)
  await render(true)
  expect(seconds).toBe(0)
  await wait(1000)
  expect(seconds).toBe(1)
})
