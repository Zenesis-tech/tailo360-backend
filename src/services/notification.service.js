const admin = require('firebase-admin');
const env = require('../config/env');
const { Device, Notification } = require('../models');
let initialized = false;
function firebase() { if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) return null; if (!initialized) { admin.initializeApp({ credential: admin.credential.cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON)) }); initialized = true; } return admin; }
async function send(studioId, { type, title, body, data = {} }) { const log = await Notification.create({ studioId, type, title, body, data, status: 'queued' }); const tokens = (await Device.find({ studioId, active: true }).select('token')).map((item) => item.token); const app = firebase(); if (!app || !tokens.length) return log; try { const result = await app.messaging().sendEachForMulticast({ tokens, notification: { title, body }, data: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)])) }); if (result.failureCount) { const failedTokens = result.responses.flatMap((item, index) => item.success ? [] : [tokens[index]]); await Device.updateMany({ token: { $in: failedTokens } }, { active: false }); } log.status = result.successCount ? 'sent' : 'failed'; log.sentAt = new Date(); await log.save(); } catch (error) { log.status = 'failed'; log.error = error.message; await log.save(); } return log; }
module.exports = { send };
