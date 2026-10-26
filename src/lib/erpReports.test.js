import { fetchReportsIndependently, reportFailureReason } from './erpReports';

const REPORTS = [
  { key: 'aed', name: 'PRICE-AED_ValidFromLatest' },
  { key: 'sar', name: 'PRICE-SAR_ValidFromLatest' },
  { key: 'kwd', name: 'PRICE-KWD_ValidFromLatest' },
  { key: 'qar', name: 'PRICE-QAR_ValidFromLatest' },
];

test('a report that is not set up in the ERP is skipped; the others still come back', async () => {
  const fetchOne = async (r) => {
    if (r.key === 'kwd') throw new Error('Report not found in the ERP');
    return [{ item_code: `${r.key}-1` }];
  };
  const log = [];
  const { rows, failed } = await fetchReportsIndependently(REPORTS, fetchOne, (r, got, why) => log.push([r.key, !!got, why]));
  expect(Object.keys(rows)).toEqual(['aed', 'sar', 'qar']);           // QAR still fetched after the KWD failure
  expect(failed).toEqual([{ report: REPORTS[2], reason: 'not set up in the ERP yet' }]);
  expect(log).toEqual([['aed', true, undefined], ['sar', true, undefined], ['kwd', false, 'not set up in the ERP yet'], ['qar', true, undefined]]);
});

test('every report failing is an error — the login or the ERP, not one missing list', async () => {
  await expect(fetchReportsIndependently(REPORTS, async () => { throw new Error('ERP request failed'); }))
    .rejects.toThrow('ERP request failed');
});

test('failure reasons in words', () => {
  expect(reportFailureReason(new Error('Report not found in the ERP'))).toBe('not set up in the ERP yet');
  expect(reportFailureReason(new Error('Unknown report'))).toBe('not yet allowed by the ERP proxy — redeploy erp-proxy');
  expect(reportFailureReason(new Error('ERP request failed'))).toBe('ERP request failed');
  expect(reportFailureReason(null)).toBe('request failed');
});
