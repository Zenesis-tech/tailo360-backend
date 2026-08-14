const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { z } = require('zod');
const env = require('../config/env');
const { Otp, User, Member, Session, Studio } = require('../models');
const { AppError } = require('../utils/errors');
const { hash, createStudioFor, issueSession } = require('../services/auth.service');
const otpProvider = require('../services/otp-provider.service');
const { verifyPassword } = require('../services/password.service');
const { firebaseAdmin } = require('../services/firebase-admin.service');
const useOtpProvider = () => env.NODE_ENV === 'production' || env.OTP_DELIVERY_MODE === 'provider';
const phoneSchema = z.string().trim().transform((value) => value.replace(/\s|-/g, '')).refine((value) => /^\+?[1-9]\d{9,14}$/.test(value), 'Use a valid mobile number.').transform((value) => value.startsWith('+') ? value : `+91${value}`);
async function requestOtp(req, res) { const phone = phoneSchema.parse(req.body.phone); if (useOtpProvider()) { await otpProvider.sendOtp(phone); return res.status(202).json({ data: { phone, expiresInSeconds: env.OTP_TTL_MINUTES * 60 } }); } const code = '123456'; await Otp.deleteMany({ phone }); await Otp.create({ phone, codeHash: hash(code), expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60000) }); res.status(202).json({ data: { phone, expiresInSeconds: env.OTP_TTL_MINUTES * 60, ...(env.EXPOSE_DEV_OTP ? { developmentCode: code } : {}) } }); }
async function verifyOtp(req, res) {
  const body = z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/), studioName: z.string().trim().min(2).max(80).optional(), referralCode: z.string().trim().toUpperCase().max(10).optional(), garmentAudiences: z.array(z.enum(['men', 'women', 'kids', 'unisex'])).min(1).max(4).optional() }).parse(req.body);
  if (useOtpProvider()) { if (!await otpProvider.verifyOtp(body.phone, body.code)) throw new AppError(401, 'OTP_INVALID', 'The code is invalid or expired.'); } else { const otp = await Otp.findOne({ phone: body.phone }).sort({ createdAt: -1 }); if (!otp || otp.expiresAt < new Date() || otp.codeHash !== hash(body.code)) throw new AppError(401, 'OTP_INVALID', 'The code is invalid or expired.'); await Otp.deleteMany({ phone: body.phone }); }
  return finishPhoneAuthentication(body.phone, body, res);
}
async function finishPhoneAuthentication(phone, input, res) {
  let user = await User.findOne({ phone }); let isNew = false; let member; let studio;
  if (!user) { user = await User.create({ phone }); ({ studio, owner: member } = await createStudioFor(user, input)); isNew = true; } else { member = await Member.findOne({ userId: user._id, status: { $in: ['active', 'limited'] } }); if (!member) throw new AppError(403, 'NO_ACTIVE_STUDIO', 'This account has no active studio membership.'); studio = await Studio.findById(member.studioId); }
  const needsOnboarding = isNew || (!studio.onboardingCompletedAt && studio.name === 'My Studio');
  const tokens = await issueSession(user, member); res.json({ data: { ...tokens, isNew, needsOnboarding, user: { id: user.id, phone: user.phone, name: user.name, language: user.language }, studioId: member.studioId, role: member.role } });
}
async function firebasePhone(req, res) {
  const input = z.object({ idToken: z.string().min(100).max(10000) }).parse(req.body);
  let decoded;
  try {
    decoded = await firebaseAdmin({ required: true }).auth().verifyIdToken(input.idToken, true);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(401, 'FIREBASE_TOKEN_INVALID', 'Firebase phone verification is invalid or expired.');
  }
  if (decoded.firebase?.sign_in_provider !== 'phone' || !decoded.phone_number) {
    throw new AppError(401, 'FIREBASE_PHONE_REQUIRED', 'A verified Firebase phone number is required.');
  }
  const phone = phoneSchema.parse(decoded.phone_number);
  return finishPhoneAuthentication(phone, {}, res);
}
async function google(req, res) {
  if (!env.GOOGLE_CLIENT_IDS.length) throw new AppError(503, 'GOOGLE_AUTH_NOT_CONFIGURED', 'Google sign-in is not configured.');
  const idToken = z.object({ idToken: z.string().min(20), studioName: z.string().trim().min(2).max(80).optional(), garmentAudiences: z.array(z.enum(['men', 'women', 'kids', 'unisex'])).min(1).max(4).optional() }).parse(req.body);
  let ticket;
  try {
    ticket = await new OAuth2Client().verifyIdToken({ idToken: idToken.idToken, audience: env.GOOGLE_CLIENT_IDS });
  } catch (_) {
    throw new AppError(401, 'GOOGLE_TOKEN_INVALID', 'Google sign-in could not be verified. Please try again.');
  }
  const profile = ticket.getPayload();
  if (!profile?.sub || !profile.email_verified || !profile.email) throw new AppError(401, 'GOOGLE_TOKEN_INVALID', 'Google did not provide a verified identity.');
  let user = await User.findOne({ googleSubject: profile.sub }); let isNew = false; let member; let studio;
  if (!user) { user = await User.create({ googleSubject: profile.sub, email: profile.email.toLowerCase(), name: profile.name || profile.email }); ({ studio, owner: member } = await createStudioFor(user, { studioName: idToken.studioName })); isNew = true; } else { member = await Member.findOne({ userId: user._id, status: { $in: ['active', 'limited'] } }); if (!member) throw new AppError(403, 'NO_ACTIVE_STUDIO', 'This account has no active studio membership.'); studio = await Studio.findById(member.studioId); }
  const needsOnboarding = isNew || (!studio.onboardingCompletedAt && studio.name === 'My Studio');
  const tokens = await issueSession(user, member); res.json({ data: { ...tokens, isNew, needsOnboarding, user: { id: user.id, email: user.email, name: user.name, language: user.language }, studioId: member.studioId, role: member.role } });
}
async function adminLogin(req, res) { const input = z.object({ email: z.string().trim().email().max(254), password: z.string().min(10).max(200) }).parse(req.body); const user = await User.findOne({ email: input.email.toLowerCase(), deletedAt: null }).select('+passwordHash'); if (!user || user.platformRole !== 'admin' || !verifyPassword(input.password, user.passwordHash)) throw new AppError(401, 'INVALID_ADMIN_CREDENTIALS', 'Email or password is incorrect.'); const member = await Member.findOne({ userId: user._id, status: { $in: ['active', 'limited'] } }); if (!member) throw new AppError(403, 'NO_ACTIVE_STUDIO', 'This account has no active studio membership.'); const tokens = await issueSession(user, member); res.json({ data: { ...tokens, user: { id: user.id, email: user.email, name: user.name, platformRole: user.platformRole } } }); }
async function refresh(req, res) {
  const token = z.object({ refreshToken: z.string().min(1) }).parse(req.body).refreshToken;
  let payload;
  try { payload = jwt.verify(token, env.JWT_REFRESH_SECRET); }
  catch (_) { throw new AppError(401, 'TOKEN_INVALID', 'Refresh token is invalid.'); }
  const session = await Session.findOne({ tokenId: payload.tokenId, userId: payload.sub, revokedAt: null, expiresAt: { $gt: new Date() } });
  if (!session) throw new AppError(401, 'TOKEN_INVALID', 'Refresh token is revoked or expired.');
  const [user, member] = await Promise.all([
    User.findOne({ _id: payload.sub, deletedAt: null }),
    Member.findOne({ _id: payload.memberId, userId: payload.sub, studioId: payload.studioId, status: { $in: ['active', 'limited'] } }),
  ]);
  if (!user || !member) {
    session.revokedAt = new Date();
    await session.save();
    throw new AppError(401, 'SESSION_INVALID', 'Your account or studio access is no longer active.');
  }
  session.revokedAt = new Date();
  await session.save();
  const tokens = await issueSession(user, member);
  res.json({ data: tokens });
}
async function logout(req, res) { const token = req.body.refreshToken; if (token) { try { const payload = jwt.verify(token, env.JWT_REFRESH_SECRET); await Session.updateOne({ tokenId: payload.tokenId }, { revokedAt: new Date() }); } catch (_) {} } res.status(204).send(); }
function me(req, res) { const { user, member, studio, subscription } = req.auth; res.json({ data: { user: { id: user.id, phone: user.phone, email: user.email, name: user.name, platformRole: user.platformRole, language: user.language }, membership: { id: member.id, role: member.role, status: member.status }, studio, subscription } }); }
async function updatePreferences(req, res) {
  const input = z.object({ language: z.enum(['en', 'hi', 'gu', 'mr']) }).parse(req.body);
  req.auth.user.language = input.language;
  await req.auth.user.save();
  res.json({ data: { language: req.auth.user.language } });
}
module.exports = { requestOtp, verifyOtp, firebasePhone, google, adminLogin, refresh, logout, me, updatePreferences };
