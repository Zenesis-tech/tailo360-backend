function escapedSearch(value, maxLength = 80) {
  const text = typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
  if (!text) return undefined;
  return { $regex: text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
}

module.exports = { escapedSearch };
