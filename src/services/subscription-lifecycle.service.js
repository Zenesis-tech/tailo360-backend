const { Subscription, SubscriptionPlan, Referral, ReferralRewardConfig } = require('../models');

async function refreshSubscription(subscription) {
  if (!subscription) return subscription;
  const now = new Date();
  if (subscription.status === 'trial' && subscription.trialEndsAt && subscription.trialEndsAt <= now) {
    subscription.status = 'expired';
    await subscription.save();
  }
  if (['active', 'grace_period'].includes(subscription.status) && subscription.periodEndsAt && subscription.periodEndsAt <= now) {
    subscription.status = 'restricted';
    await subscription.save();
  }
  return subscription;
}

async function expireReferrals() {
  return Referral.updateMany({ status: 'pending', expiresAt: { $lte: new Date() } }, { status: 'expired_void' });
}

async function rewardReferralForStudio(refereeStudioId) {
  const referral = await Referral.findOne({ refereeStudioId, status: 'pending', expiresAt: { $gt: new Date() } });
  if (!referral || referral.qualifyingCondition !== 'first_paid_subscription') return null;
  const referrerSubscription = await Subscription.findOne({ studioId: referral.referrerStudioId });
  if (referral.reward.type === 'trial_extension_days' && referrerSubscription) {
    const base = referrerSubscription.trialEndsAt && referrerSubscription.trialEndsAt > new Date() ? referrerSubscription.trialEndsAt : new Date();
    referrerSubscription.trialEndsAt = new Date(base.getTime() + referral.reward.value * 86400000);
    await referrerSubscription.save();
  }
  referral.status = 'rewarded'; referral.rewardedAt = new Date(); await referral.save();
  return referral;
}

async function activeReferralConfig() { return ReferralRewardConfig.findOne({ active: true }).sort({ version: -1 }); }
module.exports = { refreshSubscription, expireReferrals, rewardReferralForStudio, activeReferralConfig };
