const { connectDatabase } = require('../config/db');
const { SubscriptionPlan } = require('../models');

const plans = [
  { code: 'starter', name: 'Starter', description: 'Simple order and customer tracking.', trialDays: 14, monthlyPricePaise: 29900, yearlyPricePaise: 299000, limits: { customers: 80, ordersPerMonth: 150, staffSeats: 1 }, features: ['Basic measurement profiles', 'Delivery reminders'], storeProducts: [] },
  { code: 'pro', name: 'Pro', description: 'For growing studios with daily orders.', trialDays: 14, monthlyPricePaise: 69900, yearlyPricePaise: 699000, limits: { customers: -1, ordersPerMonth: -1, staffSeats: 1 }, features: ['Advanced measurement history', 'Payment tracking', 'Reports'], storeProducts: [] },
  { code: 'studio', name: 'Studio', description: 'For teams and advanced reporting.', trialDays: 14, monthlyPricePaise: 129900, yearlyPricePaise: 1299000, limits: { customers: -1, ordersPerMonth: -1, staffSeats: 3 }, features: ['Role-based staff access', 'Priority support', 'Report exports'], storeProducts: [] },
];

connectDatabase().then(async () => { for (const plan of plans) await SubscriptionPlan.updateOne({ code: plan.code }, { $setOnInsert: plan }, { upsert: true }); console.log('Subscription plans seeded. Add real Google/Apple product IDs via platform-admin API.'); process.exit(0); }).catch((error) => { console.error(error); process.exit(1); });
