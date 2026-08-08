function assertPaise(value) {
  if (!Number.isInteger(value) || value < 0) throw new Error('Money must be a non-negative integer paise value.');
  return value;
}
function balanceFor(order) {
  return order.payments.reduce((sum, payment) => sum + (payment.direction === 'refund' ? payment.amountPaise : -payment.amountPaise), order.totalPaise);
}
module.exports = { assertPaise, balanceFor };
