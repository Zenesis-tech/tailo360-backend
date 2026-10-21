const mongoose = require("mongoose");
const { connectDatabase } = require("../config/db");
const { Studio, GarmentTemplate } = require("../models");
const { regionalProfile } = require("../utils/region-profile");
const { SUPPORTED_GARMENT_COUNTRIES } = require("../services/garment-region.service");
const realtimeEvents = require("../services/realtime-events.service");

async function migrateOwnerStudioRegions({ apply = false } = {}) {
  const studios = await Studio.find().populate("ownerUserId", "country");
  const mismatches = studios.filter((studio) => {
    const ownerCountry = studio.ownerUserId?.country;
    return SUPPORTED_GARMENT_COUNTRIES.includes(ownerCountry) &&
      studio.settings?.country !== ownerCountry;
  });
  const changes = mismatches.map((studio) => ({
    studioId: studio.id,
    from: studio.settings.country,
    to: studio.ownerUserId.country,
  }));
  if (apply) {
    for (const studio of mismatches) {
      await GarmentTemplate.updateMany(
        { studioId: studio._id, scope: { $ne: "global" }, region: null },
        { $set: { region: studio.settings.country || "IN" } },
      );
      Object.assign(studio.settings, regionalProfile({ country: studio.ownerUserId.country }));
      await studio.save();
      await realtimeEvents.publish(studio._id, {
        resource: "studio",
        action: "updated",
        id: studio.id,
        data: studio,
      });
    }
  }
  return {
    mismatches: changes,
    updated: apply ? mismatches.length : 0,
  };
}

if (require.main === module) {
  (async () => {
    await connectDatabase();
    const apply = process.argv.includes("--apply");
    const result = await migrateOwnerStudioRegions({ apply });
    console.log(JSON.stringify(result, null, 2));
    if (!apply) console.log("Run with --apply to update these studios.");
  })()
    .catch((error) => {
      console.error("Owner studio region migration failed:", error);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = { migrateOwnerStudioRegions };
