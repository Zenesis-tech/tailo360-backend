const { safeError } = require('../src/utils/logging');

test('database credentials are redacted from logged errors', () => {
  const error = new Error(
    'Invalid URI "mongodb+srv://database-user:secret-password@@cluster.example.net/app"',
  );

  const logged = safeError(error);

  expect(logged.message).toContain('mongodb+srv://[REDACTED]@@cluster.example.net/app');
  expect(logged.message).not.toContain('secret-password');
  expect(logged.stack).not.toContain('secret-password');
});
