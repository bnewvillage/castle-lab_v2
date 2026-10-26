// ─────────────────────────────────────────────────────────────
// RECALCULATE A MARKET FROM UAE
// Re-derives one market's stored prices from the stored UAE price with the
// current rule (markets.js). Nothing is inferred: the UAE price is the input,
// so the result is exactly what saving the item today would give that market.
// No other market is touched. Pure: no I/O.
// ─────────────────────────────────────────────────────────────
import { toNum, round } from './num';
import { MARKET, MARKETS, UAE, deriveMarket, shelfOf } from './markets';

// To the fils: dinar prices carry 3 decimals; the others are 2dp, so for them
// this is the same comparison as to 2 places.
const same = (a, b) => a != null && b != null && round(a, 3) === round(b, 3);

/**
 * Plans one derived market's recalculation (key: 'sar', 'kwd', …).
 *
 * A market with no price yet (Kuwait at launch) is filled. A price that differs
 * from what its UAE price gives today was not left that way by the rule:
 * usually the UAE price was changed by hand afterwards, or a Mass Override left
 * this market unchanged on purpose. That is no reason to overwrite it, so those
 * are listed and moved only with includeOutOfStep.
 *
 * Skipped: the market overridden (hand-set), and no UAE price to derive from.
 * The base price (real_msrp_*) follows real_msrp_aed the same way.
 *
 * tally: change (shelf price fills or moves) · outOfStep (doesn't follow UAE;
 *        moved only with includeOutOfStep) · baseOnly (only the base price
 *        moves) · same · overridden · noUae
 */
export function planMarketRecalc(items, key, { includeOutOfStep = false } = {}) {
  const m = MARKET[key];
  const tally = { change: 0, outOfStep: 0, baseOnly: 0, same: 0, overridden: 0, noUae: 0 };
  const changes = [], outOfStep = [];
  for (const item of items) {
    if (item[m.flag]) { tally.overridden++; continue; }
    const aed = toNum(item[UAE.price]);
    if (aed == null) { tally.noUae++; continue; }
    const set = {}, lines = [];
    const next = deriveMarket(m, aed);
    let stepped = false;
    if (!same(next, item[m.price])) {
      const line = { market: key, before: shelfOf(m, item[m.price]), after: shelfOf(m, next), status: 'change' };
      if (item[m.price] == null) {
        set[m.price] = next; lines.push(line);
      } else {
        stepped = true;
        outOfStep.push({ ...line, code: item.item_code, name: item.item_name ?? '', uae: shelfOf(UAE, aed) });
        if (includeOutOfStep) { set[m.price] = next; lines.push({ ...line, status: 'outOfStep' }); }
      }
    }
    const realAed = toNum(item[UAE.real]);
    if (realAed != null) {
      const realNext = deriveMarket(m, realAed);
      if (!same(realNext, item[m.real]) && (item[m.real] == null || includeOutOfStep)) set[m.real] = realNext;
    }
    if (stepped) tally.outOfStep++;
    if (!Object.keys(set).length) { if (!stepped) tally.same++; continue; }
    // A base-price-only change is still written, though no shelf price moves.
    if (!stepped) tally[lines.length ? 'change' : 'baseOnly']++;
    changes.push({
      item_code:  item.item_code,
      item_name:  item.item_name ?? '',
      brand_code: item.brand_code ?? null,
      set,
      // What the plan was computed from. The database applies the change only
      // while every one of these still holds, so an edit made between preview
      // and apply is never overwritten.
      expect: Object.fromEntries(MARKETS.flatMap(mk => [
        [mk.price, toNum(item[mk.price])], [mk.real, toNum(item[mk.real])],
      ])),
      lines,
    });
  }
  return { changes, outOfStep, tally, scanned: items.length };
}
