// Set with: supabase secrets set ERP_BASE=https://your-erp-host
const ERP_BASE = (Deno.env.get('ERP_BASE') ?? '').replace(/\/+$/, '');

// Who may call this function. Supabase verifies the JWT before this runs, but
// that only proves the caller is *authenticated* — not that they are one of
// ours. Set with: supabase secrets set ERP_ALLOWED_EMAILS=a@x.com,b@x.com
const ALLOWED_EMAILS = new Set(
  (Deno.env.get('ERP_ALLOWED_EMAILS') ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
);

// The reports the app actually asks for. Without this the function is an
// arbitrary report reader for anyone holding ERP credentials.
const ALLOWED_REPORTS = new Set([
  'PRICE-AED_ValidFromLatest',
  'PRICE-SAR_ValidFromLatest',
  'PRICE-QAR_ValidFromLatest',
  // Allowed ahead of the ERP: until the report exists there, the proxy answers
  // "Report not found" and the app skips Kuwait without failing the rest.
  'PRICE-KWD_ValidFromLatest',
  'Item In Stock Without Price',
]);

// Browser origins permitted to call this. Set with:
// supabase secrets set ERP_ALLOWED_ORIGINS=https://castle-lab.web.app,http://localhost:3000
const ALLOWED_ORIGINS = (Deno.env.get('ERP_ALLOWED_ORIGINS') ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);

const corsFor = (req: Request) => {
  const origin = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : (ALLOWED_ORIGINS[0] ?? 'null'),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
};

// The caller's place on the app_users roster, asked of the database WITH the
// caller's own token. The database checks the token's signature, so a forged
// token is refused here whether or not the function's verify_jwt setting is
// on — and that setting does not work with Supabase's newer publishable keys,
// so it cannot be relied on. Fails closed: anything but a clear yes is no.
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');

async function rosterRole(req: Request): Promise<'admin' | 'viewer' | null> {
  const auth   = req.headers.get('authorization') ?? '';
  const apikey = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!SUPABASE_URL || !/^Bearer .+/i.test(auth) || !apikey) return null;
  const ask = async (fn: string) => {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method:  'POST',
        headers: { 'apikey': apikey, 'Authorization': auth, 'Content-Type': 'application/json' },
        body:    '{}',
        signal:  AbortSignal.timeout(10_000),
      });
      return res.ok ? (await res.json()) === true : false;
    } catch { return false; }
  };
  const [onRoster, admin] = await Promise.all([ask('is_app_user'), ask('is_app_admin')]);
  return onRoster ? (admin ? 'admin' : 'viewer') : null;
}

// The caller's email from the JWT payload, for the ERP_ALLOWED_EMAILS list.
// Only read after rosterRole() has had the database verify the token.
function callerEmail(req: Request): string | null {
  const raw = (req.headers.get('authorization') ?? '').replace(/^Bearer /i, '');
  const part = raw.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)));
    return typeof claims.email === 'string' ? claims.email.toLowerCase() : null;
  } catch { return null; }
}

const PAGE_SIZE   = 500;
const MAX_RETRIES = 3;
const RETRY_WAIT  = 2000;
const PAGE_WAIT   = 500;     // pause between pages — ERP resets the connection without it
// A healthy page returns in well under a second. This is only a ceiling on a
// dead connection, so keep it tight — it multiplies by MAX_RETRIES on a bad page.
const REQ_TIMEOUT = 20_000;
const MAX_PAGES   = 40;      // ceiling per invocation, to stay inside the function time limit

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const json = (body: unknown, status = 200, req?: Request) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...(req ? corsFor(req) : {}), 'Content-Type': 'application/json' },
  });

async function erpLogin(email: string, password: string): Promise<string> {
  const loginRes = await fetch(`${ERP_BASE}/api/method/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ usr: email, pwd: password }),
  });
  if (!loginRes.ok) {
    const errBody = await loginRes.json().catch(() => ({}));
    throw new Error((errBody as { message?: string })?.message || `Login failed (${loginRes.status})`);
  }
  const setCookie = loginRes.headers.get('set-cookie') ?? '';
  return setCookie.split(',').map(c => c.trim().split(';')[0]).join('; ');
}

// One page of the item list, retried with backoff the way the reference script does.
async function fetchItemPage(
  cookie: string, start: number, modifiedSince?: string,
): Promise<unknown[]> {
  const params = new URLSearchParams({
    limit_page_length: String(PAGE_SIZE),
    limit_start:       String(start),
    fields:            JSON.stringify(['item_code', 'item_name', 'brand', 'modified']),
    // Ascending so a mid-sync edit moves an item to the end of the set rather
    // than shifting it past the cursor and being skipped.
    order_by:          'modified asc',
  });
  if (modifiedSince) {
    params.set('filters', JSON.stringify([['modified', '>', modifiedSince]]));
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${ERP_BASE}/api/resource/Item?${params}`, {
        headers: { 'Accept': 'application/json', 'Cookie': cookie },
        signal:  AbortSignal.timeout(REQ_TIMEOUT),
      });
      if (!res.ok) throw new Error(`ERP item list error (${res.status})`);
      const body = await res.json();
      return Array.isArray((body as { data?: unknown[] }).data)
        ? (body as { data: unknown[] }).data
        : [];
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES - 1) await sleep(RETRY_WAIT);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('ERP item fetch failed');
}

// ── Open purchase requests ──────────────────────────────────────────────────
// Ported from runwayIQ's pipeline/erp_material_requests.py. A request is open
// when it is submitted, of type Purchase, and Pending or Partially Ordered;
// a LINE is open while it still has quantity not on a submitted PO.
// ordered_qty is kept in stock UOM, so the outstanding amount is
// stock_qty - ordered_qty, converted back to the line's UOM.
const OPEN_REQUEST_STATUSES = ['Pending', 'Partially Ordered'];

async function erpList(
  cookie: string, doctype: string, fields: string[], filters: unknown[], parent?: string,
): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({
    fields:            JSON.stringify(fields),
    filters:           JSON.stringify(filters),
    limit_page_length: '0',            // every match; callers keep `filters` narrow
  });
  // Child tables 403 unless the parent doctype is named: permission is
  // checked through the parent.
  if (parent) params.set('parent', parent);
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${ERP_BASE}/api/resource/${encodeURIComponent(doctype)}?${params}`, {
        headers: { 'Accept': 'application/json', 'Cookie': cookie },
        signal:  AbortSignal.timeout(REQ_TIMEOUT * 2),
      });
      if (!res.ok) {
        console.error(`${doctype} list error ${res.status}:`, (await res.text()).slice(0, 500));
        throw new Error(`ERP ${doctype} list error (${res.status})`);
      }
      const body = await res.json() as { data?: Record<string, unknown>[] };
      return Array.isArray(body.data) ? body.data : [];
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES - 1) await sleep(RETRY_WAIT);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`ERP ${doctype} fetch failed`);
}

const chunks = <T,>(xs: T[], n: number) =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const numOf = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0)) || 0;

async function openPurchaseRequests(cookie: string) {
  const headers = await erpList(cookie, 'Material Request',
    ['name', 'transaction_date', 'schedule_date', 'status', 'company', 'owner'],
    [['docstatus', '=', 1], ['material_request_type', '=', 'Purchase'], ['status', 'in', OPEN_REQUEST_STATUSES]]);
  if (!headers.length) return [];
  const byName = new Map(headers.map(h => [h.name as string, h]));

  // Every column of the line: naming fields one by one would make a single
  // field this ERP lacks fail the whole call.
  const items: Record<string, unknown>[] = [];
  for (const part of chunks([...byName.keys()], 40)) {
    items.push(...await erpList(cookie, 'Material Request Item', ['*'],
      [['parent', 'in', part]], 'Material Request'));
  }

  const open = items.map(it => {
    const h = byName.get(it.parent as string)!;
    const cf = numOf(it.conversion_factor) || 1;
    const stockQty = numOf(it.stock_qty) || numOf(it.qty) * cf;
    const outstandingStock = stockQty - numOf(it.ordered_qty);
    return {
      line_id:           it.name,
      request_id:        it.parent,
      idx:               it.idx,
      company:           h.company,
      request_status:    h.status,
      transaction_date:  h.transaction_date,
      owner:             h.owner,
      item_code:         it.item_code,
      item_name:         it.item_name,
      description:       it.description,
      brand:             it.brand ?? null,
      item_group:        it.item_group ?? null,
      qty:               numOf(it.qty),
      ordered_qty:       numOf(it.ordered_qty),
      outstanding_qty:   Math.round((outstandingStock / cf) * 1e6) / 1e6,
      uom:               it.uom,
      stock_uom:         it.stock_uom,
      conversion_factor: cf,
      schedule_date:     it.schedule_date || h.schedule_date,
      warehouse:         it.warehouse ?? null,
      sales_order:       it.sales_order ?? null,
      sales_order_item:  it.sales_order_item ?? null,
      expense_account:   it.expense_account ?? null,
      cost_center:       it.cost_center ?? null,
      project:           it.project ?? null,
      draft_pos:         [] as string[],
    };
  }).filter(l => l.outstanding_qty > 1e-9);

  // The ERP only counts a request as ordered when the PO is SUBMITTED, so a
  // line already on someone's draft PO still looks open. Name those drafts.
  const byLine = new Map(open.map(l => [l.line_id as string, l]));
  for (const part of chunks([...byLine.keys()], 60)) {
    const onDrafts = await erpList(cookie, 'Purchase Order Item', ['parent', 'material_request_item'],
      [['material_request_item', 'in', part], ['docstatus', '=', 0]], 'Purchase Order');
    for (const d of onDrafts) {
      const l = byLine.get(d.material_request_item as string);
      if (l && !l.draft_pos.includes(d.parent as string)) l.draft_pos.push(d.parent as string);
    }
  }

  return open.sort((a, b) =>
    String(a.schedule_date).localeCompare(String(b.schedule_date))
    || String(a.request_id).localeCompare(String(b.request_id))
    || numOf(a.idx) - numOf(b.idx));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsFor(req) });
  }

  try {
    if (!ERP_BASE) return json({ error: 'ERP_BASE not configured' }, 500, req);

    // A verified token on the app_users roster, first; then the ERP allowlist.
    // An unconfigured allowlist fails closed rather than open.
    const role = await rosterRole(req);
    if (!role) return json({ error: 'Not authorised' }, 403, req);
    const caller = callerEmail(req);
    if (ALLOWED_EMAILS.size === 0) return json({ error: 'Proxy not configured for any caller' }, 503, req);
    if (!caller || !ALLOWED_EMAILS.has(caller)) return json({ error: 'Not authorised' }, 403, req);

    const body = await req.json() as {
      email?: string;
      password?: string;
      action?: string;
      report_name?: string;
      limit_start?: number;
      pages?: number;
      modified_since?: string;
    };
    const { email, password, action, report_name } = body;

    if (!email || !password) return json({ error: 'email and password required' }, 400, req);
    // Building POs is for admins — enforced here, not only in the screen.
    if (action === 'purchase_requests' && role !== 'admin') return json({ error: 'Admins only' }, 403, req);

    const sessionCookie = await erpLogin(email, password);

    // ── action: 'items' — walk several pages on a single login ───────
    // The client resumes with nextStart, so one login covers `pages` requests
    // instead of one, without accumulating the whole catalogue in memory.
    if (action === 'items') {
      const pages = Math.min(Math.max(Number(body.pages ?? 10), 1), MAX_PAGES);
      const items: unknown[] = [];
      let cursor = Number(body.limit_start ?? 0);
      let done   = false;

      for (let p = 0; p < pages; p++) {
        const data = await fetchItemPage(sessionCookie, cursor, body.modified_since);
        if (data.length === 0) { done = true; break; }
        items.push(...data);
        cursor += data.length;
        if (data.length < PAGE_SIZE) { done = true; break; }
        if (p < pages - 1) await sleep(PAGE_WAIT);
      }

      return json({ items, nextStart: cursor, done }, 200, req);
    }

    // ── action: 'purchase_requests' — open purchase-request lines ────
    if (action === 'purchase_requests') {
      return json({ lines: await openPurchaseRequests(sessionCookie) }, 200, req);
    }

    // ── default: fetch a named report ────────────────────────────
    if (!report_name) return json({ error: 'report_name or action required' }, 400, req);
    if (!ALLOWED_REPORTS.has(report_name)) return json({ error: 'Unknown report' }, 400, req);

    const reportRes = await fetch(
      `${ERP_BASE}/api/method/frappe.desk.query_report.run?report_name=${encodeURIComponent(report_name)}`,
      { headers: { 'Accept': 'application/json', 'Cookie': sessionCookie } }
    );
    if (!reportRes.ok) {
      // A report the ERP doesn't have is a normal answer, not a failure: the
      // app skips that list and carries on with the others. Frappe signals it
      // as 404, or as DoesNotExistError in the body.
      const text = await reportRes.text().catch(() => '');
      if (reportRes.status === 404 || /DoesNotExistError/.test(text)) {
        return json({ error: 'Report not found in the ERP' }, 404, req);
      }
      console.error(`${report_name} error ${reportRes.status}:`, text.slice(0, 500));
      throw new Error(`Failed to fetch ${report_name} (${reportRes.status})`);
    }
    const reportBody = await reportRes.json();
    const message = (reportBody as {
      message?: { result?: unknown[]; columns?: unknown[] };
    }).message ?? {};
    const rawRows = message.result ?? [];

    // Frappe column defs come either as objects or as "Label:Type/Opts:width"
    // strings, depending on how the report was authored.
    const fieldnames = (message.columns ?? []).map((col) => {
      if (typeof col === 'string') {
        const label = col.split(':')[0];
        return label.trim().toLowerCase().replace(/\s+/g, '_');
      }
      const c = col as { fieldname?: string; label?: string };
      return c.fieldname ?? (c.label ?? '').trim().toLowerCase().replace(/\s+/g, '_');
    });

    // Some reports return positional arrays instead of dicts — zip those against
    // the column list so the client always receives objects.
    const rows = rawRows.map((r) =>
      Array.isArray(r)
        ? Object.fromEntries(fieldnames.map((f, i) => [f || `col_${i}`, r[i]]))
        : r
    );

    return json({ rows, columns: fieldnames }, 200, req);

  } catch (err) {
    // Upstream text can carry ERP internals and login-failure detail, so it is
    // logged for operators and flattened for the caller.
    console.error('erp-proxy failure:', err);
    return json({ error: 'ERP request failed' }, 502, req);
  }
});
