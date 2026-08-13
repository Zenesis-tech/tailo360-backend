process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://placeholder/test";
process.env.JWT_ACCESS_SECRET = "a-very-long-test-access-secret-that-is-at-least-32";
process.env.JWT_REFRESH_SECRET = "a-very-long-test-refresh-secret-that-is-at-least-32";
process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.BACKUP_R2_BUCKET = "backup-test";

const { encrypt, decrypt } = require("../src/services/backup.service");

test("backup payloads use authenticated encryption", () => {
  const clear = Buffer.from("private studio database and media");
  const encrypted = encrypt(clear);
  expect(encrypted.equals(clear)).toBe(false);
  expect(encrypted.subarray(0, 8).toString()).toBe("T360BK01");
  expect(decrypt(encrypted)).toEqual(clear);
});

test("tampered backup payloads cannot be decrypted", () => {
  const encrypted = encrypt(Buffer.from("private records"));
  encrypted[encrypted.length - 1] ^= 1;
  expect(() => decrypt(encrypted)).toThrow("could not be decrypted");
});
