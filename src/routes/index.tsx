import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: () => (
    <main className="page">
      <h1>Kit builder</h1>
      <p className="muted">Coming together in the next tasks.</p>
    </main>
  ),
})
