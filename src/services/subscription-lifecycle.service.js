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
