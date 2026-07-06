module.exports = function (config) {
  return constructor(config);
};

function constructor(config) {
  const { MongoClient } = require("mongodb");
  const { wrapDatabase } = require("./totalsCollectionAdapter");
  const conn = config.mongo?.connectionString;
  if (!conn || typeof conn !== "string" || !conn.trim()) {
    throw new Error("MONGO_CONN_STRING is required");
  }

  const dbClient = new MongoClient(conn.trim());
  const db = dbClient.db();

  const redacted = conn.replace(/:[^:@]+@/, ":****@");
  console.log("MongoDB connection string:", redacted);

  return wrapDatabase(db);
}
