import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { Button, Code, Spinner } from '../components/ui'
import { pub } from '../lib/api'
import { dateTime, duration, peso } from '../lib/format'
import { useNow, useServerOffset } from '../lib/hooks'

interface Intent {
  id: string; status: 'awaiting_payment' | 'paid' | 'expired' | 'cancelled'; amount_centavos: number
  merchant: string; description: string; expires_at: string; reference: string | null; paid_at: string | null
  order_token: string; server_now: string
}

/** Mock QR Ph checkout. Opening the buyer's QR lands here; this page plays the part of
 *  the buyer's bank / e-wallet app. "Confirm payment" makes the mock gateway send a
 *  signed payment.paid webhook to the order system, like PayMongo would. */
export default function PayQR() {
  const { intentId = '' } = useParams()
  const [it, setIt] = useState<Intent | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const load = useCallback(async () => {
    try { setIt(await pub.get<Intent>(`/gateway/intents/${intentId}`)) } catch (e) { setErr((e as Error).message) }
  }, [intentId])
  useEffect(() => { load() }, [load])
  const offset = useServerOffset(it?.server_now)
  const now = useNow(1000) + offset
  const left = it ? new Date(it.expires_at).getTime() - now : 0
  const pay = async () => {
    setBusy(true); setErr(null)
    try { await pub.post(`/gateway/intents/${intentId}/pay`, { payer_name: name.trim() || null }); await load() }
    catch (e) { setErr((e as Error).message); load() } finally { setBusy(false) }
  }
  const cancel = async () => { await pub.post(`/gateway/intents/${intentId}/cancel`).catch(() => {}); load() }

  return (
    <div className="min-h-[100dvh] bg-[#0B2A6F] px-4 py-6 text-white sm:py-10">
      <div className="mx-auto max-w-[400px]">
        <div className="mb-5 flex items-center justify-between">
          <span className="flex items-center gap-2 font-display text-[19px] font-bold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-[#0B2A6F]"><Icon name="qr" size={18} stroke={2.2} /></span>MockPay</span>
          <span className="rounded-full bg-[#F7C948] px-2.5 py-1 text-[11.5px] font-bold text-[#3B2A00]">TEST MODE</span>
        </div>
        <div className="overflow-hidden rounded-[22px] bg-white text-ink shadow-2xl">
          {!it ? <div className="grid h-[360px] place-items-center">{err ? <p className="px-6 text-center text-hold">{err}</p> : <Spinner size={22} />}</div> : (
            <>
              <div className="border-b border-line px-6 pb-5 pt-6 text-center">
                <div className="text-[13px] font-medium text-muted">Pay to</div>
                <div className="font-display text-[20px] font-bold">{it.merchant}</div>
                <div className="mt-3 font-display text-[40px] font-bold leading-none tabular">{peso(it.amount_centavos)}</div>
                <div className="mt-2 text-[13.5px] text-ink-2">{it.description}</div>
              </div>
              <div className="px-6 py-5">
                {it.status === 'paid' ? (
                  <div className="flex flex-col items-center gap-3 text-center">
                    <span className="grid h-16 w-16 place-items-center rounded-full bg-brand text-white animate-pop"><Icon name="check" size={32} stroke={2.6} /></span>
                    <div className="font-display text-[22px] font-bold">Payment successful</div>
                    <div className="w-full rounded-xl bg-sunken text-left text-[14px]">
                      <div className="flex justify-between border-b border-line px-4 py-2.5"><span className="text-muted">Reference</span><Code>{it.reference}</Code></div>
                      <div className="flex justify-between px-4 py-2.5"><span className="text-muted">Paid</span><b>{dateTime(it.paid_at)}</b></div>
                    </div>
                    <p className="text-[13px] text-muted">The seller was notified automatically. No screenshot needed.</p>
                    <Link to={`/o/${it.order_token}`} className="inline-flex h-11 w-full items-center justify-center rounded-[10px] bg-ink text-[15px] font-semibold text-white">Back to my order</Link>
                  </div>
                ) : it.status === 'awaiting_payment' && left > 0 ? (
                  <div className="flex flex-col gap-3">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[13px] font-semibold text-ink-2">Account holder (optional)</span>
                      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Juan Dela Cruz" maxLength={60}
                        className="h-11 rounded-xl border border-line-2 px-3.5 text-[15px] outline-none focus:border-[#0B2A6F]" />
                    </label>
                    <div className="flex items-center justify-between rounded-xl bg-sunken px-4 py-2.5 text-[13.5px]"><span className="text-muted">From</span><b>Demo Bank •••• 4417</b></div>
                    {err && <p className="text-[14px] font-medium text-hold" role="alert">{err}</p>}
                    <Button size="lg" loading={busy} onClick={pay} className="!bg-[#0B2A6F] hover:!bg-[#081F52]">Confirm payment of {peso(it.amount_centavos)}</Button>
                    <button onClick={cancel} className="h-10 text-[14px] font-semibold text-muted">Cancel</button>
                    <p className="text-center text-[12.5px] text-muted">Code expires in <b className="font-mono tabular">{duration(left)}</b></p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-4 text-center">
                    <Icon name="clock" size={30} className="text-muted" />
                    <div className="font-display text-[20px] font-bold">{it.status === 'cancelled' ? 'Payment cancelled' : 'This QR code expired'}</div>
                    <p className="text-[14px] text-muted">Nothing was charged. Go back to your order for a new code.</p>
                    <Link to={`/o/${it.order_token}`} className="inline-flex h-11 w-full items-center justify-center rounded-[10px] bg-ink text-[15px] font-semibold text-white">Back to my order</Link>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <p className="mt-5 text-center text-[12.5px] leading-relaxed text-white/70">Simulated QR Ph checkout for the demo. In production this step is the buyer’s own bank or e-wallet app, and the gateway (e.g. PayMongo) notifies the shop.</p>
      </div>
    </div>
  )
}
