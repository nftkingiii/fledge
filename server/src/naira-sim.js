import crypto from "node:crypto";
import express from "express";

/**
 * A stand-in naira bank rail: collection accounts for bank transfers in, a bank
 * list and account-name lookup, and transfers out. Roqqu API Services has no
 * naira endpoints, so this plays the part a Nigerian payments partner would.
 * Webhooks are signed with HMAC-SHA256 over the raw body, the usual pattern
 * for Nigerian payment providers.
 */
export const BANKS = [
  ["044", "Access Bank"],
  ["058", "Guaranty Trust Bank"],
  ["011", "First Bank of Nigeria"],
  ["033", "United Bank for Africa"],
  ["057", "Zenith Bank"],
  ["50515", "Moniepoint MFB"],
  ["999992", "OPay"],
  ["999991", "PalmPay"],
  ["50211", "Kuda Bank"],
];
const HOLDERS = ["Chidi Nwosu", "Adaeze Okonkwo", "Emeka Obi", "Ngozi Eze", "Ifeanyi Okafor", "Chiamaka Nnadi"];

export function createNairaSim({ secret, publicUrl, webhookUrl }) {
  const router = express.Router();
  const collections = new Map();
  const payouts = new Map();
  const state = { outage: false };
  const fail = (res, code, message) => res.status(code).json({ status: "fail", message });

  router.use(express.urlencoded({ extended: false }));
  router.use(express.json());

  const api = express.Router();
  api.use((req, res, next) => {
    if (state.outage) return fail(res, 503, "service temporarily unavailable");
    if (req.get("authorization") !== `Bearer ${secret}`) return fail(res, 401, "invalid key");
    next();
  });

  api.get("/banks", (_req, res) => res.json({ status: "success", data: BANKS.map(([code, name]) => ({ code, name })) }));

  api.post("/accounts/resolve", (req, res) => {
    const { bank_code, account_number } = req.body;
    if (!BANKS.some(([c]) => c === bank_code)) return fail(res, 400, "unknown bank");
    if (!/^\d{10}$/.test(account_number || "")) return fail(res, 400, "account number must be 10 digits");
    const n = Number(account_number.slice(-3)) % HOLDERS.length;
    res.json({ status: "success", data: { account_name: HOLDERS[n].toUpperCase(), account_number, bank_code } });
  });

  // A one-time collection account for one instalment.
  api.post("/collections", (req, res) => {
    const amount = Math.round(Number(req.body.amount_ngn));
    if (!(amount >= 100)) return fail(res, 400, "minimum is 100 naira");
    const reference = String(req.body.reference || "");
    if (!/^[A-Za-z0-9]{6,30}$/.test(reference)) return fail(res, 400, "invalid reference");
    const c = {
      reference,
      amount_ngn: amount,
      account_number: String(9000000000 + crypto.randomInt(0, 99999999)),
      bank_name: "Wema Bank (simulated)",
      account_name: "Fledge Settlement Collections",
      status: "pending",
      received_ngn: 0,
      metadata: req.body.metadata || {},
      expires_at: new Date(Date.now() + 24 * 3600e3).toISOString(),
    };
    collections.set(reference, c);
    res.json({ status: "success", data: { ...c, checkout_url: `${publicUrl}/sim/naira/transfer/${reference}` } });
  });

  api.get("/collections/:reference", (req, res) => {
    const c = collections.get(req.params.reference);
    if (!c) return fail(res, 404, "collection not found");
    res.json({ status: "success", data: c });
  });

  api.post("/transfers", (req, res) => {
    const { bank_code, account_number, amount_ngn, reference } = req.body;
    if (!BANKS.some(([c]) => c === bank_code)) return fail(res, 400, "unknown bank");
    if (!/^\d{10}$/.test(account_number || "")) return fail(res, 400, "account number must be 10 digits");
    if (!(Number(amount_ngn) >= 100)) return fail(res, 400, "minimum is 100 naira");
    if (payouts.has(reference)) return fail(res, 409, "duplicate reference");
    const t = { reference, amount_ngn: Math.round(Number(amount_ngn)), bank_code, account_last4: account_number.slice(-4), status: "successful", session_id: crypto.randomBytes(15).toString("hex").slice(0, 30) };
    payouts.set(reference, t);
    res.json({ status: "success", data: t });
  });

  router.use("/v1", api);

  // The payer's side: a bank app confirming the transfer.
  router.get("/transfer/:reference", (req, res) => {
    const c = collections.get(req.params.reference);
    if (!c) return res.status(404).send("Unknown transfer");
    res.type("html").send(transferPage(c));
  });

  router.post("/transfer/:reference", (req, res) => {
    if (state.outage) return res.status(503).send("The bank network is unavailable. Try again shortly.");
    const c = collections.get(req.params.reference);
    if (!c || c.status !== "pending") return res.status(400).send("This transfer is no longer open");
    const factor = req.body.outcome === "under" ? 0.5 : 1;
    c.received_ngn = Math.round(c.amount_ngn * factor);
    c.status = factor < 1 ? "underpaid" : "successful";
    c.paid_at = new Date().toISOString();
    const body = JSON.stringify({ event: c.status === "successful" ? "collection.successful" : "collection.underpaid", data: c });
    const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
    setTimeout(() => {
      fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json", "x-signature": signature }, body })
        .catch((e) => console.error("naira webhook", e.message));
    }, 1200);
    res.redirect(303, c.metadata.return_url || "/");
  });

  return { router, state };
}

/** Constant-time check of the webhook signature over the exact raw body. */
export function verifyNairaSignature(raw, signature, secret) {
  if (typeof signature !== "string" || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

function transferPage(c) {
  const naira = `₦${c.amount_ngn.toLocaleString("en-NG")}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bank transfer (simulated)</title>
<style>body{font:15px/1.5 system-ui,sans-serif;background:#f1efe9;color:#1d1b18;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
main{background:#fff;border-radius:16px;padding:24px;max-width:400px;width:100%;box-shadow:0 8px 30px #0001}
.sim{background:#fff4d6;color:#7a5600;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:16px}
dl{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;margin:16px 0}dt{color:#6b655c}dd{margin:0;font-weight:600;font-variant-numeric:tabular-nums}
button{width:100%;padding:12px;border-radius:10px;border:1px solid #ccc;background:#fff;font:inherit;margin-top:8px;cursor:pointer}
button.main{background:#0f6b4f;color:#fff;border-color:#0f6b4f}h1{font-size:30px;margin:4px 0}</style></head><body><main>
<div class="sim">Simulated bank app. It sends the same signed notification a payments partner would; no real money moves.</div>
<p>Transfer to</p><h1>${naira}</h1>
<dl><dt>Bank</dt><dd>${c.bank_name}</dd><dt>Account</dt><dd>${c.account_number}</dd><dt>Name</dt><dd>${c.account_name}</dd><dt>Narration</dt><dd>${c.reference}</dd></dl>
<form method="post"><button class="main" name="outcome" value="exact">Send ${naira}</button>
<button name="outcome" value="under">Send only half</button></form></main></body></html>`;
}
