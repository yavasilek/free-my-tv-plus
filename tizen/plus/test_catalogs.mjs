import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const flush=()=>new Promise(r=>setImmediate(r));
const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
const storage=values=>{const map=new Map(Object.entries(values||{}));return {map,api:{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}};};
const store=storage(),requests=[],launches=[],watched=[];let ui;
const film=(id,type='video')=>({id,title:'Пример '+id,object_type:type,year:2024,posters:[{type:'poster-vertical',url:'https://thumbs.dfs.ivi.ru/storage0/poster.jpg'}]});
const box={AbortController,URL,setTimeout,clearTimeout,localStorage:store.api,createMovieSearch:o=>{ui=o;return {};},TopControls:{iviApp:()=> 'Test.ivi'},VoKinoBridge:{launchWithReturn:(id,start)=>{watched.push(id);start();},cancelReturn(){}},
  tizen:{ApplicationControlData:function(key,value){this.key=key;this.value=value;},ApplicationControl:function(op,uri,mime,cat,data){this.op=op;this.data=data;},application:{launchAppControl(control,id,yes){launches.push({control,id});yes();}}},
  fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({result:Array.from({length:21},(_,i)=>film(i+1))})};}};
box.window=box;vm.createContext(box);vm.runInContext(read('./ivi-search.js'),box);
box.IviCatalog.search('  Чебурашка & мир?  ',1,()=>{});await flush();
assert.equal(new URL(requests[0].url).searchParams.get('query'),'Чебурашка & мир?');assert.equal(requests[0].options.credentials,'omit');assert.equal(requests[0].options.redirect,'error');assert.equal(requests[0].options.headers,undefined,'Ivi search transfers no account key');
assert.equal(box.IviCatalog.searchState.items.length,20);assert.equal(box.IviCatalog.searchState.nextPage,2);
box.IviCatalog.search('Чебурашка',2,()=>{});await flush();assert.equal(new URL(requests[1].url).searchParams.get('from'),'20');assert.equal(new URL(requests[1].url).searchParams.get('to'),'40');
box.fetch=async()=>({ok:true,json:async()=>({result:[film(1),film(1),film('foreign'),film(2,'person'),{...film(3),posters:[{url:'https://foreign.invalid/p.jpg'}]}]})});
box.IviCatalog.search('Чебурашка',1,()=>{});await flush();assert.equal(box.IviCatalog.searchState.items.length,2);assert.equal(box.IviCatalog.searchState.items[1].poster,'');assert.equal(box.IviCatalog.searchState.nextPage,0);
for(const type of ['video','compilation']){let result;ui.launch({id:'301',type,title:'Пример'},ok=>{result=ok;});assert.equal(result,true);const control=launches.at(-1).control,url=new URL(JSON.parse(control.data[0].value[0]).values),action=JSON.parse(url.searchParams.get('titleid'));assert.equal(control.op,'http://samsung.com/appcontrol/operation/eden_resume');assert.equal(action.action,type==='video'?'/movie/open':'/compilation/open');assert.equal(action.action_params.id,301);}
const before=launches.length;ui.launch({id:'javascript:bad',type:'video'},()=>{});assert.equal(launches.length,before);assert.deepEqual(watched,['Test.ivi','Test.ivi']);
box.fetch=async()=>({ok:true,json:async()=>({error:{code:500}})});box.IviCatalog.search('Чебурашка',1,()=>{});await flush();assert.ok(box.IviCatalog.searchState.error);assert.equal(box.IviCatalog.searchState.loading,false);
const deferred=[];box.fetch=()=>new Promise(r=>deferred.push(r));box.IviCatalog.search('Первый',1,()=>{});box.IviCatalog.search('Второй',1,()=>{});deferred[1]({ok:true,json:async()=>({result:[film(302)]})});await flush();deferred[0]({ok:true,json:async()=>({result:[film(301)]})});await flush();assert.equal(box.IviCatalog.searchState.items[0].id,'302');
box.TopControls.iviApp=()=>'';const oldCount=deferred.length;box.IviCatalog.search('Третий',1,()=>{});assert.equal(deferred.length,oldCount);assert.ok(box.IviCatalog.searchState.error.includes('избранные'));

const avStore=storage(),avRequests=[],details=[],pending=[];
const context={AbortController,Date,setTimeout,clearTimeout,localStorage:avStore.api,fetch:async(url,options)=>{avRequests.push({url,options});const id=parseInt(JSON.parse(options.body).variables.id,16);return {ok:true,json:async()=>id===303?{errors:[{message:'unavailable'}]}:{data:{movieByContentUuid:{id:id===305?999:id,viewOption:{watchabilityStatus:id===302?'WATCHABLE':'UNWATCHABLE',purchasabilityStatus:id===304?'PURCHASABLE':'UNPURCHASABLE',buttonText:id===302?'Смотреть':null}}}}};}};
context.window=context;vm.createContext(context);vm.runInContext(read('./kinopoisk-availability.js'),context);
let inflight=0,peak=0;
const availability=context.createKinopoiskAvailability((id,signal)=>{details.push(id);inflight++;peak=Math.max(peak,inflight);return new Promise(resolve=>setImmediate(()=>{inflight--;resolve({kinopoiskHDId:Number(id).toString(16).padStart(32,'0')});}));});
const rows=[301,302,303,304,305].map(id=>({id:String(id)}));availability.visible(rows,()=>{});for(let i=0;i<15;i++)await flush();
assert.ok(peak<=2);assert.equal(details.length,5);assert.equal(availability.annotation(rows[0]).kind,'unavailable');assert.equal(availability.annotation(rows[1]),null);for(const row of rows.slice(2))assert.equal(availability.annotation(row).kind,'unknown','Failures and missing rights information must not be marked unavailable');
assert.equal(avRequests.every(r=>r.options.credentials==='omit'&&r.options.headers['X-API-KEY']===undefined),true,'Availability uses anonymous public data without the catalogue API key');
const count=avRequests.length;availability.visible(rows,()=>{});await flush();assert.equal(avRequests.length,count,'Repainting fresh rows does not refetch availability');
const cached=context.createKinopoiskAvailability(()=>{throw new Error('Unexpected lookup');});cached.visible(rows.slice(0,2),()=>{});assert.equal(cached.annotation(rows[0]).kind,'unavailable');assert.equal(cached.annotation(rows[1]),null);
const cancel=context.createKinopoiskAvailability(id=>new Promise(resolve=>pending.push(()=>resolve({kinopoiskHDId:Number(id).toString(16).padStart(32,'0')}))));cancel.clear();cancel.visible(rows,()=>{});await flush();assert.equal(pending.length,2);cancel.visible([],()=>{});pending.splice(0).forEach(fn=>fn());for(let i=0;i<6;i++)await flush();assert.equal(pending.length,0,'Offscreen rows do not create additional detail requests');
availability.clear();assert.equal(availability.annotation(rows[0]).kind,'checking');assert.equal(availability.hdId('301'),'');assert.equal(avStore.map.has('fmtv.kinopoisk.availability.v1'),false);
console.log('Passed: Ivi catalogue/privacy/paging/deep links, favorite gating, Kinopoisk watchability, conservative unknown states, bounded visible-only lookups and caching.');
