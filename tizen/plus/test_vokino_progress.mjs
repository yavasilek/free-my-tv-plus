import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('./vokino-progress.js',import.meta.url),'utf8');
const id='111111111111111111111111', account={base:'https://api.vokino.org/v2',token:'TEST_ONLY',key:'test-owner'};
const relay='http://192.168.2.59:8123/api/webhook/'+'x'.repeat(32), sessionKey='fmtv.myshows.progress.v1';
const flush=()=>new Promise(r=>setImmediate(r));
function boot(){
 const store=new Map([['fmtv.myshows.relay.v1',relay]]),events={},requests=[],posts=[],timers=[];
 let now=1700000000000,position=0,reads=0,lag=false;
 class Clock extends Date{static now(){return now;}}
 const playlist=()=>({channels:[{title:'Сезон 1',submenu:[{title:'Серия 1',details:{air_date:'28.04.2026'},...(position?{timeline:{season:1,episode:1,current:position,time:1000}}:{})}]}]});
 const box={URL,AbortController,Date:Clock,console,Promise,
 document:{hidden:false,addEventListener:(k,fn)=>events[k]=fn},
 localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
 setTimeout:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;},clearTimeout:t=>{if(t)t.cancelled=true;},
 MyShowsCatalog:{profile:()=> 'test-profile',canMarkMovies:()=>false,matchEpisodes:async(series,keys)=>Object.fromEntries(keys.map(key=>[key,{showId:10,id:20,seasonNumber:1,episodeNumber:1}]))},
 fetch:async(url,options)=>{requests.push({url,options});if(options.method==='POST'){posts.push(new URLSearchParams(options.body));return {ok:true};}
 let data;if(url.includes('/timeline/list'))data={channels:[{details:{id,type:'serial'}}],page:{next:null}};
 else if(url.includes('/view/'))data={details:{name:'Example',released:2026,type:'serial'},online:{Filmix:{playlist_url:'/v2/online/example'}}};
 else {reads++;data=lag&&reads===2?{channels:[]}:playlist();}
 return {ok:true,json:async()=>data};}
 };
 box.window=box;vm.createContext(box);vm.runInContext(source.replace('window.VoKinoProgress =','window.testProgress = {episodeProgress: episodeProgress, changed: changed}; window.VoKinoProgress ='),box);
 return {box,store,events,requests,posts,timers,playlist,setPosition:n=>position=n,advance:s=>now+=s*1000,setLag:()=>lag=true,async settle(){for(let i=0;i<8;i++)await flush();},async delay(ms){const t=timers.find(t=>!t.cancelled&&!t.ran&&t.ms===ms);assert.ok(t,'Expected retry timer');t.ran=true;t.fn();await this.settle();}};
}
const unit=boot(),parse=unit.box.testProgress.episodeProgress,changed=unit.box.testProgress.changed;
const zero=parse(unit.playlist());assert.equal(zero['1:1:2026-04-28'].current,0,'Explicit labels establish a baseline before timeline exists');
unit.setPosition(950);const end=parse(unit.playlist()),before={rows:{Filmix:zero}},after={rows:{Filmix:end}};
assert.equal(changed(before,after,1000)['1:1:2026-04-28'].candidate,true);
assert.equal(changed(before,after,5)['1:1:2026-04-28'].candidate,false,'A quick seek cannot qualify');
assert.equal(Object.keys(changed({rows:{Filmix:{}}},after,1000)).length,0,'Missing baseline must not mark an old watch');
assert.equal(Object.keys(parse({channels:[{title:'Unknown',submenu:[{title:'Unknown',details:{air_date:'28.04.2026'}}]}]})).length,0,'No positional guesses');
assert.equal(Object.keys(parse({channels:[{title:'Сезон 2',submenu:[{title:'Серия 1',details:{air_date:'28.04.2026'},timeline:{season:1,episode:1,current:0,time:1000}}]}]})).length,0,'Conflicting numbering is rejected');
assert.equal(Object.keys(parse({channels:[{title:'Сезон 1',submenu:[{title:'Серия 1',details:{air_date:'31.02.2026'}}]}]})).length,0,'Impossible dates are rejected');
for(const target of [id,null]){
 const run=boot();let launches=0;run.box.VoKinoProgress.prepare(account,target,()=>launches++);await run.settle();assert.equal(launches,1);
 const baseline=JSON.parse(run.store.get(sessionKey));assert.equal(baseline.before.kind,target?'episode':'bundle');
 run.box.document.hidden=true;run.events.visibilitychange();run.advance(1000);run.setPosition(950);run.box.document.hidden=false;
 run.box.VoKinoProgress.resume(account);await run.settle();assert.equal(run.posts.length,1,'Cards and dock both submit real changed progress');assert.equal(run.posts[0].get('candidate'),'1');
 await run.delay(5000);await run.delay(10000);assert.equal(run.posts.length,1,'Persistence retries must not duplicate submissions');assert.equal(run.store.has(sessionKey),false);
 assert.ok(run.requests.every(r=>r.options.cache==='no-store'));assert.ok(!run.store.get('fmtv.myshows.progress.status.v1').includes(account.token));
}
const delayed=boot();delayed.setLag();delayed.box.VoKinoProgress.prepare(account,id,()=>{});await delayed.settle();delayed.box.document.hidden=true;delayed.events.visibilitychange();delayed.advance(1000);delayed.setPosition(950);delayed.box.document.hidden=false;delayed.box.VoKinoProgress.resume(account);await delayed.settle();assert.equal(delayed.posts.length,0);await delayed.delay(5000);assert.equal(delayed.posts.length,1,'Retry sees progress saved after launcher return');await delayed.delay(10000);
const cancelled=boot();cancelled.box.VoKinoProgress.prepare(account,id,()=>{});await cancelled.settle();cancelled.box.document.hidden=true;cancelled.events.visibilitychange();cancelled.advance(1000);cancelled.setPosition(950);cancelled.box.document.hidden=false;cancelled.box.VoKinoProgress.resume(account);cancelled.box.VoKinoProgress.cancel();await cancelled.settle();assert.equal(cancelled.posts.length,0,'Cancelled or replaced launches never submit marks');
const unavailable=boot();unavailable.box.VoKinoProgress.prepare(account,id,()=>{});await unavailable.settle();unavailable.box.document.hidden=true;unavailable.events.visibilitychange();unavailable.advance(1000);unavailable.box.document.hidden=false;unavailable.box.fetch=async()=>{throw new Error('Offline');};unavailable.box.VoKinoProgress.resume(account);await unavailable.settle();await unavailable.delay(5000);await unavailable.delay(10000);assert.equal(unavailable.store.has(sessionKey),true,'Network failure retains the baseline for a later return');
const msCode=fs.readFileSync(new URL('./myshows.js',import.meta.url),'utf8');
let shows=[{id:10,title:'Example',year:2026}],episodes=[{id:20,showId:10,seasonNumber:1,episodeNumber:1,airDate:'2026-04-23',isSpecial:false}];
const ms={addEventListener(){},URL,AbortController,Date,Map,console,setTimeout,clearTimeout,document:{addEventListener(){}},localStorage:{getItem:()=>null},fetch:async(url,options)=>{const b=JSON.parse(options.body);return {ok:true,json:async()=>({result:b.method==='shows.Search'?shows:{id:10,episodes}})}}};ms.window=ms;vm.createContext(ms);vm.runInContext(msCode,ms);
const match=()=>ms.MyShowsCatalog.matchEpisodes({name:'Example',year:2026},['1:1:2026-04-28']);
assert.equal((await match())['1:1:2026-04-28'].id,20,'Translated premiere dates may differ by five days');
episodes.push({...episodes[0],id:21});assert.equal(Object.keys(await match()).length,0,'Ambiguous episode identity is rejected');episodes.pop();episodes[0].airDate='2026-01-01';assert.equal(Object.keys(await match()).length,0,'Large date differences are rejected');episodes[0].airDate='2026-04-23';shows.push({...shows[0],id:11});assert.equal(Object.keys(await match()).length,0,'Ambiguous series identity is rejected');
console.log('Passed: zero episode baselines, date-safe MyShows matching, card/dock tracking, delayed persistence, cancellation, no duplicate submissions and seek guard.');
// History reconciliation runs against isolated fixtures; no real webhook or marks are used.
const syncRun=boot(),syncWatched=new Set(['104/204']),syncPosts=[];
syncRun.advance(120000000);syncRun.store.set('fmtv.vokino.account',JSON.stringify(account));syncRun.store.set('fmtv.myshows.history-sync.v1','1');
syncRun.box.MyShowsCatalog.canSyncEpisodes=()=>true;
syncRun.box.MyShowsCatalog.invalidateWatchStatus=()=>{};
syncRun.box.MyShowsCatalog.matchEpisodes=async(series,keys)=>Object.fromEntries(keys.map(k=>[k,{showId:Number(series.name)+100,id:Number(series.name)+200,seasonNumber:1,episodeNumber:1}]));
syncRun.box.MyShowsCatalog.missingEpisodes=async(episodes)=>Object.fromEntries(Object.entries(episodes).filter(([k,e])=>!syncWatched.has(e.showId+'/'+e.id)));
syncRun.box.fetch=async(url,options)=>{
 syncRun.requests.push({url,options});
 if(options.method==='POST'){const p=new URLSearchParams(options.body);syncPosts.push(p.get('show_id')+'/'+p.get('episode_id'));return {ok:true};}
 const u=new URL(url);let data;
 if(u.pathname==='/v2/timeline/list'){const second=u.searchParams.get('page')==='2';data={channels:(second?[3,4,1]:[1,2]).map(n=>({details:{id:n.toString().padStart(24,'0'),type:'serial'}})),page:{next:second?null:'http://api.vokino.org/v2/timeline/list?page=2&token=UNTRUSTED'}};}
 else if(u.pathname.includes('/view/'))data={details:{type:'serial',name:String(Number(u.pathname.split('/').pop())),released:2026},online:{Filmix:{playlist_url:'/v2/online/fixture'}}};
 else data={channels:[{title:'Сезон 1',submenu:[{title:'Серия 1',details:{air_date:'28.04.2026'},timeline:{season:1,episode:1,current:950,time:1000}}]}]};
 return {ok:true,json:async()=>data};
};
await syncRun.box.VoKinoProgress.syncHistory(account);await syncRun.settle();
let syncState=JSON.parse(syncRun.store.get('fmtv.myshows.history-state.v1'));
assert.equal(syncState.phase,'waiting');assert.equal(syncState.confirmed,0,'An opaque HTTP reply is not a confirmed MyShows mark');assert.equal(syncPosts.length,1);
const reloadedSync=boot();reloadedSync.advance(120000000);
for(const [key,value] of syncRun.store)reloadedSync.store.set(key,value);
reloadedSync.box.fetch=syncRun.box.fetch;
for(const name of ['canSyncEpisodes','invalidateWatchStatus','matchEpisodes','missingEpisodes'])reloadedSync.box.MyShowsCatalog[name]=syncRun.box.MyShowsCatalog[name];
await reloadedSync.box.VoKinoProgress.syncHistory(account);await reloadedSync.settle();assert.equal(syncPosts.length,1,'A restored pending batch is checked instead of being submitted again');
for(let i=0;i<20&&syncState.phase!=='done';i++){
 for(const mark of syncPosts)syncWatched.add(mark);
 await reloadedSync.delay(3500);syncState=JSON.parse(reloadedSync.store.get('fmtv.myshows.history-state.v1'));
}
assert.equal(syncState.phase,'done');assert.equal(syncState.checked,4,'Every series on every page is reconciled, not just the three recent series');assert.equal(syncState.confirmed,3);
assert.equal(syncPosts.length,3,'Already-watched episodes and duplicated history titles are skipped');assert.equal(new Set(syncPosts).size,3);
assert.ok(!syncRun.store.get('fmtv.myshows.history-state.v1').includes(account.token),'Saved reconciliation progress excludes account credentials');
assert.equal(syncRun.requests.some(r=>r.url.includes('UNTRUSTED')),false,'Pagination credentials are never reused');
const requestCount=syncRun.requests.length;await reloadedSync.box.VoKinoProgress.syncHistory(account);assert.equal(syncRun.requests.length,requestCount,'A completed scan waits before rechecking');
const isolated=boot();isolated.store.set('fmtv.vokino.account',JSON.stringify(account));await isolated.box.VoKinoProgress.syncHistory(account);assert.equal(isolated.requests.length,0,'History reconciliation is opt-in');
const helperStore=new Map([['fmtv.myshows.profile.v1','fixture'],['fmtv.myshows.catalog.v1',JSON.stringify({url:'http://helper.local:8768',key:'x'.repeat(32)})]]);let helperRows=[{showId:10,watched:[20]}];
const hs={URL,AbortController,Date,Map,setTimeout,clearTimeout,addEventListener(){},document:{addEventListener(){}},localStorage:{getItem:k=>helperStore.get(k)||null},fetch:async(url,options)=>{assert.equal(options.cache,'no-store');return {ok:true,json:async()=>({result:helperRows})};}};hs.window=hs;vm.createContext(hs);vm.runInContext(msCode,hs);
assert.equal(Object.keys(await hs.MyShowsCatalog.missingEpisodes({one:{showId:10,id:20}})).length,0);
helperRows=[{showId:10,watched:[]}];assert.equal(Object.keys(await hs.MyShowsCatalog.missingEpisodes({one:{showId:10,id:20}})).length,1);
helperRows=[];await assert.rejects(hs.MyShowsCatalog.missingEpisodes({one:{showId:10,id:20}}),'A missing account response must not authorize a mark');
console.log('Passed: opt-in all-page history reconciliation, retained state, account-confirmed marks, duplicate/watched skips, sanitized pagination and fail-closed helper reads.');
