const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajvErrors = require('ajv-errors');

const machineSchema = require('../schemas/machineCrudSchema.js');

const ajv = new Ajv({ allErrors: true, useDefaults: true });
addFormats(ajv);
ajvErrors(ajv);

const validateMachine = ajv.compile(machineSchema);

function machineValidator(server) {
  const logger = server.logger;
  
  return function(req, res, next) {
    // Log validation attempt
    logger.debug('Machine validation attempt', {
      method: req.method,
      url: req.url,
      bodyKeys: Object.keys(req.body || {}),
      timestamp: new Date().toISOString()
    });

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
