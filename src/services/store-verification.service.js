const jwt = require('jsonwebtoken');
const { GoogleAuth } = require('google-auth-library');
const env = require('../config/env');
const { SubscriptionPlan } = require('../models');
const { AppError } = require('../utils/errors');

function decodeJwsPayload(value) {
  const part = value?.split('.')[1];
  if (!part) throw new AppError(422, 'APPLE_RESPONSE_INVALID', 'Apple returned an invalid transaction payload.');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}
async function planFor(productId, platform) {
  const plan = await SubscriptionPlan.findOne({
    active: true,
    $or: [
      { storeProducts: { $elemMatch: { productId, platform, active: true } } },
      { legacyStoreProducts: { $elemMatch: { productId, platform } } },
    ],
  });
  if (!plan) throw new AppError(422, 'UNKNOWN_SUBSCRIPTION_PRODUCT', 'This subscription product is not enabled in the backend catalog.');
  return plan;
}
async function verifyGoogle(purchaseToken) {
  if (!env.GOOGLE_PLAY_PACKAGE_NAME || !env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new AppError(503, 'GOOGLE_BILLING_NOT_CONFIGURED', 'Google Play billing is not configured.');
  let credentials; try { credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON); } catch (_) { throw new AppError(500, 'GOOGLE_BILLING_CONFIG_INVALID', 'Google Play service-account configuration is invalid.'); }
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
  const token = await auth.getAccessToken();
  const response = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(env.GOOGLE_PLAY_PACKAGE_NAME)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new AppError(422, 'GOOGLE_PURCHASE_INVALID', 'Google Play could not verify this purchase.');
  const raw = await response.json(); const line = raw.lineItems?.[0];
  if (!line?.productId || !line.expiryTime) throw new AppError(422, 'GOOGLE_PURCHASE_INVALID', 'Google Play returned an incomplete subscription.');
  const map = { SUBSCRIPTION_STATE_ACTIVE: 'active', SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 'grace_period', SUBSCRIPTION_STATE_ON_HOLD: 'restricted', SUBSCRIPTION_STATE_PAUSED: 'restricted', SUBSCRIPTION_STATE_CANCELED: 'cancelled', SUBSCRIPTION_STATE_EXPIRED: 'expired' };
  return { platform: 'google', transactionId: raw.latestOrderId || purchaseToken, originalTransactionId: raw.linkedPurchaseToken || purchaseToken, productId: line.productId, periodEndsAt: new Date(line.expiryTime), status: map[raw.subscriptionState] || 'restricted', raw };
}
function appleToken() {
  if (!env.APPLE_ISSUER_ID || !env.APPLE_KEY_ID || !env.APPLE_PRIVATE_KEY || !env.APPLE_BUNDLE_ID) throw new AppError(503, 'APPLE_BILLING_NOT_CONFIGURED', 'App Store billing is not configured.');
  return jwt.sign({}, env.APPLE_PRIVATE_KEY, { algorithm: 'ES256', keyid: env.APPLE_KEY_ID, issuer: env.APPLE_ISSUER_ID, audience: 'appstoreconnect-v1', expiresIn: '5m' });
}
async function verifyApple(transactionId) {
  const host = env.APPLE_ENVIRONMENT === 'production' ? 'https://api.storekit.itunes.apple.com' : 'https://api.storekit-sandbox.apple.com';
  const response = await fetch(`${host}/inApps/v1/subscriptions/${encodeURIComponent(transactionId)}`, { headers: { Authorization: `Bearer ${appleToken()}` } });
  if (!response.ok) throw new AppError(422, 'APPLE_PURCHASE_INVALID', 'App Store could not verify this purchase.');
  const raw = await response.json(); const transaction = raw.data?.flatMap((item) => item.lastTransactions || []).sort((a, b) => Number(b.signedDate || 0) - Number(a.signedDate || 0))[0];
  if (!transaction?.signedTransactionInfo) throw new AppError(422, 'APPLE_PURCHASE_INVALID', 'App Store returned an incomplete subscription.');
  const payload = decodeJwsPayload(transaction.signedTransactionInfo); if (payload.bundleId !== env.APPLE_BUNDLE_ID) throw new AppError(422, 'APPLE_PURCHASE_INVALID', 'The purchase does not belong to this app.');
  const map = { 1: 'active', 2: 'expired', 3: 'restricted', 4: 'grace_period', 5: 'cancelled' };
  return { platform: 'apple', transactionId: payload.transactionId, originalTransactionId: payload.originalTransactionId, productId: payload.productId, periodEndsAt: new Date(Number(payload.expiresDate)), status: map[transaction.status] || 'restricted', raw };
}
async function verifyPurchase(platform, proof) { return platform === 'google' ? verifyGoogle(proof.purchaseToken) : verifyApple(proof.transactionId); }
module.exports = { verifyPurchase, planFor };
