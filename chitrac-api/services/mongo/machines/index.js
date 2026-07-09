/*** Config Functions */
async function stampTimestampedUpdate(collection, filter, updateObject) {
	const now = new Date();
	if (updateObject.timestamps && typeof updateObject.timestamps === 'object') {
		updateObject.timestamps = {
			...updateObject.timestamps,
			update: now
		};
		return;
	}

	const existing = await collection.findOne(filter, { projection: { timestamps: 1 } });
	if (existing?.timestamps) {
		updateObject['timestamps.update'] = now;
	}
}

async function getConfiguration(collection, query, projection) {
	try {
		let mongoCollection = db.collection(collection);
		let cursor = mongoCollection.find(query).project(projection);
		let response = await cursor.toArray();
		return response;
	} catch (error) {
		return error;
	}
}

async function upsertConfiguration(collection, id, updateObject, upsert) {
	try {
		let mongoCollection = db.collection(collection);
		await stampTimestampedUpdate(mongoCollection, { '_id': id }, updateObject);
		let response = await mongoCollection.updateOne({ '_id': id }, { '$set': updateObject }, { 'upsert': true });
		return response;
	} catch (error) {
		return error;
	}
}

async function deleteConfiguration(collection, id) {
	try {
		let mongoCollection = db.collection(collection);
		let response = await mongoCollection.deleteOne({ '_id': id });
		return response;
	} catch (error) {
		return error;
	}
}


exports.getConfiguration = getConfiguration;
exports.upsertConfiguration = upsertConfiguration;
exports.deleteConfiguration = deleteConfiguration;
