const { z } = require('zod');
const { Subscription, SubscriptionPlan, SubscriptionEvent, Member } = require('../models');
const { AppError } = require('../utils/errors');
const { verifyPurchase, planFor } = require('../services/store-verification.service');
const { rewardReferralForStudio, expireReferrals } = require('../services/subscription-lifecycle.service');
const { auditAdmin } = require('../services/audit.service');
const { send: sendNotification } = require('../services/notification.service');
function get(req, res) {
  res.set("Cache-Control", "no-store");
  res.json({ data: req.auth.subscription });
}
async function usage(req, res) {
  const studioId = req.auth.studio._id;
  const [staff, plan] = await Promise.all([
    Member.countDocuments({ studioId, role: { $ne: 'owner' }, status: { $in: ['active', 'limited'] } }),
    SubscriptionPlan.findOne({ code: req.auth.subscription.plan }).select('limits'),
  ]);
  res.json({ data: { staff, limits: { staffSeats: plan?.limits.staffSeats || req.auth.subscription.seatLimit || 2 } } });
}
async function plans(req, res) { const rows = await SubscriptionPlan.find({ active: true }).select('code name description monthlyPricePaise yearlyPricePaise limits features storeProducts').sort({ monthlyPricePaise: 1 }); res.json({ data: rows }); }
async function products(req, res) { const plans = await SubscriptionPlan.find({ active: true }).sort({ monthlyPricePaise: 1 }); const platform = req.query.platform; const data = plans.flatMap((plan) => plan.storeProducts.filter((product) => product.active && (!platform || product.platform === platform)).map((product) => ({ id: product.productId, platform: product.platform, period: product.period, plan: plan.code, name: plan.name, pricePaise: product.period === 'yearly' ? plan.yearlyPricePaise : plan.monthlyPricePaise }))); res.json({ data }); }
async function validatePurchase(req, res) {
  const body = z.object({ platform: z.enum(['google', 'apple']), purchaseToken: z.string().min(10).optional(), transactionId: z.string().min(5).optional() }).superRefine((value, context) => { if (value.platform === 'google' && !value.purchaseToken) context.addIssue({ code: 'custom', message: 'purchaseToken is required.' }); if (value.platform === 'apple' && !value.transactionId) context.addIssue({ code: 'custom', message: 'transactionId is required.' }); }).parse(req.body);
  const verified = await verifyPurchase(body.platform, body); const product = await planFor(verified.productId, verified.platform);
  const duplicate = await SubscriptionEvent.findOne({ platform: verified.platform, transactionId: verified.transactionId }); if (duplicate && !duplicate.studioId.equals(req.auth.studio._id)) throw new AppError(409, 'PURCHASE_ALREADY_CLAIMED', 'This purchase is linked to another studio.');
  await SubscriptionEvent.findOneAndUpdate({ platform: verified.platform, transactionId: verified.transactionId }, { studioId: req.auth.studio._id, platform: verified.platform, transactionId: verified.transactionId, originalTransactionId: verified.originalTransactionId, productId: verified.productId, raw: verified.raw, verifiedAt: new Date() }, { upsert: true, new: true });
  const subscription = await Subscription.findOneAndUpdate({ studioId: req.auth.studio._id }, { plan: product.code, status: verified.status, platform: verified.platform, entitlementSource: 'store', productId: verified.productId, originalTransactionId: verified.originalTransactionId, periodEndsAt: verified.periodEndsAt, lastVerifiedAt: new Date(), seatLimit: product.limits.staffSeats }, { new: true, upsert: true, setDefaultsOnInsert: true });
  if (verified.status === 'active') await rewardReferralForStudio(req.auth.studio._id);
  await expireReferrals();
  sendNotification(req.auth.studio._id, {
    type: verified.status === 'active' ? 'subscription_activated' : 'subscription_updated',
    title: verified.status === 'active' ? 'Subscription activated' : 'Subscription updated',
    body: `${product.name} is now ${verified.status}.`,
    data: { route: 'subscription' },
    source: 'system',
    dedupeKey: `purchase:${verified.platform}:${verified.transactionId}`,
  }).catch(console.error);
  res.json({ data: subscription });
}
const planInput = z.object({ code: z.enum(['starter', 'studio']), name: z.string().trim().min(2).max(50), description: z.string().trim().max(300).optional(), active: z.boolean().optional(), trialDays: z.number().int().min(0).max(90), monthlyPricePaise: z.number().int().min(0), yearlyPricePaise: z.number().int().min(0), limits: z.object({ customers: z.literal(-1), ordersPerMonth: z.literal(-1), staffSeats: z.number().int().min(1) }), features: z.array(z.string().trim().min(1).max(100)).max(30), storeProducts: z.array(z.object({ platform: z.enum(['google', 'apple']), productId: z.string().trim().min(1).max(150), period: z.enum(['monthly', 'yearly']), active: z.boolean().default(true) })).max(12) });
async function adminListPlans(req, res) { res.json({ data: await SubscriptionPlan.find().sort({ monthlyPricePaise: 1 }) }); }
async function adminCreatePlan(req, res) { const plan = await SubscriptionPlan.create(planInput.parse(req.body)); await auditAdmin(req, 'subscription_plan.created', 'subscription_plan', plan, undefined, plan); res.status(201).json({ data: plan }); }
async function adminUpdatePlan(req, res) { const before = await SubscriptionPlan.findById(req.params.id); const plan = await SubscriptionPlan.findByIdAndUpdate(req.params.id, planInput.partial().parse(req.body), { new: true, runValidators: true }); if (!plan) throw new AppError(404, 'NOT_FOUND', 'Subscription plan was not found.'); await auditAdmin(req, 'subscription_plan.updated', 'subscription_plan', plan, before, plan); res.json({ data: plan }); }
module.exports = { get, usage, plans, products, validatePurchase, adminListPlans, adminCreatePlan, adminUpdatePlan };
