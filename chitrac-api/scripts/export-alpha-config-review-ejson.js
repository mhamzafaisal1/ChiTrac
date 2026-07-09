const fs = require('fs');
const path = require('path');
const { EJSON } = require('bson');
const { MongoClient } = require('mongodb');

const config = require('../modules/config');

const collections = [
  config.operatorCollectionName,
  config.itemCollectionName,
  config.shiftCollectionName
].filter(Boolean);

async function main() {
  const client = new MongoClient(config.mongo.connectionString, {
    serverSelectionTimeoutMS: 15000
  });

  await client.connect();

  try {
    const db = client.db();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(
      process.cwd(),
      'backups',
      `alpha-config-review-ejson-${stamp}.json`
    );

    const exportPayload = {
      exportedAt: new Date(),
      format: 'MongoDB Extended JSON v2 relaxed=false; Date values are represented as {"$date": "..."}',
      collections: {}
    };

    for (const collectionName of collections) {
      exportPayload.collections[collectionName] = await db.collection(collectionName).find({}).toArray();
    }

    fs.writeFileSync(
      outputPath,
      EJSON.stringify(exportPayload, null, 2, { relaxed: false })
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
