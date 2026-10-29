jest.mock('../src/config/env', () => ({
  GOOGLE_PLAY_PACKAGE_NAME: 'com.tailo360',
  GOOGLE_SERVICE_ACCOUNT_JSON: '{}',
}));
jest.mock('google-auth-library', () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({ getAccessToken: async () => 'test-token' })),
}));

const { lookupGoogleOrder } = require('../src/services/store-verification.service');

afterEach(() => jest.restoreAllMocks());

test('Google order lookup records actual order state and total', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      state: 'PROCESSED',
      createTime: '2026-10-29T10:00:00Z',
      total: { currencyCode: 'INR', units: '99', nanos: 500000000 },
    }),
  });
  const result = await lookupGoogleOrder({ platform: 'google', raw: { latestOrderId: 'GPA.1234' } });
  expect(fetchMock.mock.calls[0][0]).toContain('/applications/com.tailo360/orders/GPA.1234');
  expect(result).toMatchObject({ orderState: 'PROCESSED', paidCurrency: 'INR', paidAmountMicros: 99500000 });
});
