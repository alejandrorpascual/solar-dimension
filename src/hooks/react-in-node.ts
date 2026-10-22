// For hook tests that run React in node: a component that renders nothing runs its hooks and effects under act(),
// with no DOM library.

/** Lets React render under act() in node: react-dom reads `window`, and act() warns unless the flag is set. */
export function prepareReactInNode(): void {
  const g = globalThis as Record<string, unknown>
  g.window = g
  g.IS_REACT_ACT_ENVIRONMENT = true
}

const noop = () => {}

/** As much of a DOM node as React needs to render a component that returns null: the container for createRoot. */
export function stubContainer(): Element {
  const doc: Record<string, unknown> = { nodeType: 9, addEventListener: noop, removeEventListener: noop }
  const el: Record<string, unknown> = {
    nodeType: 1, nodeName: 'DIV', tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml', ownerDocument: doc,
    addEventListener: noop, removeEventListener: noop, appendChild: noop, removeChild: noop, insertBefore: noop,
    firstChild: null, lastChild: null, childNodes: [], textContent: '', contains: () => false,
  }
  Object.assign(doc, { documentElement: el, body: el, activeElement: el, defaultView: { document: doc, HTMLIFrameElement: class {} } })
  return el as unknown as Element
}
