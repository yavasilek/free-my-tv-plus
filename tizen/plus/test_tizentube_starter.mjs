import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const code = fs.readFileSync(new URL('./tizentube-starter.js', import.meta.url), 'utf8');
function boot() {
  let now = 0, serial = 0, launches = 0, exits = 0, requests = [], timers = new Map(), status = {};
  const events = {}, win = {};
  const document = {hidden: false, getElementById: () => status, addEventListener: (type, fn) => {events[type] = fn;}};
  class Request {
    open(method, url) { assert.equal(method, 'GET'); assert.equal(url, 'http://127.0.0.1:8102/fmtv/ready'); }
    send() { requests.push(this); }
    abort() { this.aborted = true; }
  }
  const box = {document, window: {addEventListener: (type, fn) => {win[type] = fn;}}, Date: {now: () => now},
    XMLHttpRequest: Request, setTimeout(fn) { timers.set(++serial, fn); return serial; }, clearTimeout(id) {timers.delete(id);},
    tizen: {ApplicationControl: function () {}, application: {
      launchAppControl(control, id, ok) {assert.equal(id, 'FMTVTube01.StandaloneService'); ok();},
      launch(id, ok) {assert.equal(id, 'xvvl3S1TT1.TizenTubeStandalone'); launches++; ok();},
      getCurrentApplication: () => ({exit() {exits++;}})
    }}};
  vm.runInNewContext(code, box); win.load();
  return {document, events, status, requests, get launches() {return launches;}, get exits() {return exits;},
    reply(code) {const r=requests.at(-1);r.status=code;r.onload();},
    tick(ms=700) {now+=ms;const first=timers.entries().next().value;if(first){timers.delete(first[0]);first[1]();}}};
}
const a=boot();assert.equal(a.launches,0);a.reply(503);a.tick();assert.equal(a.launches,0);
a.reply(204);assert.equal(a.launches,1);assert.equal(a.exits,1);
const b=boot();b.document.hidden=true;b.events.visibilitychange();assert.equal(b.requests[0].aborted,true);
b.reply(204);assert.equal(b.launches,0,'Home/another app cancels a late ready reply');
const c=boot();c.reply(503);c.tick(21000);assert.match(c.status.textContent,/OK/);assert.equal(c.launches,0);
c.events.keydown({keyCode:13});assert.equal(c.requests.length,2,'Retry works after a readiness timeout');c.reply(204);assert.equal(c.launches,1);
const d=boot();d.events.keydown({keyCode:10009});d.reply(204);assert.equal(d.launches,0);assert.equal(d.exits,1);
const e=boot();e.events.keydown({keyCode:13});assert.equal(e.requests.length,1,'Repeated OK during setup does not open twice');
console.log('Passed: proxy/network gating, cancellation, manual retry, Back and duplicate OK.');
