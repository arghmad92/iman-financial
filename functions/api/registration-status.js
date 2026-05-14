// Public lookup of a registration row by bill code.
//
// Used by the post-payment landing page to render a real receipt.
// The bill code is an 8-char ToyyibPay identifier known only to the
// registrant and the system, so treating it as a soft secret is fine.

export async function onRequest({ env, request }) {
  if (!env.REGISTRATIONS_DB) {
    return json({ error: 'DB not bound' }, 503);
  }

  const url = new URL(request.url);
  const billCode = (url.searchParams.get('billCode') || '').trim();

  if (!billCode || !/^[a-z0-9]{4,32}$/i.test(billCode)) {
    return json({ error: 'Invalid bill code' }, 400);
  }

  const row = await env.REGISTRATIONS_DB
    .prepare(
      `SELECT name, amount, tier, status, created_at, paid_at, bill_code
       FROM registrations
       WHERE bill_code = ?1
       LIMIT 1`,
    )
    .bind(billCode)
    .first();

  if (!row) {
    return json({ error: 'Not found' }, 404);
  }

  return json({
    name: row.name,
    amount: row.amount,
    tier: row.tier,
    status: row.status,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    billCode: row.bill_code,
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
