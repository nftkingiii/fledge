import express from "express";
import crypto from "node:crypto";
// Exercises the simulator through the real Roqqu client: links, encrypted webhooks, deposit checks, sends.
const { createRoqquSim } = await import("../src/roqqu-sim.js");
const key = crypto.randomBytes(32).toString("hex");
process.env.ROQQU_API_KEY = key; process.env.ROQQU_MODE = "simulated";
process.env.ROQQU_BASE = "http://127.0.0.1:8799/sim/roqqu/v1";
const roqqu = await import("../src/roqqu.js");
const app = express();
const sim = createRoqquSim({ key, publicUrl: "http://127.0.0.1:8799", webhookUrl: "http://127.0.0.1:8799/hook" });
app.use("/sim/roqqu", sim.router);
const got = [];
app.post("/hook", express.json(), (req, res) => { got.push(roqqu.decryptWebhook(req.body.hash, req.get("x-api-key"))); res.json({ ok: 1 }); });
const srv = app.listen(8799);
const ref = roqqu.instalmentReference(7);
const link = await roqqu.createInstalmentLink({ amountNgn: 171875, reference: ref, promiseId: 7, oga: { email: "a@b.c", firstName: "O", lastName: "G" }, successUrl: "http://127.0.0.1:8799/ok", cancelUrl: "http://127.0.0.1:8799/no" });
console.log("link:", link.payment_link.replace(/\d{6,}/, "<refid>"), "ref:", ref);
for (const outcome of ["under", "exact"]) {
  const l = outcome === "exact" ? link : await roqqu.createInstalmentLink({ amountNgn: 171875, reference: roqqu.instalmentReference(7), promiseId: 7, oga: { email: "a@b.c", firstName: "O", lastName: "G" }, successUrl: "http://127.0.0.1:8799/ok", cancelUrl: "http://127.0.0.1:8799/no" });
  await fetch(l.payment_link, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "outcome=" + outcome, redirect: "manual" });
}
await new Promise((r) => setTimeout(r, 2500));
for (const e of got) {
  const m = e.meta_data;
  const dep = await roqqu.depositByHash(m.hash);
  console.log(e.event_type, "| promise", m.metadata.promiseId, "| value", m.value, "USDT | deposit status", dep.status, "| address match", dep.address === m.address);
}
console.log("forged body decrypts to:", roqqu.decryptWebhook("deadbeef", "00".repeat(16)));
const sent = await roqqu.sendUsdt({ amount: 100, to: "0x" + "1".repeat(40) });
console.log("send refid ok:", Boolean(sent.refid), "| record:", (await roqqu.sendRecord(sent.refid)).value);
try { await roqqu.sendUsdt({ amount: 1e6, to: "0x" + "1".repeat(40) }); } catch (e) { console.log("overdraw ->", e.message); }
srv.close();
