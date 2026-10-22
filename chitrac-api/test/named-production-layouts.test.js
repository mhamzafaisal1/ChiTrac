const test=require('node:test');
const assert=require('node:assert/strict');
const {createProductionLayoutStore,registerProductionLayoutRoutes}=require('../controllers/preferences/production-layouts');
const {normalizeName}=require('../utils/productionLayouts');
const schema=require('../schemas/system-preferences');
const systemModule=require('../modules/systemPreferences');

function get(object,path){return path.split('.').reduce((value,key)=>value?.[key],object);}
function set(object,path,value){const parts=path.split('.');let target=object;for(const part of parts.slice(0,-1))target=target[part] ||= {};target[parts.at(-1)]=structuredClone(value);}
function harness(){
 const machines=[{id:100,name:'Feeder',active:true,stations:[1,2,3,4]},{id:200,name:'Ironer',active:true,stations:[1,2]},{id:300,name:'Inactive',active:false,stations:[1]}];
 const userDocs=new Map([['alice',{userId:'alice',theme:'dark',timeFormat:'24h'}],['bob',{userId:'bob',theme:'light'}]]);
 const systemDocs=new Map([['system-preferences',{_id:'system-preferences',systemName:'Test',productionScreenLayouts:{}}]]);
 let failActivation=false;
 function collection(docs,key){return {
  async findOne(filter){const doc=docs.get(filter[key]);return doc?structuredClone(doc):null;},
  async updateOne(filter,update,options={}){
   const identity=filter[key];let doc=docs.get(identity);
   if(!doc){if(!options.upsert)return {matchedCount:0,modifiedCount:0};doc={[key]:identity};for(const [path,value]of Object.entries(update.$setOnInsert || {}))set(doc,path,value);docs.set(identity,doc);}
   for(const [path,value]of Object.entries(filter)){if(path===key)continue;if(value?.$exists!==undefined && (get(doc,path)!==undefined)!==value.$exists)return {matchedCount:0,modifiedCount:0};}
   if(key==='userId' && failActivation && update.$set?.defaultProductionScreenLayout && !Object.keys(update.$set).some(path=>path.startsWith('productionScreenLayouts.'))){failActivation=false;throw Error('temporary database failure');}
   for(const [path,value]of Object.entries(update.$set || {}))set(doc,path,value);
   for(const path of Object.keys(update.$unset || {}))delete doc[path];
   return {matchedCount:1,modifiedCount:1};
  }
 };}
 const users=collection(userDocs,'userId'),systems=collection(systemDocs,'_id');
 const db={collection:name=>name==='config-machine'?{find:()=>({toArray:async()=>structuredClone(machines)})}:name==='preferences-system'?systems:users};
 const systemPreferences={SINGLETON_ID:'system-preferences',getCollection:()=>systems,ensureSystemPreferences:async()=>systems.findOne({_id:'system-preferences'})};
 const dependencies={db,config:{},systemPreferences};
 return {store:createProductionLayoutStore(dependencies),dependencies,userDocs,systemDocs,machines,failNextActivation(){failActivation=true;}};
}
const input=(name='Line A',stationIds=['100:3','100:1','200:2'])=>({name,stationIds});

test('User creation atomically saves a named snapshot and current default, preserving other preferences',async()=>{
 const h=harness();const result=await h.store.create('alice','user',input());
 assert.equal(result.layout.scope,'user');assert.equal(result.preferences.defaultProductionScreenLayout.id,result.layout.id);
 assert.deepEqual(result.preferences.dashboardLayouts.experimentalSpf.stationOrder,input().stationIds);
 assert.equal(result.preferences.theme,'dark');assert.equal(result.preferences.timeFormat,'24h');
 assert.equal(result.stations.find(s=>s.id==='100:3').label,'Feeder — Station 3');
 assert.equal(h.userDocs.get('bob').defaultProductionScreenLayout,undefined);
 assert.equal((await h.store.list('bob')).layouts.length,0);
});
test('System creation is shared but only changes the creator’s default; same names across scopes stay distinct',async()=>{
 const h=harness();const system=await h.store.create('alice','system',input('Shared'));
 const own=await h.store.create('alice','user',input('Shared',['100:1','100:2','100:4']));
 const alice=await h.store.list('alice'),bob=await h.store.list('bob');
 assert.equal(alice.layouts.length,2);assert.deepEqual(new Set(alice.layouts.map(l=>l.scope)),new Set(['system','user']));
 assert.equal(bob.layouts.length,1);assert.equal(bob.layouts[0].scope,'system');
 assert.equal(h.userDocs.get('bob').defaultProductionScreenLayout,undefined);
 const loaded=await h.store.load('bob',{scope:'system',id:system.layout.id});
 assert.equal(loaded.preferences.defaultProductionScreenLayout.scope,'system');
 assert.deepEqual(loaded.preferences.dashboardLayouts.experimentalSpf.stationOrder,input().stationIds);
 assert.equal(h.userDocs.get('alice').defaultProductionScreenLayout.id,own.layout.id);
});
test('User layouts stay private even when another account knows their IDs',async()=>{
 const h=harness();const saved=await h.store.create('alice','user',input('Private'));
 await assert.rejects(h.store.load('bob',{scope:'user',id:saved.layout.id}),e=>e.status===404);
 assert.equal(h.userDocs.get('bob').dashboardLayouts,undefined);
});
test('duplicates are rejected case-insensitively with normalized whitespace; concurrent creation cannot overwrite',async()=>{
 const h=harness();await h.store.create('alice','user',input('  Line   A  '));
 await assert.rejects(h.store.create('alice','user',input('line a',['100:1','100:2','100:4'])),e=>e.status===409);
 const results=await Promise.allSettled([h.store.create('alice','system',input('Concurrent')),h.store.create('bob','system',input(' CONCURRENT '))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
 assert.equal(Object.keys(h.systemDocs.get('system-preferences').productionScreenLayouts).length,1);
 assert.deepEqual(h.userDocs.get('alice').dashboardLayouts.experimentalSpf.stationOrder,input().stationIds);
});
test('invalid names, scope, station counts and inactive or unknown stations cause no preference changes',async()=>{
 const h=harness();const before=structuredClone(h.userDocs.get('alice'));
 for(const data of [input(''),input('   '),input('x'.repeat(81)),input('A',['100:1','100:2']),input('A',['100:1','100:1','100:2']),input('A',['100:1','100:2','300:1']),input('A',['100:1','100:2','999:1']),input('A',['100:1','100:2','100:3','100:4','200:1','200:2','300:1'])])await assert.rejects(h.store.create('alice','user',data),e=>e.status===400);
 await assert.rejects(h.store.create('alice','invalid',input()),e=>e.status===400);
 assert.deepEqual(h.userDocs.get('alice'),before);
});
test('loads revalidate current configuration and preserve the previous working/default layout on failure',async()=>{
 const h=harness();const first=await h.store.create('alice','user',input('First'));
 const next=await h.store.create('alice','user',input('Next',['100:1','100:2','100:4']));
 h.machines[1].active=false;
 await assert.rejects(h.store.load('alice',{scope:'user',id:first.layout.id}),e=>e.status===400);
 assert.equal(h.userDocs.get('alice').defaultProductionScreenLayout.id,next.layout.id);
 assert.deepEqual(h.userDocs.get('alice').dashboardLayouts.experimentalSpf.stationOrder,['100:1','100:2','100:4']);
});
test('a failed default activation after System creation is retryable by loading the saved definition',async()=>{
 const h=harness();h.failNextActivation();let reference;
 await assert.rejects(h.store.create('alice','system',input()),error=>{reference=error.createdLayoutRef;return error.status===503 && !!reference;});
 assert.equal(Object.keys(h.systemDocs.get('system-preferences').productionScreenLayouts).length,1);
 assert.equal(h.userDocs.get('alice').defaultProductionScreenLayout,undefined);
 const result=await h.store.load('alice',reference);assert.equal(result.preferences.defaultProductionScreenLayout.id,reference.id);
 assert.equal(Object.keys(h.systemDocs.get('system-preferences').productionScreenLayouts).length,1);
});
test('default restoration returns the persisted selection and ordinary working edits never mutate named definitions',async()=>{
 const h=harness();const result=await h.store.create('alice','user',input());
 await h.dependencies.db.collection('preferences-user').updateOne({userId:'alice'},{$set:{'dashboardLayouts.experimentalSpf':{stationOrder:['100:1','100:2','100:4'],stationVisibility:{}},defaultProductionScreenLayout:null}});
 const library=await h.store.list('alice');assert.equal(library.defaultLayout,null);
 assert.deepEqual(library.layouts[0].stationIds,input().stationIds);
 const loaded=await h.store.load('alice',{scope:'user',id:result.layout.id});assert.deepEqual(loaded.preferences.dashboardLayouts.experimentalSpf.stationOrder,input().stationIds);
});
test('system normalization preserves libraries and migration does not overwrite concurrently managed definitions',async()=>{
 const h=harness();const created=await h.store.create('alice','system',input());const existing=h.systemDocs.get('system-preferences');
 const normalized=schema.utils.normalizePreferences({logLevel:'warn'},existing);
 assert.equal(normalized.productionScreenLayouts[created.layout.id].name,'Line A');
 const updates=[];const db={collection:()=>({findOne:async()=>existing,updateOne:async(filter,update)=>updates.push(update)})};
 await systemModule.ensureSystemPreferences(db,{});
 assert.equal(Object.prototype.hasOwnProperty.call(updates[0].$set,'productionScreenLayouts'),false);
});
test('layout routes require authentication and use the existing level-7 System Settings rule',async()=>{
 const h=harness(),routes=new Map();const router={get:(path,...handlers)=>routes.set('GET '+path,handlers),post:(path,...handlers)=>routes.set('POST '+path,handlers)};
 let requiredLevel;
 registerProductionLayoutRoutes(router,{...h.dependencies,
  requireUser:(req,res,next)=>req.authUserId?next():res.status(401).json({error:'Missing token'}),
  requirePermissionLevel:level=>{requiredLevel=level;return(req,res,next)=>req.level<=level?next():res.status(403).json({error:'Insufficient permissions'});}
 });
 async function request(path,req){let status=200,body;const res={status:n=>(status=n,res),json:value=>(body=value,res)};const next=error=>{if(error){status=error.status || 500;body={error:error.message};}};
  for(const handler of routes.get(path)){if(body!==undefined)break;await handler(req,res,next);}return{status,body};}
 assert.equal(requiredLevel,7);
 assert.equal((await request('GET /production-layouts',{})).status,401);
 assert.equal((await request('POST /production-layouts/system',{authUserId:'alice',level:8,body:input()})).status,403);
 assert.equal((await request('POST /production-layouts/system',{authUserId:'alice',level:7,body:input()})).status,200);
 assert.equal((await request('POST /production-layouts/user',{authUserId:'bob',tokenPayload:{bypassed:true},body:input()})).status,401);
});
test('names use stable safe IDs and reject malformed reference paths',async()=>{
 assert.equal(normalizeName(' Ｌｉｎｅ A ').id,normalizeName('line a').id);
 const h=harness();for(const reference of [null,{scope:'other',id:'x'},{scope:'user',id:'$where'},{scope:'system',id:'../'}])await assert.rejects(h.store.load('alice',reference),e=>e.status===400);
});
