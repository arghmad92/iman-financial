import {
  incSeatsTaken,
  sheetsCall,
  getToyyibpayBase,
} from '../_lib.js';

// ToyyibPay payment callback (server-to-server).
// Called every time a bill's status changes. We only act on status=1 (success).
export async function onRequest(context) {
  try {
    const formData = await context.request.formData();
    const status = formData.get('status') || '';
    const billCode = formData.get('billcode') || '';
    const orderId = formData.get('order_id') || ''; // ToyyibPay's external ref

    // 1 = success, 2 = pending, 3 = failed
    if (status !== '1') {
      return new Response('OK', { status: 200 });
    }

    const env = context.env;

    // Look up the bill's payment record to get name/email
    const TOYYIBPAY_SECRET =
      env.TOYYIBPAY_SECRET || 'n2iltwy6-pmio-xjh9-6wia-u76b5pz5hanz';
    const TOYYIBPAY_BASE = getToyyibpayBase(env);
    const billData = new URLSearchParams();
    billData.append('userSecretKey', TOYYIBPAY_SECRET);
    billData.append('billCode', billCode);

    const billRes = await fetch(
      `${TOYYIBPAY_BASE}/index.php/api/getBillTransactions`,
      { method: 'POST', body: billData },
    );
    const transactions = await billRes.json();
    const tx = transactions?.[0];

    if (!tx) {
      console.error('No transaction found for billCode:', billCode);
      return new Response('OK', { status: 200 });
    }

    const email = tx.billEmail || '';
    const name = tx.billTo || '';

    // Increment paid-seat count (best-effort)
    await incSeatsTaken(env).catch((e) =>
      console.error('KV increment failed:', e),
    );

    // Send confirmation email with Zoom link
    let zoomSent = false;
    if (email && env.RESEND_KEY) {
      const sendResult = await sendConfirmationEmail({
        env,
        to: email,
        name,
        orderId,
      });
      zoomSent = !!sendResult?.ok;
    } else if (!env.RESEND_KEY) {
      console.warn('RESEND_KEY not set — skipping confirmation email');
    }

    // Update Sheet row to "paid"
    await sheetsCall(env, {
      action: 'mark_paid',
      billCode,
      zoomSent,
    });

    return new Response('OK', { status: 200 });
  } catch (e) {
    console.error('Callback error:', e);
    // Always 200 — ToyyibPay retries on non-200, and we don't want that.
    return new Response('OK', { status: 200 });
  }
}

async function sendConfirmationEmail({ env, to, name, orderId }) {
  const from =
    env.RESEND_FROM || 'Iman Abdul Rahim <hello@imanabdulrahim.com>';
  const zoomUrl = env.ZOOM_JOIN_URL || '';
  const zoomBlock = zoomUrl
    ? `
      <p style="margin:1.5rem 0 0.5rem;color:#1f0e14;font-weight:600">Join the webinar</p>
      <p style="margin:0 0 1rem">
        <a href="${zoomUrl}"
           style="display:inline-block;background:#c9234a;color:#ffffff;padding:14px 24px;border-radius:999px;text-decoration:none;font-weight:500">
          Open in Zoom
        </a>
      </p>
      <p style="margin:0 0 1rem;font-size:0.9rem;color:#6b4452;word-break:break-all">
        Or copy this link: <a href="${zoomUrl}" style="color:#c9234a">${zoomUrl}</a>
      </p>
    `
    : `
      <p style="margin:1.5rem 0 0.5rem;color:#1f0e14;font-weight:600">Zoom link</p>
      <p style="margin:0 0 1rem;color:#6b4452">
        We'll send your Zoom link in a separate email closer to the event date.
      </p>
    `;

  const subject = 'Confirmed! Cashflow Girlies Webinar — 22 May 2026';
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1f0e14;background:#fefafb">
      <h1 style="font-size:1.7rem;font-weight:600;letter-spacing:-0.02em;margin:0 0 0.5rem">
        You're in${name ? `, ${escapeHtml(name)}` : ''}.
      </h1>
      <p style="color:#4a3340;line-height:1.6;margin:0 0 1.5rem">
        Payment confirmed. Your seat for the Cashflow Girlies webinar is locked in.
      </p>

      <div style="background:#ffffff;border:1px solid #f0d4db;border-radius:16px;padding:1.25rem 1.5rem;margin:0 0 1.5rem">
        <p style="margin:0;color:#1f0e14;font-weight:600">Cashflow Girlies</p>
        <p style="margin:0.4rem 0 0.85rem;color:#6b4452;font-size:0.92rem">
          Cara uruskan cukai for freelancers &amp; content creators
        </p>
        <table style="font-size:0.92rem;color:#4a3340;line-height:1.7">
          <tr><td style="padding-right:1rem;color:#84707a">Date</td><td>22 May 2026</td></tr>
          <tr><td style="padding-right:1rem;color:#84707a">Time</td><td>8:00 PM (MYT)</td></tr>
          <tr><td style="padding-right:1rem;color:#84707a">Platform</td><td>Zoom</td></tr>
          ${orderId ? `<tr><td style="padding-right:1rem;color:#84707a">Reference</td><td>${escapeHtml(orderId)}</td></tr>` : ''}
        </table>
      </div>

      ${zoomBlock}

      <p style="color:#4a3340;line-height:1.65;margin:1.5rem 0 0">
        Save the date and add it to your calendar. We'll send a reminder one
        day before. If you have any questions, just reply to this email.
      </p>

      <p style="color:#4a3340;margin:2rem 0 0">
        See you there,<br>
        <strong>Iman Abdul Rahim</strong><br>
        <span style="font-size:0.85rem;color:#84707a">Licensed Financial Planner · CFP® · IFP</span>
      </p>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.RESEND_KEY}`,
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        html,
        reply_to: env.REPLY_TO || 'hello@imanabdulrahim.com',
      }),
    });
    if (!res.ok) {
      console.error('Resend error:', await res.text());
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error('Resend exception:', e);
    return { ok: false };
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
