const transitions = {
  pending: ['cutting', 'cancelled'],
  measurements_pending: ['cutting', 'cancelled'],
  cutting: ['stitching', 'cancelled'],
  stitching: ['trial', 'ready', 'cancelled'],
  trial: ['alteration', 'ready', 'cancelled'],
  alteration: ['trial', 'ready', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  delivered: [], cancelled: [],
};
function canTransition(from, to) { return transitions[from]?.includes(to) ?? false; }
module.exports = { transitions, canTransition };
