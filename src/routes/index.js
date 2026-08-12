const express = require("express");
const env = require("../config/env");
// Express 4 does not forward rejected promises to error middleware. Wrap every
// controller once here so validation and database failures always become the
// API's standard JSON error response.
const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);
const wrapController = (controller) =>
  Object.fromEntries(
    Object.entries(controller).map(([name, handler]) => [name, asyncRoute(handler)]),
  );
const auth = wrapController(require("../controllers/auth.controller"));
const customers = wrapController(require("../controllers/customer.controller"));
const templates = wrapController(require("../controllers/template.controller"));
const orderController = require("../controllers/order.controller");
const realtimeEvents = require('../services/realtime-events.service');
const orders = wrapController(orderController);
const operationsController = require("../controllers/operations.controller");
const ops = wrapController(operationsController);
const media = wrapController(require("../controllers/media.controller"));
const invoices = wrapController(require("../controllers/invoice.controller"));
const notifications = wrapController(require("../controllers/notification.controller"));
const webhooks = wrapController(require("../controllers/store-webhook.controller"));
const sync = wrapController(require("../controllers/sync.controller"));
const subscriptionController = require("../controllers/subscription.controller");
const subscriptions = wrapController(subscriptionController);
const admin = wrapController(require("../controllers/admin.controller"));
const authMiddleware = require("../middleware/auth");
const authenticate = authMiddleware.authenticate;
const authorize = authMiddleware.authorize;
const requireWritableSubscription = asyncRoute(authMiddleware.requireWritableSubscription);
const requirePlatformAdmin = authMiddleware.requirePlatformAdmin;
const { idempotent } = require("../middleware/idempotency");
const router = express.Router();
router.post("/auth/otp/request", auth.requestOtp);
router.post("/auth/otp/verify", auth.verifyOtp);
router.post("/auth/google", auth.google);
router.post("/auth/admin/login", auth.adminLogin);
router.post("/auth/refresh", auth.refresh);
router.post("/auth/logout", auth.logout);
router.get("/auth/me", authenticate, auth.me);
router.get('/events', authenticate, (req, res) => {
  realtimeEvents.connect(req.auth.studio._id, res);
});
router.get("/dashboard", authenticate, ops.dashboard);
router.get("/calendar", authenticate, ops.schedule);
router.post("/devices", authenticate, notifications.register);
router.delete("/devices", authenticate, notifications.unregister);
router.get("/notifications", authenticate, notifications.list);
router.get("/notifications/unread-count", authenticate, notifications.unreadCount);
router.patch("/notifications/:id/read", authenticate, notifications.markRead);
router.post("/notifications/read-all", authenticate, notifications.markAllRead);
router.get("/sync/changes", authenticate, sync.changes);
router.get("/reports", authenticate, ops.reports);
router.get("/studio", authenticate, ops.studio);
router.patch(
  "/studio",
  authenticate,
  authorize("settings:write"),
  requireWritableSubscription,
  ops.updateStudio,
);
router.get(
  "/studio/members",
  authenticate,
  authorize("staff:read"),
  ops.members,
);
router.get(
  "/customers",
  authenticate,
  authorize("customers:read"),
  customers.list,
);
router.post(
  "/customers",
  authenticate,
  authorize("customers:write"),
  requireWritableSubscription,
  customers.create,
);
router.get(
  "/customers/:id",
  authenticate,
  authorize("customers:read"),
  customers.get,
);
router.patch(
  "/customers/:id",
  authenticate,
  authorize("customers:write"),
  requireWritableSubscription,
  customers.update,
);
router.delete(
  "/customers/:id",
  authenticate,
  authorize("customers:write"),
  requireWritableSubscription,
  customers.remove,
);
router.get(
  "/customers/:id/measurements/:templateId?",
  authenticate,
  authorize("customers:read"),
  customers.measurements,
);
router.put(
  "/customers/:id/measurements/:templateId",
  authenticate,
  authorize("customers:write"),
  requireWritableSubscription,
  customers.saveMeasurements,
);
router.get(
  "/garment-templates",
  authenticate,
  authorize("templates:read"),
  templates.list,
);
router.post(
  "/garment-templates",
  authenticate,
  authorize("templates:write"),
  requireWritableSubscription,
  templates.create,
);
router.patch(
  "/garment-templates/:id",
  authenticate,
  authorize("templates:write"),
  requireWritableSubscription,
  templates.update,
);
router.post(
  "/garment-templates/clone",
  authenticate,
  authorize("templates:write"),
  requireWritableSubscription,
  templates.clone,
);
router.delete(
  "/garment-templates/:id",
  authenticate,
  authorize("templates:write"),
  requireWritableSubscription,
  templates.remove,
);
router.get(
  "/pricing",
  authenticate,
  authorize("templates:read"),
  templates.prices,
);
router.put(
  "/pricing/:templateId",
  authenticate,
  authorize("templates:write"),
  requireWritableSubscription,
  templates.setPrice,
);
router.get("/orders", authenticate, authorize("orders:read"), orders.list);
router.post(
  "/orders",
  authenticate,
  authorize("orders:write"),
  requireWritableSubscription,
  asyncRoute(idempotent(orderController.create)),
);
router.get("/orders/:id", authenticate, authorize("orders:read"), orders.get);
router.patch(
  "/orders/:id",
  authenticate,
  authorize("orders:write"),
  requireWritableSubscription,
  orders.update,
);
router.post(
  "/orders/:id/status",
  authenticate,
  authorize("orders:status"),
  requireWritableSubscription,
  orders.changeStatus,
);
router.post(
  "/orders/:id/cancel",
  authenticate,
  authorize("orders:write"),
  requireWritableSubscription,
  orders.cancel,
);
router.post(
  "/orders/:id/handover",
  authenticate,
  authorize("orders:status"),
  requireWritableSubscription,
  orders.handover,
);
router.get(
  "/orders/:id/activity",
  authenticate,
  authorize("orders:read"),
  orders.activity,
);
router.get(
  "/orders/:id/invoice",
  authenticate,
  authorize("orders:read"),
  invoices.invoice,
);
router.post(
  "/orders/:id/invoice/share",
  authenticate,
  authorize("orders:read"),
  invoices.share,
);
router.post(
  "/payments",
  authenticate,
  authorize("payments:write"),
  requireWritableSubscription,
  asyncRoute(idempotent(operationsController.recordPayment)),
);
router.get(
  "/payments/due",
  authenticate,
  authorize("payments:read"),
  ops.duePayments,
);
router.get("/referral", authenticate, ops.referral);
router.post("/referral/redeem", authenticate, ops.redeemReferral);
router.post("/media/upload-url", authenticate, requireWritableSubscription, media.createUpload);
router.post("/media/:id/complete", authenticate, requireWritableSubscription, media.completeUpload);
router.get("/media/:id/url", authenticate, media.readUrl);
router.get("/subscription", authenticate, subscriptions.get);
router.get("/subscription/usage", authenticate, subscriptions.usage);
router.get("/subscription/plans", authenticate, subscriptions.plans);
router.get("/subscription/products", authenticate, subscriptions.products);
router.post(
  "/subscription/validate-purchase",
  authenticate,
  asyncRoute(idempotent(subscriptionController.validatePurchase)),
);
router.post("/subscription/webhooks/google", webhooks.google);
router.post("/subscription/webhooks/apple", webhooks.apple);
router.get(
  "/admin/subscription-plans",
  authenticate,
  requirePlatformAdmin,
  subscriptions.adminListPlans,
);
router.post(
  "/admin/subscription-plans",
  authenticate,
  requirePlatformAdmin,
  subscriptions.adminCreatePlan,
);
router.patch(
  "/admin/subscription-plans/:id",
  authenticate,
  requirePlatformAdmin,
  subscriptions.adminUpdatePlan,
);
router.get(
  "/admin/referral-reward-configs",
  authenticate,
  requirePlatformAdmin,
  ops.adminReferralConfigs,
);
router.post(
  "/admin/referral-reward-configs",
  authenticate,
  requirePlatformAdmin,
  ops.adminCreateReferralConfig,
);
router.get("/admin/dashboard", authenticate, requirePlatformAdmin, admin.dashboard);
router.get("/admin/users", authenticate, requirePlatformAdmin, admin.users);
router.patch("/admin/users/:id", authenticate, requirePlatformAdmin, admin.updateUser);
router.put("/admin/users/:id/password", authenticate, requirePlatformAdmin, admin.resetUserPassword);
router.get("/admin/studios", authenticate, requirePlatformAdmin, admin.studios);
router.get("/admin/studios/:id", authenticate, requirePlatformAdmin, admin.studio);
router.get("/admin/subscriptions", authenticate, requirePlatformAdmin, admin.subscriptions);
router.patch("/admin/subscriptions/:id", authenticate, requirePlatformAdmin, admin.updateSubscription);
router.post("/admin/subscriptions/:id/test-grant", authenticate, requirePlatformAdmin, admin.grantTestSubscription);
router.get("/admin/orders", authenticate, requirePlatformAdmin, admin.orders);
router.get("/admin/orders/:id", authenticate, requirePlatformAdmin, admin.order);
router.get("/admin/customers", authenticate, requirePlatformAdmin, admin.customers);
router.get("/admin/garment-templates", authenticate, requirePlatformAdmin, admin.templates);
router.post("/admin/garment-templates", authenticate, requirePlatformAdmin, admin.createTemplate);
router.patch("/admin/garment-templates/:id", authenticate, requirePlatformAdmin, admin.updateTemplate);
router.delete("/admin/garment-templates/:id", authenticate, requirePlatformAdmin, admin.deleteTemplate);
router.put(
  "/admin/garment-templates/:id/diagram",
  authenticate,
  requirePlatformAdmin,
  express.raw({
    type: ["image/jpeg", "image/png", "image/webp"],
    limit: `${env.MAX_FILE_SIZE_MB}mb`,
  }),
  admin.uploadTemplateDiagram,
);
router.post("/admin/garment-templates/:id/diagram/upload-url", authenticate, requirePlatformAdmin, admin.createTemplateDiagramUpload);
router.post("/admin/garment-templates/:id/diagram/:mediaId/complete", authenticate, requirePlatformAdmin, admin.completeTemplateDiagramUpload);
router.delete("/admin/garment-templates/:id/diagram", authenticate, requirePlatformAdmin, admin.deleteTemplateDiagram);
router.put(
  "/admin/garment-templates/:id/icon",
  authenticate,
  requirePlatformAdmin,
  express.raw({
    type: ["image/jpeg", "image/png", "image/webp"],
    limit: `${env.MAX_FILE_SIZE_MB}mb`,
  }),
  admin.uploadTemplateIcon,
);
router.delete("/admin/garment-templates/:id/icon", authenticate, requirePlatformAdmin, admin.deleteTemplateIcon);
router.get("/admin/prices", authenticate, requirePlatformAdmin, admin.prices);
router.get("/admin/measurements", authenticate, requirePlatformAdmin, admin.measurements);
router.get("/admin/members", authenticate, requirePlatformAdmin, admin.members);
router.get("/admin/sessions", authenticate, requirePlatformAdmin, admin.sessions);
router.get("/admin/devices", authenticate, requirePlatformAdmin, admin.devices);
router.get("/admin/referrals", authenticate, requirePlatformAdmin, admin.referrals);
router.get("/admin/support-tickets", authenticate, requirePlatformAdmin, admin.tickets);
router.patch("/admin/support-tickets/:id", authenticate, requirePlatformAdmin, admin.updateTicket);
router.get("/admin/notifications", authenticate, requirePlatformAdmin, admin.notifications);
router.post("/admin/notifications/send", authenticate, requirePlatformAdmin, notifications.adminSend);
router.get("/admin/media", authenticate, requirePlatformAdmin, admin.media);
router.get("/admin/subscription-events", authenticate, requirePlatformAdmin, admin.subscriptionEvents);
router.get("/admin/audit", authenticate, requirePlatformAdmin, admin.audit);
router.get("/admin/config", authenticate, requirePlatformAdmin, admin.config);
router.put("/admin/config", authenticate, requirePlatformAdmin, admin.updateConfig);
module.exports = router;
