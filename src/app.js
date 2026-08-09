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
const app = express();
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
app.get("/health", (req, res) => res.json({ data: { status: "ok" } }));
app.use('/api/v1', (req, res, next) => {
  res.on('finish', () => {
    if (
      req.auth?.studio?._id &&
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      res.statusCode >= 200 &&
      res.statusCode < 300
    ) {
      realtimeEvents.publish(req.auth.studio._id, {
        method: req.method,
        resource: req.path.split('/').filter(Boolean)[0] || 'data',
      });
    }
  });
  next();
}, routes);
app.use(notFoundHandler);
app.use(errorHandler);
module.exports = app;
