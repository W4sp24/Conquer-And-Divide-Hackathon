import { useState } from 'react'
import { BRAND } from '../brand'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { Button, cx } from './ui'

// Every screen carries a "Prototype demo" marker, and the seller desk opens an explainer
// window once per browser, so judges and testers know what is real and what is simulated.

const SEEN = 'demo-notice-seen'

function firstVisit() {
  if (navigator.webdriver) return false          // keep automated tests and screenshot tours unblocked
  try { return !localStorage.getItem(SEEN) } catch { return false }   // storage blocked: the strip still says it's a demo
}

const REAL = [
  'Comments become orders as they arrive, from the in-app live page, a replay, or Facebook Live.',
  'The camera stream from the seller’s laptop to viewers’ phones.',
  'The first-come queue, waitlist, expiry timers and every payment check.',
]
const SIMULATED = [
  'QR Ph payments go through MockPay, a test gateway. No real money moves.',
  'DemoWallet stands in for GCash or Maya, and makes the statement the seller uploads.',
  'The shop, catalog and past lives are sample data. Settings → Reset demo data restores them.',
]

export function DemoWindow({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} kicker={`${BRAND.event} prototype`} title={`This is a demo of ${BRAND.name}`}
      footer={<Button onClick={onClose}>Got it</Button>}>
      <p className="mb-4 text-[14px] text-ink-2">A working prototype built for the hackathon. You can use it like the real thing: comment, claim, pay and pack.</p>
      <h3 className="mb-1.5 text-[14.5px] font-bold">Real</h3>
      <ul className="mb-4 space-y-1.5">
        {REAL.map((t) => <li key={t} className="flex gap-2 text-[14px] text-ink-2"><Icon name="check" size={16} className="mt-0.5 shrink-0 text-brand" />{t}</li>)}
      </ul>
      <h3 className="mb-1.5 text-[14.5px] font-bold">Simulated</h3>
      <ul className="space-y-1.5">
        {SIMULATED.map((t) => <li key={t} className="flex gap-2 text-[14px] text-ink-2"><Icon name="sparkle" size={16} className="mt-0.5 shrink-0 text-muted" />{t}</li>)}
      </ul>
    </Modal>
  )
}

/** Small pill that opens the demo window. `dark` for use on dark backgrounds. */
export function DemoBadge({ dark = false, className }: { dark?: boolean; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Prototype demo: what’s real and what’s simulated"
        className={cx('demo-stripes inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[11.5px] font-bold',
          dark ? 'border-white/25 text-white' : 'border-ink/20 text-ink', className)}>
        <Icon name="sparkle" size={12} stroke={2.2} />Demo
      </button>
      <DemoWindow open={open} onClose={() => setOpen(false)} />
    </>
  )
}

/** Full-width strip across the top of the seller desk. Opens the window once per browser. */
export function DemoBanner() {
  const [open, setOpen] = useState(firstVisit)
  const close = () => {
    setOpen(false)
    try { localStorage.setItem(SEEN, '1') } catch { /* ignore */ }
  }
  return (
    <>
      <div role="note" className="flex items-center gap-3 bg-ink px-5 py-1.5 text-[13px] text-white print:hidden lg:px-10">
        <span className="demo-stripes inline-flex h-5 items-center rounded-full border border-white/25 px-2 text-[11px] font-bold">Prototype demo</span>
        <span className="min-w-0 flex-1 truncate text-white/80">{BRAND.event} · Payments are simulated and no real money moves.</span>
        <button type="button" onClick={() => setOpen(true)} className="shrink-0 font-semibold underline underline-offset-2 hover:text-white/80">What’s real?</button>
      </div>
      <DemoWindow open={open} onClose={close} />
    </>
  )
}
