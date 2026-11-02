import fs from 'node:fs';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import assert from 'node:assert/strict';
const code=fs.readFileSync(new URL('./autostart.js',import.meta.url),'utf8');
function boot(failures=0,skipCallbacks=false){
  let now=1000000,interval,server,requests=[],launches=0,apps=[],listener;
  const http={get(options,callback){
    assert.equal(options.host,'127.0.0.1');
    const req=new EventEmitter();req.callback=callback;req.setTimeout=(ms,fn)=>{req.timeout=fn;};
    req.destroy=()=>{req.destroyed=true;req.emit('close');};requests.push(req);return req;
  },createServer(handler){server=new EventEmitter();server.handler=handler;server.listen=(port,host)=>assert.equal(host,'127.0.0.1');server.close=()=>{server.closed=true;};return server;}};
  const box={require(name){assert.equal(name,'http');return http;},Date:{now:()=>now},exports:{},
    setInterval(fn){interval=fn;return 1;},clearInterval(){interval=null;},
    tizen:{application:{launch(id,yes,no){assert.equal(id,'FreeMyTVio.FreeMyTV');launches++;if(skipCallbacks)return;if(launches<=failures)no({name:'UnknownError'});else yes();},
      getAppsContext(yes){yes(apps.map(appId=>({appId})));},addAppStatusChangeListener(fn){listener=fn;return 1;}}}};
  vm.createContext(box);vm.runInContext(code,box);box.exports.onStart();
  function reply(state){const req=requests.at(-1),res=new EventEmitter();req.callback(res);res.emit('data',JSON.stringify({device:{PowerState:state}}));res.emit('end');}
  return {box,reply,requests,get launches(){return launches;},get server(){return server;},
    apps(value){apps=value;},activate(id){listener(id,true);},
    command(url){server.handler({method:'POST',url},{writeHead(code){assert.equal(code,204);},end(){}});},
    tick(ms=1000,state='on'){now+=ms;interval();reply(state);}};
}
const a=boot();a.reply('on');assert.equal(a.launches,0,'Wait for Smart Hub startup');
a.tick();a.tick();assert.equal(a.launches,1);
for(let i=0;i<60;i++)a.tick();assert.equal(a.launches,1,'Do not reopen Home while another app is being watched');
a.tick(1000,'standby');a.tick(1000,'on');a.tick();a.tick();assert.equal(a.launches,2,'Observed standby -> on');
a.tick(12000,'on');a.tick();a.tick();assert.equal(a.launches,3,'Detect runtime suspension without any standby response');
for(let i=0;i<10;i++)a.tick();assert.equal(a.launches,3,'Only one launch per resume');
const b=boot(2);b.reply('on');for(let i=0;i<7;i++)b.tick();assert.equal(b.launches,3,'Retry transient launch failures');
const c=boot(100);c.reply('on');for(let i=0;i<30;i++)c.tick();assert.equal(c.launches,6,'Launch failures cannot create an endless reopening loop');
const d=boot();const frozen=d.requests[0];d.tick(12000,'on');assert.equal(frozen.destroyed,true,'Discard pre-suspend pending request');d.tick();d.tick();assert.equal(d.launches,1);
const e=boot();e.requests[0].timeout();assert.equal(e.requests[0].destroyed,true);e.tick();e.tick();e.tick();assert.equal(e.launches,1,'Recover after a stuck HTTP request');
a.box.exports.onStop();a.tick();assert.equal(a.launches,3,'Lifecycle notification must not disable a still-running service');
const before=a.requests.length;a.box.exports.onStart();a.box.exports.onRequest();assert.equal(a.requests.length,before,'Lifecycle callbacks do not create duplicate timers');
const target='UMHvZ0dWqo.AnalogWatch';
const f=boot();f.reply('on');f.tick();f.tick();
f.command('/watch/vokino');f.apps([target]);f.tick();
for(let i=0;i<20;i++)f.tick();assert.equal(f.launches,1,'Never return while VoKino is running');
f.apps([]);f.tick();assert.equal(f.launches,1,'Wait for confirmed termination');f.tick();f.tick();assert.equal(f.launches,2,'Return once after VoKino exits');
for(let i=0;i<10;i++)f.tick();assert.equal(f.launches,2);
const g=boot();g.reply('on');g.tick();g.tick();g.command('/watch/vokino');g.apps([target]);g.tick();g.activate('xvvl3S1TT1.TizenTubeStandalone');g.apps([]);
for(let i=0;i<10;i++)g.tick();assert.equal(g.launches,1,'Do not interrupt another app chosen by the user');
const h=boot();h.reply('on');h.tick();h.tick();h.command('/watch/vokino');for(let i=0;i<15;i++)h.tick();assert.equal(h.launches,1,'Failed target launch cannot trigger a return loop');
const j=boot(0,true);j.reply('on');for(let i=0;i<15;i++)j.tick();assert.equal(j.launches,1,'Missing platform callback cannot cause repeated reopening');
j.command('/home-visible');assert.equal(j.box.status.wakePending,undefined);assert.equal(j.box.wake,false,'The home screen acknowledges successful resume');
for(const [key,id] of [['youtube','xvvl3S1TT1.TizenTubeStandalone'],['emby','vYmY3ACVaa.emby']]){
  const k=boot();k.reply('on');k.tick();k.tick();k.command('/watch/'+key);k.apps([id]);k.activate(id);k.tick();
  k.activate('xvvl3S1TT1.StandaloneService');
  k.activate('vYmY3ACVaa.service');
  for(let i=0;i<10;i++)k.tick();assert.equal(k.launches,1,'Do not interrupt '+key);
  k.apps(['xvvl3S1TT1.StandaloneService']);k.tick();k.tick();k.tick();
  assert.equal(k.launches,2,'Return after '+key+' UI closes, even when a proxy service stays running');
  assert.equal(k.box.status.reason,key+'-exit');
}
const cobalt=boot();cobalt.reply('on');cobalt.tick();cobalt.tick();cobalt.command('/watch/youtube');cobalt.apps(['xvvl3S1TT1.TizenTubeStandalone']);cobalt.tick();
cobalt.apps(['com.samsung.tv.cobalt-yt']);for(let i=0;i<8;i++)cobalt.tick();assert.equal(cobalt.launches,1,'Track the native Cobalt context even when native apps emit no activation event');
cobalt.apps([]);cobalt.tick();cobalt.tick();cobalt.tick();assert.equal(cobalt.launches,2);
const preloaded=boot();preloaded.reply('on');preloaded.tick();preloaded.tick();preloaded.apps(['9Ur5IzDKqV.TizenYouTube']);preloaded.command('/watch/youtube');preloaded.apps(['9Ur5IzDKqV.TizenYouTube','xvvl3S1TT1.TizenTubeStandalone']);preloaded.tick();preloaded.apps(['9Ur5IzDKqV.TizenYouTube']);preloaded.tick();preloaded.tick();preloaded.tick();assert.equal(preloaded.launches,2,'Unrelated preloaded YouTube context must not block returning');
let rejected=0;preloaded.server.handler({method:'POST',url:'/watch/arbitrary-app'},{writeHead(code){rejected=code;},end(){}});assert.equal(rejected,404,'Only the configured three app targets are allowed');
console.log('Passed: delayed boot, standby wake, frozen timer wake, bounded retries, HTTP recovery, no repeated launch during normal viewing.');
