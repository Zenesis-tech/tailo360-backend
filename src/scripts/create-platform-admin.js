const mongoose = require('mongoose');
const { connectDatabase } = require('../config/db');
const { User, Member } = require('../models');
const { createStudioFor } = require('../services/auth.service');
const { hashPassword } = require('../services/password.service');

async function run() {
  const [rawEmail, password, name = 'Platform Admin'] = process.argv.slice(2);
  const email = rawEmail?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 10) throw new Error('Usage: npm run create:admin -- "admin@example.com" "a-strong-password" "Admin Name" (password must be 10+ characters)');
  await connectDatabase();
  let user = await User.findOne({ email }).select('+passwordHash');
  if (!user) { user = await User.create({ email, name, platformRole: 'admin', passwordHash: hashPassword(password) }); await createStudioFor(user, { studioName: `${name}'s Studio` }); }
  else { user.name = user.name || name; user.platformRole = 'admin'; user.passwordHash = hashPassword(password); await user.save(); const membership = await Member.exists({ userId: user._id, status: { $in: ['active', 'limited'] } }); if (!membership) await createStudioFor(user, { studioName: `${name}'s Studio` }); }
  console.log(`Platform admin ready: ${user.email}`);
  await mongoose.disconnect();
}
run().catch(async (error) => { console.error(error.message); await mongoose.disconnect(); process.exit(1); });
