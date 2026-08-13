const {
  Studio,
  Member,
  Customer,
  Measurement,
  GarmentTemplate,
  Price,
  Order,
  Subscription,
  Referral,
  Media,
} = require("../models");

async function exportStudio(req, res) {
  const studioId = req.auth.studio._id;
  const [studio, members, customers, measurements, templates, prices, orders, subscription, referrals, media] = await Promise.all([
    Studio.findById(studioId).lean(),
    Member.find({ studioId }).select("-inviteToken").populate("userId", "name phone email").lean(),
    Customer.find({ studioId }).lean(),
    Measurement.find({ studioId }).lean(),
    GarmentTemplate.find({ $or: [{ studioId }, { scope: "global" }] }).lean(),
    Price.find({ studioId }).lean(),
    Order.find({ studioId }).lean(),
    Subscription.findOne({ studioId }).lean(),
    Referral.find({ $or: [{ referrerStudioId: studioId }, { referredStudioId: studioId }] }).lean(),
    Media.find({ studioId }).select("_id originalName contentType sizeBytes purpose status createdAt updatedAt").lean(),
  ]);
  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    studio,
    members,
    customers,
    measurements,
    garmentTemplates: templates,
    prices,
    orders,
    subscription,
    referrals,
    media,
  };
  const body = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
  const safeName = String(studio?.name || "studio").replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  const date = new Date().toISOString().slice(0, 10);
  res.set({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${safeName}-data-export-${date}.json"`,
    "Content-Length": body.length,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.send(body);
}

module.exports = { exportStudio };
