const { send } = require("./notification.service");

const labels = {
  pending: "Pending",
  measurements_pending: "Measurements pending",
  cutting: "Cutting started",
  stitching: "Stitching in progress",
  trial: "Ready for trial",
  alteration: "Alteration required",
  ready: "Ready for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

function queue(studioId, message) {
  send(studioId, message).catch((error) =>
    console.error("Notification dispatch failed", error),
  );
}

function orderCreated(order, customer, actorId) {
  queue(order.studioId, {
    type: "order_created",
    title: "New order added",
    body: `${order.code} for ${customer.name} was added.`,
    data: { route: "order", orderId: order.id },
    excludeUserId: actorId,
  });
}

function orderUpdated(order, actorId) {
  queue(order.studioId, {
    type: "order_updated",
    title: "Order schedule updated",
    body: `${order.code} details or dates were changed.`,
    data: { route: "order", orderId: order.id },
    excludeUserId: actorId,
  });
}

function orderStatusChanged(order, previous, actorId) {
  const type = order.status === "ready"
    ? "order_ready"
    : order.status === "alteration"
      ? "alteration_required"
      : order.status === "trial"
        ? "order_trial"
        : order.status === "cancelled"
          ? "order_cancelled"
          : order.status === "delivered"
            ? "order_delivered"
            : "order_status_changed";
  queue(order.studioId, {
    type,
    title: labels[order.status] || "Order status changed",
    body: `${order.code} moved from ${labels[previous] || previous} to ${labels[order.status] || order.status}.`,
    data: { route: "order", orderId: order.id, status: order.status },
    excludeUserId: actorId,
  });
}

function paymentRecorded(order, amountPaise, direction, actorId) {
  const amount = `₹${Math.round(amountPaise / 100)}`;
  queue(order.studioId, {
    type: direction === "refund" ? "payment_refunded" : "payment_received",
    title: direction === "refund" ? "Refund recorded" : "Payment received",
    body: `${amount} ${direction === "refund" ? "refund" : "payment"} recorded for ${order.code}.`,
    data: { route: "order", orderId: order.id },
    excludeUserId: actorId,
  });
}

function customerChanged(customer, action, actorId) {
  queue(customer.studioId, {
    type: action === "created" ? "customer_created" : "customer_updated",
    title: action === "created" ? "Customer added" : "Customer updated",
    body: `${customer.name}'s profile was ${action === "created" ? "added" : "updated"}.`,
    data: { route: "customer", customerId: customer.id },
    excludeUserId: actorId,
  });
}

function measurementsUpdated(studioId, customerId, customerName, actorId) {
  queue(studioId, {
    type: "measurements_updated",
    title: "Measurements updated",
    body: `${customerName}'s saved measurements were updated.`,
    data: { route: "customer", customerId },
    excludeUserId: actorId,
  });
}

module.exports = {
  orderCreated,
  orderUpdated,
  orderStatusChanged,
  paymentRecorded,
  customerChanged,
  measurementsUpdated,
};
