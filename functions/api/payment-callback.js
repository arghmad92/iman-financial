// ToyyibPay payment callback
// This is called by ToyyibPay server-side when payment status changes
export async function onRequest(context) {
  try {
    const formData = await context.request.formData();
    const refNo = formData.get('refno') || '';
    const status = formData.get('status') || '';
    const reason = formData.get('reason') || '';
    const billCode = formData.get('billcode') || '';
    const orderId = formData.get('order_id') || '';

    // Status: 1 = success, 2 = pending, 3 = failed
    if (status === '1') {
      // Payment successful — send confirmation email via Resend
      const RESEND_KEY = context.env.RESEND_KEY;
      if (RESEND_KEY) {
        // Get bill details from ToyyibPay to get email
        const TOYYIBPAY_SECRET = context.env.TOYYIBPAY_SECRET || 'n2iltwy6-pmio-xjh9-6wia-u76b5pz5hanz';
        const billData = new URLSearchParams();
        billData.append('userSecretKey', TOYYIBPAY_SECRET);
        billData.append('billCode', billCode);

        const billRes = await fetch('https://toyyibpay.com/index.php/api/getBillTransactions', {
          method: 'POST',
          body: billData,
        });
        const transactions = await billRes.json();

        if (transactions && transactions[0]) {
          const tx = transactions[0];
          const email = tx.billEmail || '';
          const name = tx.billTo || '';

          if (email) {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${RESEND_KEY}`,
              },
              body: JSON.stringify({
                from: 'Iman Abdul Rahim <onboarding@resend.dev>',
                to: email,
                subject: 'Confirmed! Cashflow Girlies Webinar — 10 April 2026',
                html: `
                  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:2rem">
                    <h1 style="color:#3d2027;font-size:1.5rem">You're in, ${name}!</h1>
                    <p style="color:#7a5660;line-height:1.8">Payment confirmed. Here are your webinar details:</p>

                    <div style="background:#fef0f3;border-radius:12px;padding:1.5rem;margin:1.5rem 0">
                      <p style="margin:0;color:#3d2027"><strong>Cashflow Girlies</strong></p>
                      <p style="margin:0.3rem 0;color:#7a5660">Cara uruskan cukai for freelancers / content creator</p>
                      <p style="margin:0.3rem 0;color:#7a5660">📅 10 April 2026, 8:00 PM (MYT)</p>
                      <p style="margin:0.3rem 0;color:#7a5660">💻 Via Zoom</p>
                      <p style="margin:0.3rem 0;color:#7a5660">🔖 Ref: ${orderId}</p>
                    </div>

                    <p style="color:#7a5660;line-height:1.8"><strong>Zoom link</strong> will be sent to this email 1 day before the webinar.</p>

                    <p style="color:#7a5660;line-height:1.8">If you have any questions, reply to this email or WhatsApp me at <a href="https://wa.me/60186617981" style="color:#c9848c">+6018-6617981</a>.</p>

                    <p style="color:#7a5660;margin-top:2rem">See you there!<br><strong>Iman Abdul Rahim</strong><br><span style="font-size:0.85rem;color:#b8949c">Licensed Financial Planner</span></p>
                  </div>
                `,
              }),
            });
          }
        }
      }
    }

    // Return 200 to acknowledge callback
    return new Response('OK', { status: 200 });
  } catch (e) {
    console.error('Callback error:', e);
    return new Response('OK', { status: 200 }); // Always return 200 to ToyyibPay
  }
}
