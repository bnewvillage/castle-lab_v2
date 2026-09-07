// ─────────────────────────────────────────────────────────────
// SHARED SEARCH PARSING
// Item List, its "Export all", the Single SKU picker and the Mass Override
// filter all have to interpret the search box identically — when this logic was
// duplicated they drifted, and only the export escaped its input.
// ─────────────────────────────────────────────────────────────

// Multi-term separator. Deliberately not a comma: item codes legitimately
// contain commas (e.g. "TSTI-10204,HMA-FE2,15FZ07CO2"), so a comma-separated
// search would shred a single code into several terms.
export const SEARCH_SEPARATOR = '//';

export const searchTerms = (raw) =>
  String(raw ?? '').split(SEARCH_SEPARATOR).map(s => s.trim()).filter(Boolean);

// Two separate escapes are needed, and conflating them was the original bug.
//
// Parens and commas are structural inside a PostgREST or() expression — a term
// containing them would be read as extra conditions rather than as text.
// % and _ are LIKE wildcards, so an unescaped "%" silently turns any search
// into match-everything; * is the wildcard in raw URL params. Backslash goes
// first, otherwise it would double-escape the escapes added after it.
export const escLike = (s) =>
  s.replace(/\\/g, '\\\\')
   .replace(/[%_*]/g, '\\$&')
   .replace(/[(),]/g, '\\$&');

/**
 * Builds the or() condition list for a search box value.
 * Every term matches against item_code OR item_name, and the terms are OR'd
 * together, so "A//B" returns everything matching A plus everything matching B.
 *
 * wildcard is '%' for the supabase-js query builder and '*' for raw URL params.
 * Returns '' when there is nothing to search on.
 */
export function orExpression(raw, wildcard = '%') {
  return searchTerms(raw).flatMap(term => {
    const q = escLike(term);
    return [
      `item_code.ilike.${wildcard}${q.toUpperCase()}${wildcard}`,
      `item_name.ilike.${wildcard}${q}${wildcard}`,
    ];
  }).join(',');
}

// Client-side equivalent, for the demo layer and any in-memory filtering.
export function matchesSearch(row, raw) {
  const terms = searchTerms(raw);
  if (!terms.length) return true;
  return terms.some(term => {
    const q = term.toLowerCase();
    return (row.item_code || '').toLowerCase().includes(q)
        || (row.item_name || '').toLowerCase().includes(q);
  });
}