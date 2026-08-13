const app = require("./app");
const { connectDatabase } = require("./config/db");
const { startJobs } = require("./jobs");
const env = require("./config/env");
const { safeError } = require("./utils/logging");
const http = require("http");
const realtimeEvents = require("./services/realtime-events.service");
connectDatabase()
  .then(() => {
    startJobs();
    const server = http.createServer(app);
    realtimeEvents.initialize(server);
    server.listen(env.PORT, () =>
      console.log(`Tailo360 API listening on :${env.PORT}`),
    );
  })
  .catch((error) => {
    console.error("Database connection failed", safeError(error));
    process.exit(1);
  });
