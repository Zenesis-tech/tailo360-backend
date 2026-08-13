const crypto = require("crypto");
const os = require("os");
const { promisify } = require("util");
const zlib = require("zlib");
const mongoose = require("mongoose");
const env = require("../config/env");
const { BackupRecord, BackupLock, Media } = require("../models");
const r2 = require("./r2.service");
const { AppError } = require("../utils/errors");

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const EJSON = mongoose.mongo.BSON.EJSON;
const MAGIC = Buffer.from("T360BK01");
const excludedCollections = new Set([
  "backuprecords",
  "backuplocks",
  "otps",
  "sessions",
  "realtimeevents",
]);

function encryptionKey() {
  const configured = env.BACKUP_ENCRYPTION_KEY.trim();
  const key = /^[a-f0-9]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32) {
    throw new AppError(503, "BACKUP_NOT_CONFIGURED", "Backup encryption is not configured.");
  }
  return key;
}

function backupBucket() {
  if (!env.BACKUP_R2_BUCKET) {
    throw new AppError(503, "BACKUP_NOT_CONFIGURED", "A separate backup bucket is not configured.");
  }
  return env.BACKUP_R2_BUCKET;
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
}

function decrypt(value) {
  if (!value.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new AppError(422, "BACKUP_INVALID", "The backup artifact is invalid.");
  }
  const iv = value.subarray(8, 20);
  const tag = value.subarray(20, 36);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(value.subarray(36)), decipher.final()]);
  } catch (_) {
    throw new AppError(422, "BACKUP_DECRYPTION_FAILED", "The backup could not be decrypted with the configured key.");
  }
}

async function acquireLock() {
  const owner = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
  try {
    const lock = await BackupLock.findOneAndUpdate(
      { key: "global", expiresAt: { $lte: new Date() } },
      { $set: { owner, expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000) } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    return lock?.owner === owner ? owner : null;
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }
}

async function releaseLock(owner) {
  if (owner) await BackupLock.deleteOne({ key: "global", owner });
}

async function uploadEncrypted(key, body, contentType = "application/octet-stream") {
  const encrypted = encrypt(body);
  await r2.putObject({ key, body: encrypted, contentType, encrypted: true, bucket: backupBucket() });
  return encrypted.length;
}

async function createBackup({ reason = "manual", createdBy } = {}) {
  encryptionKey();
  backupBucket();
  const owner = await acquireLock();
  if (!owner) throw new AppError(409, "BACKUP_IN_PROGRESS", "Another backup or restore is already running.");
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}`;
  const prefix = `${env.BACKUP_PREFIX.replace(/\/$/, "")}/${id}`;
  const record = await BackupRecord.create({
    reason,
    status: "running",
    prefix,
    startedAt: new Date(),
    expiresAt: new Date(Date.now() + env.BACKUP_RETENTION_DAYS * 86400000),
    createdBy,
  });
  try {
    const database = [];
    let documentCount = 0;
    let sizeBytes = 0;
    const collections = (await mongoose.connection.db.listCollections().toArray())
      .map((row) => row.name)
      .filter((name) => !excludedCollections.has(name) && !name.startsWith("system."))
      .sort();
    for (const name of collections) {
      const parts = [];
      let batch = [];
      let collectionDocuments = 0;
      const cursor = mongoose.connection.db.collection(name).find({}).sort({ _id: 1 }).batchSize(500);
      const flush = async () => {
        if (!batch.length) return;
        const key = `${prefix}/database/${encodeURIComponent(name)}/${String(parts.length).padStart(6, "0")}.ejson.gz.enc`;
        const compressed = await gzip(Buffer.from(EJSON.stringify(batch), "utf8"));
        sizeBytes += await uploadEncrypted(key, compressed);
        parts.push({ key, documents: batch.length });
        batch = [];
      };
      for await (const document of cursor) {
        batch.push(document);
        collectionDocuments += 1;
        if (batch.length >= 500) await flush();
      }
      await flush();
      documentCount += collectionDocuments;
      database.push({ name, parts, documents: collectionDocuments });
    }

    const media = [];
    const mediaRecords = await Media.find({ status: "ready", objectKey: { $type: "string" } })
      .select("objectKey contentType")
      .lean();
    const objects = new Map(mediaRecords.filter((row) => row.objectKey).map((row) => [row.objectKey, row.contentType]));
    for (const [originalKey, contentType] of objects) {
      const body = await r2.getObject(originalKey);
      if (!body) continue;
      const key = `${prefix}/media/${crypto.createHash("sha256").update(originalKey).digest("hex")}.enc`;
      sizeBytes += await uploadEncrypted(key, body);
      media.push({ originalKey, key, contentType: contentType || "application/octet-stream", sizeBytes: body.length });
    }

    const manifest = {
      version: 1,
      createdAt: new Date(),
      database,
      media,
      encryption: "AES-256-GCM",
    };
    const manifestKey = `${prefix}/manifest.ejson.gz.enc`;
    sizeBytes += await uploadEncrypted(
      manifestKey,
      await gzip(Buffer.from(EJSON.stringify(manifest), "utf8")),
    );
    Object.assign(record, {
      status: "completed",
      manifestKey,
      collectionCount: database.length,
      documentCount,
      mediaCount: media.length,
      sizeBytes,
      completedAt: new Date(),
      error: undefined,
    });
    await record.save();
    await pruneExpiredBackups();
    return record;
  } catch (error) {
    record.status = "failed";
    record.error = String(error?.message || "Backup failed").slice(0, 500);
    record.completedAt = new Date();
    await record.save().catch(() => {});
    throw error;
  } finally {
    await releaseLock(owner);
  }
}

async function loadManifest(record) {
  const encrypted = await r2.getObject(record.manifestKey, { bucket: backupBucket() });
  if (!encrypted) throw new AppError(404, "BACKUP_ARTIFACT_MISSING", "The backup manifest is unavailable.");
  return EJSON.parse((await gunzip(decrypt(encrypted))).toString("utf8"));
}

async function restoreBackup(record, { restoredBy } = {}) {
  encryptionKey();
  if (record.status !== "completed") throw new AppError(409, "BACKUP_NOT_RESTORABLE", "Only completed backups can be restored.");
  const owner = await acquireLock();
  if (!owner) throw new AppError(409, "BACKUP_IN_PROGRESS", "Another backup or restore is already running.");
  try {
    const manifest = await loadManifest(record);
    record.status = "restoring";
    await record.save();
    for (const item of manifest.database) {
      if (excludedCollections.has(item.name)) continue;
      const collection = mongoose.connection.db.collection(item.name);
      await collection.deleteMany({});
      const parts = item.parts || (item.key ? [{ key: item.key }] : []);
      for (const part of parts) {
        const encrypted = await r2.getObject(part.key, { bucket: backupBucket() });
        if (!encrypted) throw new AppError(404, "BACKUP_ARTIFACT_MISSING", `Collection backup is missing: ${item.name}.`);
        const documents = EJSON.parse((await gunzip(decrypt(encrypted))).toString("utf8"));
        if (documents.length) await collection.insertMany(documents, { ordered: false });
      }
    }
    for (const item of manifest.media) {
      const encrypted = await r2.getObject(item.key, { bucket: backupBucket() });
      if (!encrypted) throw new AppError(404, "BACKUP_ARTIFACT_MISSING", `Media backup is missing: ${item.originalKey}.`);
      await r2.putObject({ key: item.originalKey, body: decrypt(encrypted), contentType: item.contentType || "application/octet-stream" });
    }
    record.status = "completed";
    record.restoredAt = new Date();
    record.restoredBy = restoredBy;
    await record.save();
    return record;
  } catch (error) {
    record.status = "completed";
    record.error = String(error?.message || "Restore failed").slice(0, 500);
    await record.save().catch(() => {});
    throw error;
  } finally {
    await releaseLock(owner);
  }
}

async function pruneExpiredBackups(now = new Date()) {
  const expired = await BackupRecord.find({ expiresAt: { $lte: now }, status: { $ne: "running" } });
  for (const record of expired) {
    await r2.deletePrefix(`${record.prefix}/`, { bucket: backupBucket() });
    await record.deleteOne();
  }
  return expired.length;
}

module.exports = { createBackup, restoreBackup, pruneExpiredBackups, encrypt, decrypt, loadManifest };
