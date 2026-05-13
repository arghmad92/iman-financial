// View all webinar registrations.
//
// Requires HTTP Basic auth — open in a browser and you'll get a native
// password prompt. Username is ignored; password is ADMIN_TOKEN.
//
// curl example:
//   curl -u :$ADMIN_TOKEN https://imanabdulrahim.com/api/admin/registrations

export async function onRequest({ env, request }) {
  if (!env.ADMIN_TOKEN) {
    return new Response('Admin not configured', { status: 503 });
  }

  const auth = request.headers.get('Authorization') || '';
  let password = '';
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      password = decoded.includes(':') ? decoded.split(':').slice(1).join(':') : decoded;
    } catch {
      // fall through to 401
    }
  }
  if (!password || !timingSafeEqual(password, env.ADMIN_TOKEN)) {
    return new Response('Authentication required', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Iman registrations"',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  }

  if (!env.REGISTRATIONS_DB) {
    return new Response('DB not bound', { status: 503 });
  }

  const { results } = await env.REGISTRATIONS_DB
    .prepare(
      `SELECT id, created_at, name, email, phone, tier, amount,
              status, bill_code, paid_at, zoom_sent
       FROM registrations
       ORDER BY created_at DESC`,
    )
    .all();

  const accept = request.headers.get('Accept') || '';
  if (accept.includes('application/json')) {
    return new Response(JSON.stringify({ count: results.length, rows: results }, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  }

  const html = renderHtml(results);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderHtml(rows) {
  const paid = rows.filter((r) => r.status === 'paid').length;
  const total = rows.length;
  const bodyRows = rows
    .map(
      (r) => `
      <tr>
        <td>${r.id}</td>
        <td>${escapeHtml(r.created_at)}</td>
        <td>${escapeHtml(r.name)}</td>
        <td><a href="mailto:${escapeHtml(r.email)}">${escapeHtml(r.email)}</a></td>
        <td>${escapeHtml(r.phone)}</td>
        <td>${escapeHtml(r.tier)}</td>
        <td>RM${r.amount}</td>
        <td class="status status--${escapeHtml(r.status)}">${escapeHtml(r.status)}</td>
        <td><code>${escapeHtml(r.bill_code)}</code></td>
        <td>${escapeHtml(r.paid_at) || '—'}</td>
        <td>${escapeHtml(r.zoom_sent) || '—'}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Registrations · Iman</title>
<meta name="robots" content="noindex, nofollow">
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem; color: #1a1216; background: #fefafb; }
  h1 { font-size: 1.5rem; margin: 0 0 0.25rem; }
  .meta { color: #84707a; margin: 0 0 1.5rem; font-size: 0.9rem; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #f0d4db; border-radius: 8px; overflow: hidden; }
  th, td { padding: 0.65rem 0.85rem; text-align: left; border-bottom: 1px solid #f6e6ea; vertical-align: top; font-size: 0.88rem; }
  th { background: #fcf1f4; font-weight: 600; color: #6b4452; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
  tr:last-child td { border-bottom: 0; }
  code { font-family: ui-monospace, Menlo, monospace; font-size: 0.82rem; color: #6b4452; }
  a { color: #c44569; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .status { font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .status--paid { color: #1a7a3d; }
  .status--pending { color: #b8851c; }
  .empty { padding: 2rem; text-align: center; color: #84707a; }
</style>
</head>
<body>
  <h1>Webinar registrations</h1>
  <p class="meta">${paid} paid · ${total - paid} pending · ${total} total</p>
  ${
    rows.length === 0
      ? '<div class="empty">No registrations yet.</div>'
      : `<table>
          <thead>
            <tr>
              <th>#</th><th>Created</th><th>Name</th><th>Email</th><th>Phone</th>
              <th>Tier</th><th>Amount</th><th>Status</th><th>Bill code</th>
              <th>Paid at</th><th>Zoom sent</th>
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>`
  }
</body>
</html>`;
}
