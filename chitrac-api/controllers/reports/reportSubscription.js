const express = require("express");
const schedule = require("node-schedule");
const { ObjectId } = require("mongodb");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const reportSubscriptionSchema = require("../../schemas/reportSubscription");
const timestampsSchema = require("../../schemas/timestampsSchema");

const ajv = new Ajv();
addFormats(ajv);
const validateReportSubscription = ajv.compile(reportSubscriptionSchema.schema);

const COLLECTION_NAME = "reportSubscription";
const JOB_PREFIX = "reportSubscription:";

const toResponseDoc = (doc) => ({
  ...doc,
  _id: String(doc._id),
});

const parseObjectId = (id) => {
  try {
    return new ObjectId(String(id));
  } catch (error) {
    return null;
  }
};

const parsePayload = (body = {}) => {
  const payload = {
    name: body?.name,
    enabled: body?.enabled !== undefined ? Boolean(body.enabled) : true,
    report: body?.report,
    email: body?.email,
    schedule: body?.schedule,
  };

  if (body?.lastAttempt !== undefined) {
    payload.lastAttempt = body.lastAttempt;
  }
  if (body?.log !== undefined) {
    payload.log = body.log;
  }

  return payload;
};

const buildValidatedDocForCreate = (payload) => {
  const baseDoc = reportSubscriptionSchema.utils.initReportSubscription(
    payload.name,
    payload.report,
    payload.email,
    payload.schedule,
    payload.lastAttempt ?? null,
    payload.log ?? null
  );

  if (payload.enabled === false) {
    baseDoc.enabled = false;
  }

  const valid = validateReportSubscription(baseDoc);
  if (!valid) {
    throw new Error(`Schema validation failed: ${ajv.errorsText(validateReportSubscription.errors)}`);
  }

  return baseDoc;
};

const updateExecutionLog = async (db, docId, status, details) => {
  const now = new Date().toISOString();
  const current = await db.collection(COLLECTION_NAME).findOne({ _id: docId });
  if (!current) return;

  const nextDoc = {
    ...current,
    lastAttempt: now,
    log: {
      status,
      details,
      timestamp: now,
    },
    timestamps: timestampsSchema.utils.stampUpdate(current.timestamps, now),
  };

  const valid = validateReportSubscription(nextDoc);
  if (!valid) return;

  await db.collection(COLLECTION_NAME).updateOne(
    { _id: docId },
    {
      $set: {
        lastAttempt: nextDoc.lastAttempt,
        log: nextDoc.log,
        timestamps: nextDoc.timestamps,
      },
    }
  );
};

const runSubscriptionJob = async (server, subscriptionDoc) => {
  const logger = server.logger;
  try {
    logger.info(
      `[reportSubscription] Triggered subscription ${subscriptionDoc._id} (${subscriptionDoc.name})`
    );
    await updateExecutionLog(
      server.db,
      subscriptionDoc._id,
      "success",
      `Scheduled run triggered for ${subscriptionDoc.report?.name}:${subscriptionDoc.report?.type}`
    );
  } catch (error) {
    logger.error(
      `[reportSubscription] Execution failed for ${subscriptionDoc._id}:`,
      error
    );
    await updateExecutionLog(server.db, subscriptionDoc._id, "error", error?.message || String(error));
  }
};

const scheduleSubscriptionJob = (server, subscriptionDoc) => {
  if (!subscriptionDoc?.enabled) {
    return null;
  }

  const cron = subscriptionDoc?.schedule?.cron;
  if (!cron || typeof cron !== "string") {
    throw new Error("Missing or invalid schedule.cron");
  }

  const job = schedule.scheduleJob(cron, async () => {
    await runSubscriptionJob(server, subscriptionDoc);
  });

  if (!job) {
    throw new Error("Invalid cron expression. Could not schedule job.");
  }

  return job;
};

const setScheduledJob = (server, subscriptionId, jobOrNull) => {
  if (!server.scheduledJobs) server.scheduledJobs = {};
  server.scheduledJobs[`${JOB_PREFIX}${subscriptionId}`] = jobOrNull;
};

const cancelScheduledJob = (server, subscriptionId) => {
  if (!server.scheduledJobs) return;
  const key = `${JOB_PREFIX}${subscriptionId}`;
  const existing = server.scheduledJobs[key];
  if (existing && typeof existing.cancel === "function") {
    try {
      existing.cancel();
    } catch (error) {
      server.logger.warn(`[reportSubscription] Failed to cancel job ${key}:`, error);
    }
  }
  server.scheduledJobs[key] = null;
};

const registerSubscriptionAtStartup = async (server) => {
  const db = server.db;
  const logger = server.logger;
  const docs = await db
    .collection(COLLECTION_NAME)
    .find({ enabled: true })
    .toArray();

  for (const doc of docs) {
    try {
      const valid = validateReportSubscription(doc);
      if (!valid) {
        logger.warn(
          `[reportSubscription] Skipping invalid subscription ${doc?._id}: ${ajv.errorsText(validateReportSubscription.errors)}`
        );
        continue;
      }
      const job = scheduleSubscriptionJob(server, doc);
      setScheduledJob(server, String(doc._id), job);
      logger.info(`[reportSubscription] Registered startup job for ${doc._id}`);
    } catch (error) {
      logger.error(
        `[reportSubscription] Failed startup registration for ${doc?._id}:`,
        error
      );
    }
  }
};

module.exports = function (server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

  router.get("/", async (req, res) => {
    try {
      const docs = await db
        .collection(COLLECTION_NAME)
        .find({})
        .sort({ "timestamps.update": -1, "timestamps.create": -1 })
        .toArray();
      return res.json(docs.map(toResponseDoc));
    } catch (error) {
      logger.error("[reportSubscription] list failed:", error);
      return res.status(500).json({ error: "Failed to list report subscriptions." });
    }
  });

  router.get("/:id", async (req, res) => {
    const docId = parseObjectId(req.params.id);
    if (!docId) {
      return res.status(400).json({ error: "Invalid subscription id." });
    }
    try {
      const doc = await db.collection(COLLECTION_NAME).findOne({ _id: docId });
      if (!doc) {
        return res.status(404).json({ error: "Report subscription not found." });
      }
      return res.json(toResponseDoc(doc));
    } catch (error) {
      logger.error("[reportSubscription] get failed:", error);
      return res.status(500).json({ error: "Failed to fetch report subscription." });
    }
  });

  router.post("/", async (req, res) => {
    let scheduledJob = null;
    const docId = new ObjectId();
    try {
      const payload = parsePayload(req.body || {});
      const doc = buildValidatedDocForCreate(payload);
      doc._id = docId;

      if (doc.enabled) {
        scheduledJob = scheduleSubscriptionJob(server, doc);
      }

      const insertResult = await db.collection(COLLECTION_NAME).insertOne(doc);
      if (!insertResult?.acknowledged) {
        throw new Error("Mongo insert was not acknowledged.");
      }

      setScheduledJob(server, String(docId), scheduledJob);
      return res.status(201).json(toResponseDoc(doc));
    } catch (error) {
      if (scheduledJob && typeof scheduledJob.cancel === "function") {
        try {
          scheduledJob.cancel();
        } catch (cancelError) {
          logger.warn("[reportSubscription] failed to cancel unsaved job:", cancelError);
        }
      }
      logger.error("[reportSubscription] create failed:", error);
      return res.status(400).json({ error: error?.message || "Failed to create report subscription." });
    }
  });

  router.put("/:id", async (req, res) => {
    const docId = parseObjectId(req.params.id);
    if (!docId) {
      return res.status(400).json({ error: "Invalid subscription id." });
    }

    let newJob = null;
    try {
      const existing = await db.collection(COLLECTION_NAME).findOne({ _id: docId });
      if (!existing) {
        return res.status(404).json({ error: "Report subscription not found." });
      }

      const payload = parsePayload(req.body || {});
      const now = new Date().toISOString();
      const nextDoc = {
        ...existing,
        ...payload,
        _id: existing._id,
        timestamps: timestampsSchema.utils.stampUpdate(existing.timestamps, now),
      };

      const valid = validateReportSubscription(nextDoc);
      if (!valid) {
        return res
          .status(400)
          .json({ error: `Schema validation failed: ${ajv.errorsText(validateReportSubscription.errors)}` });
      }

      if (nextDoc.enabled) {
        newJob = scheduleSubscriptionJob(server, nextDoc);
      }

      const updateResult = await db
        .collection(COLLECTION_NAME)
        .updateOne({ _id: docId }, { $set: nextDoc });
      if (!updateResult?.acknowledged) {
        throw new Error("Mongo update was not acknowledged.");
      }

      cancelScheduledJob(server, String(docId));
      setScheduledJob(server, String(docId), newJob);
      return res.json(toResponseDoc(nextDoc));
    } catch (error) {
      if (newJob && typeof newJob.cancel === "function") {
        try {
          newJob.cancel();
        } catch (cancelError) {
          logger.warn("[reportSubscription] failed to cancel update job:", cancelError);
        }
      }
      logger.error("[reportSubscription] update failed:", error);
      return res.status(400).json({ error: error?.message || "Failed to update report subscription." });
    }
  });

  router.delete("/:id", async (req, res) => {
    const docId = parseObjectId(req.params.id);
    if (!docId) {
      return res.status(400).json({ error: "Invalid subscription id." });
    }

    try {
      const deleteResult = await db.collection(COLLECTION_NAME).deleteOne({ _id: docId });
      if (!deleteResult?.deletedCount) {
        return res.status(404).json({ error: "Report subscription not found." });
      }

      cancelScheduledJob(server, String(docId));
      return res.json({ ok: true });
    } catch (error) {
      logger.error("[reportSubscription] delete failed:", error);
      return res.status(500).json({ error: "Failed to delete report subscription." });
    }
  });

  registerSubscriptionAtStartup(server).catch((error) => {
    logger.error("[reportSubscription] startup registration failed:", error);
  });

  return router;
};
