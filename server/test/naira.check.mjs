// Naira in and out against a running Fledge server on a public testnet:
// bank transfer credited at Roqqu's rate, underpayment refused, forged webhook rejected,
// then on settlement day a payout to a bank account recorded on chain.
const B = process.env.FLEDGE_URL || "http://127.0.0.1:8790";
const j = async (path, body) => {
  const r = await fetch(B + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const t = await r.json();
  if (!r.ok) throw new Error(`${path}: ${t.error}`);
  return t;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (url, outcome) => fetch(url.replace("localhost", "127.0.0.1"), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "outcome=" + outcome, redirect: "manual" });

for (let i = 0; i < 30 && !(await j("/api/config").catch(() => ({}))).configured; i++) await wait(1000);
const { id } = await j("/api/demo/scenario", { dueInMinutes: 2, trade: "Phones and accessories, Onitsha" });
let p = await j(`/api/promises/${id}`);
console.log(`promise #${id}`.padEnd(30), `funded $${p.funded} | held $${p.held}`);

let t = await j(`/api/promises/${id}/naira-link`, {});
console.log("transfer instructions".padEnd(30), `₦${t.amountNgn} to ${t.bankName} ${t.accountNumber}, narration ${t.reference}, rate ${t.rate}`);
await send(t.link, "exact");
await wait(8000);
p = await j(`/api/promises/${id}`);
const c = p.events.filter((e) => e.event === "Credited").pop();
console.log("after naira transfer".padEnd(30), `funded $${p.funded} | on-chain ref ${c.args.roqquRef}`);

t = await j(`/api/promises/${id}/naira-link`, {});
await send(t.link, "under");
await wait(4000);
p = await j(`/api/promises/${id}`);
console.log("after half transfer".padEnd(30), p.roqquEvents[0].type, "|", p.roqquEvents[0].note, "| funded", p.funded);

const forged = await fetch(B + "/webhooks/naira", { method: "POST", headers: { "content-type": "application/json", "x-signature": "0".repeat(64) }, body: JSON.stringify({ event: "collection.successful", data: { metadata: { promiseId: id }, reference: "FAKE123456" } }) });
console.log("forged webhook".padEnd(30), forged.status);

const end = p.end;
while (Math.floor(Date.now() / 1000) < end + 10) await wait(5000);
await j(`/api/promises/${id}/act`, { role: "union", action: "proposeResolution", args: { kind: "Settle", payNow: p.held, newEnd: Math.floor(Date.now() / 1000) + 365 * 86400, note: "Pay what is held now, the rest within 12 months" } });
await j(`/api/promises/${id}/act`, { role: "pastor", action: "approveResolution" });
await j(`/api/promises/${id}/act`, { role: "apprentice", action: "consentResolution" });
p = await j(`/api/promises/${id}`);
console.log("resolution applied".padEnd(30), `payable $${p.payable}`);

const banks = await j("/api/banks");
const gtb = banks.find((b) => b.name.startsWith("Guaranty"));
try {
  await j("/api/resolve-account", { bankCode: gtb.code, accountNumber: "12345" });
} catch (e) {
  console.log("bad account number".padEnd(30), e.message);
}
const who = await j("/api/resolve-account", { bankCode: gtb.code, accountNumber: "0123456789" });
const out = await j(`/api/promises/${id}/payout`, { method: "bank", bankCode: gtb.code, accountNumber: "0123456789" });
console.log("bank payout".padEnd(30), `₦${out.amountNgn} to ${who.accountName} at ${gtb.name} | ref ${out.ref} | tx ${out.hash}`);
p = await j(`/api/promises/${id}`);
console.log("after payout".padEnd(30), `paid $${p.paidOut} | payable $${p.payable} | outstanding $${p.outstanding}`);
