import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import * as roqqu from "./roqqu.js";
import * as chain from "./chain.js";
import { createRoqquSim } from "./roqqu-sim.js";

const app = express();
const PORT = Number(process.env.PORT || 8790);
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const INTERNAL_URL = `http://127.0.0.1:${PORT}`;
const DEMO = Boolean(Object.keys(chain.demoRoles).length);
const MODE = process.env.ROQQU_MODE || "simulated";

// Simulated mode: the Roqqu client talks HTTP to a local copy of the Roqqu API.
let sim = null;
if (MODE === "simulated") {
  process.env.ROQQU_API_KEY = crypto.randomBytes(32).toString("hex");
  process.env.ROQQU_BASE = `${INTERNAL_URL}/sim/roqqu/v1`;
  sim = createRoqquSim({ key: process.env.ROQQU_API_KEY, publicUrl: PUBLIC_URL, webhookUrl: `${INTERNAL_URL}/webhooks/roqqu` });
  app.use("/sim/roqqu", sim.router);
}

// "connected" only after an authenticated call to whichever Roqqu we point at succeeds.
const roqquState = { connected: false, mode: MODE, reason: "not checked yet", checkedAt: null };
async function checkRoqqu() {
  try {
    await roqqu.balances();
    Object.assign(roqquState, { connected: true, reason: "balance check passed" });
  } catch (e) {
    Object.assign(roqquState, { connected: false, reason: e.message });
  }
  roqquState.checkedAt = new Date().toISOString();
}

// Roqqu link events per promise, for the funding view (in memory; the credits themselves are on chain).
const roqquEvents = [];
// Confirmed payments that could not be credited yet, e.g. Roqqu or the RPC was down.
const retryQueue = [];

app.use("/webhooks", express.json({ limit: "64kb" }));
app.use("/api", express.json({ limit: "16kb" }));

// Plain-language reasons for the contract's refusals.
const REFUSALS = {
  NotOperator: "Only the Nkwa operator can do that.",
  NotParty: "This person is not allowed to do that on this promise.",
  NotWitness: "Only a named witness can do that.",
  BadState: "The promise is not in a state that allows this.",
  BadInput: "Those terms are not valid. Anything left unpaid needs a later due date.",
  RefReused: "That Roqqu reference was already recorded.",
  TooEarly: "Settlement can only be raised on or after the settlement date. Before it, only an early exit or a reduction.",
  ExceedsHeld: "That is more than the money actually held for this promise.",
  ExceedsOutstanding: "That is more than is still owed.",
  AlreadyApproved: "This witness has already approved this resolution.",
  NoOpenResolution: "There is no open resolution to act on.",
};

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    const errorName = e.walk?.((c) => c?.data?.errorName)?.data?.errorName;
    const msg = (errorName && `Refused by the contract: ${REFUSALS[errorName] || errorName}`) || e.shortMessage || e.message || String(e);
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
    roqqu: { ...roqquState, outage: sim?.state.outage || false, retrying: retryQueue.length },
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
  res.json({ amountNgn, amountUsd: instalmentUsd, reference, link: link.payment_link, refid: link.refid });
}));

// Demo control for the simulator: switch a Roqqu outage on or off.
app.post("/api/sim/outage", wrap(async (req, res) => {
  if (!sim) throw new Error("Not running the Roqqu simulator");
  sim.state.outage = Boolean(req.body?.on);
  res.json({ outage: sim.state.outage });
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

  if (event.event_type === "payment_link_failed") {
    entry.note = `Underpaid: not credited, ${m.underpaid_amount} USDT short. Roqqu marks the received amount refund-eligible.`;
    return;
  }
  if (event.event_type !== "payment_link_completed" && event.event_type !== "payment_link_completed_overpaid") return;
  if (event.event_type === "payment_link_completed_overpaid") entry.note = `Overpaid by ${m.overpaid_amount} USDT; the full amount is credited.`;
  await creditWithRetry({ entry, promiseId, m });
}

async function creditWithRetry(job) {
  try {
    await confirmAndCredit(job);
  } catch (e) {
    // Roqqu or the chain is unavailable: keep the job and try again; the ref keeps it from crediting twice.
    job.entry.note = `Waiting to credit: ${e.message}`;
    if (!retryQueue.includes(job)) retryQueue.push(job);
  }
}

async function confirmAndCredit({ entry, promiseId, m }) {
  // Do not trust the webhook alone: Roqqu must also know the deposit by its hash.
  const deposit = await roqqu.depositByHash(m.hash);
  if (Number(deposit.status) !== 1 || deposit.address?.toLowerCase() !== String(m.address).toLowerCase()) {
    entry.note = "Deposit not confirmed by Roqqu; not credited";
    return;
  }
  const usdValue = String(m.token).toUpperCase() === "USDT" ? Number(m.value) : Number(m.amount_received_usd);
  try {
    const { hash } = await chain.asOperator("credit", [BigInt(promiseId), chain.toMicro(usdValue), `roqqu:${m.payment_link_refid}`]);
    entry.creditTx = hash;
    entry.note = entry.note?.startsWith("Overpaid") ? entry.note : undefined;
  } catch (e) {
    if (/RefReused/.test(e.message)) entry.note = "Already credited";
    else throw e;
  }
}

setInterval(async () => {
  for (const job of [...retryQueue]) {
    try {
      await confirmAndCredit(job);
      retryQueue.splice(retryQueue.indexOf(job), 1);
    } catch (e) {
      job.entry.note = `Waiting to credit: ${e.message}`;
    }
  }
}, 15_000).unref();

// ---- payouts through Roqqu ----

app.post("/api/promises/:id/payout", wrap(async (req, res) => {
  const id = Number(req.params.id);
  const p = await chain.readPromise(id);
  if (!p || !(p.payable > 0)) throw new Error("Nothing is payable on this promise");
  // Only what an applied resolution made payable can be sent; Roqqu queues the send and returns a refid.
  const sent = await roqqu.sendUsdt({ amount: p.payable, to: req.body?.to || p.apprentice });
  const ref = `roqqu-send:${sent.refid}`;
  const { hash } = await chain.asOperator("markPaid", [BigInt(id), chain.toMicro(p.payable), ref]);
  res.json({ hash, ref, amount: p.payable });
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
  sim?.seedBalance(1_125);
  res.json({ id });
}));

// ---- static frontend ----
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
app.use(express.static(web));
app.get(/^\/(?!api|webhooks).*/, (_req, res) => res.sendFile(path.join(web, "index.html")));

// The simulator lives on this server, so check Roqqu only once we are listening.
app.listen(PORT, () => {
  checkRoqqu().finally(() => {
    console.log(`Nkwa on ${PUBLIC_URL} | contract ${chain.contractAddress() || "not set"} | Roqqu ${MODE} ${roqquState.connected ? "connected" : "unavailable"}: ${roqquState.reason}`);
  });
});
setInterval(checkRoqqu, 10 * 60_000).unref();
