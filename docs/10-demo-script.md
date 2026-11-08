# 10 · Demo script (about 5 minutes)

**Setup before going on stage:** laptop on the projector with `start-demo.ps1` running; **Settings → Reset demo data**; browser zoom so the board reads from the back (90–100% at 1440 px wide); two team phones on the same Wi-Fi (or a hotspot); the Go live screen open.

## 1. The problem (30 s)

“Meet Jessa. She sells ukay in Tondo on Facebook Live, three times a week, 40 to 80 items per live. Comments fly by: ‘mine B12’, ‘pa mine po yung blue na polo’, ‘cancel ko na’. She writes claims in a notebook, then spends hours matching GCash screenshots. Some are fake. Some buyers never pay.”

## 2. Capture orders live (90 s)

1. **Go live → Live here → Start live.** Click **Turn on camera**. Tap **B12 Denim jacket** in Items: it’s on camera.
2. “Judges, scan this QR.” (the **Scan to join** card). Phones open the live page and see the camera.
3. Teammate phone A comments **`mine`** → it appears on the board in a second, tagged **Rules**, and **Ana R.** is #1 on the stage. Phone B comments **`mine po`** → **Waitlist**.
4. Invite a judge to comment something messy, e.g. **`pa mine po yung blue na polo, M sana`** → tagged **Match**, claimed **B7**, size M. Something truly unclear (“mine yung ano po”) goes to **Needs you**: fix it in one tap. “The AI only reads; it never decides who gets the item or whether money arrived.”
5. Phone A comments **`cancel B12`** → B can see their page switch from *#1 in line* to *Claimed* by itself. “First come, first served by Facebook’s own timestamp, so ‘ako nauna’ is settled by the clock.”

## 3. Get paid without screenshots (90 s)

1. Phone B opens their order chip: checks size, **Confirm order**. **Pay with QR Ph** shows a code for the exact amount.
2. Phone A (or a judge) scans it → the **MockPay** checkout → **Confirm payment**. Phone B flips to *Payment confirmed* by itself, and the order is already in **Packing**. “In production this is PayMongo QR Ph: the gateway calls our signed webhook. Here it’s a test-mode stand-in with the same signature check.”
3. Manual path: another buyer chooses **I paid via GCash**, opens DemoWallet, sends, types the reference. A second buyer types a made-up reference.
4. **Payments:** both are *Pending* (“the statement doesn’t cover them yet”). **Get DemoWallet statement** → **Upload statement**: the real one turns **Release**, the fake one turns red: **Hold: reference not in your statement**. “We never look at the screenshot. We check her own statement.” **Release all green**.

## 4. Pack and learn (45 s)

1. **Packing:** only verified orders, grouped by buyer. Tick Packed.
2. **Insights:** comments read by rules vs match vs AI, the funnel from claimed to shipped, **₱ stopped before shipping**.
3. **Buyers:** the fake-reference buyer is now **Hold**. “Records stay in her shop only; she can delete a buyer’s data on request (Data Privacy Act).”

## 5. Close (15 s)

“From ‘mine!’ to paid and packed. Rules first, AI only where rules fail, and every money decision is plain, testable code: 57 backend tests and 12 browser tests check every money rule.”

## Fallbacks

| If… | Do this |
| --- | --- |
| Venue Wi-Fi blocks phones from the laptop | Laptop + phones on a phone hotspot; or a tunnel with `PUBLIC_WEB_URL` (doc 08) |
| Camera video doesn’t reach phones (firewall) | Keep going: comments still work, viewers see the item card |
| Nobody comments | **Go live → Replay a live** at 2× (`demo_tondo_live`), or **+ Type a test comment** on the board |
| Something gets messy mid-demo | **Settings → Reset demo data** (10 seconds) |
