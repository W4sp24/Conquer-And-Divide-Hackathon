import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { Button, Code, Spinner } from '../components/ui'
import { pub } from '../lib/api'
import { dateTime, peso, toCentavos } from '../lib/format'

interface Info { provider: string; name: string; number: string; shop_name: string }
interface Receipt { reference: string; amount_centavos: number; paid_at: string; to_name: string; to_number: string }

/** DemoWallet: stands in for the buyer's GCash app in Manual mode. Sending money here
 *  writes to the seller's mock ledger, which the seller later exports as a statement. */
export default function Wallet() {
  const { sellerId = '' } = useParams()
  const [sp] = useSearchParams()
  const [info, setInfo] = useState<Info | null>(null)
  const [amount, setAmount] = useState(sp.get('amount') ? (Number(sp.get('amount')) / 100).toFixed(2) : '')
  const [sender, setSender] = useState('')
  const [msg] = useState(sp.get('note') ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [copied, setCopied] = useState(false)
  const back = sp.get('back')
  useEffect(() => { pub.get<Info>(`/wallet/${sellerId}`).then(setInfo).catch((e) => setErr(e.message)) }, [sellerId])
  const cents = toCentavos(amount)
  const send = async () => {
    setBusy(true); setErr(null)
    try { setReceipt(await pub.post<Receipt>(`/wallet/${sellerId}/send`, { amount_centavos: cents, sender_name: sender.trim(), message: msg })) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="min-h-[100dvh] bg-[#0E5FD8] px-4 py-6 text-white sm:py-10">
      <div className="mx-auto max-w-[400px]">
        <div className="mb-5 flex items-center justify-between">
          <span className="flex items-center gap-2 font-display text-[19px] font-bold"><span className="grid h-8 w-8 place-items-center rounded-full bg-white font-display text-[16px] text-[#0E5FD8]">D</span>DemoWallet</span>
          <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11.5px] font-bold">DEMO</span>
        </div>
        <div className="rounded-[22px] bg-white p-6 text-ink shadow-2xl">
          {!info ? <div className="grid h-[300px] place-items-center">{err ? <p className="text-hold">{err}</p> : <Spinner size={22} />}</div> : receipt ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-[#0E5FD8] text-white animate-pop"><Icon name="check" size={28} stroke={2.6} /></span>
              <div className="text-[13px] font-semibold text-muted">Sent successfully</div>
              <div className="font-display text-[34px] font-bold leading-none tabular">{peso(receipt.amount_centavos)}</div>
              <div className="text-[14px]">to <b>{receipt.to_name}</b> · <span className="font-mono">{receipt.to_number}</span></div>
              <div className="mt-2 w-full rounded-xl border-2 border-dashed border-[#0E5FD8]/40 bg-[#EEF4FD] px-4 py-3">
                <div className="text-[12.5px] font-semibold text-[#0E5FD8]">Reference No.</div>
                <Code className="text-[22px] tracking-wider">{receipt.reference.replace(/(\d{4})(\d{3})(\d{6})/, '$1 $2 $3')}</Code>
                <div className="text-[12px] text-muted">{dateTime(receipt.paid_at)}</div>
              </div>
              <Button variant="outline" className="w-full" icon={copied ? 'check' : 'copy'} onClick={() => navigator.clipboard?.writeText(receipt.reference).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy reference'}</Button>
              {back && <Link to={back} className="inline-flex h-11 w-full items-center justify-center rounded-[10px] bg-ink text-[15px] font-semibold text-white">Back to my order</Link>}
              <p className="text-[12.5px] text-muted">Type this reference on your order page.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="text-center">
                <div className="text-[13px] text-muted">Send money to</div>
                <div className="font-display text-[20px] font-bold">{info.name}</div>
                <div className="font-mono text-[14px] text-ink-2">{info.number}</div>
                <div className="text-[12.5px] text-muted">{info.shop_name}</div>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-ink-2">Amount</span>
                <div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-[20px] text-muted">₱</span>
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00"
                    className="h-14 w-full rounded-xl border border-line-2 pl-9 pr-4 font-display text-[26px] font-bold tabular outline-none focus:border-[#0E5FD8]" /></div>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-ink-2">Your name</span>
                <input value={sender} onChange={(e) => setSender(e.target.value)} placeholder="Name on your account" maxLength={60}
                  className="h-11 rounded-xl border border-line-2 px-3.5 text-[15px] outline-none focus:border-[#0E5FD8]" />
              </label>
              {msg && <div className="rounded-lg bg-sunken px-3 py-2 text-[13px] text-ink-2">Message: {msg}</div>}
              {err && <p className="text-[14px] font-medium text-hold" role="alert">{err}</p>}
              <Button size="lg" loading={busy} disabled={!cents || !sender.trim()} onClick={send} className="!bg-[#0E5FD8] hover:!bg-[#0B4DB0]">Send {cents ? peso(cents) : ''}</Button>
            </div>
          )}
        </div>
        <p className="mt-5 text-center text-[12.5px] text-white/75">A stand-in for GCash or Maya in the demo. No real money moves.</p>
      </div>
    </div>
  )
}
