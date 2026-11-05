import React, { useId } from "react";

/**
 * The Nkwa emblem: a seal of cloth. A gold sawtooth ring (the teeth of the
 * comb motif) around a maroon field, four gold diamonds at the compass
 * points, and the N cut in cream.
 */
export function Emblem({ size = 32, detail = true }) {
  const teeth = 24;
  const ring = Array.from({ length: teeth }, (_, i) => {
    const a0 = (i / teeth) * Math.PI * 2, a1 = ((i + 0.5) / teeth) * Math.PI * 2, a2 = ((i + 1) / teeth) * Math.PI * 2;
    const p = (a, r) => `${32 + Math.cos(a) * r},${32 + Math.sin(a) * r}`;
    return `M${p(a0, 24)} L${p(a1, 30)} L${p(a2, 24)} Z`;
  }).join(" ");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="emblem">
      <circle cx="32" cy="32" r="31.5" fill="var(--cloth-red, #b8352f)" />
      <path d={ring} fill="var(--cloth-gold, #e9a23b)" />
      <circle cx="32" cy="32" r="23" fill="var(--cloth-maroon, #5b1d1c)" />
      {detail && (
        <g fill="var(--cloth-gold, #e9a23b)">
          {[[32, 13], [51, 32], [32, 51], [13, 32]].map(([x, y]) => (
            <path key={`${x}${y}`} d={`M${x} ${y - 2.6} L${x + 2.6} ${y} L${x} ${y + 2.6} L${x - 2.6} ${y} Z`} />
          ))}
        </g>
      )}
      <path d="M24 42V22l16 20V22" stroke="#f6ecdc" strokeWidth="4.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** One rosette: rings of petals, dots and teeth, like a medallion in printed cloth. */
function Rosette({ cx, cy, r }) {
  const petals = 16;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="var(--cloth-gold)" />
      <circle cx={cx} cy={cy} r={r - 3} fill="var(--cloth-maroon)" />
      {Array.from({ length: petals }, (_, i) => {
        const a = (i / petals) * 360;
        return (
          <ellipse key={i} cx={cx} cy={cy - r * 0.62} rx={r * 0.11} ry={r * 0.3} fill={i % 2 ? "var(--cloth-mint)" : "var(--cloth-slate)"}
            transform={`rotate(${a} ${cx} ${cy})`} />
        );
      })}
      <circle cx={cx} cy={cy} r={r * 0.36} fill="var(--cloth-red)" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return <circle key={i} cx={cx + Math.cos(a) * r * 0.28} cy={cy + Math.sin(a) * r * 0.28} r={r * 0.035} fill="#f6ecdc" />;
      })}
      <circle cx={cx} cy={cy} r={r * 0.16} fill="var(--cloth-gold)" />
      <circle cx={cx} cy={cy} r={r * 0.06} fill="var(--cloth-maroon)" />
    </g>
  );
}

/** A repeating field of rosettes on a diamond lattice, for the sign-in panel. */
export function RosetteField() {
  const id = useId().replace(/:/g, "");
  const s = 120;
  return (
    <svg className="rosette-field" width="100%" height="100%" aria-hidden="true">
      <defs>
        <pattern id={id} width={s} height={s} patternUnits="userSpaceOnUse">
          <rect width={s} height={s} fill="var(--cloth-red)" />
          {/* lattice of comb lines between the medallions */}
          <path d={`M0 ${s / 2} L${s / 2} 0 L${s} ${s / 2} L${s / 2} ${s} Z`} fill="none" stroke="var(--cloth-maroon)" strokeWidth="6" />
          <path d={`M0 ${s / 2} L${s / 2} 0 L${s} ${s / 2} L${s / 2} ${s} Z`} fill="none" stroke="var(--cloth-gold)" strokeWidth="1.5" strokeDasharray="2 4" />
          <Rosette cx={s / 2} cy={s / 2} r={40} />
          {[[0, 0], [s, 0], [0, s], [s, s]].map(([x, y]) => <Rosette key={`${x}-${y}`} cx={x} cy={y} r={40} />)}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/** A hand-drawn looping arrow, like the doodle on the reference sign-up card. */
export function LoopArrow() {
  return (
    <svg className="loop-arrow" viewBox="0 0 160 70" aria-hidden="true">
      <path d="M6 40 C 40 8, 92 6, 112 22 C 128 36, 104 52, 96 38 C 88 22, 128 14, 146 46"
        fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M137 44 L147 50 L148 38" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Faint line art behind the whole app: spirals, palm fronds, contour lines and
 * a sun of uli rays, drawn in the cloth colours at very low strength, with a
 * fine grain, so the paper never reads as plain.
 */
export function BackgroundArt() {
  const spiral = (cx, cy, turns, gap) => {
    let d = "";
    for (let t = 0; t <= turns * Math.PI * 2; t += 0.18) {
      const r = (gap * t) / (Math.PI * 2);
      d += `${d ? "L" : "M"}${(cx + Math.cos(t) * r).toFixed(1)} ${(cy + Math.sin(t) * r).toFixed(1)} `;
    }
    return d;
  };
  const frond = (x, y, len, angle, side) => {
    const leaves = [];
    for (let i = 1; i <= 14; i++) {
      const k = i / 15;
      const bx = x + Math.cos(angle) * len * k, by = y + Math.sin(angle) * len * k;
      const l = 70 * (1 - k * 0.7);
      for (const s of side ? [1] : [1, -1]) {
        const a = angle + s * 0.9;
        leaves.push(`M${bx.toFixed(1)} ${by.toFixed(1)} q ${(Math.cos(a - s * 0.3) * l * 0.6).toFixed(1)} ${(Math.sin(a - s * 0.3) * l * 0.6).toFixed(1)} ${(Math.cos(a) * l).toFixed(1)} ${(Math.sin(a) * l).toFixed(1)}`);
      }
    }
    return `M${x} ${y} L${(x + Math.cos(angle) * len).toFixed(1)} ${(y + Math.sin(angle) * len).toFixed(1)} ${leaves.join(" ")}`;
  };
  const contours = Array.from({ length: 9 }, (_, i) => `M-20 ${880 + i * 22} C 300 ${780 + i * 18}, 620 ${980 + i * 14}, 1460 ${820 + i * 20}`).join(" ");
  const sunRays = Array.from({ length: 28 }, (_, i) => {
    const a = (i / 28) * Math.PI * 2, r1 = 70, r2 = i % 2 ? 104 : 120;
    return `M${(1240 + Math.cos(a) * r1).toFixed(1)} ${(150 + Math.sin(a) * r1).toFixed(1)} L${(1240 + Math.cos(a) * r2).toFixed(1)} ${(150 + Math.sin(a) * r2).toFixed(1)}`;
  }).join(" ");
  const dots = Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * Math.PI * 1.2 + 2.2;
    return [180 + Math.cos(a) * 260, 980 + Math.sin(a) * 260];
  });
  return (
    <div className="bg-art" aria-hidden="true">
      <svg viewBox="0 0 1440 1100" preserveAspectRatio="xMidYMid slice">
        <defs>
          <filter id="grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
            <feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.25  0 0 0 0 0.18  0 0 0 0.55 0" />
          </filter>
        </defs>
        <g className="bg-ink-a" fill="none" strokeLinecap="round">
          <path d={spiral(250, 230, 4.5, 26)} strokeWidth="2" />
          <path d={spiral(1110, 760, 3.5, 22)} strokeWidth="2" />
          <path d={contours} strokeWidth="1.4" />
        </g>
        <g className="bg-ink-b" fill="none" strokeLinecap="round">
          <path d={frond(40, 700, 520, -0.95, false)} strokeWidth="1.6" />
          <path d={frond(1440, 420, 420, 2.6, false)} strokeWidth="1.6" />
          <circle cx="1240" cy="150" r="52" strokeWidth="2" />
          <circle cx="1240" cy="150" r="30" strokeWidth="1.5" strokeDasharray="3 6" />
          <path d={sunRays} strokeWidth="2" />
          <path d="M560 120 l40 -28 l40 28 l40 -28 l40 28 l40 -28 l40 28" strokeWidth="1.6" />
          <path d="M560 140 l40 -28 l40 28 l40 -28 l40 28 l40 -28 l40 28" strokeWidth="1.6" />
        </g>
        <g className="bg-ink-a">
          {dots.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3" />)}
        </g>
        <rect width="100%" height="100%" filter="url(#grain)" opacity="0.18" />
      </svg>
    </div>
  );
}
