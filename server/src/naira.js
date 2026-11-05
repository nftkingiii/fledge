import crypto from "node:crypto";

// Client for the naira bank rail. In simulated mode NAIRA_BASE points at the local stand-in.
const base = () => process.env.NAIRA_BASE;

async function call(method, path, body) {
  const res = await fetch(base() + path, {
    method,
    headers: { Authorization: `Bearer ${process.env.NAIRA_KEY}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({}));
  if (json.status !== "success") throw new Error(`Naira rail ${method} ${path}: ${json.message || res.status}`);
  return json.data;
}

export const banks = () => call("GET", "/banks");
export const resolveAccount = (bank_code, account_number) => call("POST", "/accounts/resolve", { bank_code, account_number });
export const createCollection = (body) => call("POST", "/collections", body);
export const getCollection = (reference) => call("GET", `/collections/${encodeURIComponent(reference)}`);
export const transfer = (body) => call("POST", "/transfers", body);

export function reference(promiseId, kind) {
  return `FL${promiseId}${kind}${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}
