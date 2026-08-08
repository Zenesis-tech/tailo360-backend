const env = require("../config/env");
const { AppError } = require("../utils/errors");

function configured() {
  return Boolean(
    env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_VERIFY_SERVICE_SID,
  );
}

function endpoint(resource) {
  return `https://verify.twilio.com/v2/Services/${encodeURIComponent(env.TWILIO_VERIFY_SERVICE_SID)}/${resource}`;
}

function authorization() {
  return `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}`;
}

async function request(path, values) {
  let response;
  try {
    response = await fetch(endpoint(path ? "VerificationCheck" : "Verifications"), {
      method: "POST",
      headers: {
        Authorization: authorization(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(values),
    });
  } catch (error) {
    console.error("Twilio Verify request failed before receiving a response", {
      operation: path ? "verify_otp" : "send_otp",
      reason: error?.cause?.code || error?.name || "network_error",
    });
    throw new AppError(
      502,
      "SMS_PROVIDER_UNAVAILABLE",
      "Twilio Verify is currently unreachable. Please try again.",
    );
  }
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function deliveryFailure(data, status) {
  const providerCode = data?.code ? String(data.code) : undefined;
  const messages = {
    "60605":
      "SMS delivery to this country is disabled in Twilio Verify Geo Permissions.",
    "60412": "Twilio Fraud Guard blocked this verification attempt.",
    "60203": "Too many OTP send attempts were made. Please try again later.",
    "60223":
      "SMS delivery is disabled for this Twilio Verify Service. Enable the SMS channel in Twilio Console.",
    "60624": "The Twilio trial account has reached its verification limit.",
    "21608":
      "This phone number must be verified in Twilio before a trial account can send to it.",
  };

  console.error("Twilio Verify rejected an OTP request", {
    httpStatus: status,
    providerCode,
    providerMessage: data?.message,
    moreInfo: data?.more_info,
  });

  return new AppError(
    502,
    "SMS_DELIVERY_FAILED",
    messages[providerCode] ||
      `Twilio could not send the OTP${providerCode ? ` (provider code ${providerCode})` : ""}.`,
    providerCode ? { provider: "twilio", providerCode } : { provider: "twilio" },
  );
}

async function sendOtp(phone) {
  if (!configured())
    throw new AppError(
      503,
      "SMS_NOT_CONFIGURED",
      "Twilio Verify OTP delivery is not configured.",
    );
  const { response, data } = await request("", { To: phone, Channel: "sms" });
  if (!response.ok || data.status !== "pending")
    throw deliveryFailure(data, response.status);
  return data;
}

async function verifyOtp(phone, otp) {
  if (!configured())
    throw new AppError(
      503,
      "SMS_NOT_CONFIGURED",
      "Twilio Verify OTP verification is not configured.",
    );
  const { response, data } = await request("/VerificationCheck", {
    To: phone,
    Code: otp,
  });
  return response.ok && data.status === "approved";
}

module.exports = { configured, sendOtp, verifyOtp };
