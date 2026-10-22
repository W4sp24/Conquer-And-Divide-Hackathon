import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { cx } from './ui'

type Tone = 'ok' | 'error' | 'info'
interface T { id: number; text: string; tone: Tone }
const Ctx = createContext<(text: string, tone?: Tone) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([])
  const push = useCallback((text: string, tone: Tone = 'ok') => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x.slice(-3), { id, text, tone }])
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === 'error' ? 6000 : 3200)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto flex max-w-[480px] items-center gap-2.5 rounded-xl px-4 py-3 text-[14px] font-medium shadow-[var(--shadow-pop)] animate-rise',
            t.tone === 'error' ? 'bg-hold text-white' : t.tone === 'info' ? 'bg-surface text-ink border border-line' : 'bg-ink text-white')}>
            <Icon name={t.tone === 'error' ? 'alert' : t.tone === 'info' ? 'sparkle' : 'check'} size={17} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
