const cron = require("node-cron");
const { runReminders } = require("./services/reminder-jobs.service");
const { createBackup } = require("./services/backup.service");
const env = require("./config/env");
function startJobs() {
  cron.schedule(
    "0 8 * * *",
    () => runReminders().catch(console.error),
    { timezone: "Asia/Kolkata" },
  );
  if (env.BACKUP_ENABLED) {
    if (!cron.validate(env.BACKUP_CRON)) throw new Error("BACKUP_CRON is invalid.");
    cron.schedule(
      env.BACKUP_CRON,
      () => createBackup({ reason: "scheduled" }).catch(console.error),
      { timezone: env.BACKUP_TIMEZONE },
    );
  }
}
module.exports = { startJobs };
