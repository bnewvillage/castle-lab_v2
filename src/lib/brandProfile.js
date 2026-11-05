// ─────────────────────────────────────────────────────────────
// BRAND PROFILE
// How a brand's catalogue is set up today, for whoever adds items to it: how
// many SKUs, which price bases and currencies they use, and the spread of their
// EXW and landed margins. Pure: the caller supplies the brand's rows and the rates.
// ─────────────────────────────────────────────────────────────
import { calcEXWMargin, calcAllMargins } from './pricing';
import { PRICE_BASIS, isCostPriced, basisPrice } from './priceBases';
import { toNum, round } from './num';

const pct = (n, total) => (total ? (n / total) * 100 : 0);

// Each distinct value of a field with its count and share of the brand, most
// used first. Blank is its own entry ("not set").
function breakdown(items, valueOf, labelOf = (v) => v) {
  const counts = new Map();
  for (const it of items) {
    const v = valueOf(it) || null;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: value == null ? 'not set' : labelOf(value), count, pct: pct(count, items.length) }))
    .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));
}

/**
 * The spread of one margin across the brand. Margins are compared to 0.1%, the
 * precision the app shows them at: the mode, and which SKUs sit at the minimum
 * and maximum, use that rounding. An EXW cost of 0 means "no cost data", so
 * those SKUs have no margin. Every SKU left out is counted under gapOf's
 * reason for it, so the card can say why.
 */
function marginStats(items, marginOf, gapOf) {
  const rows = [], gapCounts = new Map();
  for (const it of items) {
    const margin = toNum(it.exw_cost) > 0 ? marginOf({ ...it, exw_cost: toNum(it.exw_cost) }) : null;
    if (margin != null && Number.isFinite(margin)) { rows.push({ sku: it.item_code, margin, at: round(margin, 1) }); continue; }
    const reason = gapOf(it);
    gapCounts.set(reason, (gapCounts.get(reason) ?? 0) + 1);
  }
  const gaps = [...gapCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
  if (!rows.length) return { n: 0, missing: items.length, gaps };

  const sorted = rows.map(r => r.margin).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;

  const freq = new Map();
  for (const r of rows) freq.set(r.at, (freq.get(r.at) ?? 0) + 1);
  const [modeAt, modeCount] = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];

  // The extreme, one SKU that has it, and how many SKUs share it (of the brand).
  const extreme = (at) => {
    const at_ = rows.filter(r => r.at === at);
    return { value: at, sku: [...at_].sort((a, b) => String(a.sku).localeCompare(String(b.sku)))[0].sku, count: at_.length, pct: pct(at_.length, items.length) };
  };
  return {
    n: rows.length,
    missing: items.length - rows.length,
    gaps,
    median, mean,
    // A mode only means something when a value repeats.
    mode: modeCount > 1 ? { value: modeAt, count: modeCount, pct: pct(modeCount, items.length) } : null,
    min: extreme(round(sorted[0], 1)),
    max: extreme(round(sorted[sorted.length - 1], 1)),
  };
}

// Why a SKU has no EXW margin, or no landed margin.
const noCost = (it) => !(toNum(it.exw_cost) > 0);
function exwGap(it) {
  if (isCostPriced(it.price_used)) return 'priced from cost, so no vendor MSRP';
  if (noCost(it))                  return 'no EXW cost';
  if (basisPrice(it).value == null) return 'no vendor MSRP entered';
  return 'no exchange rate for its currency';
}
function landedGap(it) {
  if (noCost(it))                 return 'no EXW cost';
  if (!(toNum(it.msrp_aed) > 0))  return 'no UAE price';
  return 'no exchange rate for its currency';
}

export function brandProfile(items, rates) {
  return {
    count: items.length,
    bases:          breakdown(items, it => it.price_used, v => PRICE_BASIS[v]?.label ?? v),
    costCurrencies: breakdown(items, it => it.cost_currency),
    msrpCurrencies: breakdown(items.filter(it => PRICE_BASIS[it.price_used]?.msrp), it => it[PRICE_BASIS[it.price_used].currency]),
    // Vendor MSRP vs EXW cost: none for a SKU priced from cost, which has no MSRP to compare.
    exw:    marginStats(items, it => calcEXWMargin(it, rates), exwGap),
    // UAE selling price vs landed cost: every SKU with a cost and a price.
    landed: marginStats(items, it => calcAllMargins(it, rates)?.uae_margin ?? null, landedGap),
  };
}
