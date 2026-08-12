const cron = require("node-cron");
const { runReminders } = require("./services/reminder-jobs.service");
function startJobs() {
  cron.schedule(
    "0 8 * * *",
    () => runReminders().catch(console.error),
    { timezone: "Asia/Kolkata" },
  );
}
module.exports = { startJobs };
