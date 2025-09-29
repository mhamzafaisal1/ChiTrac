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

async function upsertConfiguration(collection, updateObject, upsert, uniqueKey = 'code') {
	try {
		let results, id;

		// Extract _id before modifying updateObject
		if (updateObject._id) {
			id = new ObjectId(updateObject._id);
			delete updateObject._id; // Remove _id from update payload
		}

		if (id) {
			// Update existing document - check for conflicts excluding self
			const uniqueValue = updateObject[uniqueKey];
			if (uniqueValue) {
				const conflict = await collection.findOne({ 
					[uniqueKey]: uniqueValue, 
					_id: { $ne: id } 
				});
				if (conflict) {
					throw { message: `${uniqueKey} Already exists` };
				}
			}
			results = await collection.updateOne({ '_id': id }, { '$set': updateObject });
		} else {
			// Create new document - check for any conflicts
			const uniqueValue = updateObject[uniqueKey];
			const existing = await collection.find({ [uniqueKey]: uniqueValue }).toArray();

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

  

async function deleteConfiguration(collection, id) {
	try {
		let results = await collection.deleteOne({ '_id': new ObjectId(id) });
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