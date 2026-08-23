const cron = require("node-cron");
const { runReminders } = require("./services/reminder-jobs.service");
const { createBackup } = require("./services/backup.service");
const { purgeExpiredAccounts } = require("./services/account-purge.service");
const env = require("./config/env");

let reminderCycleRunning = false;
let accountPurgeCycleRunning = false;
let jobsStarted = false;

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

async function runAccountPurgeCycle() {
  if (accountPurgeCycleRunning) return false;
  accountPurgeCycleRunning = true;
  try {
    const result = await purgeExpiredAccounts(new Date(), {
      limit: env.ACCOUNT_PURGE_BATCH_SIZE,
    });
    for (const failure of result.failures) {
      console.error(`Account purge failed for ${failure.userId}`, failure.error);
    }
    return result.failures.length === 0;
  } catch (error) {
    console.error("Account purge cycle failed", error);
    return false;
  } finally {
    accountPurgeCycleRunning = false;
  }
}

function startJobs() {
  if (jobsStarted) return false;
  if (!cron.validate(env.REMINDER_CRON)) {
    throw new Error("REMINDER_CRON is invalid.");
  }
  if (!cron.validate(env.ACCOUNT_PURGE_CRON)) {
    throw new Error("ACCOUNT_PURGE_CRON is invalid.");
  }
  jobsStarted = true;
  cron.schedule(
    env.REMINDER_CRON,
    runReminderCycle,
    { timezone: env.REMINDER_TIMEZONE },
  );
  // Catch reminders that became due while the API was restarting or offline.
  void runReminderCycle();
  cron.schedule(
    env.ACCOUNT_PURGE_CRON,
    runAccountPurgeCycle,
    { timezone: env.ACCOUNT_PURGE_TIMEZONE },
  );
  // Catch deletion windows that elapsed while the API was restarting.
  void runAccountPurgeCycle();
  if (env.BACKUP_ENABLED) {
    if (!cron.validate(env.BACKUP_CRON)) throw new Error("BACKUP_CRON is invalid.");
    cron.schedule(
      env.BACKUP_CRON,
      () => createBackup({ reason: "scheduled" }).catch(console.error),
      { timezone: env.BACKUP_TIMEZONE },
    );
  }
  return true;
}
module.exports = { startJobs, runReminderCycle, runAccountPurgeCycle };
