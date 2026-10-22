import { useState } from 'react'
import { Icon } from '../components/Icon'
import { ItemThumb } from '../components/ItemThumb'
import { useToast } from '../components/Toast'
import { Button, Card, Code, cx, Empty, LabelBadge, PageHeader, Spinner } from '../components/ui'
import { seller, streamUrl } from '../lib/api'
import { peso } from '../lib/format'
import { useDebounced, useEventStream, useLoad } from '../lib/hooks'
import type { Order } from '../lib/types'
import { useSeller } from './SellerLayout'

interface Group { buyer_id: string; buyer: string; label: Order['buyer_label']; orders: Order[]; status: 'TO_PACK' | 'PACKED' | 'SHIPPED'; total_centavos: number; units: number }
interface PackingData { groups: Group[]; totals: { orders: number; units: number; to_pack: number; collected_centavos: number } }

export default function Packing() {
  const toast = useToast()
  const { refresh } = useSeller()
  const { data, loading, reload } = useLoad(() => seller.get<PackingData>('/packing'))
  const [busy, setBusy] = useState<string | null>(null)
  useEventStream(streamUrl('/seller/stream', true), useDebounced(reload, 200))

  const mark = async (g: Group, to: 'VERIFIED' | 'PACKED' | 'SHIPPED', key: string) => {
    setBusy(key)
    try {
      await seller.post('/packing/mark', { order_ids: g.orders.map((o) => o.id), to })
      reload()
      refresh()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(null) }
  }
  const t = data?.totals
  return (
    <div className="mx-auto max-w-[1120px] px-5 py-8 lg:px-10">
      <PageHeader title="Packing" sub="Only orders with a verified payment show up here, grouped by buyer.">
        <Button variant="outline" icon="download" onClick={() => window.print()}>Print list</Button>
      </PageHeader>
      <div className="mb-6 grid grid-cols-3 gap-3">
        {[['Orders verified', t?.orders ?? 0], ['Items to pack', t?.to_pack ?? 0], ['Total collected', peso(t?.collected_centavos ?? 0)]].map(([k, v]) => (
          <Card key={String(k)} className="px-5 py-4">
            <div className="text-[13px] font-medium text-muted">{k}</div>
            <div className="font-display text-[26px] font-bold tabular">{v}</div>
          </Card>
        ))}
      </div>
      {loading && !data ? <div className="p-10 text-center"><Spinner /></div> :
        !data?.groups.length ? <Card><Empty icon="pack" title="Nothing to pack yet" body="Orders show up here after you release them in Payments." /></Card> : (
          <div className="grid gap-4 md:grid-cols-2">
            {data.groups.map((g) => {
              const packed = g.status !== 'TO_PACK'
              const shipped = g.status === 'SHIPPED'
              return (
                <Card key={g.buyer_id} className={cx('flex flex-col', shipped && 'opacity-70')}>
                  <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2"><b className="truncate text-[16px]">{g.buyer}</b><LabelBadge label={g.label} /></div>
                      <div className="text-[13px] text-muted">{g.units} item{g.units === 1 ? '' : 's'} · paid {peso(g.total_centavos)}</div>
                    </div>
                    <span className={cx('rounded-full px-2.5 py-1 text-[12px] font-bold', shipped ? 'bg-ink text-white' : packed ? 'bg-brand-deep text-white' : 'bg-pending-soft text-pending-deep')}>
                      {shipped ? 'Shipped' : packed ? 'Packed' : 'To pack'}
                    </span>
                  </div>
                  <ul className="flex-1 divide-y divide-line px-5">
                    {g.orders.map((o) => (
                      <li key={o.id} className="flex items-center gap-3 py-2.5">
                        <ItemThumb name={o.item_name} tone={o.item_tone} photo={o.item_photo} size={36} rounded={8} />
                        <Code className="w-9 text-[14px]">{o.item_code}</Code>
                        <span className="min-w-0 flex-1 truncate text-[14px]">{o.item_name}</span>
                        <span className="text-[13px] text-ink-2">{o.size ?? '—'}</span>
                        <span className="w-8 text-right text-[13px] tabular">×{o.qty}</span>
                        <span className="w-20 text-right text-[13.5px] font-semibold tabular">{peso(o.total_centavos)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-2 border-t border-line px-5 py-3 print:hidden">
                    {[{ k: 'packed', on: packed, label: 'Packed', to: packed ? 'VERIFIED' : 'PACKED' }, { k: 'shipped', on: shipped, label: 'Shipped', to: shipped ? 'PACKED' : 'SHIPPED' }].map((b) => (
                      <button key={b.k} onClick={() => mark(g, b.to as 'VERIFIED' | 'PACKED' | 'SHIPPED', g.buyer_id + b.k)} aria-pressed={b.on}
                        className={cx('flex h-10 flex-1 items-center justify-center gap-2 rounded-[10px] border text-[14px] font-semibold transition',
                          b.on ? 'border-brand bg-brand-soft text-brand-deep' : 'border-line-2 text-ink-2 hover:bg-sunken')}>
                        {busy === g.buyer_id + b.k ? <Spinner size={15} /> :
                          <span className={cx('grid h-[18px] w-[18px] place-items-center rounded border-2', b.on ? 'border-brand bg-brand text-white' : 'border-line-2')}>{b.on && <Icon name="check" size={12} stroke={3} />}</span>}
                        {b.label}
                      </button>
                    ))}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
    </div>
  )
}
