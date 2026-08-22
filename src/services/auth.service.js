const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { nanoid, customAlphabet } = require('nanoid');
const env = require('../config/env');
const { User, Studio, Member, Subscription, ReferralRewardConfig, Session, Referral, SubscriptionPlan } = require('../models');
const { provisionStarterGarments } = require('./garment-catalog.service');
const { rewardReferralForStudio } = require('./subscription-lifecycle.service');
const { claimNewStudioOffer } = require('./subscription-offer.service');
const referralId = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 7);
const starterPlanDefaults = {
  code: 'starter',
  name: '2 Staff',
  description: 'Everything your studio needs, with access for 2 staff members.',
  active: true,
  trialDays: 14,
  monthlyPricePaise: 4900,
  yearlyPricePaise: 47040,
  limits: { customers: -1, ordersPerMonth: -1, staffSeats: 2 },
  features: ['2 staff members', 'Unlimited clients and orders', 'Measurements and reminders', 'Payments and reports'],
  storeProducts: [],
};
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function tokenPair(user, member) {
  const tokenId = nanoid();
  const payload = { sub: user.id, studioId: member.studioId.toString(), memberId: member.id, role: member.role };
  return { accessToken: jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_TTL }), refreshToken: jwt.sign({ ...payload, tokenId }, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_TTL }), tokenId };
}
async function createStudioFor(user, { studioName, referralCode, garmentAudiences = ['men', 'women'] }) {
  const audiences = [...new Set(garmentAudiences)];
  const studio = await Studio.create({ name: studioName || 'My Studio', ownerUserId: user._id, referralCode: `TL${referralId()}`, settings: { garmentAudiences: audiences } });
  const owner = await Member.create({ studioId: studio._id, userId: user._id, phone: user.phone || `google:${user.googleSubject}`, role: 'owner' });
  const starter = await SubscriptionPlan.findOneAndUpdate(
    { code: 'starter' },
    { $setOnInsert: starterPlanDefaults },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  const claimedOffer = await claimNewStudioOffer();
  const offer = claimedOffer?.offer;
  const subscriptionPlan = claimedOffer?.plan || starter;
  const durationDays = offer?.benefit.durationDays ?? subscriptionPlan?.trialDays ?? 14;
  const accessEndsAt = new Date(Date.now() + durationDays * 86400000);
  const isActiveOffer = offer?.benefit.type === 'plan_access_days';
  await Subscription.create({
    studioId: studio._id,
    status: isActiveOffer ? 'active' : 'trial',
    plan: subscriptionPlan?.code || 'starter',
    entitlementSource: offer ? 'promotion' : 'trial',
    trialEndsAt: isActiveOffer ? undefined : accessEndsAt,
    periodEndsAt: isActiveOffer ? accessEndsAt : undefined,
    seatLimit: subscriptionPlan?.limits.staffSeats ?? 2,
    promotion: offer ? { offerId: offer._id, code: offer.code, title: offer.title, redeemedAt: new Date() } : undefined,
  });
  await provisionStarterGarments(studio._id, audiences);
  if (referralCode) {
    const referrer = await Studio.findOne({ referralCode: referralCode.toUpperCase() });
    if (referrer && !referrer.ownerUserId.equals(user._id)) {
      const config = await ReferralRewardConfig.findOne({ active: true }).sort({ version: -1 });
      if (config) {
        await Referral.create({ referrerStudioId: referrer._id, refereeStudioId: studio._id, code: referrer.referralCode, configVersion: config.version, qualifyingCondition: config.qualifyingCondition, reward: config.reward, expiresAt: new Date(Date.now() + config.expiryDays * 86400000) });
        if (config.qualifyingCondition === 'signup_complete') await rewardReferralForStudio(studio._id, 'signup_complete');
      }
    }
  }
  return { studio, owner };
}
async function issueSession(user, member) {
  const pair = tokenPair(user, member);
  const decoded = jwt.decode(pair.refreshToken);
  await Session.create({
    userId: user._id,
    tokenId: pair.tokenId,
    expiresAt: decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 30 * 86400000),
  });
  return pair;
}
module.exports = { hash, createStudioFor, issueSession };
