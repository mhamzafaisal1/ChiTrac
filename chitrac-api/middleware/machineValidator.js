const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajvErrors = require('ajv-errors');
const { ObjectId } = require('mongodb');

const machineSchema = require('../schemas/machine.js');
const config = require('../modules/config');

const ajv = new Ajv({ allErrors: true, useDefaults: true });
addFormats(ajv);
ajvErrors(ajv);

const validateMachine = ajv.compile(machineSchema.schema);

function machineValidator(server) {
  const logger = server.logger;
  
  return async function(req, res, next) {
    // Log validation attempt
    logger.debug('Machine validation attempt', {
      method: req.method,
      url: req.url,
      bodyKeys: Object.keys(req.body || {}),
      timestamp: new Date().toISOString()
    });

    const body = { ...(req.body || {}) };
    delete body._id;

    if (body.id === undefined && body.serial !== undefined) {
      body.id = Number(body.serial);
    }
    delete body.serial;

    const now = new Date();
    if (req.params?.id) {
      let objectId;
      try {
        objectId = new ObjectId(req.params.id);
      } catch (error) {
        return res.status(400).json({
          error: 'Validation failed',
          details: [{ instancePath: '/_id', message: 'must be a valid ObjectId' }]
        });
      }

      const existing = await server.db
        .collection(config.machineCollectionName)
        .findOne({ _id: objectId }, { projection: { timestamps: 1 } });
      body.timestamps = body.timestamps || existing?.timestamps || machineSchema.utils.stampInit(now);
    } else {
      body.timestamps = body.timestamps || machineSchema.utils.stampInit(now);
    }

    req.body = body;

    const valid = validateMachine(req.body);
    
    if (!valid) {
      // Log validation failure with details
      logger.warn('Machine validation failed', {
        method: req.method,
        url: req.url,
        errors: validateMachine.errors,
        body: req.body,
        timestamp: new Date().toISOString()
      });
      
      return res.status(400).json({
        error: 'Validation failed',
        details: validateMachine.errors
      });
    }
    
    // Log successful validation
    logger.debug('Machine validation successful', {
      method: req.method,
      url: req.url,
      bodyKeys: Object.keys(req.body || {}),
      timestamp: new Date().toISOString()
    });
    
    next();
  };
}

module.exports = machineValidator;
