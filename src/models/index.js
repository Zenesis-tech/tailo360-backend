const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const base = {
  timestamps: true,
  versionKey: "version",
  optimisticConcurrency: true,
};

const userSchema = new Schema(
  {
    phone: { type: String, sparse: true, unique: true, index: true },
    name: String,
    email: { type: String, sparse: true, unique: true },
    googleSubject: { type: String, sparse: true, unique: true },
    passwordHash: { type: String, select: false },
    platformRole: {
      type: String,
      enum: ["user", "admin", "support"],
      default: "user",
    },
    language: { type: String, enum: ["en", "hi", "gu", "mr"], default: "en" },
    deletionRequestedAt: { type: Date, default: null },
    deletionScheduledFor: { type: Date, default: null },
    deletedAt: Date,
  },
  base,
);
const studioSchema = new Schema(
  {
    name: { type: String, required: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    address: { type: String, default: "" },
    businessType: {
      type: String,
      enum: ["tailoring", "boutique", "fashion_designer"],
      default: "tailoring",
    },
    services: {
      type: [{
        type: String,
        enum: [
          "mens_wear",
          "womens_wear",
          "kids_wear",
          "alteration",
          "blouse_stitching",
          "uniforms",
          "saree_stitching",
          "other",
        ],
      }],
      default: [],
    },
    logoMediaId: { type: Schema.Types.ObjectId, ref: "Media", default: null },
    onboardingCompletedAt: { type: Date, default: null },
    invoicePrefix: { type: String, default: "TL-" },
    referralCode: { type: String, required: true, unique: true },
    orderSequence: { type: Number, default: 0 },
    isDemoAccount: { type: Boolean, default: false, index: true },
    demoSeedVersion: { type: Number, default: 0 },
    settings: {
      measurementUnit: { type: String, enum: ["in", "cm"], default: "in" },
      precision: {
        type: String,
        enum: ["whole", "half", "quarter"],
        default: "half",
      },
      language: { type: String, default: "en" },
      currency: { type: String, default: "INR" },
      garmentAudiences: {
        type: [{ type: String, enum: ["men", "women", "kids", "unisex"] }],
        default: ["men", "women"],
      },
      deliveryDays: { type: Number, default: 7 },
      trialDays: { type: Number, default: 5 },
      skipSundays: { type: Boolean, default: false },
      notifications: {
        delivery: { type: Boolean, default: true },
        trial: { type: Boolean, default: true },
      },
      invoice: {
        footer: String,
        showGst: { type: Boolean, default: false },
        showMeasurements: { type: Boolean, default: false },
      },
    },
  },
  base,
);
const memberSchema = new Schema(
  {
    studioId: {
      type: Schema.Types.ObjectId,
      ref: "Studio",
      required: true,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    name: { type: String, trim: true, default: "" },
    phone: { type: String, required: true },
    role: {
      type: String,
      enum: ["owner", "master_tailor", "front_desk"],
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "limited", "paused", "invited", "expired", "removed"],
      default: "active",
    },
    inviteToken: { type: String, sparse: true, unique: true },
    expiresAt: Date,
    permissionsOverride: [String],
  },
  base,
);
memberSchema.index({ studioId: 1, phone: 1 }, { unique: true });
const otpSchema = new Schema(
  {
    phone: { type: String, index: true },
    codeHash: String,
    expiresAt: { type: Date, index: { expires: 0 } },
    attempts: { type: Number, default: 0 },
  },
  base,
);
const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    tokenId: { type: String, unique: true },
    expiresAt: { type: Date, index: { expires: 0 } },
    revokedAt: Date,
  },
  base,
);
const customerSchema = new Schema(
  {
    studioId: {
      type: Schema.Types.ObjectId,
      ref: "Studio",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true },
    address: String,
    gender: { type: String, enum: ["male", "female", "other"] },
    notes: String,
    fitPreference: { type: String, enum: ["slim", "regular", "relaxed"] },
    preferredContact: { type: String, enum: ["call", "whatsapp", "sms"] },
    deletedAt: Date,
  },
  base,
);
customerSchema.index({ studioId: 1, phone: 1 });
customerSchema.index({ studioId: 1, name: "text", phone: "text" });
const measurementSchema = new Schema(
  {
    studioId: { type: Schema.Types.ObjectId, required: true, index: true },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    templateId: {
      type: Schema.Types.ObjectId,
      ref: "GarmentTemplate",
      required: true,
    },
    version: Number,
    values: { type: Map, of: String },
    customizations: { type: Map, of: String },
    unit: { type: String, enum: ["in", "cm"], required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    restoredAt: Date,
    restoredBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  base,
);
measurementSchema.index(
  { customerId: 1, templateId: 1, version: -1 },
  { unique: true },
);
const templateSchema = new Schema(
  {
    studioId: {
      type: Schema.Types.ObjectId,
      ref: "Studio",
      default: null,
      index: true,
    },
    scope: {
      type: String,
      enum: ["global", "studio"],
      default: "studio",
      index: true,
    },
    name: { type: String, required: true },
    audience: {
      type: String,
      enum: ["men", "women", "kids", "unisex"],
      default: "unisex",
      index: true,
    },
    active: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
    garmentIconUrl: {
      type: String,
      trim: true,
      maxlength: 2048,
      default: "",
    },
    garmentIconMediaId: {
      type: Schema.Types.ObjectId,
      ref: "Media",
      default: null,
    },
    measurementDiagramUrl: {
      type: String,
      trim: true,
      maxlength: 2048,
      default: "",
    },
    measurementDiagramMediaId: {
      type: Schema.Types.ObjectId,
      ref: "Media",
      default: null,
    },
    fields: [
      {
        id: String,
        name: String,
        // The English name is the stable key saved with measurements. These
        // optional labels are purely for display in the selected app locale.
        localizedNames: {
          hi: { type: String, trim: true, maxlength: 60, default: "" },
          gu: { type: String, trim: true, maxlength: 60, default: "" },
          mr: { type: String, trim: true, maxlength: 60, default: "" },
        },
        iconKey: { type: String, trim: true, maxlength: 60, default: "" },
        iconUrl: { type: String, trim: true, maxlength: 2048, default: "" },
        iconMediaId: {
          type: Schema.Types.ObjectId,
          ref: "Media",
          default: null,
        },
        unit: { type: String, enum: ["in", "cm"] },
        required: { type: Boolean, default: false },
        active: { type: Boolean, default: true },
        position: Number,
      },
    ],
    customizationGroups: [
      {
        id: String,
        name: String,
        choices: [
          {
            id: String,
            name: String,
            active: { type: Boolean, default: true },
            position: Number,
          },
        ],
      },
    ],
  },
  base,
);
templateSchema.index({ scope: 1, studioId: 1, name: 1 }, { unique: true });
const priceSchema = new Schema(
  {
    studioId: { type: Schema.Types.ObjectId, required: true, index: true },
    templateId: {
      type: Schema.Types.ObjectId,
      ref: "GarmentTemplate",
      required: true,
    },
    amountPaise: { type: Number, min: 0 },
    currency: { type: String, default: "INR" },
    active: { type: Boolean, default: true },
    effectiveFrom: { type: Date, default: Date.now },
  },
  base,
);
priceSchema.index({ studioId: 1, templateId: 1, effectiveFrom: -1 });
const paymentSchema = new Schema(
  {
    amountPaise: Number,
    direction: { type: String, enum: ["collection", "refund"] },
    method: { type: String, enum: ["cash", "upi", "card", "bank"] },
    noteType: { type: String, enum: ["advance", "partial", "full", "refund"] },
    note: String,
    recordedBy: { type: Schema.Types.ObjectId, ref: "User" },
    recordedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);
const lineSchema = new Schema(
  {
    templateId: { type: Schema.Types.ObjectId, ref: "GarmentTemplate" },
    name: String,
    quantity: Number,
    unitPricePaise: Number,
    lineTotalPaise: Number,
    measurements: { type: Map, of: String },
    customizations: { type: Map, of: String },
    measurementSource: { type: String, enum: ["saved", "adjusted", "fresh"] },
    fabricMedia: [String],
    sampleMedia: String,
  },
  { _id: true },
);
const orderSchema = new Schema(
  {
    studioId: {
      type: Schema.Types.ObjectId,
      ref: "Studio",
      required: true,
      index: true,
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    code: String,
    status: {
      type: String,
      enum: [
        "pending",
        "measurements_pending",
        "cutting",
        "stitching",
        "trial",
        "alteration",
        "ready",
        "delivered",
        "cancelled",
      ],
      default: "pending",
    },
    orderDate: Date,
    reminderDate: Date,
    trialDate: Date,
    deliveryDate: { type: Date, required: true },
    priority: {
      type: String,
      enum: ["normal", "high", "urgent"],
      default: "normal",
    },
    notes: String,
    voiceMedia: String,
    referenceMedia: [String],
    lines: [lineSchema],
    totalPaise: Number,
    payments: [paymentSchema],
    activity: [
      {
        type: { type: String },
        fromStatus: String,
        toStatus: String,
        note: String,
        actorId: Schema.Types.ObjectId,
        at: { type: Date, default: Date.now },
      },
    ],
    cancelledReason: String,
    deletedAt: Date,
  },
  base,
);
orderSchema.index({ studioId: 1, code: 1 }, { unique: true });
orderSchema.index({ studioId: 1, status: 1, deliveryDate: 1 });
const subscriptionSchema = new Schema(
  {
    studioId: { type: Schema.Types.ObjectId, ref: "Studio", unique: true },
    plan: {
      type: String,
      enum: ["starter", "pro", "studio"],
      default: "starter",
    },
    status: {
      type: String,
      enum: [
        "trial",
        "active",
        "grace_period",
        "expired",
        "restricted",
        "cancelled",
      ],
      default: "trial",
    },
    platform: { type: String, enum: ["google", "apple"] },
    entitlementSource: {
      type: String,
      enum: ["trial", "store", "admin_test", "promotion"],
    },
    adminGrant: {
      grantedBy: { type: Schema.Types.ObjectId, ref: "User" },
      grantedAt: Date,
      note: String,
    },
    productId: String,
    originalTransactionId: String,
    trialEndsAt: Date,
    periodEndsAt: Date,
    seatLimit: { type: Number, default: 2 },
    referralCreditPaise: { type: Number, default: 0, min: 0 },
    promotion: {
      offerId: { type: Schema.Types.ObjectId, ref: "SubscriptionOffer" },
      code: String,
      title: String,
      redeemedAt: Date,
    },
    lastVerifiedAt: Date,
  },
  base,
);
const subscriptionPlanSchema = new Schema(
  {
    code: {
      type: String,
      enum: ["starter", "pro", "studio"],
      required: true,
      unique: true,
    },
    name: { type: String, required: true },
    description: String,
    active: { type: Boolean, default: true },
    trialDays: { type: Number, required: true, min: 0, max: 90, default: 14 },
    monthlyPricePaise: { type: Number, required: true, min: 0 },
    yearlyPricePaise: { type: Number, required: true, min: 0 },
    limits: {
      customers: { type: Number, default: -1 },
      ordersPerMonth: { type: Number, default: -1 },
      staffSeats: { type: Number, required: true, min: 1 },
    },
    features: [String],
    storeProducts: [
      {
        platform: { type: String, enum: ["google", "apple"], required: true },
        productId: { type: String, required: true },
        period: { type: String, enum: ["monthly", "yearly"], required: true },
        active: { type: Boolean, default: true },
      },
    ],
    // Kept for validating renewals/webhooks from retired products. These are
    // deliberately not returned by the purchasable-products endpoint.
    legacyStoreProducts: [
      {
        platform: { type: String, enum: ["google", "apple"], required: true },
        productId: { type: String, required: true },
        period: { type: String, enum: ["monthly", "yearly"], required: true },
      },
    ],
  },
  base,
);
const subscriptionOfferSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      match: /^[A-Z0-9_-]{3,40}$/,
    },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 300 },
    active: { type: Boolean, default: true },
    priority: { type: Number, default: 0, min: 0, max: 1000 },
    // An offer always provides free access for this number of days. It can
    // start as a trial or as an active entitlement on the selected plan.
    benefit: {
      type: {
        type: String,
        enum: ["trial_days", "plan_access_days"],
        default: "trial_days",
      },
      durationDays: { type: Number, required: true, min: 1, max: 365 },
      plan: { type: String, enum: ["starter", "studio"], default: "starter" },
    },
    eligibility: {
      audience: {
        type: String,
        enum: ["new_studios"],
        default: "new_studios",
      },
      // 0 means unlimited. A positive number is reserved atomically at signup.
      maxRedemptions: { type: Number, default: 0, min: 0, max: 10000000 },
      startsAt: Date,
      endsAt: Date,
    },
    redemptionCount: { type: Number, default: 0, min: 0 },
  },
  base,
);
subscriptionOfferSchema.index({ active: 1, "eligibility.startsAt": 1, "eligibility.endsAt": 1 });
const referralSchema = new Schema(
  {
    referrerStudioId: {
      type: Schema.Types.ObjectId,
      ref: "Studio",
      index: true,
    },
    refereeStudioId: {
      type: Schema.Types.ObjectId,
      ref: "Studio",
      unique: true,
    },
    code: String,
    status: {
      type: String,
      enum: ["pending", "rewarded", "expired_void"],
      default: "pending",
    },
    configVersion: Number,
    qualifyingCondition: {
      type: String,
      enum: ["signup_complete", "first_paid_subscription"],
      default: "first_paid_subscription",
    },
    reward: {
      type: {
        type: String,
        enum: ["trial_extension_days", "account_credit"],
        default: "trial_extension_days",
      },
      value: { type: Number, default: 7 },
    },
    expiresAt: Date,
    rewardedAt: Date,
  },
  base,
);
const referralRewardConfigSchema = new Schema(
  {
    version: { type: Number, required: true, unique: true },
    active: { type: Boolean, default: true },
    qualifyingCondition: {
      type: String,
      enum: ["signup_complete", "first_paid_subscription"],
      required: true,
    },
    reward: {
      type: {
        type: String,
        enum: ["trial_extension_days", "account_credit"],
        required: true,
      },
      value: { type: Number, required: true, min: 1 },
    },
    expiryDays: { type: Number, required: true, min: 1, max: 365, default: 90 },
  },
  base,
);
const idempotencySchema = new Schema(
  {
    studioId: { type: Schema.Types.ObjectId, index: true },
    key: String,
    status: Number,
    body: Schema.Types.Mixed,
    expiresAt: { type: Date, index: { expires: 0 } },
  },
  base,
);
idempotencySchema.index({ studioId: 1, key: 1 }, { unique: true });
const mediaSchema = new Schema(
  {
    studioId: {
      type: Schema.Types.ObjectId,
      ref: "Studio",
      required: false,
      index: true,
    },
    ownerUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    objectKey: { type: String, required: true, unique: true },
    originalName: { type: String, required: true },
    contentType: { type: String, required: true },
    sizeBytes: Number,
    purpose: {
      type: String,
      enum: [
        "fabric_photo",
        "sample_image",
        "voice_note",
        "reference_image",
        "studio_logo",
        "invoice_pdf",
        "support_attachment",
      ],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "ready", "deleted"],
      default: "pending",
    },
  },
  base,
);
const subscriptionEventSchema = new Schema(
  {
    studioId: {
      type: Schema.Types.ObjectId,
      ref: "Studio",
      required: true,
      index: true,
    },
    platform: { type: String, enum: ["google", "apple"], required: true },
    transactionId: { type: String, required: true },
    originalTransactionId: String,
    productId: String,
    raw: Schema.Types.Mixed,
    verifiedAt: { type: Date, default: Date.now },
  },
  base,
);
subscriptionEventSchema.index(
  { platform: 1, transactionId: 1 },
  { unique: true },
);
const deviceSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    studioId: {
      type: Schema.Types.ObjectId,
      ref: "Studio",
      required: true,
      index: true,
    },
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: ["android", "ios"], required: true },
    active: { type: Boolean, default: true },
    appVersion: String,
    locale: String,
    lastSeenAt: { type: Date, default: Date.now, index: true },
    disabledAt: Date,
    disabledReason: String,
  },
  base,
);
const notificationSchema = new Schema(
  {
    studioId: {
      type: Schema.Types.ObjectId,
      ref: "Studio",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
    },
    type: String,
    title: String,
    body: String,
    data: Schema.Types.Mixed,
    source: {
      type: String,
      enum: ["workflow", "reminder", "admin", "system"],
      default: "workflow",
    },
    dedupeKey: { type: String, sparse: true },
    readAt: Date,
    status: {
      type: String,
      enum: ["queued", "sent", "partial", "failed", "stored"],
      default: "queued",
    },
    deliveredCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    sentAt: Date,
    // A queued reminder is visible in the in-app notification queue before
    // it is delivered. The reminder job changes it to sent/stored at this
    // time instead of creating an unrelated second notification.
    scheduledFor: { type: Date, index: true },
    error: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  base,
);
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index(
  { studioId: 1, userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } },
);
const supportSchema = new Schema(
  {
    studioId: {
      type: Schema.Types.ObjectId,
      ref: "Studio",
      required: true,
      index: true,
    },
    subject: String,
    category: String,
    status: {
      type: String,
      enum: ["open", "in_progress", "resolved", "closed"],
      default: "open",
    },
    messages: [
      {
        body: String,
        attachments: [String],
        authorId: Schema.Types.ObjectId,
        createdAt: { type: Date, default: Date.now },
      },
    ],
    assignedTo: Schema.Types.ObjectId,
  },
  base,
);
const appConfigSchema = new Schema(
  {
    key: { type: String, unique: true },
    maintenance: { type: Boolean, default: false },
    minimumAndroidVersion: String,
    minimumIosVersion: String,
    featureFlags: { type: Map, of: Boolean },
    support: {
      whatsappNumber: String,
      deliveryMode: {
        type: String,
        enum: ["ticket", "whatsapp", "both"],
        default: "ticket",
      },
    },
  },
  base,
);
const realtimeEventSchema = new Schema(
  {
    studioId: { type: Schema.Types.ObjectId, required: true, index: true },
    userIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    resource: { type: String, required: true, index: true },
    action: { type: String, required: true },
    entityId: String,
    data: Schema.Types.Mixed,
    requestId: String,
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  base,
);
realtimeEventSchema.index({ studioId: 1, _id: 1 });
// Administrative history is intentionally separate from application activity.  It
// records privileged changes without retaining credentials, tokens, or raw
// request bodies.
const auditLogSchema = new Schema(
  {
    actorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    action: { type: String, required: true, index: true },
    targetType: { type: String, required: true, index: true },
    targetId: { type: String, required: true, index: true },
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    requestId: String,
    ip: String,
  },
  base,
);
auditLogSchema.index({ createdAt: -1 });
const backupRecordSchema = new Schema(
  {
    reason: { type: String, enum: ["scheduled", "manual"], required: true },
    status: { type: String, enum: ["running", "completed", "failed", "restoring"], required: true, index: true },
    prefix: { type: String, required: true, unique: true },
    manifestKey: String,
    collectionCount: { type: Number, default: 0 },
    documentCount: { type: Number, default: 0 },
    mediaCount: { type: Number, default: 0 },
    sizeBytes: { type: Number, default: 0 },
    startedAt: { type: Date, required: true },
    completedAt: Date,
    expiresAt: { type: Date, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    error: String,
  },
  base,
);
const backupLockSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    owner: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  base,
);
module.exports = {
  User: model("User", userSchema),
  Studio: model("Studio", studioSchema),
  Member: model("Member", memberSchema),
  Otp: model("Otp", otpSchema),
  Session: model("Session", sessionSchema),
  Customer: model("Customer", customerSchema),
  Measurement: model("Measurement", measurementSchema),
  GarmentTemplate: model("GarmentTemplate", templateSchema),
  Price: model("Price", priceSchema),
  Order: model("Order", orderSchema),
  Subscription: model("Subscription", subscriptionSchema),
  SubscriptionPlan: model("SubscriptionPlan", subscriptionPlanSchema),
  SubscriptionOffer: model("SubscriptionOffer", subscriptionOfferSchema),
  SubscriptionEvent: model("SubscriptionEvent", subscriptionEventSchema),
  Referral: model("Referral", referralSchema),
  ReferralRewardConfig: model(
    "ReferralRewardConfig",
    referralRewardConfigSchema,
  ),
  Idempotency: model("Idempotency", idempotencySchema),
  Media: model("Media", mediaSchema),
  Device: model("Device", deviceSchema),
  Notification: model("Notification", notificationSchema),
  SupportTicket: model("SupportTicket", supportSchema),
  AppConfig: model("AppConfig", appConfigSchema),
  AuditLog: model("AuditLog", auditLogSchema),
  BackupRecord: model("BackupRecord", backupRecordSchema),
  BackupLock: model("BackupLock", backupLockSchema),
  RealtimeEvent: model("RealtimeEvent", realtimeEventSchema),
};
