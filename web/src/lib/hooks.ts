import { useCallback, useEffect, useRef, useState } from 'react'

/** Subscribe to an SSE stream. `onOpen` fires on every (re)connect so the screen can
 *  reload its snapshot: if the connection drops, nothing is missed. */
export function useEventStream<T = unknown>(url: string | null, onEvent: (e: T) => void, onOpen?: () => void) {
  const handler = useRef(onEvent)
  const opener = useRef(onOpen)
  handler.current = onEvent
  opener.current = onOpen
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    if (!url) return
    const es = new EventSource(url)
    es.onmessage = (m) => {
      try {
        handler.current(JSON.parse(m.data))
      } catch {
        /* ignore malformed event */
      }
    }
    es.onopen = () => {
      setConnected(true)
      opener.current?.()
    }
    es.onerror = () => setConnected(false)
    return () => es.close()
  }, [url])
  return connected
}

/** Re-render every `ms` (clocks and countdowns). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/** Load data with a reload function; keeps the last good data while reloading. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const reload = useCallback(async () => {
    try {
      const d = await fnRef.current()
      setData(d)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    setLoading(true)
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, error, loading, reload, setData }
}

/** Debounced callback: many SSE events in a burst cause one reload. */
export function useDebounced(fn: () => void, ms = 150) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null)
  const f = useRef(fn)
  f.current = fn
  return useCallback(() => {
    if (t.current) clearTimeout(t.current)
    t.current = setTimeout(() => f.current(), ms)
  }, [ms])
}

/** Server-time offset so countdowns match the server even if the phone clock is off. */
export function useServerOffset(serverNow: string | null | undefined): number {
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    if (serverNow) setOffset(new Date(serverNow).getTime() - Date.now())
  }, [serverNow])
  return offset
}

export function useDeviceId(): string {
  const [id] = useState(() => {
    const k = 'mineit.deviceId'
    try {
      const old = localStorage.getItem(k)
      if (old) return old
      const v = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
      localStorage.setItem(k, v)
      return v
    } catch {
      return Math.random().toString(36).slice(2) + Date.now().toString(36)
    }
  })
  return id
}
