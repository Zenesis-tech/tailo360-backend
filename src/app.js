const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const env = require("./config/env");
const routes = require("./routes");
const { errorHandler, notFoundHandler } = require("./middleware/errors");
const realtimeEvents = require('./services/realtime-events.service');
const { AppError } = require('./utils/errors');
const { safeError } = require('./utils/logging');
const { connectDatabase, databaseStatus } = require('./config/db');
const { requestLocale } = require('./middleware/locale');
const { startJobs } = require('./jobs');
const app = express();
// Some managed hosts import the Express app instead of executing server.js.
// Start the shared connection and recurring jobs in both modes. Both startup
// functions are idempotent, so server.js can safely use them as well.
connectDatabase()
  .then(() => {
    if (env.NODE_ENV !== 'test') startJobs();
  })
  .catch((error) => {
    console.error("Initial MongoDB connection failed", safeError(error));
  });
// Hostinger terminates HTTPS in front of Node and forwards the client address.
// Trust the nearest proxy so rate limiting keys requests by the real client IP.
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
});
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        env.ALLOWED_ORIGINS.length === 0 ||
        env.ALLOWED_ORIGINS.includes(origin)
      )
        return callback(null, true);
      return callback(
        new AppError(403, "CORS_NOT_ALLOWED", "Origin is not allowed by CORS."),
      );
    },
    credentials: false,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(requestLocale);
app.use(
  "/api/v1/auth/otp/request",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => env.NODE_ENV === "test",
    message: {
      error: {
        code: "RATE_LIMITED",
        message: "Too many OTP attempts. Please try again later.",
      },
    },
  }),
);
app.use(
  "/api/v1/auth/otp/verify",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => env.NODE_ENV === "test",
    message: {
      error: {
        code: "RATE_LIMITED",
        message: "Too many OTP verification attempts. Please request a new code later.",
      },
    },
  }),
);
app.use(
  "/api/v1/auth/firebase/phone",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => env.NODE_ENV === "test",
    message: {
      error: {
        code: "RATE_LIMITED",
        message: "Too many phone verification attempts. Please try again later.",
      },
    },
  }),
);
app.use(
  "/api/v1/auth/admin/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => env.NODE_ENV === "test",
    message: { error: { code: "RATE_LIMITED", message: "Too many sign-in attempts. Please try again later." } },
  }),
);
app.get("/health", (req, res) => {
  const database = databaseStatus();
  res.json({ data: { status: "ok", database } });
});
app.get("/ready", (req, res) => {
  const database = databaseStatus();
  if (!database.ready) {
    return res.status(503).json({
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "The database connection is not ready.",
        requestId: req.id,
      },
      data: { database },
    });
  }
  return res.json({ data: { status: "ready", database } });
});
app.use("/api/v1", (req, res, next) => {
  if (databaseStatus().ready) return next();
  return connectDatabase().then(() => next()).catch(next);
});
const realtimeExcludedResources = new Set(["auth", "devices", "media", "admin"]);

function realtimeDescriptor(req, responseBody, statusCode) {
  const parts = req.path.split("/").filter(Boolean);
  let resource = parts[0] || "data";
  if (resource === "customers" && parts.includes("measurements")) resource = "measurements";
  if (resource === "orders" && parts.includes("invoice")) return null;
  if (realtimeExcludedResources.has(resource)) return null;
  let action = req.method === "DELETE" || statusCode === 204 ? "deleted" : "updated";
  if (req.method === "POST" && parts.length === 1) action = "created";
  if (resource === "payments") action = "created";
  const data = responseBody?.data ?? null;
  return {
    resource,
    action,
    id: data?._id || data?.id || req.params?.id || req.params?.templateId || parts[1],
    data: data || (action === "deleted" ? { _id: req.params?.id || parts[1], deletedAt: new Date().toISOString() } : null),
    requestId: req.id,
  };
}

app.use("/api/v1", (req, res, next) => {
  let responseBody;
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    responseBody = body;
    return sendJson(body);
  };
  res.on("finish", () => {
    if (!req.auth?.studio?._id || ["GET", "HEAD", "OPTIONS"].includes(req.method) || res.statusCode < 200 || res.statusCode >= 300) return;
    const descriptor = realtimeDescriptor(req, responseBody, res.statusCode);
    if (!descriptor) return;
    const options = descriptor.resource === "notifications"
      ? { userIds: [req.auth.user._id] }
      : undefined;
    realtimeEvents.publish(req.auth.studio._id, descriptor, options).catch((error) => {
      console.error("Realtime event could not be persisted", safeError(error));
    });
  });
  next();
}, routes);
app.use(notFoundHandler);
app.use(errorHandler);
module.exports = app;
