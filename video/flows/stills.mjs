// Drives the live Fledge app through one fresh demo promise and saves phone-sized stills of each real state.
// Actions go through the app's own API (the same calls its buttons make); every still is the real UI after reload.
// node flows/stills.mjs [--url=https://fledge.up.railway.app]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const URL = (process.argv.find((a) => a.startsWith("--url=")) || "--url=https://fledge.up.railway.app").slice(6);
const OUT = "assets/stills";
mkdirSync(OUT, { recursive: true });
const log = [];
const note = (m) => { console.log(m); log.push(`${new Date().toISOString()} ${m}`); };

const api = async (path, body) => {
  const r = await fetch(URL + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const t = await r.json();
  if (!r.ok) throw new Error(`${path}: ${t.error}`);
  return t;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: "msedge" }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "light", isMobile: true, hasTouch: true });
const page = await ctx.newPage();

async function as(role, name) {
  await page.evaluate(([r, n]) => { localStorage.setItem("fledge.session", JSON.stringify({ role: r, name: n })); localStorage.setItem("fledge.unit", "ngn"); }, [role, name]);
}
async function open(tab) {
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".tabbar", { timeout: 90_000 });
  await page.locator(".tabbar button", { hasText: tab }).click();
  await page.waitForSelector(".pane", { timeout: 60_000 });
  await wait(1500);
}
async function shot(name, full = false) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(300);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  note(`shot ${name}`);
}
async function scrollTo(sel) {
  await page.locator(sel).first().scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -90));
  await wait(400);
}

// 1. Sign-up
await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".auth");
await wait(800);
await shot("01-signup");
await page.fill('input[aria-label="Full name"]', "Chief Okafor");
await page.fill('input[aria-label="Phone number"]', "0803 000 0000");
await page.selectOption("select", "oga");
await page.fill('input[aria-label="Trade and market"]', "Auto spare parts, Nnewi");
await wait(300);
await shot("02-signup-filled");

// 2. A fresh promise that comes due in 5 minutes
const { id } = await api("/api/demo/scenario", { dueInMinutes: 5, trade: "Auto spare parts, Nnewi" });
note(`promise ${id} created`);
await as("oga", "Chief Okafor");
await open("Promise");
await shot("03-promise");
await open("Funding");
await shot("04-funding");

// 3. Pay one instalment with Roqqu
await page.locator(".action .btn.primary").click();
await page.waitForSelector(".linkbox", { timeout: 60_000 });
await wait(500);
await scrollTo(".action");
await page.screenshot({ path: `${OUT}/05-roqqu-link.png` }); note("shot 05-roqqu-link");
const href = await page.locator(".linkbox a").getAttribute("href");
const checkout = await ctx.newPage();
await checkout.goto(href, { waitUntil: "networkidle" });
await wait(500);
await checkout.screenshot({ path: `${OUT}/06-roqqu-checkout.png` }); note("shot 06-roqqu-checkout");
await checkout.locator('button[value="exact"]').click();
await checkout.close();
for (let i = 0; i < 30; i++) {
  const p = await api(`/api/promises/${id}`);
  if (p.funded > 1125) { note(`credited, funded ${p.funded}`); break; }
  await wait(3000);
}
await open("Funding");
await shot("07-funding-paid");
await scrollTo(".ledger");
await page.screenshot({ path: `${OUT}/08-history.png` }); note("shot 08-history");
await open("Promise");
await shot("09-promise-paid");

// 4. The Oga tries to cut the promise; two witnesses agree, the apprentice does not
await api(`/api/promises/${id}/act`, { role: "oga", action: "proposeResolution", args: { kind: "Reduce", reduceBy: 800, note: "Business is slow" } });
await api(`/api/promises/${id}/act`, { role: "union", action: "approveResolution" });
await api(`/api/promises/${id}/act`, { role: "uncle", action: "approveResolution" });
await as("apprentice", "Chidi");
await open("Settle");
await shot("10-cut-blocked");
await scrollTo(".resolution");
await page.screenshot({ path: `${OUT}/11-cut-blocked-detail.png` }); note("shot 11-cut-blocked-detail");
const pc = await api(`/api/promises/${id}`);
note(`after the Oga's cut: promised ${pc.promised}, open ${pc.resolution.open}, consent ${pc.resolution.apprenticeConsent}`);

// 5. Settlement day: the union raises a settlement, seals stamp in one by one
let p = await api(`/api/promises/${id}`);
while (Date.now() / 1000 < p.end + 10) await wait(5000);
await api(`/api/promises/${id}/act`, { role: "union", action: "proposeResolution", args: { kind: "Settle", payNow: p.held, newEnd: Math.floor(Date.now() / 1000) + 365 * 86400, note: "Pay what is held now, the rest within 12 months" } });
await open("Settle");
await shot("12-seal-1");
await api(`/api/promises/${id}/act`, { role: "pastor", action: "approveResolution" });
await open("Settle");
await shot("13-seal-2");
await api(`/api/promises/${id}/act`, { role: "apprentice", action: "consentResolution" });
await open("Settle");
await shot("14-payable");
await scrollTo(".payout");
await page.screenshot({ path: `${OUT}/15-payout-box.png` }); note("shot 15-payout-box");

// 6. Paid out through Roqqu
const out = await api(`/api/promises/${id}/payout`, { method: "usdc" });
note(`paid out ${out.amount} ref ${out.ref} tx ${out.hash}`);
await open("Record");
await shot("16-record");
await open("Promise");
await shot("17-promise-after");

// Desktop stills for the deck
await page.setViewportSize({ width: 390, height: 844 });
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
const d = await desk.newPage();
await d.goto(URL, { waitUntil: "networkidle" });
await d.evaluate(() => localStorage.clear());
await d.reload({ waitUntil: "networkidle" });
await d.waitForSelector(".auth"); await wait(800);
await d.screenshot({ path: `${OUT}/d01-signup.png` }); note("shot d01-signup");
await d.evaluate(() => { localStorage.setItem("fledge.session", JSON.stringify({ role: "apprentice", name: "Chidi" })); localStorage.setItem("fledge.unit", "ngn"); });
await d.reload({ waitUntil: "networkidle" });
await d.waitForSelector(".pane", { timeout: 90_000 }); await wait(2000);
await d.screenshot({ path: `${OUT}/d02-promise.png` }); note("shot d02-promise");
for (const [tab, name] of [["Funding", "d03-funding"], ["Settle", "d04-settle"], ["Record", "d05-record"]]) {
  await d.locator(".rail-item", { hasText: tab }).click(); await wait(2000);
  await d.mouse.move(800, 500); await wait(400);
  await d.screenshot({ path: `${OUT}/${name}.png` }); note(`shot ${name}`);
}

writeFileSync(`${OUT}/capture-log.txt`, log.join("\n") + "\n");
await browser.close();
note(`done, promise ${id}`);
