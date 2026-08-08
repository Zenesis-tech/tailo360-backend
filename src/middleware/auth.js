const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { User, Member, Studio, Subscription, SubscriptionPlan, Customer, Order } = require('../models');
const { AppError } = require('../utils/errors');
const { refreshSubscription } = require('../services/subscription-lifecycle.service');
const permissionMatrix = {
  owner: ['*'], master_tailor: ['customers:read', 'customers:write', 'orders:read', 'orders:write', 'orders:status', 'templates:read'], front_desk: ['customers:read', 'customers:write', 'orders:read', 'orders:write', 'orders:deliver', 'payments:read', 'payments:write'],
};
async function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return next(new AppError(401, 'AUTH_REQUIRED', 'Authentication is required.'));
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
    const [user, member, studio, subscription] = await Promise.all([User.findById(payload.sub), Member.findById(payload.memberId), Studio.findById(payload.studioId), Subscription.findOne({ studioId: payload.studioId })]);
    if (!user || !member || !studio || member.status === 'paused' || member.status === 'removed') throw new AppError(401, 'SESSION_INVALID', 'Your session is no longer valid.');
    req.auth = { user, member, studio, subscription: await refreshSubscription(subscription) };
    return next();
  } catch (error) { return next(error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError' ? new AppError(401, 'TOKEN_INVALID', 'Your session has expired.') : error); }
}
function authorize(permission) { return (req, res, next) => {
  const { member } = req.auth;
  const granted = member.permissionsOverride?.length ? member.permissionsOverride : permissionMatrix[member.role] || [];
  if (member.status === 'limited' && !permission.endsWith(':read')) return next(new AppError(403, 'MEMBERSHIP_LIMITED', 'This membership is read-only.'));
  if (!granted.includes('*') && !granted.includes(permission)) return next(new AppError(403, 'FORBIDDEN', 'You do not have permission for this action.'));
  next();
}; }
async function requireWritableSubscription(req, res, next) {
  const subscription = req.auth.subscription;
  if (['restricted', 'expired', 'cancelled'].includes(subscription?.status)) return next(new AppError(403, 'SUBSCRIPTION_RESTRICTED', 'Your subscription does not allow new records.'));
  const plan = await SubscriptionPlan.findOne({ code: subscription?.plan, active: true });
  if (!plan) return next(new AppError(403, 'PLAN_UNAVAILABLE', 'The current subscription plan is unavailable.'));
  if (req.path === '/customers' && plan.limits.customers >= 0) {
    const count = await Customer.countDocuments({ studioId: req.auth.studio._id, deletedAt: null });
    if (count >= plan.limits.customers) return next(new AppError(403, 'CUSTOMER_LIMIT_REACHED', 'This plan has reached its customer limit.'));
  }
  if (req.path === '/orders' && plan.limits.ordersPerMonth >= 0) {
    const now = new Date(); const count = await Order.countDocuments({ studioId: req.auth.studio._id, createdAt: { $gte: new Date(now.getFullYear(), now.getMonth(), 1) }, deletedAt: null });
    if (count >= plan.limits.ordersPerMonth) return next(new AppError(403, 'ORDER_LIMIT_REACHED', 'This plan has reached its monthly order limit.'));
  }
  return next();
}
function requirePlatformAdmin(req, res, next) {
  if (req.auth.user.platformRole !== 'admin') return next(new AppError(403, 'PLATFORM_ADMIN_REQUIRED', 'Platform-admin access is required.'));
  next();
}
module.exports = { authenticate, authorize, requireWritableSubscription, requirePlatformAdmin };
