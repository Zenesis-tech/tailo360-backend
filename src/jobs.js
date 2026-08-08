const cron = require("node-cron");
const { runReminders } = require("./services/reminder-jobs.service");
function startJobs() {
  cron.schedule("0 9 * * *", () => runReminders().catch(console.error));
}
module.exports = { startJobs };
