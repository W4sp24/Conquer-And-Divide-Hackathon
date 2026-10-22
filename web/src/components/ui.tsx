import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icon'
import type { OrderStatus, Verdict } from '../lib/types'

export function cx(...c: (string | number | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

type Variant = 'solid' | 'ghost' | 'outline' | 'danger' | 'quiet' | 'stage'
const VARIANTS: Record<Variant, string> = {
  solid: 'bg-brand text-white hover:bg-brand-deep shadow-[inset_0_-1px_0_rgb(0_0_0/0.15)]',
  ghost: 'bg-transparent text-ink-2 hover:bg-sunken',
  outline: 'bg-surface text-ink border border-line-2 hover:bg-sunken',
  danger: 'bg-hold text-white hover:bg-hold-deep',
  quiet: 'bg-sunken text-ink hover:bg-line',
  stage: 'bg-white/10 text-white hover:bg-white/20 border border-white/15',
}

export function Button({ variant = 'solid', size = 'md', icon, children, className, loading, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: IconName; loading?: boolean }) {
  const sz = size === 'sm' ? 'h-8 px-3 text-[13px] gap-1.5' : size === 'lg' ? 'h-12 px-5 text-[16px] gap-2' : 'h-10 px-4 text-[14px] gap-2'
  return (
    <button {...rest} disabled={rest.disabled || loading}
      className={cx('inline-flex items-center justify-center rounded-[10px] font-semibold transition-[background,transform,opacity] active:scale-[0.97] disabled:opacity-45 disabled:active:scale-100 select-none whitespace-nowrap',
        VARIANTS[variant], sz, className)}>
      {loading ? <Spinner size={size === 'sm' ? 14 : 16} /> : icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}
      {children}
    </button>
  )
}

export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={'animate-spin ' + className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function Card({ children, className = '', ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cx('rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]', className)}>{children}</div>
}

export function PageHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[28px] font-bold leading-tight text-ink">{title}</h1>
        {sub && <p className="mt-1 max-w-[70ch] text-[14.5px] text-muted">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

const STATUS: Record<OrderStatus, { word: string; cls: string }> = {
  CLAIMED: { word: 'Claimed', cls: 'bg-brand-soft text-brand-deep border-brand-line' },
  WAITLISTED: { word: 'Waitlist', cls: 'bg-sunken text-ink-2 border-line-2' },
  CONFIRMED: { word: 'Confirmed', cls: 'bg-[#E9EEF7] text-[#2E4A7A] border-[#C8D4EA]' },
  PROOF_SENT: { word: 'Paid, checking', cls: 'bg-pending-soft text-pending-deep border-[#F0D9B5]' },
  VERIFIED: { word: 'Verified', cls: 'bg-brand text-white border-brand' },
  PACKED: { word: 'Packed', cls: 'bg-brand-deep text-white border-brand-deep' },
  SHIPPED: { word: 'Shipped', cls: 'bg-ink text-white border-ink' },
  EXPIRED: { word: 'Expired', cls: 'bg-surface text-faint border-line-2 line-through decoration-1' },
  CANCELLED: { word: 'Cancelled', cls: 'bg-surface text-faint border-line-2 line-through decoration-1' },
}

export function StatusBadge({ status, className = '' }: { status: OrderStatus; className?: string }) {
  const s = STATUS[status]
  return <span className={cx('inline-flex h-[22px] items-center rounded-full border px-2 text-[12px] font-semibold', s.cls, className)}>{s.word}</span>
}

export function VerdictBadge({ verdict, reason }: { verdict: Verdict | null; reason?: string }) {
  if (!verdict) return null
  const map = {
    RELEASE: { word: 'Release', cls: 'bg-brand text-white', icon: 'check' as IconName },
    HOLD: { word: 'Hold', cls: 'bg-hold text-white', icon: 'alert' as IconName },
    PENDING: { word: 'Pending', cls: 'bg-pending-soft text-pending-deep', icon: 'clock' as IconName },
  }[verdict]
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className={cx('inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[12.5px] font-bold', map.cls)}>
        <Icon name={map.icon} size={14} stroke={2.2} />{map.word}
      </span>
      {reason && <span className="truncate text-[13px] text-ink-2">{reason}</span>}
    </span>
  )
}

export function LabelBadge({ label }: { label: 'HOLD' | 'WATCH' | 'TRUSTED' | 'NEW' }) {
  const cls = {
    HOLD: 'text-hold bg-hold-soft border-[#F2C9C4]',
    WATCH: 'text-pending-deep bg-pending-soft border-[#F0D9B5]',
    TRUSTED: 'text-brand-deep bg-brand-soft border-brand-line',
    NEW: 'text-muted bg-surface border-line-2',
  }[label]
  const word = { HOLD: 'Hold', WATCH: 'Watch', TRUSTED: 'Trusted', NEW: 'New' }[label]
  return <span className={cx('inline-flex h-5 items-center rounded border px-1.5 text-[11.5px] font-semibold', cls)}>{word}</span>
}

const STAGE: Record<string, { word: string; cls: string }> = {
  rules: { word: 'Rules', cls: 'text-brand-deep bg-brand-soft' },
  fuzzy: { word: 'Match', cls: 'text-[#2E4A7A] bg-[#E9EEF7]' },
  llm: { word: 'AI', cls: 'text-ai bg-ai-soft' },
  review: { word: 'Review', cls: 'text-pending-deep bg-pending-soft' },
  fixed: { word: 'Fixed', cls: 'text-brand-deep bg-brand-soft' },
  ignored: { word: 'Chat', cls: 'text-faint bg-sunken' },
  dismissed: { word: 'Ignored', cls: 'text-faint bg-sunken' },
}

export function StageTag({ stage }: { stage: string | null }) {
  const s = stage ? STAGE[stage] : null
  if (!s) return <span className="inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] font-semibold text-faint bg-sunken"><Spinner size={10} />Reading</span>
  return <span className={cx('inline-flex h-5 items-center rounded px-1.5 text-[11px] font-semibold', s.cls)}>{s.word}</span>
}

export function Code({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={cx('font-mono font-semibold tracking-tight', className)}>{children}</span>
}

export function Empty({ icon, title, body, action }: { icon: IconName; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-sunken text-muted"><Icon name={icon} size={20} /></span>
      <span className="font-display text-[16px] font-semibold text-ink">{title}</span>
      {body && <span className="max-w-[44ch] text-[13.5px] text-muted">{body}</span>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** A labelled control. `group` is for several controls (chips, buttons): a <label> may only
 *  name one control, so groups get role=group with an aria-label instead. */
export function Field({ label, hint, error, children, className = '', group }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; group?: boolean }) {
  const body = (
    <>
      <span className="text-[13px] font-semibold text-ink-2">{label}</span>
      {children}
      {error ? <span className="text-[12.5px] font-medium text-hold">{error}</span> : hint && <span className="text-[12.5px] text-muted">{hint}</span>}
    </>
  )
  return group
    ? <div role="group" aria-label={label} className={cx('flex flex-col gap-1.5', className)}>{body}</div>
    : <label className={cx('flex flex-col gap-1.5', className)}>{body}</label>
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx('h-10 w-full rounded-[10px] border border-line-2 bg-surface px-3 text-[14.5px] text-ink outline-none transition focus:border-brand focus:ring-3 focus:ring-brand/15 disabled:bg-sunken disabled:text-muted', props.className)} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx('h-10 w-full appearance-none rounded-[10px] border border-line-2 bg-surface bg-[length:12px] bg-[right_12px_center] bg-no-repeat pl-3 pr-9 text-[14.5px] text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand/15', props.className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%231F2926' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E\")" }} />
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={cx('relative h-6 w-11 shrink-0 rounded-full transition', on ? 'bg-brand' : 'bg-line-2')}>
      <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
    </button>
  )
}

export function Stepper({ value, min = 0, max = 999, onChange, label }: { value: number; min?: number; max?: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="inline-flex h-10 items-center rounded-[10px] border border-line-2 bg-surface" role="group" aria-label={label}>
      <button type="button" className="grid h-full w-10 place-items-center text-ink-2 disabled:opacity-30" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={`Less ${label}`}><Icon name="minus" size={16} /></button>
      <span className="w-8 text-center font-semibold tabular">{value}</span>
      <button type="button" className="grid h-full w-10 place-items-center text-ink-2 disabled:opacity-30" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={`More ${label}`}><Icon name="plus" size={16} /></button>
    </div>
  )
}
