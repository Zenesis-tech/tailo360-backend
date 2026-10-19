const { GoogleAuth } = require("google-auth-library");
const env = require("../config/env");

const DISPLAY_COUNTRIES = ["IN", "US", "CA", "GB", "AU"];
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = null;

function billingDuration(basePlan) {
  return (
    basePlan.autoRenewingBasePlanType?.billingPeriodDuration ||
    basePlan.prepaidBasePlanType?.billingPeriodDuration ||
    basePlan.installmentsBasePlanType?.billingPeriodDuration ||
    ""
  );
}

function summarizeSubscription(subscription) {
  return {
    productId: subscription.productId,
    basePlans: (subscription.basePlans || []).map((basePlan) => ({
      basePlanId: basePlan.basePlanId,
      state: basePlan.state,
      billingPeriodDuration: billingDuration(basePlan),
      regions: (basePlan.regionalConfigs || [])
        .filter((region) => DISPLAY_COUNTRIES.includes(region.regionCode))
        .map((region) => ({
          country: region.regionCode,
          available: region.newSubscriberAvailability === true,
          currencyCode: region.price?.currencyCode || "",
          units: String(region.price?.units || "0"),
          nanos: Number(region.price?.nanos || 0),
        })),
    })),
  };
}

function configuredProductIds(plans) {
  return [
    ...new Set(
      plans
        .flatMap((plan) => plan.storeProducts || [])
        .filter(
          (product) =>
            product.platform === "google" && product.active !== false,
        )
        .map((product) => product.productId)
        .filter(Boolean),
    ),
  ].sort();
}

async function fetchSubscription(token, productId) {
  const url =
    "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" +
    `${encodeURIComponent(env.GOOGLE_PLAY_PACKAGE_NAME)}/subscriptions/` +
    encodeURIComponent(productId);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    return {
      productId,
      error: {
        code: "GOOGLE_PLAY_PRODUCT_UNAVAILABLE",
        message: `Google Play could not read ${productId} (HTTP ${response.status}).`,
      },
    };
  }
  return summarizeSubscription(await response.json());
}

async function googlePlayRegionalCatalog(plans, { force = false } = {}) {
  const productIds = configuredProductIds(plans);
  if (!env.GOOGLE_PLAY_PACKAGE_NAME || !env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return {
      status: "not_configured",
      message:
        "Set GOOGLE_PLAY_PACKAGE_NAME and GOOGLE_SERVICE_ACCOUNT_JSON to load Play Console prices.",
      products: [],
    };
  }
  if (!productIds.length) {
    return {
      status: "no_products",
      message: "Add at least one Google Play product ID to a subscription plan.",
      products: [],
    };
  }
  const key = `${env.GOOGLE_PLAY_PACKAGE_NAME}:${productIds.join(",")}`;
  if (!force && cache?.key === key && cache.expiresAt > Date.now()) {
    return cache.value;
  }

  let credentials;
  try {
    credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } catch (_) {
    return {
      status: "invalid_configuration",
      message: "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.",
      products: [],
    };
  }

  try {
    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/androidpublisher"],
    });
    const token = await auth.getAccessToken();
    const products = await Promise.all(
      productIds.map((productId) => fetchSubscription(token, productId)),
    );
    const failed = products.filter((product) => product.error).length;
    const value = {
      status: failed === products.length ? "error" : failed ? "partial" : "ready",
      message: failed
        ? `${failed} of ${products.length} Google Play products could not be loaded.`
        : "Prices loaded from Google Play Console.",
      syncedAt: new Date().toISOString(),
      products,
    };
    cache = { key, expiresAt: Date.now() + CACHE_TTL_MS, value };
    return value;
  } catch (_) {
    return {
      status: "error",
      message:
        "Google Play pricing could not be loaded. Check the service-account app permissions.",
      products: [],
    };
  }
}

function clearGooglePlayCatalogCache() {
  cache = null;
}

module.exports = {
  DISPLAY_COUNTRIES,
  summarizeSubscription,
  googlePlayRegionalCatalog,
  clearGooglePlayCatalogCache,
};
