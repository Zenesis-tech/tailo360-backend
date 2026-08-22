const { SubscriptionOffer, SubscriptionPlan } = require('../models');

/// Atomically reserves the next eligible new-studio offer. This makes a
/// "first 1,000" cap safe even when many signups complete at the same time.
async function claimNewStudioOffer(now = new Date()) {
  const offer = await SubscriptionOffer.findOneAndUpdate(
    {
      active: true,
      'eligibility.audience': 'new_studios',
      $and: [
        {
          $or: [
            { 'eligibility.startsAt': { $exists: false } },
            { 'eligibility.startsAt': null },
            { 'eligibility.startsAt': { $lte: now } },
          ],
        },
        {
          $or: [
            { 'eligibility.endsAt': { $exists: false } },
            { 'eligibility.endsAt': null },
            { 'eligibility.endsAt': { $gte: now } },
          ],
        },
        {
          $or: [
            { 'eligibility.maxRedemptions': 0 },
            { $expr: { $lt: ['$redemptionCount', '$eligibility.maxRedemptions'] } },
          ],
        },
      ],
    },
    { $inc: { redemptionCount: 1 } },
    { new: true, sort: { priority: -1, createdAt: 1 } },
  );
  if (!offer) return null;

  const plan = await SubscriptionPlan.findOne({
    code: offer.benefit.plan,
    active: true,
  });
  // Never grant an unavailable plan. Release the reservation if the plan was
  // retired after the campaign was created.
  if (!plan) {
    await SubscriptionOffer.updateOne({ _id: offer._id, redemptionCount: { $gt: 0 } }, { $inc: { redemptionCount: -1 } });
    return null;
  }
  return { offer, plan };
}

module.exports = { claimNewStudioOffer };
