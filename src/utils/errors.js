class AppError extends Error {
  constructor(status, code, message, details) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}
const notFound = (resource = 'Resource') => new AppError(404, 'NOT_FOUND', `${resource} was not found.`);
module.exports = { AppError, notFound };
