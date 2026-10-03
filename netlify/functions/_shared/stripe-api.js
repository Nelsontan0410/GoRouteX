import crypto from 'node:crypto';

function getEnv(name) {
  return Netlify.env.get(name) || '';
}

function flattenFormValue(target, key, value) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => flattenFormValue(target, `${key}[${index}]`, entry));
    return;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([childKey, childValue]) => {
      flattenFormValue(target, `${key}[${childKey}]`, childValue);
    });
    return;
  }
  target.append(key, String(value));
}

export function toStripeForm(data = {}) {
  const form = new URLSearchParams();
  Object.entries(data).forEach(([key, value]) => flattenFormValue(form, key, value));
  return form;
}

export async function stripeRequest(path, { method = 'GET', data, idempotencyKey } = {}) {
  const secretKey = getEnv('STRIPE_SECRET_KEY');
  if (!secretKey) {
    const error = new Error('Stripe is not configured. Set STRIPE_SECRET_KEY before enabling checkout.');
    error.code = 'stripe_not_configured';
    throw error;
  }

  const headers = {
    Authorization: `Bearer ${secretKey}`
  };
  let body;
  if (data !== undefined) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = toStripeForm(data).toString();
  }
  if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey);

  const response = await fetch(`https://api.stripe.com/v1${path}`, { method, headers, body });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || 'Stripe request failed.');
    error.code = payload?.error?.code || `stripe_http_${response.status}`;
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function validateStripePrice(priceId, { currency, interval } = {}) {
  if (!/^price_[A-Za-z0-9]+$/.test(String(priceId || ''))) throw new Error('Invalid configured Stripe Price ID.');
  const price = await stripeRequest(`/prices/${encodeURIComponent(priceId)}`);
  const secretKey = getEnv('STRIPE_SECRET_KEY');
  const expectedLiveMode = secretKey.startsWith('sk_live_');
  if (!secretKey.startsWith('sk_test_') && !expectedLiveMode) throw new Error('Stripe secret key mode is not recognized.');
  if (price.active !== true || price.type !== 'recurring' || price.recurring?.interval !== interval
    || price.currency?.toUpperCase() !== currency || price.livemode !== expectedLiveMode
    || !Number.isInteger(price.unit_amount) || price.unit_amount <= 0) {
    throw new Error('Configured Stripe Price does not match the selected recurring offer or key mode.');
  }
  return price;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyStripeWebhookSignature(payload, signatureHeader, webhookSecret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!payload || !signatureHeader || !webhookSecret) return false;
  const values = new Map();
  String(signatureHeader).split(',').forEach((part) => {
    const [key, value] = part.split('=');
    if (!key || !value) return;
    const entries = values.get(key) || [];
    entries.push(value);
    values.set(key, entries);
  });
  const timestamp = Number(values.get('t')?.[0]);
  const signatures = values.get('v1') || [];
  if (!Number.isFinite(timestamp) || signatures.length === 0 || Math.abs(nowSeconds - timestamp) > 300) return false;

  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex');
  return signatures.some((signature) => safeEqual(expected, signature));
}

export function getStripePortalConfigurationId() {
  return getEnv('STRIPE_PORTAL_CONFIGURATION_ID');
}
