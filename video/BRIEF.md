# Fledge launch reel: brief

## Goal
- Kind: hype launch reel, 26 s, no voice. The type and the product carry it.
- Audience: Anambra Web3 Hackathon judges (Roqqu team, local builders) and X/WhatsApp viewers.
- The one thing to feel: an apprentice's settlement stops being a spoken promise; Fledge writes it down, funds it a little at a time through Roqqu, and only the apprentice and the witnesses can release it.
- Where: submission form, the live pitch (played from the deck), X/WhatsApp. Master 1920x1080 at 30 fps; a 1080x1920 cut for phones from the same timeline.
- Event limits: none published for video; submission is 2026-11-05, pitching 2026-11-06.

## Truth sheet (the film may only show what is here)
| Claim / number / screen | Evidence | Status |
|---|---|---|
| App screens (sign-up, promise card, funding, settle, record) | Captured from https://fledge.up.railway.app at 390x844 by capture.mjs | deployed |
| Fledge contract on Base Sepolia, source verified | 0x82fff61ae4b5344149a895b4259f8f4701d9abc2, Sourcify exact match | testnet |
| Promise ₦2,750,000 ($2,000), 16 instalments of ₦171,875 | Demo scenario in server/src/index.js; rate ₦1,375/$ from Roqqu /rates | testnet, demo data |
| Instalment paid with Roqqu, credited after deposit check | e2e-base-sepolia.log; Credited events on the contract | testnet; Roqqu simulated in its documented format |
| Naira bank transfer converted at Roqqu's rate | naira-base-sepolia.log, ref naira:FL2N0833841914:171875NGN@1375 | testnet; bank rail simulated |
| Witness seals = on-chain approveResolution transactions | ResolutionApproved events | testnet; server-held demo signers |
| Oga can't cut the promise alone | test_ogaCannotCutThePromiseAlone + e2e "promised still 2000" | testnet |
| Payout recorded on chain | PaidOut tx 0x07a95db1…1514 (USDC via Roqqu), 0x5632cfd4…679a (naira bank) | testnet; payout rails simulated |
- Must stay labelled: the end card says "Base Sepolia testnet · Roqqu and bank rail simulated · demo signers". The app's own "Roqqu simulator" line stays visible where it is on screen.
- Not claimed: real users, pilots, mainnet, real money, any adoption number.

## Inputs
- Product: https://fledge.up.railway.app (demo sign-in, no account or password).
- Captures: capture.mjs screenshots at 390x844 plus scripted flows (sign-up, pay with Roqqu, seals stamping, the Oga's cut refused, payout). States that need settlement day come from a fresh demo promise due in 2 minutes.
- Brand: the app's own palette (cloth red #b8352f, maroon, gold #e9a23b, slate, mint, warm paper), Fraunces display, Instrument Sans UI, the fledgling emblem and cloth patterns, all from web/src.
- Reference: launch-reel grammar only (fast kinetic type, snap-then-hold, phone in frame, beat-cut). No borrowed content.
- Music: synthesized (no licensed track, no paid service): a 120 BPM drum-and-pad bed from sfx.mjs cues, ticks on the weave, a thump on each seal. Voice: none.

## Beat sheet (120 BPM, one bar = 2 s)
| Shot | Time | Event | Reads, in order | Camera / transition | Sound |
|---|---|---|---|---|---|
| 01 | 0.0-2.5 | Hook on cloth | "Years of service." → "For a spoken promise." | Cloth stripes slide in on the downbeat; type snaps word by word | riser, thump at 2.0 |
| 02 | 2.5-5.0 | The problem | "Settlements come late. Shrink. Or never come." | Words strike through one by one; hard cut on the downbeat | three ticks, swish |
| 03 | 5.0-7.5 | Brand | Fledgling emblem stamps in → "Fledge" → "The settlement, written down" | Emblem lifts off the nest; iris out of the seal into the phone | thump, chime |
| 04 | 7.5-11.5 | Promise card | Phone rises with the real promise card → weave fills thread by thread, missed threads in red → "Every instalment, woven in" | Camera push on the weave | tick per thread |
| 05 | 11.5-15.0 | Pay with Roqqu | Tap "Pay ₦171,875 with Roqqu" → Roqqu checkout → a new gold thread lands | Cut on the tap; morph back to the card | click, pop, success |
| 06 | 15.0-19.0 | Seals | Settle tab → seals stamp in one by one → "Witnesses seal it. The apprentice consents." | Push into the seal row | thump per seal |
| 07 | 19.0-22.0 | Guard | The Oga's cut → "Refused by the contract" → "The Oga can't take it back." | Shake-free snap zoom on the refusal | error, then silence beat |
| 08 | 22.0-26.0 | Payout and end | "Send through Roqqu" → paid → end card: emblem, "Fledge", fledge.up.railway.app, evidence labels | Phone slides out; end card holds 2 s | success, pad swell, fade |

## Gates
1. Brief + truth sheet agreed
2. Shot list on the beat grid agreed
3. Stills and contact sheet reviewed (scores logged in docs/review_log.md)
4. Hardest 2-4 s checked with a strip; `--verify` deterministic
5. Full render on the GCP VM testbench, mix, check.mjs (contact, phone, loudness), watched with sound
6. Deliverables: out/final.mp4, out/final-9x16.mp4, poster.png, contact.jpg, credits line
