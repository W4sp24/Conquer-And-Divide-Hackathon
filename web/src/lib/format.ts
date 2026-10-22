// One place for money and time formatting. Amounts are always centavos in, pesos out.
const peso2 = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const peso0 = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 })

export function peso(centavos: number | null | undefined, whole = false): string {
  const v = (centavos ?? 0) / 100
  return '₱' + (whole && Number.isInteger(v) ? peso0.format(v) : peso2.format(v))
}

export function toCentavos(input: string): number | null {
  const clean = input.replace(/[₱,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null
  return Math.round(parseFloat(clean) * 100)
}

export function clock(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
}

export function clockSec(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit' })
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h}h ago` : dateTime(iso)
}

export function duration(ms: number): string {
  if (ms <= 0) return '0:00'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`
}
