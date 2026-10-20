// ─────────────────────────────────────────────────────────────
// THE APP'S MAP — one definition for the sidebar, the Overview page and the
// eyebrow above each page title, so the three can't drift apart.
//
// Grouped by the job at hand:
//   Catalogue  the items themselves — add, import, edit, look up
//   Pricing    the rules that set prices, and undoing price changes
//   ERP        everything that reads from the ERP or makes a file for it
// ─────────────────────────────────────────────────────────────
import {
  IconGrid, IconTag, IconUpload, IconList, IconBookmark, IconFolder, IconRefresh,
  IconHistory, IconFileExport, IconPercent, IconCart, IconEdit, IconSearch, IconCheckList,
  IconLayers, IconZap,
} from './icons';

export const NAV = [
  {
    group: 'Workspace',
    items: [
      { label: 'Overview', icon: IconGrid, path: '/apps' },
    ],
  },
  {
    group: 'Catalogue',
    icon: IconLayers, accent: '#4d9fff',
    description: 'The items themselves — browse, add one, import many, bulk-edit, and look up costs.',
    items: [
      { label: 'Item List',     icon: IconList,   path: '/apps/pricing-master/list' },
      { label: 'Single SKU',    icon: IconTag,    path: '/apps/pricing-master/single' },
      { label: 'Bulk Import',   icon: IconUpload, path: '/apps/pricing-master/bulk' },
      { label: 'Bulk Edit',     icon: IconEdit,   path: '/apps/pricing-master/edit' },
      { label: 'Cost Lookup',   icon: IconSearch, path: '/apps/others/cost-lookup' },
      { label: 'Project Items', icon: IconFolder, path: '/apps/pricing-master/project' },
    ],
  },
  {
    group: 'Pricing',
    icon: IconPercent, accent: '#f5a623',
    description: 'The rules that set selling prices across UAE, KSA and Qatar — and the history to undo a change.',
    items: [
      { label: 'Brands',         icon: IconBookmark, path: '/apps/pricing-master/brands' },
      { label: 'Global Markup',  icon: IconPercent,  path: '/apps/others/global-markup' },
      { label: 'Price Rounding', icon: IconRefresh,  path: '/apps/others/rounding' },
      { label: 'Rollback',       icon: IconHistory,  path: '/apps/pricing-master/rollback' },
    ],
  },
  {
    group: 'ERP',
    icon: IconZap, accent: '#3ecf8e',
    description: 'Files to upload to the ERP, and checks of the catalogue against what the ERP holds.',
    items: [
      { label: 'Price Lists',      icon: IconFileExport, path: '/apps/others/erp-export' },
      { label: 'Catalogue Checks', icon: IconCheckList,  path: '/apps/others/erp-checks' },
      { label: 'Purchase Order',   icon: IconCart,       path: '/apps/others/purchase-order' },
    ],
  },
];

// The group a path belongs to — the eyebrow above a page's title.
export const groupOf = (path) => NAV.find(g => g.items.some(i => i.path === path))?.group ?? '';
