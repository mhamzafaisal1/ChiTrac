const { ObjectId } = require('mongodb');
const config = require('../modules/config');

function sessionShiftFilter(shiftId) {
  if (!shiftId) return {};
  const id = String(shiftId);
  return { 'shift._id': { $in: ObjectId.isValid(id) ? [id, new ObjectId(id)] : [id] } };
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
