process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://placeholder/test';
process.env.JWT_ACCESS_SECRET = 'a-very-long-test-access-secret-that-is-at-least-32';
process.env.JWT_REFRESH_SECRET = 'a-very-long-test-refresh-secret-that-is-at-least-32';
process.env.EXPOSE_DEV_OTP = 'true';
process.env.OTP_DELIVERY_MODE = 'development';

const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongo;
let app;
let mongoose;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  jest.resetModules();
  jest.doMock('../src/services/r2.service', () => ({
    createUploadUrl: jest.fn(async () => 'https://upload.example.test/signed'),
    createReadUrl: jest.fn(async (key) => `https://media.example.test/${key}`),
    objectMetadata: jest.fn(async () => ({
      ContentLength: 2048,
      ContentType: 'image/png',
    })),
    deleteObject: jest.fn(async () => ({})),
    putObject: jest.fn(async () => ({})),
  }));
  mongoose = require('mongoose');
  await require('../src/config/db').connectDatabase();
  app = require('../src/app');
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

async function createAccount(phone, options = {}) {
  const requested = await request(app)
    .post('/api/v1/auth/otp/request')
    .send({ phone })
    .expect(202);
  expect(requested.body.data.developmentCode).toBe('123456');
  return request(app)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, code: '123456', studioName: 'Needle & Thread', ...options })
    .expect(200);
}

test('OTP provisions a studio and returns a usable token', async () => {
  const verified = await createAccount('+919876543210');
  expect(verified.body.data.isNew).toBe(true);
  const profile = await request(app)
    .get('/api/v1/auth/me')
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .expect(200);
  expect(profile.body.data.subscription.status).toBe('trial');
  expect(new Date(profile.body.data.subscription.trialEndsAt).getTime()).toBeGreaterThan(Date.now());
});

test('an expired trial keeps reads available and blocks business writes', async () => {
  const verified = await createAccount('+919876543216');
  const { Customer, Subscription } = require('../src/models');
  const customer = await Customer.create({
    studioId: verified.body.data.studioId,
    name: 'Read Only Customer',
    phone: '+919000000216',
  });
  await Subscription.updateOne(
    { studioId: verified.body.data.studioId },
    { status: 'trial', trialEndsAt: new Date(Date.now() - 60000) },
  );

  await request(app)
    .get(`/api/v1/customers/${customer.id}`)
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .expect(200);

  const update = await request(app)
    .patch(`/api/v1/customers/${customer.id}`)
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .send({ name: 'Should Not Change' })
    .expect(403);
  expect(update.body.error.code).toBe('SUBSCRIPTION_RESTRICTED');
});

test('readiness reports the connected database state', async () => {
  const response = await request(app).get('/ready').expect(200);
  expect(response.body.data).toMatchObject({
    status: 'ready',
    database: { ready: true, state: 'connected' },
  });
});

test('database connection failures use a retryable service response', () => {
  const { errorHandler } = require('../src/middleware/errors');
  const error = new Error('Operation `users.findOne()` buffering timed out after 10000ms');
  error.name = 'MongooseError';
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});

  errorHandler(error, { id: 'database-test-request' }, response, () => {});

  expect(response.status).toHaveBeenCalledWith(503);
  expect(response.json).toHaveBeenCalledWith({
    error: {
      code: 'DATABASE_UNAVAILABLE',
      message: 'The database is temporarily unavailable. Please try again.',
      requestId: 'database-test-request',
    },
  });
  log.mockRestore();
});

test('dashboard returns backend-derived empty metrics for a new studio', async () => {
  const verified = await createAccount('+919876543219');
  const response = await request(app)
    .get('/api/v1/dashboard')
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .expect(200);
  expect(response.body.data).toMatchObject({
    studioName: 'Needle & Thread',
    todayCollectedPaise: 0,
    collectedPaise: 0,
    pendingPaise: 0,
    overduePaise: 0,
    counts: {
      activeOrders: 0,
      trialsToday: 0,
      readyForDelivery: 0,
      newOrders: 0,
      inProgress: 0,
      completed: 0,
    },
    today: [],
  });
});

test('async validation failures use the standard API error response', async () => {
  const response = await request(app)
    .post('/api/v1/auth/otp/request')
    .send({ phone: 'not-a-phone' })
    .expect(422);
  expect(response.body.error.code).toBe('VALIDATION_ERROR');
  expect(response.body.error.requestId).toBeTruthy();
});

test('malformed JSON returns a client error instead of an internal error', async () => {
  const response = await request(app)
    .post('/api/v1/auth/otp/request')
    .set('Content-Type', 'application/json')
    .send('{phone:}')
    .expect(400);
  expect(response.body.error.code).toBe('INVALID_JSON');
  expect(response.body.error.requestId).toBeTruthy();
});

test('refresh tokens rotate and cannot be replayed', async () => {
  const verified = await createAccount('+919876543211');
  const original = verified.body.data.refreshToken;
  const refreshed = await request(app)
    .post('/api/v1/auth/refresh')
    .send({ refreshToken: original })
    .expect(200);

  await request(app)
    .post('/api/v1/auth/refresh')
    .send({ refreshToken: original })
    .expect(401);
  await request(app)
    .get('/api/v1/auth/me')
    .set('Authorization', `Bearer ${refreshed.body.data.accessToken}`)
    .expect(200);
});

test('onboarding provisions only the selected garment audiences', async () => {
  const verified = await createAccount('+919876543212', { garmentAudiences: ['women'] });
  const profile = await request(app)
    .get('/api/v1/auth/me')
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .expect(200);
  expect(profile.body.data.studio.settings.garmentAudiences).toEqual(['women']);

  const templates = await request(app)
    .get('/api/v1/garment-templates')
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .expect(200);
  expect(templates.body.data).toHaveLength(4);
  expect(templates.body.data.every((template) => template.audience === 'women')).toBe(true);
  expect(templates.body.data.map((template) => template.name)).toEqual(expect.arrayContaining(['Blouse', 'Kurti', 'Salwar suit', 'Lehenga']));
});

test('shop onboarding persists the owner and business profile', async () => {
  const verified = await createAccount('+919876543221');
  const token = verified.body.data.accessToken;
  const { Media, Member, User } = require('../src/models');
  const logo = await Media.create({
    studioId: verified.body.data.studioId,
    ownerUserId: verified.body.data.user.id,
    objectKey: 'studio/logo.png',
    originalName: 'logo.png',
    contentType: 'image/png',
    purpose: 'studio_logo',
    status: 'ready',
    sizeBytes: 2048,
  });

  const response = await request(app)
    .patch('/api/v1/studio')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Ramesh Tailors',
      ownerName: 'Ramesh Kumar',
      ownerPhone: '98765 43221',
      address: '12 MG Road, Bangalore',
      businessType: 'tailoring',
      services: ['mens_wear', 'alteration'],
      logoMediaId: logo.id,
      settings: { garmentAudiences: ['men', 'unisex'] },
    })
    .expect(200);

  expect(response.body.data).toMatchObject({
    name: 'Ramesh Tailors',
    address: '12 MG Road, Bangalore',
    businessType: 'tailoring',
    services: ['mens_wear', 'alteration'],
    logoMediaId: logo.id,
    onboardingCompletedAt: expect.any(String),
    owner: { name: 'Ramesh Kumar', phone: '+919876543221' },
    settings: { garmentAudiences: ['men', 'unisex'] },
  });
  expect((await User.findById(verified.body.data.user.id)).name).toBe('Ramesh Kumar');
  expect((await Member.findOne({ studioId: verified.body.data.studioId })).phone).toBe('+919876543221');
});

test('standard garments are global while studio-created garments stay private', async () => {
  const first = await createAccount('+919876543217', { garmentAudiences: ['men'] });
  const second = await createAccount('+919876543218', { garmentAudiences: ['men'] });
  const firstList = await request(app)
    .get('/api/v1/garment-templates?active=true')
    .set('Authorization', `Bearer ${first.body.data.accessToken}`)
    .expect(200);
  const secondList = await request(app)
    .get('/api/v1/garment-templates?active=true')
    .set('Authorization', `Bearer ${second.body.data.accessToken}`)
    .expect(200);

  expect(firstList.body.data.map((row) => row._id).sort()).toEqual(
    secondList.body.data.map((row) => row._id).sort(),
  );
  expect(firstList.body.data.every((row) => row.scope === 'global')).toBe(true);

  const custom = await request(app)
    .post('/api/v1/garment-templates')
    .set('Authorization', `Bearer ${first.body.data.accessToken}`)
    .send({
      name: 'Custom ceremonial coat',
      audience: 'men',
      fields: [{ name: 'Chest', unit: 'in' }],
    })
    .expect(201);
  expect(custom.body.data.scope).toBe('studio');

  const secondAfter = await request(app)
    .get('/api/v1/garment-templates?active=true')
    .set('Authorization', `Bearer ${second.body.data.accessToken}`)
    .expect(200);
  expect(secondAfter.body.data.some((row) => row.name === 'Custom ceremonial coat')).toBe(false);
});

test('garment templates persist a backend-managed measurement diagram', async () => {
  const verified = await createAccount('+919876543213');
  const diagram = 'https://cdn.example.com/measurement-guides/shirt.png';
  const created = await request(app)
    .post('/api/v1/garment-templates')
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .send({
      name: 'Diagram Shirt',
      audience: 'men',
      measurementDiagramUrl: diagram,
      fields: [{ name: 'Chest', unit: 'in', required: true }],
    })
    .expect(201);

  expect(created.body.data.measurementDiagramUrl).toBe(diagram);
  const templates = await request(app)
    .get('/api/v1/garment-templates?active=true')
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .expect(200);
  expect(
    templates.body.data.find((template) => template.name === 'Diagram Shirt')
      .measurementDiagramUrl,
  ).toBe(diagram);
});

test('order creation persists per-garment measurements', async () => {
  const { Customer, SubscriptionPlan } = require('../src/models');
  await SubscriptionPlan.findOneAndUpdate(
    { code: 'starter' },
    {
      code: 'starter',
      name: 'Starter',
      active: true,
      trialDays: 14,
      monthlyPricePaise: 29900,
      yearlyPricePaise: 299000,
      limits: { customers: 80, ordersPerMonth: 150, staffSeats: 1 },
      features: [],
    },
    { upsert: true, new: true },
  );
  const verified = await createAccount('+919876543220', { garmentAudiences: ['women'] });
  const token = verified.body.data.accessToken;
  const templates = await request(app)
    .get('/api/v1/garment-templates?active=true')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  const kurti = templates.body.data.find((template) => template.name === 'Kurti');
  await request(app)
    .put(`/api/v1/pricing/${kurti._id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ amountPaise: 180000 })
    .expect(200);
  const customer = await Customer.create({
    studioId: verified.body.data.studioId,
    name: 'Measurement Client',
    phone: '+919000000220',
  });
  const created = await request(app)
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      customerId: customer.id,
      deliveryDate: new Date(Date.now() + 86400000).toISOString(),
      lines: [{
        templateId: kurti._id,
        quantity: 1,
        measurements: { Chest: '40', Length: '44', Waist: '36' },
        customizations: {},
        measurementSource: 'fresh',
      }],
    })
    .expect(201);

  const { Order } = require('../src/models');
  const stored = await Order.findById(created.body.data._id);
  expect(stored.lines[0].measurements.get('Chest')).toBe('40');
  expect(stored.lines[0].measurements.get('Length')).toBe('44');

  const detail = await request(app)
    .get(`/api/v1/orders/${created.body.data._id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  expect(detail.body.data.lines[0].measurements).toEqual({
    Chest: '40',
    Length: '44',
    Waist: '36',
  });
});

test('subscription products are filtered for the requesting store', async () => {
  const verified = await createAccount('+919876543214');
  const { SubscriptionPlan } = require('../src/models');
  await SubscriptionPlan.create({
    code: 'pro',
    name: 'Pro',
    active: true,
    trialDays: 14,
    monthlyPricePaise: 69900,
    yearlyPricePaise: 699000,
    limits: { customers: -1, ordersPerMonth: -1, staffSeats: 1 },
    features: ['Reports'],
    storeProducts: [
      {
        platform: 'google',
        productId: 'tailo360_pro_monthly',
        period: 'monthly',
        active: true,
      },
      {
        platform: 'apple',
        productId: 'tailo360.pro.monthly',
        period: 'monthly',
        active: true,
      },
    ],
  });

  const response = await request(app)
    .get('/api/v1/subscription/products?platform=google')
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .expect(200);
  expect(response.body.data).toEqual([
    expect.objectContaining({
      id: 'tailo360_pro_monthly',
      platform: 'google',
      plan: 'pro',
      period: 'monthly',
    }),
  ]);
});

test('platform admin can grant expiring test access without a store product', async () => {
  const verified = await createAccount('+919876543215');
  const { User, Subscription, SubscriptionPlan } = require('../src/models');
  await User.updateOne(
    { _id: verified.body.data.user.id },
    { platformRole: 'admin' },
  );
  await SubscriptionPlan.findOneAndUpdate(
    { code: 'starter' },
    {
      code: 'starter',
      name: 'Starter',
      active: true,
      trialDays: 14,
      monthlyPricePaise: 29900,
      yearlyPricePaise: 299000,
      limits: { customers: 80, ordersPerMonth: 150, staffSeats: 1 },
      features: ['Basic profiles'],
      storeProducts: [],
    },
    { upsert: true, new: true },
  );
  const subscription = await Subscription.findOne({
    studioId: verified.body.data.studioId,
  });

  const response = await request(app)
    .post(`/api/v1/admin/subscriptions/${subscription.id}/test-grant`)
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .send({ plan: 'starter', durationDays: 7, note: 'Automated QA' })
    .expect(200);

  expect(response.body.data).toMatchObject({
    plan: 'starter',
    status: 'active',
    entitlementSource: 'admin_test',
    seatLimit: 1,
    adminGrant: { note: 'Automated QA' },
  });
  expect(new Date(response.body.data.periodEndsAt).getTime()).toBeGreaterThan(
    Date.now() + 6 * 86400000,
  );
  expect(response.body.data.productId).toBeUndefined();
});

test('platform admin can upload, preview, replace, and delete a garment diagram', async () => {
  const verified = await createAccount('+919876543216');
  const { User, GarmentTemplate, Media } = require('../src/models');
  await User.updateOne(
    { _id: verified.body.data.user.id },
    { platformRole: 'admin' },
  );
  const template = await GarmentTemplate.findOne({ scope: 'global' });

  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
  ]);
  const completed = await request(app)
    .put(`/api/v1/admin/garment-templates/${template.id}/diagram`)
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .set('Content-Type', 'image/png')
    .set('X-File-Name', 'kurta-guide.png')
    .send(png)
    .expect(200);

  const mediaId = completed.body.data.measurementDiagramMediaId;
  expect(mediaId).toBeTruthy();
  expect(completed.body.data.measurementDiagramUrl).toContain('https://media.example.test/');
  const mobileList = await request(app)
    .get('/api/v1/garment-templates?active=true')
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .expect(200);
  expect(
    mobileList.body.data.find((row) => row._id === template.id)
      .measurementDiagramUrl,
  ).toContain('https://media.example.test/');

  await request(app)
    .delete(`/api/v1/admin/garment-templates/${template.id}/diagram`)
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .expect(200);
  const deletedMedia = await Media.findById(mediaId);
  const updatedTemplate = await GarmentTemplate.findById(template.id);
  expect(deletedMedia.status).toBe('deleted');
  expect(updatedTemplate.measurementDiagramMediaId).toBeNull();
  expect(updatedTemplate.measurementDiagramUrl).toBe('');
});
