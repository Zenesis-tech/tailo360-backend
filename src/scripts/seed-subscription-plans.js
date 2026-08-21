const { connectDatabase } = require('../config/db');
const { Subscription, SubscriptionPlan } = require('../models');
const mongoose = require('mongoose');

const plans = [
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

async function run() {
  await connectDatabase();
  for (const plan of plans) {
    await SubscriptionPlan.updateOne(
      { code: plan.code },
      { $set: { ...plan, active: true }, $setOnInsert: { storeProducts: [] } },
      { upsert: true },
    );
  }
  await Subscription.updateMany(
    { plan: 'pro' },
    { $set: { plan: 'starter', seatLimit: 2 } },
  );
  await Subscription.updateMany(
    { plan: 'starter' },
    { $set: { seatLimit: 2 } },
  );
  await Subscription.updateMany(
    { plan: 'studio' },
    { $set: { seatLimit: 5 } },
  );
  await SubscriptionPlan.deleteMany({ code: 'pro' });
  console.log('Two staff-only subscription plans seeded. Configure their Google/Apple product IDs via the platform-admin API.');
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
