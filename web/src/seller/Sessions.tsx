import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, type IconName } from '../components/Icon'
import { useToast } from '../components/Toast'
import { Button, Card, cx, Empty, Field, Input, PageHeader, Select, Spinner } from '../components/ui'
import { downloadWithKey, seller } from '../lib/api'
import { dateTime } from '../lib/format'
import { useLoad } from '../lib/hooks'
import type { Session } from '../lib/types'
import { useSeller } from './SellerLayout'

type Source = 'chat' | 'meta' | 'replay'
const SOURCES: { id: Source; title: string; body: string; icon: IconName }[] = [
  { id: 'chat', title: 'Live here', body: 'Use this laptop’s camera. Viewers scan a QR, watch on their phone and comment.', icon: 'video' },
  { id: 'meta', title: 'Facebook Live', body: 'Read comments from your Page’s live video through Meta’s official API.', icon: 'live' },
  { id: 'replay', title: 'Replay a live', body: 'Play back a saved live at 1× to 4×. Handy when the Wi-Fi is bad.', icon: 'refresh' },
]

export default function Sessions() {
  const { refresh, me } = useSeller()
  const toast = useToast()
  const nav = useNavigate()
  const sessions = useLoad(() => seller.get<Session[]>('/sessions'))
  const recs = useLoad(() => seller.get<{ name: string; comments: number; seconds: number }[]>('/recordings'))
  const [source, setSource] = useState<Source>('chat')
  const [title, setTitle] = useState(() => `${new Date().toLocaleDateString('en-PH', { weekday: 'long' })} night live`)
  const [videoId, setVideoId] = useState('')
  const [fbUrl, setFbUrl] = useState('')
  const [rec, setRec] = useState('')
  const [speed, setSpeed] = useState('2')
  const [busy, setBusy] = useState(false)

  const start = async () => {
    setBusy(true)
    try {
      const s = await seller.post<Session>('/sessions', {
        title, source,
        live_video_id: source === 'meta' ? videoId.trim() : source === 'replay' ? (rec || recs.data?.[0]?.name) : null,
        fb_video_url: fbUrl.trim() || null, replay_speed: Number(speed), start: true,
      })
      refresh()
      nav(`/seller/live/${s.id}`)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const running = sessions.data?.find((s) => s.status === 'running')
  return (
    <div className="mx-auto max-w-[1080px] px-5 py-8 lg:px-10">
      <PageHeader title="Go live" sub={`Comments from any of these turn into orders on your board. ${me.shop_name}.`} />
      {running && (
        <Card className="mb-6 flex flex-wrap items-center gap-4 border-brand-line bg-brand-soft p-4">
          <span className="live-dot h-2.5 w-2.5 rounded-full bg-hold" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{running.title} is live</div>
            <div className="text-[13.5px] text-ink-2">Starting a new live ends this one.</div>
          </div>
          <Button icon="live" onClick={() => nav(`/seller/live/${running.id}`)}>Open board</Button>
        </Card>
      )}
      <Card className="p-6">
        <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Where comments come from">
          {SOURCES.map((s) => (
            <button key={s.id} role="radio" aria-checked={source === s.id} onClick={() => setSource(s.id)}
              className={cx('flex flex-col gap-2 rounded-xl border p-4 text-left transition',
                source === s.id ? 'border-brand bg-brand-soft ring-2 ring-brand/20' : 'border-line-2 hover:bg-sunken')}>
              <span className={cx('grid h-9 w-9 place-items-center rounded-lg', source === s.id ? 'bg-brand text-white' : 'bg-sunken text-ink-2')}><Icon name={s.icon} /></span>
              <span className="font-display text-[16.5px] font-bold">{s.title}</span>
              <span className="text-[13.5px] leading-snug text-ink-2">{s.body}</span>
            </button>
          ))}
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Field label="Name of this live"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} /></Field>
          {source === 'meta' && (
            <Field label="Live video ID" hint={me.meta_configured ? 'From your Page’s live video (numbers only).' : 'The server has no META_PAGE_TOKEN yet; the board will show the error.'}>
              <Input value={videoId} onChange={(e) => setVideoId(e.target.value)} placeholder="e.g. 1234567890123456" inputMode="numeric" />
            </Field>
          )}
          {source === 'replay' && (
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <Field label="Recording">
                {recs.loading ? <Spinner /> : (
                  <Select value={rec || recs.data?.[0]?.name || ''} onChange={(e) => setRec(e.target.value)}>
                    {recs.data?.map((r) => <option key={r.name} value={r.name}>{r.name.replace(/_/g, ' ')} · {r.comments} comments</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Speed">
                <Select value={speed} onChange={(e) => setSpeed(e.target.value)}>
                  {['1', '2', '3', '4'].map((x) => <option key={x} value={x}>{x}×</option>)}
                </Select>
              </Field>
            </div>
          )}
          {source !== 'replay' && (
            <Field label="Facebook video link (optional)" hint="Viewers on the QR page can watch the Facebook video when your camera isn’t on here.">
              <Input value={fbUrl} onChange={(e) => setFbUrl(e.target.value)} placeholder="https://www.facebook.com/…/videos/…" />
            </Field>
          )}
        </div>
        <div className="mt-6 flex items-center justify-end gap-3">
          <Button size="lg" icon="play" loading={busy} onClick={start} disabled={source === 'meta' && !videoId.trim()}>Start live</Button>
        </div>
      </Card>

      <h2 className="mb-3 mt-10 text-[19px] font-bold">Past lives</h2>
      <Card>
        {sessions.loading ? <div className="p-8 text-center"><Spinner /></div> :
          !sessions.data?.length ? <Empty icon="video" title="No lives yet" body="Your first live will show up here with its comments and orders." /> : (
            <ul className="divide-y divide-line">
              {sessions.data.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                  <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', s.status === 'running' ? 'live-dot bg-hold' : 'bg-line-2')} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{s.title}</div>
                    <div className="text-[13px] text-muted">
                      {{ chat: 'Live here', meta: 'Facebook Live', replay: 'Replay' }[s.source]} · {dateTime(s.started_at || s.created_at)} · {s.comments ?? 0} comments
                      {s.status === 'running' ? ' · live now' : ''}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" icon="download" onClick={() => downloadWithKey(`/sessions/${s.id}/export`, `${s.title}.jsonl`).catch((e) => toast(e.message, 'error'))}>Export</Button>
                  <Button variant="outline" size="sm" onClick={() => nav(`/seller/live/${s.id}`)}>{s.status === 'running' ? 'Open board' : 'View'}</Button>
                </li>
              ))}
            </ul>
          )}
      </Card>
    </div>
  )
}
