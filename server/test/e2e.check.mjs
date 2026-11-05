// Full flow against a running Fledge server and an anvil chain (time is moved with evm_increaseTime).
const B = process.env.FLEDGE_URL || "http://127.0.0.1:8790";
const RPC = process.env.RPC_URL || "https://sepolia.base.org";
const j = async (path, body) => {
  const r = await fetch(B + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const t = await r.json();
  if (!r.ok) throw new Error(`${path}: ${t.error}`);
  return t;
};
const rpc = (method, params = []) => fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((r) => r.json());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pay = (url, outcome) => fetch(url.replace("localhost", "127.0.0.1"), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "outcome=" + outcome, redirect: "manual" });
const show = (label, p) => console.log(label.padEnd(34), `funded ${p.funded} | due ${p.dueByNow} | arrears ${p.arrears} | held ${p.held} | payable ${p.payable} | paid ${p.paidOut} | outstanding ${p.outstanding} | ${p.status}`);

for (let i = 0; i < 20 && !(await j("/api/config")).configured; i++) await wait(1000);
const { id } = await j("/api/demo/scenario", { dueInMinutes: 2 });
show(`scenario #${id}`, await j(`/api/promises/${id}`));

let link = await j(`/api/promises/${id}/link`, {});
console.log("instalment link".padEnd(34), `₦${link.amountNgn} ref ${link.reference}`);
await pay(link.link, "exact");
await wait(6000);
show("after exact Roqqu payment", await j(`/api/promises/${id}`));

link = await j(`/api/promises/${id}/link`, {});
await pay(link.link, "under");
await wait(4000);
let p = await j(`/api/promises/${id}`);
console.log("after underpayment".padEnd(34), p.roqquEvents[0].type, "|", p.roqquEvents[0].note, "| funded", p.funded);

await j("/api/sim/outage", { on: true });
try { await j(`/api/promises/${id}/link`, {}); console.log("outage: link created (UNEXPECTED)"); } catch (e) { console.log("during outage".padEnd(34), e.message); }
await j("/api/sim/outage", { on: false });

await j(`/api/promises/${id}/act`, { role: "oga", action: "proposeResolution", args: { kind: "Reduce", reduceBy: 800, note: "Business is slow" } });
await j(`/api/promises/${id}/act`, { role: "union", action: "approveResolution" });
await j(`/api/promises/${id}/act`, { role: "uncle", action: "approveResolution" });
p = await j(`/api/promises/${id}`);
console.log("Oga cuts promise, 2 witnesses ok".padEnd(34), `promised still ${p.promised}, resolution open: ${p.resolution.open}, apprentice consent: ${p.resolution.apprenticeConsent}`);

try { await j(`/api/promises/${id}/act`, { role: "union", action: "proposeResolution", args: { kind: "Settle", payNow: p.held, newEnd: Math.floor(Date.now() / 1000) + 3e7, note: "too early" } }); } catch (e) { console.log("settle before the date".padEnd(34), e.message.slice(0, 80)); }

// On anvil, move time; on a public testnet, wait for the settlement date to pass.
const anvil = (await rpc("web3_clientVersion")).result?.toLowerCase().includes("anvil");
let skew = 0;
if (anvil) {
  await rpc("evm_increaseTime", [600]);
  await rpc("evm_mine");
  skew = 600;
} else {
  const end = (await j(`/api/promises/${id}`)).end;
  while (Math.floor(Date.now() / 1000) < end + 10) await wait(5000);
}
const newEnd = Math.floor(Date.now() / 1000) + skew + 365 * 86400;
await j(`/api/promises/${id}/act`, { role: "union", action: "proposeResolution", args: { kind: "Settle", payNow: p.held, newEnd, note: "Pay what is held now, the rest within 12 months" } });
await j(`/api/promises/${id}/act`, { role: "pastor", action: "approveResolution" });
show("witnesses agree, no consent yet", await j(`/api/promises/${id}`));
await j(`/api/promises/${id}/act`, { role: "apprentice", action: "consentResolution" });
show("apprentice consents", await j(`/api/promises/${id}`));
const out = await j(`/api/promises/${id}/payout`, {});
console.log("payout".padEnd(34), out.ref, out.amount);
p = await j(`/api/promises/${id}`);
show("after payout", p);
console.log("events:", p.events.map((e) => e.event).join(", "));
