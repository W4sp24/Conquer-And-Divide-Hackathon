import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { ItemThumb } from '../components/ItemThumb'
import { QR } from '../components/QR'
import { useToast } from '../components/Toast'
import { Button, Code, cx, Empty, Select, Spinner, StageTag, StatusBadge } from '../components/ui'
import { seller, streamUrl } from '../lib/api'
import { clock, duration, peso } from '../lib/format'
import { useDebounced, useEventStream, useNow } from '../lib/hooks'
import { publicBase } from '../lib/publicUrl'
import { Broadcaster } from '../lib/rtc'
import type { Board, BoardItem, Comment, Order } from '../lib/types'
import { OrderDrawer } from './OrderDrawer'
import { useSeller } from './SellerLayout'

type Ev =
  | { type: 'comment'; comment: Comment }
  | { type: 'parsed'; comment_id: string; stage: Comment['stage']; result: Comment['result']; outcome: string | null }
  | { type: 'order'; order_id: string; status: string; item_id: string }
  | { type: 'rtc-offer'; peer_id: string; sdp: string }
  | { type: 'session' | 'camera' | 'verdict' | 'replay_done' | 'hello' }

export default function LiveBoard() {
  const { sid = '' } = useParams()
  const { refresh: refreshShell } = useSeller()
  const toast = useToast()
  const nav = useNavigate()
  const [board, setBoard] = useState<Board | null>(null)
  const [feed, setFeed] = useState<Comment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<Set<string>>(new Set())
  const [drawer, setDrawer] = useState<string | null>(null)
  const [viewerUrl, setViewerUrl] = useState('')
  const bc = useRef<Broadcaster | null>(null)

  const load = useCallback(async () => {
    try {
      const b = await seller.get<Board>(`/sessions/${sid}/board`)
      setBoard(b)
      setFeed((prev) => {
        // keep comments that arrived over SSE but aren't in the snapshot yet
        const ids = new Set(b.comments.map((c) => c.id))
        return [...b.comments, ...prev.filter((c) => !ids.has(c.id) && !c.stage)].slice(-200)
      })
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [sid])

  useEffect(() => { setBoard(null); setFeed([]); load() }, [load])
  useEffect(() => { publicBase().then((b) => setViewerUrl(`${b}/live/${sid}`)) }, [sid])
  const reload = useDebounced(load, 120)
  const reloadShell = useDebounced(refreshShell, 600)

  const onEvent = useCallback((e: Ev) => {
    if (e.type === 'comment') {
      setFeed((f) => (f.some((c) => c.id === e.comment.id) ? f : [...f, { ...e.comment, stage: null, result: null, confidence: null, outcome: null }].slice(-200)))
    } else if (e.type === 'parsed') {
      setFeed((f) => f.map((c) => (c.id === e.comment_id ? { ...c, stage: e.stage, result: e.result, outcome: e.outcome } : c)))
      reload()
      if (e.stage === 'review') reloadShell()
    } else if (e.type === 'order') {
      setFlash((s) => new Set(s).add(e.order_id))
      setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(e.order_id); return n }), 1800)
      reload()
    } else if (e.type === 'rtc-offer') {
      bc.current?.handleOffer(e.peer_id, e.sdp).catch(() => {})
    } else if (e.type === 'replay_done') {
      toast('Replay finished. You can keep taking comments from viewers.', 'info')
      reload()
    } else if (e.type !== 'hello') {
      reload()
    }
  }, [reload, reloadShell, toast])
  const connected = useEventStream<Ev>(sid ? streamUrl(`/sessions/${sid}/stream`, true) : null, onEvent, load)

  if (error && !board) return <div className="p-10"><Empty icon="alert" title="Couldn’t open this live" body={error} action={<Button onClick={() => nav('/seller/sessions')}>Back to lives</Button>} /></div>
  if (!board) return <div className="grid min-h-[70vh] place-items-center"><Spinner size={22} /></div>

  const s = board.session
  const running = s.status === 'running'
  const setCam = async (code: string | null) => {
    try {
      await seller.put(`/sessions/${sid}/on-camera`, { item_code: code })
      load()
    } catch (e) { toast((e as Error).message, 'error') }
  }
  const end = async () => {
    await bc.current?.stop()
    await seller.post(`/sessions/${sid}/stop`).catch(() => {})
    toast('Live ended. Orders stay open for buyers to confirm and pay.')
    refreshShell()
    load()
  }
  const restart = async () => {
    await seller.post(`/sessions/${sid}/start`)
    refreshShell()
    load()
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header board={board} connected={connected} onEnd={end} onRestart={restart} />
      {s.error && (
        <div className="mx-5 mt-4 flex items-start gap-3 rounded-xl border border-[#F2C9C4] bg-hold-soft px-4 py-3 text-[14px] text-hold-deep lg:mx-8">
          <Icon name="alert" className="mt-0.5" />
          <div><b>Comments stopped coming in.</b> {s.error}</div>
        </div>
      )}
      <div className="grid flex-1 gap-5 px-5 py-5 lg:px-8 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Stage board={board} sid={sid} bc={bc} viewerUrl={viewerUrl} running={running} flash={flash} onOrder={setDrawer} onClear={() => setCam(null)} />
          <ItemGrid board={board} onCam={setCam} flash={flash} onOrder={setDrawer} />
        </div>
        <div className="flex min-w-0 flex-col gap-5 xl:sticky xl:top-5 xl:h-[calc(100vh-112px)]">
          <Review board={board} onDone={load} />
          <Feed feed={feed} running={running} sid={sid} />
        </div>
      </div>
      <OrderDrawer orderId={drawer} onClose={() => setDrawer(null)} onChanged={load} />
    </div>
  )
}

function Header({ board, connected, onEnd, onRestart }: { board: Board; connected: boolean; onEnd: () => void; onRestart: () => void }) {
  const now = useNow(1000)
  const s = board.session
  const running = s.status === 'running'
  const started = s.started_at ? new Date(s.started_at).getTime() : now
  const sc = board.score
  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-bg/90 px-5 py-3 backdrop-blur lg:top-0 lg:px-8">
      <div className="min-w-0">
        <h1 className="truncate text-[21px] font-bold leading-tight">{board.shop_name}</h1>
        <div className="truncate text-[13px] text-muted">{s.title} · {{ chat: 'Live here', meta: 'Facebook Live', replay: `Replay ${s.replay_speed}×` }[s.source]}</div>
      </div>
      <span className={cx('inline-flex h-8 items-center gap-2 rounded-full px-3 text-[13px] font-bold', running ? 'bg-hold text-white' : 'bg-sunken text-muted')}>
        <span className={cx('h-2 w-2 rounded-full', running ? 'live-dot bg-white' : 'bg-faint')} />
        {running ? 'LIVE' : 'Ended'}
        {running && <span className="font-mono font-semibold tabular opacity-90">{duration(now - started)}</span>}
      </span>
      {!connected && <span className="inline-flex items-center gap-1.5 text-[13px] text-pending"><Spinner size={13} />Reconnecting</span>}
      <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2 text-[13.5px]">
        <span className="text-ink-2" title="How comments were read">
          Rules <b className="tabular text-ink">{sc.rules}</b> · Match <b className="tabular text-ink">{sc.fuzzy}</b> · AI <b className="tabular text-ai">{sc.llm}</b> · Fixed <b className="tabular text-ink">{sc.fixed}</b>
        </span>
        <span className="hidden text-ink-2 md:inline"><b className="tabular text-ink">{board.totals.orders}</b> orders · <b className="tabular text-ink">{peso(board.totals.value_centavos, true)}</b></span>
        {running
          ? <Button variant="outline" size="sm" icon="stop" onClick={onEnd}>End live</Button>
          : <Button size="sm" icon="play" onClick={onRestart}>Resume live</Button>}
      </div>
    </header>
  )
}

// ---- the stage: camera + item on camera + its queue -------------------------------------

function Stage({ board, sid, bc, viewerUrl, running, flash, onOrder, onClear }: {
  board: Board; sid: string; bc: React.MutableRefObject<Broadcaster | null>; viewerUrl: string; running: boolean
  flash: Set<string>; onOrder: (id: string) => void; onClear: () => void
}) {
  const cam = board.on_camera
  const toast = useToast()
  const video = useRef<HTMLVideoElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [mic, setMic] = useState(true)
  const [starting, setStarting] = useState(false)
  const [showQr, setShowQr] = useState(true)

  const startCam = async (id?: string) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast('This browser can’t use the camera here. Open the board on http://localhost or https.', 'error')
      return
    }
    setStarting(true)
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: id ? { exact: id } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      s.getAudioTracks().forEach((t) => (t.enabled = mic))
      stream?.getTracks().forEach((t) => t.stop())
      setStream(s)
      if (bc.current) bc.current.replaceStream(s)
      else bc.current = new Broadcaster(sid, s)
      await seller.post(`/sessions/${sid}/rtc/state`, { live: true })
      const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
      setDevices(list)
      setDeviceId(s.getVideoTracks()[0]?.getSettings().deviceId || '')
    } catch (e) {
      const name = (e as DOMException).name
      toast(name === 'NotAllowedError' ? 'Camera blocked. Allow camera access in the address bar, then try again.'
        : name === 'NotFoundError' ? 'No camera found on this computer.' : (e as Error).message, 'error')
    } finally {
      setStarting(false)
    }
  }
  const stopCam = async () => {
    stream?.getTracks().forEach((t) => t.stop())
    setStream(null)
    bc.current?.stop()
    bc.current = null
    await seller.post(`/sessions/${sid}/rtc/state`, { live: false }).catch(() => {})
  }
  useEffect(() => { if (video.current) video.current.srcObject = stream }, [stream])
  useEffect(() => { stream?.getAudioTracks().forEach((t) => (t.enabled = mic)) }, [mic, stream])
  useEffect(() => () => {               // leaving the board turns the camera off
    stream?.getTracks().forEach((t) => t.stop())
    bc.current?.stop()
    bc.current = null
    seller.post(`/sessions/${sid}/rtc/state`, { live: false }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid])
  useEffect(() => { if (!running && stream) stopCam() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  const queue = cam ? [...cam.confirmed, ...cam.claimed] : []
  const left = cam ? cam.free_units : 0
  return (
    <section className="overflow-hidden rounded-[18px] bg-stage text-white shadow-[var(--shadow-pop)]" aria-label="On camera">
      <div className="grid md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="relative aspect-video bg-stage-2 md:aspect-auto md:min-h-[320px]">
          {stream ? (
            <video ref={video} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover [transform:scaleX(-1)]" />
          ) : (
            <div className={cx('absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center', showQr && running && 'md:items-start md:pr-[240px] md:text-left')}>
              {cam ? <ItemThumb name={cam.name} tone={cam.tone} photo={cam.photo_url} size={96} rounded={16} /> : <Icon name="video" size={34} className="text-white/40" />}
              <p className="max-w-[34ch] text-[13.5px] text-white/65">
                {running ? 'Turn on the camera to stream to viewers who scan the QR. Comments work either way.' : 'This live has ended.'}
              </p>
              {running && <Button variant="stage" icon="camera" loading={starting} onClick={() => startCam()}>Turn on camera</Button>}
            </div>
          )}
          {stream && (
            <div className="absolute inset-x-3 bottom-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-hold px-3 text-[12.5px] font-bold"><span className="live-dot h-1.5 w-1.5 rounded-full bg-white" />On air</span>
              <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-black/45 px-3 text-[12.5px]"><Icon name="eye" size={15} />{board.viewers}</span>
              <span className="flex-1" />
              {devices.length > 1 && (
                <select aria-label="Camera" value={deviceId} onChange={(e) => { setDeviceId(e.target.value); startCam(e.target.value) }}
                  className="h-8 max-w-[160px] rounded-full border border-white/20 bg-black/45 px-3 text-[12.5px] text-white">
                  {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId} className="text-ink">{d.label || `Camera ${i + 1}`}</option>)}
                </select>
              )}
              <button onClick={() => setMic(!mic)} aria-label={mic ? 'Mute microphone' : 'Unmute microphone'} className="grid h-8 w-8 place-items-center rounded-full bg-black/45 hover:bg-black/60"><Icon name={mic ? 'mic' : 'micOff'} size={16} /></button>
              <button onClick={stopCam} aria-label="Turn off camera" className="grid h-8 w-8 place-items-center rounded-full bg-black/45 hover:bg-black/60"><Icon name="videoOff" size={16} /></button>
            </div>
          )}
          {showQr && viewerUrl && running && (
            <div className={cx('absolute right-3 flex items-center gap-2.5 rounded-xl bg-white p-2 pr-3 text-ink shadow-lg', stream ? 'top-3' : 'bottom-3')}>
              <QR value={viewerUrl} size={84} label="Viewer page QR" />
              <div className="max-w-[118px] text-[12px] leading-snug">
                <b className="block text-[13px]">Scan to join</b>Watch and comment from your phone
                <button onClick={() => setShowQr(false)} className="mt-1 block text-[11.5px] font-semibold text-muted underline">Hide</button>
              </div>
            </div>
          )}
          {!showQr && running && (
            <button onClick={() => setShowQr(true)} className="absolute right-3 top-3 z-10 inline-flex h-8 items-center gap-1.5 rounded-full bg-black/45 px-3 text-[12.5px] font-semibold hover:bg-black/60"><Icon name="qr" size={15} />Show QR</button>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4 p-5">
          <div className="flex items-center gap-2 text-[12.5px] font-semibold text-white/60"><Icon name="camera" size={15} />On camera</div>
          {cam ? (
            <>
              <div>
                <div className="flex items-baseline gap-3">
                  <Code className="text-[40px] leading-none text-white">{cam.code}</Code>
                  <span className="font-display text-[22px] font-semibold leading-tight">{cam.name}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-white/75">
                  <span className="font-display text-[20px] font-bold text-white">{peso(cam.price_centavos, true)}</span>
                  <span>{cam.sizes.join(' · ') || 'One size'}</span>
                  <span className={cx('rounded-full px-2 py-0.5 text-[12.5px] font-semibold', left > 0 ? 'bg-white/12 text-white' : 'bg-hold text-white')}>
                    {left > 0 ? `${left} of ${cam.stock} left` : 'All claimed'}
                  </span>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                {queue.length === 0 && cam.waitlist.length === 0 && (
                  <div className="rounded-xl border border-dashed border-white/20 px-4 py-5 text-center text-[13.5px] text-white/60">No claims yet. “mine po” or just “m” claims this item.</div>
                )}
                {queue.map((o, i) => <QueueRow key={o.id} o={o} n={i + 1} flash={flash.has(o.id)} onClick={() => onOrder(o.id)} />)}
                {cam.waitlist.length > 0 && <div className="mt-1 text-[12px] font-semibold text-white/55">Waitlist</div>}
                {cam.waitlist.map((o, i) => <QueueRow key={o.id} o={o} n={queue.length + i + 1} flash={flash.has(o.id)} onClick={() => onOrder(o.id)} />)}
              </div>
              <button onClick={onClear} className="self-start text-[12.5px] font-semibold text-white/55 underline-offset-2 hover:text-white hover:underline">Take off camera</button>
            </>
          ) : (
            <div className="flex flex-1 flex-col justify-center gap-2 text-white/70">
              <span className="font-display text-[20px] font-semibold text-white">Nothing on camera</span>
              <span className="text-[14px]">Tap an item below when you show it. Bare comments like “mine po” go to the item on camera.</span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function QueueRow({ o, n, flash, onClick }: { o: Order; n: number; flash: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cx('flex items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-white/10', flash ? 'bg-brand/40' : 'bg-white/[0.06]')}>
      <span className="w-5 text-center font-mono text-[13px] text-white/55 tabular">{n}</span>
      <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">{o.buyer}{o.size ? <span className="font-normal text-white/60"> · {o.size}</span> : ''}{o.qty > 1 ? <span className="font-normal text-white/60"> ×{o.qty}</span> : ''}</span>
      <span className="text-[12px] text-white/50 tabular">{clock(o.claimed_at)}</span>
      <StatusBadge status={o.status} className={o.status === 'WAITLISTED' ? 'border-white/20 bg-white/10 text-white/80' : ''} />
    </button>
  )
}

// ---- every item, tap to put on camera ---------------------------------------------------

function ItemGrid({ board, onCam, flash, onOrder }: { board: Board; onCam: (c: string) => void; flash: Set<string>; onOrder: (id: string) => void }) {
  const [q, setQ] = useState('')
  const items = useMemo(() => {
    const t = q.trim().toLowerCase()
    return board.items.filter((i) => !t || i.code.toLowerCase().includes(t) || i.name.toLowerCase().includes(t) || i.keywords.some((k) => k.includes(t)))
  }, [board.items, q])
  return (
    <section aria-label="Items">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-bold">Items</h2>
          <p className="text-[13px] text-muted">Tap an item when you show it on camera.</p>
        </div>
        <label className="relative">
          <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find B12, polo, asul" aria-label="Find item"
            className="h-9 w-[220px] rounded-[10px] border border-line-2 bg-surface pl-9 pr-3 text-[14px] outline-none focus:border-brand" />
        </label>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        {items.map((i) => <ItemCard key={i.id} i={i} on={board.on_camera?.id === i.id} onCam={() => onCam(i.code)} flash={flash} onOrder={onOrder} />)}
      </div>
    </section>
  )
}

function ItemCard({ i, on, onCam, flash, onOrder }: { i: BoardItem; on: boolean; onCam: () => void; flash: Set<string>; onOrder: (id: string) => void }) {
  const holders = [...i.confirmed, ...i.claimed]
  const sold = i.free_units === 0
  return (
    <div className={cx('flex flex-col rounded-[14px] border bg-surface transition', on ? 'border-brand ring-2 ring-brand/25' : 'border-line hover:border-line-2')}>
      <button onClick={onCam} className="flex items-center gap-3 p-3 text-left" aria-label={`Put ${i.code} on camera`}>
        <ItemThumb name={i.name} tone={i.tone} photo={i.photo_url} size={44} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5"><Code className="text-[15px]">{i.code}</Code><span className="truncate text-[13.5px] font-medium">{i.name}</span></span>
          <span className="block text-[12.5px] text-muted">{peso(i.price_centavos, true)} · {sold ? <span className="font-semibold text-hold">all claimed</span> : `${i.free_units} of ${i.stock} left`}</span>
        </span>
        {on && <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-white">ON</span>}
      </button>
      {(holders.length > 0 || i.waitlist.length > 0) && (
        <div className="flex flex-wrap gap-1 border-t border-line px-3 py-2">
          {holders.map((o) => (
            <button key={o.id} onClick={() => onOrder(o.id)} className={cx('rounded-md border px-1.5 py-0.5 text-[12px] font-medium', flash.has(o.id) ? 'animate-flash' : '',
              o.status === 'CLAIMED' ? 'border-brand-line bg-brand-soft text-brand-deep' : 'border-brand bg-brand text-white')}>{o.buyer}</button>
          ))}
          {i.waitlist.map((o) => (
            <button key={o.id} onClick={() => onOrder(o.id)} className="rounded-md border border-dashed border-line-2 px-1.5 py-0.5 text-[12px] text-muted">{o.buyer}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---- needs-review bucket ---------------------------------------------------------------

function describe(r: Comment['result']): string {
  if (!r) return 'Not sure'
  const verb = { claim: 'Claim', cancel: 'Cancel', waitlist: 'Waitlist', question: 'Question', other: 'Not an order' }[r.intent] ?? r.intent
  return [verb, r.item_code, r.size, r.qty > 1 ? `×${r.qty}` : ''].filter(Boolean).join(' · ')
}

function Review({ board, onDone }: { board: Board; onDone: () => void }) {
  const toast = useToast()
  const top = board.review[0]
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ intent: 'claim', item_code: '', size: '', qty: 1 })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!top) return
    const r = top.result
    setForm({ intent: r?.intent && r.intent !== 'other' ? r.intent : 'claim', item_code: r?.item_code || board.on_camera?.code || '', size: r?.size || '', qty: r?.qty || 1 })
    setEditing(!r?.item_code)
  }, [top?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const item = board.items.find((i) => i.code === form.item_code)
  const save = async () => {
    setBusy(true)
    try {
      const body = { ...form, size: form.size || (item?.sizes.length === 1 ? item.sizes[0] : null), item_code: form.item_code || null }
      const r = await seller.post<{ outcome: string | null }>(`/comments/${top.id}/fix`, body)
      toast(r.outcome ? `Saved: ${r.outcome}` : 'Saved. The AI will learn from this fix.')
      onDone()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const dismiss = async () => {
    await seller.post(`/comments/${top.id}/dismiss`).catch(() => {})
    onDone()
  }
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]" aria-label="Needs you">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-[16.5px] font-bold">Needs you</h2>
        <span className={cx('rounded-full px-2 text-[12.5px] font-bold tabular', board.review.length ? 'bg-pending-soft text-pending-deep' : 'text-muted')}>{board.review.length ? `${board.review.length} to check` : 'Clear'}</span>
      </div>
      {!top ? (
        <div className="flex items-center gap-3 px-4 py-4 text-[13.5px] text-muted"><span className="grid h-8 w-8 place-items-center rounded-full bg-brand-soft text-brand"><Icon name="check" size={16} /></span>All caught up. Unclear comments show up here instead of becoming wrong orders.</div>
      ) : (
        <div className="flex flex-col gap-3 p-4 animate-rise" key={top.id}>
          <div>
            <div className="text-[12.5px] text-muted"><b className="text-ink-2">{top.name}</b> · {clock(top.created_time)}</div>
            <div className="mt-0.5 text-[16px] font-medium leading-snug">“{top.message}”</div>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-sunken px-3 py-2 text-[13.5px]">
            <span className="text-muted">Looks like</span><b>{describe(top.result)}</b>
          </div>
          {editing && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[12px] font-semibold text-ink-2">Intent
                <Select value={form.intent} onChange={(e) => setForm({ ...form, intent: e.target.value })} className="mt-1 h-9">
                  <option value="claim">Claim</option><option value="waitlist">Waitlist</option><option value="cancel">Cancel</option><option value="other">Not an order</option>
                </Select>
              </label>
              <label className="text-[12px] font-semibold text-ink-2">Item
                <Select value={form.item_code} onChange={(e) => setForm({ ...form, item_code: e.target.value, size: '' })} className="mt-1 h-9">
                  <option value="">Pick…</option>
                  {board.items.map((i) => <option key={i.code} value={i.code}>{i.code} {i.name}</option>)}
                </Select>
              </label>
              <label className="text-[12px] font-semibold text-ink-2">Size
                <Select value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} className="mt-1 h-9" disabled={!item?.sizes.length}>
                  <option value="">Buyer picks</option>
                  {item?.sizes.map((z) => <option key={z} value={z}>{z}</option>)}
                </Select>
              </label>
              <label className="text-[12px] font-semibold text-ink-2">Qty
                <Select value={form.qty} onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })} className="mt-1 h-9">
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
              </label>
            </div>
          )}
          <div className="flex gap-2">
            <Button className="flex-1" icon="check" loading={busy} onClick={form.intent === 'other' ? dismiss : save}
              disabled={['claim', 'waitlist'].includes(form.intent) && !form.item_code}>{form.intent === 'other' ? 'Not an order' : 'Approve'}</Button>
            <Button variant="outline" onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit'}</Button>
            <Button variant="ghost" onClick={dismiss}>Ignore</Button>
          </div>
        </div>
      )}
    </section>
  )
}

// ---- comment feed + rehearsal input ------------------------------------------------------

function Feed({ feed, running, sid }: { feed: Comment[]; running: boolean; sid: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [stick, setStick] = useState(true)
  const [onlyOrders, setOnlyOrders] = useState(false)
  const shown = onlyOrders ? feed.filter((c) => c.stage && c.stage !== 'ignored') : feed
  useEffect(() => {
    if (stick && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [shown.length, stick])
  return (
    <section className="flex min-h-[360px] flex-1 flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]" aria-label="Comments">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-[16.5px] font-bold">Comments <span className="text-[13px] font-medium text-muted tabular">{feed.length}</span></h2>
        <label className="flex items-center gap-2 text-[12.5px] font-medium text-ink-2">
          <input type="checkbox" checked={onlyOrders} onChange={(e) => setOnlyOrders(e.target.checked)} className="accent-[#17806A]" />Orders only
        </label>
      </div>
      <div ref={box} onScroll={(e) => { const t = e.currentTarget; setStick(t.scrollHeight - t.scrollTop - t.clientHeight < 40) }}
        className="flex-1 overflow-y-auto px-2 py-2" aria-live="polite">
        {shown.length === 0 ? <Empty icon="chat" title="No comments yet" body={running ? 'New comments appear here the moment they’re posted.' : 'This live had no comments.'} /> :
          shown.map((c) => (
            <div key={c.id} className={cx('rounded-lg px-2.5 py-2 animate-rise', c.stage === 'review' && !c.resolved ? 'bg-pending-soft/60' : '')}>
              <div className="flex items-center gap-2 text-[12.5px]">
                <b className="truncate text-ink-2">{c.name}</b>
                <span className="text-faint tabular">{clock(c.created_time)}</span>
                {c.source === 'chat' && <span className="text-faint">· phone</span>}
                <span className="ml-auto"><StageTag stage={c.stage} /></span>
              </div>
              <div className="text-[14.5px] leading-snug">{c.message}</div>
              {c.outcome && <div className="mt-0.5 text-[12.5px] font-semibold text-brand-deep">→ {c.outcome}</div>}
            </div>
          ))}
      </div>
      {running && <TestComment sid={sid} />}
    </section>
  )
}

function TestComment({ sid }: { sid: string }) {
  const [name, setName] = useState('Ana Reyes')
  const [msg, setMsg] = useState('')
  const [open, setOpen] = useState(false)
  const toast = useToast()
  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!msg.trim()) return
    try {
      await seller.post(`/sessions/${sid}/comments`, { name, message: msg })
      setMsg('')
    } catch (x) { toast((x as Error).message, 'error') }
  }
  if (!open) return <button onClick={() => setOpen(true)} className="border-t border-line px-4 py-2.5 text-left text-[13px] font-semibold text-muted hover:bg-sunken">+ Type a test comment</button>
  return (
    <form onSubmit={send} className="flex gap-2 border-t border-line p-2.5">
      <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Commenter name" className="h-9 w-[110px] rounded-lg border border-line-2 px-2 text-[13px]" />
      <input value={msg} onChange={(e) => setMsg(e.target.value)} autoFocus aria-label="Test comment" placeholder="mine B7 M" className="h-9 min-w-0 flex-1 rounded-lg border border-line-2 px-2.5 text-[13.5px]" />
      <Button size="sm" icon="send" className="h-9" aria-label="Send test comment" />
    </form>
  )
}


