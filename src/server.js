const app = require("./app");
const { connectDatabase } = require("./config/db");
const { startJobs } = require("./jobs");
const env = require("./config/env");
const { safeError } = require("./utils/logging");
connectDatabase()
  .then(() => {
    startJobs();
    app.listen(env.PORT, () =>
      console.log(`Tailo360 API listening on :${env.PORT}`),
    );
  })
  .catch((error) => {
    console.error("Database connection failed", safeError(error));
    process.exit(1);
  });
