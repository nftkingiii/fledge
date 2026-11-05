import crypto from "node:crypto";
import express from "express";

/**
 * A stand-in for Roqqu API Services that speaks the same formats as the docs at
 * roqqu-api-services.gitbook.io: payment links, encrypted webhooks, deposit
 * lookups and sends. Nkwa talks to it over HTTP through the same client it would
 * use against service.roqqu.com, so only the base URL and key differ.
 *
 * It also has an outage switch, because providers go down.
 */
export function createRoqquSim({ key, publicUrl, webhookUrl }) {
  const router = express.Router();
  const links = new Map();
  const deposits = new Map();
  const sends = new Map();
  const state = { outage: false };
  let usdtBalance = 0;

  const id = () => String(BigInt("0x" + crypto.randomBytes(8).toString("hex")));
  const txHash = () => "0x" + crypto.randomBytes(32).toString("hex");
  const fail = (res, code, message) => res.status(code).json({ status: "fail", message });

  async function ngnRate() {
    try {
      const r = await fetch("https://service.roqqu.com/v1/rates", { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      return Number(j.data.find((x) => x.symbol === "ngn").rate);
    } catch {
      return 1375; // last rate seen from Roqqu on 2026-11-04
    }
  }

  router.use(express.urlencoded({ extended: false }));
  router.use(express.json());

  // Control routes for the demo, outside the Roqqu API surface.
  router.get("/control", (_req, res) => res.json({ outage: state.outage, usdtBalance }));
  router.post("/control/outage", (req, res) => {
    state.outage = Boolean(req.body?.on);
    res.json({ outage: state.outage });
  });

  // Hosted payment page, standing in for payment.roqqu.com/<refid>.
  router.get("/pay/:refid", (req, res) => {
    const link = links.get(req.params.refid);
    if (!link) return res.status(404).send("Unknown payment link");
    res.type("html").send(payPage(link));
  });

  router.post("/pay/:refid", async (req, res) => {
    if (state.outage) return res.status(503).send("Roqqu is unavailable. Try again shortly.");
    const link = links.get(req.params.refid);
    if (!link || link.paid) return res.status(400).send("This link is no longer payable");
    const factor = { exact: 1, under: 0.5, over: 1.2 }[req.body.outcome] ?? 1;
    const usdt = Math.round((link.amount / link.rate) * factor * 1e6) / 1e6;
    const required = Math.round((link.amount / link.rate) * 1e6) / 1e6;
    const hash = txHash();
    const address = "0x" + crypto.randomBytes(20).toString("hex");
    deposits.set(hash, { ref: id(), status: 1, value: usdt, network: "bep20", token: "usdt", address, tx_hash: hash, created_at: new Date().toISOString() });
    usdtBalance += usdt;
    link.paid = true;

    const event_type = factor < 1 ? "payment_link_failed" : factor > 1 ? "payment_link_completed_overpaid" : "payment_link_completed";
    const event = {
      event_id: id(),
      event_type,
      meta_data: {
        payment_link_refid: link.refid,
        payment_reference: link.payment_reference,
        amount_required: link.amount,
        amount_currency: "ngn",
        amount_received: String(usdt),
        amount_received_usd: usdt,
        overpaid_amount: String(Math.max(0, usdt - required)),
        overpaid_amount_usd: Math.max(0, usdt - required),
        underpaid_amount: String(Math.max(0, required - usdt)),
        underpaid_amount_usd: Math.max(0, required - usdt),
        token: "USDT",
        value: String(usdt),
        hash,
        status: factor < 1 ? "failed" : "completed",
        customer: link.customer,
        address,
        network: "bep20",
        metadata: link.metadata,
      },
      datetime: new Date().toISOString(),
    };
    // Encrypted exactly as the docs describe: aes-256-ctr, key = first 32 chars of the API key, IV in the x-api-key header.
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-ctr", Buffer.from(key.substring(0, 32)), iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(event)), cipher.final()]).toString("hex");
    setTimeout(() => {
      fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": iv.toString("hex") }, body: JSON.stringify({ hash: body }) })
        .catch((e) => console.error("sim webhook", e.message));
    }, 1500);
    res.redirect(303, link.success_url);
  });

  // ---- Roqqu API surface (v1) ----
  const api = express.Router();
  api.use((req, res, next) => {
    if (state.outage) return fail(res, 503, "service temporarily unavailable");
    if (req.path === "/rates" || req.path === "/payment-links/supported-networks") return next();
    const k = req.get("x-staging-api-key") || req.get("x-api-key");
    if (k !== key) return fail(res, 401, "Invalid API Key");
    next();
  });

  api.get("/rates", async (_req, res) => {
    res.json({ status: "success", message: "all rates retrieved successfully", data: [{ symbol: "ngn", title: "Nigerian Naira", rate: await ngnRate() }, { symbol: "usd", title: "United States Dollar", rate: 1 }] });
  });

  api.post("/balances", (_req, res) => {
    res.json({ status: "success", message: "balance retrieved successfully", data: { balance: { usdt: Math.round(usdtBalance * 1e6) / 1e6 } } });
  });

  api.post("/payment-links", async (req, res) => {
    const b = req.body;
    if (!(Number(b.amount) > 0)) return fail(res, 400, "amount must be greater than 0");
    if (!/^[A-Za-z0-9]{1,20}$/.test(b.payment_reference || "")) return fail(res, 400, "invalid payment_reference");
    if (!/^https?:\/\//.test(b.success_url || "")) return fail(res, 400, "success_url must be a valid url");
    const refid = id();
    const link = {
      refid,
      payment_reference: b.payment_reference,
      amount: Number(b.amount),
      rate: await ngnRate(),
      customer: JSON.parse(b.customer_details || "{}"),
      metadata: JSON.parse(b.metadata || "{}"),
      success_url: b.success_url,
      cancel_url: b.cancel_url,
      expires_at: b.expires_at || new Date(Date.now() + 2 * 3600e3).toISOString(),
      paid: false,
    };
    links.set(refid, link);
    res.json({
      status: "success",
      message: "payment link generated successfully",
      data: { refid, payment_reference: link.payment_reference, payment_link: `${publicUrl}/sim/roqqu/pay/${refid}`, wallets: [], wallet_pre_generated: 0, amount_required: link.amount, amount_currency: "ngn", expires_at: link.expires_at },
    });
  });

  api.get("/transaction/deposit/:hash", (req, res) => {
    const d = deposits.get(req.params.hash);
    if (!d) return fail(res, 404, "tx_hash details not found");
    res.json({ status: "success", message: `transaction retrieved for tx_hash: ${d.tx_hash}`, data: d });
  });

  api.post("/wallets/send", (req, res) => {
    const amount = Number(req.body.amount);
    if (!(amount > 0)) return fail(res, 400, "amount must be greater than 0");
    if (req.body.token !== "usdc" || req.body.network !== "base") return fail(res, 400, "network not available for token");
    if (!/^0x[0-9a-fA-F]{40}$/.test(req.body.to || "")) return fail(res, 400, "invalid network parsed for address");
    if (amount > usdtBalance + 1e-9) return fail(res, 400, "insufficient USDC balance");
    usdtBalance -= amount;
    const refid = id();
    sends.set(refid, { refid, status: 1, value: amount, _to: req.body.to, token: "usdc", network: "base", tx_hash: txHash(), created_at: new Date().toISOString() });
    res.json({ status: "success", message: "send operation successful", data: { refid } });
  });

  api.get("/transaction/refId/:refid", (req, res) => {
    const s = sends.get(req.params.refid);
    if (!s) return fail(res, 404, "refid details not found");
    res.json({ status: "success", message: "transaction retrieved", data: s });
  });

  router.use("/v1", api);
  // The simulator keeps one dollar balance: USDT in, USDC out, as Roqqu would after a swap.
  // Funding that happened before this server started (seeded history) sits in the balance too.
  return { router, state, seedBalance: (usd) => (usdtBalance += usd) };
}

function payPage(link) {
  const naira = `₦${Math.round(link.amount).toLocaleString("en-NG")}`;
  const usdt = (link.amount / link.rate).toFixed(2);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Roqqu payment (simulated)</title>
<style>body{font:15px/1.5 system-ui,sans-serif;background:#f4f5fb;color:#141533;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
main{background:#fff;border-radius:16px;padding:28px;max-width:400px;width:100%;box-shadow:0 8px 30px #0001}
.sim{background:#fff4d6;color:#7a5600;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:16px}
h1{font-size:28px;margin:0}p{color:#555}button{width:100%;padding:12px;border-radius:10px;border:1px solid #ccd;background:#fff;font:inherit;margin-top:8px;cursor:pointer}
button.main{background:#1a3cff;color:#fff;border-color:#1a3cff}</style></head><body><main>
<div class="sim">Simulated Roqqu checkout. Same flow and webhook format as Roqqu payment links; no real money moves.</div>
<p>Pay instalment <b>${link.payment_reference}</b></p><h1>${naira}</h1><p>≈ ${usdt} USDT on BNB Smart Chain (BEP20)</p>
<form method="post"><button class="main" name="outcome" value="exact">Pay ${usdt} USDT</button>
<button name="outcome" value="under">Send only half (underpay)</button>
<button name="outcome" value="over">Send 20% extra (overpay)</button></form>
<p><a href="${link.cancel_url}">Cancel</a></p></main></body></html>`;
}
