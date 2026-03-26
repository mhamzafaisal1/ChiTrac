const express = require("express");
const router = express.Router();

module.exports = function (server) {
  return constructor(server);
};

function constructor(server) {
  const db = server.db;
  const logger = server.logger;

  // Placeholder Milnor route – extend with real logic as needed
  router.get("/status", async (req, res) => {
    res.json({ vendor: "Milnor", status: "ok" });
  });

  return router;
}

