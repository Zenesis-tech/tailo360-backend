function redactSecrets(value) {
  if (typeof value !== 'string') return value;
  return value.replace(
    /(mongodb(?:\+srv)?:\/\/)([^@\s"']*)@/gi,
    '$1[REDACTED]@',
  );
}

function safeError(error) {
  return {
    name: error?.name,
    message: redactSecrets(error?.message),
    stack: redactSecrets(error?.stack),
    cause: error?.cause
      ? {
          name: error.cause?.name,
          code: error.cause?.code,
          message: redactSecrets(error.cause?.message),
        }
      : undefined,
  };
}

module.exports = { redactSecrets, safeError };
