import { useEffect, useState } from 'react'
import { Modal } from '../components/Modal'
import { QR } from '../components/QR'
import { useToast } from '../components/Toast'
import { Button, Card, cx, Field, Input, PageHeader, Toggle } from '../components/ui'
import { seller } from '../lib/api'
import { publicBase } from '../lib/publicUrl'
import type { SellerSettings } from '../lib/types'
import { useSeller } from './SellerLayout'

const MODES = [
  { id: 'both', title: 'Both', body: 'Buyers choose: scan a QR Ph code (checked instantly) or pay your e-wallet and send the reference.' },
  { id: 'instant_qr', title: 'Instant QR only', body: 'Every order gets its own QR Ph code. Paid orders verify in seconds, no statement needed.' },
  { id: 'manual', title: 'Manual only', body: 'Buyers pay your GCash/Maya and type the reference. You upload your statement to check them.' },
] as const

export default function Settings() {
  const { me, refresh } = useSeller()
  const toast = useToast()
  const [f, setF] = useState<SellerSettings>(me)
  const [busy, setBusy] = useState(false)
  const [base, setBase] = useState('')
  useEffect(() => { publicBase().then(setBase) }, [])
  const set = <K extends keyof SellerSettings>(k: K, v: SellerSettings[K]) => setF({ ...f, [k]: v })
  const save = async () => {
    setBusy(true)
    try {
      await seller.put('/seller', {
        name: f.name, shop_name: f.shop_name, payment_mode: f.payment_mode, wallet_provider: f.wallet_provider,
        wallet_name: f.wallet_name, wallet_number: f.wallet_number, auto_release_gateway: f.auto_release_gateway,
        hold_minutes: Number(f.hold_minutes), pay_window_hours: Number(f.pay_window_hours),
      })
      toast('Settings saved')
      refresh()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const walletUrl = `${base}/w/${me.id}`
  const [resetOpen, setResetOpen] = useState(false)
  const reset = async () => {
    setBusy(true)
    try {
      await seller.post('/seller/reset-demo')
      toast('Demo data cleared. Catalog and settings kept.')
      setResetOpen(false)
      refresh()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <div className="mx-auto max-w-[920px] px-5 py-8 lg:px-10">
      <PageHeader title="Settings" sub="How buyers pay you, and how long they have to confirm and pay."><Button loading={busy} onClick={save}>Save changes</Button></PageHeader>

      <Card className="mb-5 p-6">
        <h2 className="mb-4 text-[17px] font-bold">Shop</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name"><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Shop name" hint="Shown on buyer pages and the live page."><Input value={f.shop_name} onChange={(e) => set('shop_name', e.target.value)} /></Field>
        </div>
      </Card>

      <Card className="mb-5 p-6">
        <h2 className="mb-1 text-[17px] font-bold">Payments</h2>
        <p className="mb-4 text-[13.5px] text-muted">The QR Ph gateway here is a test-mode stand-in: its “Confirm payment” button plays the buyer’s bank app.</p>
        <div className="mb-5 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Payment mode">
          {MODES.map((m) => (
            <button key={m.id} role="radio" aria-checked={f.payment_mode === m.id} onClick={() => set('payment_mode', m.id)}
              className={cx('rounded-xl border p-3.5 text-left', f.payment_mode === m.id ? 'border-brand bg-brand-soft ring-2 ring-brand/20' : 'border-line-2 hover:bg-sunken')}>
              <div className="font-semibold">{m.title}</div><div className="mt-1 text-[13px] leading-snug text-ink-2">{m.body}</div>
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl bg-sunken px-4 py-3">
          <div><div className="text-[14px] font-semibold">Release QR Ph payments automatically</div><div className="text-[13px] text-muted">The gateway already confirmed the money, so these orders go straight to Packing.</div></div>
          <Toggle on={f.auto_release_gateway} onChange={(v) => set('auto_release_gateway', v)} label="Release QR Ph payments automatically" />
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <Field label="E-wallet"><Input value={f.wallet_provider} onChange={(e) => set('wallet_provider', e.target.value)} /></Field>
          <Field label="Account name" hint="As buyers see it in their app"><Input value={f.wallet_name} onChange={(e) => set('wallet_name', e.target.value)} /></Field>
          <Field label="Number"><Input value={f.wallet_number} onChange={(e) => set('wallet_number', e.target.value)} /></Field>
        </div>
        <div className="mt-5 flex items-center gap-4 rounded-xl border border-line p-3">
          {base && <QR value={walletUrl} size={96} label="DemoWallet send-money QR" />}
          <div className="text-[13.5px] text-ink-2">
            <b className="text-ink">DemoWallet QR (manual mode demo).</b> Stands in for your GCash QR: buyers scan it, send money and get a reference number, then type it on their order page.
            <a href={`/w/${me.id}`} target="_blank" rel="noreferrer" className="mt-1 block font-semibold text-brand-deep underline">Open DemoWallet</a>
          </div>
        </div>
      </Card>

      <Card className="mb-5 p-6">
        <h2 className="mb-4 text-[17px] font-bold">Deadlines</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Minutes to confirm a claim" hint="After this, the item goes to the next buyer in line.">
            <Input type="number" min={1} max={240} value={f.hold_minutes} onChange={(e) => set('hold_minutes', Number(e.target.value))} />
          </Field>
          <Field label="Hours to pay after confirming" hint="Unpaid orders expire and count against the buyer.">
            <Input type="number" min={1} max={168} value={f.pay_window_hours} onChange={(e) => set('pay_window_hours', Number(e.target.value))} />
          </Field>
        </div>
      </Card>

      <Card className="mb-5 p-6">
        <h2 className="mb-3 text-[17px] font-bold">Connections</h2>
        <ul className="space-y-2 text-[14px]">
          <li className="flex items-center gap-2"><span className={cx('h-2 w-2 rounded-full', me.llm?.enabled ? 'bg-brand' : 'bg-faint')} />
            AI for messy comments: {me.llm?.enabled ? <b>on ({me.llm.model})</b> : <span className="text-muted">off. Set OPENROUTER_API_KEY on the server. Unclear comments go to Needs you meanwhile.</span>}</li>
          <li className="flex items-center gap-2"><span className={cx('h-2 w-2 rounded-full', me.meta_configured ? 'bg-brand' : 'bg-faint')} />
            Facebook Live comments: {me.meta_configured ? <b>Page token set</b> : <span className="text-muted">no Page token. Set META_PAGE_TOKEN on the server.</span>}</li>
        </ul>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-4 border-[#F2C9C4] p-6">
        <div>
          <h2 className="text-[17px] font-bold">Start the demo over</h2>
          <p className="text-[13.5px] text-muted">Clears every live, order, payment and buyer. Your catalog, settings and the AI’s learned fixes stay.</p>
        </div>
        <Button variant="outline" icon="refresh" className="text-hold" onClick={() => setResetOpen(true)}>Reset demo data</Button>
      </Card>
      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Clear all demo data?"
        footer={<><Button variant="ghost" onClick={() => setResetOpen(false)}>Keep data</Button><Button variant="danger" loading={busy} onClick={reset}>Clear demo data</Button></>}>
        <p className="text-[14px] text-ink-2">Lives, comments, orders, payments, statements and buyer records are deleted. This can’t be undone.</p>
      </Modal>
    </div>
  )
}
