const KW_THRESHOLD = 10000

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

export function fmtW(w: number): string {
  return w >= KW_THRESHOLD ? `${(w / 1000).toFixed(1)} kW` : `${fmtInt(w)} W`
}

export function fmtKwh(wh: number): string {
  return `${(wh / 1000).toFixed(1)} kWh`
}

export function fmtHours(h: number): string {
  return `${Math.round(h * 10) / 10} h`
}
