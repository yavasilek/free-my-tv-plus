import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8'),flush=()=>new Promise(r=>setImmediate(r));
const store=new Map([['fmtv.vokino.sections.v1',JSON.stringify({order:['new','history','favorites','popular'],enabled:['new','history'],overview:[]})]]),calls=[];
let cards=16,active=0,peak=0;
const item=id=>({id:String(id),title:'Фильм '+id,poster:'https://kinopoiskapiunofficial.tech/images/posters/kp_small/'+id+'.jpg',meta:'Фильм'});
const collection=(provider,key,page)=>{calls.push({provider,key,page});active++;peak=Math.max(peak,active);return new Promise(resolve=>setImmediate(()=>{active--;const base=(provider==='ivi'?50000:0)+(String(key).includes('MOVIES')?2000:String(key).includes('SERIES')?3000:1000)+(page-1)*20;resolve({items:Array.from({length:provider==='ivi'?16:20},(_,i)=>provider==='ivi'?{...item(base+i+1),type:'video',poster:'https://thumbs.dfs.ivi.ru/storage0/a.jpg'}:item(base+i+1)),nextPage:page<2?page+1:0});}));};
const box={Date,Promise,AbortController,setTimeout,clearTimeout,document:{addEventListener(){}},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
 TopControls:{kinopoiskApp:()=> 'Test.kpTizen',iviApp:()=> 'Test.ivi'},KinopoiskCatalog:{hasKey:()=>true,collection:(key,page)=>collection('kinopoisk',key,page)},IviCatalog:{collection:(key,page)=>collection('ivi',key,page)},
 Prefs:{cards:()=>cards},Data:{picks:()=>[],settingsChanged(){}},VoKinoBridge:{sectionsChanged(){},turnPage:()=>false}};
box.window=box;vm.createContext(box);vm.runInContext(read('./vokino-sections.js'),box);vm.runInContext(read('./catalog-config.js'),box);vm.runInContext(read('./catalog-feeds.js'),box);
const config=box.CatalogConfig,feeds=box.CatalogFeeds;
assert.deepEqual(Array.from(config.services(),s=>s.id),['kinopoisk','vokino','ivi','myshows']);assert.equal(config.services().every(s=>s.enabled),true);
assert.deepEqual(Array.from(config.tabs('vokino'),t=>t.id),['overview','new','history'],'Existing VoKino selection and order migrate');
config.moveService('ivi',-1);config.moveService('ivi',-1);assert.equal(config.services()[0].id,'ivi');
config.enableTab('ivi','overview',false);config.moveTab('ivi','series',-1);config.moveTab('ivi','series',-1);assert.deepEqual(Array.from(config.tabs('ivi'),t=>t.id),['series','movies']);
config.enableTab('vokino','history',false);assert.equal(box.VoKinoSections.all().find(t=>t.id==='history').enabled,false);
box.VoKinoSections.enable('favorites',true);assert.ok(config.tabs('vokino').some(t=>t.id==='favorites'),'Legacy section editing stays synchronized');
assert.equal(config.enableService('constructor',true),false);assert.equal(config.enableTab('kinopoisk','foreign',true),false);
feeds.picks('kinopoisk','overview',1);for(let i=0;i<15;i++)await flush();assert.ok(peak<=2,'Public collections share a global two-request limit');assert.equal(calls.filter(c=>c.provider==='kinopoisk').length,3);
const all=[];for(let page=1;page<8;page++){const rows=feeds.picks('kinopoisk','overview',page);if(!rows.length)break;all.push(...rows);}
assert.equal(all.length,60);assert.equal(new Set(all.map(p=>p.id)).size,60,'Overview includes every enabled collection without duplicates');
const first=feeds.picks('kinopoisk','popular',1);feeds.picks('kinopoisk','popular',2);for(let i=0;i<6;i++)await flush();const second=feeds.picks('kinopoisk','popular',2);
assert.equal(first.length,16);assert.equal(second.length,16);assert.equal(Number(second[0].id),Number(first[0].id)+16,'A 20-item API page does not skip four titles when the UI shows sixteen');
cards=7;const cross=feeds.picks('kinopoisk','popular',3);assert.equal(cross.length,7);assert.equal(Number(cross[0].id),Number(first[0].id)+14);assert.equal(Number(cross.at(-1).id),Number(first[0].id)+20);
config.enableService('kinopoisk',false);const before=calls.length;feeds.picks('kinopoisk','top250',1);await flush();assert.equal(calls.length,before,'Hidden services do not fetch');
config.enableService('ivi',false);feeds.picks('ivi','movies',1);await flush();assert.equal(calls.length,before);
const saved=JSON.parse(store.get('fmtv.catalogs.v1'));assert.equal(saved.order[0],'ivi');assert.equal(saved.enabled.includes('kinopoisk'),false);assert.equal(saved.tabs.ivi.order[0],'series');
assert.equal(store.get('fmtv.catalog.feeds.v1').includes('X-API-KEY'),false);
config.enableService('kinopoisk',true);config.enableTab('kinopoisk','top250',true);let rejected=0;
box.KinopoiskCatalog.collection=()=>{rejected++;const error=new Error('API quota');error.status=402;return Promise.reject(error);};
feeds.reset('kinopoisk');feeds.picks('kinopoisk','top250',1);await flush();await flush();
for(let i=0;i<5;i++)feeds.picks('kinopoisk','top250',1);await flush();assert.equal(rejected,1,'Quota failures back off instead of refetching on repaint');
feeds.reset('kinopoisk');feeds.picks('kinopoisk','top250',1);await flush();assert.equal(rejected,2,'Changing the key can reset a previous failure');
console.log('Passed: service/tab visibility/order, VoKino migration/sync, independent collections, all-source Overview, sixteen-card pagination across twenty-item APIs, hidden-source gating and bounded loading.');
