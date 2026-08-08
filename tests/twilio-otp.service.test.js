const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://placeholder/test',
    JWT_ACCESS_SECRET: 'a-very-long-test-access-secret-that-is-at-least-32',
    JWT_REFRESH_SECRET: 'a-very-long-test-refresh-secret-that-is-at-least-32',
    TWILIO_ACCOUNT_SID: 'AC123',
    TWILIO_AUTH_TOKEN: 'auth-token',
    TWILIO_VERIFY_SERVICE_SID: 'VA123',
  };
});

afterEach(() => {
  process.env = originalEnv;
  delete global.fetch;
});

test('Twilio Verify sends an SMS verification request', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'pending' }) });
  const twilio = require('../src/services/twilio-otp.service');

  await twilio.sendOtp('+919876543210');

  expect(global.fetch).toHaveBeenCalledWith(
    'https://verify.twilio.com/v2/Services/VA123/Verifications',
    expect.objectContaining({ method: 'POST', body: expect.any(URLSearchParams) }),
  );
  expect(global.fetch.mock.calls[0][1].body.toString()).toBe('To=%2B919876543210&Channel=sms');
});

test('Twilio Verify accepts only approved verification checks', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'approved' }) });
  const twilio = require('../src/services/twilio-otp.service');

  await expect(twilio.verifyOtp('+919876543210', '123456')).resolves.toBe(true);
  expect(global.fetch).toHaveBeenCalledWith(
    'https://verify.twilio.com/v2/Services/VA123/VerificationCheck',
    expect.objectContaining({ method: 'POST', body: expect.any(URLSearchParams) }),
  );
  expect(global.fetch.mock.calls[0][1].body.toString()).toBe(
    'To=%2B919876543210&Code=123456',
  );
});

test('Twilio Verify reports an actionable country permission error without exposing the phone', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 400,
    json: async () => ({ code: 60605, message: 'Destination blocked' }),
  });
  const twilio = require('../src/services/twilio-otp.service');

  await expect(twilio.sendOtp('+919876543210')).rejects.toMatchObject({
    status: 502,
    code: 'SMS_DELIVERY_FAILED',
    message: 'SMS delivery to this country is disabled in Twilio Verify Geo Permissions.',
    details: { provider: 'twilio', providerCode: '60605' },
  });
  expect(console.error).toHaveBeenCalledWith(
    'Twilio Verify rejected an OTP request',
    expect.not.objectContaining({ phone: expect.anything() }),
  );
  console.error.mockRestore();
});

test('Twilio Verify includes an unknown provider code in a safe delivery error', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 400,
    json: async () => ({ code: 60000, message: 'Provider-only detail' }),
  });
  const twilio = require('../src/services/twilio-otp.service');

  await expect(twilio.sendOtp('+919876543210')).rejects.toMatchObject({
    message: 'Twilio could not send the OTP (provider code 60000).',
    details: { provider: 'twilio', providerCode: '60000' },
  });
  console.error.mockRestore();
});

test('Twilio Verify reports when the SMS delivery channel is disabled', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 400,
    json: async () => ({ code: 60223, message: 'Delivery channel disabled' }),
  });
  const twilio = require('../src/services/twilio-otp.service');

  await expect(twilio.sendOtp('+919876543210')).rejects.toMatchObject({
    message:
      'SMS delivery is disabled for this Twilio Verify Service. Enable the SMS channel in Twilio Console.',
    details: { provider: 'twilio', providerCode: '60223' },
  });
  console.error.mockRestore();
});
