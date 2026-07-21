// Set with: supabase secrets set ERP_BASE=https://your-erp-host
const ERP_BASE = Deno.env.get('ERP_BASE') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!ERP_BASE) {
      return new Response(JSON.stringify({ error: 'ERP_BASE not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { email, password, report_name } = await req.json();
    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'email and password required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!report_name) {
      return new Response(JSON.stringify({ error: 'report_name required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Login
    const loginRes = await fetch(`${ERP_BASE}/api/method/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ usr: email, pwd: password }),
    });

    if (!loginRes.ok) {
      const body = await loginRes.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: body?.message || `Login failed (${loginRes.status})` }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract session cookie
    const setCookie = loginRes.headers.get('set-cookie') ?? '';
    const sessionCookie = setCookie.split(',')
      .map(c => c.trim().split(';')[0])
      .join('; ');

    // Fetch single report
    const reportRes = await fetch(
      `${ERP_BASE}/api/method/frappe.desk.query_report.run?report_name=${encodeURIComponent(report_name)}`,
      { headers: { 'Accept': 'application/json', 'Cookie': sessionCookie } }
    );
    if (!reportRes.ok) throw new Error(`Failed to fetch ${report_name} (${reportRes.status})`);
    const json = await reportRes.json();
    const rows = json.message?.result ?? [];

    return new Response(JSON.stringify({ rows }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message ?? 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
