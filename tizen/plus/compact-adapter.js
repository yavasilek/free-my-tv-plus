/* Samsung AU7170: adjustable VoKino cards, optional private account feed. */
(function () {
  'use strict';
  if (window.VoKinoBridge) return;
  var PUBLIC_BASE = 'https://api.vokino.pro/v2';
  var ALLOWED = ['https://api.vokino.pro/v2', 'https://api.vokino.co/v2', 'https://api.vokino.org/v2', 'https://api.vokino.tv/v2'];
  var CACHE = 'fmtv.vokino.feed.v4', ACCOUNT = 'fmtv.vokino.account';
  var SEARCH = 'fmtv.vokino.search.v1', searchSeq = 0, searchAbort = null;
  var prefix = 'bridge-vokino:', appId = 'UMHvZ0dWqo.AnalogWatch';
  var youtubeId = 'xvvl3S1TT1.TizenTubeStandalone';
  var embyId = 'vYmY3ACVaa.emby';
  var serviceAvailable = false;
  var original = {picks: Data.picks, hasKey: Data.hasKey, image: Data.image,
    appFor: Data.appFor, showcase: Data.showcase, launch: TV.launch};
  var bridge = window.VoKinoBridge = {version: '0.8', items: [], error: '', lastAction: null, inFlight: false, offsets: {},
    searchState: {query: '', page: 1, items: [], nextPage: 0, loading: false, error: ''}};

  function stored(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function account() {
    var a = stored(ACCOUNT);
    return a && ALLOWED.indexOf(a.base) >= 0 && typeof a.token === 'string' && a.token.length > 8 && a.key ? a : null;
  }
  function owner() { var a = account(); return a ? a.key : 'public'; }
  function valid(p) {
    return p && /^vokino:[a-f0-9]{24}$/.test(p.id) && (p.kind === 'movie' || p.kind === 'tv') &&
      typeof p.title === 'string' && p.app === prefix + p.id.slice(7) &&
      /^https:\/\/(?:proxy\.vokino\.(?:pro|co|org|tv)|image\.tmdb\.org)\//.test(p.poster || '') &&
      /^https:\/\/(?:proxy\.vokino\.(?:pro|co|org|tv)|image\.tmdb\.org)\//.test(p.backdrop || '');
  }
  bridge.fromSource = function (row, section) {
    var d = row && row.details, kind = d && (d.type === 'movie' ? 'movie' : d.type === 'serial' ? 'tv' : '');
    var types = {movie: 'Фильм', serial: 'Сериал', multfilm: 'Мультфильм', multserial: 'Мультсериал', documovie: 'Документальный фильм', docuserial: 'Документальный сериал', tvshow: 'ТВ-шоу', anime: 'Аниме'};
    if (section === 'search' && d && types[d.type]) kind = ['serial', 'multserial', 'docuserial', 'tvshow'].indexOf(d.type) >= 0 ? 'tv' : 'movie';
    if (!d || !kind || !/^[a-f0-9]{24}$/.test(String(d.id)) || !d.name) return null;
    var progress = Number(d.time) > 0 ? Number(d.current) / Number(d.time) : 0;
    if (section === 'resume' && !(Number(d.current) >= 20 && progress > 0 && progress < 0.95)) return null;
    var resume = Number(d.current) >= 20 && progress > 0 && progress < 0.95;
    var label = section === 'resume' || (section === 'history' && resume) ? 'Продолжить (' + Math.round(progress * 100) + '%)' : section === 'favorites' ? 'Избранное' : section === 'history' ? 'История' : section === 'search' ? types[d.type] : '';
    var poster = d.poster || '', back = d.bg_poster && d.bg_poster.backdrop || poster;
    var p = {id: 'vokino:' + d.id, app: prefix + d.id, kind: kind, section: section || 'popular', resume: resume,
      title: String(d.name).slice(0, 180), meta: [label, d.released || '', 'VoKino'].filter(function (x) { return !!x; }).join(' · '),
      poster: poster || back, backdrop: back};
    return valid(p) ? p : null;
  };
  bridge.accept = function (items, generatedAt, accountKey) {
    var seen = {};
    items = items.filter(function (p) { var key = p.section + ':' + p.id; if (!valid(p) || seen[key]) return false; seen[key] = true; return true; }).slice(0, 32);
    if (!items.length) throw new Error('No usable cards');
    bridge.items = items; bridge.generatedAt = generatedAt || Date.now() / 1000;
    bridge.accountKey = accountKey || owner(); bridge.error = '';
    try { localStorage.setItem(CACHE, JSON.stringify({items: items, generatedAt: bridge.generatedAt, accountKey: bridge.accountKey})); } catch (e) {}
    Data.settingsChanged();
  };
  function fresh() {
    return bridge.items.length && bridge.accountKey === owner() && Date.now() / 1000 - bridge.generatedAt < (account() ? 300 : 3600);
  }
  Data.hasKey = function () { return !!bridge.items.length || original.hasKey(); };
  function count() { return Math.max(1, Math.min(16, Prefs.cards())); }
  function collection(kind) {
    if (kind === 'vokino-history') return bridge.items.filter(function (p) { return p.section === 'history' || p.section === 'resume'; });
    if (kind === 'vokino-favorites') return bridge.items.filter(function (p) { return p.section === 'favorites'; });
    var history = bridge.items.filter(function (p) { return p.section === 'resume' || (p.section === 'history' && p.resume); });
    var favorites = bridge.items.filter(function (p) { return p.section === 'favorites'; });
    var mixed = [], seen = {};
    function add(p) { if (p && !seen[p.id]) { seen[p.id] = true; mixed.push(p); } }
    for (var i = 0; i < Math.max(history.length, favorites.length); i++) { add(history[i]); add(favorites[i]); }
    bridge.items.forEach(add);
    return mixed.filter(function (p) { return !kind || p.kind === kind; });
  }
  bridge.resetPage = function (kind) { bridge.offsets[kind || 'overview'] = 0; };
  bridge.turnPage = function (kind, direction) {
    var key = kind || 'overview', rows = collection(kind), offset = bridge.offsets[key] || 0;
    var next = offset + (direction > 0 ? count() : -count());
    if (next < 0 || next >= rows.length) return false;
    bridge.offsets[key] = next; return true;
  };
  Data.picks = function (kind) {
    if (!bridge.items.length) return original.picks(kind);
    var rows = collection(kind), key = kind || 'overview', offset = bridge.offsets[key] || 0;
    if (offset >= rows.length) offset = bridge.offsets[key] = 0;
    return rows.slice(offset, offset + count()).map(function (p, i) {
      if (kind !== 'vokino-history' && kind !== 'vokino-favorites') return p;
      var copy = {}; Object.keys(p).forEach(function (k) { copy[k] = p[k]; });
      copy.meta += ' · ' + (offset + i + 1) + ' / ' + rows.length;
      return copy;
    });
  };
  Data.showcase = function () { return bridge.items.length ? Data.picks(null) : original.showcase(); };
  Data.image = function (path, size) {
    if (!/^https:\/\/(?:proxy\.vokino\.(?:pro|co|org|tv)|image\.tmdb\.org)\//.test(path || '')) return original.image(path, size);
    var wanted = size === 'w300' ? 'w185' : size === 'w342' ? 'w342' : 'w780';
    return path.replace(/\/t\/p\/(?:w\d+(?:_and_h\d+_bestv\d+)?|original)\//, '/t/p/' + wanted + '/');
  };
  Data.appFor = function (key) {
    return typeof key === 'string' && /^bridge-vokino:[a-f0-9]{24}$/.test(key) ? {id: key, title: 'VoKino'} : original.appFor(key);
  };
  function signal(path, done) {
    if (!serviceAvailable) { if (done) done(); return; }
    var finished = false, abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    function finish() { if (finished) return; finished = true; clearTimeout(timer); if (done) done(); }
    var timer = setTimeout(function () { if (abort) abort.abort(); finish(); }, 700);
    try { fetch('http://127.0.0.1:8099' + path, {method: 'POST', credentials: 'omit', redirect: 'error', signal: abort ? abort.signal : undefined}).then(finish, finish); }
    catch (e) { finish(); }
  }
  function rememberSelection() {
    try {
      var s = window.FreeMyTV && FreeMyTV.state;
      if (s) localStorage.setItem('fmtv.return.selection', JSON.stringify({tab: s.tab, card: s.card, shelf: s.shelf, zone: s.zone, offsets: bridge.offsets,
        search: window.VoKinoSearch ? VoKinoSearch.selection() : null}));
    } catch (e) {}
  }
  bridge.takeReturnSelection = function () {
    var s = stored('fmtv.return.selection');
    try { localStorage.removeItem('fmtv.return.selection'); } catch (e) {}
    if (!(s && s.tab >= 0 && s.tab <= 2 && s.card >= 0 && s.card <= 15)) return null;
    var offsets = {};
    ['overview', 'vokino-history', 'vokino-favorites'].forEach(function (k) { var n = s.offsets && s.offsets[k]; if (n >= 0 && n <= 32) offsets[k] = n; });
    s.offsets = offsets; return s;
  };
  function launchWithReturn(key, start) { rememberSelection(); signal('/watch/' + key, start); }
  function notifyVisible() { if (!document.hidden) signal('/home-visible'); }
  TV.launch = function (id, params, done) {
    if (id === '9Ur5IzDKqV.TizenYouTube') id = youtubeId;
    var target = id === appId ? 'vokino' : id === youtubeId ? 'youtube' : id === embyId ? 'emby' : '';
    if (target) return launchWithReturn(target, function () {
      original.launch.call(TV, id, params, function (ok) { if (!ok) signal('/cancel-watch'); if (done) done(ok); });
    });
    if (typeof id !== 'string' || id.indexOf(prefix) !== 0) return original.launch.call(TV, id, params, done);
    var ident = id.slice(prefix.length);
    if (!/^[a-f0-9]{24}$/.test(ident)) { if (done) done(false); return; }
    var a = account(), base = a ? a.base : PUBLIC_BASE;
    bridge.lastAction = {id: ident, status: 'requesting'};
    launchWithReturn('vokino', function () { try {
      var payload = new tizen.ApplicationControlData('PAYLOAD', [JSON.stringify({values: base + '/view/' + ident})]);
      var control = new tizen.ApplicationControl('http://samsung.com/appcontrol/operation/eden', null, null, null, [payload]);
      tizen.application.launchAppControl(control, appId, function () {
        bridge.lastAction.status = 'accepted'; if (done) done(true);
      }, function (err) { signal('/cancel-watch'); bridge.lastAction.status = 'error'; if (done) done(false); });
    } catch (err) { signal('/cancel-watch'); bridge.lastAction.status = 'error'; if (done) done(false); } });
  };
  function get(base, path, token, done) {
    if (ALLOWED.indexOf(base) < 0) { done(new Error('Unknown API host')); return; }
    var url = base + path + (token ? (path.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(token) : '');
    if (typeof fetch !== 'function') { done(new Error('Secure account requests unavailable')); return; }
    var timer, abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (abort) timer = setTimeout(function () { abort.abort(); }, 12000);
    fetch(url, {redirect: 'error', credentials: 'omit', signal: abort ? abort.signal : undefined}).then(function (r) {
      if (!r.ok) throw new Error('Catalog HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      if (!d || d.type !== 'list' || !Array.isArray(d.channels)) throw new Error('Unexpected catalog');
      clearTimeout(timer); done(null, d.channels, nextPath(base, path, d.page && d.page.next));
    }).catch(function (err) { clearTimeout(timer); done(new Error('Catalog unavailable')); });
    return abort;
  }
  function nextPath(base, path, next) {
    if (typeof next !== 'string' || !next) return '';
    try {
      var b = new URL(base), current = new URL(base + path), url = new URL(next, base + '/');
      if (url.host !== b.host || (url.protocol !== 'https:' && url.protocol !== 'http:') || url.pathname !== current.pathname) return '';
      var page = url.searchParams.get('page');
      if (!/^[1-9][0-9]{0,3}$/.test(page || '')) return '';
      var filter = current.searchParams.get('sort') === 'popular' ? '&sort=popular' : '';
      if (current.pathname === b.pathname + '/search') filter += '&name=' + encodeURIComponent(current.searchParams.get('name') || '');
      return url.pathname.slice(b.pathname.length) + '?page=' + page + filter;
    } catch (e) { return ''; }
  }
  function normalize(rows, section) { return rows.map(function (r) { return bridge.fromSource(r, section); }).filter(function (p) { return !!p; }).slice(0, 16); }
  bridge.cancelSearch = function () {
    searchSeq++; if (searchAbort) searchAbort.abort(); searchAbort = null; bridge.searchState.loading = false;
  };
  bridge.search = function (query, page, done) {
    query = String(query || '').replace(/[\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120).replace(/[\ud800-\udbff]$/, '');
    bridge.cancelSearch();
    var seq = searchSeq, state = bridge.searchState, a = account(), base = a ? a.base : PUBLIC_BASE;
    page = Math.max(1, Math.min(9999, Math.floor(Number(page) || 1)));
    state.items = [];
    state.query = query; state.page = page; state.error = ''; state.nextPage = 0;
    if (query.length < 2) { state.error = 'Введите минимум 2 символа.'; if (done) done(new Error(state.error), state); return; }
    state.loading = true;
    searchAbort = get(base, '/search?name=' + encodeURIComponent(query) + '&page=' + page, '', function (err, rows, next) {
      if (seq !== searchSeq) return;
      state.loading = false; searchAbort = null;
      if (err) { state.error = 'Не удалось выполнить поиск. Попробуйте еще раз.'; if (done) done(new Error(state.error), state); return; }
      var seen = {};
      state.items = normalize(rows, 'search').filter(function (p) { if (seen[p.id]) return false; seen[p.id] = true; return true; });
      if (next) { try { state.nextPage = Number(new URL(base + next).searchParams.get('page')) || 0; } catch (e) {} }
      try { localStorage.setItem(SEARCH, JSON.stringify({query: query, page: page, nextPage: state.nextPage, items: state.items, savedAt: Date.now()})); } catch (e) {}
      if (done) done(null, state);
    });
  };
  function getFeed(base, path, token, section, done) {
    var items = [], seen = {}, visited = {}, pages = 0;
    function load(page) {
      visited[page] = true; pages++;
      get(base, page, token, function (err, rows, next) {
        if (err) { done(items.length ? null : err, items); return; }
        normalize(rows, section).forEach(function (p) { if (!seen[p.id] && items.length < 16) { seen[p.id] = true; items.push(p); } });
        if (items.length < 16 && next && !visited[next] && pages < 4) load(next);
        else done(null, items);
      });
    }
    load(path);
  }
  bridge.refresh = function (force) {
    if (bridge.inFlight || document.hidden || (!force && fresh())) return;
    bridge.inFlight = true;
    var a = account(), stamp = owner();
    function finish(err, items) {
      bridge.inFlight = false;
      if (stamp !== owner()) return;
      if (err) { bridge.error = 'Catalog unavailable'; return; }
      try { bridge.accept(items, Date.now() / 1000, stamp); } catch (e) { bridge.error = 'No available cards'; }
    }
    function popular() { getFeed(PUBLIC_BASE, '/list?sort=popular', '', 'popular', function (err, items) { finish(err, items); }); }
    if (!a) { popular(); return; }
    var waiting = 2, history = [], favorites = [], successes = 0;
    function completed() {
      if (--waiting) return;
      if (!successes) { finish(new Error('Personal feed unavailable')); return; }
      var items = history.concat(favorites);
      if (!items.length) popular(); else finish(null, items);
    }
    getFeed(a.base, '/timeline/list', a.token, 'history', function (err, items) { if (!err) { successes++; history = items; } completed(); });
    getFeed(a.base, '/bookmarks/bookmark_list', a.token, 'favorites', function (err, items) { if (!err) { successes++; favorites = items; } completed(); });
  };
  function schedule() { if (!document.hidden && !fresh()) setTimeout(function () { bridge.refresh(false); }, 1600); }
  try {
    var shelf = Prefs.shelf();
    if (Array.isArray(shelf) && shelf.indexOf('9Ur5IzDKqV.TizenYouTube') >= 0) {
      var seen = {};
      Prefs.set('shelf', shelf.map(function (id) { return id === '9Ur5IzDKqV.TizenYouTube' ? youtubeId : id; }).filter(function (id) { if (seen[id]) return false; seen[id] = true; return true; }));
    }
    if (!localStorage.getItem('fmtv.compact.rev')) { Prefs.set('cards', 2); localStorage.setItem('fmtv.compact.rev', '1'); }
    if (!localStorage.getItem('fmtv.cards16.rev')) { Prefs.set('cards', 16); localStorage.setItem('fmtv.cards16.rev', '1'); }
    var cached = stored(CACHE);
    if (!cached) { cached = stored('fmtv.vokino.feed.v3'); if (cached) cached.generatedAt = 1; }
    if (cached && cached.accountKey === owner()) bridge.accept(cached.items, cached.generatedAt, cached.accountKey);
    var search = stored(SEARCH);
    if (search && typeof search.query === 'string' && search.query.length <= 120 && Date.now() - search.savedAt < 86400000 && Array.isArray(search.items)) {
      bridge.searchState = {query: search.query, page: Math.max(1, Math.min(9999, Number(search.page) || 1)),
        nextPage: Math.max(0, Math.min(9999, Number(search.nextPage) || 0)), items: search.items.filter(valid).slice(0, 16), loading: false, error: ''};
    }
  } catch (e) {}
  document.addEventListener('visibilitychange', function () { schedule(); notifyVisible(); });
  bridge.timer = setInterval(schedule, 60000);
  schedule();
  try { tizen.application.getAppInfo('FreeMyTVio.Autostart'); serviceAvailable = true; tizen.application.launch('FreeMyTVio.Autostart', function () {}, function () {}); } catch (e) {}
  setTimeout(notifyVisible, 0); setTimeout(notifyVisible, 2000);
})();
