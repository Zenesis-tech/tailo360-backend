const { Subscription, SubscriptionPlan, Referral, ReferralRewardConfig } = require('../models');
const { send: sendNotification } = require('./notification.service');
const realtimeEvents = require('./realtime-events.service');

async function refreshSubscription(subscription) {
  if (!subscription) return subscription;
  const now = new Date();
  if (subscription.status === 'trial' && subscription.trialEndsAt && subscription.trialEndsAt <= now) {
    subscription.status = 'expired';
    await subscription.save();
    await realtimeEvents.publish(subscription.studioId, { resource: 'subscription', action: 'updated', id: subscription.id, data: subscription });
    sendNotification(subscription.studioId, {
      type: 'subscription_expired',
      title: 'Free trial ended',
      body: 'Choose a plan to continue creating and updating records.',
      data: { route: 'subscription' },
      source: 'system',
      dedupeKey: `subscription:${subscription.id}:expired`,
    }).catch(console.error);
  }
  if (['active', 'grace_period'].includes(subscription.status) && subscription.periodEndsAt && subscription.periodEndsAt <= now) {
    subscription.status = 'restricted';
    await subscription.save();
    await realtimeEvents.publish(subscription.studioId, { resource: 'subscription', action: 'updated', id: subscription.id, data: subscription });
    sendNotification(subscription.studioId, {
      type: 'subscription_restricted',
      title: 'Subscription needs attention',
      body: 'Update your subscription to restore full access.',
      data: { route: 'subscription' },
      source: 'system',
      dedupeKey: `subscription:${subscription.id}:restricted`,
    }).catch(console.error);
  }
  if (subscription.status === 'cancelled' && (!subscription.periodEndsAt || subscription.periodEndsAt <= now)) {
    subscription.status = 'restricted';
    await subscription.save();
    await realtimeEvents.publish(subscription.studioId, { resource: 'subscription', action: 'updated', id: subscription.id, data: subscription });
  }
  return subscription;
}

async function expireReferrals() {
  return Referral.updateMany({ status: 'pending', expiresAt: { $lte: new Date() } }, { status: 'expired_void' });
}

async function rewardReferralForStudio(refereeStudioId, qualifyingCondition = 'first_paid_subscription') {
  const now = new Date();
  // Claim the referral atomically so repeated store webhooks cannot grant the
  // same reward twice.
  const referral = await Referral.findOneAndUpdate(
    { refereeStudioId, qualifyingCondition, status: 'pending', expiresAt: { $gt: now } },
    { status: 'rewarded', rewardedAt: now },
    { new: true },
  );
  if (!referral) return null;
  try {
    const referrerSubscription = await Subscription.findOne({ studioId: referral.referrerStudioId });
    if (!referrerSubscription) throw new Error('Referrer subscription is missing.');
    if (referral.reward.type === 'trial_extension_days') {
      const base = referrerSubscription.trialEndsAt && referrerSubscription.trialEndsAt > now
        ? referrerSubscription.trialEndsAt
        : now;
      referrerSubscription.trialEndsAt = new Date(base.getTime() + referral.reward.value * 86400000);
    } else if (referral.reward.type === 'account_credit') {
      referrerSubscription.referralCreditPaise = (referrerSubscription.referralCreditPaise || 0) + referral.reward.value * 100;
    }
    await referrerSubscription.save();
    await realtimeEvents.publish(referral.referrerStudioId, { resource: 'subscription', action: 'updated', id: referrerSubscription.id, data: referrerSubscription });
    await Promise.all([
      realtimeEvents.publish(referral.referrerStudioId, { resource: 'referral', action: 'updated', id: referral.id, data: referral }),
      realtimeEvents.publish(referral.refereeStudioId, { resource: 'referral', action: 'updated', id: referral.id, data: referral }),
    ]);
    sendNotification(referral.referrerStudioId, {
      type: 'referral_rewarded',
      title: 'Referral reward earned',
      body: referral.reward.type === 'trial_extension_days'
        ? `${referral.reward.value} trial days were added to your account.`
        : `₹${referral.reward.value} referral credit was added.`,
      data: { route: 'referral' },
      source: 'system',
      dedupeKey: `referral:${referral.id}:rewarded`,
    }).catch(console.error);
    return referral;
  } catch (error) {
    await Referral.updateOne(
      { _id: referral._id, status: 'rewarded', rewardedAt: now },
      { $set: { status: 'pending' }, $unset: { rewardedAt: 1 } },
    );
    throw error;
  }
}

async function activeReferralConfig() { return ReferralRewardConfig.findOne({ active: true }).sort({ version: -1 }); }
module.exports = { refreshSubscription, expireReferrals, rewardReferralForStudio, activeReferralConfig };
