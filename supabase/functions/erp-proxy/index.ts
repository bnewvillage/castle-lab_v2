// Set with: supabase secrets set ERP_BASE=https://your-erp-host
const ERP_BASE = (Deno.env.get('ERP_BASE') ?? '').replace(/\/+$/, '');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PAGE_SIZE   = 500;
const MAX_RETRIES = 3;
const RETRY_WAIT  = 2000;
const PAGE_WAIT   = 500;     // pause between pages — ERP resets the connection without it
// A healthy page returns in well under a second. This is only a ceiling on a
// dead connection, so keep it tight — it multiplies by MAX_RETRIES on a bad page.
const REQ_TIMEOUT = 20_000;
const MAX_PAGES   = 40;      // ceiling per invocation, to stay inside the function time limit

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!ERP_BASE) return json({ error: 'ERP_BASE not configured' }, 500);

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

    if (!email || !password) return json({ error: 'email and password required' }, 400);

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

      return json({ items, nextStart: cursor, done });
    }

    // ── default: fetch a named report ────────────────────────────
    if (!report_name) return json({ error: 'report_name or action required' }, 400);

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

    return json({ rows, columns: fieldnames });

  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
