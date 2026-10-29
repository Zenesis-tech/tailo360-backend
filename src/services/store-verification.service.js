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
  const response = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(env.GOOGLE_PLAY_PACKAGE_NAME)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
  if (response.status === 401 || response.status === 403) {
    throw new AppError(503, 'GOOGLE_BILLING_ACCESS_DENIED', 'Google Play verification access is not configured for this app.');
  }
  if (!response.ok) throw new AppError(422, 'GOOGLE_PURCHASE_INVALID', 'Google Play could not verify this purchase.');
  const raw = await response.json(); const line = raw.lineItems?.[0];
  if (!line?.productId || !line.expiryTime) throw new AppError(422, 'GOOGLE_PURCHASE_INVALID', 'Google Play returned an incomplete subscription.');
  const map = { SUBSCRIPTION_STATE_ACTIVE: 'active', SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 'grace_period', SUBSCRIPTION_STATE_ON_HOLD: 'restricted', SUBSCRIPTION_STATE_PAUSED: 'restricted', SUBSCRIPTION_STATE_CANCELED: 'cancelled', SUBSCRIPTION_STATE_EXPIRED: 'expired' };
  return {
    platform: 'google',
    transactionId: raw.latestOrderId || purchaseToken,
    originalTransactionId: raw.linkedPurchaseToken || purchaseToken,
    purchaseToken,
    productId: line.productId,
    periodEndsAt: new Date(line.expiryTime),
    status: map[raw.subscriptionState] || 'restricted',
    country: raw.regionCode,
    autoRenewing: !!line.autoRenewingPlan?.autoRenewEnabled,
    acknowledgementState: raw.acknowledgementState,
    cancellationReason: raw.canceledStateContext ? Object.keys(raw.canceledStateContext)[0] : undefined,
    raw,
  };
}
async function stopGooglePaymentsForDeletion(purchaseToken) {
  let verified;
  try {
    verified = await verifyGoogle(purchaseToken);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, 'GOOGLE_CANCEL_CHECK_FAILED', 'Google Play could not be reached to check this subscription. The account was not deleted.');
  }
  const state = verified.raw.subscriptionState;
  if (state === 'SUBSCRIPTION_STATE_EXPIRED' || state === 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED' ||
      (state === 'SUBSCRIPTION_STATE_CANCELED' && verified.raw.lineItems?.every((line) => !line.autoRenewingPlan?.autoRenewEnabled && !line.autoRenewingPlan?.installmentDetails)) ||
      verified.raw.lineItems?.every((line) => line.prepaidPlan)) {
    return { alreadyStopped: true };
  }
  if (!['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_ON_HOLD',
    'SUBSCRIPTION_STATE_PAUSED', 'SUBSCRIPTION_STATE_CANCELED'].includes(state)) {
    throw new AppError(409, 'GOOGLE_PURCHASE_STATE_UNKNOWN', 'Google Play could not confirm that future payments are stopped. Deletion was stopped.');
  }
  const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
  const token = await auth.getAccessToken();
  let response;
  try {
    response = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(env.GOOGLE_PLAY_PACKAGE_NAME)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}:cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancellationContext: { cancellationType: 'DEVELOPER_REQUESTED_STOP_PAYMENTS' } }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (_) {
    throw new AppError(503, 'GOOGLE_CANCEL_UNAVAILABLE', 'Google Play could not be reached to stop future payments. The account was not deleted.');
  }
  if (!response.ok)
    throw new AppError(502, 'GOOGLE_CANCEL_FAILED', 'Google Play did not confirm payment cancellation. The account was not deleted.');
  return { alreadyStopped: false };
}
async function acknowledgeGoogle(verified) {
  if (verified.platform !== 'google' || verified.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_PENDING') return;
  const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
  const token = await auth.getAccessToken();
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(env.GOOGLE_PLAY_PACKAGE_NAME)}/purchases/subscriptions/${encodeURIComponent(verified.productId)}/tokens/${encodeURIComponent(verified.purchaseToken)}:acknowledge`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) throw new AppError(502, 'GOOGLE_ACKNOWLEDGEMENT_FAILED', 'Google Play could not confirm the subscription yet. Please reopen the app to retry.');
}
async function lookupGoogleOrder(verified) {
  const orderId = verified.raw?.latestOrderId;
  if (verified.platform !== 'google' || !orderId) return null;
  const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
  const token = await auth.getAccessToken();
  const response = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(env.GOOGLE_PLAY_PACKAGE_NAME)}/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return null;
  const order = await response.json();
  const total = order.total;
  return {
    orderState: order.state,
    paidCurrency: total?.currencyCode,
    paidAmountMicros: total ? Number(total.units || 0) * 1000000 + Math.round(Number(total.nanos || 0) / 1000) : undefined,
    orderCreatedAt: order.createTime ? new Date(order.createTime) : undefined,
  };
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
module.exports = { verifyPurchase, planFor, acknowledgeGoogle, lookupGoogleOrder, stopGooglePaymentsForDeletion };
