const { normalizeName,validateReference,stationLayout,problem } = require('../../utils/productionLayouts');
const { configuredProductionStations } = require('../../utils/spfLayout');

/** Named definitions are separate from each user's editable working layout. */
function createProductionLayoutStore({ db,config,systemPreferences }) {
  const users=db.collection(config.userPreferencesCollectionName || 'preferences-user');
  const systems=systemPreferences.getCollection(db,config);
  const systemId=systemPreferences.SINGLETON_ID;
  async function availableStations(){
    const machines=await db.collection(config.machineCollectionName || 'config-machine').find({active:true}).toArray();
    return configuredProductionStations(machines);
  }
  async function ensureUser(userId){
    const now=new Date();
    try { await users.updateOne({userId},{$setOnInsert:{userId,timestamps:{create:now,active:now,update:now}}},{upsert:true}); }
    catch(error){if(error.code!==11000)throw error;}
  }
  async function activate(userId,reference,entry,layout,stations){
    await ensureUser(userId);
    const result=await users.updateOne({userId},{$set:{
      'dashboardLayouts.experimentalSpf':layout,defaultProductionScreenLayout:reference,'timestamps.update':new Date()
    }});
    if(!result.matchedCount)throw problem(503,'Could not save your default layout. Please try again.');
    return {layout:{...entry,scope:reference.scope},stations,preferences:await users.findOne({userId})};
  }
  return {
    async list(userId){
      const [system,user]=await Promise.all([systemPreferences.ensureSystemPreferences(db,config),users.findOne({userId})]);
      const entries=(library,scope)=>Object.values(library || {}).map(entry=>({...entry,scope}));
      return {layouts:[...entries(system?.productionScreenLayouts,'system'),...entries(user?.productionScreenLayouts,'user')]
        .sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'}) || a.scope.localeCompare(b.scope)),
        defaultLayout:user?.defaultProductionScreenLayout || null};
    },
    async load(userId,reference){
      reference=validateReference(reference);
      const owner=reference.scope==='system'?await systemPreferences.ensureSystemPreferences(db,config):await users.findOne({userId});
      const entry=owner?.productionScreenLayouts?.[reference.id];
      if(!entry)throw problem(404,'This layout is no longer available. Refresh the list and choose another layout.');
      const stations=await availableStations();
      const layout=stationLayout(entry.stationIds,stations);
      return activate(userId,reference,entry,layout,stations);
    },
    async create(userId,scope,input){
      if(!['user','system'].includes(scope))throw problem(400,'Choose User or System.');
      const {id,name}=normalizeName(input?.name);
      const stations=await availableStations();
      const layout=stationLayout(input?.stationIds,stations);
      const entry={id,name,stationIds:layout.stationOrder,createdAt:new Date().toISOString()};
      const reference={scope,id};
      const path='productionScreenLayouts.'+id;
      if(scope==='system')await systemPreferences.ensureSystemPreferences(db,config);else await ensureUser(userId);
      const collection=scope==='system'?systems:users;
      const identity=scope==='system'?{_id:systemId}:{userId};
      const update={ [path]:entry,'timestamps.update':new Date() };
      // A conditional field update enforces name uniqueness even for simultaneous creates.
      if(scope==='user')Object.assign(update,{'dashboardLayouts.experimentalSpf':layout,defaultProductionScreenLayout:reference});
      const result=await collection.updateOne({...identity,[path]:{$exists:false}},{$set:update});
      if(!result.matchedCount)throw problem(409,'A layout with this name already exists in '+(scope==='system'?'System layouts.':'your User layouts.')+' Choose another name.');
      if(scope==='user')return {layout:{...entry,scope},stations,preferences:await users.findOne({userId})};
      try { return await activate(userId,reference,entry,layout,stations); }
      catch(error){throw Object.assign(problem(503,'The System layout was created, but could not be made your default. Retry to load it.'),{createdLayoutRef:reference});}
    }
  };
}

function registerProductionLayoutRoutes(router,{db,config,systemPreferences,requireUser,requirePermissionLevel}){
  const store=createProductionLayoutStore({db,config,systemPreferences});
  const authenticate=(req,res,next)=>{
    if(req.tokenPayload?.bypassed || !req.authUserId)return res.status(401).json({error:'Log in to use saved production layouts.'});
    next();
  };
  const handle=action=>async(req,res,next)=>{
    try{res.json(await action(req));}
    catch(error){if(error.createdLayoutRef)return res.status(error.status).json({error:error.message,createdLayoutRef:error.createdLayoutRef});next(error);}
  };
  router.get('/production-layouts',requireUser,authenticate,requirePermissionLevel(7),handle(req=>store.list(req.authUserId)));
  router.post('/production-layouts/user',requireUser,authenticate,requirePermissionLevel(7),handle(req=>store.create(req.authUserId,'user',req.body)));
  router.post('/production-layouts/system',requireUser,authenticate,requirePermissionLevel(7),handle(req=>store.create(req.authUserId,'system',req.body)));
  router.post('/production-layouts/load',requireUser,authenticate,requirePermissionLevel(7),handle(req=>store.load(req.authUserId,req.body)));
}
module.exports={createProductionLayoutStore,registerProductionLayoutRoutes};
