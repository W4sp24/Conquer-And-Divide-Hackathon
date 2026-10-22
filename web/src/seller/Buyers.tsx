import { useState } from 'react'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { Button, Card, cx, Empty, LabelBadge, PageHeader, Spinner } from '../components/ui'
import { seller } from '../lib/api'
import { peso } from '../lib/format'
import { useLoad } from '../lib/hooks'

interface B {
  id: string; name: string; label: 'HOLD' | 'WATCH' | 'TRUSTED' | 'NEW'; label_note: string
  claims: number; verified: number; failed_proofs: number; expired_unpaid: number; cancels: number
  max_paid_centavos: number; open_orders: number; source: string
}

export default function Buyers() {
  const { data, loading, reload } = useLoad(() => seller.get<B[]>('/buyers'))
  const [filter, setFilter] = useState<'ALL' | B['label']>('ALL')
  const [deleting, setDeleting] = useState<B | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const rows = (data ?? []).filter((b) => filter === 'ALL' || b.label === filter)
  const count = (l: B['label']) => (data ?? []).filter((b) => b.label === l).length
  const del = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await seller.del(`/buyers/${deleting.id}`)
      toast(`Deleted ${deleting.name}’s data`)
      setDeleting(null)
      reload()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <div className="mx-auto max-w-[1120px] px-5 py-8 lg:px-10">
      <PageHeader title="Buyers" sub="Each buyer’s record in your shop only. Nothing is shared with other sellers." />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {(['ALL', 'HOLD', 'WATCH', 'NEW', 'TRUSTED'] as const).map((l) => (
          <button key={l} role="tab" aria-selected={filter === l} onClick={() => setFilter(l)}
            className={cx('h-9 rounded-full border px-3.5 text-[13.5px] font-semibold', filter === l ? 'border-ink bg-ink text-white' : 'border-line-2 bg-surface text-ink-2 hover:bg-sunken')}>
            {{ ALL: 'Everyone', HOLD: 'Hold', WATCH: 'Watch', NEW: 'New', TRUSTED: 'Trusted' }[l]}
            <span className="ml-1.5 tabular opacity-70">{l === 'ALL' ? data?.length ?? 0 : count(l)}</span>
          </button>
        ))}
      </div>
      <Card className="overflow-x-auto">
        {loading && !data ? <div className="p-10 text-center"><Spinner /></div> : !rows.length ? <Empty icon="buyers" title="No buyers here yet" body="Anyone who comments a claim gets a record." /> : (
          <table className="w-full min-w-[760px] text-[14px]">
            <thead><tr className="border-b border-line bg-sunken/50 text-left text-[12.5px] text-muted">
              <th className="px-5 py-2.5 font-semibold">Buyer</th><th className="py-2.5 font-semibold">Label</th>
              <th className="py-2.5 text-right font-semibold">Claims</th><th className="py-2.5 text-right font-semibold">Paid</th>
              <th className="py-2.5 text-right font-semibold">Unpaid</th><th className="py-2.5 text-right font-semibold">Failed checks</th>
              <th className="py-2.5 text-right font-semibold">Cancels</th><th className="py-2.5 text-right font-semibold">Biggest paid</th><th className="w-36" /></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((b) => (
                <tr key={b.id}>
                  <td className="px-5 py-2.5"><div className="font-semibold">{b.name}</div><div className="text-[12px] text-muted">{{ chat: 'Phone viewer', test: 'Test comment', rec: 'Replay', meta: 'Facebook' }[b.source] ?? 'Facebook'}{b.open_orders ? ` · ${b.open_orders} open` : ''}</div></td>
                  <td title={b.label_note}><LabelBadge label={b.label} /></td>
                  <td className="text-right tabular">{b.claims}</td><td className="text-right tabular">{b.verified}</td>
                  <td className={cx('text-right tabular', b.expired_unpaid && 'text-pending font-semibold')}>{b.expired_unpaid}</td>
                  <td className={cx('text-right tabular', b.failed_proofs && 'text-hold font-semibold')}>{b.failed_proofs}</td>
                  <td className="text-right tabular">{b.cancels}</td><td className="text-right tabular">{b.max_paid_centavos ? peso(b.max_paid_centavos, true) : '—'}</td>
                  <td className="pr-4 text-right"><Button size="sm" variant="ghost" onClick={() => setDeleting(b)}>Delete data</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="mt-4 text-[13px] text-muted">Hold: failed a payment check or let 3+ orders expire unpaid. Watch: a third or more of their claims were cancelled or expired. Trusted: 3+ verified payments and no failed checks.</p>
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title={`Delete ${deleting?.name}’s data?`} kicker="Data Privacy Act (RA 10173)"
        footer={<><Button variant="ghost" onClick={() => setDeleting(null)}>Keep</Button><Button variant="danger" loading={busy} onClick={del}>Delete everything</Button></>}>
        <p className="text-[14px] text-ink-2">Removes their comments, orders, payment references and record from your shop. Items they held go to the next buyer in line. This can’t be undone.</p>
      </Modal>
    </div>
  )
}
