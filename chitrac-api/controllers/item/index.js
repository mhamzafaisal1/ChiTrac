/*** items API controller */
/*** Contributors: RTI II */

/** MODULE REQUIRES */
const express = require('express');
const router = express.Router();


module.exports = function(server) {
	return constructor(server);
}

function constructor(server) {
	const db = server.db;
	const collection = db.collection('item');
	const logger = server.logger;
	const xmlParser = server.xmlParser;
	const configService = require('../../services/mongo/');
	const itemValidator = require('../../middleware/itemValidator')(server);

	/*** Service consumption functions */
	async function getItemXML(req, res, next) {
		try {
			res.set('Content-Type', 'text/xml');
			let items = await configService.getConfiguration(collection, {}, { '_id': 0, 'active': 0 });
			let xmlString = await xmlParser.xmlArrayBuilder('item', items, false);
			res.send(xmlString);
		} catch (error) {
			next(error);
		}
	}

	async function getItem(req, res, next) {
		try {
			let items = await configService.getConfiguration(collection);
			res.json(items);
		} catch (error) {
			next(error);
		}
	}

	// async function upsertItem(req, res, next) {
	// 	try {
	// 		const id = req.params.id;
	// 		let updates = req.body;
	// 		if (updates._id) {
	// 			delete updates._id;
	// 		};
	// 		let results = await configService.upsertConfiguration(collection, id, updates, true);
	// 		res.json(results);
	// 	} catch (error) {
	// 		next(error);
	// 	}
	// }
	async function upsertItem(req, res, next) {
		try {
			const id = req.params.id;
			const updates = { ...req.body }; // clone for safety

			logger.debug('[upsertItem] Processing item update:', {
				id: id,
				body: updates,
				timestamp: new Date().toISOString()
			});
	
			if (updates._id) delete updates._id;
	
			// Ensure weight is explicitly null if not provided (so it passes schema)
			if (updates.weight === undefined) updates.weight = null;
	
			const result = await configService.upsertConfiguration(
				collection,
				id ? { _id: id, ...updates } : updates,
				true,
				'number'
			);

			logger.info('[upsertItem] Item updated successfully:', {
				id: id,
				number: updates.number,
				name: updates.name,
				timestamp: new Date().toISOString()
			});
	
			res.json(result);
		} catch (error) {
			logger.error('[upsertItem] Error:', {
				error: error.message,
				stack: error.stack,
				timestamp: new Date().toISOString()
			});
			next(error);
		}
	}
	

	async function deleteItem(req, res, next) {
		try {
			const id = req.params.id;
			
			logger.debug('[deleteItem] Processing item delete:', {
				id: id,
				timestamp: new Date().toISOString()
			});

			let results = configService.deleteConfiguration(collection, id);
			
			logger.info('[deleteItem] Item deleted successfully:', {
				id: id,
				timestamp: new Date().toISOString()
			});

			res.json(results);
		} catch (error) {
			logger.error('[deleteItem] Error:', {
				error: error.message,
				stack: error.stack,
				timestamp: new Date().toISOString()
			});
			next(error);
		}
	}

	// Get next available item ID
	async function getNewItemId(req, res, next) {
		try {
			// Find the highest number value
			const result = await collection
				.find({})
				.sort({ number: -1 })
				.limit(1)
				.toArray();
			
			// If no items exist, start from 1, otherwise add 1 to the highest
			const nextId = result.length > 0 ? result[0].number + 1 : 1;
			
			res.json({ number: nextId });
		} catch (e) { 
			logger.error('[getNewItemId] Error:', {
				error: e.message,
				stack: e.stack,
				timestamp: new Date().toISOString()
			});
			next(e); 
		}
	}

	/*** Machine Config Routes */
	/** GET routes */
	router.get('/items/config/xml', getItemXML);
	router.get('/items/config', getItem);
	router.get('/item/config/xml', getItemXML);
	router.get('/item/config', getItem);
	router.get('/item/new-id', getNewItemId);

	/** PUT routes */
	// router.put('/items/config/:id', upsertItem);
	// router.put('/item/config/:id', upsertItem);
	router.post('/item/config', itemValidator, upsertItem);
	router.put('/item/config/:id', itemValidator, upsertItem);



	/** DELETE routes */
	router.delete('/items/config/:id', deleteItem);
	router.delete('/item/config/:id', deleteItem);

	return router;
}