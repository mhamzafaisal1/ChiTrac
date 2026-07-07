const fs = require('fs');
const path = require('path');
const { EJSON } = require('bson');
const { MongoClient } = require('mongodb');

const config = require('../modules/config');

async function main() {
  const client = new MongoClient(config.mongo.connectionString, {
    serverSelectionTimeoutMS: 15000
  });

  await client.connect();

  try {
    const db = client.db();
    const collectionName = config.operatorCollectionName;
    const operators = await db.collection(collectionName).find({}).toArray();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(
      process.cwd(),
      'backups',
      `alpha-config-operator-review-${stamp}.json`
    );

    fs.writeFileSync(
      outputPath,
      EJSON.stringify(operators, null, 2, { relaxed: false })
    );

    console.log(outputPath);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
