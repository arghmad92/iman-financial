export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const { name, email, phone } = await context.request.json();

    if (!name || !email || !phone) {
      return json({ error: 'Please fill in all fields.' }, 400);
    }

    // Validate email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Please enter a valid email address.' }, 400);
    }

    // Validate phone
    const cleanPhone = phone.replace(/[-\s+]/g, '');
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      return json({ error: 'Please enter a valid phone number.' }, 400);
    }

    // Title case the name
    const cleanName = name.trim().replace(/\s+/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

    // ToyyibPay config
    const TOYYIBPAY_SECRET = context.env.TOYYIBPAY_SECRET || 'n2iltwy6-pmio-xjh9-6wia-u76b5pz5hanz';
    const TOYYIBPAY_CATEGORY = context.env.TOYYIBPAY_CATEGORY || 'uul5ivz0';
    const SITE_URL = 'https://iman-financial.pages.dev';

    // Amount in cents (RM29 = 2900 cents for early bird, RM39 = 3900 for regular)
    // TODO: Check registration count for early bird vs regular pricing
    const amount = 29; // RM29 early bird

    // Create ToyyibPay bill
    const formData = new URLSearchParams();
    formData.append('userSecretKey', TOYYIBPAY_SECRET);
    formData.append('categoryCode', TOYYIBPAY_CATEGORY);
    formData.append('billName', 'Cashflow Girlies Webinar');
    formData.append('billDescription', 'Cara uruskan cukai for freelancers / content creator - 10 April 2026, 8PM');
    formData.append('billPriceSetting', '1'); // Fixed price
    formData.append('billPayorInfo', '1'); // Required
    formData.append('billAmount', String(amount * 100)); // In cents
    formData.append('billReturnUrl', `${SITE_URL}/webinar-success`);
    formData.append('billCallbackUrl', `${SITE_URL}/api/payment-callback`);
    formData.append('billExternalReferenceNo', `CG-${Date.now()}-${cleanPhone.slice(-4)}`);
    formData.append('billTo', cleanName);
    formData.append('billEmail', email);
    formData.append('billPhone', cleanPhone);
    formData.append('billContentEmail', `Thank you for registering for Cashflow Girlies webinar! Your Zoom link will be sent to this email closer to the date.`);

    const res = await fetch('https://toyyibpay.com/index.php/api/createBill', {
      method: 'POST',
      body: formData,
    });

    const result = await res.json();

    if (result && result[0] && result[0].BillCode) {
      const billCode = result[0].BillCode;
      return json({ paymentUrl: `https://toyyibpay.com/${billCode}` });
    } else {
      console.error('ToyyibPay error:', JSON.stringify(result));
      return json({ error: 'Unable to create payment. Please try again.' }, 500);
    }
  } catch (e) {
    console.error('Registration error:', e);
    return json({ error: 'An error occurred. Please try again.' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
