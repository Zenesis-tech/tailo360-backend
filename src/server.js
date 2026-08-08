const app = require("./app");
const { connectDatabase } = require("./config/db");
const { startJobs } = require("./jobs");
const env = require("./config/env");
connectDatabase()
  .then(() => {
    startJobs();
    app.listen(env.PORT, () =>
      console.log(`Tailo360 API listening on :${env.PORT}`),
    );
  })
  .catch((error) => {
    console.error("Database connection failed", error);
    process.exit(1);
  });
