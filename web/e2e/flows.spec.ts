import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'

// Full-system tests through the real UI: seller desk, buyer phones, viewer phones,
// mock QR Ph gateway and mock e-wallet, all against one running backend.
const KEY = 'e2e-key'
const H = { 'X-Seller-Key': KEY }
test.describe.configure({ mode: 'serial' })

let sid = ''

async function sellerPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera', 'microphone'] })
  await ctx.addInitScript((k) => localStorage.setItem('mineit.sellerKey', k), KEY)
  return ctx.newPage()
}

async function phone(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  return ctx.newPage()
}

async function orders(request: APIRequestContext, code?: string) {
  const r = await request.get(`/api/orders?session_id=${sid}`, { headers: H })
  const all = await r.json()
  return code ? all.filter((o: { item_code: string }) => o.item_code === code) : all
}

async function testComment(page: Page, name: string, msg: string) {
  const r = await page.request.post(`/api/sessions/${sid}/comments`, { headers: H, data: { name, message: msg } })
  expect(r.ok()).toBeTruthy()
  return (await r.json()).parsed
}

test('branding: tab title, logo files and the logo in the seller header', async ({ page, request }) => {
  await page.goto('/seller')
  await expect(page).toHaveTitle('mineIt!')
  await expect(page.getByRole('img', { name: 'mineIt!' })).toBeVisible()          // full logo on the key screen
  for (const f of ['/logo.png', '/logo-mark.png', '/favicon-32.png', '/apple-touch-icon.png']) {
    const r = await request.get(f)                  // must be the image, not the SPA's index.html
    expect(r.ok(), f).toBeTruthy()
    expect(r.headers()['content-type'], f).toContain('image/png')
  }
  expect((await request.get('/manifest.webmanifest')).ok()).toBeTruthy()
})

test('seller unlocks the desk with the seller key', async ({ page }) => {
  await page.goto('/seller')
  await expect(page.getByRole('heading', { name: 'Open your seller desk' })).toBeVisible()
  await page.getByLabel('Seller key').fill('wrong')
  await page.getByRole('button', { name: 'Open desk' }).click()
  await expect(page.getByText('doesn’t match')).toBeVisible()
  await page.getByLabel('Seller key').fill(KEY)
  await page.getByRole('button', { name: 'Open desk' }).click()
  await expect(page.getByRole('heading', { name: 'Go live' })).toBeVisible()
})

test('seller goes live here and comments become orders on the board', async ({ browser }) => {
  const page = await sellerPage(browser)
  await page.goto('/seller/sessions')
  await page.getByRole('radio', { name: /Live here/ }).click()
  await page.getByRole('button', { name: 'Start live' }).click()
  await page.waitForURL(/\/seller\/live\//)
  sid = page.url().split('/live/')[1]
  await expect(page.getByRole('button', { name: 'End live' })).toBeVisible()

  // put B12 on camera, then a typed test comment claims it
  await page.getByRole('button', { name: 'Put B12 on camera' }).click()
  await expect(page.getByRole('region', { name: 'On camera' }).getByText('Denim jacket')).toBeVisible()
  await page.getByText('+ Type a test comment').click()
  await page.getByLabel('Commenter name').fill('Ana Reyes')
  await page.getByRole('textbox', { name: 'Test comment' }).fill('mine B12')
  await page.getByRole('button', { name: 'Send test comment' }).click()
  await expect(page.getByText('→ claimed B12')).toBeVisible()
  const stage = page.getByRole('region', { name: 'On camera' })
  await expect(stage.getByText('Ana R.')).toBeVisible()

  // second buyer goes to the waitlist; a bare "mine po" goes to the item on camera
  await testComment(page, 'Mark Dela Cruz', 'mine po')
  await expect(stage.getByText('Mark D.')).toBeVisible()
  await expect(stage.getByText('Waitlist', { exact: true }).first()).toBeVisible()
  // fuzzy description + chat
  expect((await testComment(page, 'Liza Santos', 'pa mine po yung blue na polo, M sana')).outcome).toBe('claimed B7')
  expect((await testComment(page, 'Joy Cruz', 'ganda ate!')).stage).toBe('ignored')
  await expect(page.getByText('ganda ate!')).toBeVisible()
})

test('unclear comment lands in Needs you and the seller fixes it in one tap', async ({ browser }) => {
  const page = await sellerPage(browser)
  await page.goto(`/seller/live/${sid}`)
  await testComment(page, 'Ben Tan', 'mine yung ano po basta')
  const review = page.getByRole('region', { name: 'Needs you' })
  await expect(review.getByText('“mine yung ano po basta”')).toBeVisible()
  await review.getByLabel('Item').selectOption('B4')
  await review.getByLabel('Size').selectOption('L')
  await review.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText(/Saved: claimed B4/)).toBeVisible()
  await expect(review.getByText('All caught up')).toBeVisible()
})

test('cancel in comments passes the item to the next buyer', async ({ browser }) => {
  const page = await sellerPage(browser)
  await page.goto(`/seller/live/${sid}`)
  await testComment(page, 'Ana Reyes', 'cancel B12 po')
  const stage = page.getByRole('region', { name: 'On camera' })
  await expect(stage.getByText('Ana R.')).toHaveCount(0)
  const [mark] = (await orders(page.request, 'B12')).filter((o: { buyer: string }) => o.buyer === 'Mark Dela Cruz')
  expect(mark.status).toBe('CLAIMED')
})

test('Instant QR: buyer confirms, scans the QR Ph code, pays, order verifies by itself', async ({ browser, request }) => {
  const [mark] = (await orders(request, 'B12')).filter((o: { buyer: string }) => o.buyer === 'Mark Dela Cruz')
  const buyer = await phone(browser)
  await buyer.goto(`/o/${mark.buyer_token}`)
  await expect(buyer.getByText('Claimed for you')).toBeVisible()
  await buyer.getByRole('button', { name: 'Confirm order' }).click()
  await expect(buyer.getByText('Pick your size first.')).toBeVisible()
  await buyer.getByRole('radio', { name: 'L' }).click()
  await buyer.getByRole('button', { name: 'Confirm order' }).click()
  await expect(buyer.getByText('Confirmed', { exact: true })).toBeVisible()
  const qr = buyer.getByAltText('QR Ph payment code')
  await expect(qr).toBeVisible()
  const payUrl = await qr.getAttribute('data-qr-value')
  expect(payUrl).toContain('/pay/pi_')

  // the "bank app": open the QR's link on a second phone, confirm payment
  const bank = await phone(browser)
  await bank.goto(new URL(payUrl!).pathname)
  await expect(bank.getByText('₱850.00').first()).toBeVisible()
  await bank.getByRole('button', { name: /Confirm payment/ }).click()
  await expect(bank.getByText('Payment successful')).toBeVisible()
  await expect(bank.getByText(/QRPH\d{10}/)).toBeVisible()

  // the buyer page flips by itself (SSE), no refresh
  await expect(buyer.getByText('Payment confirmed')).toBeVisible()
})

test('Manual: buyer pays the e-wallet, sends the reference, statement upload releases it', async ({ browser }) => {
  const page = await sellerPage(browser)
  const [liza] = await orders(page.request, 'B7')
  const buyer = await phone(browser)
  await buyer.goto(`/o/${liza.buyer_token}`)
  await expect(buyer.getByRole('radio', { name: 'M' })).toHaveAttribute('aria-checked', 'true') // size read from the comment
  await buyer.getByRole('button', { name: 'Confirm order' }).click()
  await buyer.getByRole('tab', { name: /I paid via GCash/ }).click()
  await buyer.getByText('Demo: open DemoWallet to send this payment').click()
  await expect(buyer.getByText('Send money to')).toBeVisible()
  await buyer.getByPlaceholder('Name on your account').fill('Liza Santos')
  await buyer.getByRole('button', { name: /Send ₱350.00/ }).click()
  await expect(buyer.getByText('Sent successfully')).toBeVisible()
  const ref = (await buyer.locator('text=/^\\d{4} \\d{3} \\d{6}$/').first().textContent())!.replace(/\s/g, '')
  await buyer.getByRole('link', { name: 'Back to my order' }).click()
  await buyer.getByRole('tab', { name: /I paid via GCash/ }).click()
  await buyer.getByPlaceholder('e.g. 1009 876 543 210').fill(ref)
  await expect(buyer.getByRole('button', { name: 'Send reference' })).toBeDisabled()
  await buyer.getByRole('button', { name: 'I checked this payment in my app' }).click()
  await buyer.getByRole('button', { name: 'Send reference' }).click()
  await expect(buyer.getByText(/is checking your payment/)).toBeVisible()

  // Joy (B4 order from the review fix belongs to Ben) - Ben submits a fake reference
  const [ben] = await orders(page.request, 'B4')
  const fake = await phone(browser)
  await fake.goto(`/o/${ben.buyer_token}`)
  await fake.getByRole('button', { name: 'Confirm order' }).click()
  await fake.getByRole('tab', { name: /I paid via GCash/ }).click()
  await fake.getByPlaceholder('e.g. 1009 876 543 210').fill('5555 444 333222')
  await fake.getByRole('button', { name: 'I checked this payment in my app' }).click()
  await fake.getByRole('button', { name: 'Send reference' }).click()
  await expect(fake.getByText(/is checking your payment/)).toBeVisible()

  // seller: both pending until a statement covers them
  await page.goto('/seller/payments')
  await expect(page.getByText('Liza Santos')).toBeVisible()
  await expect(page.getByText('Pending', { exact: true })).toHaveCount(2)
  const csv = await (await page.request.get('/api/payments/wallet-statement.csv', { headers: H })).text()
  await page.getByLabel('Statement file').setInputFiles({ name: 'gcash.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByText(/Checked 2: 1 release, 1 hold/)).toBeVisible()
  const benRow = page.getByRole('listitem').filter({ hasText: 'Ben Tan' })
  await expect(benRow.getByText('Reference not in your statement')).toBeVisible()
  await page.getByRole('button', { name: 'Release all green (1)' }).click()
  await expect(page.getByText('Released 1 order')).toBeVisible()
  await expect(buyer.getByText('Payment confirmed')).toBeVisible()

  // reject the fake one: buyer sees a polite note, never the reason
  await benRow.getByRole('button', { name: 'Reject' }).click()
  await page.getByRole('button', { name: 'Reject payment' }).click()
  await expect(fake.getByText(/couldn't match this payment yet/)).toBeVisible()
  await expect(fake.getByText('Reference not in')).toHaveCount(0)
  await page.goto('/seller/buyers')
  await expect(page.getByRole('row').filter({ hasText: 'Ben Tan' }).getByText('Hold')).toBeVisible()
})

test('packing list shows verified orders only, grouped by buyer', async ({ browser }) => {
  const page = await sellerPage(browser)
  await page.goto('/seller/packing')
  await expect(page.getByText('Mark Dela Cruz')).toBeVisible()
  await expect(page.getByText('Liza Santos')).toBeVisible()
  await expect(page.getByText('Ben Tan')).toHaveCount(0)
  const card = page.getByRole('group', { name: 'Packing for Mark Dela Cruz' })
  await card.getByRole('button', { name: 'Packed' }).click()
  await expect(card.getByText('Packed', { exact: true }).first()).toBeVisible()
  await card.getByRole('button', { name: 'Shipped' }).click()
  await expect(card.getByRole('button', { name: 'Shipped' })).toHaveAttribute('aria-pressed', 'true')
})

test('viewer scans the QR, watches the camera stream and claims by commenting', async ({ browser }) => {
  const page = await sellerPage(browser)
  await page.goto(`/seller/live/${sid}`)
  await page.getByRole('button', { name: 'Put B9 on camera' }).click()
  await page.getByRole('button', { name: 'Turn on camera' }).click()
  await expect(page.getByText('On air')).toBeVisible()
  const viewerUrl = await page.getByAltText('Viewer page QR').getAttribute('data-qr-value')
  expect(viewerUrl).toContain(`/live/${sid}`)

  const v = await phone(browser)
  await v.goto(new URL(viewerUrl!).pathname)
  await expect(v.getByText('Vintage windbreaker')).toBeVisible()
  // WebRTC video arrives from the seller's (fake) camera
  await expect(v.locator('video')).toBeVisible({ timeout: 20_000 })
  await expect.poll(async () => v.locator('video').evaluate((el: HTMLVideoElement) => el.videoWidth), { timeout: 20_000 }).toBeGreaterThan(0)

  await v.getByLabel('Your name').fill('Kim Uy')
  await v.getByRole('button', { name: 'Join' }).click()
  await v.getByRole('textbox', { name: 'Comment' }).fill('mine')
  await v.getByRole('button', { name: 'Send comment' }).click()
  await expect(v.getByText('claimed B9')).toBeVisible()
  const chip = v.getByRole('link', { name: /B9 · confirm now/ })
  await expect(chip).toBeVisible()
  // the seller's board shows it live
  await expect(page.getByRole('region', { name: 'On camera' }).getByText('Kim U.')).toBeVisible()
  await chip.click()
  await expect(v.getByText('Claimed for you')).toBeVisible()
})

test('catalog: add, edit and delete an item', async ({ browser }) => {
  const page = await sellerPage(browser)
  await page.goto('/seller/catalog')
  await page.getByRole('button', { name: 'Add item' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Code')).toHaveValue('B21')
  await dialog.getByRole('button', { name: 'Add item' }).click()
  await expect(dialog.getByText('Give the item a name.')).toBeVisible()
  await dialog.getByLabel('Name').fill('Linen tote bag')
  await dialog.getByLabel('Price').fill('199')
  await dialog.getByRole('button', { name: 'Free size' }).click()
  await dialog.getByLabel('Add keyword').fill('tote')
  await dialog.getByLabel('Add keyword').press('Enter')
  await dialog.getByRole('button', { name: 'Add item' }).click()
  await expect(page.getByRole('row').filter({ hasText: 'Linen tote bag' })).toBeVisible()
  await page.getByRole('button', { name: 'Edit B21' }).click()
  await page.getByRole('dialog').getByLabel('Price').fill('249')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('row').filter({ hasText: 'Linen tote bag' }).getByText('₱249.00')).toBeVisible()
  await page.getByRole('button', { name: 'Edit B21' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Delete item' }).click()
  await expect(page.getByRole('row').filter({ hasText: 'Linen tote bag' })).toHaveCount(0)
})

test('insights reflect the live and every seller screen renders', async ({ browser }) => {
  const page = await sellerPage(browser)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/seller/insights')
  await expect(page.getByText('Comments read')).toBeVisible()
  await expect(page.getByText('Stopped before shipping')).toBeVisible()
  for (const p of ['settings', 'buyers', 'payments', 'packing', 'catalog', 'sessions']) {
    await page.goto(`/seller/${p}`)
    await expect(page.locator('h1')).toBeVisible()
  }
  expect(errors).toEqual([])
})

test('ending the live stops new comments but buyer links keep working', async ({ browser }) => {
  const page = await sellerPage(browser)
  await page.goto(`/seller/live/${sid}`)
  await page.getByRole('button', { name: 'End live' }).click()
  await expect(page.getByText('Ended', { exact: true })).toBeVisible()
  const r = await page.request.post(`/api/public/sessions/${sid}/comments`, { data: { device_id: 'device-after-end', name: 'Late', message: 'mine' } })
  expect(r.status()).toBe(409)
  const [o] = await orders(page.request, 'B9')
  const res = await page.request.get(`/api/buyer/${o.buyer_token}`)
  expect(res.ok()).toBeTruthy()
})
