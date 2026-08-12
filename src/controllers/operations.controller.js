const { z } = require('zod'); const { Order, Studio, Member, Referral, ReferralRewardConfig, Customer, Notification, User, Media } = require('../models'); const { AppError, notFound } = require('../utils/errors'); const { serialize } = require('./order.controller'); const { activeReferralConfig, expireReferrals, rewardReferralForStudio } = require('../services/subscription-lifecycle.service'); const { provisionStarterGarments } = require('../services/garment-catalog.service');
const workflowNotifications = require('../services/workflow-notifications.service');
async function recordPayment(req, res) { const body = z.object({ orderId: z.string(), amountPaise: z.number().int().positive(), direction: z.enum(['collection', 'refund']).default('collection'), method: z.enum(['cash', 'upi', 'card', 'bank']), note: z.string().max(500).optional() }).parse(req.body); const order = await Order.findOne({ _id: body.orderId, studioId: req.auth.studio._id, deletedAt: null }); if (!order) throw notFound('Order'); if (body.direction === 'refund' && req.auth.member.role !== 'owner') throw new AppError(403, 'FORBIDDEN', 'Only an owner can record a refund.'); const paid = order.payments.reduce((sum, p) => sum + (p.direction === 'collection' ? p.amountPaise : -p.amountPaise), 0); if (body.direction === 'collection' && body.amountPaise > order.totalPaise - paid) throw new AppError(422, 'PAYMENT_EXCEEDS_BALANCE', 'A collection cannot exceed the current balance.'); order.payments.push({ amountPaise: body.amountPaise, direction: body.direction, method: body.method, noteType: body.direction === 'refund' ? 'refund' : body.amountPaise === order.totalPaise - paid ? 'full' : 'partial', note: body.note, recordedBy: req.auth.user._id }); order.activity.push({ type: 'payment_recorded', actorId: req.auth.user._id, note: body.note }); await order.save(); workflowNotifications.paymentRecorded(order, body.amountPaise, body.direction, req.auth.user._id); res.status(201).json({ data: serialize(order) }); }
async function duePayments(req, res) { const rows = await Order.find({ studioId: req.auth.studio._id, status: { $ne: 'cancelled' }, deletedAt: null }).populate('customerId', 'name phone').sort({ deliveryDate: 1 }); const due = rows.map(serialize).filter((x) => x.outstandingPaise > 0); res.json({ data: due }); }
async function studio(req, res) { res.json({ data: req.auth.studio }); }
async function updateStudio(req, res) {
  const phoneSchema = z.string().trim().transform((value) => value.replace(/\s|-/g, '')).refine((value) => /^\+?[1-9]\d{9,14}$/.test(value), 'Use a valid mobile number.').transform((value) => value.startsWith('+') ? value : `+91${value}`);
  const body = z.object({
    name: z.string().trim().min(2).max(100).optional(),
    ownerName: z.string().trim().min(2).max(100).optional(),
    ownerPhone: phoneSchema.optional(),
    address: z.string().trim().max(500).optional(),
    businessType: z.enum(['tailoring', 'boutique', 'fashion_designer']).optional(),
    services: z.array(z.enum(['mens_wear', 'womens_wear', 'kids_wear', 'alteration', 'blouse_stitching', 'uniforms', 'saree_stitching', 'other'])).max(8).optional(),
    logoMediaId: z.string().regex(/^[a-f\d]{24}$/i).nullable().optional(),
    invoicePrefix: z.string().regex(/^[A-Za-z0-9-]{1,10}$/).optional(),
    settings: z.object({ measurementUnit: z.enum(['in', 'cm']).optional(), precision: z.enum(['whole', 'half', 'quarter']).optional(), language: z.string().max(10).optional(), currency: z.literal('INR').optional(), garmentAudiences: z.array(z.enum(['men', 'women', 'kids', 'unisex'])).min(1).max(4).optional(), deliveryDays: z.number().int().min(0).max(365).optional(), trialDays: z.number().int().min(0).max(365).optional(), skipSundays: z.boolean().optional(), notifications: z.object({ delivery: z.boolean().optional(), trial: z.boolean().optional() }).optional(), invoice: z.object({ footer: z.string().max(500).optional(), showGst: z.boolean().optional(), showMeasurements: z.boolean().optional() }).optional() }).partial().optional(),
  }).parse(req.body);
  const { ownerName, ownerPhone, ...update } = body;
  if (body.logoMediaId) {
    const logo = await Media.findOne({ _id: body.logoMediaId, studioId: req.auth.studio._id, purpose: 'studio_logo', status: 'ready' });
    if (!logo) throw new AppError(422, 'INVALID_STUDIO_LOGO', 'The selected studio logo is not ready.');
  }
  if (ownerPhone && ownerPhone !== req.auth.user.phone) {
    const existing = await User.exists({ phone: ownerPhone, _id: { $ne: req.auth.user._id } });
    if (existing) throw new AppError(409, 'PHONE_ALREADY_IN_USE', 'This mobile number belongs to another account.');
  }
  if (ownerName || ownerPhone) {
    if (ownerName) req.auth.user.name = ownerName;
    if (ownerPhone) req.auth.user.phone = ownerPhone;
    await req.auth.user.save();
    if (ownerPhone) await Member.updateOne({ _id: req.auth.member._id }, { phone: ownerPhone });
  }
  if (body.settings) {
    update.settings = { ...req.auth.studio.settings.toObject(), ...body.settings, notifications: { ...req.auth.studio.settings.notifications.toObject(), ...body.settings.notifications }, invoice: { ...req.auth.studio.settings.invoice.toObject(), ...body.settings.invoice } };
  }
  if (body.name && ownerName && ownerPhone && body.address && body.businessType && body.services?.length && body.settings?.garmentAudiences?.length) {
    update.onboardingCompletedAt = new Date();
  }
  const value = await Studio.findByIdAndUpdate(req.auth.studio._id, update, { new: true, runValidators: true });
  if (body.settings?.garmentAudiences) await provisionStarterGarments(value._id, body.settings.garmentAudiences);
  res.json({ data: { ...value.toObject(), owner: { name: req.auth.user.name, phone: req.auth.user.phone, email: req.auth.user.email } } });
}
async function members(req, res) { res.json({ data: await Member.find({ studioId: req.auth.studio._id, status: { $ne: 'removed' } }).populate('userId', 'name phone') }); }
async function dashboard(req, res) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const rows = await Order.find({ studioId: req.auth.studio._id, deletedAt: null })
    .populate('customerId', 'name phone');
  const notificationCount = await Notification.countDocuments({ userId: req.auth.user._id, readAt: null });
  const serialized = rows.map(serialize);
  const active = serialized.filter((order) => !['delivered', 'cancelled'].includes(order.status));
  const collections = rows.flatMap((order) => order.payments)
    .filter((payment) => payment.direction === 'collection');
  const sumCollections = (from, to) => collections
    .filter((payment) => payment.recordedAt >= from && payment.recordedAt < to)
    .reduce((sum, payment) => sum + payment.amountPaise, 0);
  const pendingPaise = active.reduce((sum, order) => sum + Math.max(0, order.outstandingPaise), 0);
  const overduePaise = active
    .filter((order) => new Date(order.deliveryDate) < dayStart)
    .reduce((sum, order) => sum + Math.max(0, order.outstandingPaise), 0);
  const today = active
    .filter((order) => {
      const trial = order.trialDate && new Date(order.trialDate);
      const delivery = order.deliveryDate && new Date(order.deliveryDate);
      return (trial && trial >= dayStart && trial < dayEnd)
        || (delivery && delivery >= dayStart && delivery < dayEnd);
    })
    .sort((a, b) => new Date(a.trialDate || a.deliveryDate) - new Date(b.trialDate || b.deliveryDate));
  const attention = active
    .filter((order) => new Date(order.deliveryDate) <= now || order.outstandingPaise > 0)
    .sort((a, b) => new Date(a.deliveryDate) - new Date(b.deliveryDate))
    .slice(0, 10);
  const statusCounts = rows.reduce(
    (map, order) => ({ ...map, [order.status]: (map[order.status] || 0) + 1 }),
    {},
  );
  const inProgressStatuses = ['measurements_pending', 'cutting', 'stitching', 'trial', 'alteration'];
  res.json({
    data: {
      userName: req.auth.user.name || '',
      studioName: req.auth.studio.name,
      notificationCount,
      todayCollectedPaise: sumCollections(dayStart, dayEnd),
      collectedPaise: sumCollections(monthStart, dayEnd),
      pendingPaise,
      overduePaise,
      statusCounts,
      counts: {
        activeOrders: active.length,
        trialsToday: today.filter((order) => order.trialDate && new Date(order.trialDate) >= dayStart && new Date(order.trialDate) < dayEnd).length,
        readyForDelivery: active.filter((order) => order.status === 'ready').length,
        newOrders: statusCounts.pending || 0,
        inProgress: inProgressStatuses.reduce((sum, status) => sum + (statusCounts[status] || 0), 0),
        completed: (statusCounts.ready || 0) + (statusCounts.delivered || 0),
      },
      attention,
      today,
    },
  });
}
async function reports(req, res) { const range = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }).parse(req.query); const from = range.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1); const to = range.to || new Date(); if (to < from) throw new AppError(422, 'INVALID_REPORT_RANGE', 'Report end date cannot be before its start date.'); const [rows, revenue] = await Promise.all([Order.find({ studioId: req.auth.studio._id, createdAt: { $gte: from, $lte: to }, deletedAt: null }).populate('customerId', 'name'), Order.aggregate([{ $match: { studioId: req.auth.studio._id, deletedAt: null } }, { $unwind: '$payments' }, { $match: { 'payments.direction': 'collection', 'payments.recordedAt': { $gte: from, $lte: to } } }, { $group: { _id: null, value: { $sum: '$payments.amountPaise' } } }])]); const revenuePaise = revenue[0]?.value || 0; const garments = {}; for (const order of rows) for (const line of order.lines) { const item = garments[line.name] || { quantity: 0, revenuePaise: 0 }; item.quantity += line.quantity; item.revenuePaise += line.lineTotalPaise; garments[line.name] = item; } res.json({ data: { from, to, revenuePaise, orders: rows.length, garments, duePayments: rows.map(serialize).filter((order) => order.outstandingPaise > 0), dueDeliveries: rows.map(serialize).filter((order) => !['delivered', 'cancelled'].includes(order.status) && order.deliveryDate <= to) } }); }
async function referral(req, res) {
  await expireReferrals();
  const [rows, applied, config] = await Promise.all([
    Referral.find({ referrerStudioId: req.auth.studio._id }).populate('refereeStudioId', 'name createdAt').sort({ createdAt: -1 }),
    Referral.findOne({ refereeStudioId: req.auth.studio._id }).populate('referrerStudioId', 'name'),
    activeReferralConfig(),
  ]);
  const history = rows.map((row) => ({
    id: row._id,
    studioName: row.refereeStudioId?.name || 'Referred studio',
    joinedAt: row.refereeStudioId?.createdAt || row.createdAt,
    status: row.status,
    qualifyingCondition: row.qualifyingCondition,
    reward: row.reward,
    expiresAt: row.expiresAt,
    rewardedAt: row.rewardedAt,
  }));
  const rewarded = rows.filter((row) => row.status === 'rewarded');
  res.json({ data: {
    code: req.auth.studio.referralCode,
    offer: config ? { qualifyingCondition: config.qualifyingCondition, reward: config.reward, expiryDays: config.expiryDays } : null,
    appliedReferral: applied ? {
      code: applied.code,
      studioName: applied.referrerStudioId?.name || 'Referring studio',
      status: applied.status,
      qualifyingCondition: applied.qualifyingCondition,
      reward: applied.reward,
      expiresAt: applied.expiresAt,
      rewardedAt: applied.rewardedAt,
    } : null,
    history,
    summary: {
      pending: rows.filter((row) => row.status === 'pending').length,
      rewarded: rewarded.length,
      expired: rows.filter((row) => row.status === 'expired_void').length,
      earnedTrialDays: rewarded.filter((row) => row.reward.type === 'trial_extension_days').reduce((sum, row) => sum + row.reward.value, 0),
      earnedCreditPaise: rewarded.filter((row) => row.reward.type === 'account_credit').reduce((sum, row) => sum + row.reward.value * 100, 0),
    },
  } });
}
async function redeemReferral(req, res) {
  // `_` and `-` keep referral codes issued by older NanoID builds usable.
  const code = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{6,10}$/, 'Enter a valid referral code.') }).parse(req.body).code;
  const existing = await Referral.findOne({ refereeStudioId: req.auth.studio._id });
  if (existing) throw new AppError(409, 'REFERRAL_ALREADY_REDEEMED', 'A referral code has already been applied to this studio.');
  const referrer = await Studio.findOne({ referralCode: code });
  if (!referrer || referrer._id.equals(req.auth.studio._id)) throw new AppError(422, 'REFERRAL_INVALID', 'This referral code is not valid.');
  const config = await activeReferralConfig();
  if (!config) throw new AppError(503, 'REFERRALS_UNAVAILABLE', 'Referral rewards are not configured.');
  let row;
  try {
    row = await Referral.create({ referrerStudioId: referrer._id, refereeStudioId: req.auth.studio._id, code, configVersion: config.version, qualifyingCondition: config.qualifyingCondition, reward: config.reward, expiresAt: new Date(Date.now() + config.expiryDays * 86400000) });
  } catch (error) {
    if (error?.code === 11000) throw new AppError(409, 'REFERRAL_ALREADY_REDEEMED', 'A referral code has already been applied to this studio.');
    throw error;
  }
  if (config.qualifyingCondition === 'signup_complete') row = await rewardReferralForStudio(req.auth.studio._id, 'signup_complete') || row;
  res.status(201).json({ data: row });
}
async function schedule(req, res) { const from = req.query.from ? new Date(req.query.from) : new Date(), to = req.query.to ? new Date(req.query.to) : new Date(from.getTime() + 7 * 86400000); const rows = await Order.find({ studioId: req.auth.studio._id, status: { $nin: ['delivered', 'cancelled'] }, $or: [{ trialDate: { $gte: from, $lte: to } }, { deliveryDate: { $gte: from, $lte: to } }] }).populate('customerId', 'name phone'); res.json({ data: rows.map(serialize), meta: { from, to } }); }
const rewardConfigInput = z.object({ qualifyingCondition: z.enum(['signup_complete', 'first_paid_subscription']), reward: z.object({ type: z.enum(['trial_extension_days', 'account_credit']), value: z.number().int().positive() }), expiryDays: z.number().int().min(1).max(365), active: z.boolean().optional() });
async function adminReferralConfigs(req, res) { res.json({ data: await ReferralRewardConfig.find().sort({ version: -1 }) }); }
async function adminCreateReferralConfig(req, res) { const input = rewardConfigInput.parse(req.body); if (input.active ?? true) await ReferralRewardConfig.updateMany({ active: true }, { active: false }); const latest = await ReferralRewardConfig.findOne().sort({ version: -1 }); const config = await ReferralRewardConfig.create({ ...input, active: input.active ?? true, version: (latest?.version || 0) + 1 }); res.status(201).json({ data: config }); }
module.exports = { recordPayment, duePayments, studio, updateStudio, members, dashboard, reports, referral, redeemReferral, schedule, adminReferralConfigs, adminCreateReferralConfig };
