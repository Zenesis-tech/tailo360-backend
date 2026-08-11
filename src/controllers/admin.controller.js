const { z } = require("zod");
const { nanoid } = require("nanoid");
const {
  User,
  Studio,
  Member,
  Customer,
  Measurement,
  GarmentTemplate,
  Price,
  Order,
  Subscription,
  SubscriptionPlan,
  SubscriptionEvent,
  Referral,
  SupportTicket,
  Notification,
  Media,
  Device,
  Session,
  AppConfig,
  AuditLog,
} = require("../models");
const { AppError, notFound } = require("../utils/errors");
const { hashPassword } = require("../services/password.service");
const { auditAdmin } = require("../services/audit.service");
const { escapedSearch } = require("../utils/search");
const r2 = require("../services/r2.service");
const env = require("../config/env");
const diagramUrl = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) => !value || /^https?:\/\//i.test(value),
    "Measurement diagram must be an http(s) URL.",
  )
  .optional();
const iconUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => !value || /^https?:\/\//i.test(value), "Garment icon must be an http(s) URL.")
  .optional();
const templateInput = z.object({
  name: z.string().trim().min(2).max(80),
  audience: z.enum(["men", "women", "kids", "unisex"]).default("unisex"),
  active: z.boolean().optional(),
  garmentIconUrl: iconUrl,
  measurementDiagramUrl: diagramUrl,
  fields: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().trim().min(1).max(60),
        unit: z.enum(["in", "cm"]).default("in"),
        required: z.boolean().default(false),
        active: z.boolean().default(true),
        position: z.number().int().nonnegative().optional(),
      }),
    )
    .optional(),
  customizationGroups: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().trim().min(1).max(60),
        choices: z
          .array(
            z.object({
              id: z.string().optional(),
              name: z.string().trim().min(1).max(60),
              active: z.boolean().default(true),
              position: z.number().int().nonnegative().optional(),
            }),
          )
          .default([]),
      }),
    )
    .optional(),
});
const normalizeTemplate = (value) => ({
  ...value,
  fields: value.fields?.map((field, position) => ({
    ...field,
    id: field.id || nanoid(),
    position: field.position ?? position,
  })),
  customizationGroups: value.customizationGroups?.map((group) => ({
    ...group,
    id: group.id || nanoid(),
    choices: group.choices.map((choice, position) => ({
      ...choice,
      id: choice.id || nanoid(),
      position: choice.position ?? position,
    })),
  })),
});

const page = (req) => ({
  page: Math.max(1, Number(req.query.page) || 1),
  limit: Math.min(100, Math.max(1, Number(req.query.limit) || 25)),
});
const queryText = (value) => escapedSearch(value);
const list = async (Model, filter, sort, req, populate) => {
  const pagination = page(req);
  let query = Model.find(filter)
    .sort(sort)
    .skip((pagination.page - 1) * pagination.limit)
    .limit(pagination.limit);
  if (populate) query = query.populate(populate);
  const [data, total] = await Promise.all([
    query,
    Model.countDocuments(filter),
  ]);
  return {
    data,
    meta: { ...pagination, total, pages: Math.ceil(total / pagination.limit) },
  };
};

async function dashboard(req, res) {
  const month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const now = new Date();
  const trialWindow = new Date(now.getTime() + 7 * 86400000);
  const [
    studios,
    users,
    customers,
    subscriptions,
    orders,
    openTickets,
    referrals,
    expiringTrials,
    failedNotifications,
    monthly,
  ] = await Promise.all([
    Studio.countDocuments(),
    User.countDocuments({ deletedAt: null }),
    Customer.countDocuments({ deletedAt: null }),
    Subscription.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Order.countDocuments({ deletedAt: null }),
    SupportTicket.countDocuments({ status: { $in: ["open", "in_progress"] } }),
    Referral.countDocuments({ status: "pending" }),
    Subscription.countDocuments({
      status: "trial",
      trialEndsAt: { $gte: now, $lte: trialWindow },
    }),
    Notification.countDocuments({
      status: "failed",
      createdAt: { $gte: month },
    }),
    Order.aggregate([
      { $match: { deletedAt: null } },
      { $unwind: "$payments" },
      {
        $match: {
          "payments.direction": "collection",
          "payments.recordedAt": { $gte: month },
        },
      },
      { $group: { _id: null, value: { $sum: "$payments.amountPaise" } } },
    ]),
  ]);
  const subscriptionCounts = Object.fromEntries(
    subscriptions.map((item) => [item._id, item.count]),
  );
  res.json({
    data: {
      studios,
      users,
      customers,
      orders,
      openTickets,
      pendingReferrals: referrals,
      expiringTrials,
      failedNotifications,
      monthlyCollectionsPaise: monthly[0]?.value || 0,
      subscriptions: subscriptionCounts,
    },
  });
}
async function users(req, res) {
  const q = queryText(req.query.q);
  const filter = {
    deletedAt: null,
    ...(q ? { $or: [{ name: q }, { phone: q }, { email: q }] } : {}),
  };
  const result = await list(User, filter, { createdAt: -1 }, req);
  const ids = result.data.map((user) => user._id);
  const memberships = await Member.find({
    userId: { $in: ids },
    status: { $ne: "removed" },
  }).populate("studioId", "name");
  const byUser = new Map();
  memberships.forEach((member) =>
    byUser.set(member.userId.toString(), {
      role: member.role,
      status: member.status,
      studio: member.studioId,
    }),
  );
  res.json({
    data: result.data.map((user) => ({
      ...user.toObject(),
      membership: byUser.get(user.id) || null,
    })),
    meta: result.meta,
  });
}
async function updateUser(req, res) {
  const input = z
    .object({ platformRole: z.enum(["user", "admin", "support"]) })
    .parse(req.body);
  const user = await User.findById(req.params.id);
  if (!user || user.deletedAt) throw notFound("User");
  if (user.id === req.auth.user.id && input.platformRole !== "admin")
    throw new AppError(
      422,
      "CANNOT_DEMOTE_SELF",
      "You cannot remove your own platform-admin access.",
    );
  const before = { platformRole: user.platformRole };
  user.platformRole = input.platformRole;
  await user.save();
  await auditAdmin(req, "user.platform_role_updated", "user", user, before, {
    platformRole: user.platformRole,
  });
  res.json({ data: user });
}
async function resetUserPassword(req, res) {
  const input = z
    .object({ password: z.string().min(10).max(200) })
    .parse(req.body);
  const user = await User.findById(req.params.id);
  if (!user || user.deletedAt) throw notFound("User");
  if (user.platformRole !== "admin")
    throw new AppError(
      422,
      "NOT_ADMIN_ACCOUNT",
      "Only platform-admin accounts can use email/password sign-in.",
    );
  user.passwordHash = hashPassword(input.password);
  await user.save();
  await auditAdmin(req, "user.password_reset", "user", user, undefined, {
    passwordReset: true,
  });
  res.status(204).send();
}
async function studios(req, res) {
  const q = queryText(req.query.q);
  const result = await list(
    Studio,
    q ? { name: q } : {},
    { createdAt: -1 },
    req,
  );
  const ids = result.data.map((studio) => studio._id);
  const [subs, counts] = await Promise.all([
    Subscription.find({ studioId: { $in: ids } }),
    Member.aggregate([
      { $match: { studioId: { $in: ids }, status: { $ne: "removed" } } },
      { $group: { _id: "$studioId", count: { $sum: 1 } } },
    ]),
  ]);
  const bySub = new Map(
    subs.map((subscription) => [
      subscription.studioId.toString(),
      subscription,
    ]),
  );
  const byCount = new Map(counts.map((row) => [row._id.toString(), row.count]));
  res.json({
    data: result.data.map((studio) => ({
      ...studio.toObject(),
      subscription: bySub.get(studio.id) || null,
      memberCount: byCount.get(studio.id) || 0,
    })),
    meta: result.meta,
  });
}
async function studio(req, res) {
  const row = await Studio.findById(req.params.id);
  if (!row) throw notFound("Studio");
  const [subscription, members, orders, customers] = await Promise.all([
    Subscription.findOne({ studioId: row._id }),
    Member.find({ studioId: row._id, status: { $ne: "removed" } }).populate(
      "userId",
      "name phone email",
    ),
    Order.find({ studioId: row._id, deletedAt: null })
      .populate("customerId", "name phone")
      .sort({ createdAt: -1 })
      .limit(25),
    Customer.countDocuments({ studioId: row._id, deletedAt: null }),
  ]);
  res.json({
    data: {
      studio: row,
      subscription,
      members,
      recentOrders: orders,
      customerCount: customers,
    },
  });
}
async function subscriptions(req, res) {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.plan) filter.plan = req.query.plan;
  const result = await list(Subscription, filter, { updatedAt: -1 }, req, {
    path: "studioId",
    select: "name referralCode ownerUserId",
    populate: { path: "ownerUserId", select: "name phone email" },
  });
  res.json(result);
}
async function updateSubscription(req, res) {
  const input = z
    .object({
      plan: z.enum(["starter", "pro", "studio"]).optional(),
      status: z
        .enum([
          "trial",
          "active",
          "grace_period",
          "expired",
          "restricted",
          "cancelled",
        ])
        .optional(),
      seatLimit: z.number().int().min(1).max(1000).optional(),
      periodEndsAt: z.coerce.date().nullable().optional(),
      trialEndsAt: z.coerce.date().nullable().optional(),
    })
    .refine((body) => Object.keys(body).length > 0)
    .parse(req.body);
  if (input.plan) {
    const plan = await SubscriptionPlan.findOne({ code: input.plan });
    if (!plan)
      throw new AppError(
        422,
        "PLAN_UNAVAILABLE",
        "The selected plan does not exist.",
      );
    if (input.seatLimit === undefined) input.seatLimit = plan.limits.staffSeats;
  }
  const before = await Subscription.findById(req.params.id);
  const row = await Subscription.findByIdAndUpdate(req.params.id, input, {
    new: true,
    runValidators: true,
  });
  if (!row) throw notFound("Subscription");
  await auditAdmin(
    req,
    "subscription.updated",
    "subscription",
    row,
    before,
    row,
  );
  res.json({ data: row });
}
async function grantTestSubscription(req, res) {
  const input = z
    .object({
      plan: z.enum(["starter", "pro", "studio"]),
      durationDays: z.number().int().min(1).max(365).default(30),
      note: z.string().trim().max(200).optional(),
    })
    .parse(req.body);
  const [subscription, plan] = await Promise.all([
    Subscription.findById(req.params.id),
    SubscriptionPlan.findOne({ code: input.plan, active: true }),
  ]);
  if (!subscription) throw notFound("Subscription");
  if (!plan)
    throw new AppError(
      422,
      "PLAN_UNAVAILABLE",
      "The selected plan is not active.",
    );
  const before = subscription.toObject();
  subscription.plan = plan.code;
  subscription.status = "active";
  subscription.entitlementSource = "admin_test";
  subscription.periodEndsAt = new Date(
    Date.now() + input.durationDays * 86400000,
  );
  subscription.trialEndsAt = undefined;
  subscription.platform = undefined;
  subscription.productId = undefined;
  subscription.originalTransactionId = undefined;
  subscription.lastVerifiedAt = undefined;
  subscription.seatLimit = plan.limits.staffSeats;
  subscription.adminGrant = {
    grantedBy: req.auth.user._id,
    grantedAt: new Date(),
    note: input.note || "Testing entitlement",
  };
  await subscription.save();
  await auditAdmin(
    req,
    "subscription.test_granted",
    "subscription",
    subscription,
    before,
    {
      plan: plan.code,
      durationDays: input.durationDays,
      entitlementSource: "admin_test",
    },
  );
  res.json({ data: subscription });
}
async function orders(req, res) {
  const filter = { deletedAt: null };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.studioId) filter.studioId = req.query.studioId;
  const result = await list(Order, filter, { createdAt: -1 }, req, [
    { path: "studioId", select: "name" },
    { path: "customerId", select: "name phone" },
  ]);
  res.json(result);
}
async function customers(req, res) {
  const q = queryText(req.query.q);
  const filter = {
    deletedAt: null,
    ...(q ? { $or: [{ name: q }, { phone: q }] } : {}),
  };
  const result = await list(Customer, filter, { createdAt: -1 }, req, {
    path: "studioId",
    select: "name",
  });
  res.json(result);
}
async function enrichStudioRows(rows) {
  const studioIds = [
    ...new Set(
      rows.map((row) => (row.studioId ? String(row.studioId) : "")).filter(Boolean),
    ),
  ];
  const studios = await Studio.find({ _id: { $in: studioIds } }).select("name");
  const byId = new Map(studios.map((studio) => [studio.id, studio]));
  return rows.map((row) => ({
    ...row.toObject(),
    studio: byId.get(String(row.studioId)) || null,
  }));
}
async function withDiagramUrls(rows) {
  const values = rows.map((row) => (row.toObject ? row.toObject() : row));
  const mediaIds = [
    ...new Set(
      values
        .flatMap((row) => [row.garmentIconMediaId, row.measurementDiagramMediaId])
        .map((id) => String(id || ""))
        .filter(Boolean),
    ),
  ];
  if (!mediaIds.length) return values;
  const mediaRows = await Media.find({
    _id: { $in: mediaIds },
    status: "ready",
  });
  const urls = new Map();
  await Promise.all(
    mediaRows.map(async (media) => {
      urls.set(media.id, await r2.createReadUrl(media.objectKey));
    }),
  );
  return values.map((row) => ({
    ...row,
    garmentIconUrl:
      urls.get(String(row.garmentIconMediaId)) || row.garmentIconUrl || "",
    measurementDiagramUrl:
      urls.get(String(row.measurementDiagramMediaId)) ||
      row.measurementDiagramUrl ||
      "",
  }));
}
async function templates(req, res) {
  const q = queryText(req.query.q);
  const result = await list(
    GarmentTemplate,
    q ? { name: q } : {},
    { createdAt: -1 },
    req,
  );
  const rows = await enrichStudioRows(result.data);
  res.json({ data: await withDiagramUrls(rows), meta: result.meta });
}
async function createTemplate(req, res) {
  const body = z.object({ template: templateInput }).parse(req.body);
  const row = await GarmentTemplate.create({
    studioId: null,
    scope: "global",
    ...normalizeTemplate(body.template),
  });
  await auditAdmin(
    req,
    "garment_template.created",
    "garment_template",
    row,
    undefined,
    row,
  );
  res.status(201).json({ data: (await withDiagramUrls([row]))[0] });
}
async function updateTemplate(req, res) {
  const body = templateInput
    .partial()
    .extend({ version: z.number().int().nonnegative() })
    .parse(req.body);
  const row = await GarmentTemplate.findById(req.params.id);
  if (!row) throw notFound("Garment template");
  if (row.version !== body.version)
    return res
      .status(409)
      .json({
        error: {
          code: "EDIT_CONFLICT",
          message: "This template changed elsewhere. Refresh and try again.",
        },
      });
  const before = row.toObject();
  Object.assign(row, normalizeTemplate(body));
  await row.save();
  await auditAdmin(
    req,
    "garment_template.updated",
    "garment_template",
    row,
    before,
    row,
  );
  res.json({ data: (await withDiagramUrls([row]))[0] });
}

async function deleteTemplate(req, res) {
  const body = z
    .object({ version: z.number().int().nonnegative() })
    .parse(req.body);
  const row = await GarmentTemplate.findById(req.params.id);
  if (!row) throw notFound("Garment template");
  if (row.version !== body.version) {
    throw new AppError(
      409,
      "EDIT_CONFLICT",
      "This template changed elsewhere. Refresh and try again.",
    );
  }

  const [orders, measurements, prices] = await Promise.all([
    Order.countDocuments({ "lines.templateId": row._id }),
    Measurement.countDocuments({ templateId: row._id }),
    Price.countDocuments({ templateId: row._id }),
  ]);
  if (orders || measurements || prices) {
    throw new AppError(
      409,
      "GARMENT_TEMPLATE_IN_USE",
      `This garment cannot be deleted because it is used by ${orders} order(s), ${measurements} measurement profile(s), and ${prices} price record(s). Mark it inactive instead.`,
      { orders, measurements, prices },
    );
  }

  const before = row.toObject();
  const mediaIds = [row.garmentIconMediaId, row.measurementDiagramMediaId].filter(
    Boolean,
  );
  const mediaRows = mediaIds.length
    ? await Media.find({ _id: { $in: mediaIds } })
    : [];
  await auditAdmin(
    req,
    "garment_template.deleted",
    "garment_template",
    row,
    before,
    { deleted: true },
  );
  await row.deleteOne();
  await Promise.all(
    mediaRows.map(async (media) => {
      try {
        await r2.deleteObject(media.objectKey);
      } catch (_) {
        /* keep template deletion successful; media cleanup can be retried */
      }
      media.status = "deleted";
      await media.save();
    }),
  );
  res.json({ data: { id: String(row._id), name: row.name, deleted: true } });
}

const diagramUploadInput = z.object({
  fileName: z.string().trim().min(1).max(180),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});
async function createTemplateDiagramUpload(req, res) {
  const body = diagramUploadInput.parse(req.body);
  const template = await GarmentTemplate.findById(req.params.id);
  if (!template) throw notFound("Garment template");
  const safeName = body.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const ownerKey =
    template.scope === "global" ? "global" : String(template.studioId);
  const key = `${ownerKey}/measurement_diagram/${Date.now()}-${nanoid(12)}-${safeName}`;
  const media = await Media.create({
    studioId: template.studioId,
    ownerUserId: req.auth.user._id,
    objectKey: key,
    originalName: body.fileName,
    contentType: body.contentType,
    purpose: "reference_image",
  });
  const uploadUrl = await r2.createUploadUrl({
    key,
    contentType: body.contentType,
  });
  res
    .status(201)
    .json({
      data: {
        id: media.id,
        uploadUrl,
        requiredHeaders: { "Content-Type": body.contentType },
      },
    });
}
async function completeTemplateDiagramUpload(req, res) {
  const [template, media] = await Promise.all([
    GarmentTemplate.findById(req.params.id),
    Media.findOne({ _id: req.params.mediaId, status: "pending" }),
  ]);
  if (!template) throw notFound("Garment template");
  if (!media || String(media.studioId) !== String(template.studioId))
    throw notFound("Upload");
  const metadata = await r2.objectMetadata(media.objectKey);
  const sizeBytes = Number(metadata.ContentLength || 0);
  const maxBytes = env.MAX_FILE_SIZE_MB * 1024 * 1024;
  if (metadata.ContentType !== media.contentType || sizeBytes > maxBytes) {
    await r2.deleteObject(media.objectKey);
    media.sizeBytes = sizeBytes;
    media.status = "deleted";
    await media.save();
    if (sizeBytes > maxBytes)
      throw new AppError(
        413,
        "MEDIA_TOO_LARGE",
        `Images must be ${env.MAX_FILE_SIZE_MB} MB or smaller.`,
      );
    throw new AppError(
      422,
      "MEDIA_TYPE_MISMATCH",
      "The uploaded image type could not be verified.",
    );
  }
  const oldMediaId = template.measurementDiagramMediaId;
  media.sizeBytes = sizeBytes;
  media.status = "ready";
  await media.save();
  template.measurementDiagramMediaId = media._id;
  template.measurementDiagramUrl = "";
  await template.save();
  if (oldMediaId && String(oldMediaId) !== media.id) {
    const oldMedia = await Media.findById(oldMediaId);
    if (oldMedia) {
      try {
        await r2.deleteObject(oldMedia.objectKey);
      } catch (_) {
        /* cleanup can be retried */
      }
      oldMedia.status = "deleted";
      await oldMedia.save();
    }
  }
  await auditAdmin(
    req,
    "garment_template.diagram_updated",
    "garment_template",
    template,
    { measurementDiagramMediaId: oldMediaId },
    { measurementDiagramMediaId: media._id },
  );
  res.json({ data: (await withDiagramUrls([template]))[0] });
}
function imageMatchesContentType(buffer, contentType) {
  if (contentType === "image/jpeg")
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (contentType === "image/png")
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (contentType === "image/webp")
    return buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}
async function uploadTemplateDiagram(req, res) {
  const contentType = z.enum(["image/jpeg", "image/png", "image/webp"]).parse(req.get("content-type"));
  let decodedName = req.get("x-file-name") || "measurement-diagram";
  try { decodedName = decodeURIComponent(decodedName); } catch (_) { /* use the safe encoded value */ }
  const fileName = z.string().trim().min(1).max(180).parse(decodedName);
  if (!Buffer.isBuffer(req.body) || !req.body.length)
    throw new AppError(422, "IMAGE_EMPTY", "Choose an image to upload.");
  if (!imageMatchesContentType(req.body, contentType))
    throw new AppError(422, "MEDIA_TYPE_MISMATCH", "The selected file is not a valid JPG, PNG, or WebP image.");

  const template = await GarmentTemplate.findById(req.params.id);
  if (!template) throw notFound("Garment template");
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const ownerKey = template.scope === "global" ? "global" : String(template.studioId);
  const key = `${ownerKey}/measurement_diagram/${Date.now()}-${nanoid(12)}-${safeName}`;
  const media = await Media.create({
    studioId: template.studioId,
    ownerUserId: req.auth.user._id,
    objectKey: key,
    originalName: fileName,
    contentType,
    sizeBytes: req.body.length,
    purpose: "reference_image",
    status: "pending",
  });
  await r2.putObject({ key, body: req.body, contentType });
  media.status = "ready";
  await media.save();

  const oldMediaId = template.measurementDiagramMediaId;
  template.measurementDiagramMediaId = media._id;
  template.measurementDiagramUrl = "";
  await template.save();
  if (oldMediaId && String(oldMediaId) !== media.id) {
    const oldMedia = await Media.findById(oldMediaId);
    if (oldMedia) {
      try { await r2.deleteObject(oldMedia.objectKey); } catch (_) { /* cleanup can be retried */ }
      oldMedia.status = "deleted";
      await oldMedia.save();
    }
  }
  await auditAdmin(req, "garment_template.diagram_updated", "garment_template", template, { measurementDiagramMediaId: oldMediaId }, { measurementDiagramMediaId: media._id });
  res.json({ data: (await withDiagramUrls([template]))[0] });
}
async function deleteTemplateDiagram(req, res) {
  const template = await GarmentTemplate.findById(req.params.id);
  if (!template) throw notFound("Garment template");
  const oldMediaId = template.measurementDiagramMediaId;
  if (oldMediaId) {
    const media = await Media.findById(oldMediaId);
    if (media) {
      try {
        await r2.deleteObject(media.objectKey);
      } catch (_) {
        /* keep deletion idempotent */
      }
      media.status = "deleted";
      await media.save();
    }
  }
  template.measurementDiagramMediaId = null;
  template.measurementDiagramUrl = "";
  await template.save();
  await auditAdmin(
    req,
    "garment_template.diagram_deleted",
    "garment_template",
    template,
    { measurementDiagramMediaId: oldMediaId },
    { measurementDiagramMediaId: null },
  );
  res.json({ data: (await withDiagramUrls([template]))[0] });
}
async function uploadTemplateIcon(req, res) {
  const contentType = z.enum(["image/jpeg", "image/png", "image/webp"]).parse(req.get("content-type"));
  let decodedName = req.get("x-file-name") || "garment-icon";
  try { decodedName = decodeURIComponent(decodedName); } catch (_) { /* use the safe encoded value */ }
  const fileName = z.string().trim().min(1).max(180).parse(decodedName);
  if (!Buffer.isBuffer(req.body) || !req.body.length)
    throw new AppError(422, "IMAGE_EMPTY", "Choose an image to upload.");
  if (!imageMatchesContentType(req.body, contentType))
    throw new AppError(422, "MEDIA_TYPE_MISMATCH", "The selected file is not a valid JPG, PNG, or WebP image.");
  const template = await GarmentTemplate.findById(req.params.id);
  if (!template) throw notFound("Garment template");
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const ownerKey = template.scope === "global" ? "global" : String(template.studioId);
  const key = `${ownerKey}/garment_icon/${Date.now()}-${nanoid(12)}-${safeName}`;
  const media = await Media.create({ studioId: template.studioId, ownerUserId: req.auth.user._id, objectKey: key, originalName: fileName, contentType, sizeBytes: req.body.length, purpose: "reference_image", status: "pending" });
  await r2.putObject({ key, body: req.body, contentType });
  media.status = "ready";
  await media.save();
  const oldMediaId = template.garmentIconMediaId;
  template.garmentIconMediaId = media._id;
  template.garmentIconUrl = "";
  await template.save();
  if (oldMediaId && String(oldMediaId) !== media.id) {
    const oldMedia = await Media.findById(oldMediaId);
    if (oldMedia) {
      try { await r2.deleteObject(oldMedia.objectKey); } catch (_) { /* cleanup can be retried */ }
      oldMedia.status = "deleted";
      await oldMedia.save();
    }
  }
  await auditAdmin(req, "garment_template.icon_updated", "garment_template", template, { garmentIconMediaId: oldMediaId }, { garmentIconMediaId: media._id });
  res.json({ data: (await withDiagramUrls([template]))[0] });
}
async function deleteTemplateIcon(req, res) {
  const template = await GarmentTemplate.findById(req.params.id);
  if (!template) throw notFound("Garment template");
  const oldMediaId = template.garmentIconMediaId;
  if (oldMediaId) {
    const media = await Media.findById(oldMediaId);
    if (media) {
      try { await r2.deleteObject(media.objectKey); } catch (_) { /* keep deletion idempotent */ }
      media.status = "deleted";
      await media.save();
    }
  }
  template.garmentIconMediaId = null;
  template.garmentIconUrl = "";
  await template.save();
  await auditAdmin(req, "garment_template.icon_deleted", "garment_template", template, { garmentIconMediaId: oldMediaId }, { garmentIconMediaId: null });
  res.json({ data: (await withDiagramUrls([template]))[0] });
}
async function prices(req, res) {
  const result = await list(Price, {}, { effectiveFrom: -1 }, req, {
    path: "templateId",
    select: "name",
  });
  const data = await enrichStudioRows(result.data);
  res.json({ data, meta: result.meta });
}
async function measurements(req, res) {
  const result = await list(Measurement, {}, { createdAt: -1 }, req, [
    { path: "customerId", select: "name phone" },
    { path: "templateId", select: "name" },
  ]);
  const data = await enrichStudioRows(result.data);
  res.json({ data, meta: result.meta });
}
async function members(req, res) {
  const result = await list(
    Member,
    { status: { $ne: "removed" } },
    { createdAt: -1 },
    req,
    { path: "userId", select: "name email phone platformRole" },
  );
  const data = await enrichStudioRows(result.data);
  res.json({ data, meta: result.meta });
}
async function sessions(req, res) {
  const result = await list(Session, {}, { createdAt: -1 }, req, {
    path: "userId",
    select: "name email phone platformRole",
  });
  res.json(result);
}
async function devices(req, res) {
  const result = await list(Device, {}, { updatedAt: -1 }, req, [
    { path: "userId", select: "name email phone" },
    { path: "studioId", select: "name" },
  ]);
  res.json(result);
}
async function order(req, res) {
  const row = await Order.findById(req.params.id)
    .populate("studioId", "name")
    .populate("customerId", "name phone");
  if (!row || row.deletedAt) throw notFound("Order");
  res.json({ data: row });
}
async function referrals(req, res) {
  const filter = req.query.status ? { status: req.query.status } : {};
  const result = await list(Referral, filter, { createdAt: -1 }, req, [
    { path: "referrerStudioId", select: "name referralCode" },
    { path: "refereeStudioId", select: "name referralCode" },
  ]);
  res.json(result);
}
async function tickets(req, res) {
  const filter = req.query.status ? { status: req.query.status } : {};
  const result = await list(SupportTicket, filter, { updatedAt: -1 }, req, {
    path: "studioId",
    select: "name",
  });
  res.json(result);
}
async function updateTicket(req, res) {
  const input = z
    .object({ status: z.enum(["open", "in_progress", "resolved", "closed"]) })
    .parse(req.body);
  const before = await SupportTicket.findById(req.params.id);
  const ticket = await SupportTicket.findByIdAndUpdate(req.params.id, input, {
    new: true,
  });
  if (!ticket) throw notFound("Support ticket");
  await auditAdmin(
    req,
    "support_ticket.status_updated",
    "support_ticket",
    ticket,
    before,
    ticket,
  );
  res.json({ data: ticket });
}
const configInput = z.object({
  maintenance: z.boolean().default(false),
  minimumAndroidVersion: z.string().max(50).optional(),
  minimumIosVersion: z.string().max(50).optional(),
  featureFlags: z.record(z.boolean()).default({}),
});
async function config(req, res) {
  const row = await AppConfig.findOne({ key: "platform" });
  res.json({
    data: row || { key: "platform", maintenance: false, featureFlags: {} },
  });
}
async function updateConfig(req, res) {
  const before = await AppConfig.findOne({ key: "platform" });
  const row = await AppConfig.findOneAndUpdate(
    { key: "platform" },
    { key: "platform", ...configInput.parse(req.body) },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
  await auditAdmin(
    req,
    "platform_config.updated",
    "app_config",
    row,
    before,
    row,
  );
  res.json({ data: row });
}
async function notifications(req, res) {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const result = await list(Notification, filter, { createdAt: -1 }, req, {
    path: "studioId",
    select: "name",
  });
  res.json(result);
}
async function media(req, res) {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.purpose) filter.purpose = req.query.purpose;
  const result = await list(Media, filter, { createdAt: -1 }, req, {
    path: "studioId",
    select: "name",
  });
  res.json(result);
}
async function subscriptionEvents(req, res) {
  const result = await list(SubscriptionEvent, {}, { verifiedAt: -1 }, req, {
    path: "studioId",
    select: "name",
  });
  res.json({
    data: result.data.map((row) => ({ ...row.toObject(), raw: undefined })),
    meta: result.meta,
  });
}
async function audit(req, res) {
  const filter = {};
  if (req.query.action) filter.action = req.query.action;
  if (req.query.targetType) filter.targetType = req.query.targetType;
  const result = await list(AuditLog, filter, { createdAt: -1 }, req, {
    path: "actorId",
    select: "name email phone",
  });
  res.json(result);
}
module.exports = {
  dashboard,
  users,
  updateUser,
  resetUserPassword,
  studios,
  studio,
  subscriptions,
  updateSubscription,
  grantTestSubscription,
  orders,
  order,
  customers,
  templates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  uploadTemplateDiagram,
  uploadTemplateIcon,
  createTemplateDiagramUpload,
  completeTemplateDiagramUpload,
  deleteTemplateDiagram,
  deleteTemplateIcon,
  prices,
  measurements,
  members,
  sessions,
  devices,
  referrals,
  tickets,
  updateTicket,
  config,
  updateConfig,
  notifications,
  media,
  subscriptionEvents,
  audit,
};
