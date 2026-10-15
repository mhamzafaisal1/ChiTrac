const Ajv = require('ajv');

const controllers = Object.freeze([
  { id: 'general', label: 'General' },
  { id: 'settings', label: 'Settings' },
  { id: 'spindle', label: 'Spindle' },
  { id: 'milnor', label: 'Milnor' },
  { id: 'softrol', label: 'Softrol' }
].map(Object.freeze));
const controllerIds = Object.freeze(controllers.map(controller => controller.id));
const allowedControllersSchema = {
  type: 'array', items: { type: 'string', enum: [...controllerIds] },
  uniqueItems: true, maxItems: controllerIds.length
};
const validateAllowedControllers = new Ajv().compile(allowedControllersSchema);

async function migrateApiTokenControllerAccess(db, logger) {
  // Only pre-feature records receive legacy access; explicit empty/invalid values never do.
  const result = await db.collection('auth-tokens').updateMany(
    { allowedControllers: { $exists: false } },
    { $set: { allowedControllers: [...controllerIds] } }
  );
  logger?.info?.(`Migrated controller access for ${result.modifiedCount} API tokens`);
}

module.exports = { controllers, controllerIds, allowedControllersSchema,
  validateAllowedControllers, migrateApiTokenControllerAccess };
