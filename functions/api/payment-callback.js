import {
  dbGetByBillCode,
  getToyyibpayConfig,
  markOnce,
  processPaidRegistration,
} from '../_lib.js';

// ToyyibPay payment callback (server-to-server).
// Called every time a bill's status changes. We only act on status=1 (success).
export async function onRequest(context) {
  try {
    const formData = await context.request.formData();
    const claimedStatus = formData.get('status') || '';
    const billCode = formData.get('billcode') || '';
    const orderId = formData.get('order_id') || ''; // ToyyibPay's external ref

    // The form-data `status` is attacker-controllable. Treat as a hint only —
    // we always re-verify against ToyyibPay before doing anything destructive.
    if (claimedStatus !== '1' || !billCode) {
      return new Response('OK', { status: 200 });
    }

    const env = context.env;

    // Look up the bill via the ToyyibPay API to verify payment status.
    // Uses the same mode (sandbox/production) the bill was created under.
    const { base: TOYYIBPAY_BASE, secret: TOYYIBPAY_SECRET } =
      getToyyibpayConfig(env);

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

    // Verify ToyyibPay actually reports the bill as paid.
    // 1 = success, 2 = pending, 3 = failed.
    if (String(tx.billpaymentStatus) !== '1') {
      console.warn(
        'Callback received but bill is not paid:',
        billCode,
        'status=',
        tx.billpaymentStatus,
      );
      return new Response('OK', { status: 200 });
    }

    // Idempotency — prevent replay attacks and duplicate emails.
    const isFirstTime = await markOnce(env, `processed:${billCode}`);
    if (!isFirstTime) {
      console.log('Callback replay ignored for billCode:', billCode);
      return new Response('OK', { status: 200 });
    }

    const email = tx.billEmail || '';
    const name = tx.billTo || '';

    // Pull the registration row for tier/amount (needed for the receipt).
    // Falls back to ToyyibPay's reported amount if D1 doesn't have it.
    const reg = await dbGetByBillCode(env, billCode);
    const amount = reg?.amount ?? Math.round((tx.billpaymentAmount || 0) / 100);
    const tier = reg?.tier || '';

    // Parse ToyyibPay's billPaymentDate ("YYYY-MM-DD HH:MM:SS" in MYT).
    // Falls back to now() if the field is missing or malformed.
    const paidAt = parseMytTimestamp(tx.billPaymentDate) || new Date();

    // Run the shared post-payment pipeline: send email, mark D1 paid,
    // increment KV seats counter. Same function the mock mode uses.
    await processPaidRegistration(env, {
      billCode,
      name,
      email,
      amount,
      tier,
      orderId,
      paidAt,
    });

    return new Response('OK', { status: 200 });
  } catch (e) {
    console.error('Callback error:', e);
    // Always 200 — ToyyibPay retries on non-200, and we don't want that.
    return new Response('OK', { status: 200 });
  }
}

function parseMytTimestamp(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})$/);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}+08:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
