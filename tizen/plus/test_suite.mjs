import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const sectionsCode = fs.readFileSync(new URL('./vokino-sections.js', import.meta.url), 'utf8');
const code = fs.readFileSync(new URL('./compact-adapter.js', import.meta.url), 'utf8');
function row(id, extra = {}) {return {details: {id, type: 'movie', name: 'Example',
  poster: 'https://proxy.vokino.org/image/t/p/w600_and_h900_bestv2/example.jpg',
  bg_poster: {backdrop: 'https://proxy.vokino.org/image/t/p/w1280/back.jpg'}, ...extra}};}
const id1 = '111111111111111111111111', id2 = '222222222222222222222222', id3 = '333333333333333333333333';
function boot(values = {}, migrate16 = false, initialCards, withService = false) {
  const store = new Map(Object.entries({'fmtv.cards16.rev':'1',...values}));
  if(migrate16)store.delete('fmtv.cards16.rev');
  const requests = [], launches = [], timers = [];
  const prefs = {cards:initialCards,shelf: ['9Ur5IzDKqV.TizenYouTube', 'UMHvZ0dWqo.AnalogWatch','vYmY3ACVaa.emby']};
  const box = {console, AbortController, URL, clearTimeout() {},
    setTimeout(fn, delay) {timers.push({fn, delay}); return timers.length;}, setInterval() {return 1;},
    document: {hidden: false, addEventListener() {}},
    localStorage: {getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value),removeItem:key=>store.delete(key)},
    Prefs: {cards: () => prefs.cards || 2, shelf: () => prefs.shelf, set: (k, v) => {prefs[k] = v;}},
    Data: {picks: () => [], hasKey: () => false, image: p => p, appFor: () => null, showcase: () => [], settingsChanged() {}},
    TV: {launch: id => launches.push(id)},
    tizen: {application: {getAppInfo(id) {if(withService||id==='xvvl3S1TT1.TizenTubeStandalone')return {};throw new Error('No service in unit test');},
      launchAppControl(control, app, yes) {launches.push({control, app}); yes();}},
      ApplicationControlData: function (key, value) {this.key = key; this.value = value;},
      ApplicationControl: function (op, uri, mime, category, data) {this.data = data;}},
    fetch: async (url, options) => {
      requests.push({url, options});
      const channels = url.includes('/timeline/') ? [row(id1, {current: 100, time: 1000}), row(id2, {current: 999, time: 1000}), row(id3, {current: 0, time: 0})]
        : url.includes('/bookmarks/') ? [row(id3, {type: 'serial'}),row(id1)] : [row(id1), row(id2), row(id3)];
      return {ok: true, json: async () => ({type: 'list', channels})};
    },
  };
  box.window = box; vm.createContext(box); vm.runInContext(sectionsCode, box); vm.runInContext(code, box);
  return {box, store, requests, launches, timers, prefs};
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const expanded=boot({},true);
assert.equal(expanded.prefs.cards,16,'First upgrade selects the requested 16 cards');
expanded.box.Prefs.set('cards',4);
const smaller=boot(Object.fromEntries(expanded.store),false,4);
assert.equal(smaller.prefs.cards,4,'Later starts leave the user card setting unchanged');
const a = boot();
assert.equal(a.requests.length, 0, 'Startup must let the UI draw before network work');
assert.equal(a.prefs.shelf[0], 'xvvl3S1TT1.TizenTubeStandalone');
a.box.VoKinoBridge.refresh(true); await flush();
assert.equal(a.requests.length, 1, 'Public cards use a single feed request');
assert.equal(a.box.Data.picks(null).length, 2);
assert.equal(a.box.Data.showcase().length, 2);
assert.match(a.box.Data.image('https://proxy.vokino.org/image/t/p/w1280/b.jpg', 'w300'), /\/w185\//);
assert.match(a.box.Data.image('https://proxy.vokino.org/image/t/p/w1280/b.jpg', 'w1280'), /\/w780\//);
a.box.VoKinoBridge.refresh(false); await flush(); assert.equal(a.requests.length, 1, 'Fresh cache suppresses requests');
const warm = boot(Object.fromEntries(a.store)); assert.equal(warm.requests.length, 0); assert.equal(warm.box.Data.picks(null).length, 2);
const account = {base: 'https://api.vokino.org/v2', token: 'FAKE_TEST_CREDENTIAL', key: 'test-account'};
const b = boot({'fmtv.vokino.account': JSON.stringify(account)});
b.box.VoKinoBridge.refresh(true); await flush();
assert.equal(b.requests.length, 2, 'History and favorites are the only personal calls');
assert.deepEqual(Array.from(b.box.Data.picks(null), p => p.section), ['history', 'favorites']);
assert.equal(b.box.Data.picks(null).some(p => p.id === 'vokino:' + id2), false, 'Completed titles stay out of Continue');
assert.equal(b.box.Data.picks('vokino-history').some(p => p.id === 'vokino:' + id2), true, 'Completed titles remain in History');
assert.equal(b.box.Data.picks('vokino-favorites').length, 2, 'Favorites keeps titles also present in History');
assert.equal(b.box.VoKinoBridge.turnPage('vokino-history', 1), true);
assert.equal(b.box.Data.picks('vokino-history').length, 1, 'Last page is bounded to available items');
assert.match(b.box.Data.picks('vokino-history')[0].meta, /3 \/ 3$/);
assert.equal(b.box.VoKinoBridge.turnPage('vokino-history', 1), false);
assert.equal(b.box.VoKinoBridge.turnPage('vokino-history', -1), true);
assert.equal(b.box.Data.picks('vokino-history').length, 2);
assert.equal(b.box.VoKinoBridge.turnPage('vokino-history', -1), false);
for (const req of b.requests) {assert.equal(req.options.redirect, 'error'); assert.equal(req.options.credentials, 'omit');}
assert.equal(b.store.get('fmtv.vokino.feed.v5').includes(account.token), false, 'Feed cache must never contain credentials');
b.box.document.hidden = true; b.box.VoKinoBridge.refresh(true); await flush(); assert.equal(b.requests.length, 2);
b.box.TV.launch('bridge-vokino:' + id1, null, ok => assert.equal(ok, true));
assert.equal(JSON.parse(b.launches[0].control.data[0].value[0]).values, 'https://api.vokino.org/v2/view/' + id1);
assert.equal(JSON.stringify(b.launches).includes(account.token), false, 'App launch payload must not contain credentials');
const bad = boot({'fmtv.vokino.account': JSON.stringify({...account, base: 'https://foreign.invalid/v2'})});
bad.box.VoKinoBridge.refresh(true); await flush(); assert.equal(bad.requests.some(r => r.url.includes(account.token)), false);

const paged=boot({'fmtv.vokino.account':JSON.stringify(account)});
paged.box.Prefs.set('cards',16);
const pageRequests=[];
paged.box.fetch=async(url,options)=>{
  pageRequests.push({url,options});
  if(url.includes('/bookmarks/'))return {ok:true,json:async()=>({type:'list',channels:[],page:{next:null}})};
  const second=url.includes('page=2'), start=second?13:1;
  const channels=Array.from({length:12},(_,i)=>row((start+i).toString(16).padStart(24,'0'),{current:100,time:1000}));
  return {ok:true,json:async()=>({type:'list',channels,page:{next:second?null:'http://api.vokino.org/v2/timeline/list?page=2&token=DO_NOT_REUSE'}})};
};
paged.box.VoKinoBridge.refresh(true); await flush();await flush();
assert.equal(paged.box.Data.picks('vokino-history').length,16,'Fetch additional API page to fill the limit');
assert.equal(paged.box.Data.picks(null).length,16);
assert.equal(pageRequests.length,3);
assert.equal(pageRequests.every(r=>r.url.startsWith(account.base)),true,'Pagination upgrades HTTP next links to the approved HTTPS base');
assert.equal(pageRequests.some(r=>r.url.includes('DO_NOT_REUSE')),false,'Never reuse credentials from a pagination link');
paged.box.Prefs.set('cards',4);
assert.equal(paged.box.Data.picks('vokino-history').length,4,'User can lower the card count');
const foreign=boot({'fmtv.vokino.account':JSON.stringify(account)});
const foreignRequests=[];
foreign.box.fetch=async(url)=>{foreignRequests.push(url);return {ok:true,json:async()=>({type:'list',channels:[row(id1)],page:{next:'https://other.invalid/v2/timeline/list?page=2'}})};};
foreign.box.VoKinoBridge.refresh(true);await flush();await flush();
assert.equal(foreignRequests.length,2,'Ignore pagination pointing outside the approved API host');

const returning=boot({'fmtv.vokino.account':JSON.stringify(account)},false,16,true);
returning.box.FreeMyTV={state:{tab:2,card:1,shelf:0,zone:'cards'}};
returning.box.VoKinoBridge.offsets['vokino-favorites']=4;
returning.box.TV.launch('bridge-vokino:'+id1,null,()=>{});
assert.equal(returning.launches.length,0,'Register return handling before opening VoKino');
await flush();
assert.equal(returning.launches.length,1);
assert.ok(returning.requests[0].url.startsWith('http://127.0.0.1:8099/favorites?ids='));
assert.equal(returning.requests[1].url,'http://127.0.0.1:8099/watch/app?appId=UMHvZ0dWqo.AnalogWatch');
assert.equal(returning.requests[0].options.method,'POST');
assert.equal(JSON.stringify(returning.requests).includes(account.token),false,'Launcher coordination never includes the VoKino token');
const selection=returning.box.VoKinoBridge.takeReturnSelection();
assert.equal(selection.tab,2);assert.equal(selection.card,1);assert.equal(selection.offsets['vokino-favorites'],4);
assert.equal(returning.box.VoKinoBridge.takeReturnSelection(),null,'Restore selection only once');
returning.box.fetch=async()=>{throw new Error('Service unavailable');};
returning.box.TV.launch('bridge-vokino:'+id1,null,()=>{});await flush();
assert.equal(returning.launches.length,2,'Temporary service failure must not block launching VoKino');
for(const [requested,target,key] of [['9Ur5IzDKqV.TizenYouTube','xvvl3S1TT1.TizenTubeStandalone','youtube'],['xvvl3S1TT1.TizenTubeStandalone','xvvl3S1TT1.TizenTubeStandalone','youtube'],['vYmY3ACVaa.emby','vYmY3ACVaa.emby','emby']]){
  const app=boot({},false,16,true);
  app.box.FreeMyTV={state:{tab:0,card:0,shelf:key==='emby'?2:0,zone:'shelf'}};
  app.box.TV.launch(requested,null,()=>{});await flush();
  assert.equal(app.requests[1].url,'http://127.0.0.1:8099/watch/app?appId='+target);
  assert.equal(app.launches[0],target);
  assert.equal(app.box.VoKinoBridge.takeReturnSelection().zone,'shelf');
}
const searching=boot({'fmtv.vokino.account':JSON.stringify(account)}),searchRequests=[];
const query='Матрица & мир?';
searching.box.fetch=async(url,options)=>{
  searchRequests.push({url,options});const page=new URL(url).searchParams.get('page');
  return {ok:true,json:async()=>({type:'list',channels:[row(page==='2'?id2:id1)],page:{next:page==='2'?null:'http://api.vokino.org/v2/search?name=OTHER&page=2&token=DO_NOT_REUSE'}})};
};
searching.box.VoKinoBridge.search('  '+query+'  ',1,()=>{});await flush();
assert.equal(searching.box.VoKinoBridge.searchState.nextPage,2);
assert.equal(searching.box.VoKinoBridge.searchState.items[0].section,'search');
assert.equal(new URL(searchRequests[0].url).searchParams.get('name'),query);
assert.equal(new URL(searchRequests[0].url).searchParams.has('token'),false,'Catalog search does not need the private account token');
assert.equal(searchRequests[0].options.redirect,'error');assert.equal(searchRequests[0].options.credentials,'omit');
searching.box.VoKinoBridge.search(query,2,()=>{});await flush();
assert.equal(searching.box.VoKinoBridge.searchState.page,2);
assert.equal(searching.box.VoKinoBridge.searchState.items[0].id,'vokino:'+id2);
assert.equal(searching.store.get('fmtv.vokino.search.v1').includes(account.token),false);
const restoredSearch=boot(Object.fromEntries(searching.store));
assert.equal(restoredSearch.box.VoKinoBridge.searchState.query,query);
assert.equal(restoredSearch.box.VoKinoBridge.searchState.page,2,'Search results survive the TV unloading the home screen');
const countBefore=searchRequests.length;searching.box.VoKinoBridge.search('x',1,()=>{});
assert.equal(searchRequests.length,countBefore);assert.ok(searching.box.VoKinoBridge.searchState.error);
searching.box.fetch=async()=>({ok:true,json:async()=>({type:'list',channels:[]})});
searching.box.VoKinoBridge.search('Не существующий фильм',1,()=>{});await flush();assert.equal(searching.box.VoKinoBridge.searchState.items.length,0);assert.equal(searching.box.VoKinoBridge.searchState.error,'');
searching.box.fetch=async()=>{throw new Error('offline');};searching.box.VoKinoBridge.search(query,1,()=>{});await flush();assert.ok(searching.box.VoKinoBridge.searchState.error);assert.equal(searching.box.VoKinoBridge.searchState.loading,false);
const deferred=[];searching.box.fetch=()=>new Promise(resolve=>deferred.push(resolve));
searching.box.VoKinoBridge.search('Первый',1,()=>{});searching.box.VoKinoBridge.search('Второй',1,()=>{});
deferred[1]({ok:true,json:async()=>({type:'list',channels:[row(id2)]})});await flush();
deferred[0]({ok:true,json:async()=>({type:'list',channels:[row(id1)]})});await flush();
assert.equal(searching.box.VoKinoBridge.searchState.items[0].id,'vokino:'+id2,'A late old search must not overwrite the newer results');
for(const type of ['multfilm','multserial','documovie','docuserial','tvshow','anime'])assert.ok(searching.box.VoKinoBridge.fromSource(row(id1,{type}),'search'),'Search includes '+type);

const prefCode = fs.readFileSync(new URL('./tizentube-preferences.js', import.meta.url), 'utf8');
const storage = new Map([['ytaf-configuration', JSON.stringify({videoSpeed: 1.25, enableDeArrow: false})]]);
const ctx = {localStorage: {getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v)}};
vm.createContext(ctx); vm.runInContext(prefCode, ctx);
let config = JSON.parse(storage.get('ytaf-configuration'));
assert.equal(config.enableSponsorBlock, true); assert.equal(config.enableDeArrowThumbnails, true); assert.equal(config.videoSpeed, 1.25);
config.enableDeArrow = false; storage.set('ytaf-configuration', JSON.stringify(config)); vm.runInContext(prefCode, ctx);
assert.equal(JSON.parse(storage.get('ytaf-configuration')).enableDeArrow, false, 'One-time migration respects later user choices');
console.log('Passed: compact cards/cache, bounded image sizes, personal feed filtering/privacy, YouTube mapping, one-time TizenTube settings.');

const generic=boot({},false,16,true);generic.box.FreeMyTV={state:{tab:0,card:0,shelf:0,zone:'shelf'}};
generic.box.VoKinoBridge.setFavorites(['ABC123.Custom'],true);generic.box.TV.launch('ABC123.Custom',null,()=>{});await flush();await flush();
assert.equal(generic.requests[1].url,'http://127.0.0.1:8099/watch/app?appId=ABC123.Custom');assert.equal(generic.launches[0],'ABC123.Custom');
generic.box.VoKinoBridge.setFavorites([],true);generic.requests.length=0;generic.box.TV.launch('ABC123.Custom',null,()=>{});await flush();
assert.equal(generic.requests.some(r=>r.url.includes('/watch/')),false,'Removed app launches without return');
assert.equal(generic.requests[0].url,'http://127.0.0.1:8099/cancel-watch');
generic.requests.length=0;generic.box.TV.launch('bridge-vokino:'+id1,null,()=>{});await flush();assert.equal(generic.requests.some(r=>r.url.includes('/watch/')),false,'Movie deep links respect favorite membership');
console.log('Passed: generic favorite launch, sync-before-watch and removed-favorite behavior.');
const nativeTube=boot({},false,16,true);nativeTube.box.VoKinoBridge.setFavorites(['9Ur5IzDKqV.TizenYouTube'],true);
nativeTube.box.TV.launch('9Ur5IzDKqV.TizenYouTube',null,()=>{});await flush();
assert.equal(nativeTube.launches[0],'9Ur5IzDKqV.TizenYouTube','An explicitly selected stock YouTube favorite must not be redirected to TizenTube');
assert.equal(nativeTube.requests[1].url,'http://127.0.0.1:8099/watch/app?appId=9Ur5IzDKqV.TizenYouTube');
const keepNative=boot({'fmtv.youtube.favorite.rev':'1'},false,16,true);assert.equal(keepNative.prefs.shelf[0],'9Ur5IzDKqV.TizenYouTube','Subsequent starts preserve a later stock YouTube choice');

const configured=boot({'fmtv.vokino.account':JSON.stringify(account),'fmtv.vokino.sections.v1':JSON.stringify({order:['history','favorites','continue','popular','new'],enabled:['history','favorites','new'],overview:[]})},false,16);
const sections=configured.box.VoKinoSections;
configured.box.Prefs.set('cards',16);
const id4='444444444444444444444444';
configured.box.fetch=async(url,options)=>{configured.requests.push({url,options});const channels=url.includes('/timeline/')?[row(id1,{current:100,time:1000}),row(id2,{current:999,time:1000})]:url.includes('/bookmarks/')?[row(id3)]:[row(id4),row(id1)];return {ok:true,json:async()=>({type:'list',channels,page:{}})};};
configured.box.VoKinoBridge.refresh(true);await flush();
assert.equal(configured.requests.length,3,'Fetch only the three enabled sources');
assert.deepEqual(Array.from(new Set(configured.box.Data.picks(null).map(p=>p.section))).sort(),['favorites','history','new'],'All enabled sources contribute even when the legacy overview selection is empty');
assert.equal(configured.box.Data.picks(null).length,4,'Overview includes complete history too and deduplicates shared films');
assert.equal(configured.requests.filter(r=>new URL(r.url).pathname.endsWith('/list')&&!r.url.includes('/timeline/')).every(r=>!new URL(r.url).searchParams.has('token')),true,'Public lists never receive the private token');
sections.enable('history',false);sections.enable('favorites',false);configured.requests.length=0;
configured.box.VoKinoBridge.refresh(true);await flush();assert.equal(configured.requests.length,1);assert.ok(configured.requests[0].url.includes('sort=new'));
sections.enable('continue',true);
configured.box.VoKinoBridge.refresh(true);await flush();
assert.ok(configured.box.Data.picks('vokino-continue').every(p=>p.resume));
assert.equal(configured.box.Data.picks(null)[0].section,'history');
sections.move('new',-1);sections.move('new',-1);
assert.equal(configured.box.Data.picks(null)[0].section,'new','Overview interleaving follows the configured section order');
assert.equal(new Set(configured.box.Data.picks(null).map(p=>p.id)).size,configured.box.Data.picks(null).length,'Overview deduplicates titles shared by selected sources');
sections.enable('continue',false);
assert.ok(configured.box.Data.picks(null).every(p=>p.section==='new'),'The remaining enabled source stays in Overview automatically');
sections.enable('new',false);configured.requests.length=0;configured.box.VoKinoBridge.refresh(true);await flush();
assert.equal(configured.requests.length,0,'Disabling every section performs no feed requests');
assert.equal(configured.box.Data.picks(null).length,0,'No hidden source is injected when all sections are disabled');
configured.box.VoKinoBridge.refresh(false);assert.equal(configured.requests.length,0,'A successfully loaded empty selection remains fresh');
const restoredSections=boot(Object.fromEntries(configured.store),false,16);
assert.equal(restoredSections.box.VoKinoSections.tabs().length,1,'Hidden sections stay hidden after restart');
assert.equal(restoredSections.box.Data.picks(null).length,0);
const invalidSections=boot({'fmtv.vokino.sections.v1':JSON.stringify({order:['constructor','new','new','foreign'],enabled:['new','foreign'],overview:['new','favorites']})});
assert.deepEqual(Array.from(invalidSections.box.VoKinoSections.tabs(),t=>t.key),[null,'vokino-new']);
assert.equal(invalidSections.box.VoKinoSections.all().find(d=>d.id==='favorites').enabled,false);
const legacy=boot({'fmtv.vokino.account':JSON.stringify(account),'fmtv.vokino.feed.v4':b.store.get('fmtv.vokino.feed.v5')});
assert.ok(legacy.box.Data.picks(null).length);legacy.box.VoKinoBridge.refresh(false);await flush();assert.equal(legacy.requests.length,2,'Legacy cache is visible immediately and refreshed into v5');
const filtered=boot();filtered.box.VoKinoSections.enable('popular',false);filtered.box.VoKinoSections.enable('movies',true);
filtered.box.fetch=async(url,options)=>{filtered.requests.push({url,options});const second=new URL(url).searchParams.get('page')==='2';return {ok:true,json:async()=>({type:'list',channels:Array.from({length:12},(_,i)=>row((i+(second?20:1)).toString(16).padStart(24,'0'))),page:{next:second?null:'https://api.vokino.pro/v2/list?page=2&type=anime&sort=rating&token=UNTRUSTED'}})};};
filtered.box.VoKinoBridge.refresh(true);await flush();await flush();
assert.equal(new URL(filtered.requests[1].url).searchParams.get('type'),'movie');assert.equal(new URL(filtered.requests[1].url).searchParams.get('sort'),'popular');assert.equal(new URL(filtered.requests[1].url).searchParams.has('token'),false);
const bounded=boot({'fmtv.vokino.account':JSON.stringify(account)},false,16);bounded.box.VoKinoSections.all().forEach(d=>bounded.box.VoKinoSections.enable(d.id,true));
let inflight=0,peak=0;
bounded.box.fetch=(url,options)=>{bounded.requests.push({url,options});inflight++;peak=Math.max(peak,inflight);return new Promise(resolve=>setImmediate(()=>{inflight--;resolve({ok:true,json:async()=>({type:'list',channels:[row(id1,{current:100,time:1000})],page:{}})});}));};
bounded.box.VoKinoBridge.refresh(true);for(let i=0;i<30&&bounded.box.VoKinoBridge.inFlight;i++)await flush();
assert.equal(bounded.box.VoKinoBridge.inFlight,false);assert.ok(peak<=2,'Section loading cannot exceed two concurrent source requests');
assert.equal(bounded.requests.filter(r=>r.url.includes('/timeline/')).length,1,'Continue and History share one API fetch');
console.log('Passed: section visibility/order, automatic Overview from all enabled sources, deduplication, empty selection, persistence, v4 migration, filter-safe pagination and bounded concurrent loading.');
