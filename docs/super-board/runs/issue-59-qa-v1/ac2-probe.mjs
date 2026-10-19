// Runs the real prepareQuoteFile (src/client/prepare-quote-file.ts, bundled by esbuild) in headless Chromium on small
// photos that carry a valid EXIF block with a GPS position, and reports what comes out.
// Usage: node ac2-probe.mjs <clone-root> <out-dir>
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const [root, outDir] = process.argv.slice(2)
if (!root || !outDir) throw new Error('usage: node ac2-probe.mjs <clone-root> <out-dir>')
mkdirSync(outDir, { recursive: true })

const requireFromRoot = createRequire(join(root, 'package.json'))
const { chromium } = requireFromRoot('@playwright/test')
const bundle = execFileSync(join(root, 'node_modules/.bin/esbuild'), [
  join(root, 'src/client/prepare-quote-file.ts'), '--bundle', '--format=iife', '--global-name=PQF',
], { encoding: 'utf8' })

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent('<!doctype html><title>probe</title>')
await page.addScriptTag({ content: bundle })

const result = await page.evaluate(async () => {
  // A minimal big-endian TIFF: IFD0 with Orientation and a GPS IFD pointer; the GPS IFD holds 10°28'50" N, 66°54'12" W.
  function exifApp1(orientation) {
    const tiff = new DataView(new ArrayBuffer(140))
    let o = 0
    const u16 = (v) => { tiff.setUint16(o, v); o += 2 }
    const u32 = (v) => { tiff.setUint32(o, v); o += 4 }
    u16(0x4d4d); u16(0x002a); u32(8)
    u16(2)
    u16(0x0112); u16(3); u32(1); u16(orientation); u16(0)
    u16(0x8825); u16(4); u32(1); u32(38)
    u32(0)
    u16(4)
    u16(0x0001); u16(2); u32(2); tiff.setUint8(o, 78); o += 4
    u16(0x0002); u16(5); u32(3); u32(92)
    u16(0x0003); u16(2); u32(2); tiff.setUint8(o, 87); o += 4
    u16(0x0004); u16(5); u32(3); u32(116)
    u32(0)
    for (const [n, d] of [[10, 1], [28, 1], [50, 1], [66, 1], [54, 1], [12, 1]]) { u32(n); u32(d) }
    const head = new Uint8Array([0xff, 0xe1, 0, 0, 0x45, 0x78, 0x69, 0x66, 0, 0])
    new DataView(head.buffer).setUint16(2, 2 + 6 + 140)
    return new Uint8Array([...head, ...new Uint8Array(tiff.buffer)])
  }
  async function photoWithExif(width, height, orientation) {
    const c = new OffscreenCanvas(width, height)
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#2a6'
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = '#c33'
    ctx.fillRect(0, 0, width / 4, height / 8)
    const plain = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer())
    return new File([plain.slice(0, 2), exifApp1(orientation), plain.slice(2)], 'phone-photo.jpeg', { type: 'image/jpeg' })
  }
  const has = (bytes, ascii) => {
    const needle = [...ascii].map((ch) => ch.charCodeAt(0))
    outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
      for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer
      return true
    }
    return false
  }
  const app1 = (bytes) => { for (let i = 0; i + 1 < bytes.length; i++) if (bytes[i] === 0xff && bytes[i + 1] === 0xe1) return true; return false }
  async function describe(file) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const bmp = await createImageBitmap(file)
    const d = { name: file.name, type: file.type, bytes: bytes.length, width: bmp.width, height: bmp.height,
      exifMarker: has(bytes, 'Exif'), app1Segment: app1(bytes), base64: btoa(String.fromCharCode(...bytes)) }
    bmp.close()
    return d
  }
  const cases = []
  for (const [label, w, h, orientation] of [['small-640x480-orientation-1', 640, 480, 1], ['small-640x480-orientation-6', 640, 480, 6]]) {
    const input = await photoWithExif(w, h, orientation)
    const output = await window.PQF.prepareQuoteFile(input)
    cases.push({ label, sameFileReturned: output === input, input: await describe(input), output: await describe(output) })
  }
  return cases
})
const chromiumVersion = browser.version()
await browser.close()

const summary = result.map(({ label, sameFileReturned, input, output }) => {
  writeFileSync(join(outDir, `ac2-${label}-input.jpg`), Buffer.from(input.base64, 'base64'))
  writeFileSync(join(outDir, `ac2-${label}-output.jpg`), Buffer.from(output.base64, 'base64'))
  const strip = ({ base64, ...rest }) => rest
  return { label, sameFileReturned, input: strip(input), output: strip(output) }
})
writeFileSync(join(outDir, 'ac2-probe.json'), `${JSON.stringify({ chromium: chromiumVersion, cases: summary }, null, 2)}\n`)
console.log(JSON.stringify(summary, null, 2))
