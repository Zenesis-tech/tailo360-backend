process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://placeholder/test';
process.env.JWT_ACCESS_SECRET = 'a-very-long-test-access-secret-that-is-at-least-32';
process.env.JWT_REFRESH_SECRET = 'a-very-long-test-refresh-secret-that-is-at-least-32';

const {
  summarizeSubscription,
} = require('../src/services/google-play-catalog.service');

test('Google Play subscription catalog exposes launch-country base-plan prices', () => {
  const result = summarizeSubscription({
    productId: 'tailo360_studio',
    basePlans: [
      {
        basePlanId: 'monthly',
        state: 'ACTIVE',
        autoRenewingBasePlanType: { billingPeriodDuration: 'P1M' },
        regionalConfigs: [
          {
            regionCode: 'IN',
            newSubscriberAvailability: true,
            price: { currencyCode: 'INR', units: '99', nanos: 0 },
          },
          {
            regionCode: 'US',
            newSubscriberAvailability: true,
            price: { currencyCode: 'USD', units: '4', nanos: 990000000 },
          },
          {
            regionCode: 'DE',
            newSubscriberAvailability: true,
            price: { currencyCode: 'EUR', units: '4', nanos: 490000000 },
          },
        ],
      },
    ],
  });

  expect(result).toEqual({
    productId: 'tailo360_studio',
    basePlans: [
      {
        basePlanId: 'monthly',
        state: 'ACTIVE',
        billingPeriodDuration: 'P1M',
        regions: [
          {
            country: 'IN',
            available: true,
            currencyCode: 'INR',
            units: '99',
            nanos: 0,
          },
          {
            country: 'US',
            available: true,
            currencyCode: 'USD',
            units: '4',
            nanos: 990000000,
          },
        ],
      },
    ],
  });
});
