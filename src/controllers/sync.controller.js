const { z } = require("zod");
const { Customer, Order, GarmentTemplate } = require("../models");
async function changes(req, res) {
  const body = z
    .object({
      cursor: z.coerce.date().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    })
    .parse(req.query);
  const after = body.cursor || new Date(0);
  const scope = { studioId: req.auth.studio._id, updatedAt: { $gt: after } };
  const [customers, orders, templates] = await Promise.all([
    Customer.find(scope).sort({ updatedAt: 1 }).limit(body.limit),
    Order.find({ ...scope, deletedAt: null })
      .sort({ updatedAt: 1 })
      .limit(body.limit),
    GarmentTemplate.find({
      updatedAt: { $gt: after },
      $or: [
        { scope: "global" },
        { studioId: req.auth.studio._id, scope: { $ne: "global" } },
      ],
    })
      .sort({ updatedAt: 1 })
      .limit(body.limit),
  ]);
  const changes = [
    ...customers.map((data) => ({ type: "customer", data })),
    ...orders.map((data) => ({ type: "order", data })),
    ...templates.map((data) => ({ type: "garment_template", data })),
  ]
    .sort((a, b) => a.data.updatedAt - b.data.updatedAt)
    .slice(0, body.limit);
  const cursor = changes.length
    ? changes[changes.length - 1].data.updatedAt.toISOString()
    : after.toISOString();
  res.json({
    data: changes,
    meta: { cursor, hasMore: changes.length === body.limit },
  });
}
module.exports = { changes };
