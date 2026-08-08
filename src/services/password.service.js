const crypto = require('crypto');
const KEY_LENGTH = 64;
function hashPassword(password) { const salt = crypto.randomBytes(16).toString('hex'); return `scrypt$${salt}$${crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex')}`; }
function verifyPassword(password, stored) { if (!stored) return false; const [algorithm, salt, expected] = stored.split('$'); if (algorithm !== 'scrypt' || !salt || !expected) return false; const actual = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex'); return actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex')); }
module.exports = { hashPassword, verifyPassword };
