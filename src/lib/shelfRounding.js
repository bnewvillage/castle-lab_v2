// ─────────────────────────────────────────────────────────────
// SHELF-PRICE ROUNDING
// The two ladders every market price is rounded on. Pure, no market knowledge:
// markets.js decides which ladder a market uses and what it is applied to.
// ─────────────────────────────────────────────────────────────
import { round } from './num';

// ── The dirham-scale ladder (UAE, KSA, Qatar) ────────────────
// Applied to the shelf price — VAT-inclusive where the market has VAT:
//
//   under 3,000    round up to 5; a price within 5 (under 1,000) or 10 (1,000+)
//                  above a round hundred snaps down to it; round hundreds then
//                  become …99. The 3,000 mark itself is never charmed: it stays
//                  3,000, so a charm price never sits beside its round twin.
//   3,000 – 4,999  round the target DOWN to the 50
//   5,000+         round the target DOWN to the 100
//
// The prestige bands floor the raw target, never a rounded-up one. Rounding up
// to 5 first would push anything within 5 of a 50/100 mark up instead of down,
// so "prestige rounds down" would quietly fail for one price in ten.
export const PRESTIGE_50_FROM  = 3000;
export const PRESTIGE_100_FROM = 5000;

// Storage noise must not cost a whole step. Prices are stored ex-VAT at 2dp, and
// a second pass (additional markup, a derived market) starts from that stored
// value, so its target carries up to half a fils × the multiplier: a 5,000 base
// stored as 4,761.90, plus 10%, is 5,499.9945 — which must round to 5,500, not
// 5,400. Anything less than a fils from a mark is treated as on it (the worst
// noise, a 50% additional markup, is 0.008); a genuine target a fils off is not.
export const ROUND_TOL = 0.009;
const ceilTo  = (v, step) => (Math.ceil((v - ROUND_TOL) / step) * step) || 0;
const floorTo = (v, step) => (Math.floor((v + ROUND_TOL) / step) * step) || 0;

export function prettifyShelf(target) {
  if (target >= PRESTIGE_100_FROM) return floorTo(target, 100);
  if (target >= PRESTIGE_50_FROM)  return floorTo(target, 50);

  const c = ceilTo(target, 5);
  if (c >= PRESTIGE_50_FROM) return PRESTIGE_50_FROM;
  if (c < 100) return c;

  const snap    = c < 1000 ? 5 : 10;
  const mod     = c % 100;
  const snapped = mod <= snap ? c - mod : c;
  return snapped % 100 === 0 ? snapped - 1 : snapped;
}

// ── The dinar ladder (Kuwait) ────────────────────────────────
// Dinar prices are ~12× smaller than dirham ones, so Kuwait has its own ladder
// in the spirit of the one above: round up below the prestige line, charm only
// at round points (.900, like …99), round down above it.
//
//   under 1 KD     round up to 0.050
//   1 – 5 KD       round up to 0.100
//   5 – 100 KD     round up to 0.250; within 0.250 above a multiple of 5, snap
//                  down to it; multiples of 5 become x4.900 / x9.900
//   100 – 250 KD   round up to 0.500; within 1 above a multiple of 10, snap down
//                  to it; multiples of 10 become x9.900
//   250 KD         stays 250 — never 249.900, as 3,000 stays 3,000 above
//   250 – 500 KD   round DOWN to 5      at most 2% — 5 on 250, 10 on 500 — the
//   500 KD +       round DOWN to 10     share the dirham ladder gives up at 5,000
//
// Every result fits in 2 decimals (.000 .050 .100 .250 .500 .750 .900), so
// the ERP's 2-decimal price lists hold it exactly. A tolerance of under a fils
// stops 2dp storage noise costing a step — 4,761.90 × 0.084 = 399.9996 is 400 —
// while a genuine target a whole fils off is not moved (the noise is ≤ 0.0004).
export const KWD_PRESTIGE_5_FROM  = 250;
export const KWD_PRESTIGE_10_FROM = 500;
const KWD_TOL = 0.0009;
const kCeil  = (v, step) => round(Math.ceil((v - KWD_TOL) / step) * step, 3);
const kFloor = (v, step) => round(Math.floor((v + KWD_TOL) / step) * step, 3);

export function prettifyKwd(target) {
  if (target == null) return null;
  if (target >= KWD_PRESTIGE_10_FROM) return kFloor(target, 10);
  if (target >= KWD_PRESTIGE_5_FROM)  return kFloor(target, 5);
  const c = target < 1 ? kCeil(target, 0.05)
          : target < 5 ? kCeil(target, 0.1)
          : target < 100 ? kCeil(target, 0.25)
          : kCeil(target, 0.5);
  if (c >= KWD_PRESTIGE_5_FROM) return KWD_PRESTIGE_5_FROM;
  if (c < 5) return c;
  const [unit, snap] = c < 100 ? [5, 0.25] : [10, 1];
  const mod     = round(c % unit, 3);
  const snapped = mod <= snap + 1e-9 ? round(c - mod, 3) : c;
  return round(snapped % unit, 3) === 0 ? round(snapped - 0.1, 3) : snapped;
}
