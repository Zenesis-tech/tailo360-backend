const { z } = require("zod");
const { BackupRecord, AppConfig } = require("../models");
const backupService = require("../services/backup.service");
const { auditAdmin } = require("../services/audit.service");
const { AppError, notFound } = require("../utils/errors");

async function list(req, res) {
  const limit = z.coerce.number().int().min(1).max(100).default(30).parse(req.query.limit);
  const rows = await BackupRecord.find().sort({ startedAt: -1 }).limit(limit).lean();
  res.json({ data: rows });
}

async function create(req, res) {
  const record = await backupService.createBackup({
    reason: "manual",
    createdBy: req.auth.user._id,
  });
  await auditAdmin(req, "backup.created", "backup", record, undefined, {
    status: record.status,
    collectionCount: record.collectionCount,
    documentCount: record.documentCount,
    mediaCount: record.mediaCount,
    sizeBytes: record.sizeBytes,
  });
  res.status(201).json({ data: record });
}

async function restore(req, res) {
  const record = await BackupRecord.findById(req.params.id);
  if (!record) throw notFound("Backup");
  const input = z.object({ confirmation: z.string() }).parse(req.body);
  if (input.confirmation !== `RESTORE ${record.id}`) {
    throw new AppError(422, "RESTORE_CONFIRMATION_REQUIRED", `Enter RESTORE ${record.id} to confirm.`);
  }
  const config = await AppConfig.findOne({ key: "global" });
  if (!config?.maintenance) {
    throw new AppError(409, "MAINTENANCE_REQUIRED", "Enable maintenance mode before restoring a backup.");
  }
  const before = { status: record.status, completedAt: record.completedAt };
  const restored = await backupService.restoreBackup(record, { restoredBy: req.auth.user._id });
  await auditAdmin(req, "backup.restored", "backup", restored, before, {
    status: restored.status,
    restoredAt: restored.restoredAt,
  });
  res.json({ data: restored });
}

module.exports = { list, create, restore };
