import { useState, useRef, useEffect, useMemo } from 'react';
import { t, inp } from './styles';

/**
 * BrandSelect — searchable combobox for brand_code.
 *
 * Props:
 *   brands      [{ brand_code, brand_name }]   full list from DB
 *   value       string   currently selected brand_code ('' = none)
 *   onChange    (brand_code: string) => void
 *   placeholder string   shown when value is empty (default 'Select brand')
 *   nullable    bool     if true, shows a "Clear" option and allows empty value
 *   hasError    bool     red border state
 *   disabled    bool
 *   style       object   extra wrapper styles
 */
export default function BrandSelect({
  brands = [],
  value = '',
  onChange,
  placeholder = 'Select brand',
  nullable = false,
  hasError = false,
  disabled = false,
  style = {},
}) {
  const [open,        setOpen]        = useState(false);
  const [query,       setQuery]       = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  const selected = brands.find(b => b.brand_code === value) ?? null;

  // What the input shows when closed vs open
  const inputDisplay = open
    ? query
    : selected
      ? `${selected.brand_code} — ${selected.brand_name}`
      : '';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter(b =>
      b.brand_code.toLowerCase().includes(q) ||
      b.brand_name.toLowerCase().includes(q)
    );
  }, [brands, query]);

  // Keep highlight in bounds when filter changes
  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) return;
    const startIdx = nullable ? 1 : 0;
    const child = listRef.current.children[highlighted + startIdx];
    child?.scrollIntoView({ block: 'nearest' });
  }, [highlighted, nullable]);

  const handleSelect = (brand) => {
    onChange(brand ? brand.brand_code : '');
    setQuery('');
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const match = filtered[highlighted];
      if (match) handleSelect(match);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    } else if (e.key === 'Tab') {
      setOpen(false);
      setQuery('');
    }
  };

  const handleFocus = () => {
    if (disabled) return;
    setOpen(true);
    setQuery('');
    setHighlighted(0);
  };

  const handleBlur = () => {
    // Small delay so click on list item fires before blur
    setTimeout(() => {
      setOpen(false);
      setQuery('');
    }, 150);
  };

  const handleInputChange = (e) => {
    setQuery(e.target.value);
    setOpen(true);
  };

  const borderColor = () => {
    if (hasError)  return 'rgba(242,100,100,0.6)';
    if (value)     return 'rgba(62,207,142,0.4)';
    return t.b2;
  };

  return (
    <div style={{ position: 'relative', ...style }}>
      <input
        ref={inputRef}
        value={inputDisplay}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        style={{
          ...inp(!!value, hasError),
          width: '100%',
          borderColor: borderColor(),
          cursor: disabled ? 'not-allowed' : 'text',
          opacity: disabled ? 0.5 : 1,
          paddingRight: 28,
        }}
      />
      {/* Chevron indicator */}
      <span style={{
        position: 'absolute', right: 10, top: '50%', transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)`,
        color: t.t4, fontSize: 10, pointerEvents: 'none', transition: 'transform 0.15s',
        lineHeight: 1,
      }}>▼</span>

      {open && (
        <div ref={listRef} style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300,
          background: t.bg2, border: `1px solid ${t.b3}`, borderRadius: 8,
          maxHeight: 260, overflowY: 'auto', marginTop: 3,
          boxShadow: '0 8px 32px rgba(0,0,0,0.65)',
        }}>
          {/* Clear option */}
          {nullable && (
            <div
              onMouseDown={() => handleSelect(null)}
              style={{
                padding: '8px 14px',
                cursor: 'pointer',
                fontSize: 12,
                color: t.t4,
                fontStyle: 'italic',
                borderBottom: `1px solid ${t.b1}`,
                background: 'transparent',
              }}
              onMouseEnter={e => e.currentTarget.style.background = t.bg3}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {placeholder}
            </div>
          )}

          {filtered.length === 0 ? (
            <div style={{ padding: '10px 14px', fontSize: 12, color: t.t4, fontStyle: 'italic' }}>
              No brands match "{query}"
            </div>
          ) : (
            filtered.map((b, i) => {
              const isHighlighted = i === highlighted;
              return (
                <div
                  key={b.brand_code}
                  onMouseDown={() => handleSelect(b)}
                  onMouseEnter={() => setHighlighted(i)}
                  style={{
                    padding: '8px 14px',
                    background: isHighlighted ? t.bg3 : 'transparent',
                    cursor: 'pointer',
                    borderBottom: i < filtered.length - 1 ? `1px solid ${t.b1}` : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    transition: 'background 0.08s',
                  }}
                >
                  <span style={{
                    fontSize: 12, color: t.blue, fontFamily: 'var(--font-mono)',
                    fontWeight: 600, minWidth: 56, flexShrink: 0,
                  }}>
                    {b.brand_code}
                  </span>
                  <span style={{ fontSize: 12, color: t.t2 }}>
                    {b.brand_name}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
