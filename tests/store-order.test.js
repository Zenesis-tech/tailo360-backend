jest.mock('../src/config/env', () => ({
  GOOGLE_PLAY_PACKAGE_NAME: 'com.tailo360',
  GOOGLE_SERVICE_ACCOUNT_JSON: '{}',
}));
jest.mock('google-auth-library', () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({ getAccessToken: async () => 'test-token' })),
}));

const { lookupGoogleOrder, stopGooglePaymentsForDeletion } = require('../src/services/store-verification.service');

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

const googlePurchase = (state = 'SUBSCRIPTION_STATE_ACTIVE') => ({
  subscriptionState: state,
  lineItems: [{ productId: 'tailo360_monthly', expiryTime: '2026-11-29T00:00:00Z', autoRenewingPlan: { autoRenewEnabled: true } }],
});

test('account deletion stops future Google payments before purging', async () => {
  const fetchMock = jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce({ ok: true, json: async () => googlePurchase() })
    .mockResolvedValueOnce({ ok: true });
  await expect(stopGooglePaymentsForDeletion('play-token-123'))
    .resolves.toEqual({ alreadyStopped: false });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][0]).toContain('/purchases/subscriptionsv2/tokens/play-token-123:cancel');
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
    cancellationContext: { cancellationType: 'DEVELOPER_REQUESTED_STOP_PAYMENTS' },
  });
});

test('account deletion accepts an already cancelled Google renewal', async () => {
  const purchase = googlePurchase('SUBSCRIPTION_STATE_CANCELED');
  purchase.lineItems[0].autoRenewingPlan.autoRenewEnabled = false;
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => purchase });
  await expect(stopGooglePaymentsForDeletion('play-token-123'))
    .resolves.toEqual({ alreadyStopped: true });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('account deletion fails when Google does not confirm payment cancellation', async () => {
  jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce({ ok: true, json: async () => googlePurchase() })
    .mockResolvedValueOnce({ ok: false, status: 503 });
  await expect(stopGooglePaymentsForDeletion('play-token-123'))
    .rejects.toMatchObject({ code: 'GOOGLE_CANCEL_FAILED' });
});
