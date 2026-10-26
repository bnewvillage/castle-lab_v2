// ─────────────────────────────────────────────────────────────
// ERP REPORTS, ONE AT A TIME
// The price lists are separate ERP reports. Each is fetched on its own, so one
// that fails — a list not set up in the ERP yet, say — is reported and skipped
// while the others still come back. Only when EVERY report fails is it an
// error: that is the login or the ERP itself, not one missing list.
// ─────────────────────────────────────────────────────────────

// Why a report could not be fetched, in words for the screen.
export function reportFailureReason(err) {
  const m = err?.message ?? '';
  if (/report not found/i.test(m)) return 'not set up in the ERP yet';
  if (/unknown report/i.test(m))   return 'not yet allowed by the ERP proxy — redeploy erp-proxy';
  return m || 'request failed';
}

/**
 * @param reports    [{ key, name, currency, ... }]
 * @param fetchOne   (report) => Promise<rows>
 * @param onEach     optional (report, rows | null, reason?) => void, for a progress log
 * @returns { rows: { [key]: rows }, failed: [{ report, reason }] }
 * @throws  the first error, when every report fails
 */
export async function fetchReportsIndependently(reports, fetchOne, onEach) {
  const rows = {}, failed = [];
  let firstErr = null;
  for (const report of reports) {
    try {
      rows[report.key] = await fetchOne(report);
      onEach?.(report, rows[report.key]);
    } catch (err) {
      firstErr ??= err;
      const reason = reportFailureReason(err);
      failed.push({ report, reason });
      onEach?.(report, null, reason);
    }
  }
  if (reports.length && failed.length === reports.length) throw firstErr;
  return { rows, failed };
}
