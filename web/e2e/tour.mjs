// Screenshot tour of every screen (design review + docs). Needs the app on BASE.
//   node e2e/tour.mjs            -> web/test-results/tour/*.png
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE || 'http://localhost:8000'
const KEY = process.env.SELLER_KEY || 'demo-seller-key'
const OUT = 'test-results/tour'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
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
  await page.screenshot({ path: `${OUT}/03b-live-board-full.png`, fullPage: true })
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
