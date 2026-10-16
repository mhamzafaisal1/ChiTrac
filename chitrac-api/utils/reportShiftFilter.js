const { ObjectId } = require('mongodb');
const config = require('../modules/config');

function sessionShiftFilter(shiftId, { includeUntagged = false } = {}) {
  if (!shiftId) return {};
  const id = String(shiftId);
  const candidates = ObjectId.isValid(id) ? [id, new ObjectId(id)] : [id];
  if (!includeUntagged) return { 'shift._id': { $in: candidates } };
  // Callers opting in must also clip sessions to the selected shift's time windows.
  return {
    $or: [
      { 'shift._id': { $in: candidates } },
      { 'shift.id': { $in: candidates } },
      { shiftId: { $in: candidates } },
      { $and: ['shift._id', 'shift.id', 'shiftId'].map(field => ({ [field]: { $in: [null, ''] } })) }
    ]
  };
}

function reportShiftMiddleware(db) {
  return async (req, res, next) => {
    const shiftId = req.query.shiftId;
    if (shiftId == null || shiftId === '') return next();
    if (typeof shiftId !== 'string' || !ObjectId.isValid(shiftId)) {
      return res.status(400).json({ error: 'Invalid shiftId' });
    }
    try {
      const shift = await db.collection(config.shiftCollectionName).findOne({ _id: new ObjectId(shiftId) });
      if (!shift) return res.status(404).json({ error: 'Shift not found' });
      req.reportShift = shift;
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { sessionShiftFilter, reportShiftMiddleware };
