import { projectAsItem, PROJECT_BRAND } from './rows';

test('a project item matches like a catalogue row: UAE at its ex-VAT price, every market', () => {
  const p = {
    item_code: 'PRJT-ATLAS-01', project_item_name: 'Atlas Fleet Comms Kit',
    msrp_aed_inc_vat: 830, msrp_aed_ex_vat: 790.48, msrp_sar: 808.7, msrp_qat: 799, msrp_kwd: 66.5,
  };
  expect(projectAsItem(p)).toEqual({
    item_code: 'PRJT-ATLAS-01', item_name: 'Atlas Fleet Comms Kit', brand_code: PROJECT_BRAND, barcode: null,
    msrp_aed: 790.48, msrp_sar: 808.7, msrp_qat: 799, msrp_kwd: 66.5,
  });
});

test('a project item with no price yet has nulls, not zeros', () => {
  expect(projectAsItem({ item_code: 'PRJT-X' })).toMatchObject({ msrp_aed: null, msrp_sar: null, msrp_kwd: null });
});
