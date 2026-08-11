const { nanoid } = require("nanoid");
const { GarmentTemplate } = require("../models");

const measurement = (name, required = true) => ({
  name,
  unit: "in",
  required,
});

const templateCatalog = {
  men: [
    {
      name: "Shirt",
      fields: ["Shirt Length", "Shoulder", "Chest", "Waist", "Seat", "Neck", "Sleeve Length", "Arm Hole", "Bicep", "Cuff"],
    },
    {
      name: "Trousers",
      fields: ["Trouser Length", "Inseam", "Waist", "Seat / Hip", "Thigh", "Knee", "Bottom Opening", "Front Rise", "Back Rise"],
    },
    {
      name: "Kurta",
      fields: ["Kurta Length", "Shoulder", "Chest", "Waist", "Hip", "Neck", "Sleeve Length", "Arm Hole", "Bicep", "Cuff", "Side Slit Length"],
    },
    {
      name: "Pyjama",
      fields: ["Pyjama Length", "Waist", "Seat / Hip", "Thigh", "Knee", "Bottom Opening", "Rise"],
    },
    {
      name: "Nehru jacket",
      fields: ["Jacket Length", "Shoulder", "Chest", "Waist", "Seat", "Neck", "Arm Hole"],
    },
    {
      name: "Blazer",
      fields: ["Blazer Length", "Shoulder", "Chest", "Waist", "Seat", "Sleeve Length", "Arm Hole", "Bicep", "Wrist", "Neck"],
    },
    {
      name: "Men’s suit",
      fields: ["Coat Length", "Shoulder", "Chest", "Waist", "Seat", "Sleeve Length", "Arm Hole", "Bicep", "Trouser Length", "Inseam", "Trouser Waist", "Thigh", "Knee", "Bottom Opening", "Rise"],
    },
    {
      name: "Sherwani",
      fields: ["Sherwani Length", "Shoulder", "Chest", "Waist", "Hip", "Neck", "Sleeve Length", "Arm Hole", "Bicep", "Cuff", "Side Slit Length"],
    },
    {
      name: "Safari suit",
      fields: ["Shirt Length", "Shoulder", "Chest", "Waist", "Seat", "Neck", "Sleeve Length", "Arm Hole", "Bicep", "Trouser Length", "Inseam", "Trouser Waist", "Thigh", "Bottom Opening", "Rise"],
    },
  ],
  women: [
    {
      name: "Blouse",
      fields: ["Blouse Length", "Shoulder", "Bust", "Under Bust", "Waist", "Front Neck Depth", "Back Neck Depth", "Arm Hole", "Sleeve Length", "Bicep", "Sleeve Opening"],
    },
    {
      name: "Kurti",
      fields: ["Kurti Length", "Shoulder", "Bust", "Waist", "Hip", "Front Neck Depth", "Back Neck Depth", "Arm Hole", "Sleeve Length", "Bicep", "Sleeve Opening", "Side Slit Length"],
    },
    {
      name: "Kameez",
      fields: ["Kameez Length", "Shoulder", "Bust", "Waist", "Hip", "Front Neck Depth", "Back Neck Depth", "Arm Hole", "Sleeve Length", "Bicep", "Sleeve Opening", "Side Slit Length"],
    },
    {
      name: "Salwar",
      fields: ["Salwar Length", "Waist", "Hip", "Thigh", "Knee", "Bottom / Poncha", "Rise"],
    },
    {
      name: "Salwar suit",
      fields: ["Kameez Length", "Shoulder", "Bust", "Waist", "Hip", "Front Neck Depth", "Back Neck Depth", "Arm Hole", "Sleeve Length", "Bicep", "Sleeve Opening", "Side Slit Length", "Salwar Length", "Salwar Waist", "Thigh", "Bottom / Poncha", "Rise"],
    },
    {
      name: "Churidar",
      fields: ["Churidar Length", "Waist", "Hip", "Thigh", "Knee", "Calf", "Ankle", "Rise"],
    },
    {
      name: "Palazzo",
      fields: ["Palazzo Length", "Waist", "Hip", "Thigh", "Knee", "Bottom Opening", "Rise"],
    },
    {
      name: "Petticoat",
      fields: ["Petticoat Length", "Waist", "Hip", "Bottom Flare"],
    },
    {
      name: "Lehenga",
      fields: ["Lehenga Length", "Waist", "Hip", "Bottom Flare", "Blouse Length", "Shoulder", "Bust", "Under Bust", "Front Neck Depth", "Back Neck Depth", "Sleeve Length", "Bicep"],
    },
    {
      name: "Anarkali",
      fields: ["Anarkali Length", "Shoulder", "Bust", "Under Bust", "Waist", "Hip", "Front Neck Depth", "Back Neck Depth", "Arm Hole", "Sleeve Length", "Bicep", "Sleeve Opening", "Kali Flare"],
    },
    {
      name: "Gown",
      fields: ["Gown Length", "Shoulder", "Bust", "Under Bust", "Waist", "Hip", "Front Neck Depth", "Back Neck Depth", "Arm Hole", "Sleeve Length", "Bicep", "Sleeve Opening", "Bottom Flare"],
    },
    {
      name: "Skirt",
      fields: ["Skirt Length", "Waist", "Hip", "Bottom Flare"],
    },
    {
      name: "Women’s trousers",
      fields: ["Trouser Length", "Inseam", "Waist", "Hip", "Thigh", "Knee", "Bottom Opening", "Front Rise", "Back Rise"],
    },
  ],
  kids: [
    {
      name: "Kids shirt",
      fields: ["Shirt Length", "Shoulder", "Chest", "Waist", "Neck", "Sleeve Length", "Arm Hole", "Bicep", "Cuff"],
    },
    {
      name: "Kids trousers",
      fields: ["Trouser Length", "Inseam", "Waist", "Hip", "Thigh", "Knee", "Bottom Opening", "Rise"],
    },
    {
      name: "Kids dress",
      fields: ["Dress Length", "Shoulder", "Chest", "Waist", "Hip", "Front Neck Depth", "Back Neck Depth", "Arm Hole", "Sleeve Length", "Bottom Flare"],
    },
    {
      name: "Kids frock",
      fields: ["Frock Length", "Bodice Length", "Shoulder", "Chest", "Waist", "Front Neck Depth", "Back Neck Depth", "Arm Hole", "Sleeve Length", "Bottom Flare"],
    },
    {
      name: "Kids kurta pyjama",
      fields: ["Kurta Length", "Shoulder", "Chest", "Waist", "Hip", "Neck", "Sleeve Length", "Arm Hole", "Bicep", "Pyjama Length", "Pyjama Waist", "Thigh", "Bottom Opening", "Rise"],
    },
    {
      name: "Kids lehenga",
      fields: ["Lehenga Length", "Waist", "Hip", "Bottom Flare", "Blouse Length", "Shoulder", "Chest", "Front Neck Depth", "Back Neck Depth", "Sleeve Length"],
    },
    {
      name: "School uniform",
      fields: ["Top Length", "Shoulder", "Chest", "Waist", "Hip", "Neck", "Sleeve Length", "Arm Hole", "Bottom Length", "Inseam", "Thigh", "Bottom Opening", "Rise"],
    },
  ],
  unisex: [
    {
      name: "Uniform",
      fields: ["Top Length", "Shoulder", "Chest", "Waist", "Hip", "Neck", "Sleeve Length", "Arm Hole", "Bicep", "Bottom Length", "Inseam", "Thigh", "Bottom Opening", "Rise"],
    },
    {
      name: "Apron",
      fields: ["Apron Length", "Chest Width", "Waist Width", "Shoulder Strap Length", "Waist Tie Length"],
    },
  ],
};

const catalog = Object.fromEntries(
  Object.entries(templateCatalog).map(([audience, templates]) => [
    audience,
    templates.map((template) => template.name),
  ]),
);

function fieldsFor(template) {
  return template.fields.map((field, position) => ({
    id: nanoid(),
    ...measurement(field),
    active: true,
    position,
  }));
}

async function provisionStarterGarments(_studioId, audiences) {
  const selected = [...new Set(audiences)].filter(
    (audience) => templateCatalog[audience],
  );
  await Promise.all(
    selected.flatMap((audience) =>
      templateCatalog[audience].map((template) =>
        GarmentTemplate.updateOne(
          { scope: "global", studioId: null, name: template.name },
          {
            $setOnInsert: {
              scope: "global",
              studioId: null,
              name: template.name,
              audience,
              fields: fieldsFor(template),
            },
          },
          { upsert: true },
        ),
      ),
    ),
  );
}

module.exports = {
  catalog,
  templateCatalog,
  fieldsFor,
  provisionStarterGarments,
};
