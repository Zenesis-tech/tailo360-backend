const { nanoid } = require("nanoid");
const { GarmentTemplate } = require("../models");

const catalog = {
  men: ["Shirt", "Trousers", "Kurta", "Men’s suit"],
  women: ["Blouse", "Kurti", "Salwar suit", "Lehenga"],
  kids: ["Kids shirt", "Kids trousers", "Kids dress"],
  unisex: ["Uniform", "Apron"],
};
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

async function provisionStarterGarments(_studioId, audiences) {
  const selected = [...new Set(audiences)].filter(
    (audience) => catalog[audience],
  );
  await Promise.all(
    selected.flatMap((audience) =>
      catalog[audience].map((name) =>
        GarmentTemplate.updateOne(
          { scope: "global", studioId: null, name },
          {
            $setOnInsert: {
              scope: "global",
              studioId: null,
              name,
              audience,
              fields: defaultFields.map((field, position) => ({
                id: nanoid(),
                name: field,
                unit: "in",
                position,
              })),
            },
          },
          { upsert: true },
        ),
      ),
    ),
  );
}

module.exports = { catalog, provisionStarterGarments };
