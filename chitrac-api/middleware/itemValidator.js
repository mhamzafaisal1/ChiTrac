const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajvErrors = require('ajv-errors');

const itemSchema = require('../schemas/itemCrudSchema.js');

const ajv = new Ajv({ allErrors: true, useDefaults: true });
addFormats(ajv);
ajvErrors(ajv);

const validateItem = ajv.compile(itemSchema);

function itemValidator(server) {
  const logger = server.logger;
  
  return function(req, res, next) {
    // Log validation attempt
    logger.debug('Item validation attempt', {
      method: req.method,
      url: req.url,
      bodyKeys: Object.keys(req.body || {}),
      timestamp: new Date().toISOString()
    });

    const valid = validateItem(req.body);
    
    if (!valid) {
      // Log validation failure with details
      logger.warn('Item validation failed', {
        method: req.method,
        url: req.url,
        errors: validateItem.errors,
        body: req.body,
        timestamp: new Date().toISOString()
      });
      
      return res.status(400).json({
        error: 'Validation failed',
        details: validateItem.errors
      });
    }
    
    // Log successful validation
    logger.debug('Item validation successful', {
      method: req.method,
      url: req.url,
      bodyKeys: Object.keys(req.body || {}),
      timestamp: new Date().toISOString()
    });
    
    next();
  };
}

module.exports = itemValidator;
