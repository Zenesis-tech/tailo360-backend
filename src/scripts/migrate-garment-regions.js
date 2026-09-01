require("dotenv").config();
const mongoose = require("mongoose");
const { connectDatabase } = require("../config/db");
const { GarmentTemplate } = require("../models");
const {
  SUPPORTED_GARMENT_COUNTRIES,
} = require("../services/garment-region.service");

async function run() {
  await connectDatabase();
  const collection = GarmentTemplate.collection;
  const result = await GarmentTemplate.updateMany(
    {
      scope: "global",
      $or: [
        { countries: { $exists: false } },
        { countries: { $size: 0 } },
      ],
    },
    { $set: { countries: SUPPORTED_GARMENT_COUNTRIES } },
  );

  const indexes = await collection.indexes();
  const legacy = indexes.find(
    (index) => index.name === "scope_1_studioId_1_name_1",
  );
  if (legacy) await collection.dropIndex(legacy.name);

  await collection.createIndex(
    { studioId: 1, name: 1 },
    {
      name: "studioId_1_name_1",
      unique: true,
      partialFilterExpression: { scope: "studio" },
    },
  );
  await collection.createIndex(
    { name: 1, countries: 1 },
    {
      name: "name_1_countries_1",
      unique: true,
      partialFilterExpression: { scope: "global" },
    },
  );
  console.log(
    `Garment regions ready: ${result.modifiedCount} legacy global template(s) made available in all supported countries.`,
  );
}

run()
  .catch((error) => {
    console.error("Garment region migration failed", error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
