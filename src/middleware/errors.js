const { ZodError } = require('zod');
const { AppError } = require('../utils/errors');
const databaseErrorNames = new Set([
  'MongoNetworkError',
  'MongoServerSelectionError',
  'MongooseServerSelectionError',
]);
const databaseErrorMessage = /buffering timed out|before initial connection|client must be connected|topology (?:is|was) closed/i;

function logError(error, requestId) {
  console.error({
    requestId,
    name: error?.name,
    message: error?.message,
    stack: error?.stack,
    cause: error?.cause,
  });
}

function notFoundHandler(req, res) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route was not found.' } }); }
function errorHandler(error, req, res, next) { // eslint-disable-line no-unused-vars
  const requestId = req.id;
  if (error instanceof SyntaxError && error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.', requestId } });
  }
  if (error instanceof ZodError) return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'One or more fields are invalid.', details: error.flatten(), requestId } });
  if (error instanceof AppError) return res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details, requestId } });
  if (error?.code === 11000) return res.status(409).json({ error: { code: 'DUPLICATE_RECORD', message: 'A record with that value already exists.', requestId } });
  if (error?.name === 'VersionError') return res.status(409).json({ error: { code: 'EDIT_CONFLICT', message: 'This record was changed by another person. Refresh and try again.', requestId } });
  if (databaseErrorNames.has(error?.name) || databaseErrorMessage.test(error?.message || '')) {
    logError(error, requestId);
    return res.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is temporarily unavailable. Please try again.', requestId } });
  }
  logError(error, requestId);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.', requestId } });
}
module.exports = { notFoundHandler, errorHandler };
