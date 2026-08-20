const admin = require('firebase-admin');
const env = require('../config/env');
const { AppError } = require('../utils/errors');

let initialized = false;

function parseFirebaseServiceAccount(raw) {
  let value = raw.trim();
  let parsed;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      // Some hosting dashboards turn the escaped newlines inside private_key
      // into literal line breaks. Repair only that JSON field, leaving normal
      // formatting whitespace untouched.
      const repaired = value.replace(
        /("private_key"\s*:\s*")([\s\S]*?)("\s*,)/,
        (_match, prefix, key, suffix) =>
          `${prefix}${key.replace(/\r?\n/g, "\\n")}${suffix}`,
      );
      if (repaired === value) throw error;
      value = repaired;
      parsed = JSON.parse(value);
    }
    if (typeof parsed !== "string") break;
    // Secret managers occasionally store the whole JSON document as a
    // JSON-encoded string. Decode that extra layer as well.
    value = parsed;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Firebase service account must be a JSON object.");
  }
  const serviceAccount = { ...parsed };
  if (typeof serviceAccount.private_key === "string") {
    serviceAccount.private_key = serviceAccount.private_key
      .replace(/\\n/g, "\n")
      .trim()
      .concat("\n");
  }
  for (const field of ["project_id", "client_email", "private_key"]) {
    if (!serviceAccount[field]) {
      throw new Error(`Firebase service account is missing ${field}.`);
    }
  }
  return serviceAccount;
}

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
        const serviceAccount = parseFirebaseServiceAccount(
          env.FIREBASE_SERVICE_ACCOUNT_JSON,
        );
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: serviceAccount.project_id,
        });
      }
      initialized = true;
    } catch (error) {
      console.error("Firebase Admin initialization failed", {
        code: error?.code || "FIREBASE_CONFIG_INVALID",
        message: error?.message || "Unknown Firebase configuration error",
      });
      throw new AppError(
        503,
        'FIREBASE_AUTH_NOT_CONFIGURED',
        'Firebase credentials are invalid.',
      );
    }
  }
  return admin;
}

module.exports = { firebaseAdmin, parseFirebaseServiceAccount };
