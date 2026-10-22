import { useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { ItemThumb } from '../components/ItemThumb'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { Button, Card, Code, cx, Empty, Field, Input, PageHeader, Spinner, Stepper } from '../components/ui'
import { seller } from '../lib/api'
import { peso, toCentavos } from '../lib/format'
import { useLoad } from '../lib/hooks'
import type { Item } from '../lib/types'

const COMMON_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'Free size']

export default function Catalog() {
  const { data, loading, reload } = useLoad(() => seller.get<Item[]>('/catalog'))
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Partial<Item> | null>(null)
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (data ?? []).filter((i) => !t || i.code.toLowerCase().includes(t) || i.name.toLowerCase().includes(t) || i.keywords.some((k) => k.includes(t)))
  }, [data, q])
  const nextCode = () => {
    const nums = (data ?? []).map((i) => i.code.match(/^B(\d+)$/)?.[1]).filter(Boolean).map(Number)
    return `B${(nums.length ? Math.max(...nums) : 0) + 1}`
  }
  return (
    <div className="mx-auto max-w-[1180px] px-5 py-8 lg:px-10">
      <PageHeader title="Catalog" sub={`${data?.length ?? 0} items. Keywords help match comments like “yung asul na polo”.`}>
        <label className="relative">
          <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, name, keyword" aria-label="Search catalog"
            className="h-10 w-[250px] rounded-[10px] border border-line-2 bg-surface pl-9 pr-3 text-[14px] outline-none focus:border-brand" />
        </label>
        <Button icon="plus" onClick={() => setEditing({ code: nextCode(), sizes: [], keywords: [], stock: 1 })}>Add item</Button>
      </PageHeader>
      <Card className="overflow-x-auto">
        {loading && !data ? <div className="p-10 text-center"><Spinner /></div> : (
          <table className="w-full min-w-[820px] text-[14px]">
            <thead><tr className="border-b border-line bg-sunken/50 text-left text-[12.5px] text-muted">
              <th className="w-16 py-2.5 pl-5" /><th className="py-2.5 font-semibold">Code</th><th className="py-2.5 font-semibold">Name</th>
              <th className="py-2.5 text-right font-semibold">Price</th><th className="py-2.5 pl-6 font-semibold">Sizes</th>
              <th className="py-2.5 text-right font-semibold">Stock</th><th className="py-2.5 pl-6 font-semibold">Keywords</th><th className="w-28" /></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((i) => (
                <tr key={i.id} className="hover:bg-sunken/40">
                  <td className="py-2 pl-5"><ItemThumb name={i.name} tone={i.tone} photo={i.photo_url} size={40} rounded={8} /></td>
                  <td><Code className="text-[15px]">{i.code}</Code></td>
                  <td className="font-medium">{i.name}</td>
                  <td className="text-right font-semibold tabular">{peso(i.price_centavos)}</td>
                  <td className="pl-6 text-ink-2">{i.sizes.join(', ') || '—'}</td>
                  <td className={cx('text-right tabular', i.stock === 0 && 'font-semibold text-hold')}>{i.stock === 0 ? 'Out' : i.stock}</td>
                  <td className="pl-6"><div className="flex max-w-[260px] flex-wrap gap-1">{i.keywords.map((k) => <span key={k} className="rounded bg-sunken px-1.5 py-0.5 text-[12px] text-ink-2">{k}</span>)}</div></td>
                  <td className="pr-4 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(i)} aria-label={`Edit ${i.code}`}>Edit</Button>
                      <button title="Duplicate" aria-label={`Duplicate ${i.code}`} onClick={() => setEditing({ ...i, id: undefined, code: nextCode(), photo_url: i.photo_url })}
                        className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-sunken"><Icon name="dup" size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && !rows.length && <Empty icon="search" title={`No items match “${q}”`} body="Try a code like B7 or a keyword like asul." />}
      </Card>
      {editing && <ItemModal item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </div>
  )
}

async function resizePhoto(file: File): Promise<string> {
  const img = await createImageBitmap(file)
  const side = 480
  const scale = Math.min(1, side / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * scale)
  c.height = Math.round(img.height * scale)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.82)
}

function Chips({ values, onChange, placeholder, label }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; label: string }) {
  const [text, setText] = useState('')
  const add = () => {
    const v = text.trim()
    if (v && !values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v])
    setText('')
  }
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-[10px] border border-line-2 bg-surface px-2 py-1.5 focus-within:border-brand">
      {values.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-md bg-sunken py-0.5 pl-2 pr-1 text-[13px]">{v}
          <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`} className="grid h-5 w-5 place-items-center rounded text-muted hover:bg-line"><Icon name="x" size={12} /></button>
        </span>
      ))}
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={label}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() } else if (e.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1)) }}
        onBlur={add} className="h-7 min-w-[140px] flex-1 bg-transparent px-1 text-[14px] outline-none" />
    </div>
  )
}

function ItemModal({ item, onClose, onSaved }: { item: Partial<Item>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const isEdit = !!item.id
  const [code, setCode] = useState(item.code ?? '')
  const [name, setName] = useState(item.name ?? '')
  const [price, setPrice] = useState(item.price_centavos ? (item.price_centavos / 100).toFixed(2) : '')
  const [stock, setStock] = useState(item.stock ?? 1)
  const [sizes, setSizes] = useState<string[]>(item.sizes ?? [])
  const [kw, setKw] = useState<string[]>(item.keywords ?? [])
  const [photo, setPhoto] = useState<string | null>(item.photo_url ?? null)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const cents = toCentavos(price)
  const nameErr = tried && !name.trim() ? 'Give the item a name.' : null
  const priceErr = tried && (!cents || cents <= 0) ? 'Set a price above ₱0.00.' : null

  const pick = async (f?: File) => {
    if (!f) return
    if (!f.type.startsWith('image/')) return toast('Pick an image file (JPG or PNG).', 'error')
    try { setPhoto(await resizePhoto(f)) } catch { toast('Couldn’t read that image.', 'error') }
  }
  const save = async () => {
    setTried(true)
    if (!name.trim() || !cents) return
    setBusy(true)
    const body = { code, name: name.trim(), price_centavos: cents, stock, sizes, keywords: kw, photo_url: photo, tone: item.tone ?? null }
    try {
      if (isEdit) await seller.put(`/catalog/${item.code}`, body)
      else await seller.post('/catalog', body)
      toast(isEdit ? `Saved ${code}` : `Added ${code.toUpperCase()}`)
      onSaved()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const del = async () => {
    setBusy(true)
    try { await seller.del(`/catalog/${item.code}`); toast(`Deleted ${item.code}`); onSaved() }
    catch (e) { toast((e as Error).message, 'error'); setConfirmDelete(false) } finally { setBusy(false) }
  }

  if (confirmDelete) {
    return (
      <Modal open onClose={() => setConfirmDelete(false)} title={`Delete ${item.code} ${item.name}?`}
        footer={<><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Keep item</Button><Button variant="danger" loading={busy} onClick={del}>Delete item</Button></>}>
        <p className="text-[14px] text-ink-2">It disappears from the board and comments can’t claim it anymore. Past orders keep their record.</p>
      </Modal>
    )
  }
  return (
    <Modal open onClose={onClose} kicker={isEdit ? 'Edit item' : 'New item'} title={isEdit ? `${item.code} ${item.name}` : 'Add an item'} wide
      footer={<>
        {isEdit && <Button variant="ghost" icon="trash" className="mr-auto text-hold" onClick={() => setConfirmDelete(true)}>Delete</Button>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button loading={busy} onClick={save}>{isEdit ? 'Save changes' : 'Add item'}</Button>
      </>}>
      <div className="grid gap-5 sm:grid-cols-[160px_1fr]">
        <button type="button" onClick={() => file.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]) }}
          className="group relative flex aspect-square flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed border-line-2 text-[12.5px] text-muted hover:border-brand">
          {photo ? <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <><Icon name="camera" size={24} />Drag a photo here<br />or tap to choose</>}
          {photo && <span className="absolute bottom-2 rounded-full bg-black/55 px-2.5 py-1 text-[12px] font-semibold text-white opacity-0 group-hover:opacity-100">Change photo</span>}
        </button>
        <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} aria-label="Item photo" />
        <div className="grid content-start gap-4">
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <Field label="Code"><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} disabled={isEdit} maxLength={6} className="font-mono" /></Field>
            <Field label="Name" error={nameErr}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Blue polo" maxLength={80} /></Field>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field label="Price" error={priceErr}>
              <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">₱</span>
                <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0.00" className="pl-7 tabular" /></div>
            </Field>
            <Field label="Stock"><Stepper value={stock} onChange={setStock} label="stock" /></Field>
          </div>
        </div>
      </div>
      <div className="mt-5 grid gap-4">
        <Field label="Sizes" hint="Buyers pick one of these on their order page.">
          <div className="flex flex-wrap gap-1.5">
            {COMMON_SIZES.map((s) => (
              <button key={s} type="button" aria-pressed={sizes.includes(s)} onClick={() => setSizes(sizes.includes(s) ? sizes.filter((x) => x !== s) : [...sizes, s])}
                className={cx('h-8 rounded-lg border px-3 text-[13px] font-semibold', sizes.includes(s) ? 'border-brand bg-brand text-white' : 'border-line-2 text-ink-2 hover:bg-sunken')}>{s}</button>
            ))}
          </div>
          <Chips values={sizes.filter((s) => !COMMON_SIZES.includes(s))} onChange={(v) => setSizes([...sizes.filter((s) => COMMON_SIZES.includes(s)), ...v])} placeholder="Other size (28, 30…), press Enter" label="Add a size" />
        </Field>
        <Field label="Keywords" hint="Words buyers use, in English or Tagalog: asul, maong, bestida.">
          <Chips values={kw} onChange={setKw} placeholder="Type a keyword, press Enter" label="Add keyword" />
        </Field>
      </div>
    </Modal>
  )
}
