const { Order, Referral, Studio, Subscription, Notification } = require("../models");
const { send, schedule, deliverScheduled } = require("./notification.service");
const { pruneStaleDevices } = require("./notification.service");
const {
  expireReferrals,
  refreshSubscription,
} = require("./subscription-lifecycle.service");

const DEFAULT_TIMEZONE = "Asia/Kolkata";
const REMINDER_HOUR = 9;

function zonedParts(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function zonedDateTime(year, month, day, hour, timezone = DEFAULT_TIMEZONE) {
  const desired = Date.UTC(year, month - 1, day, hour);
  let result = new Date(desired);
  // Two passes account for timezone offsets and daylight-saving transitions.
  for (let pass = 0; pass < 2; pass += 1) {
    const actual = zonedParts(result, timezone);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    result = new Date(result.getTime() + desired - represented);
  }
  return result;
}

function zonedDay(offset = 0, now = new Date(), timezone = DEFAULT_TIMEZONE) {
  const local = zonedParts(now, timezone);
  const shifted = new Date(Date.UTC(local.year, local.month - 1, local.day + offset));
  return zonedDateTime(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    0,
    timezone,
  );
}

function dayKey(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const local = zonedParts(date, timezone);
  return `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
}

function localHour(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  return zonedParts(date, timezone).hour;
}

function notify(studioId, message) {
  return send(studioId, { ...message, source: "reminder" });
}

function reminderMoment(date, daysBefore = 0, timezone = DEFAULT_TIMEZONE) {
  if (!date) return null;
  const local = zonedParts(date, timezone);
  const shifted = new Date(Date.UTC(local.year, local.month - 1, local.day - daysBefore));
  return zonedDateTime(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    REMINDER_HOUR,
    timezone,
  );
}

async function scheduleOrderReminders(order, notifications = {}, configuredTimezone) {
  const timezone = configuredTimezone ||
    (await Studio.findById(order.studioId).select("settings.timezone"))?.settings?.timezone ||
    DEFAULT_TIMEZONE;
  await Notification.deleteMany({
    studioId: order.studioId,
    "data.orderId": order.id,
    source: "reminder",
    status: "queued",
    scheduledFor: { $ne: null },
  });
  if (["delivered", "cancelled"].includes(order.status)) return;
  const route = { route: "order", orderId: order.id };
  const customer = order.customerId?.name ? ` for ${order.customerId.name}` : "";
  const tasks = [];
  if (notifications.delivery !== false && order.deliveryDate) {
    tasks.push(schedule(order.studioId, {
      type: "delivery_due_soon",
      title: "Delivery due soon",
      body: `${order.code}${customer} is due for delivery soon.`,
      data: route,
      source: "reminder",
      scheduledFor: reminderMoment(order.deliveryDate, 2, timezone),
      dedupeKey: `delivery:${dayKey(order.deliveryDate, timezone)}:${order.id}`,
    }));
  }
  if (notifications.trial !== false && order.trialDate) {
    tasks.push(schedule(order.studioId, {
      type: "trial_due_today",
      title: "Trial scheduled today",
      body: `${order.code}${customer} has a trial today.`,
      data: route,
      source: "reminder",
      scheduledFor: reminderMoment(order.trialDate, 0, timezone),
      dedupeKey: `trial:${order.id}:${dayKey(order.trialDate, timezone)}`,
    }));
  }
  await Promise.all(tasks);
}

async function rescheduleStudioOrderReminders(studioId, notifications = {}) {
  const studio = await Studio.findById(studioId).select("settings.timezone");
  const timezone = studio?.settings?.timezone || DEFAULT_TIMEZONE;
  const orders = await Order.find({
    studioId,
    status: { $nin: ["delivered", "cancelled"] },
    deletedAt: null,
  });
  await Promise.all(
    orders.map((order) => scheduleOrderReminders(order, notifications, timezone)),
  );
}

async function runOrderReminders(now) {
  // Use a broad UTC query window, then evaluate each record using its
  // studio's local calendar below.
  const broadToday = zonedDay(-1, now);
  const broadTomorrow = zonedDay(2, now);
  const broadDayAfterTomorrow = zonedDay(3, now);
  const broadStaleBefore = zonedDay(-3, now);
  const studios = new Map(
    (await Studio.find().select("settings.notifications settings.timezone")).map((studio) => [
      studio.id,
      studio,
    ]),
  );
  const orders = await Order.find({
    status: { $nin: ["delivered", "cancelled"] },
    deletedAt: null,
    $or: [
      { deliveryDate: { $lt: broadDayAfterTomorrow } },
      { trialDate: { $gte: broadToday, $lt: broadDayAfterTomorrow } },
      { reminderDate: { $gte: broadToday, $lt: broadTomorrow } },
      { updatedAt: { $lt: broadStaleBefore } },
    ],
  }).populate("customerId", "name");

  for (const order of orders) {
    const studio = studios.get(String(order.studioId));
    const timezone = studio?.settings?.timezone || DEFAULT_TIMEZONE;
    if (localHour(now, timezone) < REMINDER_HOUR) continue;
    const today = zonedDay(0, now, timezone);
    const tomorrow = zonedDay(1, now, timezone);
    const dayAfterTomorrow = zonedDay(2, now, timezone);
    const staleBefore = zonedDay(-2, now, timezone);
    const settings = studio?.settings?.notifications;
    const route = { route: "order", orderId: order.id };
    const customer = order.customerId?.name ? ` for ${order.customerId.name}` : "";
    if (settings?.delivery !== false && order.reminderDate >= today && order.reminderDate < tomorrow) {
      await notify(order.studioId, {
        type: "order_reminder",
        title: "Order reminder",
        body: `${order.code}${customer} needs attention today.`,
        data: route,
        dedupeKey: `order-reminder:${order.id}:${dayKey(today, timezone)}`,
      });
    }
    if (settings?.delivery !== false && order.deliveryDate < dayAfterTomorrow) {
      const overdue = order.deliveryDate < today;
      const dueToday = order.deliveryDate >= today && order.deliveryDate < tomorrow;
      await notify(order.studioId, {
        type: overdue ? "delivery_overdue" : dueToday ? "delivery_due_today" : "delivery_due_tomorrow",
        title: overdue ? "Delivery overdue" : dueToday ? "Delivery due today" : "Delivery due tomorrow",
        body: `${order.code}${customer} ${overdue ? "is overdue" : "is due soon"}.`,
        data: route,
        dedupeKey: `delivery:${overdue ? "overdue" : dayKey(order.deliveryDate, timezone)}:${order.id}:${overdue ? dayKey(today, timezone) : "once"}`,
      });
    }
    if (
      settings?.trial !== false &&
      order.trialDate &&
      order.trialDate >= today &&
      order.trialDate < dayAfterTomorrow
    ) {
      const todayTrial = order.trialDate < tomorrow;
      await notify(order.studioId, {
        type: todayTrial ? "trial_due_today" : "trial_due_tomorrow",
        title: todayTrial ? "Trial scheduled today" : "Trial scheduled tomorrow",
        body: `${order.code}${customer} has a trial ${todayTrial ? "today" : "tomorrow"}.`,
        data: route,
        dedupeKey: `trial:${order.id}:${dayKey(order.trialDate, timezone)}`,
      });
    }
    const paid = order.payments.reduce(
      (sum, item) => sum + (item.direction === "collection" ? item.amountPaise : -item.amountPaise),
      0,
    );
    if (order.totalPaise > paid && order.deliveryDate < tomorrow) {
      await notify(order.studioId, {
        type: "payment_due",
        title: "Payment pending",
        body: `${order.code} has ₹${Math.round((order.totalPaise - paid) / 100)} pending.`,
        data: route,
        dedupeKey: `payment-due:${order.id}:${dayKey(today, timezone)}`,
      });
    }
    if (order.updatedAt < staleBefore && order.deliveryDate >= tomorrow) {
      await notify(order.studioId, {
        type: "work_stalled",
        title: "Work has not progressed",
        body: `${order.code} has remained at ${order.status.replaceAll("_", " ")} for over 2 days.`,
        data: route,
        dedupeKey: `work-stalled:${order.id}:${dayKey(today, timezone)}`,
      });
    }
  }
}

async function runAccountReminders(now) {
  const studios = new Map(
    (await Studio.find().select("settings.timezone")).map((studio) => [
      studio.id,
      studio,
    ]),
  );
  for (const subscription of await Subscription.find({
    status: { $in: ["trial", "grace_period"] },
  })) {
    const timezone = studios.get(String(subscription.studioId))?.settings?.timezone ||
      DEFAULT_TIMEZONE;
    if (localHour(now, timezone) < REMINDER_HOUR) continue;
    const today = zonedDay(0, now, timezone);
    await refreshSubscription(subscription);
    const end = subscription.status === "trial"
      ? subscription.trialEndsAt
      : subscription.periodEndsAt;
    if (!end) continue;
    const days = Math.ceil((end - today) / 86400000);
    if (![3, 1, 0].includes(days)) continue;
    await notify(subscription.studioId, {
      type: days <= 0 ? "subscription_expired" : "subscription_expiring",
      title: days <= 0 ? "Subscription access ended" : `Subscription ends in ${days} day${days === 1 ? "" : "s"}`,
      body: days <= 0
        ? "Choose a plan to continue creating and updating records."
        : "Review your plan to avoid interruption.",
      data: { route: "subscription" },
      dedupeKey: `subscription:${subscription.id}:${dayKey(today, timezone)}`,
    });
  }

  await expireReferrals();
  const referrals = await Referral.find({
    status: "pending",
  });
  for (const referral of referrals) {
    const timezone = studios.get(String(referral.referrerStudioId))?.settings?.timezone ||
      DEFAULT_TIMEZONE;
    if (localHour(now, timezone) < REMINDER_HOUR) continue;
    const tomorrow = zonedDay(1, now, timezone);
    const dayAfterTomorrow = zonedDay(2, now, timezone);
    if (referral.expiresAt < tomorrow || referral.expiresAt >= dayAfterTomorrow) {
      continue;
    }
    await notify(referral.referrerStudioId, {
      type: "referral_expiry",
      title: "Referral reward expiring",
      body: "A pending referral expires tomorrow.",
      data: { route: "referral" },
      dedupeKey: `referral:${referral.id}:expiry:${dayKey(tomorrow, timezone)}`,
    });
  }
}

async function runReminders(now = new Date()) {
  await pruneStaleDevices(now);
  // Scheduled timestamps are already converted from 09:00 in the studio's
  // timezone. Dynamic reminders are independently gated per studio below.
  const eligibleStudioIds = (await Studio.find().select("settings.timezone"))
    .filter((studio) => localHour(
      now,
      studio.settings?.timezone || DEFAULT_TIMEZONE,
    ) >= REMINDER_HOUR)
    .map((studio) => studio._id);
  await deliverScheduled(now, { studioIds: eligibleStudioIds });
  await runOrderReminders(now);
  await runAccountReminders(now);
}

module.exports = {
  runReminders,
  zonedDay,
  dayKey,
  localHour,
  reminderMoment,
  scheduleOrderReminders,
  rescheduleStudioOrderReminders,
};
