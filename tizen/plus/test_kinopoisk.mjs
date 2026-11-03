import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const code=fs.readFileSync(new URL('./kinopoisk-search.js',import.meta.url),'utf8');
const KEY='fmtv.kinopoisk.key.v1',CACHE='fmtv.kinopoisk.search.v1',fake='FAKE_TEST_CREDENTIAL_1234';
const flush=()=>new Promise(r=>setImmediate(r));
function film(id=301){return {filmId:id,nameRu:'Пример '+id,year:'2024',rating:'7.5',posterUrlPreview:'https://kinopoiskapiunofficial.tech/images/posters/kp_small/'+id+'.jpg'};}
function boot(values={}){
  const store=new Map(Object.entries(values)),requests=[],launches=[],watched=[];
  let options;
  const box={AbortController,URL,setTimeout,clearTimeout,addEventListener(){},document:{addEventListener(){}},
    localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
    TopControls:{kinopoiskApp:()=> 'Test.kpTizen'},
    VoKinoBridge:{launchWithReturn:(id,start)=>{watched.push(id);start();},cancelReturn(){}},
    createMovieSearch:o=>{options=o;return {};},
    tizen:{ApplicationControlData:function(key,value){this.key=key;this.value=value;},ApplicationControl:function(op,uri,mime,category,data){this.op=op;this.data=data;},application:{launchAppControl(control,id,yes){launches.push({control,id});yes();}}},
    fetch:async(url,settings)=>{requests.push({url,settings});return {ok:true,status:200,json:async()=>({films:[film()],pagesCount:2})};}};
  box.window=box;vm.createContext(box);vm.runInContext(code,box);
  return {box,store,requests,launches,watched,options,catalog:box.KinopoiskCatalog};
}
const app=boot();app.catalog.search('Матрица',1,()=>{});assert.equal(app.requests.length,0);assert.ok(app.catalog.searchState.error);
assert.equal(app.catalog.setKey('invalid'),false);assert.equal(app.catalog.setKey(fake),true);
app.catalog.search('  Матрица & мир?  ',1,()=>{});await flush();
assert.equal(new URL(app.requests[0].url).searchParams.get('keyword'),'Матрица & мир?');
assert.equal(app.requests[0].settings.headers['X-API-KEY'],fake);
assert.equal(app.requests[0].url.includes(fake),false);assert.equal(app.requests[0].settings.credentials,'omit');assert.equal(app.requests[0].settings.redirect,'error');
assert.equal(app.catalog.searchState.items[0].id,'301');assert.equal(app.catalog.searchState.nextPage,2);
assert.equal(app.store.get(CACHE).includes(fake),false,'Result cache never contains the API key');
const restored=boot(Object.fromEntries(app.store));assert.equal(restored.catalog.searchState.items.length,1);assert.equal(restored.catalog.hasKey(),true);
app.box.fetch=async()=>({ok:true,status:200,json:async()=>({films:[film(),film(),film('invalid'),{...film(400),posterUrlPreview:'https://foreign.invalid/x'},film(0)],pagesCount:200})});
app.catalog.search('Матрица',999,()=>{});await flush();assert.equal(app.catalog.searchState.page,20);assert.equal(app.catalog.searchState.nextPage,0);assert.equal(app.catalog.searchState.items.length,2);assert.equal(app.catalog.searchState.items[1].poster,'');
for(const [status,text] of [[401,'ключ'],[403,'ключ'],[402,'Лимит'],[429,'много'],[500,'Не удалось']]){
  app.box.fetch=async()=>({ok:false,status});app.catalog.search('Матрица',1,()=>{});await flush();assert.ok(app.catalog.searchState.error.includes(text));assert.equal(app.catalog.searchState.loading,false);
}
app.box.fetch=async()=>({ok:false,status:404});app.catalog.search('Матрица',1,()=>{});await flush();assert.equal(app.catalog.searchState.error,'');assert.equal(app.catalog.searchState.items.length,0);
const deferred=[];app.box.fetch=()=>new Promise(resolve=>deferred.push(resolve));
app.catalog.search('Первый',1,()=>{});app.catalog.search('Второй',1,()=>{});
deferred[1]({ok:true,status:200,json:async()=>({films:[film(302)]})});await flush();deferred[0]({ok:true,status:200,json:async()=>({films:[film(301)]})});await flush();assert.equal(app.catalog.searchState.items[0].id,'302','Ignore a late older result');
const count=app.requests.length;app.box.TopControls.kinopoiskApp=()=>'';app.catalog.search('Матрица',1,()=>{});await flush();assert.equal(app.requests.length,count);assert.ok(app.catalog.searchState.error.includes('избранные'));
app.box.TopControls.kinopoiskApp=()=> 'Test.kpTizen';
app.box.fetch=async()=>({ok:true,json:async()=>({kinopoiskHDId:'4824a95e60a7db7e86f14137516ba590'})});
let opened;app.options.launch({id:'301'},ok=>{opened=ok;});await flush();assert.equal(opened,true);assert.deepEqual(app.watched,['Test.kpTizen']);
assert.equal(app.launches[0].control.op,'http://samsung.com/appcontrol/operation/eden_resume');
assert.deepEqual(JSON.parse(JSON.parse(app.launches[0].control.data[0].value[0]).values),{filmId:'4824a95e60a7db7e86f14137516ba590'});
assert.equal(JSON.stringify(app.launches).includes(fake),false);
app.box.fetch=async()=>({ok:true,json:async()=>({kinopoiskHDId:null})});let error;
app.options.launch({id:'301'},(ok,message)=>{opened=ok;error=message;});await flush();assert.equal(opened,false);assert.ok(error.includes('нет ссылки'));assert.equal(app.launches.length,1,'Do not open an unrelated home screen when there is no TV link');
assert.equal(app.catalog.setKey(''),true);assert.equal(app.catalog.hasKey(),false);assert.equal(app.store.has(CACHE),false);assert.equal(app.catalog.searchState.items.length,0);
console.log('Passed: Kinopoisk API privacy, key lifecycle, normalized results, pagination, errors, stale responses, favorite gating, OTT ID mapping and return-aware card launch.');
