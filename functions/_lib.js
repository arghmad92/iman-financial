// Shared helpers for the webinar registration flow.
// Used by /api/register-webinar, /api/payment-callback, /api/seats.

const SEAT_KEY = 'webinar:22may2026:seats_taken';

/**
 * Read how many paid seats have been taken so far.
 * Returns 0 if the KV namespace isn't bound (graceful fallback in local dev).
 */
export async function getSeatsTaken(env) {
  if (!env.REGISTRATIONS_KV) return 0;
  const raw = await env.REGISTRATIONS_KV.get(SEAT_KEY);
  const n = parseInt(raw || '0', 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Atomically increment paid-seat counter by 1, return new value.
 * Uses optimistic concurrency: read → +1 → write. Acceptable because
 * volume is low and the worst case is two simultaneous registrations
 * both seeing the same count (one extra early-bird slot, no over-count).
 */
export async function incSeatsTaken(env) {
  if (!env.REGISTRATIONS_KV) return 0;
  const current = await getSeatsTaken(env);
  const next = current + 1;
  await env.REGISTRATIONS_KV.put(SEAT_KEY, String(next));
  return next;
}

/**
 * ToyyibPay base URL — production by default, sandbox when overridden.
 * Set TOYYIBPAY_BASE_URL=https://dev.toyyibpay.com to use the sandbox.
 */
export function getToyyibpayBase(env) {
  return env.TOYYIBPAY_BASE_URL || 'https://toyyibpay.com';
}

export function getEarlyBirdLimit(env) {
  const n = parseInt(env.EARLY_BIRD_LIMIT || '20', 10);
  return Number.isFinite(n) ? n : 20;
}

export function getTierAndAmount(seatsTaken, env) {
  const limit = getEarlyBirdLimit(env);
  const isEarlyBird = seatsTaken < limit;
  return {
    tier: isEarlyBird ? 'Early bird' : 'Regular',
    amount: isEarlyBird ? 29 : 39,
    isEarlyBird,
  };
}

/**
 * Check whether an email already has a registration row.
 * Returns true if found, false if not. Fails open (returns false) if the
 * DB isn't bound, so local dev without `wrangler pages dev` still works.
 */
export async function dbEmailExists(env, email) {
  if (!env.REGISTRATIONS_DB) {
    console.warn('REGISTRATIONS_DB not bound — skipping email check');
    return false;
  }
  try {
    const row = await env.REGISTRATIONS_DB
      .prepare('SELECT 1 FROM registrations WHERE email = ?1 LIMIT 1')
      .bind(email.toLowerCase())
      .first();
    return !!row;
  } catch (e) {
    console.error('D1 email check failed:', e);
    return false;
  }
}

/**
 * Insert a new pending registration row. Fire-and-forget from callers via
 * context.waitUntil — we don't want DB latency to delay the redirect.
 */
export async function dbInsertRegistration(env, row) {
  if (!env.REGISTRATIONS_DB) {
    console.warn('REGISTRATIONS_DB not bound — skipping insert', row);
    return;
  }
  try {
    await env.REGISTRATIONS_DB
      .prepare(
        `INSERT INTO registrations
         (name, email, phone, tier, amount, status, bill_code)
         VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6)`,
      )
      .bind(
        row.name,
        row.email.toLowerCase(),
        row.phone,
        row.tier,
        row.amount,
        row.billCode,
      )
      .run();
  } catch (e) {
    console.error('D1 insert failed:', e);
  }
}

/**
 * Mark an existing row paid (by billCode), record the paid timestamp and
 * whether the Zoom confirmation email was sent.
 */
export async function dbMarkPaid(env, billCode, zoomSent) {
  if (!env.REGISTRATIONS_DB) {
    console.warn('REGISTRATIONS_DB not bound — skipping mark_paid', billCode);
    return;
  }
  try {
    await env.REGISTRATIONS_DB
      .prepare(
        `UPDATE registrations
         SET status = 'paid',
             paid_at = datetime('now'),
             zoom_sent = ?2
         WHERE bill_code = ?1`,
      )
      .bind(billCode, zoomSent ? 'YES' : 'NO')
      .run();
  } catch (e) {
    console.error('D1 mark_paid failed:', e);
  }
}

/**
 * Resolve the visitor's IP from Cloudflare's headers.
 * Returns null in local dev when neither header is set.
 */
export function getClientIP(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
    null
  );
}

/**
 * Simple KV-based rate limiter (sliding window of size `windowSeconds`).
 * Returns { ok: true } if allowed, { ok: false, retryAfter } if rate-limited.
 * Fails open if KV isn't bound or IP can't be determined (local dev).
 */
export async function checkRateLimit(
  env,
  ip,
  { maxAttempts = 5, windowSeconds = 3600, scope = 'register' } = {},
) {
  if (!env.REGISTRATIONS_KV || !ip) return { ok: true };
  const key = `rate:${scope}:${ip}`;
  const raw = await env.REGISTRATIONS_KV.get(key);
  const count = parseInt(raw || '0', 10);
  if (count >= maxAttempts) {
    return { ok: false, retryAfter: windowSeconds };
  }
  await env.REGISTRATIONS_KV.put(key, String(count + 1), {
    expirationTtl: windowSeconds,
  });
  return { ok: true };
}

/**
 * Idempotency marker — record that we've already processed an event.
 * Returns true if this is the first time we've seen `key`.
 */
export async function markOnce(env, key, ttlSeconds = 86400 * 30) {
  if (!env.REGISTRATIONS_KV) return true; // fail open in local dev
  const existing = await env.REGISTRATIONS_KV.get(key);
  if (existing) return false;
  await env.REGISTRATIONS_KV.put(key, '1', { expirationTtl: ttlSeconds });
  return true;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Normalize a user-entered name to "Title Case".
 */
export function titleCase(name) {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Strip phone number to digits only (preserves leading 0 if present).
 */
export function cleanPhone(phone) {
  return phone.replace(/[-\s+()]/g, '');
}

/**
 * Validate email shape (basic, sufficient for marketing forms).
 */
export function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
