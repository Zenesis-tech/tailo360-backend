process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://placeholder/test';
process.env.JWT_ACCESS_SECRET = 'a-very-long-test-access-secret-that-is-at-least-32';
process.env.JWT_REFRESH_SECRET = 'a-very-long-test-refresh-secret-that-is-at-least-32';
process.env.EXPOSE_DEV_OTP = 'true';
process.env.OTP_DELIVERY_MODE = 'development';
process.env.PHONE_AUTH_MODE = 'server';
process.env.DEMO_ACCOUNT_ENABLED = 'false';
process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
process.env.BACKUP_R2_BUCKET = 'backup-test';

const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongo;
let app;
let mongoose;
let mockVerifyFirebaseIdToken;
let mockDeleteFirebaseUser;

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
    getObject: jest.fn(async () => null),
    deletePrefix: jest.fn(async () => ({})),
  }));
  mockVerifyFirebaseIdToken = jest.fn(async (token) => {
    if (token.startsWith('invalid')) throw new Error('invalid token');
    return {
      uid: 'firebase-phone-user',
      phone_number: '+919876543299',
      firebase: { sign_in_provider: 'phone' },
    };
  });
  mockDeleteFirebaseUser = jest.fn(async () => ({}));
  jest.doMock('../src/services/firebase-admin.service', () => ({
    firebaseAdmin: jest.fn(() => ({
      auth: () => ({
        verifyIdToken: mockVerifyFirebaseIdToken,
        deleteUser: mockDeleteFirebaseUser,
      }),
      messaging: () => ({ sendEachForMulticast: jest.fn() }),
    })),
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

test('owners manage staff and staff OTP login resolves the assigned studio', async () => {
  const owner = await createAccount('+919876543240');
  const ownerToken = owner.body.data.accessToken;
  const { Subscription } = require('../src/models');
  await Subscription.updateOne(
    { studioId: owner.body.data.studioId },
    { seatLimit: 3 },
  );

  const created = await request(app)
    .post('/api/v1/studio/members')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      name: 'Meera Tailor',
      phone: '+919000000240',
      role: 'master_tailor',
    })
    .expect(201);
  expect(created.body.data).toMatchObject({
    name: 'Meera Tailor',
    phone: '+919000000240',
    role: 'master_tailor',
    status: 'active',
    linked: false,
  });

  const staffLogin = await createAccount('+919000000240');
  expect(staffLogin.body.data).toMatchObject({
    isNew: false,
    needsOnboarding: false,
    studioId: owner.body.data.studioId,
    role: 'master_tailor',
    user: { name: 'Meera Tailor', phone: '+919000000240' },
  });
  const staffToken = staffLogin.body.data.accessToken;
  const staffProfile = await request(app)
    .get('/api/v1/auth/me')
    .set('Authorization', `Bearer ${staffToken}`)
    .expect(200);
  expect(staffProfile.body.data.membership).toMatchObject({
    role: 'master_tailor',
    status: 'active',
    permissions: expect.arrayContaining(['orders:write', 'customers:write']),
  });
  await request(app)
    .get('/api/v1/studio/members')
    .set('Authorization', `Bearer ${staffToken}`)
    .expect(403);

  const ownerMembers = await request(app)
    .get('/api/v1/studio/members')
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);
  const currentStaff = ownerMembers.body.data.find(
    (member) => member._id === created.body.data._id,
  );

  const paused = await request(app)
    .patch(`/api/v1/studio/members/${created.body.data._id}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ version: currentStaff.version, status: 'paused' })
    .expect(200);
  await request(app)
    .get('/api/v1/dashboard')
    .set('Authorization', `Bearer ${staffToken}`)
    .expect(401);

  const reactivated = await request(app)
    .patch(`/api/v1/studio/members/${created.body.data._id}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      version: paused.body.data.version,
      name: 'Meera Front Desk',
      role: 'front_desk',
      status: 'active',
    })
    .expect(200);
  const secondLogin = await createAccount('+919000000240');
  expect(secondLogin.body.data).toMatchObject({
    role: 'front_desk',
    user: { name: 'Meera Front Desk' },
  });

  await request(app)
    .delete(`/api/v1/studio/members/${created.body.data._id}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(204);
  await request(app)
    .get('/api/v1/dashboard')
    .set('Authorization', `Bearer ${secondLogin.body.data.accessToken}`)
    .expect(401);

  const members = await request(app)
    .get('/api/v1/studio/members')
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);
  expect(members.body.data.map((member) => member.role)).toEqual(['owner']);
  expect(reactivated.body.data.status).toBe('active');
  expect(reactivated.body.data.role).toBe('front_desk');
});

test('staff plans exclude the owner and limit only active staff members', async () => {
  const owner = await createAccount('+919876543250');
  const authorization = `Bearer ${owner.body.data.accessToken}`;

  for (const [index, role] of ['master_tailor', 'front_desk'].entries()) {
    await request(app)
      .post('/api/v1/studio/members')
      .set('Authorization', authorization)
      .send({
        name: `Staff Member ${index + 1}`,
        phone: `+91900000025${index}`,
        role,
      })
      .expect(201);
  }

  const rejected = await request(app)
    .post('/api/v1/studio/members')
    .set('Authorization', authorization)
    .send({
      name: 'Staff Member 3',
      phone: '+919000000252',
      role: 'front_desk',
    })
    .expect(403);
  expect(rejected.body.error.code).toBe('STAFF_LIMIT_REACHED');

  const usage = await request(app)
    .get('/api/v1/subscription/usage')
    .set('Authorization', authorization)
    .expect(200);
  expect(usage.body.data).toEqual({ staff: 2, limits: { staffSeats: 2 } });
});

test('language preference persists and is returned by the authenticated profile', async () => {
  const verified = await createAccount('+919876543211');
  const authorization = `Bearer ${verified.body.data.accessToken}`;

  const updated = await request(app)
    .patch('/api/v1/users/me/preferences')
    .set('Authorization', authorization)
    .send({ language: 'gu' })
    .expect(200);
  expect(updated.body.data.language).toBe('gu');

  const profile = await request(app)
    .get('/api/v1/auth/me')
    .set('Authorization', authorization)
    .expect(200);
  expect(profile.body.data.user.language).toBe('gu');

  const invalid = await request(app)
    .patch('/api/v1/users/me/preferences')
    .set('Authorization', authorization)
    .send({ language: 'xx' })
    .expect(422);
  expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
});

test('account deletion immediately removes the account and studio data', async () => {
  const phone = '+919876543212';
  const verified = await createAccount(phone);
  const authorization = `Bearer ${verified.body.data.accessToken}`;

  const deleted = await request(app)
    .delete('/api/v1/users/me')
    .set('Authorization', authorization)
    .expect(200);
  expect(deleted.body.data.deletedAt).toBeTruthy();
  await request(app)
    .get('/api/v1/auth/me')
    .set('Authorization', authorization)
    .expect(401);

  const { User, Studio, Member } = require('../src/models');
  expect(await User.findOne({ phone })).toBeNull();
  expect(await Studio.findById(verified.body.data.studioId)).toBeNull();
  expect(await Member.findOne({ studioId: verified.body.data.studioId })).toBeNull();
});

test('expired owner deletion permanently purges the studio, CRM data and media', async () => {
  const phone = '+918800000281';
  const verified = await createAccount(phone);
  const studioId = verified.body.data.studioId;
  const {
    User,
    Studio,
    Member,
    Customer,
    Measurement,
    GarmentTemplate,
    Order,
    Subscription,
    Media,
    Device,
    Notification,
    SupportTicket,
  } = require('../src/models');
  const r2 = require('../src/services/r2.service');
  const user = await User.findOne({ phone });
  const template = await GarmentTemplate.create({
    studioId,
    scope: 'studio',
    name: 'Purge Test Garment',
    audience: 'unisex',
    fields: [{ id: 'chest', name: 'Chest', unit: 'in', required: true, position: 1 }],
  });
  const customer = await Customer.create({
    studioId,
    name: 'Deletion Test Customer',
    phone: '+918800001281',
  });
  await Measurement.create({
    studioId,
    customerId: customer._id,
    templateId: template._id,
    version: 1,
    values: { chest: '38' },
    unit: 'in',
    createdBy: user._id,
  });
  await Order.create({
    studioId,
    customerId: customer._id,
    code: 'PURGE-213',
    deliveryDate: new Date(Date.now() + 86400000),
    totalPaise: 10000,
  });
  await Media.create({
    studioId,
    ownerUserId: user._id,
    objectKey: `${studioId}/voice/purge-213.m4a`,
    originalName: 'purge-213.m4a',
    contentType: 'audio/mp4',
    purpose: 'voice_note',
    status: 'ready',
  });
  await Device.create({
    studioId,
    userId: user._id,
    token: 'purge-device-213',
    platform: 'android',
  });
  await Notification.create({
    studioId,
    userId: user._id,
    type: 'purge_test',
    title: 'Purge test',
    body: 'Delete me',
  });
  await SupportTicket.create({
    studioId,
    subject: 'Purge test',
    category: 'account',
    messages: [{ body: 'Delete me', authorId: user._id }],
  });
  user.deletionScheduledFor = new Date(Date.now() - 1000);
  user.firebaseUid = 'firebase-purge-owner-281';
  await user.save();

  const { purgeExpiredAccounts } = require('../src/services/account-purge.service');
  const result = await purgeExpiredAccounts();
  expect(result).toMatchObject({ purged: 1, failures: [] });
  expect(mockDeleteFirebaseUser).toHaveBeenCalledWith('firebase-purge-owner-281');
  expect(r2.deleteObject).toHaveBeenCalledWith(`${studioId}/voice/purge-213.m4a`);
  expect(await User.countDocuments({ _id: user._id })).toBe(0);
  expect(await Studio.countDocuments({ _id: studioId })).toBe(0);
  expect(await Member.countDocuments({ studioId })).toBe(0);
  expect(await Customer.countDocuments({ studioId })).toBe(0);
  expect(await Measurement.countDocuments({ studioId })).toBe(0);
  expect(await Order.countDocuments({ studioId })).toBe(0);
  expect(await Subscription.countDocuments({ studioId })).toBe(0);
  expect(await Media.countDocuments({ studioId })).toBe(0);
  expect(await Device.countDocuments({ studioId })).toBe(0);
  expect(await Notification.countDocuments({ studioId })).toBe(0);
  expect(await SupportTicket.countDocuments({ studioId })).toBe(0);
});

test('expired staff deletion removes identity without deleting the shared studio', async () => {
  const ownerPhone = '+918800000282';
  const owner = await createAccount(ownerPhone);
  const studioId = owner.body.data.studioId;
  const staffPhone = '+918800000283';
  await request(app)
    .post('/api/v1/studio/members')
    .set('Authorization', `Bearer ${owner.body.data.accessToken}`)
    .send({ name: 'Deletion Test Staff', phone: staffPhone, role: 'front_desk' })
    .expect(201);
  await createAccount(staffPhone);

  const { User, Studio, Member, Customer, Media } = require('../src/models');
  const r2 = require('../src/services/r2.service');
  const staffUser = await User.findOne({ phone: staffPhone });
  const customer = await Customer.create({
    studioId,
    name: 'Shared Studio Customer',
    phone: '+918800001282',
  });
  const media = await Media.create({
    studioId,
    ownerUserId: staffUser._id,
    objectKey: `${studioId}/fabric/shared-214.jpg`,
    originalName: 'shared-214.jpg',
    contentType: 'image/jpeg',
    purpose: 'fabric_photo',
    status: 'ready',
  });
  staffUser.deletionScheduledFor = new Date(Date.now() - 1000);
  await staffUser.save();

  const { purgeAccount } = require('../src/services/account-purge.service');
  expect(await purgeAccount(staffUser._id)).toBe(true);
  expect(await User.countDocuments({ _id: staffUser._id })).toBe(0);
  expect(await Member.countDocuments({ userId: staffUser._id })).toBe(0);
  expect(await Studio.countDocuments({ _id: studioId })).toBe(1);
  expect(await Customer.countDocuments({ _id: customer._id })).toBe(1);
  const retainedMedia = await Media.findById(media._id).lean();
  expect(retainedMedia).not.toBeNull();
  const ownerUser = await User.findOne({ phone: ownerPhone });
  expect(String(retainedMedia.ownerUserId)).toBe(String(ownerUser._id));
  expect(r2.deleteObject).not.toHaveBeenCalledWith(`${studioId}/fabric/shared-214.jpg`);
});

test('the enabled demo account uses an isolated, reusable seeded studio', async () => {
  const env = require('../src/config/env');
  const previous = env.DEMO_ACCOUNT_ENABLED;
  env.DEMO_ACCOUNT_ENABLED = false;
  await createAccount('9876543210');
  const { User, Member, Studio, Customer } = require('../src/models');
  const demoUser = await User.findOne({ phone: '+919876543210' });
  const oldMembership = await Member.findOne({ userId: demoUser._id });
  const oldStudio = await Studio.findById(oldMembership.studioId);
  await Customer.create({
    studioId: oldStudio._id,
    name: 'Previous account customer',
    phone: '+919000000001',
  });
  env.DEMO_ACCOUNT_ENABLED = true;
  try {
    await request(app)
      .post('/api/v1/auth/otp/request')
      .send({ phone: '9876543210' })
      .expect(202);
    const verified = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: '9876543210', code: '111111' })
      .expect(200);
    expect(verified.body.data.isNew).toBe(false);
    expect(verified.body.data.needsOnboarding).toBe(false);
    expect(verified.body.data.studioId).not.toBe(oldStudio.id);
    expect((await Member.findById(oldMembership._id)).status).toBe('removed');
    const token = verified.body.data.accessToken;
    const customers = await request(app)
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const orders = await request(app)
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(customers.body.data.length).toBeGreaterThanOrEqual(5);
    expect(orders.body.data.length).toBeGreaterThanOrEqual(5);
    expect(
      customers.body.data.some(
        (customer) => customer.name === 'Previous account customer',
      ),
    ).toBe(false);
  } finally {
    env.DEMO_ACCOUNT_ENABLED = previous;
  }
});

test('Firebase phone ID token provisions a normal Tailo360 session', async () => {
  const env = require('../src/config/env');
  const previousMode = env.PHONE_AUTH_MODE;
  env.PHONE_AUTH_MODE = 'firebase';
  try {
    const config = await request(app).get('/api/v1/auth/config').expect(200);
    expect(config.body.data.phoneAuthMode).toBe('firebase');

    const verified = await request(app)
      .post('/api/v1/auth/firebase/phone')
      .send({ idToken: `valid-${'x'.repeat(120)}` })
      .expect(200);

    expect(verified.body.data.user.phone).toBe('+919876543299');
    expect(verified.body.data.accessToken).toBeTruthy();
    expect(verified.body.data.refreshToken).toBeTruthy();
    expect(mockVerifyFirebaseIdToken).toHaveBeenLastCalledWith(
      `valid-${'x'.repeat(120)}`,
    );

    await request(app)
      .post('/api/v1/auth/firebase/phone')
      .send({ idToken: `invalid-${'x'.repeat(120)}` })
      .expect(401)
      .expect(({ body }) => {
        expect(body.error.code).toBe('FIREBASE_TOKEN_INVALID');
      });

    await request(app)
      .post('/api/v1/auth/otp/request')
      .send({ phone: '+919876543299' })
      .expect(409);
  } finally {
    env.PHONE_AUTH_MODE = previousMode;
  }
});

test('API errors preserve stable codes and honor the requested language', async () => {
  const response = await request(app)
    .get('/api/v1/does-not-exist')
    .set('X-App-Language', 'mr')
    .expect(404);

  expect(response.headers['content-language']).toBe('mr');
  expect(response.body.error.code).toBe('NOT_FOUND');
  expect(response.body.error.message).toBe('मागितलेली नोंद सापडली नाही.');
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
    monthCollectedPaise: 0,
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

test('reports include period performance and current outstanding work', async () => {
  const verified = await createAccount('+919876543234');
  const { Customer, Order } = require('../src/models');
  const customer = await Customer.create({
    studioId: verified.body.data.studioId,
    name: 'Report Customer',
    phone: '+919000000234',
  });
  const oldOrder = await Order.create({
    studioId: verified.body.data.studioId,
    customerId: customer._id,
    code: 'RPT-OLD',
    status: 'stitching',
    orderDate: new Date(Date.now() - 45 * 86400000),
    deliveryDate: new Date(Date.now() - 2 * 86400000),
    totalPaise: 30000,
    lines: [{ name: 'Kurti', quantity: 1, lineTotalPaise: 30000 }],
    createdAt: new Date(Date.now() - 45 * 86400000),
  });
  const currentOrder = await Order.create({
    studioId: verified.body.data.studioId,
    customerId: customer._id,
    code: 'RPT-NEW',
    status: 'pending',
    orderDate: new Date(),
    deliveryDate: new Date(Date.now() + 2 * 86400000),
    totalPaise: 20000,
    lines: [{ name: 'Blouse', quantity: 2, lineTotalPaise: 20000 }],
    payments: [
      { amountPaise: 10000, direction: 'collection', method: 'upi', recordedAt: new Date() },
      { amountPaise: 5000, direction: 'refund', method: 'upi', recordedAt: new Date() },
    ],
  });
  const deliveredUnpaidOrder = await Order.create({
    studioId: verified.body.data.studioId,
    customerId: customer._id,
    code: 'RPT-DELIVERED-DUE',
    status: 'delivered',
    orderDate: new Date(Date.now() - 10 * 86400000),
    deliveryDate: new Date(Date.now() - 3 * 86400000),
    createdAt: new Date(Date.now() - 10 * 86400000),
    totalPaise: 15000,
    lines: [{ name: 'Trousers', quantity: 1, lineTotalPaise: 15000 }],
  });

  const response = await request(app)
    .get(`/api/v1/reports?from=${encodeURIComponent(new Date(Date.now() - 7 * 86400000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 1000).toISOString())}`)
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .expect(200);

  expect(response.body.data).toMatchObject({
    collectedPaise: 10000,
    refundedPaise: 5000,
    netRevenuePaise: 5000,
    netProfitPaise: 5000,
    bookedSalesPaise: 20000,
    orders: 1,
    uniqueCustomers: 1,
    statuses: { pending: 1 },
    paymentMethods: { upi: 5000 },
  });
  expect(response.body.data.duePayments.map((row) => row._id)).toEqual(
    expect.arrayContaining([
      oldOrder.id,
      currentOrder.id,
      deliveredUnpaidOrder.id,
    ]),
  );
  expect(response.body.data.overdueDeliveries[0]._id).toBe(oldOrder.id);
  expect(response.body.data.dueDeliveries[0]._id).toBe(currentOrder.id);
});

test('business report exports require report permission and validate ranges', async () => {
  const verified = await createAccount('+919876543235');
  const from = new Date(Date.now() - 7 * 86400000).toISOString();
  const to = new Date().toISOString();
  const token = verified.body.data.accessToken;

  for (const [format, type] of [
    ['pdf', 'application/pdf'],
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['csv', 'text/csv'],
  ]) {
    const response = await request(app)
      .get(`/api/v1/reports/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=${format}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.headers['content-type']).toContain(type);
    expect(response.headers['content-disposition']).toContain(`.${format}`);
  }

  const invalid = await request(app)
    .get(`/api/v1/reports/export?from=${encodeURIComponent(to)}&to=${encodeURIComponent(from)}&format=pdf`)
    .set('Authorization', `Bearer ${token}`)
    .expect(422);
  expect(invalid.body.error.code).toBe('INVALID_REPORT_RANGE');

  const { User, Member } = require('../src/models');
  const user = await User.create({ phone: '+919000000235' });
  const member = await Member.create({
    studioId: verified.body.data.studioId,
    userId: user._id,
    phone: user.phone,
    role: 'master_tailor',
  });
  const session = await require('../src/services/auth.service').issueSession(user, member);
  const forbidden = await request(app)
    .get(`/api/v1/reports/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=pdf`)
    .set('Authorization', `Bearer ${session.accessToken}`)
    .expect(403);
  expect(forbidden.body.error.code).toBe('FORBIDDEN');
});

test('studio owners can export their data while backup tooling stays platform-admin only', async () => {
  const owner = await createAccount('+919876543230');
  const ownerToken = owner.body.data.accessToken;
  const exported = await request(app)
    .get('/api/v1/studio/export')
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);
  expect(exported.headers['content-disposition']).toContain('data-export');
  expect(exported.body).toMatchObject({ schemaVersion: 1 });
  expect(exported.body.studio._id).toBe(owner.body.data.studioId);

  await request(app)
    .get('/api/v1/admin/backups')
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(403);

  const { User } = require('../src/models');
  await User.findByIdAndUpdate(owner.body.data.user.id, { platformRole: 'admin' });
  const adminSession = await require('../src/services/auth.service').issueSession(
    await User.findById(owner.body.data.user.id),
    await require('../src/models').Member.findOne({ userId: owner.body.data.user.id }),
  );
  const backups = await request(app)
    .get('/api/v1/admin/backups')
    .set('Authorization', `Bearer ${adminSession.accessToken}`)
    .expect(200);
  expect(backups.body.data).toEqual([]);
});

test('cash recorded through the payment endpoint appears in net collections', async () => {
  const verified = await createAccount('+919876543239');
  const { Customer, Order } = require('../src/models');
  const customer = await Customer.create({
    studioId: verified.body.data.studioId,
    name: 'Cash Report Customer',
    phone: '+919000000239',
  });
  const order = await Order.create({
    studioId: verified.body.data.studioId,
    customerId: customer._id,
    code: 'RPT-CASH',
    status: 'pending',
    orderDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
    totalPaise: 12000,
    lines: [{ name: 'Shirt', quantity: 1, lineTotalPaise: 12000 }],
  });

  const paymentResponse = await request(app)
    .post('/api/v1/payments')
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .send({ orderId: order.id, amountPaise: 7000, method: 'cash' })
    .expect(201);
  expect(paymentResponse.body.data.customerId).toMatchObject({
    name: 'Cash Report Customer',
    phone: '+919000000239',
  });

  const report = await request(app)
    .get(`/api/v1/reports?from=${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 1000).toISOString())}`)
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .expect(200);

  expect(report.body.data).toMatchObject({
    collectedPaise: 7000,
    refundedPaise: 0,
    netRevenuePaise: 7000,
    netProfitPaise: 7000,
    paymentMethods: { cash: 7000 },
  });

  const dashboard = await request(app)
    .get('/api/v1/dashboard')
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .expect(200);
  expect(dashboard.body.data.monthCollectedPaise).toBe(7000);
});

test('notification history tracks unread state and supports admin targeting', async () => {
  const adminAccount = await createAccount('+919876543231');
  const recipient = await createAccount('+919876543232');
  const { User } = require('../src/models');
  await User.updateOne(
    { phone: '+919876543231' },
    { platformRole: 'admin' },
  );

  const campaign = await request(app)
    .post('/api/v1/admin/notifications/send')
    .set('Authorization', `Bearer ${adminAccount.body.data.accessToken}`)
    .send({
      target: 'users',
      userIds: [recipient.body.data.user.id],
      title: 'Planned maintenance',
      body: 'Tailo360 will be updated tonight.',
      data: { route: 'subscription' },
    })
    .expect(201);
  expect(campaign.body.data.recipientCount).toBe(1);

  const adminHistory = await request(app)
    .get('/api/v1/admin/notifications?source=admin')
    .set('Authorization', `Bearer ${adminAccount.body.data.accessToken}`)
    .expect(200);
  expect(adminHistory.body.data[0]).toMatchObject({
    title: 'Planned maintenance',
    source: 'admin',
    userId: { _id: recipient.body.data.user.id },
  });
  expect(adminHistory.body.data[0].studioId.name).toBeTruthy();

  const history = await request(app)
    .get('/api/v1/notifications')
    .set('Authorization', `Bearer ${recipient.body.data.accessToken}`)
    .expect(200);
  expect(history.body.meta.unreadCount).toBe(1);
  expect(history.body.data[0]).toMatchObject({
    title: 'Planned maintenance',
    source: 'admin',
  });
  expect(history.body.data[0].readAt).toBeFalsy();

  await request(app)
    .patch(`/api/v1/notifications/${history.body.data[0]._id}/read`)
    .set('Authorization', `Bearer ${recipient.body.data.accessToken}`)
    .expect(200);
  const count = await request(app)
    .get('/api/v1/notifications/unread-count')
    .set('Authorization', `Bearer ${recipient.body.data.accessToken}`)
    .expect(200);
  expect(count.body.data.count).toBe(0);
});

test('same-day order reminders are caught after 8 AM and remain deduplicated', async () => {
  const account = await createAccount('+919876543234');
  const { Customer, Notification, Order } = require('../src/models');
  const { runReminders } = require('../src/services/reminder-jobs.service');
  const studioId = account.body.data.studioId;
  const customer = await Customer.create({
    studioId,
    name: 'Reminder Customer',
    phone: '+919000000234',
  });
  const reminderDate = new Date('2026-08-21T00:00:00.000Z');
  const order = await Order.create({
    studioId,
    customerId: customer._id,
    code: 'REM-234',
    orderDate: reminderDate,
    reminderDate,
    deliveryDate: new Date('2026-08-30T00:00:00.000Z'),
    lines: [],
    payments: [],
    totalPaise: 0,
  });

  await runReminders(new Date('2026-08-21T01:30:00.000Z')); // 07:00 IST
  expect(await Notification.countDocuments({
    type: 'order_reminder',
    'data.orderId': order.id,
  })).toBe(0);

  const afterEight = new Date('2026-08-21T04:00:00.000Z'); // 09:30 IST
  await runReminders(afterEight);
  await runReminders(afterEight);
  const reminders = await Notification.find({
    type: 'order_reminder',
    'data.orderId': order.id,
  });
  expect(reminders).toHaveLength(1);
  expect(reminders[0]).toMatchObject({
    source: 'reminder',
    title: 'Order reminder',
    status: 'stored',
  });
});

test('delivery and trial switches create or remove queued order reminders', async () => {
  const account = await createAccount('+919876543232');
  const { Customer, Notification, Order } = require('../src/models');
  const { scheduleOrderReminders } = require('../src/services/reminder-jobs.service');
  const studioId = account.body.data.studioId;
  const customer = await Customer.create({
    studioId,
    name: 'Scheduled Reminder Customer',
    phone: '+919000000232',
  });
  const order = await Order.create({
    studioId,
    customerId: customer._id,
    code: 'REM-232',
    orderDate: new Date('2026-08-20T00:00:00.000Z'),
    trialDate: new Date('2026-08-22T00:00:00.000Z'),
    deliveryDate: new Date('2026-08-24T00:00:00.000Z'),
    lines: [],
    payments: [],
    totalPaise: 0,
  });

  await scheduleOrderReminders(order, { delivery: true, trial: true });
  const queued = await Notification.find({
    'data.orderId': order.id,
    status: 'queued',
  }).sort({ type: 1 });
  expect(queued).toHaveLength(2);
  expect(queued.map((item) => item.scheduledFor instanceof Date)).toEqual([true, true]);

  await scheduleOrderReminders(order, { delivery: false, trial: false });
  expect(await Notification.countDocuments({
    'data.orderId': order.id,
    status: 'queued',
  })).toBe(0);
});

test('FCM device registration refreshes metadata and can be deactivated', async () => {
  const account = await createAccount('+919876543233');
  const token = `test-fcm-token-${'x'.repeat(40)}`;
  await request(app)
    .post('/api/v1/devices')
    .set('Authorization', `Bearer ${account.body.data.accessToken}`)
    .send({ token, platform: 'android', appVersion: '0.1.0+1', locale: 'en_IN' })
    .expect(201);
  const { Device } = require('../src/models');
  expect(await Device.countDocuments({ token, active: true })).toBe(1);
  await request(app)
    .delete('/api/v1/devices')
    .set('Authorization', `Bearer ${account.body.data.accessToken}`)
    .send({ token })
    .expect(204);
  expect(await Device.countDocuments({ token, active: false })).toBe(1);
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
  const verified = await createAccount('+918800000284', { garmentAudiences: ['women'] });
  const profile = await request(app)
    .get('/api/v1/auth/me')
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .expect(200);
  expect(profile.body.data.studio.settings.garmentAudiences).toEqual(['women']);

  const templates = await request(app)
    .get('/api/v1/garment-templates')
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .expect(200);
  expect(templates.body.data).toHaveLength(13);
  expect(templates.body.data.every((template) => template.audience === 'women')).toBe(true);
  expect(templates.body.data.map((template) => template.name)).toEqual(
    expect.arrayContaining([
      'Blouse',
      'Kurti',
      'Salwar suit',
      'Lehenga',
      'Anarkali',
      'Petticoat',
      'Women’s trousers',
    ]),
  );
});

test('settings audience toggles immediately filter order garments', async () => {
  const verified = await createAccount('+919876543222', {
    garmentAudiences: ['women'],
  });
  const token = verified.body.data.accessToken;

  await request(app)
    .patch('/api/v1/studio')
    .set('Authorization', `Bearer ${token}`)
    .send({ settings: { garmentAudiences: ['kids'] } })
    .expect(200);

  const templates = await request(app)
    .get('/api/v1/garment-templates?active=true')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  expect(templates.body.data).toHaveLength(7);
  expect(
    templates.body.data.every((template) => template.audience === 'kids'),
  ).toBe(true);
  expect(templates.body.data.map((template) => template.name)).toEqual(
    expect.arrayContaining([
      'Kids shirt',
      'Kids trousers',
      'Kids dress',
      'Kids frock',
      'Kids kurta pyjama',
      'School uniform',
    ]),
  );
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

  const servicesUpdated = await request(app)
    .patch('/api/v1/studio')
    .set('Authorization', `Bearer ${token}`)
    .send({ services: ['mens_wear', 'kids_wear', 'alteration'] })
    .expect(200);
  expect(servicesUpdated.body.data.settings.garmentAudiences).toEqual(
    expect.arrayContaining(['men', 'kids']),
  );
  const updatedTemplates = await request(app)
    .get('/api/v1/garment-templates?active=true')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  expect(updatedTemplates.body.data.some((template) => template.audience === 'kids')).toBe(true);
});

test('standard garments are global while studio-created garments stay private', async () => {
  const { GarmentTemplate } = require('../src/models');
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

  const globalWithChest = await GarmentTemplate.findOne({
    scope: 'global',
    'fields.name': 'Chest',
  });
  const globalChest = globalWithChest.fields.find((field) => field.name === 'Chest');
  globalChest.iconKey = 'chest';
  globalChest.iconUrl = 'https://cdn.example.com/measurement-icons/chest.png';
  await globalWithChest.save();

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

  const globalShirt = firstList.body.data.find((row) => row.name === 'Shirt');
  const override = await request(app)
    .post('/api/v1/garment-templates/clone')
    .set('Authorization', `Bearer ${first.body.data.accessToken}`)
    .send({ templateId: globalShirt._id, name: globalShirt.name })
    .expect(201);
  await request(app)
    .patch(`/api/v1/garment-templates/${override.body.data._id}`)
    .set('Authorization', `Bearer ${first.body.data.accessToken}`)
    .send({
      version: override.body.data.version,
      fields: [{ name: 'Studio Shirt Length', unit: 'in' }],
    })
    .expect(200);

  const firstAfterOverride = await request(app)
    .get('/api/v1/garment-templates?active=true')
    .set('Authorization', `Bearer ${first.body.data.accessToken}`)
    .expect(200);
  const visibleShirts = firstAfterOverride.body.data.filter(
    (row) => row.name === 'Shirt',
  );
  expect(visibleShirts).toHaveLength(1);
  expect(visibleShirts[0]).toMatchObject({ scope: 'studio' });
  expect(visibleShirts[0].fields[0].name).toBe('Studio Shirt Length');
  const customAfter = firstAfterOverride.body.data.find(
    (row) => row.name === 'Custom ceremonial coat',
  );
  expect(customAfter.fields[0]).toMatchObject({
    name: 'Chest',
    iconKey: 'chest',
    iconUrl: 'https://cdn.example.com/measurement-icons/chest.png',
  });

  const secondAfter = await request(app)
    .get('/api/v1/garment-templates?active=true')
    .set('Authorization', `Bearer ${second.body.data.accessToken}`)
    .expect(200);
  expect(secondAfter.body.data.some((row) => row.name === 'Custom ceremonial coat')).toBe(false);
  expect(secondAfter.body.data.find((row) => row.name === 'Shirt').scope).toBe('global');
});

test('garment templates persist a backend-managed measurement diagram', async () => {
  const verified = await createAccount('+919876543213');
  const diagram = 'https://cdn.example.com/measurement-guides/shirt.png';
  const fieldIcon = 'https://cdn.example.com/measurement-icons/chest.png';
  const created = await request(app)
    .post('/api/v1/garment-templates')
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .send({
      name: 'Diagram Shirt',
      audience: 'men',
      measurementDiagramUrl: diagram,
      fields: [{ name: 'Chest', iconKey: 'chest', iconUrl: fieldIcon, unit: 'in', required: true }],
    })
    .expect(201);

  expect(created.body.data.measurementDiagramUrl).toBe(diagram);
  expect(created.body.data.fields[0]).toMatchObject({
    name: 'Chest',
    iconKey: 'chest',
    iconUrl: fieldIcon,
  });
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
      name: '2 Staff',
      active: true,
      trialDays: 14,
      monthlyPricePaise: 4900,
      yearlyPricePaise: 47040,
      limits: { customers: -1, ordersPerMonth: -1, staffSeats: 2 },
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
  const profileValues = Object.fromEntries(
    kurti.fields
      .filter((field) => field.active !== false)
      .map((field) => [field.name, '40']),
  );
  const savedProfile = await request(app)
    .put(`/api/v1/customers/${customer.id}/measurements/${kurti._id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ values: profileValues, customizations: {}, unit: 'in' })
    .expect(201);
  expect(savedProfile.body.data.values).toEqual(profileValues);
  const currentProfiles = await request(app)
    .get(`/api/v1/customers/${customer.id}/measurements`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  expect(currentProfiles.body.data[0].values).toEqual(profileValues);

  const created = await request(app)
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      customerId: customer.id,
      deliveryDate: new Date(Date.now() + 86400000).toISOString(),
      priority: 'urgent',
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
  expect(stored.priority).toBe('urgent');

  const detail = await request(app)
    .get(`/api/v1/orders/${created.body.data._id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  expect(detail.body.data.lines[0].measurements).toEqual({
    Chest: '40',
    Length: '44',
    Waist: '36',
  });
  expect(detail.body.data.priority).toBe('urgent');

  const profilesAfterOrder = await request(app)
    .get(`/api/v1/customers/${customer.id}/measurements`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  expect(profilesAfterOrder.body.data[0].values).toEqual(profileValues);

  await Order.updateOne(
    { _id: stored._id },
    { createdAt: new Date(Date.now() - 86400000) },
  );
  const newer = await Order.create({
    studioId: verified.body.data.studioId,
    customerId: customer.id,
    code: 'LATEST-ORDER',
    status: 'pending',
    orderDate: new Date(),
    deliveryDate: new Date(Date.now() + 2 * 86400000),
    priority: 'high',
    totalPaise: 180000,
    lines: [{
      templateId: kurti._id,
      name: 'Kurti',
      quantity: 1,
      unitPricePaise: 180000,
      lineTotalPaise: 180000,
      measurements: { Chest: '40' },
    }],
  });
  const latestFirst = await request(app)
    .get('/api/v1/orders')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  expect(latestFirst.body.data[0]._id).toBe(newer.id);

  const returningCustomer = await Customer.create({
    studioId: verified.body.data.studioId,
    name: 'Returning Order Client',
    phone: '+919000000221',
  });
  await Order.create({
    studioId: verified.body.data.studioId,
    customerId: returningCustomer.id,
    code: 'RETURNING-ORDER',
    status: 'delivered',
    orderDate: new Date(),
    deliveryDate: new Date(),
    totalPaise: 180000,
    lines: [{
      templateId: kurti._id,
      name: 'Kurti',
      quantity: 1,
      unitPricePaise: 180000,
      lineTotalPaise: 180000,
      measurements: { Bust: '39', Waist: '35' },
      customizations: {},
      measurementSource: 'fresh',
    }],
  });
  const measurementsFromOrder = await request(app)
    .get(`/api/v1/customers/${returningCustomer.id}/measurements`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  expect(measurementsFromOrder.body.data).toHaveLength(1);
  expect(measurementsFromOrder.body.data[0]).toMatchObject({
    templateId: kurti._id,
    values: { Bust: '39', Waist: '35' },
    source: 'order',
    template: { name: 'Kurti' },
  });
});

test('subscription products are filtered for the requesting store', async () => {
  const verified = await createAccount('+919876543214');
  const { SubscriptionPlan } = require('../src/models');
  await SubscriptionPlan.findOneAndUpdate({ code: 'studio' }, {
    code: 'studio',
    name: '5 Staff',
    active: true,
    trialDays: 14,
    monthlyPricePaise: 9900,
    yearlyPricePaise: 95040,
    limits: { customers: -1, ordersPerMonth: -1, staffSeats: 5 },
    features: ['Reports'],
    storeProducts: [
      {
        platform: 'google',
        productId: 'tailo360_5_staff_monthly',
        period: 'monthly',
        active: true,
      },
      {
        platform: 'apple',
        productId: 'tailo360.5staff.monthly',
        period: 'monthly',
        active: true,
      },
    ],
  }, { upsert: true, new: true });

  const response = await request(app)
    .get('/api/v1/subscription/products?platform=google')
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .expect(200);
  expect(response.body.data).toEqual([
    expect.objectContaining({
      id: 'tailo360_5_staff_monthly',
      platform: 'google',
      plan: 'studio',
      period: 'monthly',
    }),
  ]);
});

test('subscription catalogue migration replaces legacy Pro plans', async () => {
  const verified = await createAccount('+919876543253');
  const { Subscription, SubscriptionPlan } = require('../src/models');
  const { syncSubscriptionPlans } = require('../src/services/subscription-plan-catalog.service');
  await SubscriptionPlan.create({
    code: 'pro',
    name: 'Legacy Pro',
    active: true,
    trialDays: 14,
    monthlyPricePaise: 69900,
    yearlyPricePaise: 699000,
    limits: { customers: -1, ordersPerMonth: -1, staffSeats: 1 },
    features: [],
    storeProducts: [
      {
        platform: 'google',
        productId: 'tailo360_legacy_pro_monthly',
        period: 'monthly',
        active: true,
      },
    ],
  });
  await Subscription.updateOne(
    { studioId: verified.body.data.studioId },
    { $set: { plan: 'pro', seatLimit: 1 } },
  );

  await syncSubscriptionPlans();

  expect(await SubscriptionPlan.findOne({ code: 'pro' })).toBeNull();
  const starterPlan = await SubscriptionPlan.findOne({ code: 'starter' });
  expect(starterPlan).toMatchObject({
    name: '2 Staff',
    monthlyPricePaise: 4900,
    yearlyPricePaise: 47040,
    limits: { customers: -1, ordersPerMonth: -1, staffSeats: 2 },
    legacyStoreProducts: [
      expect.objectContaining({
        platform: 'google',
        productId: 'tailo360_legacy_pro_monthly',
        period: 'monthly',
      }),
    ],
  });
  const { planFor } = require('../src/services/store-verification.service');
  await expect(
    planFor('tailo360_legacy_pro_monthly', 'google'),
  ).resolves.toMatchObject({ code: 'starter' });
  expect(
    await Subscription.findOne({ studioId: verified.body.data.studioId }),
  ).toMatchObject({ plan: 'starter', seatLimit: 2 });
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
      name: '2 Staff',
      active: true,
      trialDays: 14,
      monthlyPricePaise: 4900,
      yearlyPricePaise: 47040,
      limits: { customers: -1, ordersPerMonth: -1, staffSeats: 2 },
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
    seatLimit: 2,
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

  const fieldId = template.fields[0]._id;
  const fieldIcon = await request(app)
    .put(`/api/v1/admin/garment-templates/${template.id}/fields/${fieldId}/icon`)
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .set('Content-Type', 'image/png')
    .set('X-File-Name', 'length-icon.png')
    .send(png)
    .expect(200);
  expect(fieldIcon.body.data.fields[0].iconMediaId).toBeTruthy();
  expect(fieldIcon.body.data.fields[0].iconUrl).toContain('https://media.example.test/');

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

test('platform admin can delete unused garments but referenced garments are protected', async () => {
  const verified = await createAccount('+919876543217');
  const { User, GarmentTemplate, Price } = require('../src/models');
  await User.updateOne(
    { _id: verified.body.data.user.id },
    { platformRole: 'admin' },
  );

  const unused = await GarmentTemplate.create({
    studioId: null,
    scope: 'global',
    name: 'Temporary unused garment',
    audience: 'unisex',
    fields: [],
  });
  const deleted = await request(app)
    .delete(`/api/v1/admin/garment-templates/${unused.id}`)
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .send({ version: unused.version })
    .expect(200);
  expect(deleted.body.data).toMatchObject({
    id: unused.id,
    name: 'Temporary unused garment',
    deleted: true,
  });
  expect(await GarmentTemplate.findById(unused.id)).toBeNull();

  const used = await GarmentTemplate.create({
    studioId: null,
    scope: 'global',
    name: 'Temporary referenced garment',
    audience: 'unisex',
    fields: [],
  });
  await Price.create({
    studioId: verified.body.data.studioId,
    templateId: used._id,
    amountPaise: 10000,
  });
  const blocked = await request(app)
    .delete(`/api/v1/admin/garment-templates/${used.id}`)
    .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
    .send({ version: used.version })
    .expect(409);
  expect(blocked.body.error.code).toBe('GARMENT_TEMPLATE_IN_USE');
  expect(blocked.body.error.details.prices).toBe(1);
  expect(await GarmentTemplate.findById(used.id)).not.toBeNull();
});

test('referral center redeems a live signup offer and returns real reward history', async () => {
  const referrer = await createAccount('+919876543223', { studioName: 'Referrer Studio' });
  const referee = await createAccount('+919876543224', { studioName: 'New Studio' });
  const { ReferralRewardConfig, Studio, Subscription } = require('../src/models');
  await ReferralRewardConfig.updateMany({ active: true }, { active: false });
  await ReferralRewardConfig.create({
    version: 9001,
    active: true,
    qualifyingCondition: 'signup_complete',
    reward: { type: 'account_credit', value: 125 },
    expiryDays: 30,
  });
  const referrerStudio = await Studio.findById(referrer.body.data.studioId);

  const redeemed = await request(app)
    .post('/api/v1/referral/redeem')
    .set('Authorization', `Bearer ${referee.body.data.accessToken}`)
    .send({ code: referrerStudio.referralCode.toLowerCase() })
    .expect(201);
  expect(redeemed.body.data.status).toBe('rewarded');
  expect((await Subscription.findOne({ studioId: referrerStudio._id })).referralCreditPaise).toBe(12500);

  const duplicate = await request(app)
    .post('/api/v1/referral/redeem')
    .set('Authorization', `Bearer ${referee.body.data.accessToken}`)
    .send({ code: referrerStudio.referralCode })
    .expect(409);
  expect(duplicate.body.error.code).toBe('REFERRAL_ALREADY_REDEEMED');
  expect((await Subscription.findOne({ studioId: referrerStudio._id })).referralCreditPaise).toBe(12500);

  const center = await request(app)
    .get('/api/v1/referral')
    .set('Authorization', `Bearer ${referrer.body.data.accessToken}`)
    .expect(200);
  expect(center.body.data.offer).toMatchObject({
    qualifyingCondition: 'signup_complete',
    reward: { type: 'account_credit', value: 125 },
    expiryDays: 30,
  });
  expect(center.body.data.summary).toMatchObject({ rewarded: 1, earnedCreditPaise: 12500 });
  expect(center.body.data.history[0]).toMatchObject({ studioName: 'New Studio', status: 'rewarded' });

  const applied = await request(app)
    .get('/api/v1/referral')
    .set('Authorization', `Bearer ${referee.body.data.accessToken}`)
    .expect(200);
  expect(applied.body.data.appliedReferral).toMatchObject({
    code: referrerStudio.referralCode,
    studioName: 'Referrer Studio',
    status: 'rewarded',
  });
});

test('paid referral reward is idempotent when triggered concurrently', async () => {
  const referrer = await createAccount('+919876543225');
  const referee = await createAccount('+919876543226');
  const { Referral, Subscription } = require('../src/models');
  const { rewardReferralForStudio } = require('../src/services/subscription-lifecycle.service');
  const before = await Subscription.findOne({ studioId: referrer.body.data.studioId });
  const originalTrialEnd = before.trialEndsAt.getTime();
  await Referral.create({
    referrerStudioId: referrer.body.data.studioId,
    refereeStudioId: referee.body.data.studioId,
    code: 'TESTREF',
    qualifyingCondition: 'first_paid_subscription',
    reward: { type: 'trial_extension_days', value: 3 },
    expiresAt: new Date(Date.now() + 86400000),
  });

  await Promise.all([
    rewardReferralForStudio(referee.body.data.studioId),
    rewardReferralForStudio(referee.body.data.studioId),
    rewardReferralForStudio(referee.body.data.studioId),
  ]);

  const after = await Subscription.findOne({ studioId: referrer.body.data.studioId });
  expect(after.trialEndsAt.getTime() - originalTrialEnd).toBe(3 * 86400000);
  expect((await Referral.findOne({ refereeStudioId: referee.body.data.studioId })).status).toBe('rewarded');
});

test('a capped new-studio subscription offer is claimed only up to its limit', async () => {
  const { SubscriptionOffer, Subscription } = require('../src/models');
  const offer = await SubscriptionOffer.create({
    code: 'LAUNCH_ONE',
    title: 'Launch offer',
    active: true,
    benefit: { type: 'trial_days', durationDays: 90, plan: 'starter' },
    eligibility: { audience: 'new_studios', maxRedemptions: 1 },
  });

  const [first, second] = await Promise.all([
    createAccount('+919876544101'),
    createAccount('+919876544102'),
  ]);
  const subscriptions = await Subscription.find({
    studioId: { $in: [first.body.data.studioId, second.body.data.studioId] },
  });
  const promoted = subscriptions.filter((subscription) => subscription.entitlementSource === 'promotion');
  expect(promoted).toHaveLength(1);
  expect(promoted[0].promotion.code).toBe('LAUNCH_ONE');
  expect((await SubscriptionOffer.findById(offer._id)).redemptionCount).toBe(1);
});

test('support config is available to signed-in studios and contact support creates an admin ticket', async () => {
  const account = await createAccount('+919876544103');
  const { AppConfig, SupportTicket } = require('../src/models');
  await AppConfig.findOneAndUpdate(
    { key: 'platform' },
    { key: 'platform', support: { whatsappNumber: '+919876543210', deliveryMode: 'both' } },
    { upsert: true },
  );
  const config = await request(app)
    .get('/api/v1/support/config')
    .set('Authorization', `Bearer ${account.body.data.accessToken}`)
    .expect(200);
  expect(config.body.data).toMatchObject({
    whatsappNumber: '+919876543210',
    deliveryMode: 'both',
  });
  await request(app)
    .post('/api/v1/support/tickets')
    .set('Authorization', `Bearer ${account.body.data.accessToken}`)
    .send({
      subject: 'Need help with an order',
      category: 'order_workflow',
      message: 'Please help me update a customer order.',
    })
    .expect(201);
  expect(await SupportTicket.countDocuments({ studioId: account.body.data.studioId })).toBe(1);
});
