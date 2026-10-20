// ─────────────────────────────────────────────────────────────
// ERP PROXY CLIENT — the one way the app talks to the ERP.
// Every call goes through the erp-proxy edge function with the user's own ERP
// login, which the proxy uses for that one request and never stores.
// ─────────────────────────────────────────────────────────────
import { supabase } from './supabase';
import { DEMO } from '../demo/demoConfig';
import { demoPurchaseRequests } from '../demo/demoErp';

const PROXY_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/erp-proxy`;

export async function callErpProxy(email, password, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
      'apikey':        process.env.REACT_APP_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Proxy error (${res.status})`);
  return json;
}

/**
 * Open purchase-request lines: submitted Material Requests of type Purchase,
 * each line with quantity not yet on a submitted PO, and the draft POs any of
 * them already sit on.
 */
export async function fetchPurchaseRequests({ email, password }) {
  if (DEMO) return demoPurchaseRequests();
  try {
    return (await callErpProxy(email, password, { action: 'purchase_requests' })).lines ?? [];
  } catch (e) {
    // An erp-proxy deployed before this action existed answers like this.
    if (/report_name or action required/.test(e.message)) {
      throw new Error('The ERP proxy needs updating before purchase requests can be pulled — deploy the new erp-proxy function.');
    }
    throw e;
  }
}
