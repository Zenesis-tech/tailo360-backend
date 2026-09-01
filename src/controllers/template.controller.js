const { z } = require("zod");
const { nanoid } = require("nanoid");
const { GarmentTemplate, Price, Media } = require("../models");
const { notFound } = require("../utils/errors");
const r2 = require("../services/r2.service");
const {
  studioCountry,
  visibleTemplateFilter,
} = require("../services/garment-region.service");
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
const localizedNames = z
  .object({
    hi: z.string().trim().max(60).optional(),
    gu: z.string().trim().max(60).optional(),
    mr: z.string().trim().max(60).optional(),
  })
  .default({});
const input = z.object({
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
        localizedNames,
        iconKey: z.string().trim().max(60).optional(),
        iconUrl,
        iconMediaId: z.string().nullable().optional(),
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
const normalize = (value) => ({
  ...value,
  fields: value.fields?.map((x, position) => ({
    ...x,
    id: x.id || nanoid(),
    position: x.position ?? position,
  })),
  customizationGroups: value.customizationGroups?.map((g) => ({
    ...g,
    id: g.id || nanoid(),
    choices: g.choices.map((x, position) => ({
      ...x,
      id: x.id || nanoid(),
      position: x.position ?? position,
    })),
  })),
});
const visibleToStudio = (req) => ({
  deletedAt: null,
  ...visibleTemplateFilter(
    req.auth.studio._id,
    studioCountry(req.auth.studio, req.auth.user),
  ),
});
const fieldMatchKeys = (field) => [field.iconKey, field.name]
  .map((value) => String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim())
  .filter(Boolean);
const inheritedFields = (fields, globalFieldIcons) => (fields || []).map((raw) => {
  const field = raw.toObject ? raw.toObject() : { ...raw };
  if (field.iconMediaId || field.iconUrl) return field;
  const inherited = fieldMatchKeys(field)
    .map((key) => globalFieldIcons.get(key))
    .find(Boolean);
  return inherited
    ? {
        ...field,
        iconKey: field.iconKey || inherited.iconKey || "",
        iconMediaId: inherited.iconMediaId || null,
        iconUrl: inherited.iconUrl || "",
      }
    : field;
});
async function withDiagramUrls(rows) {
  const values = rows.map((row) => (row.toObject ? row.toObject() : row));
  const ids = [
    ...new Set(
      values
        .flatMap((row) => [
          row.garmentIconMediaId,
          row.measurementDiagramMediaId,
          ...(row.fields || []).map((field) => field.iconMediaId),
        ])
        .map((id) => String(id || ""))
        .filter(Boolean),
    ),
  ];
  if (!ids.length) return values;
  const mediaRows = await Media.find({ _id: { $in: ids }, status: "ready" });
  const urls = new Map();
  await Promise.all(
    mediaRows.map(async (media) =>
      urls.set(media.id, await r2.createReadUrl(media.objectKey)),
    ),
  );
  return values.map((row) => ({
    ...row,
    garmentIconUrl:
      urls.get(String(row.garmentIconMediaId)) || row.garmentIconUrl || "",
    measurementDiagramUrl:
      urls.get(String(row.measurementDiagramMediaId)) ||
      row.measurementDiagramUrl ||
      "",
    fields: (row.fields || []).map((field) => ({
      ...(field.toObject ? field.toObject() : field),
      iconUrl:
        urls.get(String(field.iconMediaId)) || field.iconUrl || "",
    })),
  }));
}
async function list(req, res) {
  const audience = z
    .enum(["men", "women", "kids", "unisex"])
    .optional()
    .parse(req.query.audience);
  const enabled = req.auth.studio.settings?.garmentAudiences?.length
    ? req.auth.studio.settings.garmentAudiences
    : ["men", "women"];
  const audiences =
    audience && enabled.includes(audience)
      ? [audience]
      : audience
        ? []
        : enabled;
  const audienceFilter = audience
    ? { audience: { $in: audiences } }
    : {
        $or: [
          { audience: { $in: audiences } },
          { audience: { $exists: false } },
        ],
      };
  const rows = await GarmentTemplate.find({
    $and: [visibleToStudio(req), audienceFilter],
    ...(req.query.active === "true" ? { active: true } : {}),
  }).sort({ scope: 1, audience: 1, name: 1 });
  const globalFieldIcons = new Map();
  for (const row of rows) {
    if (row.scope !== "global") continue;
    for (const field of row.fields || []) {
      if (!field.iconMediaId && !field.iconUrl) continue;
      for (const key of fieldMatchKeys(field)) {
        if (!globalFieldIcons.has(key)) globalFieldIcons.set(key, field);
      }
    }
  }
  const byName = new Map();
  const globalByName = new Map();
  for (const row of rows) {
    const key = `${row.audience || "unisex"}:${row.name.toLowerCase()}`;
    if (row.scope === "global") globalByName.set(key, row);
    const current = byName.get(key);
    if (!current || row.scope !== "global") {
      // Studio templates override global template details, but retain the
      // platform-managed icon until the studio supplies its own image.
      if (row.scope !== "global") {
        const global = globalByName.get(key);
        const value = row.toObject();
        value.fields = inheritedFields(value.fields, globalFieldIcons);
        if (!row.garmentIconMediaId && !row.garmentIconUrl && global) {
          value.garmentIconMediaId = global.garmentIconMediaId;
          value.garmentIconUrl = global.garmentIconUrl;
        }
        byName.set(key, value);
        continue;
      }
      byName.set(key, row);
    }
  }
  res.json({ data: await withDiagramUrls([...byName.values()]) });
}
async function create(req, res) {
  const row = await GarmentTemplate.create({
    studioId: req.auth.studio._id,
    scope: "studio",
    ...normalize(input.parse(req.body)),
  });
  res.status(201).json({ data: row });
}
async function update(req, res) {
  const body = input
    .partial()
    .extend({ version: z.number().int().nonnegative() })
    .parse(req.body);
  const row = await GarmentTemplate.findOne({
    _id: req.params.id,
    studioId: req.auth.studio._id,
    scope: { $ne: "global" },
  });
  if (!row) throw notFound("Studio garment template");
  if (row.version !== body.version)
    return res
      .status(409)
      .json({
        error: {
          code: "EDIT_CONFLICT",
          message: "This template changed elsewhere.",
          details: { current: row },
        },
      });
  Object.assign(row, normalize(body));
  await row.save();
  res.json({ data: row });
}
async function clone(req, res) {
  const source = await GarmentTemplate.findOne({
    _id: req.body.templateId,
    ...visibleToStudio(req),
  });
  if (!source) throw notFound("Garment template");
  const row = await GarmentTemplate.create({
    ...source.toObject(),
    _id: undefined,
    studioId: req.auth.studio._id,
    scope: "studio",
    garmentIconMediaId: source.garmentIconMediaId || null,
    garmentIconUrl: source.garmentIconUrl || "",
    measurementDiagramMediaId: null,
    measurementDiagramUrl: source.measurementDiagramUrl || "",
    name: req.body.name || `${source.name} copy`,
    createdAt: undefined,
    updatedAt: undefined,
  });
  res.status(201).json({ data: row });
}
async function remove(req, res) {
  const row = await GarmentTemplate.findOne({
    _id: req.params.id,
    studioId: req.auth.studio._id,
    scope: { $ne: "global" },
    deletedAt: null,
  });
  if (!row) throw notFound("Studio garment template");
  row.active = false;
  row.deletedAt = new Date();
  // Keep historical measurement/order references intact while freeing the
  // user-facing name so a replacement template can be created later.
  row.name = `${row.name} [deleted ${row._id}]`;
  await Promise.all([
    row.save(),
    Price.updateMany(
      { studioId: req.auth.studio._id, templateId: row._id, active: true },
      { active: false },
    ),
  ]);
  res.status(204).send();
}
async function prices(req, res) {
  const rows = await Price.find({
    studioId: req.auth.studio._id,
    active: true,
  }).sort({ effectiveFrom: -1 });
  const current = new Map();
  rows.forEach((x) => {
    if (!current.has(x.templateId.toString()))
      current.set(x.templateId.toString(), x);
  });
  res.json({ data: [...current.values()] });
}
async function setPrice(req, res) {
  const body = z
    .object({
      amountPaise: z.number().int().min(0),
      currency: z.literal("INR").default("INR"),
    })
    .parse(req.body);
  const template = await GarmentTemplate.findOne({
    _id: req.params.templateId,
    ...visibleToStudio(req),
  });
  if (!template) throw notFound("Garment template");
  await Price.updateMany(
    { studioId: req.auth.studio._id, templateId: template._id, active: true },
    { active: false },
  );
  const price = await Price.create({
    studioId: req.auth.studio._id,
    templateId: template._id,
    ...body,
  });
  res.json({ data: price });
}
module.exports = { list, create, update, clone, remove, prices, setPrice };
