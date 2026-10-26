import { t, groupBox, groupHead } from '../pricing/styles';
import { DERIVED } from '../../lib/markets';
import MarketRecalc from './MarketRecalc';

const RULE = [
  ['under 3,000',   'round up to 5, near-hundred snap, hundreds become …99 — the 3,000 mark stays 3,000'],
  ['3,000 – 4,999', 'round down to the 50'],
  ['5,000+',        'round down to the 100'],
];

// The rules every price is made by, and a recalculation for each market that
// has one (markets.js: recalcOp).
export default function PriceRules() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      <div style={groupBox(false)}>
        <div style={{ ...groupHead, marginBottom: 6 }}>Current rule</div>
        <div style={{ fontSize: 12.5, color: t.t4, marginBottom: 12 }}>
          Applied to the UAE shelf price, VAT-inclusive, and to KSA's and Qatar's. Every saved item follows it.
        </div>
        {RULE.map(([band, rule]) => (
          <div key={band} style={{ display: 'flex', gap: 16, padding: '7px 0', borderTop: `1px solid ${t.b1}`, fontSize: 13 }}>
            <span style={{ width: 110, color: t.t2, fontFamily: 'var(--font-mono)' }}>{band}</span>
            <span style={{ color: t.t3 }}>{rule}</span>
          </div>
        ))}
        <div style={{ fontSize: 12, color: t.t4, marginTop: 10, lineHeight: 1.6 }}>
          A brand's additional markup goes on the unrounded base, so UAE is rounded once. Every other market
          derives from the rounded UAE price:
        </div>
        {DERIVED.map(m => (
          <div key={m.key} style={{ display: 'flex', gap: 16, padding: '7px 0', borderTop: `1px solid ${t.b1}`, fontSize: 13 }}>
            <span style={{ width: 110, color: t.t2, fontFamily: 'var(--font-mono)' }}>{m.label}</span>
            <span style={{ color: t.t3 }}>{m.rule}</span>
          </div>
        ))}
        <div style={{ fontSize: 12, color: t.t4, marginTop: 10, lineHeight: 1.6 }}>
          Kuwait's ladder rounds up below 250 KD, with .900 at multiples of 5 and 10, then down to 5 from 250 KD and
          to 10 from 500 KD. Project items are quotes and are not recalculated here.
        </div>
      </div>

      {DERIVED.filter(m => m.recalcOp).map(m => <MarketRecalc key={m.key} market={m.key} />)}
    </div>
  );
}
