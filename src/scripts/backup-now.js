const { connectDatabase } = require("../config/db");
const { createBackup } = require("../services/backup.service");

connectDatabase()
  .then(() => createBackup({ reason: "manual" }))
  .then((record) => {
    console.log(`Backup completed: ${record.id}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
