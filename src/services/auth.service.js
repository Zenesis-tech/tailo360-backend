const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { nanoid } = require('nanoid');
const env = require('../config/env');
const { User, Studio, Member, Subscription, ReferralRewardConfig, Session, Referral, SubscriptionPlan } = require('../models');
const { provisionStarterGarments } = require('./garment-catalog.service');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function tokenPair(user, member) {
  const tokenId = nanoid();
  const payload = { sub: user.id, studioId: member.studioId.toString(), memberId: member.id, role: member.role };
  return { accessToken: jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_TTL }), refreshToken: jwt.sign({ ...payload, tokenId }, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_TTL }), tokenId };
}
async function createStudioFor(user, { studioName, referralCode, garmentAudiences = ['men', 'women'] }) {
  const audiences = [...new Set(garmentAudiences)];
  const studio = await Studio.create({ name: studioName || 'My Studio', ownerUserId: user._id, referralCode: `TL${nanoid(7).toUpperCase()}`, settings: { garmentAudiences: audiences } });
  const owner = await Member.create({ studioId: studio._id, userId: user._id, phone: user.phone || `google:${user.googleSubject}`, role: 'owner' });
  const starter = await SubscriptionPlan.findOne({ code: 'starter', active: true });
  const trialDays = starter?.trialDays ?? 14;
  await Subscription.create({ studioId: studio._id, status: 'trial', plan: 'starter', entitlementSource: 'trial', trialEndsAt: new Date(Date.now() + trialDays * 86400000), seatLimit: starter?.limits.staffSeats ?? 1 });
  await provisionStarterGarments(studio._id, audiences);
  if (referralCode) {
    const referrer = await Studio.findOne({ referralCode: referralCode.toUpperCase() });
    if (referrer && !referrer.ownerUserId.equals(user._id)) {
      const config = await ReferralRewardConfig.findOne({ active: true }).sort({ version: -1 });
      if (config) await Referral.create({ referrerStudioId: referrer._id, refereeStudioId: studio._id, code: referrer.referralCode, configVersion: config.version, qualifyingCondition: config.qualifyingCondition, reward: config.reward, expiresAt: new Date(Date.now() + config.expiryDays * 86400000) });
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
