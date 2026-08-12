const admin = require("firebase-admin");
const env = require("../config/env");
const { Device, Member, Notification } = require("../models");
const realtimeEvents = require("./realtime-events.service");

let initialized = false;

function firebase() {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) return null;
  if (!initialized) {
    admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON),
      ),
    });
    initialized = true;
  }
  return admin;
}

const invalidTokenCodes = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

function stringData(data) {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]),
  );
}

async function studioUserIds(studioId, selectedUserIds) {
  const filter = {
    studioId,
    status: { $in: ["active", "limited"] },
    userId: { $ne: null },
  };
  if (selectedUserIds?.length) filter.userId = { $in: selectedUserIds };
  return [
    ...new Set(
      (await Member.find(filter).select("userId")).map((row) =>
        row.userId.toString(),
      ),
    ),
  ];
}

async function createRecipientNotification(studioId, userId, message) {
  const values = {
    studioId,
    userId,
    type: message.type,
    title: message.title,
    body: message.body,
    data: message.data || {},
    source: message.source || "workflow",
    dedupeKey: message.dedupeKey,
    createdBy: message.createdBy,
    status: "queued",
  };
  if (!message.dedupeKey) return Notification.create(values);
  const existing = await Notification.findOne({
    studioId,
    userId,
    dedupeKey: message.dedupeKey,
  });
  if (existing) return null;
  try {
    return await Notification.create(values);
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }
}

async function deliver(notification) {
  const devices = await Device.find({
    studioId: notification.studioId,
    userId: notification.userId,
    active: true,
  }).select("token");
  const app = firebase();
  if (!app || devices.length === 0) {
    notification.status = "stored";
    await notification.save();
    return notification;
  }

  const unread = await Notification.countDocuments({
    userId: notification.userId,
    readAt: null,
  });
  let successCount = 0;
  let failureCount = 0;
  const invalidTokens = [];
  const tokens = devices.map((device) => device.token);
  const payload = stringData({
    ...notification.data,
    notificationId: notification.id,
    type: notification.type,
  });

  try {
    for (let offset = 0; offset < tokens.length; offset += 500) {
      const batch = tokens.slice(offset, offset + 500);
      const result = await app.messaging().sendEachForMulticast({
        tokens: batch,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: payload,
        android: {
          priority: "high",
          notification: {
            channelId: "tailo360_important",
            sound: "default",
            clickAction: "FLUTTER_NOTIFICATION_CLICK",
          },
        },
        apns: {
          payload: {
            aps: { sound: "default", badge: unread },
          },
        },
      });
      successCount += result.successCount;
      failureCount += result.failureCount;
      result.responses.forEach((response, index) => {
        if (!response.success && invalidTokenCodes.has(response.error?.code)) {
          invalidTokens.push(batch[index]);
        }
      });
    }
    if (invalidTokens.length) {
      await Device.updateMany(
        { token: { $in: invalidTokens } },
        {
          active: false,
          disabledAt: new Date(),
          disabledReason: "fcm_token_invalid",
        },
      );
    }
    notification.deliveredCount = successCount;
    notification.failureCount = failureCount;
    notification.status = failureCount === 0 ? "sent" : successCount ? "partial" : "failed";
    notification.sentAt = new Date();
    await notification.save();
  } catch (error) {
    notification.status = "failed";
    notification.failureCount = tokens.length;
    notification.error = error.message;
    await notification.save();
  }
  return notification;
}

async function send(studioId, message) {
  const users = await studioUserIds(studioId, message.userIds);
  const recipients = message.excludeUserId
    ? users.filter((id) => id !== String(message.excludeUserId))
    : users;
  const notifications = (
    await Promise.all(
      recipients.map((userId) =>
        createRecipientNotification(studioId, userId, message),
      ),
    )
  ).filter(Boolean);
  await Promise.all(notifications.map(deliver));
  if (notifications.length) {
    realtimeEvents.publish(studioId, {
      method: "POST",
      resource: "notifications",
    });
  }
  return notifications;
}

async function sendAcrossStudios(targets, message) {
  const grouped = new Map();
  for (const target of targets) {
    const key = String(target.studioId);
    const users = grouped.get(key) || [];
    users.push(String(target.userId));
    grouped.set(key, users);
  }
  return (
    await Promise.all(
      [...grouped.entries()].map(([studioId, userIds]) =>
        send(studioId, { ...message, userIds }),
      ),
    )
  ).flat();
}

async function pruneStaleDevices(now = new Date()) {
  const staleBefore = new Date(now.getTime() - 45 * 86400000);
  return Device.updateMany(
    { active: true, lastSeenAt: { $lt: staleBefore } },
    {
      active: false,
      disabledAt: now,
      disabledReason: "stale_registration",
    },
  );
}

module.exports = { send, sendAcrossStudios, deliver, pruneStaleDevices };
