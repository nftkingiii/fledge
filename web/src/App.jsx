import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollText, Coins, Scale, BookOpen, ChevronDown, ExternalLink, Info, Check, X } from "lucide-react";
import { Cloth, Seal, Mark, Stripe, CLOTH } from "./patterns.jsx";
import { BackgroundArt, Figurehead } from "./art.jsx";
import SignIn from "./signin.jsx";

const SESSION_KEY = "fledge.session";
const readSession = () => {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
};

const api = async (path, body) => {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
};

const ROLES = [
  ["oga", "Oga", "Chief Okafor"],
  ["apprentice", "Apprentice", "Chidi"],
  ["union", "Witness", "Market union"],
  ["uncle", "Witness", "Uncle Emeka"],
  ["pastor", "Witness", "Pastor Obi"],
];
const roleOf = (k) => ROLES.find((r) => r[0] === k);
const TABS = [
  ["promise", "Promise", ScrollText],
  ["funding", "Funding", Coins],
  ["settle", "Settle", Scale],
  ["record", "Record", BookOpen],
];
const KIND_LABEL = {
  Settle: "Pay what is held",
  InKind: "Part in goods",
  Extend: "Extend the date",
  EarlyExit: "Apprentice leaves early",
  Reduce: "Reduce the promise",
};

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const date = (s) => new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const initials = (name) => name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

function useNow() {
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Tweens a changed number so a credit visibly lands. */
function useTween(value, ms = 600) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(a + (value - a) * e);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

function refSource(ref) {
  if (ref.startsWith("roqqu")) return ["Roqqu", "ok"];
  if (ref.startsWith("SEED")) return ["Seeded history", "muted"];
  return ["Other", "muted"];
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [list, setList] = useState(null);
  const [selected, setSelected] = useState(null);
  const [promise, setPromise] = useState(null);
  const [tab, setTab] = useState("promise");
  const [session, setSession] = useState(readSession);
  const [role, setRole] = useState(() => readSession()?.role || "apprentice");
  const [sheet, setSheet] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const ngn = config?.ngnPerUsd || null;
  const naira = useCallback((usd) => (ngn ? `₦${Math.round(usd * ngn).toLocaleString("en-NG")}` : `$${usd.toLocaleString()}`), [ngn]);

  const loadList = useCallback(async () => {
    const l = await api("/api/promises");
    setList(l);
    setSelected((s) => s ?? l[0]?.id ?? null);
  }, []);
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
    const t = setInterval(() => loadList().catch(() => {}), 12000);
    return () => clearInterval(t);
  }, [config?.configured, loadList]);
  useEffect(() => {
    setPromise(null);
    loadPromise().catch(() => {});
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
      if (label) setToast({ text: label });
      await Promise.all([loadPromise(), loadList()]);
      return r;
    } catch (e) {
      setToast({ err: true, text: e.message });
    } finally {
      setBusy(false);
    }
  };
  const act = (action, args, label) => run(label, () => api(`/api/promises/${selected}/act`, { role, action, args }));

  const startScenario = () =>
    run("Promise written on chain", async () => {
      const r = await api("/api/demo/scenario", { dueInMinutes: 10 });
      setSelected(r.id);
      setTab("funding");
      return r;
    });

  const signIn = (s) => {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    } catch {}
    setSession(s);
    setRole(s.role);
  };
  const signOut = () => {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {}
    setSession(null);
    setSheet(null);
  };

  if (!session) return <SignIn onDone={signIn} />;
  if (!config) return <Splash text="Opening the ledger" />;
  if (!config.configured) return <Splash text="The contract address is not set" />;
  if (list && list.length === 0) return <Welcome onStart={startScenario} busy={busy} />;

  const me = roleOf(role);
  const myName = role === session.role ? session.name : me[2];

  return (
    <div className="app">
      <BackgroundArt />
      <nav className="rail" aria-label="Sections">
        <div className="rail-brand"><Mark /><span>Fledge</span></div>
        {TABS.map(([k, label, Icon]) => (
          <button key={k} className={`rail-item ${tab === k ? "on" : ""}`} onClick={() => setTab(k)} aria-current={tab === k ? "page" : undefined}>
            <Icon size={18} strokeWidth={1.5} /><span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="main">
        <header className="topbar">
          <div className="brand"><Mark size={26} /><span>Fledge</span></div>
          <button className="picker" onClick={() => setSheet("promises")}>
            <span>{promise ? `No. ${promise.id} · ${promise.trade}` : "Promises"}</span>
            <ChevronDown size={16} strokeWidth={1.5} />
          </button>
          <button className="who" onClick={() => setSheet("role")} title="Who you are acting as">
            <Figurehead role={role} size={32} />
            <span className="who-text"><small>Acting as</small>{myName}</span>
            <ChevronDown size={16} strokeWidth={1.5} />
          </button>
        </header>

        <ModeLine config={config} setConfig={setConfig} />

        {!promise ? (
          <div className="loading">Loading promise</div>
        ) : (
          <div className={`stage tab-${tab}`}>
            <section className="pane" key={tab}>
              {tab === "promise" && <PromiseCard p={promise} naira={naira} config={config} />}
              {tab === "promise" && <PromiseTab p={promise} naira={naira} config={config} />}
              {tab === "funding" && <FundingTab p={promise} naira={naira} config={config} busy={busy} run={run} />}
              {tab === "settle" && <SettleTab p={promise} naira={naira} config={config} role={role} busy={busy} act={act} run={run} ngn={ngn} />}
              {tab === "record" && <RecordTab p={promise} naira={naira} config={config} />}
            </section>
          </div>
        )}
      </div>

      <nav className="tabbar" aria-label="Sections">
        {TABS.map(([k, label, Icon]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)} aria-current={tab === k ? "page" : undefined}>
            <Icon size={20} strokeWidth={1.5} /><span>{label}</span>
          </button>
        ))}
      </nav>

      {sheet === "role" && (
        <Sheet title="Act as" onClose={() => setSheet(null)}>
          <p className="sheet-note">Demo signers: the server signs for each person so the whole flow fits in one browser. In use, each person signs from their own phone.</p>
          {ROLES.map(([k, kind, name]) => (
            <button key={k} className={`sheet-row ${role === k ? "on" : ""}`} onClick={() => { setRole(k); setSheet(null); }}>
              <Figurehead role={k} size={40} />
              <span className="grow"><b>{name}</b><small>{kind}</small></span>
              {role === k && <Check size={18} strokeWidth={1.5} />}
            </button>
          ))}
          <button className="btn wide" onClick={signOut}>Sign out</button>
        </Sheet>
      )}
      {sheet === "promises" && (
        <Sheet title="Promises" onClose={() => setSheet(null)}>
          {(list || []).map((p) => (
            <button key={p.id} className={`sheet-row ${p.id === selected ? "on" : ""}`} onClick={() => { setSelected(p.id); setSheet(null); }}>
              <span className="grow"><b>No. {p.id} · {p.trade}</b><small>{naira(p.funded)} of {naira(p.promised)} · {p.status === "Closed" ? "Settled" : p.status}</small></span>
              {p.id === selected && <Check size={18} strokeWidth={1.5} />}
            </button>
          ))}
          {config.demo && <button className="btn wide" disabled={busy} onClick={() => { setSheet(null); startScenario(); }}>New demo promise, due in 10 minutes</button>}
        </Sheet>
      )}
      {toast && <div className={`toast ${toast.err ? "err" : ""}`} role="status">{toast.text}</div>}
    </div>
  );
}

function Splash({ text }) {
  return (
    <div className="splash">
      <BackgroundArt />
      <Cloth height={20} size={20} />
      <p>{text}</p>
    </div>
  );
}

function Welcome({ onStart, busy }) {
  return (
    <div className="welcome">
      <BackgroundArt />
      <div className="welcome-cloth" aria-hidden="true">
        {CLOTH.map((s, i) => <Stripe key={i} {...s} height="25%" size={56} />)}
        <div className="welcome-medallion"><Mark size={72} /></div>
      </div>
      <div className="welcome-text">
        <h1>The settlement, written down</h1>
        <p>An Oga promises his apprentice a settlement for his years of service. Fledge records that promise, lets the Oga fund it a little at a time through Roqqu, and releases it only when the apprentice and the witnesses agree.</p>
        <button className="btn primary" disabled={busy} onClick={onStart}>{busy ? "Writing the promise" : "Write a demo promise"}</button>
        <small>Creates a four-year promise that comes due in 10 minutes, on Base Sepolia</small>
      </div>
    </div>
  );
}

function ModeLine({ config, setConfig }) {
  const [open, setOpen] = useState(false);
  const r = config.roqqu;
  const toggle = () => api("/api/sim/outage", { on: !r.outage }).then(() => api("/api/config").then(setConfig));
  return (
    <div className={`mode ${r.outage ? "down" : ""}`}>
      <button className="mode-line" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`dot ${r.outage || !r.connected ? "bad" : "ok"}`} />
        <span>{r.outage ? "Roqqu is down: payments wait and are credited when it returns" : r.mode === "simulated" ? "Roqqu simulator · demo signers · Base Sepolia" : `Roqqu ${r.mode}`}</span>
        <Info size={16} strokeWidth={1.5} />
      </button>
      {open && (
        <div className="mode-detail">
          <p>Payment links, webhooks, deposit checks and payouts use the formats in Roqqu's API docs, served by a local simulator because hackathon keys only run simulations. The exchange rate is live from Roqqu{config.ngnPerUsd ? `: ₦${config.ngnPerUsd.toLocaleString()} per $1` : ""}. No real money moves.</p>
          {r.mode === "simulated" && <button className="btn small" onClick={toggle}>{r.outage ? "End the Roqqu outage" : "Simulate a Roqqu outage"}</button>}
          {config.contract && <a href={`${config.explorer}/address/${config.contract}`} target="_blank" rel="noreferrer">Contract {short(config.contract)} <ExternalLink size={14} strokeWidth={1.5} /></a>}
        </div>
      )}
    </div>
  );
}

function Sheet({ title, children, onClose }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h2>{title}</h2><button className="icon" onClick={onClose} aria-label="Close"><X size={18} strokeWidth={1.5} /></button></div>
        {children}
      </div>
    </div>
  );
}

/** The moment: the promise as a piece of cloth, its funding woven in one thread per instalment. */
function PromiseCard({ p, naira, config }) {
  const inst = p.original / p.instalments;
  const paid = Math.floor((p.funded + 1e-9) / inst);
  const due = Math.floor((p.dueByNow + 1e-9) / inst);
  const funded = useTween(p.funded);
  const settled = p.status === "Closed";
  const plan = p.events?.some((e) => e.event === "ResolutionApplied") && !settled;
  const apprentice = config.roles && Object.entries(config.roles).find(([, a]) => a.toLowerCase() === p.apprentice.toLowerCase());
  return (
    <article className="pcard">
      <Cloth stripes={CLOTH.slice(0, 3)} height={18} size={18} />
      <div className="pcard-body">
        <div className="pcard-id">
        <div className="pcard-head">
          <span>Promise No. {p.id}</span>
          <span className={`status ${settled ? "ok" : plan ? "warn" : p.arrears > 0 ? "bad" : "ok"}`}>
            {settled ? "Settled" : plan ? "On a plan" : p.arrears > 0 ? "Behind" : "On schedule"}
          </span>
        </div>
        <h2>{p.trade}</h2>
        <div className="figure">{naira(p.promised)}</div>
        <p className="pcard-sub">
          to {apprentice ? roleOf(apprentice[0])[2] : short(p.apprentice)}, by {date(p.end)}
        </p>
        </div>
        <div className="pcard-fund">
        <div className="pcard-funded"><span>Funded so far</span><b>{naira(funded)}</b></div>
        <div className="weave" role="img" aria-label={`${paid} of ${p.instalments} instalments paid, ${Math.max(0, due - paid)} missed`}>
          {Array.from({ length: p.instalments }, (_, i) => (
            <i key={i} className={i < paid ? "paid" : i < due ? "missed" : ""} />
          ))}
        </div>
        <div className="pcard-foot">
          <span><i className="key paid" />{paid} paid</span>
          {due > paid && <span><i className="key missed" />{due - paid} missed</span>}
          <span><i className="key" />{p.instalments - Math.max(paid, due)} to come</span>
        </div>
        </div>
      </div>
    </article>
  );
}

function Who({ address, config }) {
  const k = Object.entries(config.roles || {}).find(([, a]) => a.toLowerCase() === address.toLowerCase())?.[0];
  const r = k && roleOf(k);
  return (
    <span className="whois">
      {r && <Figurehead role={k} size={36} />}
      <span><b>{r ? r[2] : "Unknown"}</b><a className="mono" href={`${config.explorer}/address/${address}`} target="_blank" rel="noreferrer">{short(address)}</a></span>
    </span>
  );
}

function PromiseTab({ p, naira, config }) {
  return (
    <div className="promise-grid">
      <div className="col">
      <h3>Terms</h3>
      <dl className="terms">
        <div><dt>Promised</dt><dd>{naira(p.promised)} <small>${p.promised.toLocaleString()} in dollar stablecoin</small></dd></div>
        <div><dt>Service</dt><dd>{date(p.start)} to {date(p.end)}</dd></div>
        <div><dt>Schedule</dt><dd>{p.instalments} instalments of {naira(p.original / p.instalments)}</dd></div>
        <div><dt>Decided by</dt><dd>The apprentice and {p.quorum} of {p.witnesses.length} witnesses</dd></div>
      </dl>
      <p className="rule">Money paid in cannot go back to the Oga on his word alone. It leaves only through a resolution the apprentice consents to and {p.quorum} witnesses approve.</p>
      </div>
      <div className="col">
      <h3>People</h3>
      <ul className="people">
        <li><Who address={p.oga} config={config} /><span className="tag">Oga</span></li>
        <li><Who address={p.apprentice} config={config} /><span className="tag">Apprentice</span></li>
        {p.witnesses.map((w) => <li key={w.address}><Who address={w.address} config={config} /><span className="tag">Witness</span></li>)}
      </ul>
      </div>
    </div>
  );
}

function FundingTab({ p, naira, config, busy, run }) {
  const [link, setLink] = useState(null);
  const inst = p.original / p.instalments;
  const credits = p.events.filter((e) => e.event === "Credited");
  const plan = p.events.some((e) => e.event === "ResolutionApplied") && p.status === "Active";
  const down = config.roqqu.outage;

  const getLink = () => run(null, async () => setLink(await api(`/api/promises/${p.id}/link`, {})));

  return (
    <>
      <div className="stats">
        <div className="stat"><span>Held for the apprentice</span><b>{naira(p.held)}</b></div>
        <div className="stat"><span>{plan ? "Still owed" : "Behind schedule"}</span><b className={!plan && p.arrears > 0 ? "neg" : ""}>{naira(plan ? p.outstanding : p.arrears)}</b></div>
        <div className="stat"><span>Due by now</span><b>{naira(p.dueByNow)}</b></div>
      </div>
      {plan ? (
        <p className="note warn">A settlement plan is agreed: {naira(p.outstanding)} is still owed by {date(p.end)}.</p>
      ) : p.arrears > 0 ? (
        <p className="note bad">The Oga is {Math.round(p.arrears / inst)} instalments behind. The witnesses can see it now, years before settlement day.</p>
      ) : null}

      {p.status === "Active" && (
        <div className="action">
          <h3>Next instalment</h3>
          {!link ? (
            <>
              <button className="btn primary" disabled={busy || down} onClick={getLink}>Pay {naira(inst)} with Roqqu</button>
              {down && <small className="muted">Roqqu is unavailable. Try again when it is back.</small>}
            </>
          ) : (
            <div className="linkbox">
              <a className="btn primary" href={link.link} target="_blank" rel="noreferrer" onClick={() => setTimeout(() => setLink(null), 500)}>
                Open Roqqu checkout for ₦{link.amountNgn.toLocaleString()} <ExternalLink size={16} strokeWidth={1.5} />
              </a>
              <small className="muted">Reference {link.reference}. It is credited only after Roqqu's webhook arrives and Roqqu confirms the deposit.</small>
            </div>
          )}
        </div>
      )}

      <h3>History</h3>
      <ul className="ledger">
        {[...credits].reverse().map((c) => {
          const [label, tone] = refSource(c.args.roqquRef);
          return (
            <li key={c.tx}>
              <span className="grow"><b className="num">{naira(Number(c.args.amount) / 1e6)}</b><small className={`src ${tone}`}>{label}</small></span>
              <a className="mono" href={`${config.explorer}/tx/${c.tx}`} target="_blank" rel="noreferrer">{short(c.tx)}</a>
            </li>
          );
        })}
        {p.roqquEvents.filter((e) => !e.creditTx || e.note).map((e, i) => (
          <li key={`r${i}`} className="off">
            <span className="grow"><b>{e.type.replace("payment_link_", "Roqqu ").replace(/_/g, " ")}</b><small>{e.note || "Not credited"}</small></span>
            <span className="mono">{e.reference}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function SettleTab({ p, naira, config, role, busy, act, run, ngn }) {
  const now = useNow();
  const due = now >= p.end;
  const r = p.resolution;
  const [kind, setKind] = useState("Settle");
  const [form, setForm] = useState({ payNowNgn: "", inKindNgn: "", refundNgn: "", reduceNgn: "", months: "12", note: "" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const toUsd = (v) => (Number(String(v).replace(/,/g, "")) || 0) / (ngn || 1);
  const isWitness = ["union", "uncle", "pastor"].includes(role);
  const myAddr = config.roles?.[role]?.toLowerCase();
  const iApproved = r && p.witnesses.find((w) => w.address.toLowerCase() === myAddr)?.approved;
  const left = Math.max(0, p.end - now);
  const d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600), m = Math.floor((left % 3600) / 60), s = Math.floor(left % 60);
  const countdown = d > 0 ? `${d}d ${h}h` : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  const name = roleOf(role)[2];

  const propose = () =>
    act("proposeResolution", {
      kind,
      payNow: toUsd(form.payNowNgn),
      inKindValue: toUsd(form.inKindNgn),
      refund: toUsd(form.refundNgn),
      reduceBy: toUsd(form.reduceNgn),
      newEnd: ["Settle", "InKind", "Extend"].includes(kind) && Number(form.months) > 0 ? Math.floor(now + Number(form.months) * 30 * 86400) : 0,
      note: form.note,
    }, "Resolution raised");

  const names = Object.fromEntries(Object.entries(config.roles || {}).map(([k, a]) => [a.toLowerCase(), roleOf(k)[2]]));

  return (
    <>
      <div className="stats">
        <div className="stat"><span>{p.status === "Closed" ? "Settled" : due ? "Settlement day" : "Settlement in"}</span><b className="num">{p.status === "Closed" ? date(p.end) : due ? "Today" : countdown}</b></div>
        <div className="stat"><span>Held now</span><b>{naira(p.held)}</b></div>
        <div className="stat"><span>Still owed</span><b>{naira(p.outstanding)}</b></div>
      </div>

      {p.payable > 0 && (
        <div className="payout">
          <span className="grow"><b>{naira(p.payable)}</b> is approved for the apprentice</span>
          <button className="btn primary" disabled={busy} onClick={() => run("Paid out through Roqqu", () => api(`/api/promises/${p.id}/payout`, {}))}>Send through Roqqu</button>
        </div>
      )}

      <h3>Seals</h3>
      <div className="seals">
        {p.witnesses.map((w) => {
          const n = names[w.address.toLowerCase()] || short(w.address);
          return (
            <div className="seal-cell" key={w.address}>
              <Seal approved={r?.open && w.approved} initials={initials(n)} title={n} />
              <span>{n}</span>
            </div>
          );
        })}
        <div className="seal-cell">
          <Seal approved={r?.open && r.apprenticeConsent} initials={initials(names[p.apprentice.toLowerCase()] || "AP")} title="Apprentice" />
          <span>Apprentice</span>
        </div>
      </div>

      {r?.open ? (
        <div className="resolution">
          <div className="res-head"><b>{KIND_LABEL[r.kind]}</b><small>Round {r.round} · raised by {names[r.proposer.toLowerCase()] || short(r.proposer)}</small></div>
          {r.note && <p>“{r.note}”</p>}
          <dl className="terms compact">
            {r.payNow > 0 && <div><dt>Pay now</dt><dd>{naira(r.payNow)}</dd></div>}
            {r.inKindValue > 0 && <div><dt>In goods</dt><dd>{naira(r.inKindValue)}</dd></div>}
            {r.refund > 0 && <div><dt>Back to the Oga</dt><dd>{naira(r.refund)}</dd></div>}
            {r.reduceBy > 0 && <div><dt>Promise cut by</dt><dd>{naira(r.reduceBy)}</dd></div>}
            {r.newEnd > 0 && <div><dt>Rest due by</dt><dd>{date(r.newEnd)}</dd></div>}
          </dl>
          <p className="muted">Needs the apprentice and {p.quorum} witnesses ({r.approvals} so far). The Oga's approval is not needed.</p>
          <div className="row">
            {role === "apprentice" && !r.apprenticeConsent && <button className="btn primary" disabled={busy} onClick={() => act("consentResolution", {}, "Chidi consented")}>Consent as {name}</button>}
            {isWitness && !iApproved && <button className="btn primary" disabled={busy} onClick={() => act("approveResolution", {}, `${name} sealed it`)}>Seal as {name}</button>}
            {role === "oga" && <small className="muted">Switch to the apprentice or a witness to respond.</small>}
          </div>
        </div>
      ) : p.status === "Active" && <p className="muted">No resolution is open.</p>}

      {p.status === "Active" && (
        <details className="propose" open={!r?.open}>
          <summary>{r?.open ? "Raise a different resolution" : `Raise a resolution as ${name}`}</summary>
          {!due && <p className="muted">Before settlement day only an early exit or a reduction can be raised.</p>}
          <div className="kinds" role="radiogroup" aria-label="Kind of resolution">
            {Object.entries(KIND_LABEL).map(([k, l]) => (
              <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{l}</button>
            ))}
          </div>
          <div className="fields">
            {["Settle", "InKind", "EarlyExit"].includes(kind) && (
              <label>Pay now, ₦
                <span className="with-action">
                  <input inputMode="numeric" value={form.payNowNgn} onChange={set("payNowNgn")} placeholder={`up to ${Math.floor(p.held * (ngn || 1)).toLocaleString()}`} />
                  <button className="btn small" type="button" onClick={() => setForm({ ...form, payNowNgn: String(Math.floor(p.held * ngn)) })}>All held</button>
                </span>
              </label>
            )}
            {kind === "InKind" && <label>Value in goods, ₦<input inputMode="numeric" value={form.inKindNgn} onChange={set("inKindNgn")} /></label>}
            {kind === "EarlyExit" && <label>Back to the Oga, ₦<input inputMode="numeric" value={form.refundNgn} onChange={set("refundNgn")} /></label>}
            {kind === "Reduce" && <label>Cut the promise by, ₦<input inputMode="numeric" value={form.reduceNgn} onChange={set("reduceNgn")} /></label>}
            {["Settle", "InKind", "Extend"].includes(kind) && <label>Rest due in, months<input inputMode="numeric" value={form.months} onChange={set("months")} /></label>}
            <label className="full">Note<input value={form.note} onChange={set("note")} placeholder="What everyone agreed" maxLength={140} /></label>
          </div>
          <button className="btn primary" disabled={busy || (role === "oga" && kind === "EarlyExit")} onClick={propose}>Raise as {name}</button>
        </details>
      )}
    </>
  );
}

function RecordTab({ p, naira, config }) {
  const rec = p.record;
  const pct = rec.promisedClosed ? Math.round((rec.deliveredClosed / rec.promisedClosed) * 100) : null;
  const names = {
    Proposed: "Promise written", Accepted: "Apprentice accepted", Credited: "Instalment credited", ServiceAttested: "Service year attested",
    ResolutionProposed: "Resolution raised", ResolutionApproved: "Witness sealed", ResolutionApplied: "Resolution applied",
    PaidOut: "Paid to the apprentice", Refunded: "Returned to the Oga", Closed: "Promise settled",
  };
  return (
    <>
      <h3>Chief Okafor's record</h3>
      <p className="muted">Kept on chain across every apprentice he takes, so the next boy's family can check it before he starts.</p>
      <div className="stats">
        <div className="stat"><span>Promises settled</span><b>{rec.promisesClosed}</b></div>
        <div className="stat"><span>Delivered when settled</span><b>{pct === null ? "None yet" : `${pct}%`}</b></div>
        <div className="stat"><span>Extensions · cuts</span><b>{rec.extensions} · {rec.reductions}</b></div>
      </div>
      <h3>Everything on promise No. {p.id}</h3>
      <ol className="timeline">
        {[...p.events].reverse().map((e) => (
          <li key={e.tx + e.event}>
            <span className="grow"><b>{names[e.event] || e.event}</b>{(e.args.roqquRef || e.args.note) && <small>{e.args.roqquRef || e.args.note}</small>}</span>
            <a className="mono" href={`${config.explorer}/tx/${e.tx}`} target="_blank" rel="noreferrer">{short(e.tx)}</a>
          </li>
        ))}
      </ol>
    </>
  );
}
