const { Idempotency } = require('../models');
function idempotent(handler) { return async (req, res, next) => {
  const key = req.header('Idempotency-Key')?.trim();
  if (!key) return handler(req, res, next);
  if (key.length > 200) return res.status(422).json({ error: { code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key must be 200 characters or fewer.', requestId: req.id } });
  let claim;
  try {
    claim = await Idempotency.create({ studioId: req.auth.studio._id, key, status: 102, body: null, expiresAt: new Date(Date.now() + 86400000) });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const existing = await Idempotency.findOne({ studioId: req.auth.studio._id, key });
    if (!existing) throw error;
    if (existing.status === 102) return res.status(409).json({ error: { code: 'REQUEST_IN_PROGRESS', message: 'A request with this idempotency key is still in progress.', requestId: req.id } });
    return res.status(existing.status).json(existing.body);
  }
  const original = res.json.bind(res);
  let completion = Promise.resolve();
  res.json = (body) => {
    completion = Idempotency.updateOne({ _id: claim._id }, { status: res.statusCode, body }).then(() => original(body));
    return res;
  };
  try {
    await handler(req, res, next);
    await completion;
  } catch (error) {
    await Idempotency.deleteOne({ _id: claim._id });
    throw error;
  }
}; }
module.exports = { idempotent };
