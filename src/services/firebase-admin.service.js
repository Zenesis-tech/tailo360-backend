const admin = require('firebase-admin');
const env = require('../config/env');
const { AppError } = require('../utils/errors');

let initialized = false;

function firebaseAdmin({ required = false } = {}) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    if (required) {
      throw new AppError(
        503,
        'FIREBASE_AUTH_NOT_CONFIGURED',
        'Firebase phone authentication is not configured.',
      );
    }
    return null;
  }
  if (!initialized) {
    try {
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(
            JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON),
          ),
        });
      }
      initialized = true;
    } catch (_) {
      throw new AppError(
        503,
        'FIREBASE_AUTH_NOT_CONFIGURED',
        'Firebase credentials are invalid.',
      );
    }
  }
  return admin;
}

module.exports = { firebaseAdmin };
