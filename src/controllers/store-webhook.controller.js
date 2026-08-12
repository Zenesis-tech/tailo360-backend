const { Subscription, SubscriptionEvent } = require('../models');
const { verifyPurchase, planFor } = require('../services/store-verification.service');
const { send: sendNotification } = require('../services/notification.service');

async function applyVerifiedPurchase(verified) {
  const event = await SubscriptionEvent.findOne({ $or: [{ transactionId: verified.transactionId }, { originalTransactionId: verified.originalTransactionId }] });
  if (!event) return false; // Unknown transactions are never attached to a studio.
  const plan = await planFor(verified.productId, verified.platform);
  await Subscription.findOneAndUpdate({ studioId: event.studioId }, { plan: plan.code, status: verified.status, platform: verified.platform, entitlementSource: 'store', productId: verified.productId, originalTransactionId: verified.originalTransactionId, periodEndsAt: verified.periodEndsAt, lastVerifiedAt: new Date(), seatLimit: plan.limits.staffSeats });
  await SubscriptionEvent.create({ studioId: event.studioId, platform: verified.platform, transactionId: `${verified.transactionId}:${Date.now()}`, originalTransactionId: verified.originalTransactionId, productId: verified.productId, raw: verified.raw });
  sendNotification(event.studioId, {
    type: verified.status === 'active' ? 'subscription_renewed' : 'subscription_updated',
    title: verified.status === 'active' ? 'Subscription renewed' : 'Subscription updated',
    body: `${plan.name} is now ${verified.status}.`,
    data: { route: 'subscription' },
    source: 'system',
    dedupeKey: `store-event:${verified.platform}:${verified.transactionId}:${verified.status}`,
  }).catch(console.error);
  return true;
}
async function google(req, res) { try { const payload = JSON.parse(Buffer.from(req.body.message?.data || '', 'base64').toString('utf8')); const token = payload.subscriptionNotification?.purchaseToken; if (token) await applyVerifiedPurchase(await verifyPurchase('google', { purchaseToken: token })); } catch (error) { console.error('Google RTDN processing failed', error); } res.status(204).send(); }
async function apple(req, res) { const signed = req.body.signedPayload; if (!signed) return res.status(400).send(); try { const notification = JSON.parse(Buffer.from(signed.split('.')[1], 'base64url').toString('utf8')); const transactionId = notification.data?.signedTransactionInfo ? JSON.parse(Buffer.from(notification.data.signedTransactionInfo.split('.')[1], 'base64url').toString('utf8')).originalTransactionId : null; if (transactionId) await applyVerifiedPurchase(await verifyPurchase('apple', { transactionId })); } catch (error) { console.error('Apple notification processing failed', error); } res.status(204).send(); }
module.exports = { google, apple };
