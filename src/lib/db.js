// ─────────────────────────────────────────────────────────────
// DATA LAYER ENTRY POINT
// Routes every data call to either the live Supabase layer
// (db.live.js) or the in-memory demo layer (db.demo.js), chosen
// once at build time by the REACT_APP_DEMO flag. Components import
// from here and never need to know which backend is active.
// ─────────────────────────────────────────────────────────────
import { DEMO } from '../demo/demoConfig';
import * as live from './db.live';
import * as demo from '../demo/db.demo';

const impl = DEMO ? demo : live;

export const fetchRates                = (...a) => impl.fetchRates(...a);
export const updateRate                = (...a) => impl.updateRate(...a);
export const fetchBrands               = (...a) => impl.fetchBrands(...a);
export const addBrand                  = (...a) => impl.addBrand(...a);
export const fetchBrandRule            = (...a) => impl.fetchBrandRule(...a);
export const searchItems               = (...a) => impl.searchItems(...a);
export const fetchItem                 = (...a) => impl.fetchItem(...a);
export const saveItem                  = (...a) => impl.saveItem(...a);
export const deleteItem                = (...a) => impl.deleteItem(...a);
export const bulkSaveItems             = (...a) => impl.bulkSaveItems(...a);
export const fetchHistory              = (...a) => impl.fetchHistory(...a);
export const checkExisting             = (...a) => impl.checkExisting(...a);
export const fetchItemsByCodes         = (...a) => impl.fetchItemsByCodes(...a);
export const fetchItemList             = (...a) => impl.fetchItemList(...a);
export const fetchBrandsWithStats      = (...a) => impl.fetchBrandsWithStats(...a);
export const updateBrandMarkup         = (...a) => impl.updateBrandMarkup(...a);
export const updateBrandAdditionalMarkup = (...a) => impl.updateBrandAdditionalMarkup(...a);
export const insertBrand               = (...a) => impl.insertBrand(...a);
export const fetchAllPricesForExport   = (...a) => impl.fetchAllPricesForExport(...a);
export const fetchBrandItems           = (...a) => impl.fetchBrandItems(...a);
export const bulkUpdateMarkupPrices    = (...a) => impl.bulkUpdateMarkupPrices(...a);
export const insertPriceHistoryBatch   = (...a) => impl.insertPriceHistoryBatch(...a);
export const bulkInsertPriceHistory    = (...a) => impl.bulkInsertPriceHistory(...a);
export const fetchPriceHistoryBatches  = (...a) => impl.fetchPriceHistoryBatches(...a);
export const fetchBatchItems           = (...a) => impl.fetchBatchItems(...a);
export const fetchAllBatchItems        = (...a) => impl.fetchAllBatchItems(...a);
export const rollbackBatch             = (...a) => impl.rollbackBatch(...a);
export const fetchProjectItems         = (...a) => impl.fetchProjectItems(...a);
export const saveProjectItem           = (...a) => impl.saveProjectItem(...a);
export const deleteProjectItem         = (...a) => impl.deleteProjectItem(...a);
