/*** configuration API controller */
/*** Contributors: RTI II */


/** MODULE REQUIRES */
const express = require('express');
const router = express.Router();

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



/** Configuration FUDs */
/*** Item Config Functions */
async function getItemConfiguration(callback) {
	let collection, items;
	collection = db.collection('items');
	try {
		items = await collection.find({ 'active': true }).project({ '_id': 0, 'active': 0 }).toArray();
		callback(null, items);
	} catch (error) {
		callback(error);
	}
}

async function upsertItemConfiguration(id, updateObject, callback) {
	let collection, items;
	collection = db.collection('items');
	try {
		let idObject = {}
		if (id) {
			idObject = { '_id': id }
		}
		await stampTimestampedUpdate(collection, idObject, updateObject);
		items = await collection.updateOne(idObject, { '$set': updateObject }, { 'upsert': true });
		callback(null, items);
	} catch (error) {
		callback(error);
	}
}

async function deleteItemConfiguration(id, callback) {
	let collection, items;
	collection = db.collection('items');
	try {
		items = await collection.deleteOne({ '_id': id });
		callback(null, items);
	} catch (error) {
		callback(error);
	}
}

/*** Item Config Routes */
router.get('/api/items/config/xml', (req, res, next) => {
	res.set('Content-Type', 'text/xml');
	getItemConfiguration((err, results) => {
		if (err) {
			res.send(builder.buildObject(err))
		} else if (results) {

			let xmlString = xmlArrayBuilder('item', results, true);
			res.send(xmlString);

			/*xmlArrayBuilder('item', results, false, (xmlString) => {
			});*/
		} else {
			xmlArrayBuilder('item', [], false, (xmlString) => {
				res.send(xmlString);
			});
		}
	});
});
router.get('/api/items/config', (req, res, next) => {

	getItemConfiguration((err, results) => {
		if (err) {
			res.json(err)
		} else if (results) {
			res.json(results);
		} else {
			res.json({ 'efficiency': 0 });
		}
	});
});
router.put('/api/items/config/:id', (req, res, next) => {
	const id = req.params.id;
	let updates = req.body;
	if (updates._id) {
		delete updates._id;
	};
	upsertItemConfiguration(id, updates, (err, results) => {
		if (err) {
			res.json(err)
		} else if (results) {
			res.json(results);
		} else {
			res.json({});
		}
	});
});
router.delete('/api/items/config/:id', (req, res, next) => {
	const id = req.params.id;
	deleteItemConfiguration(id, (err, results) => {
		if (err) {
			res.json(err)
		} else if (results) {
			res.json(results);
		} else {
			res.json({});
		}
	});
});


/*** Machine Config Functions */
async function getMachineConfiguration(callback) {
	let collection, machines;
	collection = db.collection('machines');
	try {
		machines = await collection.find({ 'active': true }).project({ '_id': 0, 'active': 0 }).toArray();
		callback(null, machines);
	} catch (error) {
		callback(error);
	}
}

async function upsertMachineConfiguration(id, updateObject, callback) {
	let collection, machines;
	collection = db.collection('machines');
	try {
		await stampTimestampedUpdate(collection, { '_id': id }, updateObject);
		machines = await collection.updateOne({ '_id': id }, { '$set': updateObject }, { 'upsert': true });
		callback(null, machines);
	} catch (error) {
		callback(error);
	}
}

async function deleteMachineConfiguration(id, callback) {
	let collection, machines;
	collection = db.collection('machines');
	try {
		machines = await collection.deleteOne({ '_id': id });
		callback(null, machines);
	} catch (error) {
		callback(error);
	}
}

/*** Machine Config Routes */
router.get('/api/machines/config/xml', (req, res, next) => {
	res.set('Content-Type', 'text/xml');
	//List back either the machine definitions from the DB, or if now, list the machines currently online
	getMachineConfiguration((err, results) => {
		if (err) {
			res.send(builder.buildObject(err))
		} else if (results) {
			xmlArrayBuilder('machine', results, false, (xmlString) => {
				res.send(xmlString);
			});
		} else {
			xmlArrayBuilder('machine', [], false, (xmlString) => {
				res.send(xmlString);
			});
		}
	});
});
router.get('/api/machines/config', (req, res, next) => {
	//List back either the machine definitions from the DB, or if now, list the machines currently online
	getMachineConfiguration((err, results) => {
		if (err) {
			res.json(err)
		} else if (results) {
			res.json(results);
		} else {
			res.json([]);
		}
	});
});
router.put('/api/machines/config/:id', (req, res, next) => {
	const id = req.params.id;
	let updates = req.body;
	if (updates._id) {
		delete updates._id;
	};
	upsertMachineConfiguration(id, updates, (err, results) => {
		if (err) {
			res.json(err)
		} else if (results) {
			res.json(results);
		} else {
			res.json({});
		}
	});
});
router.delete('/api/machines/config/:id', (req, res, next) => {
	const id = req.params.id;
	deleteMachineConfiguration(id, (err, results) => {
		if (err) {
			res.json(err)
		} else if (results) {
			res.json(results);
		} else {
			res.json({});
		}
	});
});


/*** Operator Config Functions */
async function getOperatorConfiguration(callback) {
	let collection, operators;
	collection = db.collection('operators');
	try {
		operators = await collection.find({ 'active': true }).project({ '_id': 0, 'active': 0 }).toArray();
		let operatorArray = [];
		operators.forEach((operator) => {
			let newOperator = {
				'code': operator.code,
				'name': operator.name.full
			}
			operatorArray.push(newOperator);
		});
		callback(null, operatorArray);
	} catch (error) {
		callback(error);
	}
}

async function upsertOperatorConfiguration(id, updateObject, callback) {
	let collection, operators;
	collection = db.collection('operators');
	try {
		await stampTimestampedUpdate(collection, { '_id': id }, updateObject);
		operators = await collection.updateOne({ '_id': id }, { '$set': updateObject }, { 'upsert': true });
		callback(null, operators);
	} catch (error) {
		callback(error);
	}
}

async function deleteOperatorConfiguration(id, callback) {
	let collection, operators;
	collection = db.collection('operators');
	try {
		operators = await collection.deleteOne({ '_id': id });
		callback(null, operators);
	} catch (error) {
		callback(error);
	}
}

/*** Operator Config Routes */
router.get('/api/operators/config/xml', (req, res, next) => {
	res.set('Content-Type', 'text/xml');
	//List back either the machine definitions from the DB, or if now, list the machines currently online
	getOperatorConfiguration((err, results) => {
		if (err) {
			res.send(builder.buildObject(err))
		} else if (results) {
			xmlArrayBuilder('operator', results, false, (xmlString) => {
				res.send(xmlString);
			});
		} else {
			xmlArrayBuilder('operator', [], false, (xmlString) => {
				res.send(xmlString);
			});
		}
	});
});
router.get('/api/operators/config', (req, res, next) => {
	//List back either the machine definitions from the DB, or if now, list the machines currently online
	getOperatorConfiguration((err, results) => {
		if (err) {
			res.json(err)
		} else if (results) {
			res.json(results);
		} else {
			res.json([]);
		}
	});
});
router.put('/api/operators/config/:id', (req, res, next) => {
	const id = req.params.id;
	let updates = req.body;
	if (updates._id) {
		delete updates._id;
	};
	upsertOperatorConfiguration(id, updates, (err, results) => {
		if (err) {
			res.json(err);
		} else if (results) {
			res.json(results);
		} else {
			res.json({});
		}
	});
});
router.delete('/api/operators/config/:id', (req, res, next) => {
	const id = req.params.id;
	deleteOperatorConfiguration(id, (err, results) => {
		if (err) {
			res.json(err)
		} else if (results) {
			res.json(results);
		} else {
			res.json({});
		}
	});
});

/*** Fault Config Functions */
async function getFaultConfiguration(callback) {
	let collection, faults;
	collection = db.collection('faults');
	try {
		faults = await collection.find().project({ '_id': 0, 'active': 0 }).toArray();
		callback(null, faults);
	} catch (error) {
		callback(error);
	}
}

async function upsertFaultConfiguration(id, updateObject, callback) {
	let collection, faults;
	collection = db.collection('faults');
	try {
		await stampTimestampedUpdate(collection, { '_id': id }, updateObject);
		faults = await collection.updateOne({ '_id': id }, { '$set': updateObject }, { 'upsert': true });
		callback(null, faults);
	} catch (error) {
		callback(error);
	}
}

async function deleteFaultConfiguration(id, callback) {
	let collection, faults;
	collection = db.collection('faults');
	try {
		faults = await collection.deleteOne({ '_id': id });
		callback(null, faults);
	} catch (error) {
		callback(error);
	}
}

/*** Fault Config Routes */
router.get('/api/faults/config/xml', (req, res, next) => {
	res.set('Content-Type', 'text/xml');
	getFaultConfiguration((err, results) => {
		if (err) {
			res.send(builder.buildObject(err));
		} else if (results) {
			xmlArrayBuilder('fault', results, false, (xmlString) => {
				res.send(xmlString);
			});
		} else {
			xmlArrayBuilder('fault', [], false, (xmlString) => {
				res.send(xmlString);
			});
		}
	});
});
router.get('/api/faults/config', (req, res, next) => {
	getFaultConfiguration((err, results) => {
		if (err) {
			res.json(err);
		} else if (results) {
			res.json(results);
		} else {
			res.json({ 'efficiency': 0 });
		}
	});
});
router.put('/api/faults/config/:id', (req, res, next) => {
	const id = req.params.id;
	let updates = req.body;
	if (updates._id) {
		delete updates._id;
	};
	upsertFaultConfiguration(id, updates, (err, results) => {
		if (err) {
			res.json(err);
		} else if (results) {
			res.json(results);
		} else {
			res.json({});
		}
	});
});
router.delete('/api/faults/config/:id', (req, res, next) => {
	const id = req.params.id;
	deleteFaultConfiguration(id, (err, results) => {
		if (err) {
			res.json(err);
		} else if (results) {
			res.json(results);
		} else {
			res.json({});
		}
	});
});

module.exports = router;
