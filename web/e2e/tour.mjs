// Screenshot tour of every screen (design review + docs). Needs the app on BASE.
//   node e2e/tour.mjs            -> web/test-results/tour/*.png
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE || 'http://localhost:8000'
const KEY = process.env.SELLER_KEY || 'demo-seller-key'
const OUT = 'test-results/tour'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, permissions: ['camera', 'microphone'] })
const page = await desk.newPage()
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()))
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
const shot = async (p, name) => { await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }); console.log('shot', name) }

await page.goto(BASE + '/seller')
await shot(page, '01-key-gate')
await page.getByLabel('Seller key').fill(KEY)
await page.getByRole('button', { name: 'Open desk' }).click()
await page.waitForURL(/sessions|live/)
await page.goto(BASE + '/seller/sessions')
await shot(page, '02-sessions')

if (process.env.REPLAY !== '0') {
  await page.getByRole('radio', { name: /Replay a live/ }).click()
  await page.getByLabel('Speed').selectOption('4')
  await page.getByRole('button', { name: 'Start live' }).click()
  await page.waitForURL(/\/seller\/live\//)
  await page.waitForTimeout(Number(process.env.WAIT || 16000))
  await shot(page, '03-live-board')
  await page.getByRole('button', { name: 'Turn on camera' }).click()
  await page.getByText('On air').waitFor()
  const sidNow = page.url().split('/live/')[1]
  const viewerCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true })
  const vp = await viewerCtx.newPage()
  await vp.goto(`${BASE}/live/${sidNow}`)
  await vp.waitForFunction(() => (document.querySelector('video')?.videoWidth ?? 0) > 0, null, { timeout: 20000 }).catch(() => console.log('viewer video did not start'))
  await shot(vp, '10b-viewer-with-video')
  await shot(page, '03c-live-board-camera-on')
  await page.screenshot({ path: `${OUT}/03b-live-board-full.png`, fullPage: true })
}
// put a few orders through payment so Payments/Packing/Insights have every state
{
  const H = { 'X-Seller-Key': KEY }
  const sessions = await (await page.request.get(`${BASE}/api/sessions`, { headers: H })).json()
  const sid = sessions[0].id
  const all = await (await page.request.get(`${BASE}/api/orders?session_id=${sid}`, { headers: H })).json()
  const claimed = all.filter((o) => o.status === 'CLAIMED')
  const confirm = async (o) => (await page.request.post(`${BASE}/api/buyer/${o.buyer_token}/confirm`, { data: { size: o.size || null } })).json()
  const [a, b, c, d, e] = claimed
  for (const o of [a, b, c, d, e].filter(Boolean)) {
    const r = await confirm(o)
    if (!r.status && o.buyer_token) {
      const info = await (await page.request.get(`${BASE}/api/buyer/${o.buyer_token}`)).json()
      await page.request.post(`${BASE}/api/buyer/${o.buyer_token}/confirm`, { data: { size: info.item.sizes[0] ?? null } })
    }
  }
  const seller = await (await page.request.get(`${BASE}/api/seller`, { headers: H })).json()
  const pay = async (o, amount) => {
    const r = await (await page.request.post(`${BASE}/api/wallet/${seller.id}/send`, { data: { amount_centavos: amount ?? o.total_centavos, sender_name: o.buyer } })).json()
    await page.request.post(`${BASE}/api/buyer/${o.buyer_token}/proof`, { data: { reference: r.reference, attested: true } })
  }
  if (a) await pay(a)
  if (b) await pay(b, Math.round(b.total_centavos / 2))           // underpaid
  if (c) await page.request.post(`${BASE}/api/buyer/${c.buyer_token}/proof`, { data: { reference: '4455 667 788990', attested: true } })  // fake
  if (d) { const q = await (await page.request.post(`${BASE}/api/buyer/${d.buyer_token}/qr`)).json(); await page.request.post(`${BASE}/api/gateway/intents/${q.intent_id}/pay`, { data: {} }) }
  const csv = await (await page.request.get(`${BASE}/api/payments/wallet-statement.csv`, { headers: H })).text()
  await page.request.post(`${BASE}/api/payments/statement`, { headers: H, multipart: { file: { name: 'gcash.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) } } })
  if (e) {
    const phone0 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true })
    const p0 = await phone0.newPage()
    await p0.goto(`${BASE}/o/${e.buyer_token}`)
    await shot(p0, '12-buyer-confirmed-qr')
    const q = await (await page.request.post(`${BASE}/api/buyer/${e.buyer_token}/qr`)).json()
    await p0.goto(`${BASE}/pay/${q.intent_id}`)
    await shot(p0, '13-mock-qrph-gateway')
    await p0.goto(`${BASE}/w/${seller.id}?amount=35000&note=B7%20Blue%20polo`)
    await shot(p0, '14-demowallet')
    await p0.goto(`${BASE}/o/${a.buyer_token}`)
    await shot(p0, '15-buyer-checking')
    await p0.goto(`${BASE}/o/${d.buyer_token}`)
    await shot(p0, '16-buyer-paid')
  }
}
for (const [path, name] of [['payments', '04-payments'], ['packing', '05-packing'], ['insights', '06-insights'], ['catalog', '07-catalog'], ['buyers', '08-buyers'], ['settings', '09-settings']]) {
  await page.goto(`${BASE}/seller/${path}`)
  await page.waitForLoadState('networkidle').catch(() => {})
  await shot(page, name)
}
// buyer + viewer on a phone
const sessions = await (await page.request.get(`${BASE}/api/sessions`, { headers: { 'X-Seller-Key': KEY } })).json()
const live = sessions.find((s) => s.status === 'running') || sessions[0]
const orders = await (await page.request.get(`${BASE}/api/orders?session_id=${live.id}`, { headers: { 'X-Seller-Key': KEY } })).json()
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const m = await phone.newPage()
m.on('pageerror', (e) => console.log('[pageerror mobile]', e.message))
await m.goto(`${BASE}/live/${live.id}`)
await shot(m, '10-viewer')
for (const st of ['CLAIMED', 'WAITLISTED']) {
  const o = orders.find((x) => x.status === st)
  if (o) { await m.goto(`${BASE}/o/${o.buyer_token}`); await shot(m, `11-buyer-${st.toLowerCase()}`) }
}
await browser.close()
