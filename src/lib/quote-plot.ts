export interface PlotScale { min: number; max: number; ticks: number[]; pos: (v: number) => number }

const NICE_STEPS = [1, 2, 2.5, 5, 10]
const PADDING = 0.1

/** A price axis with round ticks around the quotes' totals; `pos` gives a value's left offset in percent. */
export function plotScale(values: readonly number[], tickCount = 5): PlotScale {
  if (values.length === 0) throw new Error('plotScale needs at least one value')
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || Math.max(Math.abs(hi) * 0.2, 1)
  const raw = (span * (1 + 2 * PADDING)) / (tickCount - 1)
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = (NICE_STEPS.find((s) => s * magnitude >= raw) ?? 10) * magnitude
  const min = Math.max(0, Math.floor((lo - span * PADDING) / step) * step)
  const count = Math.max(tickCount, Math.ceil((hi - min) / step) + 1)
  const ticks = Array.from({ length: count }, (_, i) => min + i * step)
  const max = ticks[ticks.length - 1]!
  return { min, max, ticks, pos: (v) => ((v - min) / (max - min)) * 100 }
}
