const { connectDatabase } = require('../config/db');
const { syncSubscriptionPlans } = require('../services/subscription-plan-catalog.service');
const mongoose = require('mongoose');

async function run() {
  await connectDatabase();
  await syncSubscriptionPlans();
  console.log('Two staff-only subscription plans seeded. Configure their Google/Apple product IDs via the platform-admin API.');
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
