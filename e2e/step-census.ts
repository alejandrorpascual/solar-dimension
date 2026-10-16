import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import type { Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter'

const SHOWN = 15
const OUTSIDE_STEPS = '(outside steps: database helpers, plain awaits)'
const HELPER = /^(?:export )?(?:async )?function (\w+)|^(?:export )?const (\w+) = (?:async )?\(/
const TEST_START = /^\s*test(?:\.(?:before|after)(?:Each|All))?\(/

/**
 * Where the suite's time goes: every test's top-level steps (each awaited page call or expect, and the fixture hooks),
 * summed by the helper function they ran in, or by spec file for a test's own lines. Run it beside the usual reporter:
 * `npx playwright test --reporter=list,./e2e/step-census.ts`. A helper near the top is a cost many tests pay without
 * checking it, the first place to look when the suite slows down. Steps that run at once (a click awaited beside the
 * download it starts) each count in full, so the rows can add up to more than the total.
 */
export default class StepCensus implements Reporter {
  private readonly totals = new Map<string, number>()
  private readonly sources = new Map<string, string[]>()
  private summed = 0

  onTestEnd(_test: TestCase, result: TestResult): void {
    this.summed += result.duration
    const stepped = result.steps.reduce((sum, step) => sum + step.duration, 0)
    for (const step of result.steps) this.add(this.where(step), step.duration)
    this.add(OUTSIDE_STEPS, Math.max(0, result.duration - stepped))
  }

  onEnd(): void {
    const lines = [...this.totals].sort((a, b) => b[1] - a[1]).slice(0, SHOWN)
      .map(([where, ms]) => `${(ms / 1000).toFixed(0).padStart(6)} s ${((100 * ms) / this.summed).toFixed(1).padStart(5)} %  ${where}`)
    process.stdout.write(`\nStep census: ${(this.summed / 1000).toFixed(0)} s of test time in all\n${lines.join('\n')}\n`)
  }

  private add(where: string, ms: number): void {
    this.totals.set(where, (this.totals.get(where) ?? 0) + ms)
  }

  /** "e2e/quotes.ts › signUp()" for a step inside a helper, "e2e/x.spec.ts (test body)" for a test's own line. */
  private where(step: TestStep): string {
    if (!step.location) return `(${step.category}) ${step.title}`
    const file = relative(process.cwd(), step.location.file)
    const lines = this.sources.get(file) ?? readFileSync(step.location.file, 'utf8').split('\n')
    this.sources.set(file, lines)
    for (let i = step.location.line - 1; i >= 0 && !TEST_START.test(lines[i]); i--) {
      const helper = lines[i].match(HELPER)
      if (helper) return `${file} › ${helper[1] ?? helper[2]}()`
    }
    return `${file} (test body)`
  }
}
