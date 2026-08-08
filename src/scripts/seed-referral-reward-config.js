const { connectDatabase } = require('../config/db');
const { ReferralRewardConfig } = require('../models');

connectDatabase().then(async () => {
  const existing = await ReferralRewardConfig.findOne({ active: true });
  if (!existing) await ReferralRewardConfig.create({ version: 1, qualifyingCondition: 'first_paid_subscription', reward: { type: 'trial_extension_days', value: 7 }, expiryDays: 90, active: true });
  console.log('Referral reward configuration seeded.');
  process.exit(0);
}).catch((error) => { console.error(error); process.exit(1); });
