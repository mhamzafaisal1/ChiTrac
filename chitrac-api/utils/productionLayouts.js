const { createHash } = require('node:crypto');
const { sanitizeSpfLayout } = require('./spfLayout');
const idPattern = '^[a-f0-9]{64}$';
const referenceSchema = { type: ['object', 'null'], required: ['scope','id'], properties: { scope: { enum: ['user','system'] }, id: { type: 'string', pattern: idPattern } }, additionalProperties: false };
const librarySchema = {
  type: 'object', propertyNames: { pattern: idPattern }, additionalProperties: {
    type: 'object', required: ['id','name','stationIds','createdAt'], additionalProperties: false,
    properties: {
      id: {type:'string',pattern:idPattern}, name: {type:'string',minLength:1,maxLength:80},
      stationIds: {type:'array',minItems:3,maxItems:6,uniqueItems:true,items:{type:'string',maxLength:40}},
      createdAt: {type:'string',format:'date-time'}
    }
  }
};
function problem(status, message) { return Object.assign(new Error(message), {status}); }
function normalizeName(value) {
  if(typeof value !== 'string') throw problem(400,'Enter a layout name.');
  const name=value.normalize('NFKC').trim().replace(/\s+/g,' ');
  if(!name || name.length>80) throw problem(400,'Enter a layout name between 1 and 80 characters.');
  return {name,id:createHash('sha256').update(name.toLowerCase()).digest('hex')};
}
function validateReference(reference) {
  if(!reference || !['user','system'].includes(reference.scope) || typeof reference.id!=='string' || !/^[a-f0-9]{64}$/.test(reference.id)) throw problem(400,'Select a valid production layout.');
  return {scope:reference.scope,id:reference.id};
}
function stationLayout(stationIds, availableStations) {
  if(!Array.isArray(stationIds) || stationIds.length<3 || stationIds.length>6) throw problem(400,'Choose 3–6 active configured stations.');
  try { return sanitizeSpfLayout({stationOrder:stationIds,stationVisibility:Object.fromEntries(stationIds.map(id=>[id,true]))},availableStations); }
  catch { throw problem(400,'This layout contains unavailable or invalid stations. Choose 3–6 active configured stations.'); }
}
module.exports={librarySchema,referenceSchema,normalizeName,validateReference,stationLayout,problem};
