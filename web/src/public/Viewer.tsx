import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BRAND } from '../brand'
import { DemoBadge } from '../components/Demo'
import { Icon } from '../components/Icon'
import { ItemThumb } from '../components/ItemThumb'
import { Button, Code, cx, Spinner } from '../components/ui'
import { pub, streamUrl } from '../lib/api'
import { peso } from '../lib/format'
import { useDebounced, useDeviceId, useEventStream } from '../lib/hooks'
import { watch } from '../lib/rtc'
import type { Item } from '../lib/types'

interface VComment { id: string; name: string; message: string; created_time: string; stage: string | null; outcome: string | null; mine?: boolean }
interface Info { id: string; title: string; status: string; shop_name: string; fb_video_url: string | null; camera_live: boolean; on_camera: Item | null; comments: VComment[] }
interface MyOrder { token: string; item_code: string; item_name: string; status: string; total_centavos: number }

const NAME_KEY = 'od.viewerName'

/** Public live page: judges/buyers scan the QR, watch the seller's camera and comment.
 *  Comments go through the exact same pipeline as Facebook comments. */
export default function Viewer() {
  const { sid = '' } = useParams()
  const device = useDeviceId()
  const [info, setInfo] = useState<Info | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [comments, setComments] = useState<VComment[]>([])
  const [mine, setMine] = useState<MyOrder[]>([])
  const [myIds, setMyIds] = useState<Set<string>>(new Set())
  const load = useCallback(async () => {
    try {
      const i = await pub.get<Info>(`/public/sessions/${sid}`)
      setInfo(i)
      setComments(i.comments)
    } catch (e) { setErr((e as Error).message) }
  }, [sid])
  const loadMine = useCallback(async () => {
    try { setMine(await pub.get<MyOrder[]>(`/public/sessions/${sid}/my-orders?device_id=${device}`)) } catch { /* ignore */ }
  }, [sid, device])
  useEffect(() => { load(); loadMine() }, [load, loadMine])
  const debMine = useDebounced(loadMine, 300)

  useEventStream(streamUrl(`/public/sessions/${sid}/stream`), (e: Record<string, unknown>) => {
    if (e.type === 'comment') {
      const c = e.comment as VComment
      setComments((x) => (x.some((y) => y.id === c.id) ? x : [...x, { ...c, stage: null, outcome: null }].slice(-80)))
    } else if (e.type === 'parsed') {
      setComments((x) => x.map((c) => (c.id === e.comment_id ? { ...c, stage: e.stage as string, outcome: e.outcome as string | null } : c)))
      debMine()
    } else if (e.type === 'camera') {
      setInfo((i) => (i ? { ...i, on_camera: e.item as Item | null } : i))
    } else if (e.type === 'camera_live') {
      setInfo((i) => (i ? { ...i, camera_live: !!e.live } : i))
    } else if (e.type === 'session') {
      setInfo((i) => (i ? { ...i, status: e.status as string } : i))
    } else if (e.type === 'order') {
      debMine()
    }
  }, load)

  if (err && !info) return <div className="grid min-h-[100dvh] place-items-center bg-stage p-6 text-center text-white"><div><p className="text-[18px] font-semibold">This live isn’t available</p><p className="text-white/60">Check the QR code or link.</p></div></div>
  if (!info) return <div className="grid min-h-[100dvh] place-items-center bg-stage text-white"><Spinner size={22} /></div>
  const ended = info.status !== 'running'
  return (
    <div className="flex h-[100dvh] flex-col bg-stage text-white lg:flex-row">
      <div className="relative shrink-0 lg:flex-1">
        <Video sid={sid} info={info} />
        <div className="absolute left-3 top-3 flex items-center gap-2">
          <span className={cx('inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-bold', ended ? 'bg-black/50' : 'bg-hold')}>
            {!ended && <span className="live-dot h-1.5 w-1.5 rounded-full bg-white" />}{ended ? 'Ended' : 'LIVE'}
          </span>
          <span className="max-w-[50vw] truncate rounded-full bg-black/45 px-2.5 py-1 text-[12.5px] font-semibold">{info.shop_name}</span>
          <DemoBadge dark className="bg-black/45" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col bg-stage lg:max-w-[420px] lg:border-l lg:border-white/10">
        {info.on_camera && (
          <div className="flex items-center gap-3 border-b border-white/10 bg-stage-2 px-4 py-2.5">
            <ItemThumb name={info.on_camera.name} tone={info.on_camera.tone} photo={info.on_camera.photo_url} size={42} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14.5px] font-semibold"><Code className="text-white/70">{info.on_camera.code}</Code> {info.on_camera.name}</div>
              <div className="text-[12.5px] text-white/65">{peso(info.on_camera.price_centavos, true)} · {info.on_camera.sizes.join(' / ') || 'One size'} · comment <b className="text-white">“mine”</b> to claim</div>
            </div>
          </div>
        )}
        {mine.length > 0 && (
          <div className="flex gap-2 overflow-x-auto border-b border-white/10 px-4 py-2.5">
            {mine.map((o) => (
              <Link key={o.token} to={`/o/${o.token}`} className="flex shrink-0 items-center gap-2 rounded-full bg-brand px-3 py-1.5 text-[13px] font-semibold">
                <Icon name="check" size={14} stroke={2.4} />{o.item_code} · {{ CLAIMED: 'confirm now', WAITLISTED: 'waitlist', CONFIRMED: 'pay now', PROOF_SENT: 'checking', VERIFIED: 'paid', PACKED: 'packed', SHIPPED: 'shipped', EXPIRED: 'expired', CANCELLED: 'cancelled' }[o.status] ?? o.status}
                <Icon name="chevron" size={14} />
              </Link>
            ))}
          </div>
        )}
        <CommentList comments={comments} myIds={myIds} />
        {ended ? (
          <div className="border-t border-white/10 px-4 py-4 text-center text-[14px] text-white/70">This live has ended. Your order links above still work.</div>
        ) : (
          <Composer sid={sid} device={device} onSent={(id) => { setMyIds((s) => new Set(s).add(id)); debMine() }} />
        )}
      </div>
    </div>
  )
}

function Video({ sid, info }: { sid: string; info: Info }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<'idle' | 'connecting' | 'playing' | 'failed'>('idle')
  const [muted, setMuted] = useState(true)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const connect = useCallback(async () => {
    pcRef.current?.close()
    setState('connecting')
    try {
      pcRef.current = await watch(sid, (s) => {
        if (ref.current) { ref.current.srcObject = s; ref.current.play().catch(() => {}) }
        setState('playing')
      }, (st) => { if (st === 'failed' || st === 'disconnected') setState('failed') })
    } catch { setState('failed') }
  }, [sid])
  useEffect(() => {
    if (info.camera_live) connect()
    else { pcRef.current?.close(); pcRef.current = null; setState('idle') }
    return () => { /* keep connection across re-renders */ }
  }, [info.camera_live, connect])
  useEffect(() => () => pcRef.current?.close(), [])

  const fb = info.fb_video_url
  return (
    <div className="relative aspect-video w-full bg-black lg:aspect-auto lg:h-full">
      <video ref={ref} playsInline autoPlay muted={muted} className={cx('absolute inset-0 h-full w-full object-contain', state === 'playing' ? '' : 'hidden')} />
      {state === 'playing' && (
        <button onClick={() => { setMuted(!muted); ref.current?.play().catch(() => {}) }} className="absolute bottom-3 right-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-black/55 px-3 text-[13px] font-semibold">
          <Icon name={muted ? 'micOff' : 'mic'} size={15} />{muted ? 'Tap for sound' : 'Sound on'}
        </button>
      )}
      {state !== 'playing' && (
        fb && !info.camera_live ? (
          <iframe title="Facebook live video" className="absolute inset-0 h-full w-full" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen
            src={`https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(fb)}&show_text=false&autoplay=true`} />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 pb-3 pt-12 text-center">
            {state === 'connecting' ? <><Spinner size={22} /><span className="text-[14px] text-white/70">Connecting to the live video…</span></> :
              state === 'failed' ? <><span className="text-[14px] text-white/70">Couldn’t load the video. You can still comment.</span><Button variant="stage" size="sm" icon="refresh" onClick={connect}>Try again</Button></> :
                info.on_camera ? <><ItemThumb name={info.on_camera.name} tone={info.on_camera.tone} photo={info.on_camera.photo_url} size={84} rounded={14} /><span className="text-[13.5px] text-white/65">The seller’s camera is off. Comment to claim what’s being shown.</span></> :
                  <><Icon name="video" size={30} className="text-white/40" /><span className="text-[14px] text-white/65">Video starts when the seller turns on the camera.</span></>}
          </div>
        )
      )}
    </div>
  )
}

function CommentList({ comments, myIds }: { comments: VComment[]; myIds: Set<string> }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight }, [comments.length])
  return (
    <div ref={box} className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
      {comments.length === 0 && <p className="py-8 text-center text-[14px] text-white/50">Be the first to comment. Try “mine” to claim the item on camera.</p>}
      {comments.map((c) => (
        <div key={c.id} className={cx('mb-2 animate-rise text-[14.5px] leading-snug', myIds.has(c.id) && 'rounded-lg bg-white/[0.06] px-2 py-1')}>
          <b className="mr-1.5 text-white/60">{c.name}</b>{c.message}
          {c.outcome && <span className="ml-2 inline-block rounded bg-brand/90 px-1.5 text-[11.5px] font-semibold align-middle">{c.outcome}</span>}
        </div>
      ))}
    </div>
  )
}

function Composer({ sid, device, onSent }: { sid: string; device: string; onSent: (id: string) => void }) {
  const [name, setName] = useState(() => { try { return localStorage.getItem(NAME_KEY) || '' } catch { return '' } })
  const [editingName, setEditingName] = useState(!name)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const saveName = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    try { localStorage.setItem(NAME_KEY, name.trim()) } catch { /* ignore */ }
    setEditingName(false)
  }
  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!msg.trim()) return
    setBusy(true); setErr(null)
    try {
      const r = await pub.post<{ id: string }>(`/public/sessions/${sid}/comments`, { device_id: device, name: name.trim(), message: msg.trim() })
      onSent(r.id)
      setMsg('')
    } catch (x) { setErr((x as Error).message) } finally { setBusy(false) }
  }
  if (editingName) {
    return (
      <form onSubmit={saveName} className="border-t border-white/10 p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <label className="mb-2 block text-[13.5px] text-white/75">Your name, so the seller knows who claimed</label>
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={40} placeholder="e.g. Ana Reyes" aria-label="Your name"
            className="h-11 min-w-0 flex-1 rounded-full border border-white/15 bg-white/10 px-4 text-[15px] text-white outline-none placeholder:text-white/40 focus:border-white/40" />
          <Button className="h-11 rounded-full" disabled={!name.trim()}>Join</Button>
        </div>
      </form>
    )
  }
  return (
    <form onSubmit={send} className="border-t border-white/10 p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
      {err && <p className="mb-2 text-[13px] text-[#FFB4AB]">{err}</p>}
      <div className="flex gap-2">
        <input value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={300} placeholder={`Comment as ${name}… try “mine”`} aria-label="Comment"
          className="h-11 min-w-0 flex-1 rounded-full border border-white/15 bg-white/10 px-4 text-[15px] text-white outline-none placeholder:text-white/40 focus:border-white/40" />
        <button disabled={busy || !msg.trim()} aria-label="Send comment" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand disabled:opacity-40">{busy ? <Spinner size={16} /> : <Icon name="send" size={18} />}</button>
      </div>
      <div className="mt-1.5 flex justify-between text-[11.5px] text-white/45">
        <button type="button" onClick={() => setEditingName(true)} className="underline">Not {name}?</button>
        <span>{BRAND.name} · your name shows as “{name.split(' ')[0]}{name.split(' ').length > 1 ? ` ${name.split(' ').slice(-1)[0][0]}.` : ''}”</span>
      </div>
    </form>
  )
}
