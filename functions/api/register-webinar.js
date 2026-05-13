import {
  getSeatsTaken,
  getTierAndAmount,
  getToyyibpayBase,
  sheetsCall,
  json,
  titleCase,
  cleanPhone,
  isEmail,
  getClientIP,
  checkRateLimit,
} from '../_lib.js';

const MAX_NAME = 120;
const MAX_EMAIL = 200;
const MAX_PHONE = 30;

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return json({ error: 'POST only' }, 405);
  }

  try {
    const env = context.env;

    // Rate limit: 5 registration attempts per IP per hour.
    const ip = getClientIP(context.request);
    const rl = await checkRateLimit(env, ip, {
      maxAttempts: 5,
      windowSeconds: 3600,
      scope: 'register',
    });
    if (!rl.ok) {
      return json(
        { error: 'Too many attempts. Please try again in an hour.' },
        429,
      );
    }

    const body = await context.request.json();
    const { name, email, phone, consent } = body;

    if (!name || !email || !phone) {
      return json({ error: 'Please fill in all fields.' }, 400);
    }
    if (consent !== true) {
      return json(
        { error: 'You must agree to the privacy policy to register.' },
        400,
      );
    }
    if (
      typeof name !== 'string' ||
      typeof email !== 'string' ||
      typeof phone !== 'string'
    ) {
      return json({ error: 'Invalid input.' }, 400);
    }
    if (
      name.length > MAX_NAME ||
      email.length > MAX_EMAIL ||
      phone.length > MAX_PHONE
    ) {
      return json({ error: 'One or more fields are too long.' }, 400);
    }
    if (!isEmail(email)) {
      return json({ error: 'Please enter a valid email address.' }, 400);
    }
    const phoneDigits = cleanPhone(phone);
    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
      return json({ error: 'Please enter a valid phone number.' }, 400);
    }

    const cleanName = titleCase(name);

    // Duplicate check — uses Sheets as the source of truth.
    const dup = await sheetsCall(env, {
      action: 'check_email',
      email: email.toLowerCase(),
    });
    if (dup?.exists) {
      return json(
        {
          error:
            'This email is already registered. Check your inbox for the confirmation email.',
        },
        409,
      );
    }

    // Determine tier + amount based on paid seats so far.
    const seatsTaken = await getSeatsTaken(env);
    const { tier, amount } = getTierAndAmount(seatsTaken, env);

    // ToyyibPay config
    const TOYYIBPAY_SECRET =
      env.TOYYIBPAY_SECRET || 'n2iltwy6-pmio-xjh9-6wia-u76b5pz5hanz';
    const TOYYIBPAY_CATEGORY = env.TOYYIBPAY_CATEGORY || 'uul5ivz0';
    const TOYYIBPAY_BASE = getToyyibpayBase(env);
    const SITE_URL =
      env.SITE_URL || new URL(context.request.url).origin;

    const externalRef = `CG-${Date.now()}-${phoneDigits.slice(-4)}`;

    // Create ToyyibPay bill
    const formData = new URLSearchParams();
    formData.append('userSecretKey', TOYYIBPAY_SECRET);
    formData.append('categoryCode', TOYYIBPAY_CATEGORY);
    formData.append('billName', 'Cashflow Girlies Webinar');
    formData.append(
      'billDescription',
      `${tier} · Cara uruskan cukai for freelancers / content creators - 22 May 2026, 8PM`,
    );
    formData.append('billPriceSetting', '1');
    formData.append('billPayorInfo', '1');
    formData.append('billAmount', String(amount * 100)); // cents
    formData.append('billReturnUrl', `${SITE_URL}/webinar-success`);
    formData.append('billCallbackUrl', `${SITE_URL}/api/payment-callback`);
    formData.append('billExternalReferenceNo', externalRef);
    formData.append('billTo', cleanName);
    formData.append('billEmail', email);
    formData.append('billPhone', phoneDigits);
    formData.append(
      'billContentEmail',
      'Thank you for registering for Cashflow Girlies webinar! Your Zoom link will arrive after payment is confirmed.',
    );

    const res = await fetch(`${TOYYIBPAY_BASE}/index.php/api/createBill`, {
      method: 'POST',
      body: formData,
    });
    const result = await res.json();

    if (!result?.[0]?.BillCode) {
      console.error('ToyyibPay error:', JSON.stringify(result));
      return json(
        { error: 'Unable to create payment. Please try again.' },
        500,
      );
    }

    const billCode = result[0].BillCode;

    // Log pending row to Sheets in the background — don't block the redirect.
    // `waitUntil` keeps the promise alive after the response is sent.
    context.waitUntil(
      sheetsCall(env, {
        action: 'insert',
        name: cleanName,
        email: email.toLowerCase(),
        phone: phoneDigits,
        tier,
        amount,
        billCode,
        externalRef,
      }),
    );

    return json({
      paymentUrl: `${TOYYIBPAY_BASE}/${billCode}`,
      tier,
      amount,
    });
  } catch (e) {
    console.error('Registration error:', e);
    return json({ error: 'An error occurred. Please try again.' }, 500);
  }
}
