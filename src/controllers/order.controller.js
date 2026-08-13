const { z } = require("zod");
const { Order, Customer, GarmentTemplate, Price } = require("../models");
const { AppError, notFound } = require("../utils/errors");
const { canTransition } = require("../utils/order-status");
const { escapedSearch } = require("../utils/search");
const workflowNotifications = require("../services/workflow-notifications.service");
const lineInput = z.object({
  templateId: z.string(),
  quantity: z.number().int().min(1).max(50),
  measurements: z.record(z.string()).default({}),
  customizations: z.record(z.string()).default({}),
  measurementSource: z.enum(["saved", "adjusted", "fresh"]).default("fresh"),
  fabricMedia: z.array(z.string()).max(50).default([]),
  sampleMedia: z.string().optional(),
});
const orderInput = z.object({
  customerId: z.string(),
  lines: z.array(lineInput).min(1),
  orderDate: z.coerce.date().optional(),
  reminderDate: z.coerce.date().optional(),
  trialDate: z.coerce.date().nullable().optional(),
  deliveryDate: z.coerce.date(),
  priority: z.enum(["normal", "high", "urgent"]).default("normal"),
  notes: z.string().max(5000).optional(),
  voiceMedia: z.string().optional(),
  referenceMedia: z.array(z.string()).max(20).default([]),
  advancePayment: z
    .object({
      amountPaise: z.number().int().positive(),
      method: z.enum(["cash", "upi", "card", "bank"]),
      note: z.string().max(500).optional(),
    })
    .optional(),
});
function serialize(order) {
  // Flatten nested Mongoose Maps before JSON serialization. Without this,
  // persisted measurements are emitted as `{}` because JSON.stringify does
  // not enumerate native Map entries.
  const object = order.toObject ? order.toObject({ flattenMaps: true }) : order;
  const paidPaise = object.payments.reduce(
    (sum, p) =>
      sum + (p.direction === "collection" ? p.amountPaise : -p.amountPaise),
    0,
  );
  return {
    ...object,
    paidPaise,
    outstandingPaise: object.totalPaise - paidPaise,
  };
}
async function serializePopulated(order) {
  if (order.populate && !order.populated("customerId")) {
    await order.populate("customerId", "name phone address");
  }
  return serialize(order);
}
async function create(req, res) {
  const body = orderInput.parse(req.body),
    studio = req.auth.studio;
  const customer = await Customer.findOne({
    _id: body.customerId,
    studioId: studio._id,
    deletedAt: null,
  });
  if (!customer) throw notFound("Customer");
  const orderDate = body.orderDate || new Date();
  if (body.deliveryDate < orderDate)
    throw new AppError(
      422,
      "INVALID_DELIVERY_DATE",
      "Delivery date cannot be before the order date.",
    );
  const templates = await GarmentTemplate.find({
    _id: { $in: body.lines.map((x) => x.templateId) },
    active: true,
    $or: [
      { scope: "global" },
      { studioId: studio._id, scope: { $ne: "global" } },
    ],
  });
  if (templates.length !== body.lines.length)
    throw new AppError(
      422,
      "INVALID_GARMENT",
      "One or more garment templates are unavailable.",
    );
  const prices = await Price.find({
    studioId: studio._id,
    templateId: { $in: templates.map((x) => x._id) },
    active: true,
  }).sort({ effectiveFrom: -1 });
  const current = new Map();
  prices.forEach((price) => {
    if (!current.has(price.templateId.toString()))
      current.set(price.templateId.toString(), price);
  });
  const missing = body.lines
    .filter((line) => !current.has(line.templateId))
    .map((line) => line.templateId);
  if (missing.length)
    throw new AppError(
      422,
      "ORDER_MISSING_PRICE",
      "Set a price for every garment before creating an order.",
      { templateIds: missing },
    );
  const templateMap = new Map(templates.map((x) => [x.id, x]));
  const lines = body.lines.map((line) => {
    const price = current.get(line.templateId),
      template = templateMap.get(line.templateId);
    return {
      ...line,
      // Nested Mongoose Map fields inside an embedded document can be cast to
      // an empty map when assigned from a spread plain object. Constructing
      // real Maps preserves every validated measurement/customization key.
      measurements: new Map(Object.entries(line.measurements)),
      customizations: new Map(Object.entries(line.customizations)),
      name: template.name,
      unitPricePaise: price.amountPaise,
      lineTotalPaise: price.amountPaise * line.quantity,
    };
  });
  const totalPaise = lines.reduce((sum, x) => sum + x.lineTotalPaise, 0);
  const sequence = (
    await require("../models").Studio.findOneAndUpdate(
      { _id: studio._id },
      { $inc: { orderSequence: 1 } },
      { new: true },
    )
  ).orderSequence;
  const order = await Order.create({
    studioId: studio._id,
    customerId: customer._id,
    code: `${studio.invoicePrefix}${sequence}`,
    orderDate,
    reminderDate: body.reminderDate,
    trialDate: body.trialDate,
    deliveryDate: body.deliveryDate,
    priority: body.priority,
    notes: body.notes,
    voiceMedia: body.voiceMedia,
    referenceMedia: body.referenceMedia,
    lines,
    totalPaise,
    payments: body.advancePayment
      ? [
          {
            amountPaise: body.advancePayment.amountPaise,
            direction: "collection",
            method: body.advancePayment.method,
            noteType: "advance",
            note: body.advancePayment.note,
            recordedBy: req.auth.user._id,
          },
        ]
      : [],
    activity: [{ type: "created", actorId: req.auth.user._id }],
  });
  workflowNotifications.orderCreated(order, customer, req.auth.user._id);
  res.status(201).json({ data: await serializePopulated(order) });
}
async function list(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1),
    limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20)),
    filter = { studioId: req.auth.studio._id, deletedAt: null };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.attention === "true")
    filter.$and = [
      { status: { $nin: ["delivered", "cancelled"] } },
      { deliveryDate: { $lte: new Date() } },
    ];
  const q = escapedSearch(req.query.q);
  if (q) {
    const customers = await Customer.find({
      studioId: req.auth.studio._id,
      $or: [{ name: q }, { phone: q }],
    }).select("_id");
    filter.$or = [
      { code: q },
      { customerId: { $in: customers.map((x) => x._id) } },
    ];
  }
  const [rows, total] = await Promise.all([
    Order.find(filter)
      .populate("customerId", "name phone")
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Order.countDocuments(filter),
  ]);
  res.json({ data: rows.map(serialize), meta: { page, limit, total } });
}
async function get(req, res) {
  const order = await Order.findOne({
    _id: req.params.id,
    studioId: req.auth.studio._id,
    deletedAt: null,
  }).populate("customerId");
  if (!order) throw notFound("Order");
  res.json({ data: await serializePopulated(order) });
}
async function update(req, res) {
  const body = z
    .object({
      version: z.number().int().nonnegative(),
      orderDate: z.coerce.date().optional(),
      reminderDate: z.coerce.date().nullable().optional(),
      trialDate: z.coerce.date().nullable().optional(),
      deliveryDate: z.coerce.date().optional(),
      priority: z.enum(["normal", "high", "urgent"]).optional(),
      notes: z.string().max(5000).nullable().optional(),
      voiceMedia: z.string().nullable().optional(),
      referenceMedia: z.array(z.string()).max(20).optional(),
    })
    .parse(req.body);
  const order = await Order.findOne({
    _id: req.params.id,
    studioId: req.auth.studio._id,
    deletedAt: null,
  });
  if (!order) throw notFound("Order");
  if (order.version !== body.version)
    throw new AppError(
      409,
      "EDIT_CONFLICT",
      "This order has changed. Refresh it before editing.",
    );
  const nextOrderDate = body.orderDate || order.orderDate,
    nextTrialDate =
      body.trialDate === undefined ? order.trialDate : body.trialDate,
    nextDeliveryDate = body.deliveryDate || order.deliveryDate;
  if (
    nextDeliveryDate < nextOrderDate ||
    (nextTrialDate && nextTrialDate < nextOrderDate)
  )
    throw new AppError(
      422,
      "INVALID_ORDER_DATES",
      "Trial and delivery dates cannot precede the order date.",
    );
  Object.assign(order, body);
  order.activity.push({ type: "edited", actorId: req.auth.user._id });
  await order.save();
  workflowNotifications.orderUpdated(order, req.auth.user._id);
  res.json({ data: await serializePopulated(order) });
}
async function changeStatus(req, res) {
  const body = z
    .object({
      status: z.enum([
        "pending",
        "measurements_pending",
        "cutting",
        "stitching",
        "trial",
        "alteration",
        "ready",
        "delivered",
        "cancelled",
      ]),
      note: z.string().max(500).optional(),
      version: z.number().int().nonnegative(),
    })
    .parse(req.body);
  const order = await Order.findOne({
    _id: req.params.id,
    studioId: req.auth.studio._id,
    deletedAt: null,
  });
  if (!order) throw notFound("Order");
  if (order.version !== body.version)
    throw new AppError(
      409,
      "EDIT_CONFLICT",
      "This order has changed. Refresh it before updating.",
    );
  if (!canTransition(order.status, body.status))
    throw new AppError(
      422,
      "INVALID_STATUS_TRANSITION",
      `Cannot move an order from ${order.status} to ${body.status}.`,
    );
  const previous = order.status;
  order.status = body.status;
  order.activity.push({
    type: body.status === "cancelled" ? "cancelled" : "status_changed",
    fromStatus: previous,
    toStatus: body.status,
    note: body.note,
    actorId: req.auth.user._id,
  });
  await order.save();
  workflowNotifications.orderStatusChanged(
    order,
    previous,
    req.auth.user._id,
  );
  res.json({ data: await serializePopulated(order) });
}
async function cancel(req, res) {
  const body = z
    .object({
      version: z.number().int().nonnegative(),
      reason: z.enum(["customer_request", "duplicate", "wrong_entry", "other"]),
      note: z.string().max(500).optional(),
      hardDelete: z.boolean().default(false),
    })
    .parse(req.body);
  const order = await Order.findOne({
    _id: req.params.id,
    studioId: req.auth.studio._id,
    deletedAt: null,
  });
  if (!order) throw notFound("Order");
  if (order.version !== body.version)
    throw new AppError(
      409,
      "EDIT_CONFLICT",
      "This order has changed. Refresh it before cancelling.",
    );
  if (body.hardDelete) {
    if (order.payments.length)
      throw new AppError(
        409,
        "ORDER_DELETE_BLOCKED",
        "Orders with payments cannot be permanently deleted.",
      );
    await order.deleteOne();
    return res.status(204).send();
  }
  if (!canTransition(order.status, "cancelled"))
    throw new AppError(
      422,
      "INVALID_STATUS_TRANSITION",
      "This order cannot be cancelled.",
    );
  const previous = order.status;
  order.status = "cancelled";
  order.cancelledReason = body.reason;
  order.activity.push({
    type: "cancelled",
    fromStatus: previous,
    toStatus: "cancelled",
    note: body.note,
    actorId: req.auth.user._id,
  });
  await order.save();
  workflowNotifications.orderStatusChanged(
    order,
    previous,
    req.auth.user._id,
  );
  res.json({ data: await serializePopulated(order) });
}
async function handover(req, res) {
  const body = z
    .object({
      version: z.number().int().nonnegative(),
      qualityChecked: z.literal(true),
      finalPayment: z
        .object({
          amountPaise: z.number().int().positive(),
          method: z.enum(["cash", "upi", "card", "bank"]),
          note: z.string().max(500).optional(),
        })
        .optional(),
      shareInvoice: z.boolean().default(false),
    })
    .parse(req.body);
  const order = await Order.findOne({
    _id: req.params.id,
    studioId: req.auth.studio._id,
    deletedAt: null,
  });
  if (!order) throw notFound("Order");
  if (order.version !== body.version)
    throw new AppError(
      409,
      "EDIT_CONFLICT",
      "This order has changed. Refresh it before handing over.",
    );
  if (order.status !== "ready")
    throw new AppError(
      422,
      "ORDER_NOT_READY",
      "Only a ready order can be handed over.",
    );
  const before = serialize(order).outstandingPaise;
  if (body.finalPayment) {
    if (body.finalPayment.amountPaise > before)
      throw new AppError(
        422,
        "PAYMENT_EXCEEDS_BALANCE",
        "Final payment cannot exceed the outstanding balance.",
      );
    order.payments.push({
      amountPaise: body.finalPayment.amountPaise,
      direction: "collection",
      method: body.finalPayment.method,
      noteType: body.finalPayment.amountPaise === before ? "full" : "partial",
      note: body.finalPayment.note,
      recordedBy: req.auth.user._id,
    });
  }
  order.status = "delivered";
  order.activity.push({
    type: "status_changed",
    fromStatus: "ready",
    toStatus: "delivered",
    note: body.shareInvoice
      ? "Invoice shared during handover."
      : "Handover confirmed.",
    actorId: req.auth.user._id,
  });
  await order.save();
  workflowNotifications.orderStatusChanged(
    order,
    "ready",
    req.auth.user._id,
  );
  if (body.finalPayment) {
    workflowNotifications.paymentRecorded(
      order,
      body.finalPayment.amountPaise,
      "collection",
      req.auth.user._id,
    );
  }
  res.json({ data: await serializePopulated(order) });
}
async function activity(req, res) {
  const order = await Order.findOne({
    _id: req.params.id,
    studioId: req.auth.studio._id,
  }).select("activity");
  if (!order) throw notFound("Order");
  res.json({ data: order.activity });
}
module.exports = {
  create,
  list,
  get,
  update,
  changeStatus,
  cancel,
  handover,
  activity,
  serialize,
  serializePopulated,
};
