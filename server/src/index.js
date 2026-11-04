import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as roqqu from "./roqqu.js";
import * as chain from "./chain.js";

const app = express();
const PORT = Number(process.env.PORT || 8787);
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const DEMO = Boolean(Object.keys(chain.demoRoles).length);

// Roqqu is "live" only after a real authenticated call succeeds; anything else is shown as demo.
const roqquState = { live: false, mode: process.env.ROQQU_MODE || "test", reason: "not checked yet", checkedAt: null };
async function checkRoqqu() {
  try {
    await roqqu.balances();
    Object.assign(roqquState, { live: true, reason: "balance check passed" });
  } catch (e) {
    Object.assign(roqquState, { live: false, reason: e.message });
  }
  roqquState.checkedAt = new Date().toISOString();
}

// Unmatched Roqqu events (failed or underpaid links) are kept for the funding view.
const roqquEvents = [];

app.use("/webhooks", express.json({ limit: "64kb" }));
app.use("/api", express.json({ limit: "16kb" }));

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    const msg = e.shortMessage || e.message || String(e);
    console.error(req.method, req.path, msg);
    res.status(400).json({ error: msg });
  });

app.get("/api/config", wrap(async (_req, res) => {
  let ngnPerUsd = null;
  try {
    ngnPerUsd = await roqqu.ngnPerUsd();
  } catch {}
  res.json({
    chainId: 97,
    explorer: "https://testnet.bscscan.com",
    contract: chain.contractAddress() || null,
    operator: chain.operator?.address || null,
    configured: chain.configured(),
    demo: DEMO,
    roles: Object.fromEntries(Object.entries(chain.demoRoles).map(([k, a]) => [k, a.address])),
    roqqu: { ...roqquState },
    ngnPerUsd,
  });
}));

app.get("/api/promises", wrap(async (_req, res) => {
  const n = await chain.count();
  const list = [];
  for (let id = n; id >= 1 && list.length < 25; id--) list.push(await chain.readPromise(id));
  res.json(list.filter(Boolean));
}));

app.get("/api/promises/:id", wrap(async (req, res) => {
  const p = await chain.readPromise(Number(req.params.id));
  if (!p) return res.status(404).json({ error: "No such promise" });
  const events = await chain.timeline(p.id);
  res.json({ ...p, events, roqquEvents: roqquEvents.filter((e) => e.promiseId === p.id) });
}));

// ---- funding through Roqqu ----

app.post("/api/promises/:id/link", wrap(async (req, res) => {
  const id = Number(req.params.id);
  const p = await chain.readPromise(id);
  if (!p || p.status !== "Active") throw new Error("Promise is not active");
  const rate = await roqqu.ngnPerUsd();
  const instalmentUsd = req.body?.amountUsd ? Number(req.body.amountUsd) : p.original / p.instalments;
  if (!(instalmentUsd > 0)) throw new Error("Amount must be positive");
  const amountNgn = Math.round(instalmentUsd * rate);
  if (!roqquState.live) {
    return res.json({ demo: true, amountNgn, amountUsd: instalmentUsd, reason: roqquState.reason });
  }
  const reference = roqqu.instalmentReference(id);
  const link = await roqqu.createInstalmentLink({
    amountNgn,
    reference,
    promiseId: id,
    oga: { email: req.body?.email || "oga@nkwa.app", firstName: "Oga", lastName: `Promise${id}` },
    successUrl: `${PUBLIC_URL}/?promise=${id}&paid=1`,
    cancelUrl: `${PUBLIC_URL}/?promise=${id}`,
    expiresAt: new Date(Date.now() + 24 * 3600e3).toISOString(),
  });
  res.json({ demo: false, amountNgn, amountUsd: instalmentUsd, reference, link: link.payment_link, refid: link.refid });
}));

// Demo only: stands in for a Roqqu payment when no working key is configured.
app.post("/api/promises/:id/demo-pay", wrap(async (req, res) => {
  if (!DEMO) throw new Error("Demo mode is off");
  if (roqquState.live) throw new Error("Roqqu is live; pay through the Roqqu link");
  const id = Number(req.params.id);
  const amountUsd = Number(req.body?.amountUsd);
  if (!(amountUsd > 0 && amountUsd <= 5_000)) throw new Error("Amount out of range");
  const ref = `DEMO-${Date.now()}`;
  const { hash } = await chain.asOperator("credit", [BigInt(id), chain.toMicro(amountUsd), ref]);
  res.json({ hash, ref });
}));

app.post("/webhooks/roqqu", wrap(async (req, res) => {
  const event = roqqu.decryptWebhook(req.body?.hash, req.get("x-api-key"));
  // Acknowledge quickly; an undecryptable body is not from Roqqu.
  if (!event) return res.status(401).json({ error: "Could not decrypt" });
  res.json({ ok: true });
  handleRoqquEvent(event).catch((e) => console.error("webhook", event.event_type, e.message));
}));

async function handleRoqquEvent(event) {
  const m = event.meta_data || {};
  const promiseId = Number(m.metadata?.promiseId ?? String(m.payment_reference || "").match(/^NKWA(\d+)P/)?.[1]);
  if (!promiseId) return;
  const entry = { promiseId, type: event.event_type, reference: m.payment_reference, hash: m.hash, at: event.datetime };
  roqquEvents.unshift(entry);
  if (roqquEvents.length > 200) roqquEvents.pop();

  if (event.event_type !== "payment_link_completed" && event.event_type !== "payment_link_completed_overpaid") return;

  // Do not trust the webhook alone: Roqqu must also know the deposit by its hash.
  const deposit = await roqqu.depositByHash(m.hash);
  if (Number(deposit.status) !== 1 || deposit.address?.toLowerCase() !== String(m.address).toLowerCase()) {
    entry.note = "deposit not confirmed by Roqqu";
    return;
  }
  const usdValue = String(m.token).toUpperCase() === "USDT" ? Number(m.value) : Number(m.amount_received_usd);
  const { hash } = await chain.asOperator("credit", [BigInt(promiseId), chain.toMicro(usdValue), `roqqu:${m.payment_link_refid}`]);
  entry.creditTx = hash;
}

// ---- payouts through Roqqu ----

app.post("/api/promises/:id/payout", wrap(async (req, res) => {
  const id = Number(req.params.id);
  const p = await chain.readPromise(id);
  if (!p || !(p.payable > 0)) throw new Error("Nothing is payable on this promise");
  let ref;
  if (roqquState.live) {
    const sent = await roqqu.sendUsdt({ amount: p.payable, to: req.body?.to || p.apprentice });
    ref = `roqqu-send:${sent.refid}`;
  } else {
    if (!DEMO) throw new Error("Roqqu is not live");
    ref = `DEMO-SEND-${Date.now()}`;
  }
  const { hash } = await chain.asOperator("markPaid", [BigInt(id), chain.toMicro(p.payable), ref]);
  res.json({ hash, ref, amount: p.payable, demo: !roqquState.live });
}));

// ---- demo signers for the Oga, apprentice and witnesses ----

const ROLE_ACTIONS = {
  oga: ["proposeResolution"],
  apprentice: ["proposeResolution", "consentResolution"],
  union: ["proposeResolution", "approveResolution", "attestService"],
  uncle: ["proposeResolution", "approveResolution", "attestService"],
  pastor: ["proposeResolution", "approveResolution", "attestService"],
};

app.post("/api/promises/:id/act", wrap(async (req, res) => {
  if (!DEMO) throw new Error("Demo mode is off");
  const id = BigInt(req.params.id);
  const { role, action, args = {} } = req.body || {};
  if (!ROLE_ACTIONS[role]?.includes(action)) throw new Error(`${role} cannot ${action} here`);
  let callArgs = [id];
  if (action === "proposeResolution") {
    const kind = chain.KINDS.indexOf(args.kind);
    if (kind < 0) throw new Error("Unknown resolution kind");
    callArgs = [
      id,
      kind,
      chain.toMicro(args.payNow || 0),
      chain.toMicro(args.inKindValue || 0),
      chain.toMicro(args.refund || 0),
      chain.toMicro(args.reduceBy || 0),
      BigInt(args.newEnd || 0),
      String(args.note || "").slice(0, 140),
    ];
  } else if (action === "attestService") {
    callArgs = [id, Number(args.year || 1)];
  }
  const { hash } = await chain.asRole(role, action, callArgs);
  res.json({ hash });
}));

// A promise that started years ago and comes due in a few minutes, so the
// settlement-day flow can be shown live. Its earlier funding is marked SEED.
app.post("/api/demo/scenario", wrap(async (req, res) => {
  if (!DEMO) throw new Error("Demo mode is off");
  const r = chain.demoRoles;
  const now = Math.floor(Date.now() / 1000);
  const minutes = Math.min(Math.max(Number(req.body?.dueInMinutes || 10), 2), 120);
  const end = now + minutes * 60;
  const start = end - 4 * 365 * 24 * 3600;
  const promisedUsd = 2_000;
  const { receipt } = await chain.asRole("oga", "propose", [
    r.apprentice.address,
    [r.union.address, r.uncle.address, r.pastor.address],
    2,
    chain.toMicro(promisedUsd),
    BigInt(start),
    BigInt(end),
    16,
    String(req.body?.trade || "Auto spare parts, Nnewi").slice(0, 60),
  ]);
  const id = Number(receipt.logs[0].topics[1]);
  await chain.asRole("apprentice", "accept", [BigInt(id)]);
  // Nine of fifteen quarters already paid in: arrears are visible from the start.
  await chain.asOperator("credit", [BigInt(id), chain.toMicro(1_125), `SEED-history-${id}`]);
  res.json({ id });
}));

// ---- static frontend ----
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
app.use(express.static(web));
app.get(/^\/(?!api|webhooks).*/, (_req, res) => res.sendFile(path.join(web, "index.html")));

checkRoqqu().finally(() => {
  app.listen(PORT, () => {
    console.log(`Nkwa on ${PUBLIC_URL} | contract ${chain.contractAddress() || "not set"} | Roqqu ${roqquState.live ? "live" : "demo"}: ${roqquState.reason}`);
  });
});
setInterval(checkRoqqu, 10 * 60_000).unref();
