const mongoose = require("mongoose");

const { connectDatabase } = require("../config/db");
const { GarmentTemplate } = require("../models");
const {
  catalog,
  templateCatalog,
  fieldsFor,
  customizationGroupsFor,
  provisionStarterGarments,
} = require("../services/garment-catalog.service");

const legacyGenericFields = [
  "Length",
  "Shoulder Width",
  "Chest",
  "Waist",
  "Hip Circumference",
  "Arm Hole",
  "Bicep",
  "Neck",
];

function hasLegacyGenericFields(template) {
  const names = template.fields.map((field) => field.name);
  return (
    names.length === legacyGenericFields.length &&
    names.every((name, index) => name === legacyGenericFields[index])
  );
}

function mergeCustomizationGroups(template, definition) {
  let changed = false;
  const desiredGroups = customizationGroupsFor(definition);
  for (const desired of desiredGroups) {
    const existing = template.customizationGroups.find(
      (group) => group.name.toLowerCase() === desired.name.toLowerCase(),
    );
    if (!existing) {
      template.customizationGroups.push(desired);
      changed = true;
      continue;
    }
    for (const choice of desired.choices) {
      if (
        !existing.choices.some(
          (item) => item.name.toLowerCase() === choice.name.toLowerCase(),
        )
      ) {
        existing.choices.push(choice);
        changed = true;
      }
    }
  }
  return changed;
}

async function run() {
  const audiences = Object.keys(catalog);
  await connectDatabase();
  await provisionStarterGarments(null, audiences);

  let upgraded = 0;
  let preserved = 0;
  for (const [audience, definitions] of Object.entries(templateCatalog)) {
    for (const definition of definitions) {
      const template = await GarmentTemplate.findOne({
        scope: "global",
        studioId: null,
        name: definition.name,
      });
      if (!template) continue;
      const isEmpty = template.fields.length === 0;
      const isUntouchedGeneric =
        hasLegacyGenericFields(template) &&
        !template.customizationGroups?.length &&
        !template.measurementDiagramMediaId &&
        !template.measurementDiagramUrl;
      if (isEmpty || isUntouchedGeneric) {
        template.audience = audience;
        template.fields = fieldsFor(definition);
        template.customizationGroups = customizationGroupsFor(definition);
        await template.save();
        upgraded += 1;
      } else if (mergeCustomizationGroups(template, definition)) {
        await template.save();
        upgraded += 1;
      } else {
        preserved += 1;
      }
    }
  }

  const expectedNames = audiences.flatMap((audience) => catalog[audience]);
  const templates = await GarmentTemplate.find({
    scope: "global",
    studioId: null,
    name: { $in: expectedNames },
  })
    .select("name audience")
    .sort({ audience: 1, name: 1 })
    .lean();

  console.log(
    `Global garment templates ready: ${templates.length}/${expectedNames.length}; ${upgraded} generic templates upgraded, ${preserved} existing tailored templates preserved.`,
  );
  for (const template of templates) {
    console.log(`- ${template.audience}: ${template.name}`);
  }
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("Garment template seed failed:", error.message);
  await mongoose.disconnect();
  process.exit(1);
});
