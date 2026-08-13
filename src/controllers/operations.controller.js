const { z } = require('zod'); const { Order, Studio, Member, Referral, ReferralRewardConfig, Customer, Notification, User, Media } = require('../models'); const { AppError, notFound } = require('../utils/errors'); const { serialize, serializePopulated } = require('./order.controller'); const { activeReferralConfig, expireReferrals, rewardReferralForStudio } = require('../services/subscription-lifecycle.service'); const { provisionStarterGarments } = require('../services/garment-catalog.service');
const workflowNotifications = require('../services/workflow-notifications.service');
async function recordPayment(req, res) { const body = z.object({ orderId: z.string(), amountPaise: z.number().int().positive(), direction: z.enum(['collection', 'refund']).default('collection'), method: z.enum(['cash', 'upi', 'card', 'bank']), note: z.string().max(500).optional() }).parse(req.body); const order = await Order.findOne({ _id: body.orderId, studioId: req.auth.studio._id, deletedAt: null }); if (!order) throw notFound('Order'); if (body.direction === 'refund' && req.auth.member.role !== 'owner') throw new AppError(403, 'FORBIDDEN', 'Only an owner can record a refund.'); const paid = order.payments.reduce((sum, p) => sum + (p.direction === 'collection' ? p.amountPaise : -p.amountPaise), 0); if (body.direction === 'collection' && body.amountPaise > order.totalPaise - paid) throw new AppError(422, 'PAYMENT_EXCEEDS_BALANCE', 'A collection cannot exceed the current balance.'); order.payments.push({ amountPaise: body.amountPaise, direction: body.direction, method: body.method, noteType: body.direction === 'refund' ? 'refund' : body.amountPaise === order.totalPaise - paid ? 'full' : 'partial', note: body.note, recordedBy: req.auth.user._id }); order.activity.push({ type: 'payment_recorded', actorId: req.auth.user._id, note: body.note }); await order.save(); workflowNotifications.paymentRecorded(order, body.amountPaise, body.direction, req.auth.user._id); res.status(201).json({ data: await serializePopulated(order) }); }
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
  if (ownerPhone && req.auth.user.phone && ownerPhone !== req.auth.user.phone) {
    throw new AppError(422, 'LOGIN_PHONE_IMMUTABLE', 'The login phone cannot be changed from Studio Profile.');
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
  if (body.services) {
    const serviceAudiences = new Set(body.settings?.garmentAudiences || []);
    if (body.services.includes('mens_wear')) serviceAudiences.add('men');
    if (body.services.some((service) => ['womens_wear', 'blouse_stitching', 'saree_stitching'].includes(service))) serviceAudiences.add('women');
    if (body.services.includes('kids_wear')) serviceAudiences.add('kids');
    if (body.services.includes('uniforms')) serviceAudiences.add('unisex');
    if (serviceAudiences.size) {
      update.settings = {
        ...req.auth.studio.settings.toObject(),
        ...update.settings,
        garmentAudiences: [...serviceAudiences],
      };
    }
  }
  if (body.name && ownerName && ownerPhone && body.address && body.businessType && body.services?.length && body.settings?.garmentAudiences?.length) {
    update.onboardingCompletedAt = new Date();
  }
  const value = await Studio.findByIdAndUpdate(req.auth.studio._id, update, { new: true, runValidators: true });
  if (update.settings?.garmentAudiences) await provisionStarterGarments(value._id, update.settings.garmentAudiences);
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
async function reports(req, res) {
  const range = z.object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }).parse(req.query);
  const now = new Date();
  const from = range.from || new Date(now.getFullYear(), now.getMonth(), 1);
  const to = range.to || now;
  if (to < from) throw new AppError(422, 'INVALID_REPORT_RANGE', 'Report end date cannot be before its start date.');
  if (to - from > 370 * 86400000) throw new AppError(422, 'REPORT_RANGE_TOO_LARGE', 'Choose a report period of 12 months or less.');

  const duration = to - from;
  const previousTo = new Date(from.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - duration);
  const studioId = req.auth.studio._id;
  const [periodRows, financeRows, activeRows, paymentDueRows, previousRows, previousFinanceRows] = await Promise.all([
    Order.find({ studioId, createdAt: { $gte: from, $lte: to }, deletedAt: null }).populate('customerId', 'name phone'),
    Order.find({ studioId, 'payments.recordedAt': { $gte: from, $lte: to }, deletedAt: null }).populate('customerId', 'name phone'),
    Order.find({ studioId, status: { $nin: ['delivered', 'cancelled'] }, deletedAt: null }).populate('customerId', 'name phone').sort({ deliveryDate: 1 }),
    Order.find({ studioId, status: { $ne: 'cancelled' }, deletedAt: null }).populate('customerId', 'name phone').sort({ deliveryDate: 1 }),
    Order.find({ studioId, createdAt: { $gte: previousFrom, $lte: previousTo }, deletedAt: null }).select('status payments totalPaise createdAt'),
    Order.find({ studioId, 'payments.recordedAt': { $gte: previousFrom, $lte: previousTo }, deletedAt: null }).select('payments'),
  ]);

  const paymentRows = financeRows.flatMap((order) => order.payments
    .filter((payment) => payment.recordedAt >= from && payment.recordedAt <= to)
    .map((payment) => ({ payment, order })));
  const previousPayments = previousFinanceRows.flatMap((order) => order.payments
    .filter((payment) => payment.recordedAt >= previousFrom && payment.recordedAt <= previousTo));
  const collectedPaise = paymentRows.filter(({ payment }) => payment.direction === 'collection').reduce((sum, { payment }) => sum + payment.amountPaise, 0);
  const refundedPaise = paymentRows.filter(({ payment }) => payment.direction === 'refund').reduce((sum, { payment }) => sum + payment.amountPaise, 0);
  const previousCollected = previousPayments.filter((payment) => payment.direction === 'collection').reduce((sum, payment) => sum + payment.amountPaise, 0)
    - previousPayments.filter((payment) => payment.direction === 'refund').reduce((sum, payment) => sum + payment.amountPaise, 0);
  const reportOrders = periodRows.filter((order) => order.status !== 'cancelled');
  const bookedSalesPaise = reportOrders.reduce((sum, order) => sum + order.totalPaise, 0);
  const serializedActive = activeRows.map(serialize);
  const duePayments = paymentDueRows.map(serialize).filter((order) => order.outstandingPaise > 0);
  const outstandingPaise = duePayments.reduce((sum, order) => sum + order.outstandingPaise, 0);
  const nextWeek = new Date(now.getTime() + 7 * 86400000);
  const overdueDeliveries = serializedActive.filter((order) => order.deliveryDate < now);
  const dueDeliveries = serializedActive.filter((order) => order.deliveryDate >= now && order.deliveryDate < nextWeek);

  const garments = {};
  const statuses = {};
  const customers = new Map();
  for (const order of periodRows) {
    statuses[order.status] = (statuses[order.status] || 0) + 1;
    if (order.status === 'cancelled') continue;
    for (const line of order.lines) {
      const item = garments[line.name] || { quantity: 0, revenuePaise: 0, orders: 0 };
      item.quantity += line.quantity;
      item.revenuePaise += line.lineTotalPaise;
      item.orders += 1;
      garments[line.name] = item;
    }
    const customerId = order.customerId?._id?.toString() || order.customerId?.toString();
    if (customerId) {
      const customer = customers.get(customerId) || { id: customerId, name: order.customerId?.name || 'Customer', phone: order.customerId?.phone || '', orders: 0, valuePaise: 0 };
      customer.orders += 1;
      customer.valuePaise += order.totalPaise;
      customers.set(customerId, customer);
    }
  }

  const istDayKey = (date) => new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 10);
  const daily = new Map();
  for (const order of reportOrders) {
    const key = istDayKey(order.createdAt);
    const item = daily.get(key) || { date: key, orders: 0, bookedPaise: 0, collectedPaise: 0 };
    item.orders += 1;
    item.bookedPaise += order.totalPaise;
    daily.set(key, item);
  }
  for (const { payment } of paymentRows) {
    const key = istDayKey(payment.recordedAt);
    const item = daily.get(key) || { date: key, orders: 0, bookedPaise: 0, collectedPaise: 0 };
    item.collectedPaise += payment.direction === 'collection' ? payment.amountPaise : -payment.amountPaise;
    daily.set(key, item);
  }
  const paymentMethods = {};
  for (const { payment } of paymentRows) {
    const signedAmount = payment.direction === 'collection' ? payment.amountPaise : -payment.amountPaise;
    paymentMethods[payment.method] = (paymentMethods[payment.method] || 0) + signedAmount;
  }
  const completed = periodRows.filter((order) => order.status === 'delivered').length;
  const completionBase = periodRows.filter((order) => order.status !== 'cancelled').length;
  const percentChange = (current, previous) => previous === 0 ? (current === 0 ? 0 : 100) : Math.round(((current - previous) / previous) * 1000) / 10;
  const topCustomers = [...customers.values()].sort((a, b) => b.valuePaise - a.valuePaise).slice(0, 5);
  const netCollectionsPaise = collectedPaise - refundedPaise;

  res.json({ data: {
    from,
    to,
    revenuePaise: collectedPaise,
    collectedPaise,
    refundedPaise,
    netRevenuePaise: netCollectionsPaise,
    // Compatibility for report clients that previously rendered zero when
    // this key was absent. Costs are not tracked yet, so this is net cash,
    // not an accounting profit calculation.
    netProfitPaise: netCollectionsPaise,
    bookedSalesPaise,
    outstandingPaise,
    orders: periodRows.length,
    averageOrderPaise: reportOrders.length ? Math.round(bookedSalesPaise / reportOrders.length) : 0,
    completionRate: completionBase ? Math.round((completed / completionBase) * 1000) / 10 : 0,
    uniqueCustomers: customers.size,
    repeatCustomers: [...customers.values()].filter((customer) => customer.orders > 1).length,
    statuses,
    garments,
    paymentMethods,
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    topCustomers,
    duePayments,
    dueDeliveries,
    overdueDeliveries,
    comparison: {
      revenuePercent: percentChange(collectedPaise - refundedPaise, previousCollected),
      ordersPercent: percentChange(periodRows.length, previousRows.length),
    },
  } });
}
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
