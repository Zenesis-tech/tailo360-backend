const cron = require("node-cron");
const { runReminders } = require("./services/reminder-jobs.service");
const { createBackup } = require("./services/backup.service");
const env = require("./config/env");

let reminderCycleRunning = false;

async function runReminderCycle() {
  if (reminderCycleRunning) return false;
  reminderCycleRunning = true;
  try {
    await runReminders();
    return true;
  } catch (error) {
    console.error("Reminder notification cycle failed", error);
    return false;
  } finally {
    reminderCycleRunning = false;
  }
}

function startJobs() {
  if (!cron.validate(env.REMINDER_CRON)) {
    throw new Error("REMINDER_CRON is invalid.");
  }
  cron.schedule(
    env.REMINDER_CRON,
    runReminderCycle,
    { timezone: env.REMINDER_TIMEZONE },
  );
  // Catch reminders that became due while the API was restarting or offline.
  void runReminderCycle();
  if (env.BACKUP_ENABLED) {
    if (!cron.validate(env.BACKUP_CRON)) throw new Error("BACKUP_CRON is invalid.");
    cron.schedule(
      env.BACKUP_CRON,
      () => createBackup({ reason: "scheduled" }).catch(console.error),
      { timezone: env.BACKUP_TIMEZONE },
    );
  }
}
module.exports = { startJobs, runReminderCycle };
