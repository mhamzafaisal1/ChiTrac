const { ObjectId } = require('mongodb');

/*** Config Functions */
async function getConfiguration(collection, query, projection) {
	try {
		let cursor = collection.find(query).project(projection);
		let results = await cursor.toArray();
		return results;
	} catch (error) {
		throw error;
	}
}

function normalizeConfigKeyValue(value) {
	if (typeof value !== 'string') return value;

	const trimmed = value.trim();
	if (trimmed !== '' && /^-?\d+$/.test(trimmed)) {
		return Number(trimmed);
	}

	return value;
}

async function resolveConfigurationIdentifier(collection, identifier, uniqueKey = 'id') {
	const identifierString = String(identifier ?? '');

	if (identifierString && ObjectId.isValid(identifierString)) {
		const objectId = new ObjectId(identifierString);
		const existingByObjectId = await collection.findOne(
			{ _id: objectId },
			{ projection: { _id: 1 } }
		);

		if (existingByObjectId) {
			return { _id: objectId };
		}
	}

	return { [uniqueKey]: normalizeConfigKeyValue(identifier) };
}

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

// async function upsertConfiguration(collection, updateObject, upsert) {
// 	try {
// 		let results, id;
// 		if (updateObject._id) {
// 			id = new ObjectId(updateObject._id);
// 			delete updateObject._id;
// 		}
// 		if (id) {
// 			results = await collection.updateOne({ '_id': id }, { '$set': updateObject });
// 		} else {
// 			const findConfig = await collection.find({ 'code': updateObject.code }).toArray();
// 			if (findConfig.length) {
// 				throw { message: 'Operator Already exists' };
// 			} else {
// 				results = await collection.insertOne(updateObject);
// 			}
// 		}
// 		return results;
// 	} catch (error) {
// 		error.message = JSON.stringify(error);
// 		error.status = 409;
// 		error.expressResponse = {
// 		}
// 		throw error;
// 	}
// }

// async function upsertConfiguration(collection, updateObject, upsert, uniqueKey = 'code') {
// 	try {
// 	  let results, id;
// 	  if (updateObject._id) {
// 		id = new ObjectId(updateObject._id);
// 		delete updateObject._id;
// 	  }
  
// 	  if (id) {
// 		results = await collection.updateOne({ '_id': id }, { '$set': updateObject });
// 	  } else {
// 		const uniqueValue = updateObject[uniqueKey];
// 		const existing = await collection.find({ [uniqueKey]: uniqueValue }).toArray();
// 		if (existing.length) {
// 		  throw { message: `${uniqueKey} Already exists` };
// 		} else {
// 		  results = await collection.insertOne(updateObject);
// 		}
// 	  }
  
// 	  return results;
// 	} catch (error) {
// 	  error.message = JSON.stringify(error);
// 	  error.status = 409;
// 	  throw error;
// 	}
//   }

async function upsertConfiguration(collection, updateObject, upsert, uniqueKey = 'id') {
	try {
		let results, identifierFilter, existingDocument;

		// Extract route/document identifier before modifying updateObject
		if (updateObject._id) {
			const identifier = updateObject._id;
			delete updateObject._id; // Remove _id from update payload
			identifierFilter = await resolveConfigurationIdentifier(collection, identifier, uniqueKey);
			existingDocument = await collection.findOne(identifierFilter, { projection: { _id: 1 } });
		}

		if (identifierFilter) {
			// Update existing document - check for conflicts excluding self
			const uniqueValue = updateObject[uniqueKey];
			if (uniqueValue !== undefined && uniqueValue !== null) {
				const conflictQuery = {
					[uniqueKey]: normalizeConfigKeyValue(uniqueValue)
				};

				if (existingDocument?._id) {
					conflictQuery._id = { $ne: existingDocument._id };
				}

				const conflict = await collection.findOne(conflictQuery);
				if (conflict) {
					throw { message: `${uniqueKey} Already exists` };
				}
			}
			await stampTimestampedUpdate(collection, identifierFilter, updateObject);
			results = await collection.updateOne(identifierFilter, { '$set': updateObject });
		} else {
			// Create new document - check for any conflicts
			const uniqueValue = updateObject[uniqueKey];
			const existing = await collection.find({ [uniqueKey]: normalizeConfigKeyValue(uniqueValue) }).toArray();

			if (existing.length) {
				throw { message: `${uniqueKey} Already exists` };
			} else {
				results = await collection.insertOne(updateObject);
			}
		}

		return results;
	} catch (error) {
		error.message = JSON.stringify(error);
		error.status = 409;
		throw error;
	}
}

  

async function deleteConfiguration(collection, id, uniqueKey = 'id') {
	try {
		const identifierFilter = await resolveConfigurationIdentifier(collection, id, uniqueKey);
		let results = await collection.deleteOne(identifierFilter);
		return results;
	} catch (error) {
		throw error;
	}
}

async function createConfiguration(collection, updateObject, keyField = 'code') {
	try {
		const findConfig = await collection.find({ [keyField]: updateObject[keyField] }).toArray();
		if (findConfig.length > 0) {
			throw {
				message: `${collection.collectionName} with that ${keyField} already exists`,
				status: 409,
			};
		}
		return await collection.insertOne(updateObject);
	} catch (error) {
		if (!error.status) error.status = 500;
		throw error;
	}
}




exports.createConfiguration = createConfiguration;
exports.getConfiguration = getConfiguration;
exports.upsertConfiguration = upsertConfiguration;
exports.deleteConfiguration = deleteConfiguration;
