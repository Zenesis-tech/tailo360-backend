const { Session, Notification } = require("../models");
const { retentionCutoff } = require("../utils/record-retention");

async function purgeOldRecords(now = new Date()) {
  const cutoff = retentionCutoff(now);
  const [sessions, notifications] = await Promise.all([
    // Active sessions remain available until their refresh token expires.
    Session.deleteMany({
      createdAt: { $lt: cutoff },
      $or: [{ revokedAt: { $type: "date" } }, { expiresAt: { $lte: now } }],
    }),
    // Keep future reminders until delivery, then retain their history for 30 days.
    Notification.deleteMany({
      createdAt: { $lt: cutoff },
      $or: [
        { status: { $ne: "queued" }, $or: [
          { sentAt: { $lt: cutoff } },
          { sentAt: null, scheduledFor: { $lt: cutoff } },
          { sentAt: null, scheduledFor: null },
        ] },
        { status: "queued", scheduledFor: { $lt: cutoff } },
        { status: "queued", scheduledFor: null },
      ],
    }),
  ]);
  return { sessions: sessions.deletedCount, notifications: notifications.deletedCount };
}

module.exports = { purgeOldRecords };
