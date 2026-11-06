import { calcEmployeePrices } from '../../lib/pricing';
import { MARKETS } from '../../lib/markets';
import { t } from './styles';

// An employee price to the decimals its rounding keeps: 1,580 AED, 132.7 KWD.
const fmt = (m, v) => {
  const dp = m.employeeStep < 1 ? 1 : 0;
  return `${m.currency} ${v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
};

/**
 * The employee price in every company's currency (landed cost + 15%), as one
 * muted line: the least important figure on the screen, so it sits last and
 * quiet. Nothing without a landed cost.
 */
export default function EmployeePrices({ item, rates, style }) {
  const prices = calcEmployeePrices(item, rates);
  if (!prices) return null;
  return (
    <div style={{ fontSize: 11, color: t.t4, fontFamily: 'var(--font-mono)', lineHeight: 1.6, ...style }}>
      Employee price · {MARKETS.map(m => fmt(m, prices[m.key])).join(' · ')}
    </div>
  );
}
