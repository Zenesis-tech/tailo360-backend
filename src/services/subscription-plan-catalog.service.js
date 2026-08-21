const { Subscription, SubscriptionPlan } = require('../models');

const subscriptionPlans = [
  {
    code: 'starter',
    name: '2 Staff',
    description: 'Everything your studio needs, with access for 2 staff members.',
    trialDays: 14,
    monthlyPricePaise: 4900,
    yearlyPricePaise: 47040,
    limits: { customers: -1, ordersPerMonth: -1, staffSeats: 2 },
    features: ['2 staff members', 'Unlimited clients and orders', 'Measurements and reminders', 'Payments and reports'],
  },
  {
    code: 'studio',
    name: '5 Staff',
    description: 'The same complete Tailo360 experience for a larger team.',
    trialDays: 14,
    monthlyPricePaise: 9900,
    yearlyPricePaise: 95040,
    limits: { customers: -1, ordersPerMonth: -1, staffSeats: 5 },
    features: ['5 staff members', 'Unlimited clients and orders', 'Measurements and reminders', 'Payments and reports'],
  },
];

async function syncSubscriptionPlans() {
  const legacyPro = await SubscriptionPlan.findOne({ code: 'pro' }).lean();

  for (const plan of subscriptionPlans) {
    await SubscriptionPlan.updateOne(
      { code: plan.code },
      { $set: { ...plan, active: true }, $setOnInsert: { storeProducts: [] } },
      { upsert: true },
    );
  }
  await Subscription.updateMany(
    { plan: { $in: ['starter', 'pro'] } },
    { $set: { plan: 'starter', seatLimit: 2 } },
  );
  await Subscription.updateMany(
    { plan: 'studio' },
    { $set: { seatLimit: 5 } },
  );

  if (legacyPro?.storeProducts?.length) {
    const starter = await SubscriptionPlan.findOne({ code: 'starter' });
    const existing = new Set(
      (starter.legacyStoreProducts || []).map(
        (product) => `${product.platform}:${product.productId}`,
      ),
    );
    for (const product of legacyPro.storeProducts) {
      const key = `${product.platform}:${product.productId}`;
      if (!existing.has(key)) {
        starter.legacyStoreProducts.push({
          platform: product.platform,
          productId: product.productId,
          period: product.period,
        });
        existing.add(key);
      }
    }
    await starter.save();
  }

  await SubscriptionPlan.deleteMany({ code: 'pro' });
}

module.exports = { subscriptionPlans, syncSubscriptionPlans };
