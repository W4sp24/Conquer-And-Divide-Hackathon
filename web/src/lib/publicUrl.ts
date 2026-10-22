import { pub } from './api'

// QR codes must open on a phone, so "localhost" is no good. Use, in order:
// PUBLIC_WEB_URL from the backend, VITE_PUBLIC_URL, the page origin when it isn't
// localhost, or the laptop's LAN IP (phones on the same Wi-Fi).
let cached: Promise<string> | null = null

export function publicBase(): Promise<string> {
  if (cached) return cached
  cached = (async () => {
    const env = (import.meta.env.VITE_PUBLIC_URL as string | undefined)?.replace(/\/$/, '')
    try {
      const n = await pub.get<{ lan_ip: string | null; public_web_url: string | null }>('/net')
      if (n.public_web_url) return n.public_web_url.replace(/\/$/, '')
      if (env) return env
      const { protocol, hostname, port } = window.location
      const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
      if (!local) return window.location.origin
      if (n.lan_ip) return `${protocol}//${n.lan_ip}${port ? ':' + port : ''}`
    } catch {
      if (env) return env
    }
    return window.location.origin
  })()
  return cached
}
