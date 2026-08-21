const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { User, Member, Studio, Subscription, SubscriptionPlan } = require('../models');
const { AppError } = require('../utils/errors');
const { refreshSubscription } = require('../services/subscription-lifecycle.service');
const permissionMatrix = {
  owner: ['*'],
  master_tailor: [
    'customers:read',
    'customers:write',
    'orders:read',
    'orders:write',
    'orders:status',
    'templates:read',
  ],
  front_desk: [
    'customers:read',
    'customers:write',
    'orders:read',
    'orders:write',
    'orders:status',
    'templates:read',
    'payments:read',
    'payments:write',
  ],
};
function permissionsFor(member) {
  return member.permissionsOverride?.length
    ? [...member.permissionsOverride]
    : [...(permissionMatrix[member.role] || [])];
}
async function authenticateToken(token) {
  if (!token) throw new AppError(401, 'AUTH_REQUIRED', 'Authentication is required.');
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
    const [user, member, studio, subscription] = await Promise.all([
      User.findOne({ _id: payload.sub, deletedAt: null }),
      Member.findOne({
        _id: payload.memberId,
        userId: payload.sub,
        studioId: payload.studioId,
        status: { $in: ['active', 'limited'] },
      }),
      Studio.findById(payload.studioId),
      Subscription.findOne({ studioId: payload.studioId }),
    ]);
    if (!user || !member || !studio) throw new AppError(401, 'SESSION_INVALID', 'Your session is no longer valid.');
  return { user, member, studio, subscription: await refreshSubscription(subscription) };
}
async function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  try {
    req.auth = await authenticateToken(token);
    return next();
  } catch (error) { return next(error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError' ? new AppError(401, 'TOKEN_INVALID', 'Your session has expired.') : error); }
}
function authorize(permission) { return (req, res, next) => {
  const { member } = req.auth;
  const granted = permissionsFor(member);
  if (member.status === 'limited' && !permission.endsWith(':read')) return next(new AppError(403, 'MEMBERSHIP_LIMITED', 'This membership is read-only.'));
  if (!granted.includes('*') && !granted.includes(permission)) return next(new AppError(403, 'FORBIDDEN', 'You do not have permission for this action.'));
  next();
}; }
async function requireWritableSubscription(req, res, next) {
  const subscription = req.auth.subscription;
  if (['restricted', 'expired'].includes(subscription?.status)) return next(new AppError(403, 'SUBSCRIPTION_RESTRICTED', 'Your subscription does not allow new records.'));
  const plan = await SubscriptionPlan.findOne({ code: subscription?.plan, active: true });
  if (!plan) return next(new AppError(403, 'PLAN_UNAVAILABLE', 'The current subscription plan is unavailable.'));
  return next();
}
function requirePlatformAdmin(req, res, next) {
  if (req.auth.user.platformRole !== 'admin') return next(new AppError(403, 'PLATFORM_ADMIN_REQUIRED', 'Platform-admin access is required.'));
  next();
}
module.exports = { authenticateToken, authenticate, authorize, permissionsFor, requireWritableSubscription, requirePlatformAdmin };
