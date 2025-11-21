const { MongoClient } = require('mongodb');
const config = require('./chitrac-api/config');

(async () => {
  const client = new MongoClient(config.mongoDbUrl);
  await client.connect();
  const db = client.db(config.dbName);

  // Get a sample operator session from today
  const session = await db.collection(config.operatorSessionCollectionName).findOne({
    'timestamps.start': { $gte: new Date('2025-11-18T00:00:00Z') }
  });

  if (!session) {
    console.log('No sessions found for today');
    await client.close();
    return;
  }

  console.log('=== Sample Operator Session ===');
  console.log('Operator ID:', session.operator?.id);
  console.log('Machine Serial:', session.machine?.serial);
  console.log('Total Count:', session.totalCount);
  console.log('Items array length:', session.items?.length || 0);
  console.log('Counts array length:', session.counts?.length || 0);
  console.log('Has totalCountByItem?', !!session.totalCountByItem);
  console.log('totalCountByItem:', session.totalCountByItem);

  if (session.items && session.items.length > 0) {
    console.log('\n=== Items in Session ===');
    session.items.slice(0, 5).forEach((item, i) => {
      console.log(`[${i}] Item ${item.id}: ${item.name}, standard: ${item.standard}`);
    });
  }

  if (session.counts && session.counts.length > 0) {
    console.log('\n=== Counts in Session (first 5) ===');
    session.counts.slice(0, 5).forEach((count, i) => {
      console.log(`[${i}] Item ID: ${count.item?.id}, Name: ${count.item?.name}`);
    });
  } else {
    console.log('\n=== NO COUNTS IN SESSION - THIS IS THE PROBLEM ===');
  }

  // Check operator-item cache for this operator
  console.log('\n=== Checking operator-item cache ===');
  const cacheRecords = await db.collection('totals-daily').find({
    entityType: 'operator-item',
    operatorId: session.operator?.id,
    date: '2025-11-18'
  }).limit(3).toArray();

  console.log(`Found ${cacheRecords.length} operator-item cache records for operator ${session.operator?.id}`);
  cacheRecords.forEach(rec => {
    console.log(`  Item ${rec.itemId} (${rec.itemName}): totalCounts=${rec.totalCounts}, workedTimeMs=${rec.workedTimeMs}`);
  });

  await client.close();
})();
