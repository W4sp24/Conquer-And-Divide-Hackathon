import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { Button, Card, Code, cx, Empty, PageHeader, Select, Spinner } from '../components/ui'
import { seller, streamUrl } from '../lib/api'
import { clock, dateTime, peso } from '../lib/format'
import { useDebounced, useEventStream, useLoad } from '../lib/hooks'
import type { Score, Session } from '../lib/types'

interface Data {
  session: Session | null
  kpis: { label: string; value?: number; value_centavos?: number; sub: string }[]
  bars: { start: string; value_centavos: number; orders: number; top: string | null }[]
  funnel: { label: string; count: number }[]
  score: Score
  checks: { RELEASE: number; HOLD: number; PENDING: number }
  verified: number
  caught_count: number
  caught_centavos: number
  statement_uploaded: boolean
  items: { code: string; name: string; claimed: number; waiting: number; value_centavos: number; status: string }[]
  orders_total: number
}

export default function Insights() {
  const nav = useNavigate()
  const [sid, setSid] = useState<string>('')
  const sessions = useLoad(() => seller.get<Session[]>('/sessions'))
  const { data, loading, reload } = useLoad(() => seller.get<Data>(`/insights${sid ? `?session_id=${sid}` : ''}`), [sid])
  useEventStream(streamUrl('/seller/stream', true), useDebounced(reload, 500))

  if (loading && !data) return <div className="grid min-h-[60vh] place-items-center"><Spinner /></div>
  if (!data?.session) return <div className="p-10"><Empty icon="insights" title="No lives yet" body="Insights fill in as soon as your first live has comments." action={<Button onClick={() => nav('/seller/sessions')}>Go live</Button>} /></div>

  const s = data.session
  const maxBar = Math.max(1, ...data.bars.map((b) => b.value_centavos))
  const best = data.bars.reduce((a, b) => (b.value_centavos > a.value_centavos ? b : a), data.bars[0])
  const top = Math.max(1, data.funnel[0]?.count ?? 1)
  const sc = data.score
  const read = sc.rules + sc.fuzzy + sc.llm
  return (
    <div className="mx-auto max-w-[1120px] px-5 py-8 lg:px-10">
      <PageHeader title="Insights" sub={`${s.title}, started ${dateTime(s.started_at || s.created_at)}. Updates as orders move.`}>
        {sessions.data && sessions.data.length > 1 && (
          <Select value={sid || s.id} onChange={(e) => setSid(e.target.value)} aria-label="Live" className="w-[260px]">
            {sessions.data.map((x) => <option key={x.id} value={x.id}>{x.title} · {dateTime(x.started_at || x.created_at)}</option>)}
          </Select>
        )}
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {data.kpis.map((k) => (
          <Card key={k.label} className="px-5 py-4">
            <div className="text-[13px] font-medium text-muted">{k.label}</div>
            <div className="font-display text-[28px] font-bold leading-tight tabular">{k.value_centavos !== undefined ? peso(k.value_centavos, true) : k.value}</div>
            <div className="text-[12.5px] text-muted">{k.sub}</div>
          </Card>
        ))}
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="text-[17px] font-bold">Order value every 10 minutes</h2>
            {best && best.value_centavos > 0 && <span className="text-[13px] text-muted">Best: <b className="text-ink">{clock(best.start)}</b> · {peso(best.value_centavos, true)}</span>}
          </div>
          {data.bars.every((b) => !b.value_centavos) ? <Empty icon="insights" title="No orders yet" /> : <Bars bars={data.bars} max={maxBar} />}
        </Card>
        <Card className="p-5">
          <h2 className="mb-1 text-[17px] font-bold">How comments were read</h2>
          <p className="mb-4 text-[13px] text-muted">{read} of {sc.total} comments became orders or cancels without the seller touching them.</p>
          {[{ k: 'Rules', v: sc.rules, note: '“mine B12”, “m”, “cancel B3”' }, { k: 'Fuzzy match', v: sc.fuzzy, note: 'typos and names: “blu polo”' },
            { k: 'AI', v: sc.llm, note: 'messy Taglish', ai: true }, { k: 'Fixed by you', v: sc.fixed, note: 'from Needs you' },
            { k: 'Chat, not orders', v: sc.ignored, note: 'greetings, questions' }].map((r) => (
            <div key={r.k} className="mb-2.5 last:mb-0">
              <div className="flex items-baseline justify-between text-[13.5px]"><span><b>{r.k}</b> <span className="text-muted">· {r.note}</span></span><span className="font-semibold tabular">{r.v}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-sunken"><div className={cx('h-full rounded-full', r.ai ? 'bg-ai' : 'bg-brand')} style={{ width: `${(r.v / Math.max(1, sc.total)) * 100}%` }} /></div>
            </div>
          ))}
        </Card>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 text-[17px] font-bold">From comment to shipped</h2>
          {data.funnel.map((f, i) => (
            <div key={f.label} className="mb-3 last:mb-0">
              <div className="flex items-baseline justify-between text-[14px]">
                <span className="font-medium">{f.label}</span>
                <span><span className="text-muted">{i ? `${Math.round((f.count / top) * 100)}% · ` : ''}</span><b className="tabular">{f.count}</b></span>
              </div>
              <div className="mt-1 h-2.5 rounded-full bg-sunken"><div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${(f.count / top) * 100}%` }} /></div>
            </div>
          ))}
        </Card>
        <Card className="p-5">
          <h2 className="mb-4 text-[17px] font-bold">Payment checks</h2>
          {!data.statement_uploaded && data.checks.PENDING + data.checks.HOLD + data.checks.RELEASE === 0 && data.verified === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-xl bg-sunken p-4 text-[14px] text-ink-2">
              Upload a statement in Payments to see what checks out.
              <Button variant="outline" size="sm" onClick={() => nav('/seller/payments')}>Go to Payments</Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                {[{ w: 'Release', n: data.checks.RELEASE, cls: 'text-brand-deep', icon: 'check' as const, note: 'match, waiting for you' },
                  { w: 'Hold', n: data.checks.HOLD, cls: 'text-hold', icon: 'alert' as const, note: 'a check failed' },
                  { w: 'Pending', n: data.checks.PENDING, cls: 'text-pending', icon: 'clock' as const, note: 'needs a newer statement' }].map((c) => (
                  <div key={c.w} className="rounded-xl border border-line px-3 py-2.5">
                    <div className={cx('flex items-center gap-1 text-[13px] font-bold', c.cls)}><Icon name={c.icon} size={14} />{c.w}</div>
                    <div className="font-display text-[24px] font-bold tabular">{c.n}</div>
                    <div className="text-[12px] text-muted">{c.note}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-4 rounded-xl bg-hold-soft px-4 py-3">
                <Icon name="shield" size={26} className="text-hold" />
                <div>
                  <div className="text-[13px] font-semibold text-hold-deep">Stopped before shipping</div>
                  <div className="font-display text-[22px] font-bold text-hold-deep">{peso(data.caught_centavos, true)}</div>
                  <div className="text-[12.5px] text-hold-deep/80">{data.caught_count} payment{data.caught_count === 1 ? '' : 's'} on hold or rejected · {data.verified} verified</div>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-baseline justify-between px-5 pb-2 pt-4">
          <h2 className="text-[17px] font-bold">Items this live</h2>
          <span className="text-[13px] text-muted">Most claimed first</span>
        </div>
        {!data.items.length ? <Empty icon="catalog" title="No items claimed yet" /> : (
          <table className="w-full text-[14px]">
            <thead><tr className="border-y border-line bg-sunken/50 text-left text-[12.5px] text-muted">
              <th className="px-5 py-2 font-semibold">Code</th><th className="py-2 font-semibold">Item</th><th className="py-2 text-right font-semibold">Claims</th>
              <th className="py-2 text-right font-semibold">Waiting</th><th className="py-2 text-right font-semibold">Value</th><th className="px-5 py-2 text-right font-semibold">Stock</th></tr></thead>
            <tbody className="divide-y divide-line">
              {data.items.map((it) => (
                <tr key={it.code}>
                  <td className="px-5 py-2.5"><Code>{it.code}</Code></td><td className="py-2.5">{it.name}</td>
                  <td className="py-2.5 text-right tabular">{it.claimed}</td><td className="py-2.5 text-right tabular">{it.waiting || '—'}</td>
                  <td className="py-2.5 text-right font-semibold tabular">{peso(it.value_centavos, true)}</td>
                  <td className={cx('px-5 py-2.5 text-right', it.status === 'Sold out' ? 'font-semibold text-hold' : 'text-muted')}>{it.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}

function Bars({ bars, max }: { bars: Data['bars']; max: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const nice = Math.ceil(max / 100 / 500) * 500 * 100 || max
  return (
    <div className="relative">
      <div className="flex h-[190px] items-end gap-[2px] border-b border-line-2 pl-12" role="img" aria-label="Order value per 10 minutes">
        <div className="pointer-events-none absolute left-0 top-0 flex h-[190px] flex-col justify-between text-[11.5px] text-faint tabular">
          <span>{peso(nice, true)}</span><span>{peso(nice / 2, true)}</span><span>₱0</span>
        </div>
        {bars.map((b, i) => (
          <div key={b.start} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className={cx('w-full max-w-[56px] mx-auto rounded-t-[4px] transition-colors', hover === i ? 'bg-brand-deep' : 'bg-brand')}
              style={{ height: `${Math.max(b.value_centavos ? 2 : 0, (b.value_centavos / nice) * 100)}%` }} />
            {hover === i && (
              <div className="absolute bottom-full left-1/2 z-10 mb-2 w-max -translate-x-1/2 rounded-lg bg-ink px-3 py-2 text-[12.5px] text-white shadow-lg">
                <b>{clock(b.start)}</b> · {peso(b.value_centavos, true)}<br />{b.orders} order{b.orders === 1 ? '' : 's'}{b.top ? ` · top ${b.top}` : ''}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[2px] pl-12 text-[11.5px] text-muted">
        {bars.map((b, i) => <span key={b.start} className="flex-1 text-center tabular">{i % Math.ceil(bars.length / 8) === 0 ? clock(b.start) : ''}</span>)}
      </div>
    </div>
  )
}
