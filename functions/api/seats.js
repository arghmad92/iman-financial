import { getSeatsTaken, getEarlyBirdLimit, json } from '../_lib.js';

// Public read-only endpoint. Called by /webinar to show "X seats left" UI.
// No auth required — the count is non-sensitive marketing info.
export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return json({ error: 'GET only' }, 405);
  }

  try {
    const env = context.env;
    const taken = await getSeatsTaken(env);
    const limit = getEarlyBirdLimit(env);
    const remaining = Math.max(0, limit - taken);

    return new Response(
      JSON.stringify({
        remaining,
        total: limit,
        taken,
        soldOut: remaining === 0,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          // Cache 30s at the edge — counter drift is acceptable
          'Cache-Control': 'public, max-age=30',
        },
      },
    );
  } catch (e) {
    console.error('Seats endpoint error:', e);
    return json({ error: 'Unable to fetch seat availability' }, 500);
  }
}
