import crypto from "node:crypto";

// The simulator sets ROQQU_BASE to its own address; everything else is unchanged.
const base = () => process.env.ROQQU_BASE || "https://service.roqqu.com/v1";

// Test mode and live mode use different header names for the same key slot.
function authHeaders() {
  const key = process.env.ROQQU_API_KEY;
  if (!key) throw new Error("ROQQU_API_KEY is not set");
  return process.env.ROQQU_MODE === "live" ? { "x-api-key": key } : { "x-staging-api-key": key };
}

async function call(method, path, { body, auth = true } = {}) {
  const headers = auth ? authHeaders() : {};
  let payload;
  if (body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(
      Object.entries(body).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])
    ).toString();
  }
  const res = await fetch(base() + path, { method, headers, body: payload, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Roqqu ${method} ${path} returned non-JSON (${res.status})`);
  }
  if (json.status !== "success") throw new Error(`Roqqu ${method} ${path}: ${json.message || res.status}`);
  return json.data;
}

// Roqqu updates rates every minute; a short cache keeps pages fast.
let rateCache = { value: null, at: 0 };

/** Naira per US dollar, from Roqqu's public rates feed. */
export async function ngnPerUsd() {
  if (rateCache.value && Date.now() - rateCache.at < 60_000) return rateCache.value;
  const rates = await call("GET", "/rates", { auth: false });
  const ngn = rates.find((r) => r.symbol === "ngn");
  if (!ngn) throw new Error("Roqqu rates have no NGN entry");
  rateCache = { value: Number(ngn.rate), at: Date.now() };
  return rateCache.value;
}

export function balances() {
  return call("POST", "/balances", { body: { token: "usdt" } });
}

/** One payment link per instalment, priced in naira; the Oga pays in USDT. */
export function createInstalmentLink({ amountNgn, reference, oga, promiseId, successUrl, cancelUrl, expiresAt }) {
  return call("POST", "/payment-links", {
    body: {
      amount: String(amountNgn),
      amount_currency: "ngn",
      payment_reference: reference,
      customer_details: { email: oga.email, first_name: oga.firstName, last_name: oga.lastName },
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { promiseId: String(promiseId) },
      ...(expiresAt ? { expires_at: expiresAt } : {}),
    },
  });
}

export function depositByHash(hash) {
  return call("GET", `/transaction/deposit/${encodeURIComponent(hash)}`);
}

/** Payouts go out as USDC on Base, where the promise record lives. */
export function sendPayout({ amount, to }) {
  return call("POST", "/wallets/send", { body: { amount: String(amount), network: "base", token: "usdc", to } });
}

export function sendRecord(refid) {
  return call("GET", `/transaction/refId/${encodeURIComponent(refid)}`);
}

/**
 * Roqqu encrypts webhook bodies with aes-256-ctr: the key is the first 32
 * characters of the API key and the IV arrives hex-encoded in the x-api-key header.
 * Returns null when the body does not decrypt to JSON, which is how a forged
 * webhook without the key shows up.
 */
export function decryptWebhook(hashHex, ivHex) {
  const key = process.env.ROQQU_API_KEY;
  if (!key || typeof hashHex !== "string" || typeof ivHex !== "string") return null;
  if (!/^[0-9a-f]+$/i.test(hashHex) || !/^[0-9a-f]{32}$/i.test(ivHex)) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-ctr", Buffer.from(key.substring(0, 32)), Buffer.from(ivHex, "hex"));
    const plain = Buffer.concat([decipher.update(Buffer.from(hashHex, "hex")), decipher.final()]).toString("utf8");
    return JSON.parse(plain);
  } catch {
    return null;
  }
}

/** Payment references must be 1-20 letters and numbers. */
export function instalmentReference(promiseId) {
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `NKWA${promiseId}P${rand}`.slice(0, 20);
}
