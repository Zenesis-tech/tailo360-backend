const SUPPORTED_GARMENT_COUNTRIES = ["IN", "US", "CA", "GB", "AU"];

function studioCountry(studio, user) {
  const country = studio?.settings?.country || user?.country || "IN";
  return SUPPORTED_GARMENT_COUNTRIES.includes(country) ? country : "IN";
}

// Templates created before regional catalogues did not have `countries`.
// Treat missing/empty values as worldwide until the migration backfills them.
function globalTemplateCountryFilter(country) {
  return {
    scope: "global",
    $or: [
      { countries: country },
      { countries: { $exists: false } },
      { countries: { $size: 0 } },
    ],
  };
}

function visibleTemplateFilter(studioId, country) {
  return {
    $or: [
      globalTemplateCountryFilter(country),
      { studioId, scope: { $ne: "global" } },
    ],
  };
}

module.exports = {
  SUPPORTED_GARMENT_COUNTRIES,
  studioCountry,
  globalTemplateCountryFilter,
  visibleTemplateFilter,
};
