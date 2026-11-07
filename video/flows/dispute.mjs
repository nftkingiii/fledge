// Runs one dispute on the live Fledge app and saves phone stills of each real state:
// raised (promise frozen), answered and one witness ruling, decided as restitution, and the record.
// node flows/dispute.mjs [--url=https://fledge.up.railway.app]
import { chromium } from "playwright";
import { mkdirSync, appendFileSync } from "node:fs";

const URL = (process.argv.find((a) => a.startsWith("--url=")) || "--url=https://fledge.up.railway.app").slice(6);
const OUT = "assets/stills";
mkdirSync(OUT, { recursive: true });
const note = (m) => { console.log(m); appendFileSync(`${OUT}/dispute-log.txt`, `${new Date().toISOString()} ${m}\n`); };
const api = async (path, body) => {
  const r = await fetch(URL + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const t = await r.json();
  if (!r.ok) throw new Error(`${path}: ${t.error}`);
  return t;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const { id } = await api("/api/demo/scenario", { dueInMinutes: 90, trade: "Auto spare parts, Nnewi" });
note(`promise ${id} created`);
const rate = (await api("/api/config")).ngnPerUsd;

await api(`/api/promises/${id}/act`, { role: "oga", action: "raiseDispute", args: { grounds: "Theft", claim: 300, evidence: "Market union statement and shop ledger, 4 Nov 2026 (demo)" } });
note(`dispute raised: theft, claim $300 (₦${300 * rate})`);
try {
  await api(`/api/promises/${id}/act`, { role: "apprentice", action: "proposeResolution", args: { kind: "EarlyExit", payNow: 1125, refund: 0, note: "I am leaving" } });
  note("UNEXPECTED: apprentice could raise an early exit during the dispute");
} catch (e) { note(`apprentice early exit during dispute refused: ${e.message}`); }
try {
  await api(`/api/promises/${id}/act`, { role: "union", action: "voteDispute", args: { ruling: "Restitution" } });
  note("UNEXPECTED: witness voted before the answer");
} catch (e) { note(`vote before the answer refused: ${e.message}`); }

const browser = await chromium.launch({ channel: "msedge" }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "light", isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "networkidle" });
async function view(role, name, tab, shot, selector) {
  await page.evaluate(([r, n]) => { localStorage.setItem("fledge.session", JSON.stringify({ role: r, name: n })); localStorage.setItem("fledge.unit", "ngn"); }, [role, name]);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".tabbar", { timeout: 90_000 });
  await page.locator(".tabbar button", { hasText: tab }).click();
  await page.waitForSelector(selector || ".pane", { timeout: 90_000 });
  await wait(1500);
  if (selector) { await page.locator(selector).first().scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -80)); await wait(400); }
  await page.screenshot({ path: `${OUT}/${shot}.png` });
  note(`shot ${shot}`);
}

await view("union", "Market union", "Settle", "20-dispute-open", ".dispute");
await api(`/api/promises/${id}/act`, { role: "apprentice", action: "answerDispute", args: { answer: "I did not take the goods; the driver delivered short (demo)" } });
note("apprentice answered");
await api(`/api/promises/${id}/act`, { role: "union", action: "voteDispute", args: { ruling: "Restitution" } });
note("union voted restitution");
await view("uncle", "Uncle Emeka", "Settle", "21-dispute-vote", ".dispute");
await api(`/api/promises/${id}/act`, { role: "uncle", action: "voteDispute", args: { ruling: "Restitution" } });
note("uncle voted restitution");
const p = await api(`/api/promises/${id}`);
note(`decided: ruling ${p.dispute.ruling}, refundable to Oga $${p.refundable}, promised now $${p.promised}, held $${p.held}, upheld against apprentice ${p.apprenticeRecord.disputesUpheld}`);
const decided = p.events.find((e) => e.event === "DisputeDecided");
note(`DisputeDecided tx ${decided?.tx}`);
await view("oga", "Chief Okafor", "Settle", "22-dispute-decided");
await view("oga", "Chief Okafor", "Record", "23-dispute-record", ".stats");
await browser.close();
note(`done, promise ${id}`);
