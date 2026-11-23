import { MARKETS } from '../../lib/markets';
import { money } from '../../lib/num';
import { t } from './styles';

/**
 * An item's company base cost in every company's currency, as one quiet line:
 * the EXW cost at the stored rates, what the group's companies bill each
 * other. Shows the values on the item it's given, so a saved item shows what
 * is stored and a form shows what will be saved. Nothing without a cost.
 */
export default function BaseCosts({ item, style }) {
  if (!MARKETS.some(m => item?.[m.baseCost] != null)) return null;
  return (
    <div style={{ fontSize: 11, color: t.t3, fontFamily: 'var(--font-mono)', lineHeight: 1.6, ...style }}>
      Company base cost · {MARKETS.map(m => money(item[m.baseCost], m.currency, 2)).join(' · ')}
    </div>
  );
}
