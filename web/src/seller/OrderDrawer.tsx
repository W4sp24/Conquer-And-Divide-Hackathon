import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { ItemThumb } from '../components/ItemThumb'
import { QR } from '../components/QR'
import { useToast } from '../components/Toast'
import { Button, Code, cx, LabelBadge, Spinner, StatusBadge, VerdictBadge } from '../components/ui'
import { seller } from '../lib/api'
import { clockSec, peso } from '../lib/format'
import { publicBase } from '../lib/publicUrl'
import type { Order } from '../lib/types'

interface Detail extends Order {
  events: { id: number; from_status: string | null; to_status: string; actor: string; note: string | null; at: string }[]
}

/** Side panel for one order: buyer link + QR to open on a phone, and the full timeline. */
export function OrderDrawer({ orderId, onClose, onChanged }: { orderId: string | null; onClose: () => void; onChanged?: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [base, setBase] = useState('')
  const toast = useToast()
  useEffect(() => { publicBase().then(setBase) }, [])
  useEffect(() => {
    if (!orderId) return
    setD(null)
    seller.get<Detail>(`/orders/${orderId}`).then(setD).catch((e) => toast(e.message, 'error'))
  }, [orderId, toast])
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])
  if (!orderId) return null
  const link = d ? `${base}/o/${d.buyer_token}` : ''
  const cancel = async () => {
    try {
      await seller.post(`/orders/${orderId}/cancel`)
      toast('Order cancelled. The next buyer in line moves up.')
      onChanged?.()
      onClose()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-ink/25" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-[420px] flex-col overflow-y-auto bg-surface shadow-[var(--shadow-pop)] animate-[rise_.22s]" aria-label="Order details">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[18px] font-bold">Order</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-sunken"><Icon name="x" /></button>
        </div>
        {!d ? <div className="grid flex-1 place-items-center"><Spinner /></div> : (
          <div className="flex flex-col gap-5 p-5">
            <div className="flex gap-3">
              <ItemThumb name={d.item_name} tone={d.item_tone} photo={d.item_photo} size={64} />
              <div className="min-w-0">
                <div className="text-[15px] font-semibold"><Code>{d.item_code}</Code> {d.item_name}</div>
                <div className="text-[13.5px] text-muted">{d.size ? `Size ${d.size} · ` : ''}×{d.qty} · {peso(d.total_centavos)}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5"><StatusBadge status={d.status} /><LabelBadge label={d.buyer_label} /></div>
              </div>
            </div>
            <div className="rounded-xl bg-sunken p-3.5 text-[14px]">
              <div className="font-semibold">{d.buyer}{d.for_name && <span className="font-normal text-muted"> · for {d.for_name}</span>}</div>
              <div className="text-[13px] text-muted">Claimed {clockSec(d.claimed_at)}</div>
              {d.verdict && <div className="mt-2"><VerdictBadge verdict={d.verdict} reason={d.verdict_reasons[0]} /></div>}
              {d.proof_reference && <div className="mt-1.5 text-[13px]">Reference <Code>{d.proof_reference}</Code>{d.proof_channel === 'qrph' && ' · QR Ph'}</div>}
            </div>
            <div>
              <div className="mb-2 text-[13px] font-semibold text-ink-2">Buyer’s private link</div>
              <div className="flex items-start gap-4">
                <div className="rounded-lg border border-line p-1.5"><QR value={link} size={116} label="Buyer order link QR" /></div>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-[13px] text-muted">Send this to the buyer in Messenger, or scan it to open the buyer page on a phone.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" icon="copy" onClick={() => navigator.clipboard?.writeText(link).then(() => toast('Link copied'))}>Copy link</Button>
                    <a href={link} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold text-ink-2 hover:bg-sunken"><Icon name="ext" size={15} />Open</a>
                  </div>
                </div>
              </div>
            </div>
            <div>
              <div className="mb-2 text-[13px] font-semibold text-ink-2">Timeline</div>
              <ol className="relative ml-1.5 border-l border-line-2">
                {d.events.map((e) => (
                  <li key={e.id} className="relative mb-3 pl-4 last:mb-0">
                    <span className={cx('absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface', e.to_status === 'EXPIRED' || e.to_status === 'CANCELLED' ? 'bg-faint' : 'bg-brand')} />
                    <div className="text-[13.5px]"><span className="font-semibold">{e.to_status.replace('_', ' ').toLowerCase()}</span> <span className="text-muted">by {e.actor}</span></div>
                    <div className="text-[12.5px] text-muted">{clockSec(e.at)}{e.note ? ` · ${e.note}` : ''}</div>
                  </li>
                ))}
              </ol>
            </div>
            {['CLAIMED', 'WAITLISTED', 'CONFIRMED', 'PROOF_SENT'].includes(d.status) && (
              <Button variant="outline" icon="x" onClick={cancel} className="self-start">Cancel this order</Button>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}
