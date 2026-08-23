const mongoose = require('mongoose');
const { connectDatabase } = require('../config/db');
const { User } = require('../models');
const {
  demoPhone,
  ensureDemoStudio,
  seedDemoStudio,
} = require('../services/demo-account.service');

async function main() {
  await connectDatabase();
  const user = await User.findOneAndUpdate(
    { phone: demoPhone },
    {
      $set: {
        deletedAt: null,
        deletionRequestedAt: null,
        deletionScheduledFor: null,
      },
      $setOnInsert: { name: 'Tailo360 Demo Owner' },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  const { studio } = await ensureDemoStudio(user);
  await seedDemoStudio({ user, studio });
  console.log(`Demo studio ready: ${studio.id}`);
}

main()
  .catch((error) => {
    console.error('Demo seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
