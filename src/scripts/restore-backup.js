const { connectDatabase } = require("../config/db");
const { BackupRecord } = require("../models");
const { restoreBackup } = require("../services/backup.service");

const id = process.argv[2];
const confirmation = process.argv[3];
if (!id || confirmation !== `RESTORE ${id}`) {
  console.error('Usage: npm run backup:restore -- <backup-id> "RESTORE <backup-id>"');
  process.exit(1);
}
connectDatabase()
  .then(() => BackupRecord.findById(id))
  .then((record) => {
    if (!record) throw new Error("Backup not found.");
    return restoreBackup(record);
  })
  .then(() => {
    console.log(`Backup restored: ${id}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
