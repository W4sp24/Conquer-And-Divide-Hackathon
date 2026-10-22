**Problem Statement:**  
How can we help Facebook Live sellers turn chaotic live comments into confirmed, paid orders, so they stop losing money to missed claims, buyers who never pay, and fake payment proofs?

**Product Proposition:**  
MineIt\! helps live sellers turn chaotic live comments into confirmed, paid orders by reducing manual tracking of orders and filtering the chat relevant to the ordering process.

**The Idea**  
A software/system that captures raw live comments from a seller's Facebook Live (through Meta's official API) and translates them into orders in real time. Before the seller ships, it checks each buyer's payment against its own statement, so fake payment proofs get caught. After the live, she gets a packing list of verified orders and metrics that help the business.

**Users**: Micro and small businesses that sell mainly through Facebook Live, starting with ukay and fashion sellers (fashion, accessories, beauty, and personal care are half of video commerce GMV). Hackathon scope: Facebook Live only (see Out of Scope).

**Researched Data**

* PH digital economy on track for **US\$36B GMV in 2025**, with e-commerce growing 16% a year. **Video commerce sellers hit 475,000, up 90% year-on-year**, with 1.2 billion video commerce transactions. Fashion, accessories, beauty and personal care are half of video commerce GMV. (e-Conomy SEA report by Google, Temasek and Bain, via [SunStar, Nov 2025](https://www.sunstar.com.ph/cebu/ph-digital-economy-surge-on-video-commerce-boom))  
* Facebook reached **95.8M users** in the Philippines in late 2025, and TikTok reached 64.0M adults. These are ad-audience estimates, not active users. ([DataReportal Digital 2026](https://datareportal.com/reports/digital-2026-philippines))  
* **47% of Filipino live sellers go live daily, vs a 31% regional average.** Filipino sellers spend up to **14 hours a week** live selling, vs up to 6 regionally. 52% say live selling is more profitable than marketplace listings. (Ninja Van white paper, 1,000+ sellers across SEA, [Jan 2023](https://blog.ninjavan.co/en-ph/live-selling-study-2023/), older)  
* Across SEA, the top live-selling channels are Shopee (27.0%), Facebook (25.5%) and TikTok (22.5%). Sellers use two channels on average. (same Ninja Van study; regional, not PH-only)  
* The Ken reported **73 million livestream shoppers** in the Philippines, with about 60% of online shoppers buying from livestream sellers, nearly double the regional average. ([The Ken, Aug 2023](https://the-ken.com/story/how-livestream-sellers-in-the-philippines-double-up-as-scammers-on-shopee-fb/), older)

**Proof of the Pain**

* **Fake payment proofs:** an online tire seller lost over ₱1.4M in a month to fake bank-transfer receipts ([GMA News, Oct 2026](https://www.gmanetwork.com/news/topstories/metro/1006083/fake-proof-of-payments-used-in-p1-4-million-online-selling-scam/story/)). A clothing live-seller lost nearly ₱230,000 to a bogus buyer ([DZRH, Feb 2024](https://dzrh.com.ph/post/pnp-arrest-a-bogus-buyer-who-purchase-almost-p230000-worth-of-clothing-online)).  
* **AI-made fake receipts:** GCash warned about them and told users to check the Transactions tab for every payment ([GCash, Jul 2025](https://mynt.com.ph/newsroom/gcash-warns-public-on-emerging-ai-generated-fake-receipts-scams-urges-users-to-always-check-transactions-tab)).  
* **Joy reservers and bogus buyers:** a common scam on PH merchants: people who claim and back out, or reject delivered parcels ([Maya, Apr 2024](https://www.maya.ph/business/stories/4-common-types-of-e-commerce-scams-that-affect-merchants-in-the-philippines)).  
* **Complaints:** DTI recorded over 13,000 complaints about online transactions from January to August 2025 ([Marketing-Interactive, Sept 2025](https://www.marketing-interactive.com/over-13-000-online-transaction-complaints-spur-mandatory-trustmark-registration)).  
* **Still manual:** Facebook's Live Shopping tool was never offered in the Philippines, so sellers still take orders from comments by hand ([GMA News, Aug 2022](https://gmanetwork.com/news/money/companies/841010/users-in-philippines-may-still-do-facebook-live-selling-meta/story)).  
* **COD:** 86% of Filipino online shoppers pay by cash on delivery (Statista 2022, via [Ninja Van, Jan 2024](https://blog.ninjavan.co/en-ph/how-to-reduce-cod-returns/)).  
* **Still missing:** how many claims never pay, and hours spent after each live. To get from 5 to 10 live sellers.

**Regulatory Constraints**

* **Internet Transactions Act (RA 11967\)**, signed Dec 5, 2023: online merchants must disclose prices, deliver as agreed, follow data privacy law, and are primarily liable to consumers. It excludes consumer-to-consumer deals, and it doesn't clearly say how social media sellers are classified. ([Forvis Mazars](https://www.forvismazars.com/ph/en/insights/corporate-secretarial-alerts/internet-transactions-act-of-2023)) → Design: the catalog shows prices, and each order keeps a clear record of what was agreed.  
* **eCommerce Philippine Trustmark:** ₱1,130 a year. DTI deferred making it mandatory, kept it voluntary until the end of 2025, and said it would review in 2026\. Barangay micro business enterprises (BMBEs) don't pay the fee. ([Inquirer, Oct 2025](https://business.inquirer.net/552900/e-commerce-trustmark-registration-deferred), [Philstar, Sept 2025](https://www.philstar.com/headlines/2025/09/22/2474537/online-sellers-slam-dtis-p1130-trustmark-fee/amp/)) Sellers pushed back hard on the fee. Whether it covers Facebook-only sellers is unclear.  
* **BIR:** 1% withholding on half of remittances for sellers above ₱500,000 a year (RR 16-2023). Not core to our app; session sales totals could later warn a seller nearing the threshold.  
* **Data privacy (RA 10173):** commenter names and addresses are personal data. Collect only what the order needs and delete it afterward. → Design: store only buyer ID, name and order history; mask names on screen; delete on request.  
* **Meta Platform rules:** read-only access through the official Live Video API with a Page access token. Development mode works for people with a role on our app; real sellers need Meta App Review. No auto-posting or replying.

**Current existing solution**

* [**LiveOrder Pro**](https://chromewebstore.google.com/detail/jmpjaiacpkncfemgdbkpbmeegjjofgfc): Chrome extension that reads live comments, including Filipino keywords (mine, mina, pabili), and ranks first claimers. ₱299 lifetime. Stops at capture, with no payment check.  
* [**Ulive.me**](https://blog.ulive.me/posts/guide-to-live-selling-on-facebook-and-instagram-without-manual-work): tracks live comments through to payment on Facebook and Instagram. Focused on Malaysia and Singapore.  
* [**EasyStore**](https://blog.easystore.co/en-ph/facebook-live-selling-strategies)**:** comment a keyword, get a Messenger checkout link. Needs their paid platform and payment gateway.  
* [**BigSeller**](https://www.bigseller.com/blog/articleDetails/top-ecommerce-order-management-systems-philippines-2026.4965.htm)**:** syncs Facebook live orders into a multichannel order system. Built for sellers already on marketplaces.  
* **TikTok Shop and Shopee Live:** built-in carts inside the livestream. Only work on those platforms.  
* **Manual (most sellers):** notebook, screenshots, Messenger. Slow, and claims and payments get lost.  
* **Our gap:** none of these check if a claim turned into a real payment before shipping, and keyword tools miss messy Taglish.

**Confirmed Pain Points**

* Manual handling of sales (up to 14 hours a week live, then confirming each order by hand in Messenger) → live order capture and order board  
* Fraudulent payment proofs (one seller lost over ₱1.4M in a month, [Oct 2026](https://www.gmanetwork.com/news/topstories/metro/1006083/fake-proof-of-payments-used-in-p1-4-million-online-selling-scam/story/); GCash warned about AI-made fake receipts, [Jul 2025](https://mynt.com.ph/newsroom/gcash-warns-public-on-emerging-ai-generated-fake-receipts-scams-urges-users-to-always-check-transactions-tab)) → payment verification  
* Joy reservers and bogus buyers who mine and never pay (named by [Maya](https://www.maya.ph/business/stories/4-common-types-of-e-commerce-scams-that-affect-merchants-in-the-philippines) as a common merchant scam) → queue, waitlist and buyer labels  
* Disputes over who mined first ("ako nauna\!") → timestamped queue  
* Messy Taglish comments that keyword tools miss → LLM layer and needs-review bucket  
* Packing for buyers who never paid → packing list with verified orders only

**Confirmed by:** news reports and research so far. Still to confirm with 5 to 10 live sellers (3 questions: claims per live, how many never pay, hours spent after the live).

SYSTEM LOGIC AND IDEA

**Data/inputs:**

* Live comments from the seller's Facebook Page live, through Meta's official Live Video API (read-only): [https\://developers.facebook.com/documentation/live-video-api/interact-with-viewers](https://developers.facebook.com/documentation/live-video-api/interact-with-viewers)  
* Replay of recorded real comments (fallback if the live or Wi-Fi fails)  
* Seller's catalog: item code, name, price, stock, keywords  
* Buyer's payment proof through a private order link, not the public comments: the buyer checks the payment in their own wallet, then types the reference number and amount  
* Seller's statement CSV (GCash for Business or bank export) for payment matching (default payment source; a real sample export is still needed to build the parser)  
* Optional: PayMongo QR Ph payment events (webhook, test mode only) as a second payment source

Core Classification \- real-time transaction processing system with an NLU (natural language understanding) layer

Core Features:

* Catalog: item codes, names, prices, stock and keywords (sits behind every feature)  
* Orderboard: live view of every item and buyer cart, built from the queue  
* Queue: first come, first served by comment time, with a waitlist per item. A cancel or unpaid claim passes the item to the next buyer  
* Algorithm for Verifying Payments: inputs are the buyer's typed reference number and amount, plus the seller's statement CSV. Rule: the reference number must exist in the statement with the same amount; flag missing or reused reference numbers, amount mismatches, and any order over 3 times the buyer's biggest paid order. A reference missing from an older statement waits as Pending, not Hold. Output: Release, Hold or Pending, with every reason found. The seller makes the final call with one tap  
* Buyer order link: a private page for each order (unguessable token, no login). The buyer confirms or fixes what the system read before the order counts. Unconfirmed claims expire and the item returns to the queue.  
* Payment modes: Manual (default) and Instant QR (optional, through PayMongo). See Payment Verification Design.  
* Packing list: verified orders only, grouped by buyer, with checkboxes and session totals  
* LLM layer for interpreting messy taglish: reads only what rules and rapidFuzz can't (see Why AI). Low-confidence results go to a needs-review bucket that the seller fixes in one tap  
* Buyer records: each buyer's claims, payments, and cancellations, with simple labels (HOLD, WATCH, TRUSTED, NEW)

**Order Lifecycle**

* States: CLAIMED, CONFIRMED, PROOF\_SENT, VERIFIED, PACKED, SHIPPED. Side states: EXPIRED (not confirmed or not paid in time) and CANCELLED.  
* A comment becomes a CLAIMED order, and the item is held for a short window (for example 10 to 15 minutes) so the next buyer is not blocked.  
* The buyer opens a private link, reviews what the system read (item, size, quantity, total) and taps Confirm. The order is now CONFIRMED and the payment deadline starts.  
* The buyer pays outside the app (Manual mode) or scans the QR shown in the app (Instant QR mode).  
* Manual: the buyer checks the payment in their own wallet and enters the reference number. Instant QR: the payment.paid webhook arrives. The order is PROOF\_SENT.  
* The system checks and recommends Release, Hold or Pending, with reasons. The seller confirms with one tap, and the order becomes VERIFIED and joins the packing list.  
* Every outcome (verified, failed proof, expired) updates the buyer's record and label.

**Payment Verification Design**

* Default (Manual): works for any seller with no setup. The buyer pays the seller's own GCash or bank account, then the reference is matched against the seller's statement.  
* Optional (Instant QR): the backend asks PayMongo for a QR Ph code for the exact order amount and shows it on the buyer's page. A payment.paid webhook verifies the order in seconds, with no statement upload. Demo in test mode only. Not tested yet.  
* Both modes write to one payments table (reference, amount, time, source), so the same checks and order states apply.  
* Buyer self-check: before submitting, the buyer opens the payment in their own wallet and confirms the status is successful, the amount is right and the recipient is the seller. Typed values replace screenshots, so there is no image to forge.  
* The system does not try to detect fake screenshots. It checks the payment against the seller's own statement, so the image does not need to be trusted.  
* Checks run in this order, and every reason found is shown: reference given, reference not used on another order, reference found in the statement, amount equals the order total, order not over 3 times the buyer's biggest paid order.  
* A reference missing from an older statement makes the order Pending, not Hold. Hold is for a failed check.  
* Amounts are stored in centavos as whole numbers. References are cleaned before matching (spaces and dashes removed, capital letters). A unique rule on seller and reference in the database stops two orders from using one reference.  
* A near match to a typed reference is shown as a suggestion only ("did you mean 1234..."). It is never accepted automatically.  
* No public GCash API for general developers was found, and a live gateway account needs business verification, so Manual is the default.

**Why AI (and why not everywhere)**

* Rules handle clean comments ("mine B12") instantly and for free.  
* rapidFuzz matches typos and descriptions to the catalog ("blu polo" → Blue polo).  
* The LLM only reads what rules can't settle: Taglish descriptions ("yung blue po"), cancellations, waitlists, "mine" for the item on camera, and buying for someone else.  
* It uses context: the item on camera, the last few items shown, and the buyer's recent claims.  
* It learns each seller's slang from her corrections in the needs-review bucket.  
* Without AI: messy comments get missed or saved as wrong orders, and the seller fixes them all by hand.  
* The AI only reads. Every decision (who gets the item, payment matching) is plain code.

**Demo Script**

* Persona: Jessa, an ukay seller in Tondo who goes live 3 times a week.  
* Catalog is pre-loaded: codes B1 to B20 with photo, price and keywords.  
* During the live, comments stream in and the board fills: claims, waitlists, and cancellations that pass the item to the next buyer.  
* Each buyer opens a private link, checks what the system read (item, size, quantity) and taps Confirm. A wrong size gets fixed here, not at packing time.  
* Scoreboard: rules caught X, AI caught Y more, Z need review.  
* After the live, buyers pay through their order link. Jessa uploads her statement, and a fake receipt turns red: "HOLD: reference number not in your statement."  
* Optional, only if the PayMongo test works: Instant QR mode. A QR appears for one order, a teammate approves it on PayMongo's test page, and the order becomes VERIFIED in seconds. Say clearly that this is test mode.  
* The packing list shows verified orders only.  
* Wow moment (Day 3): judges scan a QR code and comment live. Their own Taglish comments update the board in seconds.

**Business Model**

* User and payer: the Facebook Live seller.  
* Freemium: free for a few lives a month, then a monthly plan for unlimited lives and payment checks. Price to test with sellers.  
* Manual mode is the default and works for any seller. Instant QR is the upgrade for sellers who want no checking, and it carries a gateway fee per payment. Look up PayMongo's published rates before quoting a number.  
* Later: partner with e-wallets or banks to offer payment checks to their merchants.  
* Success metrics: % of comments read correctly (rules vs rules \+ AI), % of claims that end in a verified payment, hours saved per live.

**Risks and Fallbacks**

* Meta's API might not return who commented (the from field). Spike test first. Fallback: Replay of recorded real comments.  
* Comments from people without a role on our Meta app might not come through. Fallback: a QR live chat page that feeds the same pipeline.  
* Taglish accuracy is unknown. Benchmark on 100 labeled comments, and keep the needs-review bucket so nothing is lost.  
* Venue Wi-Fi can fail. Use a phone hotspot and the Replay toggle.  
* The render cold start takes about 1 minute. Hit /health before every demo.  
* Buyers might not want the extra step. Keep it to one page, one field, and one tap, and ask 5 to 10 sellers whether their buyers would use it.  
* PayMongo test mode and the payment. Paid webhooks are not tested yet. Run a one-hour spike after the manual flow works end-to-end. If it fails, show Instant QR on the roadmap slide only.  
* The statement may not be uploaded yet when the proof arrives. The order waits as Pending instead of being marked fake.  
* A dishonest buyer can type any reference. The statement matches, and the seller's confirmation is that the real checks are not the typed value.  
* The GCash and Maya export format is not confirmed. Get a real sample statement from a seller before finishing the parser.

**Out of Scope (for the hackathon)**

* TikTok and Shopee: no official live comment API found, and both have built-in carts.  
* Auto-replying or posting in Facebook comments.  
* Real payments, shipping and courier integration.  
* Detecting fake screenshots. It is not reliable, so we check payments against the seller's statement instead.  
* Payment proof in the public live comments (privacy) and Messenger automation (extra Meta permissions and review).  
* Live payments through a gateway, and direct GCash or Maya APIs. No public GCash API for general developers was found, and a live PayMongo account needs business verification. The Instant QR demo runs in test mode only.  
* Sharing buyer history across sellers (privacy and defamation risk).

Technologies and libraries to use:

* ReactJS \- Frontend (Vite), hosted on Vercel  
* FastAPI- Backend, hosted on Render (free tier sleeps after 15 min idle, so warm it up before demos)  
* Openrouter \- LLM. Pick providers that don't keep or train on prompts, since buyer names are personal data (RA 10173\)  
* rapidFuzz \- String Similarity library  
* httpx \- reads Meta's live comment stream from the backend, so the Page token never reaches the browser  
* Server-Sent Events (SSE) \- pushes live updates from FastAPI to the React screen  
* Supabase (Postgres) \- stores catalog, orders, buyers and corrections, so nothing is lost if the backend restarts  
* Meta Graph API (Live Video API) \- live comments, official and read-only  
* [PayMongo API](https://docs.paymongo.com/docs/payment-acceptance-qr-ph) (optional) \- QR Ph payments and payment.paid webhooks, test mode only for the demo