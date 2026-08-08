const { AuditLog } = require("../models");

const safe = (value) => {
  if (!value) return value;
  const object = typeof value.toObject === "function" ? value.toObject() : value;
  const copy = JSON.parse(JSON.stringify(object));
  delete copy.passwordHash;
  delete copy.token;
  delete copy.raw;
  return copy;
};

async function auditAdmin(req, action, targetType, target, before, after) {
  await AuditLog.create({
    actorId: req.auth.user._id,
    action,
    targetType,
    targetId: String(target?._id || target?.id || target),
    before: safe(before),
    after: safe(after),
    requestId: req.id,
    ip: req.ip,
  });
}

module.exports = { auditAdmin };
