const mongoose = require("mongoose");
const { connectDatabase } = require("../config/db");
const { GarmentTemplate } = require("../models");
const {
  templateCatalog,
  starterCountriesFor,
} = require("../services/garment-catalog.service");
const { SUPPORTED_GARMENT_COUNTRIES } = require("../services/garment-region.service");

const indianStarters = Object.values(templateCatalog)
  .flat()
  .filter((template) => starterCountriesFor(template.name).length === 1);

function isUnchangedStarter(row, definition) {
  const fields = row.fields || [];
  const countries = row.countries || [];
  const worldwide = countries.length === 0 ||
    (countries.length === SUPPORTED_GARMENT_COUNTRIES.length &&
      SUPPORTED_GARMENT_COUNTRIES.every((code) => countries.includes(code)));
  return worldwide &&
    fields.length === definition.fields.length &&
    fields.every((field, index) => field.name === definition.fields[index]);
}

async function migrateStarterGarmentCountries({ apply = false } = {}) {
  const rows = await GarmentTemplate.find({
    scope: "global",
    studioId: null,
    name: { $in: indianStarters.map((template) => template.name) },
  });
  const matches = rows.filter((row) => {
    const definition = indianStarters.find((template) => template.name === row.name);
    return definition && isUnchangedStarter(row, definition);
  });
  if (apply) {
    for (const row of matches) {
      row.countries = ["IN"];
      await row.save();
    }
  }
  return { matched: matches.map((row) => row.name), updated: apply ? matches.length : 0 };
}

if (require.main === module) {
  (async () => {
    await connectDatabase();
    const result = await migrateStarterGarmentCountries({
      apply: process.argv.includes("--apply"),
    });
    console.log(`${result.updated ? "Updated" : "Found"} ${result.matched.length} Indian starter templates: ${result.matched.join(", ")}`);
    if (!process.argv.includes("--apply")) console.log("Run with --apply to update them.");
  })()
    .catch((error) => {
      console.error("Starter garment country migration failed:", error);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = { migrateStarterGarmentCountries };
