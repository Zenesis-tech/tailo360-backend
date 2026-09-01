require('dotenv').config();
const mongoose = require('mongoose');
const { Studio } = require('../models');
const {
  rescheduleStudioOrderReminders,
} = require('../services/reminder-jobs.service');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const studios = await Studio.find().select('settings.notifications');
  for (const studio of studios) {
    await rescheduleStudioOrderReminders(
      studio._id,
      studio.settings?.notifications || {},
    );
  }
  console.log(`Rescheduled order reminders for ${studios.length} studios at 09:00 local time.`);
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
