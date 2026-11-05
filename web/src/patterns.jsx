import { Emblem } from "./art.jsx";
import React, { useId } from "react";

// Original geometric motifs in the spirit of uli and akwete cloth. Each tile is
// drawn in two inks over a ground, so a band can be recoloured per stripe.

const TILES = {
  // crossed diagonals with two dots, after the large red motif
  cross: (ink) => (
    <>
      <path d="M0 0 L10 0 L40 30 L40 40 L30 40 L0 10 Z" fill={ink} />
      <path d="M40 0 L40 10 L10 40 L0 40 L0 30 L30 0 Z" fill={ink} />
      <circle cx="14" cy="34" r="3" fill={ink} />
      <circle cx="26" cy="34" r="3" fill={ink} />
    </>
  ),
  // nested diamonds
  diamond: (ink) => (
    <>
      <path d="M20 2 L38 20 L20 38 L2 20 Z" fill="none" stroke={ink} strokeWidth="3" />
      <path d="M20 11 L29 20 L20 29 L11 20 Z" fill={ink} />
    </>
  ),
  // comb with a row of teeth
  comb: (ink) => (
    <>
      {[4, 10, 16, 22, 28, 34].map((x) => <rect key={x} x={x} y="4" width="3" height="20" fill={ink} />)}
      <path d="M0 40 L6 30 L12 40 L18 30 L24 40 L30 30 L36 40 L40 33 L40 40 Z" fill={ink} />
    </>
  ),
  // concentric squares
  square: (ink) => (
    <>
      <rect x="4" y="4" width="32" height="32" fill="none" stroke={ink} strokeWidth="3" />
      <rect x="12" y="12" width="16" height="16" fill="none" stroke={ink} strokeWidth="3" />
      <rect x="18" y="18" width="4" height="4" fill={ink} />
    </>
  ),
  // stepped chevrons
  chevron: (ink) => (
    <>
      <path d="M0 8 L20 22 L40 8 L40 16 L20 30 L0 16 Z" fill={ink} />
      <circle cx="20" cy="6" r="2.5" fill={ink} />
    </>
  ),
};

/** One stripe of repeating motif. */
export function Stripe({ ground, ink, tile = "cross", size = 40, height = 40, className = "" }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={className} width="100%" height={height} aria-hidden="true" preserveAspectRatio="none">
      <defs>
        <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse" viewBox="0 0 40 40">
          <rect width="40" height="40" fill={ground} />
          {TILES[tile](ink)}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/** The cloth: stacked stripes in the four grounds from the references. */
export const CLOTH = [
  { ground: "var(--cloth-red)", ink: "var(--cloth-maroon)", tile: "cross" },
  { ground: "var(--cloth-maroon)", ink: "var(--cloth-gold)", tile: "diamond" },
  { ground: "var(--cloth-gold)", ink: "var(--cloth-slate)", tile: "comb" },
  { ground: "var(--cloth-slate)", ink: "var(--cloth-mint)", tile: "square" },
];

export function Cloth({ stripes = CLOTH, height = 24, size = 24 }) {
  return (
    <div className="cloth" aria-hidden="true">
      {stripes.map((s, i) => <Stripe key={i} {...s} height={height} size={size} />)}
    </div>
  );
}

/** A witness seal. It inks in, slightly turned, when the witness approves. */
export function Seal({ approved, initials, title }) {
  return (
    <span className={`seal ${approved ? "inked" : ""}`} title={title}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="29" className="seal-ring" />
        <circle cx="32" cy="32" r="22" className="seal-inner" />
        {Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2;
          const x1 = 32 + Math.cos(a) * 23.5, y1 = 32 + Math.sin(a) * 23.5;
          const x2 = 32 + Math.cos(a) * 27.5, y2 = 32 + Math.sin(a) * 27.5;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="seal-tick" />;
        })}
        <path d="M32 14 L37 22 L27 22 Z M32 50 L37 42 L27 42 Z" className="seal-mark" />
        <text x="32" y="36.5" textAnchor="middle" className="seal-text">{initials}</text>
      </svg>
    </span>
  );
}

/** The logo mark is the cloth emblem. */
export function Mark({ size = 28 }) {
  return <Emblem size={size} detail={size >= 40} />;
}
