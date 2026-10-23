import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { BRAND } from '../brand'
import { DemoBadge, DemoBanner } from '../components/Demo'
import { Icon, type IconName } from '../components/Icon'
import { Button, cx, Field, Input, Spinner } from '../components/ui'
import { ApiError, getSellerKey, seller, setSellerKey, streamUrl } from '../lib/api'
import { useDebounced, useEventStream } from '../lib/hooks'
import type { Session, SellerSettings } from '../lib/types'

interface Ctx {
  me: SellerSettings
  live: Session | null           // the running session, if any
  counts: { toCheck: number; toPack: number; review: number }
  refresh: () => void
}
const SellerCtx = createContext<Ctx | null>(null)
export const useSeller = () => useContext(SellerCtx)!

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#17806A" />
        <path d="M8 10.5A2.5 2.5 0 0 1 10.5 8h11A2.5 2.5 0 0 1 24 10.5v7a2.5 2.5 0 0 1-2.5 2.5H15l-4.5 4v-4A2.5 2.5 0 0 1 8 17.5z" fill="#fff" />
        <path d="m12.5 14 2.4 2.4 4.6-4.8" fill="none" stroke="#17806A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={cx('font-display text-[18px] font-bold tracking-tight', dark ? 'text-white' : 'text-ink')}>{BRAND.name}</span>
    </span>
  )
}

function KeyGate({ onDone }: { onDone: () => void }) {
  const [key, setKey] = useState(getSellerKey() || '')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setSellerKey(key.trim())
    try {
      await seller.get('/seller')
      onDone()
    } catch (x) {
      setErr(x instanceof ApiError && x.status === 401 ? 'That key doesn’t match the one set on the server.' : (x as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid min-h-screen place-items-center bg-bg p-6">
      <form onSubmit={submit} className="w-full max-w-[380px] rounded-2xl border border-line bg-surface p-7 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between"><Logo /><DemoBadge /></div>
        <h1 className="mt-6 text-[22px] font-bold">Open your seller desk</h1>
        <p className="mt-1 text-[14px] text-muted">Enter the seller key from the server’s settings (<code className="font-mono text-[12.5px]">SELLER_KEY</code>). The demo key is <code className="font-mono text-[12.5px]">demo-seller-key</code>.</p>
        <Field label="Seller key" error={err} className="mt-5">
          <Input value={key} onChange={(e) => setKey(e.target.value)} autoFocus placeholder="demo-seller-key" aria-label="Seller key" />
        </Field>
        <Button className="mt-5 w-full" size="lg" loading={busy} disabled={!key.trim()}>Open desk</Button>
      </form>
    </div>
  )
}

const NAV: { to: string; label: string; icon: IconName; count?: keyof Ctx['counts'] }[] = [
  { to: 'live', label: 'Live', icon: 'live', count: 'review' },
  { to: 'payments', label: 'Payments', icon: 'pay', count: 'toCheck' },
  { to: 'packing', label: 'Packing', icon: 'pack', count: 'toPack' },
  { to: 'insights', label: 'Insights', icon: 'insights' },
  { to: 'catalog', label: 'Catalog', icon: 'catalog' },
  { to: 'buyers', label: 'Buyers', icon: 'buyers' },
  { to: 'settings', label: 'Settings', icon: 'settings' },
]

export function SellerLayout() {
  const [state, setState] = useState<'checking' | 'locked' | 'open'>('checking')
  const [me, setMe] = useState<SellerSettings | null>(null)
  const [live, setLive] = useState<Session | null>(null)
  const [counts, setCounts] = useState({ toCheck: 0, toPack: 0, review: 0 })
  const loc = useLocation()

  const refresh = useCallback(async () => {
    try {
      const [m, sessions, pay, pack] = await Promise.all([
        seller.get<SellerSettings>('/seller'),
        seller.get<Session[]>('/sessions'),
        seller.get<{ to_check: unknown[] }>('/payments'),
        seller.get<{ totals: { to_pack: number } }>('/packing'),
      ])
      setMe(m)
      const running = sessions.find((s) => s.status === 'running') ?? null
      setLive(running)
      let review = 0
      if (running) {
        const b = await seller.get<{ review: unknown[] }>(`/sessions/${running.id}/board`)
        review = b.review.length
      }
      setCounts({ toCheck: pay.to_check.length, toPack: pack.totals.to_pack, review })
      setState('open')
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState('locked')
      else setState((s) => (s === 'checking' ? 'open' : s))
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])
  const debounced = useDebounced(refresh, 400)
  useEventStream(state === 'open' ? streamUrl('/seller/stream', true) : null, debounced)
  useEffect(() => { if (state === 'open') debounced() }, [loc.pathname, state, debounced])

  if (state === 'checking') return <div className="grid min-h-screen place-items-center"><Spinner size={22} /></div>
  if (state === 'locked' || !me) return <KeyGate onDone={() => { setState('checking'); refresh() }} />

  const liveTo = live ? `live/${live.id}` : 'sessions'
  return (
    <SellerCtx.Provider value={{ me, live, counts, refresh }}>
      <div className="min-h-screen lg:grid lg:grid-cols-[224px_minmax(0,1fr)] print:block">
        <aside className="sticky top-0 z-30 flex print:hidden items-center gap-3 border-b border-line bg-surface px-4 py-2.5 lg:h-screen lg:flex-col lg:items-stretch lg:gap-6 lg:border-b-0 lg:border-r lg:px-3 lg:py-5">
          <div className="px-2 lg:pb-1"><Logo /></div>
          <nav className="flex flex-1 gap-1 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Seller">
            {NAV.map((n) => {
              const to = n.to === 'live' ? liveTo : n.to
              const c = n.count ? counts[n.count] : 0
              return (
                <NavLink key={n.to} to={to}
                  className={({ isActive }) => cx('group flex h-10 shrink-0 items-center gap-2.5 rounded-[10px] px-3 text-[14.5px] font-medium transition',
                    isActive || (n.to === 'live' && (loc.pathname.includes('/live/') || loc.pathname.endsWith('/sessions')))
                      ? 'bg-brand-soft text-brand-deep' : 'text-ink-2 hover:bg-sunken')}>
                  <Icon name={n.icon} size={18} />
                  <span className="whitespace-nowrap">{n.label}</span>
                  {n.to === 'live' && live && <span className="live-dot ml-auto h-2 w-2 rounded-full bg-hold" aria-label="live now" />}
                  {c > 0 && <span className={cx('rounded-full px-1.5 text-[11.5px] font-bold tabular', n.to === 'live' && live ? 'ml-1.5' : 'ml-auto', n.count === 'review' ? 'bg-pending-soft text-pending-deep' : 'bg-ink text-white')}>{c}</span>}
                </NavLink>
              )
            })}
          </nav>
          <div className="hidden lg:block">
            <NavLink to="sessions" className="mb-3 flex h-10 items-center justify-center gap-2 rounded-[10px] border border-line-2 text-[14px] font-semibold text-ink hover:bg-sunken">
              <Icon name="video" size={17} />{live ? 'Lives' : 'Go live'}
            </NavLink>
            <div className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-sand font-display font-bold text-ink">{me.name.slice(0, 1)}</span>
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-[14px] font-semibold">{me.name}</span>
                <span className="block truncate text-[12.5px] text-muted">{me.shop_name}</span>
              </span>
            </div>
          </div>
        </aside>
        <main className="min-w-0">
          <DemoBanner />
          <Outlet />
        </main>
      </div>
    </SellerCtx.Provider>
  )
}

export function SellerHome() {
  const { live } = useSeller()
  return <Navigate to={live ? `/seller/live/${live.id}` : '/seller/sessions'} replace />
}
