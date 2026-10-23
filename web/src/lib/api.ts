// Fetch wrapper. Seller screens send the demo seller key; buyer/viewer pages send nothing.
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api'
const KEY_STORE = 'mineit.sellerKey'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function getSellerKey(): string {
  try {
    return localStorage.getItem(KEY_STORE) || (import.meta.env.VITE_SELLER_KEY as string) || ''
  } catch {
    return (import.meta.env.VITE_SELLER_KEY as string) || ''
  }
}

export function setSellerKey(k: string) {
  try {
    localStorage.setItem(KEY_STORE, k)
  } catch {
    /* private mode: key lives for this tab only */
  }
}

function detail(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const d = (body as { detail: unknown }).detail
    if (typeof d === 'string') return d
    if (Array.isArray(d) && d[0]?.msg) return String(d[0].msg).replace(/^Value error, /, '')
  }
  return status === 0 ? 'Can’t reach the server. Check the connection.' : `Request failed (${status})`
}

async function request<T>(method: string, path: string, body?: unknown, seller = false): Promise<T> {
  const headers: Record<string, string> = {}
  if (seller) headers['X-Seller-Key'] = getSellerKey()
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetch(BASE + path, { method, headers, body: payload })
  } catch {
    throw new ApiError(0, detail(null, 0))
  }
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) throw new ApiError(res.status, detail(data, res.status))
  return data as T
}

export const seller = {
  get: <T>(p: string) => request<T>('GET', p, undefined, true),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}, true),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}, true),
  del: <T>(p: string) => request<T>('DELETE', p, undefined, true),
  upload: <T>(p: string, f: FormData) => request<T>('POST', p, f, true),
}

export const pub = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
}

export function streamUrl(path: string, withKey = false): string {
  const q = withKey ? `${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(getSellerKey())}` : ''
  return BASE + path + q
}

export async function downloadWithKey(path: string, filename: string) {
  const res = await fetch(BASE + path, { headers: { 'X-Seller-Key': getSellerKey() } })
  if (!res.ok) throw new ApiError(res.status, 'Download failed')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
