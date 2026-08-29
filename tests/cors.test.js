process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://placeholder/test';
process.env.JWT_ACCESS_SECRET = 'a-very-long-test-access-secret-that-is-at-least-32';
process.env.JWT_REFRESH_SECRET = 'a-very-long-test-refresh-secret-that-is-at-least-32';
process.env.ALLOWED_ORIGINS = ' https://admin.tailo360.com ';

jest.mock('../src/config/db', () => ({
  connectDatabase: jest.fn(async () => {}),
  databaseStatus: jest.fn(() => ({ ready: true })),
}));

const request = require('supertest');
const app = require('../src/app');

test('production admin origin passes the CORS preflight', async () => {
  const response = await request(app)
    .options('/api/v1/auth/admin/login')
    .set('Origin', 'https://admin.tailo360.com')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'content-type')
    .expect(204);

  expect(response.headers['access-control-allow-origin']).toBe(
    'https://admin.tailo360.com',
  );
  expect(response.headers['access-control-allow-methods']).toContain('POST');
  expect(response.headers.vary).toContain('Origin');
});

test('untrusted browser origin is rejected by CORS', async () => {
  const response = await request(app)
    .options('/api/v1/auth/admin/login')
    .set('Origin', 'https://attacker.example')
    .set('Access-Control-Request-Method', 'POST')
    .expect(403);

  expect(response.headers['access-control-allow-origin']).toBeUndefined();
  expect(response.body.error.code).toBe('CORS_NOT_ALLOWED');
});
