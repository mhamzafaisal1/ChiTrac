/*** items API controller */
/*** Contributors: RTI II */

/** MODULE REQUIRES */
const express = require('express');
const router = express.Router();
const { parseAndValidateQueryParams, formatDuration } = require("../../utils/time");
const {
  splitTimeRangeForHybridItems,
  getItemsCachedDataForDays,
  getItemsSessionDataForPartialDays,
  combineItemsHybridData,
} = require("../../utils/itemFunctions");

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


	// Item Routes 

	 // ---- /api/alpha/analytics/items-summary-daily-cache ----
  // Hybrid cached/session route for item summary, mirroring itemSessions.js implementation.
  router.get("/analytics/items-summary-daily-cache", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);
      const exactStart = new Date(start);
      const exactEnd = new Date(end);

      const today = new Date();
      const todayDateStr = today.toISOString().split("T")[0];
      const startDateStr = exactStart.toISOString().split("T")[0];
      const endDateStr = exactEnd.toISOString().split("T")[0];
      const isToday = startDateStr === todayDateStr || endDateStr === todayDateStr;

      const startOfDayStart = new Date(exactStart);
      startOfDayStart.setHours(0, 0, 0, 0);

      const endOfDayEnd = new Date(exactEnd);
      endOfDayEnd.setHours(23, 59, 59, 999);

      const isStartOfDay = exactStart.getTime() === startOfDayStart.getTime();
      const isEndOfDay = exactEnd.getTime() >= endOfDayEnd.getTime();
      const isSameDay = startDateStr === endDateStr;

      const isPartialDay = isSameDay && (!isStartOfDay || !isEndOfDay);

      // Partial non-today → session-based for accurate windowing
      if (isPartialDay && !isToday) {
        const partialDays = [{ start: exactStart, end: exactEnd }];
        const sessionItems = await getItemsSessionDataForPartialDays(partialDays, db);

        const resultsMap = new Map();

        for (const item of sessionItems) {
          const itemId = String(item.itemId);

          if (!resultsMap.has(itemId)) {
            resultsMap.set(itemId, {
              itemId: item.itemId,
              itemName: item.itemName || "Unknown",
              standardRaw: item.itemStandard ?? 0,
              count: 0,
              workedSec: 0,
            });
          }

          const acc = resultsMap.get(itemId);
          acc.count += item.totalCounts || 0;
          acc.workedSec += (item.workedTimeMs || 0) / 1000;
        }

        const normalizePPH = (std) => {
          const n = Number(std) || 0;
          return n > 0 && n < 60 ? n * 60 : n;
        };

        const results = Array.from(resultsMap.values()).map((entry) => {
          const workedMs = Math.round(entry.workedSec * 1000);
          const hours = workedMs / 3_600_000;
          const pph = hours > 0 ? entry.count / hours : 0;
          const stdPPH = normalizePPH(entry.standardRaw);
          const efficiencyPct = stdPPH > 0 ? (pph / stdPPH) * 100 : 0;

          return {
            itemId: entry.itemId,
            itemName: entry.itemName,
            workedTimeFormatted: formatDuration(workedMs),
            count: entry.count,
            pph: Math.round(pph * 100) / 100,
            standard: entry.standardRaw ?? 0,
            efficiency: Math.round(efficiencyPct * 100) / 100,
          };
        });

        return res.json(results);
      }

      if (isPartialDay && isToday) {
        // still use totals-daily collection for today
      }

      const HYBRID_THRESHOLD_HOURS = 24;
      const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);

      const useHybrid = timeRangeHours > HYBRID_THRESHOLD_HOURS;

      const normalizePPH = (std) => {
        const n = Number(std) || 0;
        return n > 0 && n < 60 ? n * 60 : n;
      };

      let itemTotals = [];

      if (useHybrid) {
        const { completeDays, partialDays } = splitTimeRangeForHybridItems(
          exactStart,
          exactEnd
        );

        const today2 = new Date();
        const todayDateStr2 = today2.toISOString().split("T")[0];

        const partialDaysToday = [];
        const partialDaysNotToday = [];

        for (const partialDay of partialDays) {
          const partialDayDateStr = new Date(
            partialDay.start
          ).toISOString().split("T")[0];
          if (partialDayDateStr === todayDateStr2) {
            partialDaysToday.push({
              dateStr: partialDayDateStr,
              start: new Date(partialDayDateStr + "T00:00:00.000Z"),
              end: new Date(partialDayDateStr + "T23:59:59.999Z"),
            });
          } else {
            partialDaysNotToday.push(partialDay);
          }
        }

        const daysForCache = [...completeDays, ...partialDaysToday];

        if (daysForCache.length > 0) {
          itemTotals = await getItemsCachedDataForDays(daysForCache, db);
        }

        if (partialDaysNotToday.length > 0) {
          const sessionData = await getItemsSessionDataForPartialDays(
            partialDaysNotToday,
            db
          );
          itemTotals = combineItemsHybridData(itemTotals, sessionData);
        }
      } else {
        const cacheCollection = db.collection("totals-daily");

        const startDate = exactStart.toISOString().split("T")[0];
        const endDate = exactEnd.toISOString().split("T")[0];

        const itemQuery = {
          entityType: "item",
          $or: [
            { date: { $gte: startDate, $lte: endDate } },
            {
              dateObj: {
                $gte: new Date(startDate + "T00:00:00.000Z"),
                $lte: new Date(endDate + "T23:59:59.999Z"),
              },
            },
          ],
        };

        itemTotals = await cacheCollection.find(itemQuery).toArray();
      }

      if (!itemTotals.length) {
        return res.json([]);
      }

      const resultsMap = new Map();

      for (const itemTotal of itemTotals) {
        const itemId = String(itemTotal.itemId);

        if (!resultsMap.has(itemId)) {
          resultsMap.set(itemId, {
            itemId: itemTotal.itemId,
            itemName: itemTotal.itemName || "Unknown",
            standardRaw: itemTotal.itemStandard ?? 0,
            count: 0,
            workedSec: 0,
          });
        }

        const acc = resultsMap.get(itemId);
        acc.count += itemTotal.totalCounts || 0;
        acc.workedSec += (itemTotal.workedTimeMs || 0) / 1000;
      }

      const results = Array.from(resultsMap.values()).map((entry) => {
        const workedMs = Math.round(entry.workedSec * 1000);
        const hours = workedMs / 3_600_000;
        const pph = hours > 0 ? entry.count / hours : 0;
        const stdPPH = normalizePPH(entry.standardRaw);
        const efficiencyPct = stdPPH > 0 ? (pph / stdPPH) * 100 : 0;

        return {
          itemId: entry.itemId,
          itemName: entry.itemName,
          workedTimeFormatted: formatDuration(workedMs),
          count: entry.count,
          pph: Math.round(pph * 100) / 100,
          standard: entry.standardRaw ?? 0,
          efficiency: Math.round(efficiencyPct * 100) / 100,
        };
      });

      res.json(results);
    } catch (err) {
      res
        .status(500)
        .json({ error: "Failed to generate items summary from daily cache" });
    }
  });

	return router;
}