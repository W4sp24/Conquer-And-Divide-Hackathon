# 12 · Security, privacy and known limitations

## Threats and what the code does

| Risk | Mitigation | Where |
| --- | --- | --- |
| Meta Page token or LLM key leaks | Only the backend reads them from env vars; the browser never sees them | `config.py`, `sources/meta_live.py`, `pipeline/llm.py` |
| Someone opens another buyer’s order | 128-bit random link token; the page returns one order and never other buyers’ names | `routers/buyer.py`, `views.buyer_view` |
| Buyer cancels after paying to dodge a check | Buyer cancel allowed only before payment is sent | `routers/buyer.py` |
| One reference used for two orders | Unique `(seller_id, reference)` on `proofs` | `schema.py` |
| Fake gateway webhook / replay | HMAC-SHA256 signature, constant-time compare, 5-minute timestamp window | `payments/gateway.py` |
| Webhook or statement delivered twice | Unique `(seller_id, source, reference)` on `payments` | `schema.py` |
| Wrong order from a bad parse | Unsure → Needs you; LLM limited to offered codes; buyer confirms every order | `pipeline/` |
| Race between buyer, seller and expiry | Guarded status updates; one winner | `orders/states.py` |
| Comment spam on the public page | 1 comment/second per device, 300 characters, only while the live runs | `routers/public.py` |
| Oversized uploads | Statement ≤ 5 MB; item photo resized in the browser and capped server-side; only image data URLs or https | `routers/payments.py`, `routers/catalog.py` |
| Direct database access | Supabase RLS on every table with no policies | `supabase/schema.sql` |
| Seller screens | Demo seller key (timing-safe compare) | `auth.py` |
| Buyer accused on screen | Hold reasons stay on the seller’s screen; buyers see neutral wording | `views.buyer_view`, `service.seller_reject` |

## Privacy (RA 10173)

- Data minimization: platform user id, display name, comment text, order and payment reference/amount. No addresses, phone numbers or bank account numbers.
- Masked names on the projected board and the public viewer page (“Ana R.”).
- The LLM receives no names or ids; choose OpenRouter providers that don’t retain prompts.
- No shared blacklist across sellers.
- Delete-my-data for a buyer: removes their comments, orders, proofs and record, and frees their held units.

## Known limitations (be upfront in Q&A)

- **Seller login** is a shared key, not user accounts. One seller per deployment.
- **Single backend instance** (in-memory SSE hub and WebRTC signaling). Scale-out needs Redis or Supabase Realtime.
- **Live video** is peer-to-peer from the seller’s browser: fine for a demo room and a few dozen viewers; a large audience needs an SFU/streaming service, and restrictive networks need a TURN server. Facebook Live remains the main broadcast channel in production; the in-app page shows the Facebook video when given its link.
- **Facebook Live comments** need a Page token; viewers without a role on the Meta app may need App Review. Not exercised in automated tests (no token available); the code follows Meta’s documented `live_comments` stream and reports errors on the board.
- **QR Ph** is a test-mode mock, not real money. DemoWallet stands in for GCash. The statement parser recognizes common column names but should be checked against a real GCash/Maya export (still to be collected by the business team).
- **LLM accuracy numbers** need an OpenRouter key to measure; the benchmark set is a 69-comment starter and should grow to 100+ real (anonymized) comments.
- Camera access needs `localhost` or HTTPS on the seller’s device.
