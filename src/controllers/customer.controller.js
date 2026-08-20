const { z } = require("zod");
const { Customer, Order, Measurement, GarmentTemplate } = require("../models");
const { AppError, notFound } = require("../utils/errors");
const { escapedSearch } = require("../utils/search");
const workflowNotifications = require("../services/workflow-notifications.service");
function serializeMeasurement(row) {
  return row?.toObject
    ? row.toObject({ flattenMaps: true })
    : row;
}
const customerInput = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(10).max(20),
  address: z.string().max(500).optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  notes: z.string().max(2000).optional(),
  fitPreference: z.enum(["slim", "regular", "relaxed"]).optional(),
  preferredContact: z.enum(["call", "whatsapp", "sms"]).optional(),
});
async function list(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1),
    limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20)),
    q = escapedSearch(req.query.q);
  const filter = {
    studioId: req.auth.studio._id,
    deletedAt: null,
    ...(q ? { $or: [{ name: q }, { phone: q }] } : {}),
  };
  const [items, total] = await Promise.all([
    Customer.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Customer.countDocuments(filter),
  ]);
  const ids = items.map((x) => x._id);
  const orders = await Order.aggregate([
    {
      $match: {
        studioId: req.auth.studio._id,
        customerId: { $in: ids },
        deletedAt: null,
      },
    },
    { $project: { customerId: 1, totalPaise: 1, payments: 1, status: 1 } },
  ]);
  const metrics = new Map(
    ids.map((id) => [id.toString(), { outstandingPaise: 0, activeOrders: 0 }]),
  );
  for (const order of orders) {
    const balance = order.payments.reduce(
      (sum, p) =>
        sum + (p.direction === "refund" ? p.amountPaise : -p.amountPaise),
      order.totalPaise,
    );
    const value = metrics.get(order.customerId.toString());
    value.outstandingPaise += balance;
    if (!["delivered", "cancelled"].includes(order.status))
      value.activeOrders++;
  }
  res.json({
    data: items.map((item) => ({
      ...item.toObject(),
      metrics: metrics.get(item.id),
    })),
    meta: { page, limit, total },
  });
}
async function create(req, res) {
  const input = customerInput.parse(req.body);
  const duplicate = await Customer.findOne({
    studioId: req.auth.studio._id,
    phone: input.phone,
    deletedAt: null,
  });
  const customer = await Customer.create({
    studioId: req.auth.studio._id,
    ...input,
  });
  workflowNotifications.customerChanged(customer, "created", req.auth.user._id);
  res
    .status(201)
    .json({
      data: customer,
      meta: {
        duplicatePhoneWarning: Boolean(duplicate),
        duplicateCustomerId: duplicate?.id,
      },
    });
}
async function get(req, res) {
  const [customer, orders] = await Promise.all([
    Customer.findOne({
      _id: req.params.id,
      studioId: req.auth.studio._id,
      deletedAt: null,
    }),
    Order.find({
      customerId: req.params.id,
      studioId: req.auth.studio._id,
      deletedAt: null,
    }).sort({ createdAt: -1 }),
  ]);
  if (!customer) throw notFound("Customer");
  const outstandingPaise = orders.reduce(
    (total, order) =>
      total +
      order.payments.reduce(
        (sum, p) =>
          sum + (p.direction === "refund" ? p.amountPaise : -p.amountPaise),
        order.totalPaise,
      ),
    0,
  );
  res.json({
    data: {
      ...customer.toObject(),
      orders,
      metrics: {
        outstandingPaise,
        activeOrders: orders.filter(
          (o) => !["delivered", "cancelled"].includes(o.status),
        ).length,
      },
    },
  });
}
async function update(req, res) {
  const body = customerInput
    .partial()
    .extend({ version: z.number().int().nonnegative() })
    .parse(req.body);
  const customer = await Customer.findOne({
    _id: req.params.id,
    studioId: req.auth.studio._id,
    deletedAt: null,
  });
  if (!customer) throw notFound("Customer");
  if (customer.version !== body.version)
    throw new AppError(
      409,
      "EDIT_CONFLICT",
      "This customer was changed elsewhere.",
      { current: customer },
    );
  Object.assign(customer, body);
  await customer.save();
  workflowNotifications.customerChanged(customer, "updated", req.auth.user._id);
  res.json({ data: customer });
}
async function remove(req, res) {
  const customer = await Customer.findOne({
    _id: req.params.id,
    studioId: req.auth.studio._id,
    deletedAt: null,
  });
  if (!customer) throw notFound("Customer");
  const orders = await Order.find({
    customerId: customer._id,
    deletedAt: null,
  });
  const blocked = orders.some(
    (o) =>
      !["delivered", "cancelled"].includes(o.status) ||
      o.payments.reduce(
        (sum, p) =>
          sum + (p.direction === "refund" ? p.amountPaise : -p.amountPaise),
        o.totalPaise,
      ) > 0,
  );
  if (blocked)
    throw new AppError(
      409,
      "CUSTOMER_DELETE_BLOCKED",
      "Customers with active orders or an outstanding balance cannot be deleted.",
    );
  customer.deletedAt = new Date();
  await customer.save();
  res.status(204).send();
}
async function measurements(req, res) {
  const customer = await Customer.exists({
    _id: req.params.id,
    studioId: req.auth.studio._id,
    deletedAt: null,
  });
  if (!customer) throw notFound("Customer");
  const filter = {
    studioId: req.auth.studio._id,
    customerId: req.params.id,
    ...(req.params.templateId ? { templateId: req.params.templateId } : {}),
  };
  const rows = await Measurement.find(filter).sort({ version: -1 });
  if (req.params.templateId)
    return res.json({
      data: {
        current: rows[0] ? serializeMeasurement(rows[0]) : null,
        history: rows.map(serializeMeasurement),
      },
    });
  const currentByTemplate = new Map();
  for (const row of rows)
    if (!currentByTemplate.has(row.templateId.toString()))
      currentByTemplate.set(row.templateId.toString(), row);

  // Measurements entered while creating an order predate the reusable
  // customer-profile records in some studios. Treat the newest non-empty
  // order line as the current size when no explicit profile exists for that
  // garment. This keeps returning clients' sizes available without replacing
  // a profile that was deliberately saved or edited later.
  const orders = await Order.find({
    studioId: req.auth.studio._id,
    customerId: req.params.id,
    deletedAt: null,
  })
    .select("lines createdAt updatedAt")
    .sort({ createdAt: -1, _id: -1 });
  const orderMeasurements = [];
  const orderTemplateIds = new Set();
  for (const order of orders) {
    for (const line of order.lines) {
      const templateId = line.templateId?.toString();
      const rawValues = line.measurements instanceof Map
        ? Object.fromEntries(line.measurements)
        : line.measurements || {};
      const values = Object.fromEntries(
        Object.entries(rawValues).map(([name, value]) => [
          name,
          String(value).trim().replace(/\s*(in|cm)\s*$/i, ""),
        ]),
      );
      if (
        !templateId ||
        currentByTemplate.has(templateId) ||
        orderTemplateIds.has(templateId) ||
        !Object.values(values).some((value) => String(value).trim())
      ) {
        continue;
      }
      orderTemplateIds.add(templateId);
      orderMeasurements.push({
        _id: line._id,
        templateId: line.templateId,
        version: 1,
        values,
        customizations:
          line.customizations instanceof Map
            ? Object.fromEntries(line.customizations)
            : line.customizations || {},
        unit: Object.values(rawValues).some((value) => /\bcm\s*$/i.test(String(value)))
          ? "cm"
          : "in",
        createdAt: order.updatedAt || order.createdAt,
        updatedAt: order.updatedAt || order.createdAt,
        source: "order",
      });
    }
  }
  const currentRows = [...currentByTemplate.values(), ...orderMeasurements];
  const templates = await GarmentTemplate.find({
    _id: { $in: currentRows.map((row) => row.templateId) },
    $or: [
      { scope: "global" },
      { studioId: req.auth.studio._id, scope: { $ne: "global" } },
    ],
  }).select("name active fields customizationGroups scope");
  const templateById = new Map(
    templates.map((template) => [template.id, template]),
  );
  res.json({
    data: currentRows.map((row) => ({
      ...(row.source === "order" ? row : serializeMeasurement(row)),
      template: templateById.get(row.templateId.toString()),
    })),
  });
}
async function saveMeasurements(req, res) {
  const input = z
    .object({
      values: z.record(z.string().trim().max(30)),
      customizations: z.record(z.string().trim().max(80)).default({}),
      unit: z.enum(["in", "cm"]),
      updateCustomerProfile: z.boolean().default(true),
    })
    .parse(req.body);
  const [customer, template] = await Promise.all([
    Customer.findOne({
      _id: req.params.id,
      studioId: req.auth.studio._id,
      deletedAt: null,
    }).select("name"),
    GarmentTemplate.findOne({
      _id: req.params.templateId,
      $or: [
        { scope: "global" },
        { studioId: req.auth.studio._id, scope: { $ne: "global" } },
      ],
    }),
  ]);
  if (!customer) throw notFound("Customer");
  if (!template) throw notFound("Garment template");
  const fields = new Map(
    template.fields
      .filter((field) => field.active)
      .map((field) => [field.name, field]),
  );
  const unknownFields = Object.keys(input.values).filter(
    (name) => !fields.has(name),
  );
  if (unknownFields.length)
    throw new AppError(
      422,
      "UNKNOWN_MEASUREMENT_FIELD",
      "One or more measurement fields do not belong to this garment template.",
      { fields: unknownFields },
    );
  const invalidValues = Object.entries(input.values)
    .filter(([, value]) => value !== "" && !/^\d+(\.\d{1,2})?$/.test(value))
    .map(([name]) => name);
  if (invalidValues.length)
    throw new AppError(
      422,
      "INVALID_MEASUREMENT_VALUE",
      "Measurements must be numeric values.",
      { fields: invalidValues },
    );
  const missingRequired = [...fields.values()]
    .filter((field) => field.required && !input.values[field.name])
    .map((field) => field.name);
  if (missingRequired.length)
    throw new AppError(
      422,
      "REQUIRED_MEASUREMENT_MISSING",
      "Complete every required measurement.",
      { fields: missingRequired },
    );
  const groups = new Map(
    template.customizationGroups.map((group) => [group.name, group]),
  );
  const invalidCustomizations = Object.entries(input.customizations)
    .filter(
      ([groupName, choice]) =>
        !groups
          .get(groupName)
          ?.choices.some((item) => item.active && item.name === choice),
    )
    .map(([groupName]) => groupName);
  if (invalidCustomizations.length)
    throw new AppError(
      422,
      "INVALID_CUSTOMIZATION",
      "One or more customization choices are invalid.",
      { groups: invalidCustomizations },
    );
  const latest = await Measurement.findOne({
    studioId: req.auth.studio._id,
    customerId: req.params.id,
    templateId: req.params.templateId,
  }).sort({ version: -1 });
  const row = await Measurement.create({
    studioId: req.auth.studio._id,
    customerId: req.params.id,
    templateId: req.params.templateId,
    version: (latest?.version || 0) + 1,
    values: input.values,
    customizations: input.customizations,
    unit: input.unit,
    createdBy: req.auth.user._id,
  });
  workflowNotifications.measurementsUpdated(
    req.auth.studio._id,
    req.params.id,
    customer.name,
    req.auth.user._id,
  );
  res.status(201).json({
    data: serializeMeasurement(row),
    meta: { savedAsNewVersion: true },
  });
}
module.exports = {
  list,
  create,
  get,
  update,
  remove,
  measurements,
  saveMeasurements,
};
