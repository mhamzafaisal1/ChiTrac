/*** items API controller */
/*** Contributors: RTI II */

/** MODULE REQUIRES */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { ObjectId } = require('mongodb');
const schedule = require('node-schedule');
const config = require('../../modules/config');
const timestampsSchema = require('../../schemas/timestampsSchema');
const { parseAndValidateQueryParams, formatDuration } = require("../../utils/time");
const {
  splitTimeRangeForHybridItems,
  getItemsCachedDataForDays,
  getItemsSessionDataForPartialDays,
  combineItemsHybridData,
  buildItemSummaryRows,
} = require("../../utils/itemFunctions");

const DELAYED_ITEM_JOB_PREFIX = 'delayedItemConfigApply:';

module.exports = function(server) {
	return constructor(server);
}

function constructor(server) {
	const db = server.db;
	const collection = db.collection(config.itemCollectionName);
	const logger = server.logger;
	const xmlParser = server.xmlParser;
	const configService = require('../../services/mongo/');
	const itemValidator = require('../../middleware/itemValidator')(server);
	const imageUploadDir = path.join(server.appRoot.path, 'uploads', 'images');
	const upload = multer({
		storage: multer.memoryStorage(),
		limits: { fileSize: 10 * 1024 * 1024 },
		fileFilter: (req, file, callback) => {
			const allowedMimeTypes = ['image/jpeg', 'image/png'];
			const allowedExtensions = ['.jpg', '.jpeg', '.png'];
			const ext = path.extname(file.originalname || '').toLowerCase();

			if (allowedMimeTypes.includes(file.mimetype) && allowedExtensions.includes(ext)) {
				return callback(null, true);
			}

			const error = new Error('Only JPG and PNG item images are allowed.');
			error.status = 400;
			return callback(error);
		}
	});

	function getApplyChangeWaitTimeMs() {
		const minutes = Number(config.applyChangeWaitTime) || 10;
		return Math.max(1, minutes) * 60 * 1000;
	}

	function wantsDelayedApply(req) {
		return req.query.applyAfterMachinesOffline === 'true';
	}

	async function findOnlineMachine() {
		const tickerCollection = db.collection(config.stateTickerCollectionName);
		return tickerCollection.findOne(
			{ 'status.code': { $ne: -1 } },
			{ projection: { _id: 0, machine: 1, status: 1 } }
		);
	}

	// Block item configuration updates unless every machine is explicitly Offline (-1).
	async function ensureAllMachinesOffline(req, res, next) {
		try {
			const onlineMachine = await findOnlineMachine();
			if (onlineMachine) {
				return res.status(409).json({
					message: 'Cannot update item configuration while machines are online.'
				});
			}

			next();
		} catch (error) {
			next(error);
		}
	}

	function setScheduledJob(jobKey, job) {
		if (!server.scheduledJobs) server.scheduledJobs = {};
		server.scheduledJobs[jobKey] = job;
	}

	function clearScheduledJob(jobKey) {
		if (!server.scheduledJobs) return;
		server.scheduledJobs[jobKey] = null;
	}

	async function applyItemConfigChange(id, itemPayload) {
		const updates = { ...itemPayload };
		if (updates._id) delete updates._id;
		if (updates.weight === undefined) updates.weight = null;
		updates.timestamps = await stampItemWrite(id, updates);

		return configService.upsertConfiguration(
			collection,
			id ? { _id: id, ...updates } : updates,
			true,
			'id'
		);
	}

	async function getExistingItem(id) {
		if (!id) return null;
		return collection.findOne({ _id: new ObjectId(id) });
	}

	async function stampItemWrite(id, updates) {
		const now = new Date();
		const existing = await getExistingItem(id);

		if (id && !existing) {
			const error = new Error('Item not found');
			error.status = 404;
			throw error;
		}

		let timestamps = existing?.timestamps
			? timestampsSchema.utils.stampUpdate(existing.timestamps, now)
			: timestampsSchema.utils.stampInit(now);

		if (updates.active === true && existing?.active !== true) {
			timestamps = timestampsSchema.utils.stampActive(timestamps, now);
			delete timestamps.inactive;
		} else if (updates.active === false && existing?.active !== false) {
			timestamps = timestampsSchema.utils.stampInactive(timestamps, now);
		}

		return timestamps;
	}

	function sanitizeUploadedImageFields(req, res, next) {
		const normalized = { ...req.body };

		delete normalized.timestamps;

		if (normalized.id !== undefined) normalized.id = Number(normalized.id);
		if (normalized.number !== undefined && normalized.id === undefined) {
			normalized.id = Number(normalized.number);
		}
		delete normalized.number;
		if (normalized.active !== undefined) normalized.active = normalized.active === true || normalized.active === 'true';
		if (normalized.weight === '' || normalized.weight === undefined) {
			normalized.weight = null;
		} else {
			normalized.weight = Number(normalized.weight);
		}
		if (normalized.standard !== undefined) normalized.standard = Number(normalized.standard);
		if (normalized.area !== undefined) normalized.area = Number(normalized.area);

		req.body = normalized;
		next();
	}

	function safeFileNamePart(value) {
		return String(value ?? '')
			.trim()
			.replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
			.replace(/\s+/g, ' ')
			.slice(0, 120);
	}

	async function prepareItemImage(req, res, next) {
		if (!req.file) return next();

		try {
			const itemId = safeFileNamePart(req.body.id ?? req.body.number);
			const itemName = safeFileNamePart(req.body.name);
			const ext = path.extname(req.file.originalname).toLowerCase() === '.png' ? '.png' : '.jpg';
			const fileName = `${itemId}-${itemName}${ext}`;
			const filePath = path.join(imageUploadDir, fileName);

			req.body.photo = filePath;
			req.pendingItemImage = {
				filePath,
				buffer: req.file.buffer
			};
			next();
		} catch (error) {
			next(error);
		}
	}

	async function persistPreparedItemImage(req) {
		if (!req.pendingItemImage) return;
		await fs.promises.mkdir(imageUploadDir, { recursive: true });
		await fs.promises.writeFile(req.pendingItemImage.filePath, req.pendingItemImage.buffer);
	}

	function scheduleDelayedItemApply({ id, itemPayload, originalRequestTimestamp, attempt = 1 }) {
		const waitTimeMs = getApplyChangeWaitTimeMs();
		const runAt = new Date(Date.now() + waitTimeMs);
		const jobKey = `${DELAYED_ITEM_JOB_PREFIX}${originalRequestTimestamp}:${attempt}`;

		const job = schedule.scheduleJob(runAt, async () => {
			clearScheduledJob(jobKey);
			try {
				const onlineMachine = await findOnlineMachine();
				if (onlineMachine) {
					logger.info('[delayedItemApply] Machines still online; scheduling next attempt.', {
						id,
						id: itemPayload.id,
						originalRequestTimestamp,
						attempt,
						nextAttempt: attempt + 1
					});
					scheduleDelayedItemApply({
						id,
						itemPayload,
						originalRequestTimestamp,
						attempt: attempt + 1
					});
					return;
				}

				await applyItemConfigChange(id, itemPayload);
				logger.info('[delayedItemApply] Item config change applied.', {
					id,
					id: itemPayload.id,
					originalRequestTimestamp,
					attempt
				});
			} catch (error) {
				logger.error('[delayedItemApply] Apply attempt failed.', {
					id,
					id: itemPayload.id,
					originalRequestTimestamp,
					attempt,
					error: error.message,
					stack: error.stack
				});
			}
		});

		if (!job) {
			throw new Error('Could not schedule delayed item config apply job.');
		}

		setScheduledJob(jobKey, job);
		logger.info('[delayedItemApply] Scheduled item config change.', {
			jobKey,
			id,
			id: itemPayload.id,
			originalRequestTimestamp,
			attempt,
			runAt: runAt.toISOString()
		});

		return { jobKey, runAt };
	}

	async function scheduleDelayedItemApplyHandler(req, res, next) {
		try {
			await persistPreparedItemImage(req);
			const originalRequestTimestamp = new Date().toISOString();
			const scheduled = scheduleDelayedItemApply({
				id: req.params.id,
				itemPayload: { ...req.body },
				originalRequestTimestamp
			});

			return res.status(202).json({
				message: 'Item configuration changes will be applied after all machines are offline.',
				scheduled: true,
				originalRequestTimestamp,
				nextAttemptAt: scheduled.runAt.toISOString(),
				jobKey: scheduled.jobKey
			});
		} catch (error) {
			next(error);
		}
	}

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
	
			await persistPreparedItemImage(req);
			const result = await applyItemConfigChange(id, updates);

			logger.info('[upsertItem] Item updated successfully:', {
				id: id,
				id: updates.id,
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

			const results = await configService.deleteConfiguration(collection, id);
			
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
			// Find the highest id value
			const result = await collection
				.find({})
				.sort({ id: -1 })
				.limit(1)
				.toArray();
			
			// If no items exist, start from 1, otherwise add 1 to the highest
			const nextId = result.length > 0 ? result[0].id + 1 : 1;
			
			res.json({ id: nextId });
		} catch (e) { 
			logger.error('[getNewItemId] Error:', {
				error: e.message,
				stack: e.stack,
				timestamp: new Date().toISOString()
			});
			next(e); 
		}
	}

	/*** Item Config Routes */
	/** GET routes */
	router.get('/item/config/xml', getItemXML);
	router.get('/item/config', getItem);
	router.get('/item/new-id', getNewItemId);

	/** POST / PUT routes */
	router.post('/item/config', upload.single('photoFile'), sanitizeUploadedImageFields, prepareItemImage, itemValidator, (req, res, next) => {
		if (wantsDelayedApply(req)) return scheduleDelayedItemApplyHandler(req, res, next);
		return ensureAllMachinesOffline(req, res, next);
	}, upsertItem);
	router.put('/item/config/:id', upload.single('photoFile'), sanitizeUploadedImageFields, prepareItemImage, itemValidator, (req, res, next) => {
		if (wantsDelayedApply(req)) return scheduleDelayedItemApplyHandler(req, res, next);
		return ensureAllMachinesOffline(req, res, next);
	}, upsertItem);

	/** DELETE routes */
	router.delete('/item/config/:id', deleteItem);


	// Item Routes 

  // GET /api/item/analytics/items-summary-daily-cache
  // Hybrid cached/session route for item summary, mirroring itemSessions.js implementation.
  router.get("/item/analytics/items-summary-daily-cache", async (req, res) => {
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

        return res.json(buildItemSummaryRows(sessionItems));
      }

      if (isPartialDay && isToday) {
        // still use totals-daily collection for today
      }

      const HYBRID_THRESHOLD_HOURS = 24;
      const timeRangeHours = (exactEnd - exactStart) / (1000 * 60 * 60);

      const useHybrid = timeRangeHours > HYBRID_THRESHOLD_HOURS;

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
        const cacheCollection = db.collection(config.totalsDailyCollectionName);

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

      res.json(buildItemSummaryRows(itemTotals));
    } catch (err) {
      res
        .status(500)
        .json({ error: "Failed to generate items summary from daily cache" });
    }
  });

	return router;
}
