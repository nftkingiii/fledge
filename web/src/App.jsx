import React, { useCallback, useEffect, useMemo, useState } from "react";

const api = async (path, body) => {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
};

const ROLES = [
  ["oga", "Oga"],
  ["apprentice", "Apprentice"],
  ["union", "Market union"],
  ["uncle", "Uncle"],
  ["pastor", "Pastor"],
];
const TABS = ["Promise", "Funding", "Settlement", "Record"];
const KIND_LABEL = {
  Settle: "Pay what is held",
  InKind: "Settle partly in goods",
  Extend: "Extend the date",
  EarlyExit: "Apprentice leaves early",
  Reduce: "Reduce the promise",
};

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const date = (s) => new Date(s * 1000).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });

function useNow() {
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function refSource(ref) {
  if (ref.startsWith("roqqu")) return ["Roqqu", "roqqu"];
  if (ref.startsWith("SEED")) return ["Seeded history", "seed"];
    return ["Other", ""];
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [list, setList] = useState([]);
  const [selected, setSelected] = useState(null);
  const [promise, setPromise] = useState(null);
  const [tab, setTab] = useState("Promise");
  const [role, setRole] = useState("apprentice");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const ngn = config?.ngnPerUsd || null;
  const naira = useCallback(
    (usd) => (ngn ? `₦${Math.round(usd * ngn).toLocaleString("en-NG")}` : `$${usd.toLocaleString()}`),
    [ngn]
  );

  const loadList = useCallback(async () => {
    const l = await api("/api/promises");
    setList(l);
    if (!selected && l[0]) setSelected(l[0].id);
  }, [selected]);

  const loadPromise = useCallback(async () => {
    if (selected) setPromise(await api(`/api/promises/${selected}`));
  }, [selected]);

  useEffect(() => {
    const load = () => api("/api/config").then(setConfig).catch((e) => setToast({ err: true, text: e.message }));
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!config?.configured) return;
    loadList().catch(() => {});
    const t = setInterval(() => loadList().catch(() => {}), 10000);
    return () => clearInterval(t);
  }, [config?.configured, loadList]);
  useEffect(() => {
    loadPromise().catch((e) => setToast({ err: true, text: e.message }));
    const t = setInterval(() => loadPromise().catch(() => {}), 8000);
    return () => clearInterval(t);
  }, [loadPromise]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const run = async (label, fn) => {
    setBusy(true);
    try {
      const r = await fn();
      setToast({ text: r?.hash ? `${label}: confirmed on chain` : label });
      await Promise.all([loadPromise(), loadList()]);
      return r;
    } catch (e) {
      setToast({ err: true, text: e.message.replace(/^.*reverted with the following reason:\s*/s, "") });
    } finally {
      setBusy(false);
    }
  };

  const act = (action, args) => run(`${ROLES.find((r) => r[0] === role)[1]}: ${action}`, () => api(`/api/promises/${selected}/act`, { role, action, args }));

  const startScenario = () =>
    run("Demo promise created", async () => {
      const r = await api("/api/demo/scenario", { dueInMinutes: 10 });
      setSelected(r.id);
      setTab("Funding");
      return r;
    });

  if (!config) return <div className="shell"><p className="empty">Loading…</p></div>;

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <h1>Nkwa</h1>
          <p>The Igba-boi settlement, written down. Funded over the years, witnessed by the people who already keep the peace, and paid out only with the apprentice's consent.</p>
        </div>
        {config.demo && (
          <div className="role">
            Acting as
            {ROLES.map(([k, l]) => (
              <button key={k} className={role === k ? "on" : ""} onClick={() => setRole(k)}>{l}</button>
            ))}
          </div>
        )}
      </header>

      <div className={`banner ${config.roqqu.connected && !config.roqqu.outage ? "live" : ""}`}>
        {config.roqqu.mode === "simulated"
          ? "Roqqu simulator: same payment-link, webhook, deposit-check and send formats as Roqqu API Services. No real money moves."
          : `Roqqu ${config.roqqu.mode} mode.`}
        {config.roqqu.outage && " Roqqu is DOWN right now: instalments wait and are credited once it is back."}
        {!config.roqqu.connected && !config.roqqu.outage && ` Roqqu unavailable (${config.roqqu.reason}).`}
        {config.demo && " The server signs for each role; in production each person signs with their own wallet."}
        {ngn && ` Rate: ₦${ngn.toLocaleString()} per $1.`}
        {config.roqqu.mode === "simulated" && (
          <button style={{ marginLeft: 10, padding: "2px 10px", fontSize: 12 }} onClick={() => api("/api/sim/outage", { on: !config.roqqu.outage }).then(() => api("/api/config").then(setConfig))}>
            {config.roqqu.outage ? "End Roqqu outage" : "Simulate Roqqu outage"}
          </button>
        )}
      </div>

      {!config.configured ? (
        <p className="empty">The contract address is not configured yet.</p>
      ) : (
        <div className="layout">
          <aside className="list">
            {list.map((p) => (
              <button key={p.id} className={p.id === selected ? "on" : ""} onClick={() => setSelected(p.id)}>
                <b>Promise #{p.id}</b>
                <small>{p.trade}</small>
                <small>{naira(p.funded)} of {naira(p.promised)} · {p.status}</small>
              </button>
            ))}
            {config.demo && (
              <button disabled={busy} onClick={startScenario}>+ Demo promise due in 10 min</button>
            )}
          </aside>

          <main className="card">
            {!promise ? (
              <p className="empty">{selected ? "Loading promise…" : "Create a demo promise to begin."}</p>
            ) : (
              <>
                <nav className="tabs" role="tablist">
                  {TABS.map((t) => (
                    <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>
                  ))}
                </nav>
                {tab === "Promise" && <PromiseTab p={promise} naira={naira} config={config} />}
                {tab === "Funding" && <FundingTab p={promise} naira={naira} config={config} busy={busy} run={run} />}
                {tab === "Settlement" && <SettlementTab p={promise} naira={naira} config={config} role={role} busy={busy} act={act} run={run} ngn={ngn} />}
                {tab === "Record" && <RecordTab p={promise} naira={naira} config={config} />}
              </>
            )}
          </main>
        </div>
      )}
      {toast && <div className={`toast ${toast.err ? "err" : ""}`}>{toast.text}</div>}
    </div>
  );
}

function Who({ address, config }) {
  const name = Object.entries(config.roles || {}).find(([, a]) => a.toLowerCase() === address.toLowerCase())?.[0];
  const label = ROLES.find((r) => r[0] === name)?.[1];
  return (
    <span>
      {label && <b>{label} </b>}
      <a className="mono" href={`${config.explorer}/address/${address}`} target="_blank" rel="noreferrer">{short(address)}</a>
    </span>
  );
}

function PromiseTab({ p, naira, config }) {
  return (
    <>
      <h2>{p.trade}</h2>
      <div className="grid section">
        <div className="stat"><span>Promised</span><b>{naira(p.promised)}</b><small>${p.promised.toLocaleString()} in dollar stablecoin</small></div>
        <div className="stat"><span>Term</span><b>{date(p.start)}</b><small>to {date(p.end)}</small></div>
        <div className="stat"><span>Schedule</span><b>{p.instalments}</b><small>instalments of {naira(p.original / p.instalments)}</small></div>
        <div className="stat"><span>Status</span><b>{p.status}</b><small>{p.quorum} of {p.witnesses.length} witnesses decide</small></div>
      </div>
      <div className="section">
        <h3>Parties</h3>
        <div className="people">
          <div className="person"><span>Oga</span><Who address={p.oga} config={config} /></div>
          <div className="person"><span>Apprentice</span><Who address={p.apprentice} config={config} /></div>
          {p.witnesses.map((w) => (
            <div className="person" key={w.address}><span>Witness</span><Who address={w.address} config={config} /></div>
          ))}
        </div>
      </div>
      <p className="callout warn">The Oga has no way to take funded money back. It leaves only through a resolution the apprentice consents to and {p.quorum} witnesses approve.</p>
    </>
  );
}

function FundingTab({ p, naira, config, busy, run }) {
  const [link, setLink] = useState(null);
  const instalment = p.original / p.instalments;
  const credits = p.events.filter((e) => e.event === "Credited");
  const pct = (v) => `${Math.min(100, (v / p.original) * 100)}%`;

  const getLink = () =>
    run("Instalment ready", async () => {
      const r = await api(`/api/promises/${p.id}/link`, {});
      setLink(r);
      return null;
    });

  return (
    <>
      <div className="grid">
        <div className="stat"><span>Funded</span><b>{naira(p.funded)}</b><small>of {naira(p.original)}</small></div>
        <div className="stat"><span>Due by now</span><b>{naira(p.dueByNow)}</b><small>by the schedule</small></div>
        <div className="stat"><span>Arrears</span><b>{naira(p.arrears)}</b><small>{Math.round(p.arrears / instalment)} instalments behind</small></div>
        <div className="stat"><span>Held for the apprentice</span><b>{naira(p.held)}</b><small>in the Roqqu merchant balance</small></div>
      </div>
      <div className="bar" aria-label="Funding progress">
        <i className="due" style={{ width: pct(p.dueByNow) }} />
        <i className="funded" style={{ width: pct(p.funded) }} />
      </div>
      <div className="legend"><span>■ Funded</span><span>▯ Due by now</span></div>
      {p.events.some((e) => e.event === "ResolutionApplied") && p.status === "Active" ? (
        <p className="callout warn">A settlement plan is agreed: {naira(p.outstanding)} is still owed by {date(p.end)}.</p>
      ) : p.arrears > 0 ? (
        <p className="callout bad">The Oga is {naira(p.arrears)} behind. The witnesses can see this now, years before settlement day.</p>
      ) : p.status === "Active" ? (
        <p className="callout ok">Funding is on schedule.</p>
      ) : null}

      {p.status === "Active" && (
        <div className="section">
          <h3>Pay the next instalment</h3>
          {!link ? (
            <button className="primary" disabled={busy} onClick={getLink}>Get a Roqqu payment link for {naira(instalment)}</button>
          ) : (
            <div className="row">
              <a href={link.link} target="_blank" rel="noreferrer" onClick={() => setTimeout(() => setLink(null), 500)}><button className="primary">Pay ₦{link.amountNgn.toLocaleString()} on Roqqu</button></a>
              <span className="mono">ref {link.reference}</span>
              <span className="legend">Credited here only after Roqqu's webhook arrives and Roqqu confirms the deposit.</span>
            </div>
          )}
        </div>
      )}

      <div className="section">
        <h3>Funding history</h3>
        <table>
          <thead><tr><th>Amount</th><th>Source</th><th>Reference</th><th>Transaction</th></tr></thead>
          <tbody>
            {credits.map((c) => {
              const [label, cls] = refSource(c.args.roqquRef);
              return (
                <tr key={c.tx}>
                  <td>{naira(Number(c.args.amount) / 1e6)}</td>
                  <td><span className={`tag ${cls}`}>{label}</span></td>
                  <td className="mono">{c.args.roqquRef}</td>
                  <td><a className="mono" href={`${config.explorer}/tx/${c.tx}`} target="_blank" rel="noreferrer">{short(c.tx)}</a></td>
                </tr>
              );
            })}
            {p.roqquEvents.filter((e) => !e.creditTx || e.note).map((e, i) => (
              <tr key={i}>
                <td>—</td>
                <td><span className={`tag ${e.creditTx ? "roqqu" : "demo"}`}>{e.type.replace("payment_link_", "Roqqu ")}</span></td>
                <td className="mono">{e.reference}</td>
                <td>{e.note || "not credited"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SettlementTab({ p, naira, config, role, busy, act, run, ngn }) {
  const now = useNow();
  const due = now >= p.end;
  const r = p.resolution;
  const [kind, setKind] = useState("Settle");
  const [form, setForm] = useState({ payNowNgn: "", inKindNgn: "", refundNgn: "", reduceNgn: "", months: "12", note: "" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const toUsd = (v) => (Number(v) || 0) / (ngn || 1);
  const isWitness = ["union", "uncle", "pastor"].includes(role);
  const roleAddr = config.roles?.[role]?.toLowerCase();
  const witnessDone = r && p.witnesses.find((w) => w.address.toLowerCase() === roleAddr)?.approved;

  const left = Math.max(0, p.end - now);
  const countdown = `${Math.floor(left / 86400)}d ${Math.floor((left % 86400) / 3600)}h ${Math.floor((left % 3600) / 60)}m ${Math.floor(left % 60)}s`;

  const propose = () =>
    act("proposeResolution", {
      kind,
      payNow: toUsd(form.payNowNgn),
      inKindValue: toUsd(form.inKindNgn),
      refund: toUsd(form.refundNgn),
      reduceBy: toUsd(form.reduceNgn),
      newEnd: ["Settle", "InKind", "Extend"].includes(kind) && Number(form.months) > 0 ? Math.floor(now + Number(form.months) * 30 * 86400) : 0,
      note: form.note,
    });

  const fillHeld = () => setForm({ ...form, payNowNgn: String(Math.floor(p.held * ngn)) });

  return (
    <>
      <div className="grid">
        <div className="stat"><span>Settlement day</span><b>{due ? "Due now" : countdown}</b><small>{date(p.end)}</small></div>
        <div className="stat"><span>Outstanding</span><b>{naira(p.outstanding)}</b><small>still owed</small></div>
        <div className="stat"><span>Held</span><b>{naira(p.held)}</b><small>{Math.round((p.held / Math.max(p.outstanding, 1e-9)) * 100)}% of what is owed</small></div>
        <div className="stat"><span>Approved, awaiting payout</span><b>{naira(p.payable)}</b><small>paid so far {naira(p.paidOut)}</small></div>
      </div>

      {p.payable > 0 && (
        <div className="callout ok row">
          <span>{naira(p.payable)} is approved for the apprentice.</span>
          <button className="primary" disabled={busy} onClick={() => run("Payout recorded", () => api(`/api/promises/${p.id}/payout`, {}))}>
            Send through Roqqu
          </button>
        </div>
      )}

      {r?.open && (
        <div className="section">
          <h3>Open resolution, round {r.round}: {KIND_LABEL[r.kind]}</h3>
          <p>{r.note || "No note."}</p>
          <div className="grid">
            {r.payNow > 0 && <div className="stat"><span>Pay now</span><b>{naira(r.payNow)}</b></div>}
            {r.inKindValue > 0 && <div className="stat"><span>In goods</span><b>{naira(r.inKindValue)}</b></div>}
            {r.refund > 0 && <div className="stat"><span>Back to the Oga</span><b>{naira(r.refund)}</b></div>}
            {r.reduceBy > 0 && <div className="stat"><span>Promise cut by</span><b>{naira(r.reduceBy)}</b></div>}
            {r.newEnd > 0 && <div className="stat"><span>Rest due by</span><b>{date(r.newEnd)}</b></div>}
          </div>
          <div className="people section">
            <div className="person"><span>Apprentice consent</span><span className={r.apprenticeConsent ? "check" : "pending"}>{r.apprenticeConsent ? "Given" : "Waiting"}</span></div>
            {p.witnesses.map((w) => (
              <div className="person" key={w.address}><Who address={w.address} config={config} /><span className={w.approved ? "check" : "pending"}>{w.approved ? "Approved" : "Waiting"}</span></div>
            ))}
            <p className="legend">Applies when the apprentice consents and {p.quorum} witnesses approve ({r.approvals} so far). The Oga's approval is not needed.</p>
          </div>
          <div className="row">
            {role === "apprentice" && !r.apprenticeConsent && <button className="primary" disabled={busy} onClick={() => act("consentResolution")}>Consent as apprentice</button>}
            {isWitness && !witnessDone && <button className="primary" disabled={busy} onClick={() => act("approveResolution")}>Approve as witness</button>}
          </div>
        </div>
      )}

      {p.status === "Active" && (
        <div className="section">
          <h3>{r?.open ? "Replace it with another resolution" : "Propose a resolution"}</h3>
          {!due && <p className="legend">Before settlement day only an early exit or a reduction can be raised.</p>}
          <div className="form">
            <label>Kind
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            {["Settle", "InKind", "EarlyExit"].includes(kind) && (
              <label>Pay now (₦) <input inputMode="numeric" value={form.payNowNgn} onChange={set("payNowNgn")} placeholder={`up to ${Math.floor(p.held * (ngn || 1)).toLocaleString()}`} /></label>
            )}
            {kind === "InKind" && <label>Value in goods (₦)<input inputMode="numeric" value={form.inKindNgn} onChange={set("inKindNgn")} /></label>}
            {kind === "EarlyExit" && <label>Back to the Oga (₦)<input inputMode="numeric" value={form.refundNgn} onChange={set("refundNgn")} /></label>}
            {kind === "Reduce" && <label>Cut the promise by (₦)<input inputMode="numeric" value={form.reduceNgn} onChange={set("reduceNgn")} /></label>}
            {["Settle", "InKind", "Extend"].includes(kind) && <label>Rest due in (months)<input inputMode="numeric" value={form.months} onChange={set("months")} /></label>}
            <label style={{ gridColumn: "1 / -1" }}>Note<input value={form.note} onChange={set("note")} placeholder="What everyone agreed" maxLength={140} /></label>
          </div>
          <div className="row">
            {["Settle", "InKind", "EarlyExit"].includes(kind) && <button disabled={!ngn} onClick={fillHeld}>Use everything held</button>}
            <button className="primary" disabled={busy || (role === "oga" && kind === "EarlyExit")} onClick={propose}>
              Propose as {ROLES.find((x) => x[0] === role)[1]}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function RecordTab({ p, naira, config }) {
  const rec = p.record;
  const names = {
    Proposed: "Promise written", Accepted: "Apprentice accepted", Credited: "Instalment credited", ServiceAttested: "Service year attested",
    ResolutionProposed: "Resolution proposed", ResolutionApproved: "Witness approved", ResolutionApplied: "Resolution applied",
    PaidOut: "Paid to apprentice", Refunded: "Returned to Oga", Closed: "Promise closed",
  };
  return (
    <>
      <h2>The Oga's settlement record</h2>
      <p className="legend">Kept on chain across every apprentice he takes, so the next boy and his family can check it.</p>
      <div className="grid section">
        <div className="stat"><span>Promises closed</span><b>{rec.promisesClosed}</b></div>
        <div className="stat"><span>Delivered on closed promises</span><b>{rec.promisedClosed ? Math.round((rec.deliveredClosed / rec.promisedClosed) * 100) : 0}%</b><small>{naira(rec.deliveredClosed)} of {naira(rec.promisedClosed)}</small></div>
        <div className="stat"><span>Extensions</span><b>{rec.extensions}</b></div>
        <div className="stat"><span>Reductions</span><b>{rec.reductions}</b></div>
      </div>
      <div className="section">
        <h3>Everything that happened on promise #{p.id}</h3>
        <table>
          <tbody>
            {[...p.events].reverse().map((e) => (
              <tr key={e.tx + e.event}>
                <td>{names[e.event] || e.event}</td>
                <td className="mono">{e.args.roqquRef || e.args.note || ""}</td>
                <td><a className="mono" href={`${config.explorer}/tx/${e.tx}`} target="_blank" rel="noreferrer">{short(e.tx)}</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
