// Read-only configuration audit. Never prints connection strings or secrets.
const { MongoClient } = require('mongodb');
const config = require('../modules/config');

(async () => {
  const client = new MongoClient(config.mongo.connectionString, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const result = {};
    for (const name of ['config-fault', 'config-alarm']) {
      const collection = client.db().collection(name);
      result[name] = {
        count: await collection.countDocuments({}),
        fields: await collection.aggregate([
          { $project: { fields: { $objectToArray: '$$ROOT' } } },
          { $unwind: '$fields' },
          { $group: { _id: '$fields.k', types: { $addToSet: { $type: '$fields.v' } } } },
          { $sort: { _id: 1 } }
        ]).toArray(),
        missingFlags: await collection.countDocuments({ $or: [
          { fault: { $not: { $type: 'bool' } } }, { stop: { $not: { $type: 'bool' } } }
        ] }),
        stoppingFaults: await collection.countDocuments({ fault: true, stop: true })
      };
    }
    const db = client.db();
    const faults = await db.collection('config-fault').find({}).toArray();
    const alarms = await db.collection('config-alarm').find({}).toArray();
    result.copyCheck = {
      missingAlarmIds: faults.filter(fault => !alarms.some(alarm => alarm.id === fault.id)).map(fault => fault.id),
      changedMongoIds: faults.filter(fault => {
        const alarm = alarms.find(record => record.id === fault.id);
        return alarm && String(alarm._id) !== String(fault._id);
      }).map(fault => fault.id),
      invalidAlarmIds: alarms.filter(alarm => !require('../schemas/alarm').validate({ ...alarm, _id: String(alarm._id) })).map(alarm => alarm.id)
    };
    console.log(JSON.stringify(result, null, 2));
  } finally { await client.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
