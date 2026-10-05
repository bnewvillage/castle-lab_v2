// ─────────────────────────────────────────────────────────────
// RE-ROUNDING STORED PRICES
// Moves prices made under the old rounding rule onto the current one
// (prettifyShelf in pricing.js) without repricing anything else.
//
// Recalculating every item from source would rerun it through today's exchange
// rates and brand markups: an item priced when EUR was 4.0 would move ~7% if
// EUR is now 4.3 — a stealth repricing disguised as a rounding change. So each
// price takes one of two paths:
//
//   exact      Re-running the OLD rule on today's inputs reproduces the stored
//              price to the fils, which proves rates and markups have not moved
//              for this item. Its new price is then simply the new rule applied
//              to the same target — exactly what a fresh save would give.
//
//   re-round   Otherwise the inputs have drifted, so the stored price is the only
//              trustworthy record. The original target is inferred from it and
//              the new rule applied. Exact everywhere except:
//                approx     a UAE price that the old rule snapped to a round
//                           hundred at 3,000+. Its target sat anywhere from 5
//                           below to 10/20 above that hundred, and the new rule
//                           splits that range. We keep the hundred — right two
//                           times in three (3,000–4,999) and four in five
//                           (5,000+), otherwise one step high until next edited.
//                ambiguous  a price ending in 50 between 3,000 and 4,999 that was
//                           saved after the new rule went live. Both rules make
//                           it, so it is left alone.
//
// The old rule, kept below only to recognise what it produced:
//   UAE        round up to 5; snap down to a round hundred when within 5
//              (100–999), 10 (1,000–4,999) or 20 (5,000+); hundreds → …99.95
//   KSA/Qatar  round up to 5; hundreds → …99.95; no snap
// ─────────────────────────────────────────────────────────────
import {
  prettifyShelf, suggestKSAPrice, suggestQATPrice, applyAdditionalMarkupUAE,
  resolvePriceUsed, DEFAULT_COST_MARGIN_PCT, PRESTIGE_50_FROM, PRESTIGE_100_FROM,
} from './pricing';
import { toNum } from './num';

export const MARKETS = {
  aed: { label: 'UAE',   field: 'msrp_aed', real: 'real_msrp_aed', flag: 'uae_overridden', vat: 1.05, oldSnap: true  },
  sar: { label: 'KSA',   field: 'msrp_sar', real: 'real_msrp_sar', flag: 'ksa_overridden', vat: 1.15, oldSnap: false },
  qat: { label: 'Qatar', field: 'msrp_qat', real: 'real_msrp_qat', flag: 'qat_overridden', vat: 1,    oldSnap: false },
};

const round2 = (v) => Math.round(v * 100) / 100;
const same   = (a, b) => a != null && b != null && round2(a) === round2(b);
// Shelf price for display. Stored prices are ex-VAT at 2dp, so ×VAT carries a
// fils of drift (2,869.57 × 1.15 = 3,300.0055); every real shelf price is a
// multiple of 0.05, so snap to it.
const shelfOf = (stored, vat) => round2(Math.round((toNum(stored) * vat) / 0.05) * 0.05);

// ── The old rule, bit-for-bit (no float tolerance — it had none) ──
export function legacyUaeShelf(t) {
  const c       = Math.ceil(t / 5) * 5;
  const modMark = c < 100 ? 0 : c < 1000 ? 5 : c < 5000 ? 10 : 20;
  const modDiv  = c < 100 ? 1 : 100;
  const mod     = c % modDiv;
  const removed = c - (mod > modMark ? 0 : mod);
  return String(removed).slice(-2) === '00' ? removed - 0.05 : removed;
}
export function legacyMarketShelf(t) {
  const c = Math.ceil(t / 5) * 5;
  return String(c).slice(-2) === '00' ? c - 0.05 : c;
}
const legacyKSA = (aed) => aed == null ? null : round2(legacyMarketShelf(aed * 1.03 * 1.15) / 1.15);
const legacyQAT = (aed) => aed == null ? null : round2(legacyMarketShelf(aed * 1.01));
const freshKSA  = (aed) => aed == null ? null : round2(suggestKSAPrice(aed));
const freshQAT  = (aed) => aed == null ? null : round2(suggestQATPrice(aed));

// The UAE shelf target an item's source implies, multiplied in the same order
// the pricing code uses so the float result is bit-identical.
function uaeSource(item, { rates, rules }) {
  const rule = rules?.[item.brand_code] ?? {};
  const additional = rule.additional || null;
  if (item.price_used === 'cost_based') {
    const cost = toNum(item.exw_cost), rate = rates?.[item.cost_currency];
    const margin = (toNum(item.target_margin_pct) ?? DEFAULT_COST_MARGIN_PCT) / 100;
    if (cost == null || !rate || !(margin > 0 && margin < 1)) return null;
    return { shelf: cost * rate / (1 - margin) * 1.05, additional };
  }
  const { value, currency } = resolvePriceUsed(item);
  if (value == null || !currency || !rates?.[currency]) return null;
  const markup = rule.markup ?? 10;
  return { shelf: value * rates[currency] * (1 + markup / 100) * 1.05, additional };
}

// ── Re-round a single stored price (the fallback path) ──
const SHELF_TOLERANCE = 0.0075;            // 2dp ex-VAT storage drifts by < half a fils × VAT
const below = (shelf) => prettifyShelf(shelf - 0.001);

/**
 * @returns {{ status, value?, before?, after? }}
 *   status  'same' | 'change' | 'approx' | 'ambiguous' | 'manual'
 */
export function reroundStored(stored, market, { savedAfterCutoff = false } = {}) {
  const v = toNum(stored);
  if (v == null || v <= 0) return { status: 'same' };

  const m     = MARKETS[market];
  const raw   = v * m.vat;
  const shelf = round2(Math.round(raw / 0.05) * 0.05);
  if (Math.abs(raw - shelf) > SHELF_TOLERANCE) return { status: 'manual' };

  const cents = Math.round((shelf - Math.floor(shelf)) * 100);
  let after, status = 'change';

  if (cents === 95) {
    const H = Math.round(shelf + 0.05);    // old rule only: a round hundred, charmed
    if (m.oldSnap && H > PRESTIGE_50_FROM) { after = H; status = 'approx'; }
    else after = below(H);
  } else if (cents === 0) {
    const s = Math.round(shelf);
    if (s < PRESTIGE_50_FROM && s % 100 === 99) return { status: 'same' };   // already …99
    if (s % 5 !== 0) return { status: 'manual' };
    if (s < 100 || s === PRESTIGE_50_FROM) return { status: 'same' };
    if (s < PRESTIGE_50_FROM) {
      if (s % 100 === 0) return { status: 'manual' };   // neither rule leaves these
      after = below(s);
    } else if (s < PRESTIGE_100_FROM) {
      if (s % 100 === 0) return { status: 'same' };     // new rule only
      if (s % 50 === 0 && savedAfterCutoff) return { status: 'ambiguous' };
      after = below(s);
    } else {
      if (s % 100 === 0) return { status: 'same' };     // new rule only
      after = below(s);
    }
  } else {
    return { status: 'manual' };
  }

  const value = round2(after / m.vat);
  if (value === round2(v)) return { status: 'same' };
  return { status, value, before: shelf, after };
}

/**
 * Plans the whole re-round. Pure: no I/O.
 *
 * Prices flagged overridden are manual and never touched. The real_msrp_*
 * anchors are computed, never entered, so they always follow.
 *
 * @param items          pricing_master rows (source fields, prices, flags, updated_at)
 * @param ctx.rates      exchange rates to AED
 * @param ctx.rules      { [brand_code]: { markup, additional } }
 * @param ctx.cutoff     ISO time the new rule went live
 */
export function planRounding(items, { rates, rules, cutoff } = {}) {
  const cutoffMs = cutoff ? Date.parse(cutoff) : Infinity;
  const tally = {};
  const bump = (key, status) => {
    if (!tally[key]) tally[key] = { exact: 0, same: 0, change: 0, approx: 0, ambiguous: 0, manual: 0, overridden: 0 };
    tally[key][status]++;
  };

  const changes = [];
  for (const item of items) {
    const after = item.updated_at ? Date.parse(item.updated_at) > cutoffMs : false;
    const set = {}, lines = [];
    const record = (key, field, r, display) => {
      if (r.value == null || same(r.value, item[field])) return false;
      set[field] = r.value;
      if (display) lines.push({ market: key, before: shelfOf(item[field], MARKETS[key].vat), after: shelfOf(r.value, MARKETS[key].vat), status: r.status });
      return true;
    };

    // ── UAE: exact when the old pipeline reproduces what is stored ──
    const aed = MARKETS.aed;
    let aedNow = toNum(item.msrp_aed), aedRealNow = toNum(item.real_msrp_aed);
    const src = uaeSource(item, { rates, rules });
    let uaeExact = false;
    if (src) {
      const realOld = round2(legacyUaeShelf(src.shelf) / 1.05);
      const msrpOld = src.additional ? round2(legacyUaeShelf(realOld * (1 + src.additional / 100) * 1.05) / 1.05) : realOld;
      const realOk  = aedRealNow == null || same(aedRealNow, realOld);
      const msrpOk  = item[aed.flag] || same(aedNow, msrpOld);
      if (realOk && msrpOk) {
        uaeExact = true;
        const realNew = round2(prettifyShelf(src.shelf) / 1.05);
        const msrpNew = src.additional ? round2(applyAdditionalMarkupUAE(realNew, src.additional)) : realNew;
        if (aedRealNow != null) { record('aed', aed.real, { value: realNew, status: 'exact' }); aedRealNow = realNew; }
        if (item[aed.flag]) bump('aed', 'overridden');
        else { bump('aed', record('aed', aed.field, { value: msrpNew, status: 'exact' }, true) ? 'exact' : 'same'); aedNow = msrpNew; }
      }
    }
    if (!uaeExact) {
      if (item[aed.flag]) bump('aed', 'overridden');
      else {
        const r = reroundStored(item.msrp_aed, 'aed', { savedAfterCutoff: after });
        bump('aed', r.status);
        if (record('aed', aed.field, r, true)) aedNow = r.value;
      }
      const rr = reroundStored(item.real_msrp_aed, 'aed', { savedAfterCutoff: after });
      if (record('aed', aed.real, rr)) aedRealNow = rr.value;
    }

    // ── KSA and Qatar: derived from the UAE price, exact when that held ──
    for (const [key, legacy, fresh] of [['sar', legacyKSA, freshKSA], ['qat', legacyQAT, freshQAT]]) {
      const m = MARKETS[key];
      if (item[m.flag]) bump(key, 'overridden');
      else if (same(item[m.field], legacy(toNum(item.msrp_aed)))) {
        bump(key, record(key, m.field, { value: fresh(aedNow), status: 'exact' }, true) ? 'exact' : 'same');
      } else {
        const r = reroundStored(item[m.field], key, { savedAfterCutoff: after });
        bump(key, r.status);
        record(key, m.field, r, true);
      }
      if (item[m.real] != null) {
        if (same(item[m.real], legacy(toNum(item.real_msrp_aed)))) record(key, m.real, { value: fresh(aedRealNow), status: 'exact' });
        else record(key, m.real, reroundStored(item[m.real], key, { savedAfterCutoff: after }));
      }
    }

    if (Object.keys(set).length) {
      changes.push({
        item_code:  item.item_code,
        item_name:  item.item_name ?? '',
        brand_code: item.brand_code ?? null,
        set,
        // What the plan was computed from. The database applies the change only
        // while every one of these still holds, so an edit made between preview
        // and apply is never overwritten.
        expect: Object.fromEntries(Object.values(MARKETS).flatMap(m => [
          [m.field, toNum(item[m.field])], [m.real, toNum(item[m.real])],
        ])),
        lines,
        approx: lines.some(l => l.status === 'approx'),
      });
    }
  }

  return { changes, tally, scanned: items.length };
}
