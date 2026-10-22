import QRCode from 'qrcode'
import { useEffect, useState } from 'react'

/** QR code rendered to an <img> (SVG data URL), crisp at any size and printable. */
export function QR({ value, size = 180, label, dark = '#1F2926', light = '#FFFFFF' }: {
  value: string; size?: number; label: string; dark?: string; light?: string
}) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark, light } })
      .then((svg) => alive && setSrc('data:image/svg+xml;utf8,' + encodeURIComponent(svg)))
      .catch(() => alive && setSrc(null))
    return () => { alive = false }
  }, [value, dark, light])
  return src
    ? <img src={src} width={size} height={size} alt={label} className="block rounded-md" style={{ imageRendering: 'pixelated' }} data-qr-value={value} />
    : <span style={{ width: size, height: size }} className="block rounded-md bg-sunken" />
}
