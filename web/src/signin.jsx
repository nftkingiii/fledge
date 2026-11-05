import React, { useState } from "react";
import { ChevronDown, Github } from "lucide-react";
import { Emblem, RosetteField, LoopArrow } from "./art.jsx";

// Demo sign-in: it chooses which of the five people on the demo promise you act as.
// Nothing is sent anywhere; the choice is kept in this browser only.
export const PEOPLE = [
  ["oga", "Chief Okafor", "Oga"],
  ["apprentice", "Chidi", "Apprentice"],
  ["union", "Market union", "Witness"],
  ["uncle", "Uncle Emeka", "Witness"],
  ["pastor", "Pastor Obi", "Witness"],
];
const JOIN_AS = { oga: "Oga (master)", apprentice: "Apprentice", union: "Witness" };

export default function SignIn({ onDone }) {
  const [mode, setMode] = useState("up");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [trade, setTrade] = useState("");

  const submit = (e) => {
    e.preventDefault();
    if (!role) return;
    const person = PEOPLE.find((p) => p[0] === role);
    onDone({ role, name: mode === "up" && name.trim() ? name.trim() : person[1] });
  };

  return (
    <div className="auth">
      <aside className="auth-cloth">
        <RosetteField />
        <div className="capsule">
          <LoopArrow />
          <Emblem size={132} />
          <p className="capsule-name">Nkwa</p>
          <p className="capsule-tag">The settlement, written down</p>
        </div>
        <a className="auth-social" href="https://github.com/nftkingiii/nkwa" target="_blank" rel="noreferrer" aria-label="Nkwa on GitHub">
          <Github size={16} strokeWidth={1.5} />
        </a>
      </aside>

      <main className="auth-form">
        <form onSubmit={submit}>
          <h1>{mode === "up" ? "Sign up" : "Sign in"}</h1>
          {mode === "up" && (
            <input aria-label="Full name" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          )}
          <input aria-label="Phone number" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" />
          <label className="select">
            <select aria-label={mode === "up" ? "I am joining as" : "I am"} value={role} onChange={(e) => setRole(e.target.value)} required>
              <option value="" disabled>{mode === "up" ? "I am joining as" : "I am"}</option>
              {mode === "up"
                ? Object.entries(JOIN_AS).map(([k, l]) => <option key={k} value={k}>{l}</option>)
                : PEOPLE.map(([k, n, r]) => <option key={k} value={k}>{n} · {r}</option>)}
            </select>
            <ChevronDown size={18} strokeWidth={1.5} />
          </label>
          {mode === "up" && (
            <input aria-label="Trade and market" placeholder="Trade and market, e.g. Auto parts, Nnewi" value={trade} onChange={(e) => setTrade(e.target.value)} />
          )}
          <button className="auth-submit" type="submit" disabled={!role}>{mode === "up" ? "Sign up" : "Sign in"}</button>
          <p className="auth-switch">
            {mode === "up" ? "Already a member?" : "New to Nkwa?"}{" "}
            <button type="button" onClick={() => setMode(mode === "up" ? "in" : "up")}>{mode === "up" ? "Sign in now" : "Sign up"}</button>
          </p>
          <p className="auth-demo">Demo: you will act as one of the five people on the demo promise. Nothing you type leaves this browser.</p>
        </form>
      </main>
    </div>
  );
}
