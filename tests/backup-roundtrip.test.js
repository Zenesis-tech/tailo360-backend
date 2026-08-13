process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://placeholder/test";
process.env.JWT_ACCESS_SECRET = "a-very-long-test-access-secret-that-is-at-least-32";
process.env.JWT_REFRESH_SECRET = "a-very-long-test-refresh-secret-that-is-at-least-32";
process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
process.env.R2_ACCOUNT_ID = "test";
process.env.R2_BUCKET = "test";
process.env.R2_ACCESS_KEY_ID = "test";
process.env.R2_SECRET_ACCESS_KEY = "test";
process.env.BACKUP_R2_BUCKET = "backup-test";

const { MongoMemoryServer } = require("mongodb-memory-server");

let mongo;
let mongoose;
let models;
let backupService;
let storage;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  jest.resetModules();
  storage = new Map();
  jest.doMock("../src/services/r2.service", () => ({
    putObject: jest.fn(async ({ key, body }) => storage.set(key, Buffer.from(body))),
    getObject: jest.fn(async (key) => storage.get(key) || null),
    deletePrefix: jest.fn(async (prefix) => {
      for (const key of storage.keys()) if (key.startsWith(prefix)) storage.delete(key);
    }),
  }));
  mongoose = require("mongoose");
  await require("../src/config/db").connectDatabase();
  models = require("../src/models");
  backupService = require("../src/services/backup.service");
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test("database and media complete an encrypted backup/restore round trip", async () => {
  const user = await models.User.create({ phone: "+919000000001", name: "Before backup" });
  await models.Media.create({
    ownerUserId: user._id,
    objectKey: "studio/fabric.jpg",
    originalName: "fabric.jpg",
    contentType: "image/jpeg",
    sizeBytes: 12,
    purpose: "fabric_photo",
    status: "ready",
  });
  storage.set("studio/fabric.jpg", Buffer.from("original-media"));

  const backup = await backupService.createBackup({ reason: "manual", createdBy: user._id });
  expect(backup.status).toBe("completed");
  expect(backup.documentCount).toBeGreaterThanOrEqual(2);
  expect(backup.mediaCount).toBe(1);
  expect(storage.get(backup.manifestKey).includes(Buffer.from("original-media"))).toBe(false);

  await models.User.findByIdAndUpdate(user._id, { name: "Changed later" });
  storage.set("studio/fabric.jpg", Buffer.from("changed-media"));
  await backupService.restoreBackup(backup, { restoredBy: user._id });

  expect((await models.User.findById(user._id)).name).toBe("Before backup");
  expect(storage.get("studio/fabric.jpg").toString()).toBe("original-media");
});
