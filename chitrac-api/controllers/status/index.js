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
	const faultCollection = db.collection(config.faultCollectionName);
	const logger = server.logger;
	const xmlParser = server.xmlParser;
	const configService = require('../../services/mongo/');

	/*** Service consumption functions */
	async function getStatusXML(collection, rootName, req, res, next) {
		try {
			res.set('Content-Type', 'text/xml');
			let status = await configService.getConfiguration(collection, {}, { '_id': 0, 'active': 0 });
			let xmlString = await xmlParser.xmlArrayBuilder(rootName, status, false);
			res.send(xmlString);
		} catch (error) {
			next(error);
		}
	}

	async function getStatus(collection, req, res, next) {
		try {
			let status = await configService.getConfiguration(collection);
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
			let results = await configService.upsertConfiguration(collection, updates, true, 'id');
			res.json(results);
		} catch (error) {
			next(error);
		}
	}

	async function deleteStatus(collection, req, res, next) {
		try {
			const id = req.params.id;
			let results = configService.deleteConfiguration(collection, id);
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


	/*** Status Config Routes */
	/** GET routes */
	router.get('/fault/config/xml', (req, res, next) => getStatusXML(faultCollection, 'fault', req, res, next));
	router.get('/fault/config', (req, res, next) => getStatus(faultCollection, req, res, next));

	/** PUT routes */
	router.put('/fault/config/:id', (req, res, next) => upsertStatus(faultCollection, req, res, next));

	/** DELETE routes */
	router.delete('/fault/config/:id', (req, res, next) => deleteStatus(faultCollection, req, res, next));


	return router;
}
