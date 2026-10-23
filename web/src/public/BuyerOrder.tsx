import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { BRAND } from '../brand'
import { DemoBadge } from '../components/Demo'
import { Icon } from '../components/Icon'
import { ItemThumb } from '../components/ItemThumb'
import { QR } from '../components/QR'
import { Button, Code, cx, Spinner, Stepper } from '../components/ui'
import { pub, streamUrl } from '../lib/api'
import { clock, dateTime, duration, peso } from '../lib/format'
import { useEventStream, useNow, useServerOffset } from '../lib/hooks'
import { publicBase } from '../lib/publicUrl'
import type { BuyerOrder as O } from '../lib/types'

export function PhoneShell({ shop, children, tag = 'Private link' }: { shop: string; children: React.ReactNode; tag?: string }) {
  return (
    <div className="min-h-[100dvh] bg-bg">
      <div className="mx-auto flex min-h-[100dvh] max-w-[440px] flex-col bg-surface sm:my-6 sm:min-h-0 sm:rounded-[22px] sm:border sm:border-line sm:shadow-[var(--shadow-card)]">
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <span className="truncate font-display text-[17px] font-bold">{shop}</span>
          <span className="flex items-center gap-1.5">
            <DemoBadge />
            <span className="inline-flex items-center gap-1 rounded-full bg-sunken px-2.5 py-1 text-[12px] font-semibold text-ink-2"><Icon name="shield" size={13} />{tag}</span>
          </span>
        </header>
        <div className="flex-1 px-5 pb-6 pt-5">{children}</div>
        <footer className="border-t border-line px-5 py-3 text-center text-[12px] text-faint">Powered by {BRAND.name} · {BRAND.event} prototype</footer>
      </div>
    </div>
  )
}

export default function BuyerOrder() {
  const { token = '' } = useParams()
  const [o, setO] = useState<O | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { setO(await pub.get<O>(`/buyer/${token}`)); setErr(null) } catch (e) { setErr((e as Error).message) }
  }, [token])
  useEffect(() => { load() }, [load])
  const live = useEventStream(streamUrl(`/buyer/${token}/stream`), load, load)
  useEffect(() => {                       // backup poll if the stream is blocked by a proxy
    if (live) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [live, load])

  if (err && !o) return <PhoneShell shop="Order"><div className="py-16 text-center"><Icon name="alert" size={28} className="mx-auto text-muted" /><p className="mt-3 font-semibold">We couldn’t find this order</p><p className="text-[14px] text-muted">Check the link the seller sent you.</p></div></PhoneShell>
  if (!o) return <PhoneShell shop="Order"><div className="grid py-20 place-items-center"><Spinner size={22} /></div></PhoneShell>
  return (
    <PhoneShell shop={o.shop_name}>
      <p className="mb-4 text-[14px] text-muted">Hi {o.buyer_name.split(' ')[0]}! This page is only for your order.</p>
      {o.status === 'CLAIMED' && <Claimed o={o} token={token} onChange={setO} />}
      {o.status === 'WAITLISTED' && <Waitlisted o={o} token={token} onChange={setO} />}
      {o.status === 'CONFIRMED' && <Confirmed o={o} token={token} onChange={setO} reload={load} />}
      {o.status === 'PROOF_SENT' && <Checking o={o} />}
      {['VERIFIED', 'PACKED', 'SHIPPED'].includes(o.status) && <Paid o={o} />}
      {['EXPIRED', 'CANCELLED'].includes(o.status) && <Ended o={o} />}
    </PhoneShell>
  )
}

function ItemHead({ o, badge, badgeCls }: { o: O; badge: string; badgeCls: string }) {
  return (
    <div className="flex gap-4">
      <ItemThumb name={o.item.name} tone={o.item.tone} photo={o.item.photo_url} size={92} rounded={14} />
      <div className="min-w-0 pt-0.5">
        <span className={cx('inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-bold', badgeCls)}>{badge}</span>
        <div className="mt-1.5 font-display text-[20px] font-bold leading-tight"><Code className="text-[18px] text-muted">{o.item.code}</Code> {o.item.name}</div>
        <div className="text-[14px] text-ink-2">{peso(o.unit_price_centavos)} each{o.for_name ? ` · for ${o.for_name}` : ''}</div>
      </div>
    </div>
  )
}

function useCountdown(until: string | null, serverNow: string) {
  const offset = useServerOffset(serverNow)
  const now = useNow(1000) + offset
  return until ? new Date(until).getTime() - now : 0
}

function Claimed({ o, token, onChange }: { o: O; token: string; onChange: (o: O) => void }) {
  const [size, setSize] = useState(o.size ?? (o.item.sizes.length === 1 ? o.item.sizes[0] : ''))
  const [qty, setQty] = useState(o.qty)
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const left = useCountdown(o.hold_until, o.server_now)
  const act = async (kind: 'confirm' | 'cancel') => {
    if (kind === 'confirm' && o.item.sizes.length && !size) return setErr('Pick your size first.')
    setBusy(kind)
    setErr(null)
    try {
      onChange(await pub.post<O>(`/buyer/${token}/${kind}`, kind === 'confirm' ? { size: size || null, qty } : {}))
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  return (
    <div className="flex flex-col gap-5">
      <ItemHead o={o} badge="Claimed for you" badgeCls="bg-brand-soft text-brand-deep" />
      <p className="rounded-xl bg-sunken px-4 py-3 text-[14px] text-ink-2">Check what we read from your comment. Fix the size or quantity here, then confirm.</p>
      {o.item.sizes.length > 0 && (
        <div>
          <div className="mb-2 text-[13.5px] font-semibold">Size</div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Size">
            {o.item.sizes.map((s) => (
              <button key={s} role="radio" aria-checked={size === s} onClick={() => { setSize(s); setErr(null) }}
                className={cx('h-11 min-w-[52px] rounded-xl border px-4 text-[15px] font-semibold transition', size === s ? 'border-brand bg-brand text-white' : 'border-line-2 hover:bg-sunken')}>{s}</button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[13.5px] font-semibold">Quantity</span>
        <Stepper value={qty} min={1} max={10} onChange={setQty} label="quantity" />
      </div>
      <div className="flex items-baseline justify-between border-t border-line pt-4">
        <span className="text-[15px] text-ink-2">Total</span>
        <span className="font-display text-[28px] font-bold tabular">{peso(o.unit_price_centavos * qty)}</span>
      </div>
      {err && <p className="text-[14px] font-medium text-hold" role="alert">{err}</p>}
      <div className="flex flex-col items-center gap-3">
        <Button size="lg" className="w-full" loading={busy === 'confirm'} onClick={() => act('confirm')}>Confirm order</Button>
        <span className={cx('text-[13.5px]', left < 120000 ? 'font-semibold text-pending' : 'text-muted')}>
          {left > 0 ? <>Confirm within <b className="font-mono tabular">{duration(left)}</b> or the item goes to the next buyer</> : 'Time’s up. Refreshing…'}
        </span>
        <button onClick={() => act('cancel')} disabled={!!busy} className="text-[13.5px] font-semibold text-muted underline-offset-2 hover:underline">Cancel my claim</button>
      </div>
    </div>
  )
}

function Waitlisted({ o, token, onChange }: { o: O; token: string; onChange: (o: O) => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex flex-col gap-5">
      <ItemHead o={o} badge="On the waitlist" badgeCls="bg-sunken text-ink-2" />
      <div className="rounded-2xl border border-line p-5 text-center">
        <div className="font-display text-[44px] font-bold leading-none">#{o.line_position ?? 1}</div>
        <div className="mt-2 font-semibold">You’re number {o.line_position ?? 1} in line.</div>
        <div className="mt-1 text-[14px] text-muted">If someone ahead cancels or doesn’t pay, this page switches to Claimed by itself.</div>
      </div>
      <Button variant="outline" loading={busy} onClick={async () => { setBusy(true); try { onChange(await pub.post<O>(`/buyer/${token}/cancel`)) } finally { setBusy(false) } }}>Leave the line</Button>
    </div>
  )
}

function Confirmed({ o, token, onChange, reload }: { o: O; token: string; onChange: (o: O) => void; reload: () => void }) {
  const mode = o.payment.mode
  const [tab, setTab] = useState<'qr' | 'manual'>(mode === 'manual' ? 'manual' : 'qr')
  const payLeft = useCountdown(o.pay_by, o.server_now)
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <ItemThumb name={o.item.name} tone={o.item.tone} photo={o.item.photo_url} size={56} rounded={12} />
        <div className="min-w-0 flex-1">
          <span className="inline-flex h-6 items-center rounded-full bg-[#E9EEF7] px-2.5 text-[12px] font-bold text-[#2E4A7A]">Confirmed</span>
          <div className="truncate text-[15px] font-semibold"><Code>{o.item.code}</Code> {o.item.name}{o.size ? `, ${o.size}` : ''} ×{o.qty}</div>
        </div>
        <div className="text-right"><div className="font-display text-[22px] font-bold tabular">{peso(o.total_centavos)}</div>
          <div className="text-[12px] text-muted">pay by {payLeft > 12 * 3600000 ? dateTime(o.pay_by) : clock(o.pay_by)}{payLeft < 3600000 && payLeft > 0 ? ` (${duration(payLeft)})` : ''}</div></div>
      </div>
      {o.seller_note && <div className="flex gap-2.5 rounded-xl border border-[#F0D9B5] bg-pending-soft px-4 py-3 text-[14px] text-pending-deep" role="status"><Icon name="chat" className="mt-0.5" /><span><b>Message from {o.seller_name}:</b> {o.seller_note}</span></div>}
      {mode === 'both' && (
        <div className="grid grid-cols-2 rounded-xl bg-sunken p-1" role="tablist">
          {(['qr', 'manual'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={cx('h-10 rounded-lg text-[14px] font-semibold transition', tab === t ? 'bg-surface text-ink shadow-sm' : 'text-muted')}>
              {t === 'qr' ? 'Pay with QR Ph' : `I paid via ${o.payment.provider}`}
            </button>
          ))}
        </div>
      )}
      {tab === 'qr' ? <QrPay o={o} token={token} reload={reload} /> : <ManualPay o={o} token={token} onChange={onChange} />}
    </div>
  )
}

function QrPay({ o, token, reload }: { o: O; token: string; reload: () => void }) {
  const [qr, setQr] = useState(o.qr && o.qr.status === 'awaiting_payment' ? o.qr : null)
  const [base, setBase] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { publicBase().then(setBase) }, [])
  const left = useCountdown(qr?.expires_at ?? null, o.server_now)
  const get = async () => {
    setBusy(true); setErr(null)
    try { setQr(await pub.post<NonNullable<O['qr']>>(`/buyer/${token}/qr`)) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  useEffect(() => { if (!qr) get() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const url = qr ? `${base}/pay/${qr.intent_id}` : ''        // for the QR: must open on another phone
  const local = qr ? `/pay/${qr.intent_id}` : ''              // for links on this device
  const expired = qr && left <= 0
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-line p-5 text-center">
      <div className="flex items-center gap-2 text-[13px] font-bold text-ink-2"><span className="rounded bg-[#0038A8] px-1.5 py-0.5 text-[11px] text-white">QR Ph</span>Scan with any bank or e-wallet app</div>
      {!qr || !base ? <div className="grid h-[220px] place-items-center"><Spinner /></div> : expired ? (
        <div className="flex h-[220px] flex-col items-center justify-center gap-3"><span className="text-[14px] text-muted">This QR code expired.</span><Button onClick={get} loading={busy} icon="refresh">Get a new QR</Button></div>
      ) : (
        <>
          <div className="rounded-xl border border-line p-2"><QR value={url} size={210} label="QR Ph payment code" /></div>
          <div className="font-display text-[24px] font-bold tabular">{peso(qr.amount_centavos)}</div>
          <div className="text-[13px] text-muted">Code expires in <b className="font-mono tabular">{duration(left)}</b>. This page updates by itself once you pay.</div>
          <a href={local} className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line-2 px-4 text-[14px] font-semibold hover:bg-sunken" onClick={() => setTimeout(reload, 4000)}>
            <Icon name="phone" size={16} />Pay on this phone instead
          </a>
        </>
      )}
      {err && <p className="text-[14px] text-hold">{err}</p>}
      <p className="text-[11.5px] text-faint">Test mode: the payment page is a stand-in for your bank app.</p>
    </div>
  )
}

function ManualPay({ o, token, onChange }: { o: O; token: string; onChange: (o: O) => void }) {
  const [ref, setRef] = useState('')
  const [attest, setAttest] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const digits = ref.replace(/[^0-9A-Za-z]/g, '')
  const refOk = digits.length >= 6 && digits.length <= 32
  const wallet = `/w/${o.payment.seller_id}?amount=${o.total_centavos}&note=${encodeURIComponent(`${o.item.code} ${o.item.name}`)}&back=${encodeURIComponent(`/o/${token}`)}`
  const submit = async () => {
    setBusy(true); setErr(null)
    try { onChange(await pub.post<O>(`/buyer/${token}/proof`, { reference: ref, attested: attest })) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-line">
        {[['Send via', o.payment.provider], ['Name', o.payment.name], ['Number', o.payment.number], ['Amount', peso(o.total_centavos)]].map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-line px-4 py-2.5 text-[14.5px] last:border-0"><span className="text-muted">{k}</span><b className={k === 'Number' ? 'font-mono' : ''}>{v}</b></div>
        ))}
      </div>
      {<a href={wallet} className="text-center text-[13px] font-semibold text-brand-deep underline">Demo: open DemoWallet to send this payment</a>}
      <div className="rounded-xl bg-sunken p-4">
        <div className="mb-2 text-[13.5px] font-semibold">After paying, open your app and check:</div>
        {['Status says Successful', `Amount is ${peso(o.total_centavos)}`, `Recipient is ${o.payment.name}`].map((t, i) => (
          <div key={t} className="flex items-center gap-2.5 py-1 text-[14px]"><span className="grid h-5 w-5 place-items-center rounded-full bg-surface text-[11px] font-bold">{i + 1}</span>{t}</div>
        ))}
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13.5px] font-semibold">Reference number</span>
        <input value={ref} onChange={(e) => setRef(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="e.g. 1009 876 543 210"
          className="h-12 rounded-xl border border-line-2 px-4 font-mono text-[17px] tracking-wide outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
        {ref && !refOk && <span className="text-[12.5px] text-pending-deep">Reference numbers are usually 10 to 13 digits.</span>}
      </label>
      <button type="button" onClick={() => setAttest(!attest)} aria-pressed={attest} className="flex items-center gap-3 rounded-xl border border-line-2 px-4 py-3 text-left text-[14.5px] font-medium">
        <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-md border-2', attest ? 'border-brand bg-brand text-white' : 'border-line-2')}>{attest && <Icon name="check" size={14} stroke={3} />}</span>
        I checked this payment in my app
      </button>
      {err && <p className="text-[14px] font-medium text-hold" role="alert">{err}</p>}
      <Button size="lg" disabled={!refOk || !attest} loading={busy} onClick={submit}>Send reference</Button>
      <p className="text-center text-[12px] text-muted">No screenshot needed. {o.seller_name} checks the reference against their own statement.</p>
    </div>
  )
}

function Checking({ o }: { o: O }) {
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-full bg-pending-soft text-pending"><Icon name="clock" size={30} /></span>
      <div><div className="font-display text-[22px] font-bold">{o.seller_name} is checking your payment</div>
        <p className="mt-1 text-[14px] text-muted">This page updates by itself once it’s confirmed.</p></div>
      <div className="w-full rounded-xl border border-line text-left">
        {[['Item', `${o.item.code} ${o.item.name}`], ['Amount', peso(o.total_centavos)], ['Reference', o.proof_reference ?? ''], ['Sent', dateTime(o.proof_submitted_at)]].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b border-line px-4 py-2.5 text-[14px] last:border-0"><span className="text-muted">{k}</span><b className={cx('truncate', k === 'Reference' && 'font-mono')}>{v}</b></div>
        ))}
      </div>
    </div>
  )
}

function Paid({ o }: { o: O }) {
  const steps = ['VERIFIED', 'PACKED', 'SHIPPED']
  const at = steps.indexOf(o.status)
  return (
    <div className="flex flex-col items-center gap-5 py-4 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-full bg-brand text-white animate-pop"><Icon name="check" size={32} stroke={2.6} /></span>
      <div><div className="font-display text-[24px] font-bold">{['Payment confirmed', 'Your order is packed', 'Your order is on the way'][at]}</div>
        <p className="mt-1 text-[14px] text-muted">{['Thank you! It goes on the packing list now.', 'It’s packed and waiting for pickup.', 'The seller marked it shipped.'][at]}</p></div>
      <ol className="flex w-full items-center">
        {['Paid', 'Packed', 'Shipped'].map((s, i) => (
          <li key={s} className="flex flex-1 flex-col items-center gap-1.5">
            <span className={cx('h-2 w-full', i === 0 ? 'rounded-l-full' : '', i === 2 ? 'rounded-r-full' : '', i <= at ? 'bg-brand' : 'bg-sunken')} />
            <span className={cx('text-[12.5px] font-semibold', i <= at ? 'text-brand-deep' : 'text-faint')}>{s}</span>
          </li>
        ))}
      </ol>
      <div className="w-full rounded-xl bg-sunken px-4 py-3 text-left text-[14px]"><Code>{o.item.code}</Code> {o.item.name}{o.size ? `, ${o.size}` : ''} ×{o.qty} · <b>{peso(o.total_centavos)}</b></div>
    </div>
  )
}

function Ended({ o }: { o: O }) {
  const expired = o.status === 'EXPIRED'
  const unpaid = expired && (o.last_note ?? '').includes('paid')
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-full bg-sunken text-muted"><Icon name={expired ? 'clock' : 'x'} size={30} /></span>
      <div className="font-display text-[22px] font-bold">{expired ? (unpaid ? 'This order wasn’t paid in time' : 'This claim wasn’t confirmed in time') : 'This order was cancelled'}</div>
      <p className="max-w-[32ch] text-[14px] text-muted">{expired ? 'The item went to the next buyer in line. Comment again on the next live if it comes back.' : 'Nothing else to do here.'}</p>
      <div className="w-full rounded-xl bg-sunken px-4 py-3 text-left text-[14px]"><span className="text-muted">Item</span> <Code>{o.item.code}</Code> {o.item.name}</div>
    </div>
  )
}
