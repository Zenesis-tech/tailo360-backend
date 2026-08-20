const { Order, Referral, Studio, Subscription } = require("../models");
const { send } = require("./notification.service");
const { pruneStaleDevices } = require("./notification.service");
const {
  expireReferrals,
  refreshSubscription,
} = require("./subscription-lifecycle.service");

const istOffsetMs = 330 * 60 * 1000;

function istDay(offset = 0, now = new Date()) {
  const shifted = new Date(now.getTime() + istOffsetMs);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate() + offset,
    ) - istOffsetMs,
  );
}

function dayKey(date = new Date()) {
  return new Date(date.getTime() + istOffsetMs).toISOString().slice(0, 10);
}

function istHour(date = new Date()) {
  return new Date(date.getTime() + istOffsetMs).getUTCHours();
}

function notify(studioId, message) {
  return send(studioId, { ...message, source: "reminder" });
}

async function runOrderReminders(now) {
  const today = istDay(0, now);
  const tomorrow = istDay(1, now);
  const dayAfterTomorrow = istDay(2, now);
  const staleBefore = istDay(-2, now);
  const studios = new Map(
    (await Studio.find().select("settings.notifications")).map((studio) => [
      studio.id,
      studio,
    ]),
  );
  const orders = await Order.find({
    status: { $nin: ["delivered", "cancelled"] },
    deletedAt: null,
    $or: [
      { deliveryDate: { $lt: dayAfterTomorrow } },
      { trialDate: { $gte: today, $lt: dayAfterTomorrow } },
      { reminderDate: { $gte: today, $lt: tomorrow } },
      { updatedAt: { $lt: staleBefore } },
    ],
  }).populate("customerId", "name");

  for (const order of orders) {
    const settings = studios.get(String(order.studioId))?.settings?.notifications;
    const route = { route: "order", orderId: order.id };
    const customer = order.customerId?.name ? ` for ${order.customerId.name}` : "";
    if (order.reminderDate >= today && order.reminderDate < tomorrow) {
      await notify(order.studioId, {
        type: "order_reminder",
        title: "Order reminder",
        body: `${order.code}${customer} needs attention today.`,
        data: route,
        dedupeKey: `order-reminder:${order.id}:${dayKey(today)}`,
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
        dedupeKey: `delivery:${overdue ? "overdue" : dayKey(order.deliveryDate)}:${order.id}:${overdue ? dayKey(today) : "once"}`,
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
        dedupeKey: `trial:${order.id}:${dayKey(order.trialDate)}`,
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
        dedupeKey: `payment-due:${order.id}:${dayKey(today)}`,
      });
    }
    if (order.updatedAt < staleBefore && order.deliveryDate >= tomorrow) {
      await notify(order.studioId, {
        type: "work_stalled",
        title: "Work has not progressed",
        body: `${order.code} has remained at ${order.status.replaceAll("_", " ")} for over 2 days.`,
        data: route,
        dedupeKey: `work-stalled:${order.id}:${dayKey(today)}`,
      });
    }
  }
}

async function runAccountReminders(now) {
  const today = istDay(0, now);
  for (const subscription of await Subscription.find({
    status: { $in: ["trial", "grace_period"] },
  })) {
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
      dedupeKey: `subscription:${subscription.id}:${dayKey(today)}`,
    });
  }

  await expireReferrals();
  const tomorrow = istDay(1, now);
  const dayAfterTomorrow = istDay(2, now);
  const referrals = await Referral.find({
    status: "pending",
    expiresAt: { $gte: tomorrow, $lt: dayAfterTomorrow },
  });
  for (const referral of referrals) {
    await notify(referral.referrerStudioId, {
      type: "referral_expiry",
      title: "Referral reward expiring",
      body: "A pending referral expires tomorrow.",
      data: { route: "referral" },
      dedupeKey: `referral:${referral.id}:expiry`,
    });
  }
}

async function runReminders(now = new Date()) {
  await pruneStaleDevices(now);
  // Reminder dates are calendar dates rather than timestamps. Do not wake
  // users at midnight; once 08:00 IST has passed, recurring checks catch both
  // newly-added reminders and same-day checks missed during API downtime.
  if (istHour(now) < 8) return;
  await runOrderReminders(now);
  await runAccountReminders(now);
}

module.exports = { runReminders, istDay, dayKey, istHour };
