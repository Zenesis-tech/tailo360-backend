require('dotenv').config();
const mongoose = require('mongoose');
const { User, Studio, Subscription, AppConfig } = require('../models');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const indianUsers = await User.find({ phone: /^\+91/ }).select('_id').lean();
  const indianUserIds = indianUsers.map((user) => user._id);
  const indianStudios = indianUserIds.length
    ? await Studio.find({ ownerUserId: { $in: indianUserIds } }).select('_id').lean()
    : [];
  const indianStudioIds = indianStudios.map((studio) => studio._id);
  await User.updateMany(
    { country: { $exists: false } },
    { $set: { country: 'IN', currency: 'INR', dialCode: '+91', timezone: 'Asia/Kolkata', locale: 'en-IN' } },
  );
  if (indianUserIds.length) {
    await User.updateMany(
      { _id: { $in: indianUserIds } },
      { $set: { country: 'IN', currency: 'INR', dialCode: '+91', timezone: 'Asia/Kolkata', locale: 'en-IN' } },
    );
  }
  await Studio.updateMany(
    { 'settings.country': { $exists: false } },
    { $set: { 'settings.country': 'IN', 'settings.currency': 'INR', 'settings.dialCode': '+91', 'settings.timezone': 'Asia/Kolkata', 'settings.locale': 'en-IN' } },
  );
  if (indianUserIds.length) {
    await Studio.updateMany(
      { ownerUserId: { $in: indianUserIds } },
      { $set: { 'settings.country': 'IN', 'settings.currency': 'INR', 'settings.dialCode': '+91', 'settings.timezone': 'Asia/Kolkata', 'settings.locale': 'en-IN' } },
    );
  }
  await Subscription.updateMany(
    { country: { $exists: false } },
    { $set: { country: 'IN', currency: 'INR' } },
  );
  if (indianStudioIds.length) {
    await Subscription.updateMany(
      { studioId: { $in: indianStudioIds } },
      { $set: { country: 'IN', currency: 'INR' } },
    );
  }
  await AppConfig.updateOne(
    { key: 'platform', supportedCountries: { $exists: false } },
    { $set: { supportedCountries: ['IN', 'US', 'CA', 'GB', 'AU'].map((code) => ({ code, active: true, subscriptionsVisible: true })) } },
    { upsert: true },
  );
  console.log('Global region migration completed.');
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
