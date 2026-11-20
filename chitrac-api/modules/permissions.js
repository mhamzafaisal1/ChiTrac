const { ObjectId } = require('mongodb');

function getPermissionLevel(user) {
  const level = user?.permissions?.level;
  return typeof level === 'number' && Number.isFinite(level) ? level : null;
}

function hasPermissionLevel(user, requiredLevel) {
  if (!user || user.active === false) return false;
  const level = getPermissionLevel(user);
  return level !== null && level <= requiredLevel;
}

function assertPermissionLevel(user, requiredLevel) {
  if (!user || user.active === false) {
    const error = new Error('User is not valid or active');
    error.status = 403;
    throw error;
  }

  if (!hasPermissionLevel(user, requiredLevel)) {
    const error = new Error('Insufficient permissions');
    error.status = 403;
    throw error;
  }

  return true;
}

/**
 * Shared step of every requirePermissionLevel middleware: load the token's user
 * and check the level. How the token is read and verified stays with each
 * controller, because those rules differ (permanent tokens, revocation checks).
 */
async function findPermittedUser(userCollection, userId, requiredLevel) {
  const user = await userCollection.findOne({ _id: new ObjectId(userId) });
  assertPermissionLevel(user, requiredLevel);
  return user;
}

module.exports = {
  getPermissionLevel,
  hasPermissionLevel,
  assertPermissionLevel,
  findPermittedUser
};
