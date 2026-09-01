const { Subscription, SubscriptionEvent } = require('../models');
const { verifyPurchase, planFor } = require('../services/store-verification.service');
const { send: sendNotification } = require('../services/notification.service');
const realtimeEvents = require('../services/realtime-events.service');

async function applyVerifiedPurchase(verified) {
  const event = await SubscriptionEvent.findOne({ $or: [{ transactionId: verified.transactionId }, { originalTransactionId: verified.originalTransactionId }, { purchaseToken: verified.purchaseToken }] }).select('+purchaseToken');
  if (!event) return false; // Unknown transactions are never attached to a studio.
  const plan = await planFor(verified.productId, verified.platform);
  const subscription = await Subscription.findOneAndUpdate({ studioId: event.studioId }, { plan: plan.code, status: verified.status, platform: verified.platform, entitlementSource: 'store', productId: verified.productId, googlePlaySubscriptionId: verified.platform === 'google' ? verified.productId : undefined, purchaseToken: verified.purchaseToken, originalTransactionId: verified.originalTransactionId, country: verified.country || event.country, currency: event.currency, priceAmountMicros: event.priceAmountMicros, autoRenewing: verified.autoRenewing, cancellationReason: verified.cancellationReason, periodEndsAt: verified.periodEndsAt, lastVerifiedAt: new Date(), seatLimit: plan.limits.staffSeats }, { new: true });
  await SubscriptionEvent.create({ studioId: event.studioId, platform: verified.platform, transactionId: `${verified.transactionId}:${Date.now()}`, originalTransactionId: verified.originalTransactionId, productId: verified.productId, purchaseToken: verified.purchaseToken, country: verified.country || event.country, currency: event.currency, priceAmountMicros: event.priceAmountMicros, raw: verified.raw });
  sendNotification(event.studioId, {
    type: verified.status === 'active' ? 'subscription_renewed' : 'subscription_updated',
    title: verified.status === 'active' ? 'Subscription renewed' : 'Subscription updated',
    body: `${plan.name} is now ${verified.status}.`,
    data: { route: 'subscription' },
    source: 'system',
    dedupeKey: `store-event:${verified.platform}:${verified.transactionId}:${verified.status}`,
  }).catch(console.error);
  await realtimeEvents.publish(event.studioId, { resource: 'subscription', action: 'updated', id: subscription.id, data: subscription });
  return true;
}
async function google(req, res) { try { const payload = JSON.parse(Buffer.from(req.body.message?.data || '', 'base64').toString('utf8')); const token = payload.subscriptionNotification?.purchaseToken; if (token) await applyVerifiedPurchase(await verifyPurchase('google', { purchaseToken: token })); } catch (error) { console.error('Google RTDN processing failed', error); } res.status(204).send(); }
async function apple(req, res) { const signed = req.body.signedPayload; if (!signed) return res.status(400).send(); try { const notification = JSON.parse(Buffer.from(signed.split('.')[1], 'base64url').toString('utf8')); const transactionId = notification.data?.signedTransactionInfo ? JSON.parse(Buffer.from(notification.data.signedTransactionInfo.split('.')[1], 'base64url').toString('utf8')).originalTransactionId : null; if (transactionId) await applyVerifiedPurchase(await verifyPurchase('apple', { transactionId })); } catch (error) { console.error('Apple notification processing failed', error); } res.status(204).send(); }
module.exports = { google, apple };
