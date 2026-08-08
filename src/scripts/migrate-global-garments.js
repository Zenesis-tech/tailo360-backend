const { connectDatabase } = require("../config/db");
const {
  GarmentTemplate,
  Measurement,
  Order,
  Price,
} = require("../models");
const {
  catalog,
  provisionStarterGarments,
} = require("../services/garment-catalog.service");

const defaultFields = [
  "Length",
  "Shoulder Width",
  "Chest",
  "Waist",
  "Hip Circumference",
  "Arm Hole",
  "Bicep",
  "Neck",
];

function isUntouchedStarter(template) {
  const names = template.fields.map((field) => field.name);
  return (
    names.length === defaultFields.length &&
    names.every((name, index) => name === defaultFields[index]) &&
    !template.customizationGroups?.length &&
    !template.measurementDiagramMediaId &&
    !template.measurementDiagramUrl
  );
}

async function migrate() {
  await connectDatabase();
  await provisionStarterGarments(null, Object.keys(catalog));

  const globalRows = await GarmentTemplate.find({ scope: "global" });
  const globalByName = new Map(globalRows.map((row) => [row.name, row]));
  const legacyNames = new Map([
    ["Pant", "Trousers"],
    ["Suit", "Men’s suit"],
  ]);
  const standardNames = [...Object.values(catalog).flat(), ...legacyNames.keys()];
  const studioRows = await GarmentTemplate.find({
    studioId: { $ne: null },
    scope: { $ne: "global" },
    name: { $in: standardNames },
  });

  let consolidated = 0;
  let retainedAsCustom = 0;
  for (const template of studioRows) {
    const global = globalByName.get(legacyNames.get(template.name) || template.name);
    if (!global || !isUntouchedStarter(template)) {
      template.scope = "studio";
      await template.save();
      retainedAsCustom += 1;
      continue;
    }

    await Promise.all([
      Price.updateMany(
        { templateId: template._id },
        { $set: { templateId: global._id } },
      ),
      Measurement.updateMany(
        { templateId: template._id },
        { $set: { templateId: global._id } },
      ),
      Order.updateMany(
        { "lines.templateId": template._id },
        { $set: { "lines.$[line].templateId": global._id } },
        { arrayFilters: [{ "line.templateId": template._id }] },
      ),
    ]);
    await template.deleteOne();
    consolidated += 1;
  }

  console.log(
    `Global garment migration complete: ${globalRows.length} global, ${consolidated} duplicates consolidated, ${retainedAsCustom} customized templates retained.`,
  );
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Global garment migration failed", error);
    process.exit(1);
  });
