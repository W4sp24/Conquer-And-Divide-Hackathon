import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'
import { cx } from './ui'

export function Modal({ open, onClose, title, kicker, children, footer, wide }: {
  open: boolean; onClose: () => void; title: string; kicker?: string; children: ReactNode; footer?: ReactNode; wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not([aria-label="Close"])')?.focus(), 30)
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-ink/35 backdrop-blur-[2px] animate-[rise_.2s]" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title}
        className={cx('relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-surface shadow-[var(--shadow-pop)] animate-pop sm:rounded-2xl', wide ? 'sm:max-w-[760px]' : 'sm:max-w-[520px]')}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 pb-4 pt-5">
          <div>
            {kicker && <div className="text-[13px] font-medium text-muted">{kicker}</div>}
            <h2 className="text-[20px] font-bold text-ink">{title}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-sunken"><Icon name="x" /></button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>
  )
}
