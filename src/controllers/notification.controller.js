const { z } = require("zod");
const { Device, Member, Notification } = require("../models");
const { notFound } = require("../utils/errors");
const { sendAcrossStudios } = require("../services/notification.service");
const { auditAdmin } = require("../services/audit.service");

const deviceInput = z.object({
  token: z.string().min(20),
  platform: z.enum(["android", "ios"]),
  appVersion: z.string().max(40).optional(),
  locale: z.string().max(20).optional(),
});

async function register(req, res) {
  const body = deviceInput.parse(req.body);
  const device = await Device.findOneAndUpdate(
    { token: body.token },
    {
      ...body,
      userId: req.auth.user._id,
      studioId: req.auth.studio._id,
      active: true,
      lastSeenAt: new Date(),
      disabledAt: null,
      disabledReason: null,
    },
    { upsert: true, new: true, runValidators: true },
  );
  res.status(201).json({ data: device });
}

async function unregister(req, res) {
  const body = z.object({ token: z.string().min(20) }).parse(req.body);
  await Device.updateOne(
    { token: body.token, userId: req.auth.user._id },
    {
      active: false,
      disabledAt: new Date(),
      disabledReason: "user_logout",
    },
  );
  res.status(204).send();
}

async function list(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const filter = { userId: req.auth.user._id };
  if (req.query.unread === "true") filter.readAt = null;
  const [rows, total, unreadCount] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId: req.auth.user._id, readAt: null }),
  ]);
  res.json({ data: rows, meta: { page, limit, total, unreadCount } });
}

async function unreadCount(req, res) {
  const count = await Notification.countDocuments({
    userId: req.auth.user._id,
    readAt: null,
  });
  res.json({ data: { count } });
}

async function markRead(req, res) {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: req.auth.user._id },
    { $set: { readAt: new Date() } },
    { new: true },
  );
  if (!notification) throw notFound("Notification");
  res.json({ data: notification });
}

async function markAllRead(req, res) {
  const result = await Notification.updateMany(
    { userId: req.auth.user._id, readAt: null },
    { $set: { readAt: new Date() } },
  );
  res.json({ data: { updated: result.modifiedCount } });
}

const adminMessageInput = z
  .object({
    title: z.string().trim().min(2).max(120),
    body: z.string().trim().min(2).max(1000),
    type: z.string().trim().min(2).max(80).default("admin_announcement"),
    target: z.enum(["all", "users", "studios"]),
    userIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(5000).default([]),
    studioIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(5000).default([]),
    data: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  })
  .superRefine((value, context) => {
    if (value.target === "users" && value.userIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["userIds"],
        message: "Select at least one user.",
      });
    }
    if (value.target === "studios" && value.studioIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["studioIds"],
        message: "Select at least one studio.",
      });
    }
  });

async function adminSend(req, res) {
  const body = adminMessageInput.parse(req.body);
  const memberFilter = {
    status: { $in: ["active", "limited"] },
    userId: { $ne: null },
  };
  if (body.target === "users") memberFilter.userId = { $in: body.userIds };
  if (body.target === "studios") memberFilter.studioId = { $in: body.studioIds };
  const members = await Member.find(memberFilter).select("studioId userId");
  const unique = new Map(
    members.map((member) => [
      `${member.studioId}:${member.userId}`,
      { studioId: member.studioId, userId: member.userId },
    ]),
  );
  const notifications = await sendAcrossStudios([...unique.values()], {
    type: body.type,
    title: body.title,
    body: body.body,
    data: body.data,
    source: "admin",
    createdBy: req.auth.user._id,
  });
  await auditAdmin(
    req,
    "notification.sent",
    "notification_campaign",
    { id: req.id },
    undefined,
    {
      target: body.target,
      recipientCount: notifications.length,
      title: body.title,
    },
  );
  res.status(201).json({
    data: {
      recipientCount: notifications.length,
      sentCount: notifications.filter((item) => item.status === "sent").length,
      storedCount: notifications.filter((item) => item.status === "stored").length,
      failedCount: notifications.filter((item) =>
        ["failed", "partial"].includes(item.status),
      ).length,
    },
  });
}

module.exports = {
  register,
  unregister,
  list,
  unreadCount,
  markRead,
  markAllRead,
  adminSend,
};
