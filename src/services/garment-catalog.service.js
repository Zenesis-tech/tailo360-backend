const { nanoid } = require("nanoid");
const { GarmentTemplate } = require("../models");
const { SUPPORTED_GARMENT_COUNTRIES } = require("./garment-region.service");

const measurement = (name, required = true) => ({
  name,
  unit: "in",
  required,
});

const customization = (name, choices) => ({ name, choices });

const templateCatalog = {
  men: [
    {
      name: "Shirt",
      fields: ["Shirt Length", "Shoulder", "Chest", "Waist", "Seat", "Neck", "Sleeve Length", "Arm Hole", "Bicep", "Cuff"],
      customizations: [
        customization("Collar", ["Classic", "Spread", "Cutaway", "Mandarin", "Button-down"]),
        customization("Sleeve", ["Full", "Half", "Three-quarter", "Sleeveless"]),
        customization("Cuff", ["Rounded", "Squared", "French", "Single", "Double"]),
        customization("Pocket", ["No pocket", "Single", "Double"]),
        customization("Placket", ["Regular", "Hidden", "Contrast"]),
      ],
    },
    {
      name: "Trousers",
      fields: ["Trouser Length", "Inseam", "Waist", "Seat / Hip", "Thigh", "Knee", "Bottom Opening", "Front Rise", "Back Rise"],
      customizations: [
        customization("Waistband", ["Standard", "Elastic back", "Drawstring"]),
        customization("Pleats", ["Flat front", "Single pleat", "Double pleat"]),
        customization("Bottom", ["Plain", "Cuffed", "Narrow"]),
      ],
    },
    {
      name: "Kurta",
      fields: ["Kurta Length", "Shoulder", "Chest", "Waist", "Hip", "Neck", "Sleeve Length", "Arm Hole", "Bicep", "Cuff", "Side Slit Length"],
      customizations: [
        customization("Collar", ["Standard", "Mandarin", "V neck", "Round"]),
        customization("Cuff", ["Plain", "Button", "Contrast"]),
        customization("Placket", ["Short", "Full", "Hidden"]),
      ],
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
      customizations: [
        customization("Lapel", ["Notch", "Peak", "Shawl"]),
        customization("Buttons", ["Single button", "Two button", "Double breasted"]),
        customization("Vent", ["No vent", "Single vent", "Double vent"]),
      ],
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
      customizations: [
        customization("Neck", ["Round", "V neck", "Boat", "Sweetheart"]),
        customization("Sleeve", ["Sleeveless", "Short", "Elbow", "Full"]),
        customization("Back", ["Closed", "Deep back", "Tie back"]),
      ],
    },
    {
      name: "Kurti",
      fields: ["Kurti Length", "Shoulder", "Bust", "Waist", "Hip", "Front Neck Depth", "Back Neck Depth", "Arm Hole", "Sleeve Length", "Bicep", "Sleeve Opening", "Side Slit Length"],
      customizations: [
        customization("Neck", ["Round", "V neck", "Mandarin", "Boat"]),
        customization("Sleeve", ["Short", "Three-quarter", "Full"]),
        customization("Side slit", ["None", "Short", "Regular", "High"]),
      ],
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

const defaultCustomizationCatalog = {
  Pyjama: [
    customization("Waist", ["Elastic", "Drawstring", "Elastic and drawstring"]),
    customization("Fit", ["Regular", "Slim", "Relaxed"]),
    customization("Bottom", ["Straight", "Narrow", "Cuffed"]),
    customization("Pocket", ["None", "Side", "Back"]),
  ],
  "Nehru jacket": [
    customization("Collar", ["Classic band", "High band", "Rounded band"]),
    customization("Buttons", ["Five", "Six", "Concealed"]),
    customization("Pocket", ["Welt", "Flap", "Patch"]),
    customization("Vent", ["None", "Single", "Side vents"]),
  ],
  "Men\u2019s suit": [
    customization("Lapel", ["Notch", "Peak", "Shawl"]),
    customization("Jacket buttons", ["One", "Two", "Double breasted"]),
    customization("Vent", ["None", "Single", "Double"]),
    customization("Trouser pleats", ["Flat front", "Single", "Double"]),
  ],
  Sherwani: [
    customization("Collar", ["Classic band", "High band", "Open"]),
    customization("Closure", ["Buttons", "Concealed", "Asymmetric"]),
    customization("Cuff", ["Plain", "Buttoned", "Contrast"]),
    customization("Vent", ["Side slits", "Back vent", "No vent"]),
  ],
  "Safari suit": [
    customization("Collar", ["Classic", "Spread", "Cuban"]),
    customization("Sleeve", ["Full", "Half"]),
    customization("Pocket", ["Two patch", "Four patch", "Flap"]),
    customization("Trouser pleats", ["Flat front", "Single", "Double"]),
  ],
  Kameez: [
    customization("Neck", ["Round", "V neck", "Boat", "Mandarin"]),
    customization("Sleeve", ["Sleeveless", "Short", "Three-quarter", "Full"]),
    customization("Side slit", ["None", "Short", "Regular", "High"]),
    customization("Hem", ["Straight", "Rounded", "High-low"]),
  ],
  Salwar: [
    customization("Waist", ["Drawstring", "Elastic", "Belt"]),
    customization("Pleats", ["Regular", "Patiala", "Minimal"]),
    customization("Bottom", ["Narrow", "Regular", "Cuffed"]),
  ],
  "Salwar suit": [
    customization("Neck", ["Round", "V neck", "Boat", "Mandarin"]),
    customization("Sleeve", ["Sleeveless", "Short", "Three-quarter", "Full"]),
    customization("Salwar", ["Regular", "Patiala", "Churidar"]),
    customization("Side slit", ["None", "Short", "Regular", "High"]),
  ],
  Churidar: [
    customization("Waist", ["Drawstring", "Elastic", "Belt"]),
    customization("Fit", ["Regular", "Slim", "Extra slim"]),
    customization("Ankle", ["Gathered", "Plain", "Buttoned"]),
  ],
  Palazzo: [
    customization("Waist", ["Elastic", "Side zip", "Front band"]),
    customization("Flare", ["Regular", "Wide", "Extra wide"]),
    customization("Pocket", ["None", "Side", "Patch"]),
  ],
  Petticoat: [
    customization("Waist", ["Drawstring", "Elastic", "Hook"]),
    customization("Shape", ["A-line", "Panelled", "Mermaid"]),
    customization("Bottom", ["Plain", "Flared", "Ruffled"]),
  ],
  Lehenga: [
    customization("Waist", ["Drawstring", "Side zip", "Back zip"]),
    customization("Flare", ["Circular", "Panelled", "Mermaid"]),
    customization("Blouse neck", ["Round", "V neck", "Boat", "Sweetheart"]),
    customization("Blouse sleeve", ["Sleeveless", "Short", "Elbow", "Full"]),
  ],
  Anarkali: [
    customization("Neck", ["Round", "V neck", "Boat", "Mandarin"]),
    customization("Sleeve", ["Sleeveless", "Short", "Three-quarter", "Full"]),
    customization("Flare", ["Regular", "Full", "Extra full"]),
    customization("Hem", ["Straight", "Layered", "High-low"]),
  ],
  Gown: [
    customization("Neck", ["Round", "V neck", "Boat", "Sweetheart"]),
    customization("Sleeve", ["Sleeveless", "Short", "Three-quarter", "Full"]),
    customization("Silhouette", ["A-line", "Ball gown", "Mermaid", "Straight"]),
    customization("Back", ["Closed", "Deep", "Lace-up", "Zip"]),
  ],
  Skirt: [
    customization("Waist", ["Elastic", "Side zip", "Back zip"]),
    customization("Shape", ["Straight", "A-line", "Circular", "Pleated"]),
    customization("Slit", ["None", "Front", "Side", "Back"]),
  ],
  "Women\u2019s trousers": [
    customization("Waistband", ["Standard", "High waist", "Elastic back"]),
    customization("Pleats", ["Flat front", "Single", "Double"]),
    customization("Leg", ["Straight", "Tapered", "Wide", "Bootcut"]),
    customization("Pocket", ["None", "Side", "Back", "Both"]),
  ],
  "Kids shirt": [
    customization("Collar", ["Classic", "Spread", "Mandarin", "Button-down"]),
    customization("Sleeve", ["Full", "Half", "Sleeveless"]),
    customization("Cuff", ["Rounded", "Squared", "Elastic"]),
    customization("Pocket", ["None", "Single", "Double"]),
  ],
  "Kids trousers": [
    customization("Waist", ["Elastic", "Adjustable elastic", "Standard"]),
    customization("Leg", ["Straight", "Tapered", "Wide"]),
    customization("Bottom", ["Plain", "Cuffed", "Elastic"]),
    customization("Pocket", ["None", "Side", "Cargo"]),
  ],
  "Kids dress": [
    customization("Neck", ["Round", "Square", "Peter Pan", "Boat"]),
    customization("Sleeve", ["Sleeveless", "Cap", "Short", "Full"]),
    customization("Skirt", ["A-line", "Gathered", "Circular", "Layered"]),
    customization("Closure", ["Back zip", "Buttons", "Tie"]),
  ],
  "Kids frock": [
    customization("Neck", ["Round", "Square", "Peter Pan", "Boat"]),
    customization("Sleeve", ["Sleeveless", "Puff", "Short", "Full"]),
    customization("Skirt", ["Gathered", "Circular", "Layered"]),
    customization("Detail", ["Plain", "Bow", "Frill", "Belt"]),
  ],
  "Kids kurta pyjama": [
    customization("Collar", ["Classic band", "Mandarin", "Open"]),
    customization("Sleeve", ["Full", "Half"]),
    customization("Kurta placket", ["Short", "Full", "Hidden"]),
    customization("Pyjama waist", ["Elastic", "Drawstring", "Both"]),
  ],
  "Kids lehenga": [
    customization("Blouse neck", ["Round", "V neck", "Boat", "Square"]),
    customization("Blouse sleeve", ["Sleeveless", "Short", "Elbow", "Full"]),
    customization("Lehenga flare", ["Circular", "Panelled", "Layered"]),
    customization("Waist", ["Drawstring", "Elastic", "Side zip"]),
  ],
  "School uniform": [
    customization("Top collar", ["Classic", "Spread", "Peter Pan", "Mandarin"]),
    customization("Top sleeve", ["Full", "Half", "Sleeveless"]),
    customization("Bottom", ["Trousers", "Shorts", "Skirt", "Pinafore"]),
    customization("Pocket", ["None", "Chest", "Side", "Both"]),
  ],
  Uniform: [
    customization("Collar", ["Classic", "Spread", "Mandarin", "None"]),
    customization("Sleeve", ["Full", "Half", "Sleeveless"]),
    customization("Bottom", ["Trousers", "Skirt", "Shorts"]),
    customization("Pocket", ["None", "Chest", "Side", "Cargo"]),
  ],
  Apron: [
    customization("Neck strap", ["Fixed", "Adjustable", "Cross-back"]),
    customization("Length", ["Waist", "Knee", "Full"]),
    customization("Pocket", ["None", "Single", "Double", "Tool pockets"]),
    customization("Closure", ["Waist tie", "Buckle", "Button"]),
  ],
};

for (const templates of Object.values(templateCatalog)) {
  for (const template of templates) {
    template.customizations ||= defaultCustomizationCatalog[template.name];
  }
}

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

function customizationGroupsFor(template) {
  return (template.customizations || []).map((group) => ({
    id: nanoid(),
    name: group.name,
    choices: group.choices.map((choice, position) => ({
      id: nanoid(),
      name: choice,
      active: true,
      position,
    })),
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
              countries: SUPPORTED_GARMENT_COUNTRIES,
              fields: fieldsFor(template),
              customizationGroups: customizationGroupsFor(template),
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
  customizationGroupsFor,
  provisionStarterGarments,
};
