import { cx } from './ui'

// Item photo, or a tinted garment drawing when the seller hasn't added a photo yet.
const SHAPES: [RegExp, string][] = [
  [/dress|bestida/i, 'M19 7h10l-1 6 7 22H13l7-22zM19 7l5 4 5-4'],
  [/skirt|palda/i, 'M16 12h16l6 26H10zM16 12v-2h16v2'],
  [/jeans|slacks|pants|maong(?! jacket)/i, 'M15 7h18l2 34h-8l-3-22-3 22h-8z'],
  [/shorts/i, 'M14 11h20l3 22h-10l-3-12-3 12H11z'],
  [/belt|sinturon/i, 'M6 21h36v7H6zM22 19h9v11h-9zM25 23h3v3h-3z'],
  [/jacket|coat|windbreaker|cardigan|vest|hoodie/i, 'M17 7l7 5 7-5 9 5-4 10-4-2v21H16V20l-4 2-4-10zM24 12v29'],
  [/./, 'M17 8l7 4 7-4 9 6-4 8-4-2v20H16V20l-4 2-4-8z'],
]

export function ItemThumb({ name, tone, photo, size = 48, className = '', rounded = 10 }: {
  name: string; tone?: string | null; photo?: string | null; size?: number; className?: string; rounded?: number
}) {
  const style = { width: size, height: size, borderRadius: rounded }
  if (photo) {
    return <img src={photo} alt={name} style={style} className={cx('shrink-0 object-cover bg-sunken', className)} loading="lazy" />
  }
  const color = tone || '#C9CDC6'
  const d = SHAPES.find(([rx]) => rx.test(name))![1]
  return (
    <span style={{ ...style, background: `color-mix(in oklab, ${color} 22%, #F6F7F4)` }}
      className={cx('grid shrink-0 place-items-center overflow-hidden', className)} role="img" aria-label={name}>
      <svg viewBox="0 0 48 48" width={size * 0.78} height={size * 0.78} aria-hidden="true">
        <path d={d} fill={color} stroke="rgb(31 41 38 / .28)" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </span>
  )
}
