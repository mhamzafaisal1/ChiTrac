/*** statuses API controller */
/*** Contributors: RTI II */

/** MODULE REQUIRES */
const express = require('express');
const router = express.Router();

module.exports = function(server) {
	return constructor(server);
}

function constructor(server) {
	const db = server.db;
	const config = require('../../modules/config');
	const statusCollection = db.collection(config.statusCollectionName);
	const alarmCollection = db.collection(config.alarmCollectionName);
	const logger = server.logger;
	const xmlParser = server.xmlParser;
	const configService = require('../../services/mongo/');

	/*** Service consumption functions */
	async function getStatusXML(collection, rootName, req, res, next, query = {}) {
		try {
			res.set('Content-Type', 'text/xml');
			let status = await configService.getConfiguration(collection, query, { '_id': 0, 'active': 0 });
			let xmlString = await xmlParser.xmlArrayBuilder(rootName, status, false);
			res.send(xmlString);
		} catch (error) {
			next(error);
		}
	}

	async function getStatus(collection, req, res, next, query = {}) {
		try {
			let status = await configService.getConfiguration(collection, query);
			res.json(status);
		} catch (error) {
			next(error);
		}
	}

	async function upsertStatus(collection, req, res, next) {
		try {
			const id = req.params.id;
			let updates = req.body;
			if (updates._id) {
				delete updates._id;
			};
			let results = await configService.upsertConfiguration(
				collection,
				id ? { _id: id, ...updates } : updates,
				true,
				'id'
			);
			res.json(results);
		} catch (error) {
			next(error);
		}
	}

	async function deleteStatus(collection, req, res, next) {
		try {
			const id = req.params.id;
			let results = await configService.deleteConfiguration(collection, id, 'id');
			res.json(results);
		} catch (error) {
			next(error);
		}
	}

	/*** Status Config Routes */
	/** GET routes */
	router.get('/status/config/xml', (req, res, next) => getStatusXML(statusCollection, 'status', req, res, next));
	router.get('/status/config', (req, res, next) => getStatus(statusCollection, req, res, next));

	/** PUT routes */
	router.put('/status/config/:id', (req, res, next) => upsertStatus(statusCollection, req, res, next));

	/** DELETE routes */
	router.delete('/status/config/:id', (req, res, next) => deleteStatus(statusCollection, req, res, next));


	router.get('/alarm/config/xml', (req, res, next) => getStatusXML(alarmCollection, 'alarm', req, res, next));
	router.get('/alarm/config', (req, res, next) => getStatus(alarmCollection, req, res, next));
	async function upsertAlarm(req, res, next, legacyFault = false) {
		try {
			const { ObjectId } = require('mongodb');
			const alarmSchema = require('../../schemas/alarm');
			const timestamps = require('../../schemas/timestampsSchema');
			const identifier = req.params.id;
			const filter = ObjectId.isValid(identifier)
				? { _id: new ObjectId(identifier) } : { id: Number(identifier) };
			const existing = await alarmCollection.findOne(filter);
			const { _id, ...updates } = req.body;
			const now = new Date();
			const record = { ...(legacyFault && !existing ? { fault: true, stop: true } : {}), ...existing, ...updates,
				id: updates.id ?? existing?.id ?? Number(identifier),
				active: updates.active ?? existing?.active ?? true,
				timestamps: existing?.timestamps
					? timestamps.utils.stampUpdate(existing.timestamps, now)
					: timestamps.utils.stampInit(now) };
			delete record._id;
			if (!alarmSchema.validate(record)) {
				return res.status(400).json({ error: 'Invalid alarm configuration', details: alarmSchema.validate.errors });
			}
			const conflict = await alarmCollection.findOne({ id: record.id });
			if (conflict && String(conflict._id) !== String(existing?._id)) {
				return res.status(409).json({ error: 'Alarm id already exists' });
			}
			res.json(await alarmCollection.updateOne(filter, { $set: record }, { upsert: true }));
		} catch (error) { next(error); }
	}
	router.put('/alarm/config/:id', upsertAlarm);
	router.delete('/alarm/config/:id', (req, res, next) => deleteStatus(alarmCollection, req, res, next));

	// Existing CT clients keep their URLs, but never read or edit config-fault.
	router.get(['/fault/config/xml', '/faults/config/xml'], (req, res, next) => getStatusXML(alarmCollection, 'fault', req, res, next, { fault: true }));
	router.get(['/fault/config', '/faults/config'], (req, res, next) => getStatus(alarmCollection, req, res, next, { fault: true }));
	router.put(['/fault/config/:id', '/faults/config/:id'], (req, res, next) => upsertAlarm(req, res, next, true));
	router.delete(['/fault/config/:id', '/faults/config/:id'], (req, res, next) => deleteStatus(alarmCollection, req, res, next));

	return router;
}
