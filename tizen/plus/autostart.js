/* Based on MKsys1337/free-my-tv, b8847dda, tizen/autostart.js (MIT).
 * Observe standby and timer suspension. Launch once per wake, with bounded retries.
 * Power polling, launcher coordination and diagnostics stay on TV loopback.
 */
var http = require('http');
var timer = null, server = null, active = null;
var pending = false, power = null, lastTick = 0;
var wake = false, launching = false, launchStarted = 0, nextAttempt = 0, generation = 0;
var homeId = 'FreeMyTVio.FreeMyTV';
var targets = {
  vokino: {appId: 'UMHvZ0dWqo.AnalogWatch', aliases: []},
  youtube: {appId: 'xvvl3S1TT1.TizenTubeStandalone', contexts: ['com.samsung.tv.cobalt-yt'], aliases: ['9Ur5IzDKqV.TizenYouTube']},
  emby: {appId: 'vYmY3ACVaa.emby', aliases: []}
};
var backgroundServices = ['FreeMyTVio.Autostart', 'xvvl3S1TT1.StandaloneService', 'vYmY3ACVaa.service'];
var favorites = [];
var returning = null, contextPending = false, contextStarted = 0;
var status = {version: 8, favoritesCount: 0, startedAt: 0, lastTick: 0, lastGap: 0, power: null,
  reason: '', attempts: 0, launchCount: 0, lastLaunchAt: 0, lastResult: '', pollErrors: 0,
  returnState: 'idle', returnTarget: '', returnCount: 0, statusListener: false};

function cancelReturn(reason) { returning = null; status.returnState = reason || 'idle'; }
function validAppId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) &&
    id !== homeId && backgroundServices.indexOf(id) < 0 && !/(?:\.service|Service)$/.test(id);
}
function setFavorites(ids) {
  if (!Array.isArray(ids) || ids.length > 128) return false;
  var next = [];
  for (var i = 0; i < ids.length; i++) {
    if (!validAppId(ids[i])) return false;
    try { tizen.application.getAppInfo(ids[i]); } catch (e) { return false; }
    if (next.indexOf(ids[i]) < 0) next.push(ids[i]);
  }
  favorites = next; status.favoritesCount = next.length;
  if (returning && next.indexOf(returning.appId) < 0) cancelReturn('removed-from-favorites');
  return true;
}
function watchReturn(id) {
  if (!validAppId(id) || favorites.indexOf(id) < 0) return false;
  var key = 'app', target = {aliases: []};
  Object.keys(targets).forEach(function (name) { if (targets[name].appId === id) { key = name; target = targets[name]; } });
  returning = {key: key, appId: id, aliases: target.aliases, ids: [id].concat(target.contexts || []), startedAt: Date.now(), seen: false, missing: 0};
  status.returnTarget = id; status.returnState = 'waiting-for-app';
  return true;
}
function homeVisible() {
  if (returning && returning.seen) cancelReturn('home-visible');
  if (status.returnState === 'returning-home') status.returnState = 'home-visible';
  if (wake) { wake = false; launching = false; generation++; status.launchCount++; status.lastResult = 'visible'; }
}
function visibleApp(id) {
  try { return tizen.application.getAppInfo(id).show === true; } catch (e) { return false; }
}
function appStatus(id, active) {
  if (id === homeId && active) { homeVisible(); return; }
  if (!returning || !active) return;
  if (returning.ids.indexOf(id) >= 0 || returning.aliases.indexOf(id) >= 0) {
    if (returning.ids.indexOf(id) < 0) returning.ids.push(id);
    returning.seen = true; status.returnState = 'watching-app';
  } else if (returning.seen && backgroundServices.indexOf(id) < 0 && !/(?:\.service|Service)$/.test(id) &&
      (favorites.indexOf(id) >= 0 || visibleApp(id) || !/^(org\.tizen\.|com\.samsung\.)/.test(id))) cancelReturn('other-app');
}
function checkReturn(now) {
  if (!returning || power !== 'on') return;
  if (contextPending && now - contextStarted < 3000) return;
  contextPending = true; contextStarted = now;
  var current = returning;
  try {
    tizen.application.getAppsContext(function (apps) {
      contextPending = false;
      if (returning !== current || power !== 'on') return;
      var present = apps.some(function (app) { return current.ids.indexOf(app.appId) >= 0; });
      if (present) { current.seen = true; current.missing = 0; status.returnState = 'watching-app'; return; }
      if (!current.seen) { if (Date.now() - current.startedAt > 12000) cancelReturn('launch-timeout'); return; }
      if (++current.missing < 2) return;
      cancelReturn('returning-home'); status.returnCount++;
      requestWake(current.key + '-exit', Date.now() - 1000);
    }, function (e) { contextPending = false; status.returnError = e.name; });
  } catch (e) { contextPending = false; status.returnError = e.name; }
}

function requestWake(reason, now) {
  wake = true; launching = false; generation++;
  status.reason = reason; status.attempts = 0;
  nextAttempt = now + 2000;
}

function launch(now) {
  if (!wake || power !== 'on' || now < nextAttempt || status.attempts >= 6) return;
  if (launching) return; // Some TV resumes omit the launch callback; UI visibility acknowledges them.
  launching = true; launchStarted = now; status.attempts++;
  status.lastLaunchAt = now; status.lastResult = 'requesting';
  var attempt = ++generation;
  function failed(name) {
    if (attempt !== generation) return;
    launching = false; nextAttempt = Date.now() + 2000; status.lastResult = name || 'error';
  }
  try {
    tizen.application.launch(homeId, function () {
      if (attempt !== generation) return;
      launching = false; wake = false; status.launchCount++; status.lastResult = 'ok';
    }, function (e) { failed(e && e.name); });
  } catch (e) { failed(e && e.name); }
}

function observe(value) {
  var state = String(value).toLowerCase(), now = Date.now();
  if (state !== 'on' && state !== 'standby') return;
  var before = power;
  power = status.power = state;
  if (state === 'standby') { cancelReturn('standby'); wake = false; launching = false; generation++; return; }
  if (before !== 'on' && !wake) requestWake('power-on', now);
  launch(now);
  checkReturn(now);
}

function poll() {
  var now = Date.now(), gap = lastTick ? now - lastTick : 0;
  lastTick = status.lastTick = now;
  if (gap > 4000) {
    // Instant On can freeze this runtime before it ever reads "standby".
    status.lastGap = gap; cancelReturn('timer-resume'); requestWake('timer-resume', now);
    pending = false;
    if (active) { try { active.destroy(); } catch (e) {} active = null; }
  }
  if (pending) return;
  pending = true;
  try {
    var req = active = http.get({host: '127.0.0.1', port: 8001, path: '/api/v2/'}, function (res) {
      var body = '';
      res.on('data', function (chunk) { if (body.length < 65536) body += chunk; });
      res.on('end', function () {
        if (active !== req) return;
        pending = false; active = null;
        try { observe(JSON.parse(body).device.PowerState); } catch (e) { status.pollErrors++; }
      });
      res.on('error', function () { if (active === req) { pending = false; active = null; status.pollErrors++; } });
    });
    req.on('error', function () { if (active === req) { pending = false; active = null; status.pollErrors++; } });
    req.on('close', function () { if (active === req) { pending = false; active = null; } });
    req.setTimeout(2000, function () { if (active === req) { pending = false; active = null; status.pollErrors++; } req.destroy(); });
  } catch (e) { pending = false; active = null; status.pollErrors++; }
}

function startService() {
  if (timer) return;
  status.startedAt = Date.now();
  try {
    server = http.createServer(function (req, res) {
      if (req.method === 'POST' && req.url.indexOf('/favorites?ids=') === 0) {
        var accepted = false;
        try { if (req.url.length <= 32768) accepted = setFavorites(JSON.parse(decodeURIComponent(req.url.slice(15)))); } catch (e) {}
        res.writeHead(accepted ? 204 : 400, {'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store'}); res.end(); return;
      }
      if (req.method === 'POST' && req.url.indexOf('/watch/app?appId=') === 0) {
        var watched = false;
        try { watched = watchReturn(decodeURIComponent(req.url.slice(17))); } catch (e) {}
        res.writeHead(watched ? 204 : 403, {'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store'}); res.end(); return;
      }
      var watchKey = req.url.indexOf('/watch/') === 0 ? req.url.slice(7) : '';
      var knownTarget = targets[watchKey] && typeof targets[watchKey].appId === 'string';
      if (req.method === 'POST' && (knownTarget || req.url === '/cancel-watch' || req.url === '/home-visible')) {
        if (knownTarget) {
          if (!watchReturn(targets[watchKey].appId)) { res.writeHead(403); res.end(); return; }
        }
        else if (req.url === '/home-visible') homeVisible();
        else cancelReturn('cancelled');
        res.writeHead(204, {'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store'}); res.end(); return;
      }
      if (req.method !== 'GET' || req.url !== '/status') { res.writeHead(404); res.end(); return; }
      res.writeHead(200, {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store'});
      var out = {}; Object.keys(status).forEach(function (k) { out[k] = status[k]; });
      out.wakePending = wake; out.launchPending = launching;
      res.end(JSON.stringify(out));
    });
    server.on('error', function (e) { status.diagnosticError = e.code || e.name; });
    server.listen(8099, '127.0.0.1');
  } catch (e) { status.diagnosticError = e.name; }
  try { tizen.application.addAppStatusChangeListener(appStatus); status.statusListener = true; }
  catch (e) { status.statusListenerError = e.name; }
  poll();
  timer = setInterval(poll, 1000);
}
// The installed TizenTube uses this lifecycle pattern on the same TV: initialize
// when the service module is loaded; lifecycle notifications are not process exit.
exports.onStart = startService;
exports.onRequest = startService;
exports.onStop = function () {};
startService();
