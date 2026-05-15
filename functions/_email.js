// Shared email rendering + send.
// Used by /api/payment-callback (real) and /api/register-webinar (mock mode).

/**
 * Send the confirmation/receipt email via Resend.
 * No-ops gracefully and returns { ok: false } if RESEND_KEY isn't set.
 */
export async function sendConfirmationEmail({
  env,
  to,
  name,
  orderId,
  billCode,
  amount,
  tier,
  paidAt,
}) {
  if (!to || !env.RESEND_KEY) {
    return { ok: false, reason: 'RESEND_KEY or recipient missing' };
  }

  const from =
    env.RESEND_FROM || 'Iman Abdul Rahim <hello@imanabdulrahim.com>';
  const replyTo = env.REPLY_TO || 'hello@imanabdulrahim.com';
  const zoomUrl = env.ZOOM_JOIN_URL || '';

  const paidOnFmt = formatPaidDate(paidAt || new Date());
  const amountFmt =
    typeof amount === 'number' ? `RM ${amount.toFixed(2)}` : '—';
  const tierDisplay = tier || '—';

  // Google Calendar add-to-cal link — 22 May 2026, 8:00–10:00 PM MYT (UTC+8).
  const calLink =
    'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent('Cashflow Girlies Webinar') +
    '&dates=20260522T120000Z/20260522T140000Z' +
    '&details=' + encodeURIComponent(
      'Cara uruskan cukai for freelancers & content creators. ' +
      'Zoom link will be emailed one day before.',
    ) +
    '&ctz=Asia/Kuala_Lumpur';

  const subject = `Receipt · Cashflow Girlies Webinar — RM ${amount ?? ''}`;

  const text = renderPlainText({
    name,
    tier: tierDisplay,
    amount: amountFmt,
    orderId,
    billCode,
    paidOn: paidOnFmt,
    zoomUrl,
    calLink,
  });

  const html = renderHtml({
    name,
    tier: tierDisplay,
    amount: amountFmt,
    orderId,
    billCode,
    paidOn: paidOnFmt,
    zoomUrl,
    calLink,
  });

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
        text,
        reply_to: replyTo,
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

/** Format a Date as "14 May 2026, 9:32 PM MYT". */
function formatPaidDate(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const dayPeriod = (get('dayPeriod') || '').toUpperCase();
  return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')} ${dayPeriod} MYT`;
}

function renderPlainText(d) {
  const refLine = d.orderId ? `Reference     ${d.orderId}\n` : '';
  const zoomBlock = d.zoomUrl
    ? `JOIN THE WEBINAR\n${d.zoomUrl}\n`
    : `Zoom link will be emailed one day before the event.\n`;
  return `You're in${d.name ? `, ${d.name}` : ''}.

Payment confirmed — keep this email as your receipt.

==============================================
RECEIPT
==============================================

CASHFLOW GIRLIES
Cara uruskan cukai for freelancers & content creators

EVENT
----------------------------------------------
Date          22 May 2026
Time          8:00 PM (MYT)
Platform      Zoom

PAYMENT
----------------------------------------------
Tier          ${d.tier}
Method        FPX via ToyyibPay
${refLine}Bill code     ${d.billCode || '—'}
Paid on       ${d.paidOn}

----------------------------------------------
TOTAL PAID                          ${d.amount}
==============================================

${zoomBlock}
WHAT'S NEXT
1. Add to your calendar:
   ${d.calLink}
2. ${d.zoomUrl ? "We'll also send a reminder one day before the webinar." : "We'll email the Zoom link one day before the webinar."}
3. Questions? Just reply to this email.

See you there,
Iman Abdul Rahim
Licensed Financial Planner · CFP® · IFP
`;
}

function renderHtml(d) {
  const safeName = d.name ? `, ${escapeHtml(d.name)}` : '';
  const refRow = d.orderId
    ? row('Reference', `<span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:0.86rem">${escapeHtml(d.orderId)}</span>`)
    : '';
  const billRow = d.billCode
    ? row('Bill code', `<span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:0.86rem">${escapeHtml(d.billCode)}</span>`)
    : '';

  const zoomBlock = d.zoomUrl
    ? `
      <tr><td style="padding:24px 28px 0">
        <p style="margin:0 0 10px;color:#1f0e14;font-weight:600;font-size:0.94rem">Join the webinar</p>
        <p style="margin:0 0 10px">
          <a href="${escapeAttr(d.zoomUrl)}"
             style="display:inline-block;background:#c44569;color:#ffffff;padding:13px 24px;border-radius:999px;text-decoration:none;font-weight:500;font-size:0.94rem">
            Open in Zoom
          </a>
        </p>
        <p style="margin:0;font-size:0.82rem;color:#84707a;word-break:break-all">
          Or copy: <a href="${escapeAttr(d.zoomUrl)}" style="color:#c44569">${escapeHtml(d.zoomUrl)}</a>
        </p>
      </td></tr>`
    : `
      <tr><td style="padding:24px 28px 0">
        <p style="margin:0 0 6px;color:#1f0e14;font-weight:600;font-size:0.94rem">Zoom link</p>
        <p style="margin:0;color:#6b4452;font-size:0.92rem;line-height:1.55">
          We'll email your Zoom link one day before the event.
        </p>
      </td></tr>`;

  // Conditional step 2 — accurate to whether the link was already sent.
  const nextStep2Html = d.zoomUrl
    ? `<li>We'll also send a reminder one day before, on 21 May 2026.</li>`
    : `<li>We'll email the Zoom link one day before, on 21 May 2026.</li>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt — Cashflow Girlies Webinar</title>
</head>
<body style="margin:0;padding:0;background:#fefafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f0e14">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fefafb">
  <tr><td align="center" style="padding:32px 16px">

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;width:100%">

      <!-- Greeting -->
      <tr><td style="padding:0 4px 12px">
        <h1 style="margin:0 0 8px;font-size:1.7rem;font-weight:600;letter-spacing:-0.02em;color:#1f0e14;line-height:1.2">
          You're in${safeName}.
        </h1>
        <p style="margin:0;color:#4a3340;line-height:1.6;font-size:0.98rem">
          Payment confirmed — keep this email as your receipt.
        </p>
      </td></tr>

      <!-- Receipt card -->
      <tr><td style="padding:20px 0 0">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ffffff;border:1px solid #f0d4db;border-radius:16px;overflow:hidden">

          <!-- Header -->
          <tr><td style="padding:22px 28px 0">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="vertical-align:middle">
                  <span style="display:inline-block;padding:4px 11px;background:#fce5ec;color:#c44569;font-size:0.72rem;font-weight:600;border-radius:999px;letter-spacing:0.02em">
                    Cashflow Girlies
                  </span>
                </td>
                <td align="right" style="vertical-align:middle;font-size:0.74rem;color:#84707a;text-transform:uppercase;letter-spacing:0.05em">
                  Receipt
                </td>
              </tr>
            </table>
            <p style="margin:14px 0 0;color:#1f0e14;font-weight:600;font-size:1.06rem;letter-spacing:-0.015em;line-height:1.35">
              Cara uruskan cukai for freelancers &amp; content creators
            </p>
          </td></tr>

          <!-- Event -->
          <tr><td style="padding:18px 28px 0">
            <p style="margin:0 0 10px;color:#84707a;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">
              Event
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:0.92rem;color:#1f0e14;line-height:1.65">
              ${row('Date', '22 May 2026')}
              ${row('Time', '8:00 PM (MYT)')}
              ${row('Platform', 'Zoom')}
            </table>
          </td></tr>

          <!-- Divider -->
          <tr><td style="padding:18px 28px 0">
            <div style="height:1px;background:#f6e6ea"></div>
          </td></tr>

          <!-- Payment -->
          <tr><td style="padding:18px 28px 0">
            <p style="margin:0 0 10px;color:#84707a;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">
              Payment
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:0.92rem;color:#1f0e14;line-height:1.65">
              ${row('Tier', escapeHtml(d.tier))}
              ${row('Method', 'FPX via ToyyibPay')}
              ${refRow}
              ${billRow}
              ${row('Paid on', escapeHtml(d.paidOn))}
            </table>
          </td></tr>

          <!-- Total bar -->
          <tr><td style="padding:18px 28px 22px">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fcf1f4;border-radius:10px">
              <tr>
                <td style="padding:14px 18px;font-size:0.84rem;color:#6b4452;font-weight:600;text-transform:uppercase;letter-spacing:0.04em">
                  Total paid
                </td>
                <td align="right" style="padding:14px 18px;font-size:1.18rem;color:#1f0e14;font-weight:700;letter-spacing:-0.01em;font-variant-numeric:tabular-nums">
                  ${escapeHtml(d.amount)}
                </td>
              </tr>
            </table>
          </td></tr>

          ${zoomBlock}

          <!-- Next steps -->
          <tr><td style="padding:24px 28px 26px">
            <p style="margin:0 0 10px;color:#1f0e14;font-weight:600;font-size:0.94rem">What's next</p>
            <ol style="margin:0;padding:0 0 0 18px;color:#4a3340;font-size:0.92rem;line-height:1.7">
              <li>
                <a href="${escapeAttr(d.calLink)}" style="color:#c44569;text-decoration:underline">Add to Google Calendar</a>
                so you don't miss it.
              </li>
              ${nextStep2Html}
              <li>Questions? Just reply to this email.</li>
            </ol>
          </td></tr>

        </table>
      </td></tr>

      <!-- Signature -->
      <tr><td style="padding:24px 4px 0;color:#4a3340;line-height:1.65;font-size:0.95rem">
        See you there,<br>
        <strong style="color:#1f0e14">Iman Abdul Rahim</strong><br>
        <span style="font-size:0.82rem;color:#84707a">Licensed Financial Planner · CFP® · IFP</span>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:28px 4px 0;color:#a09098;font-size:0.74rem;line-height:1.55">
        This is an automated receipt for your registration. If you didn't make this
        payment, reply to this email immediately.
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function row(label, value) {
  return `<tr>
    <td style="padding:3px 0;color:#84707a;width:40%">${escapeHtml(label)}</td>
    <td style="padding:3px 0;color:#1f0e14;font-weight:500">${value}</td>
  </tr>`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s) {
  return escapeHtml(s);
}
