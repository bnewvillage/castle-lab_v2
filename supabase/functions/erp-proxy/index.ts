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

// The caller's email from the JWT payload. Verifying the signature is
// Supabase's job (verify_jwt); we only read the claim it already validated.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsFor(req) });
  }

  try {
    if (!ERP_BASE) return json({ error: 'ERP_BASE not configured' }, 500, req);

    // An unconfigured allowlist fails closed rather than open.
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

    // ── default: fetch a named report ────────────────────────────
    if (!report_name) return json({ error: 'report_name or action required' }, 400, req);
    if (!ALLOWED_REPORTS.has(report_name)) return json({ error: 'Unknown report' }, 400, req);

    const reportRes = await fetch(
      `${ERP_BASE}/api/method/frappe.desk.query_report.run?report_name=${encodeURIComponent(report_name)}`,
      { headers: { 'Accept': 'application/json', 'Cookie': sessionCookie } }
    );
    if (!reportRes.ok) throw new Error(`Failed to fetch ${report_name} (${reportRes.status})`);
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
