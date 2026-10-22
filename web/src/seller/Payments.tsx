import { useCallback, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { ItemThumb } from '../components/ItemThumb'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { Button, Card, Code, cx, Empty, Field, Input, LabelBadge, PageHeader, Spinner, VerdictBadge } from '../components/ui'
import { downloadWithKey, seller, streamUrl } from '../lib/api'
import { ago, dateTime, peso, plural } from '../lib/format'
import { useDebounced, useEventStream, useLoad, useNow } from '../lib/hooks'
import type { Order } from '../lib/types'
import { OrderDrawer } from './OrderDrawer'
import { useSeller } from './SellerLayout'

interface Overview {
  to_check: Order[]
  awaiting_payment: Order[]
  last_upload: { filename: string; row_count: number; uploaded_at: string } | null
  covers_until: string | null
  green: number
}

export default function Payments() {
  const toast = useToast()
  const { refresh: refreshShell } = useSeller()
  const { data, loading, reload } = useLoad(() => seller.get<Overview>('/payments'))
  const [drag, setDrag] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [rejecting, setRejecting] = useState<Order | null>(null)
  const [drawer, setDrawer] = useState<string | null>(null)
  const [flipped, setFlipped] = useState<Set<string>>(new Set())
  const file = useRef<HTMLInputElement>(null)
  const debounced = useDebounced(reload, 150)
  useEventStream(streamUrl('/seller/stream', true), (e: { type: string; order_id?: string }) => {
    if (e.type === 'verdict' && e.order_id) {
      setFlipped((s) => new Set(s).add(e.order_id!))
      setTimeout(() => setFlipped((s) => { const n = new Set(s); n.delete(e.order_id!); return n }), 2200)
    }
    debounced()
  })

  const upload = useCallback(async (f: File | undefined) => {
    if (!f) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const r = await seller.upload<{ rows: number; new_payments: number; checked: number; release: number; hold: number; pending: number }>('/payments/statement', fd)
      toast(`Read ${plural(r.rows, 'payment')}. Checked ${r.checked}: ${r.release} release, ${r.hold} hold, ${r.pending} pending.`)
      reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setUploading(false)
      if (file.current) file.current.value = ''
    }
  }, [reload, toast])

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); toast(msg); reload(); refreshShell() } catch (e) { toast((e as Error).message, 'error') }
  }

  const rows = data?.to_check ?? []
  return (
    <div className="mx-auto max-w-[1120px] px-5 py-8 lg:px-10">
      <PageHeader title="Payments" sub="Each reference and amount is checked against your own statement, so a fake screenshot can’t get through." />

      <div onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]) }}
        className={cx('mb-8 flex flex-wrap items-center gap-5 rounded-[var(--radius-card)] border-2 border-dashed px-6 py-5 transition',
          drag ? 'border-brand bg-brand-soft' : 'border-line-2 bg-surface')}>
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-sunken text-ink-2"><Icon name="upload" size={22} /></span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[17px] font-semibold">Drop the CSV statement from your e-wallet or bank</div>
          <div className="text-[13.5px] text-muted">
            {data?.last_upload
              ? <>Last upload {ago(data.last_upload.uploaded_at)} · {data.last_upload.filename} · covers payments until {dateTime(data.covers_until)}</>
              : 'No statement yet. Payments wait as Pending until one covers them.'}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" icon="download" onClick={() => downloadWithKey('/payments/wallet-statement.csv', 'demowallet-statement.csv').catch((e) => toast(e.message, 'error'))}
            title="Demo: export the mock e-wallet’s statement, like downloading it from GCash">Get DemoWallet statement</Button>
          <input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => upload(e.target.files?.[0])} aria-label="Statement file" />
          <Button icon="upload" loading={uploading} onClick={() => file.current?.click()}>Upload statement</Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-bold">To check</h2>
          <p className="text-[13.5px] text-muted">{rows.length ? `${plural(rows.length, 'buyer')} sent payment. You make the final call.` : 'Buyers who sent payment show up here.'}</p>
        </div>
        <Button icon="check" disabled={!data?.green} onClick={() => act(() => seller.post('/payments/release-green'), `Released ${plural(data!.green, 'order')}`)}>
          Release all green ({data?.green ?? 0})
        </Button>
      </div>
      <Card className="mb-10 overflow-hidden">
        {loading && !data ? <div className="p-10 text-center"><Spinner /></div> :
          rows.length === 0 ? <Empty icon="pay" title="No payments to check" body="Released orders move to Packing." /> :
            <ul className="divide-y divide-line">{rows.map((o) => (
              <li key={o.id} className={cx('grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_auto] md:items-center', flipped.has(o.id) && 'animate-flash')}>
                <button className="flex min-w-0 items-center gap-3 text-left" onClick={() => setDrawer(o.id)}>
                  <ItemThumb name={o.item_name} tone={o.item_tone} photo={o.item_photo} size={44} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2"><b className="truncate text-[15px]">{o.buyer}</b><LabelBadge label={o.buyer_label} /></span>
                    <span className="block truncate text-[13px] text-muted"><Code>{o.item_code}</Code> {o.item_name}{o.size ? `, ${o.size}` : ''}{o.qty > 1 ? ` ×${o.qty}` : ''}</span>
                    <span className="font-display text-[16px] font-bold">{peso(o.total_centavos)}</span>
                  </span>
                </button>
                <div className="min-w-0 space-y-1.5">
                  <VerdictBadge verdict={o.verdict} />
                  <ul className="space-y-0.5 text-[13.5px] text-ink-2">
                    {o.verdict_reasons.map((r) => <li key={r} className={cx(o.verdict === 'HOLD' && 'text-hold-deep')}>{r.charAt(0).toUpperCase() + r.slice(1)}</li>)}
                  </ul>
                  {o.verdict_suggestion && <div className="text-[12.5px] text-muted">Close match in your statement: <Code>{o.verdict_suggestion}</Code> (not accepted automatically)</div>}
                  <div className="text-[12.5px] text-muted">Ref <Code className="text-ink-2">{o.proof_reference}</Code> · {o.proof_channel === 'qrph' ? 'QR Ph' : 'typed by buyer'} · sent {ago(o.proof_submitted_at)}</div>
                  {o.seller_note && <div className="text-[12.5px] font-medium text-pending-deep">You asked the buyer to re-check</div>}
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  {o.verdict === 'HOLD'
                    ? <Button variant="outline" size="sm" icon="chat" disabled={!!o.seller_note} onClick={() => act(() => seller.post(`/orders/${o.id}/ask`, {}), 'The buyer will see your note on their order page')}>{o.seller_note ? 'Asked' : 'Ask buyer'}</Button>
                    : <Button size="sm" icon="check" onClick={() => act(() => seller.post(`/orders/${o.id}/release`), `Released ${o.buyer}’s order`)}>Release</Button>}
                  <Button variant="ghost" size="sm" onClick={() => setRejecting(o)}>Reject</Button>
                  {o.verdict === 'HOLD' && <Button variant="ghost" size="sm" onClick={() => act(() => seller.post(`/orders/${o.id}/release`), 'Released anyway')}>Release anyway</Button>}
                </div>
              </li>))}
            </ul>}
      </Card>

      <h2 className="mb-1 text-[19px] font-bold">Waiting for payment</h2>
      <p className="mb-3 text-[13.5px] text-muted">Confirmed orders that haven’t paid yet. They expire at the pay-by time and the item goes to the next buyer.</p>
      <Card className="overflow-hidden">
        {!data?.awaiting_payment.length ? <Empty icon="clock" title="Nobody is waiting to pay" /> :
          <ul className="divide-y divide-line">{data.awaiting_payment.map((o) => <Awaiting key={o.id} o={o} onOpen={() => setDrawer(o.id)} />)}</ul>}
      </Card>

      <RejectModal order={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); reload(); refreshShell() }} />
      <OrderDrawer orderId={drawer} onClose={() => setDrawer(null)} onChanged={reload} />
    </div>
  )
}

function Awaiting({ o, onOpen }: { o: Order; onOpen: () => void }) {
  const now = useNow(30000)
  const left = o.pay_by ? new Date(o.pay_by).getTime() - now : 0
  const h = Math.floor(left / 3600000)
  const m = Math.floor((left % 3600000) / 60000)
  return (
    <li>
      <button onClick={onOpen} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-sunken/60">
        <b className="w-[170px] truncate text-[14.5px]">{o.buyer}</b>
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink-2"><Code>{o.item_code}</Code> {o.item_name}{o.size ? `, ${o.size}` : ''}</span>
        <span className="font-semibold tabular">{peso(o.total_centavos)}</span>
        <span className={cx('w-[110px] text-right text-[13px] tabular', left < 3600000 ? 'text-pending font-semibold' : 'text-muted')}>{left > 0 ? `${h ? h + 'h ' : ''}${m}m left` : 'expiring'}</span>
        {o.seller_note && <span title="Rejected or asked to resend" className="text-pending"><Icon name="alert" size={16} /></span>}
      </button>
    </li>
  )
}

function RejectModal({ order, onClose, onDone }: { order: Order | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const o = order
  const submit = async () => {
    if (!o) return
    setBusy(true)
    try {
      await seller.post(`/orders/${o.id}/reject`, { reason: reason.trim() || o.verdict_reasons[0] || 'payment not found' })
      toast('Proof rejected. The buyer can send a new reference.')
      onDone()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal open={!!o} onClose={onClose} kicker={o ? `${o.buyer} · ${peso(o.total_centavos)}` : ''} title="Reject this payment?"
      footer={<><Button variant="ghost" onClick={onClose}>Keep checking</Button><Button variant="danger" loading={busy} onClick={submit}>Reject payment</Button></>}>
      <p className="mb-4 text-[14px] text-ink-2">The order goes back to waiting for payment and counts as a failed check on this buyer’s record. The buyer sees a polite note, never the reason below.</p>
      <Field label="Reason (only you see this)">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={o?.verdict_reasons[0] || 'payment not found'} maxLength={120} />
      </Field>
    </Modal>
  )
}
