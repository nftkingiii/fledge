# Fledge

**The Igba-boi settlement, written down.**

In the Igbo apprenticeship system (Igba-boi), a boy serves an Oga for years in return for a promised *settlement*: the capital to open his own shop. That promise is usually spoken and unrecorded. Settlements come late, shrink, or never come, and the apprentice has nothing to show his family or the market union. Most masters also can't lock the money up on day one; they pay it out of profits over the years.

A young bird *fledges* when it is ready to leave the nest. Fledge records the settlement promise on day one, lets the Oga fund it gradually in naira through Roqqu, and lets money leave only through a resolution that the apprentice consents to and a quorum of witnesses approves.

Anambra Web3 Hackathon 2026 · DeFi track.

## How it works

1. **The promise.** The Oga sets the amount, the term, an instalment schedule and named witnesses (market union, family, church). The apprentice accepts it on chain.
2. **Gradual funding through Roqqu.** Each instalment is a Roqqu payment link priced in naira and paid in USDT. When Roqqu's webhook arrives, Fledge decrypts it, checks the deposit with Roqqu by its hash, and only then credits the promise on chain.
3. **Arrears are visible early.** The contract knows what should have been paid by now, so the witnesses see a missed quarter years before settlement day.
4. **Settlement day, even when the money isn't all there.** Anyone on the promise can propose a resolution:
   - pay what is held now and set a new date for the rest,
   - settle part in goods (shop stock, a year's rent),
   - extend the date,
   - an early exit by the apprentice (pro-rata payout, the rest back to the Oga),
   - a reduction (for example after a market fire).

   It applies only when the **apprentice consents** and **a quorum of witnesses approves**. The Oga's approval is not required, and he has no way to withdraw funded money.
5. **Payout through Roqqu.** Only what an applied resolution made payable can be sent (USDC on Base via Roqqu Send). The Roqqu reference is recorded on chain.
6. **A public settlement record.** Each Oga carries a record across apprentices: promises closed, % delivered, extensions, reductions.

## What is real, what is simulated

| Part | Status |
| --- | --- |
| Fledge contract on Base Sepolia | Deployed, source verified (Sourcify exact match) |
| Funding, arrears, resolutions, payouts, record | On chain, exercised through the web app's API |
| Roqqu exchange rate | Live from Roqqu's public `/rates` |
| Roqqu payment links, webhooks, deposit checks, sends | **Simulated.** Roqqu said hackathon keys only grant simulations, so Fledge ships a Roqqu simulator that speaks the documented formats (including the aes-256-ctr webhook encryption). Fledge calls it over HTTP through the same client it uses for `service.roqqu.com`; only the base URL and key differ. |
| Oga, apprentice and witness signatures | **Demo signers.** The server signs for each role so the flow can be shown in one browser. In production each person signs with their own wallet. |
| Seeded history | The demo promise starts with one credit labelled `SEED-history` so arrears are visible immediately. |

Funds would sit in the operator's Roqqu merchant balance; the contract is the rulebook and the public record. The operator can only credit Roqqu-confirmed payments and record payouts that a resolution approved.

### Provider downtime

The simulator has an outage switch. During an outage no instalment link can be created, and confirmed payments that can't be checked or credited wait in a retry queue. Each Roqqu reference can be recorded on chain only once, so retries never credit twice.

## Evidence

- Contract: [`0x82fff61ae4b5344149a895b4259f8f4701d9abc2`](https://sepolia.basescan.org/address/0x82fff61ae4b5344149a895b4259f8f4701d9abc2) on Base Sepolia, verified on [Sourcify](https://repo.sourcify.dev/84532/0x82fff61ae4b5344149a895b4259f8f4701d9abc2) (exact match).
- Deploy tx: [`0x60a5…45cb`](https://sepolia.basescan.org/tx/0x60a5d1c209abdc809fc801f3b3c842fe8d4391890fbeb7f8a4c8747c97ac45cb).
- Live app: https://fledge.up.railway.app
- Full flow on Base Sepolia (promise #1): seeded arrears → exact Roqqu payment credited → underpayment refused → link refused during a Roqqu outage → the Oga's attempt to cut the promise stays open without the apprentice → settlement before the date refused → 60% settlement applied after the apprentice consented ([tx](https://sepolia.basescan.org/tx/0x8bc1c39d8f088864f70d4821ac64f74204e921086323ab94721d36ab9622b2d8)) → payout recorded ([PaidOut tx](https://sepolia.basescan.org/tx/0x07a95db1b2211b409741b58f34efefa8390f0f972cc9e032018956e938571514)). The remaining 40% rolls into a 12-month plan.
- Each witness seal is that witness's own `approveResolution` transaction, from their own address; the apprentice's consent is a `consentResolution` transaction.
- Contract tests: 16 Foundry tests, including every adverse case above (`contracts/test/Fledge.t.sol`).

## Run it

```bash
# contracts (Foundry)
cd contracts && forge install foundry-rs/forge-std --no-git && forge test

# app
cd server && npm install && cp .env.example .env   # fill in keys locally, never commit them
cd ../web && npm install && npx vite build
cd ../server && node --env-file=.env src/index.js   # http://localhost:8790
```

`server/test/roqqu-sim.check.mjs` exercises the Roqqu client against the simulator. `server/test/e2e.check.mjs` runs the whole flow against a running server.

## Layout

- `contracts/` — `Fledge.sol`, tests, deploy script
- `server/` — Express API, Roqqu client, Roqqu simulator, chain access (viem)
- `web/` — React app: Promise, Funding, Settlement and Record tabs
