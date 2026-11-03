/* Samsung AU7170: adjustable VoKino cards, optional private account feed. */
(function () {
  'use strict';
  if (window.VoKinoBridge) return;
  var PUBLIC_BASE = 'https://api.vokino.pro/v2';
  var ALLOWED = ['https://api.vokino.pro/v2', 'https://api.vokino.co/v2', 'https://api.vokino.org/v2', 'https://api.vokino.tv/v2'];
  var CACHE = 'fmtv.vokino.feed.v5', ACCOUNT = 'fmtv.vokino.account';
  var SEARCH = 'fmtv.vokino.search.v1', searchSeq = 0, searchAbort = null;
  var prefix = 'bridge-vokino:', appId = 'UMHvZ0dWqo.AnalogWatch';
  var youtubeId = 'xvvl3S1TT1.TizenTubeStandalone';
  var serviceAvailable = false;
  var favoriteIds = [];
  var original = {picks: Data.picks, hasKey: Data.hasKey, image: Data.image,
    appFor: Data.appFor, usable: Data.usable, showcase: Data.showcase, launch: TV.launch};
  var bridge = window.VoKinoBridge = {version: '1.0', items: [], error: '', lastAction: null, inFlight: false, offsets: {},
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
    if (d && types[d.type]) kind = ['serial', 'multserial', 'docuserial', 'tvshow'].indexOf(d.type) >= 0 ? 'tv' : 'movie';
    if (!d || !kind || !/^[a-f0-9]{24}$/.test(String(d.id)) || !d.name) return null;
    var progress = Number(d.time) > 0 ? Number(d.current) / Number(d.time) : 0;
    if (section === 'resume' && !(Number(d.current) >= 20 && progress > 0 && progress < 0.95)) return null;
    var resume = Number(d.current) >= 20 && progress > 0 && progress < 0.95;
    var def = VoKinoSections.definition(section);
    var label = section === 'resume' || (section === 'history' && resume) ? 'Продолжить (' + Math.round(progress * 100) + '%)' : section === 'search' ? types[d.type] : def ? def.name : '';
    var poster = d.poster || '', back = d.bg_poster && d.bg_poster.backdrop || poster;
    var p = {id: 'vokino:' + d.id, app: prefix + d.id, kind: kind, section: section || 'popular', resume: resume,
      title: String(d.name).slice(0, 180), meta: [label, d.released || '', 'VoKino'].filter(function (x) { return !!x; }).join(' · '),
      poster: poster || back, backdrop: back};
    return valid(p) ? p : null;
  };
  function selectionStamp() { return VoKinoSections.sources().map(function (d) { return d.id; }).sort().join(','); }
  bridge.accept = function (items, generatedAt, accountKey, selectedSources) {
    var seen = {};
    items = items.filter(function (p) { var key = p.section + ':' + p.id; if (!valid(p) || seen[key]) return false; seen[key] = true; return true; }).slice(0, 256);
    bridge.items = items; bridge.generatedAt = generatedAt || Date.now() / 1000;
    bridge.accountKey = accountKey || owner(); bridge.error = '';
    bridge.selectedSources = selectedSources === undefined ? selectionStamp() : selectedSources;
    try { localStorage.setItem(CACHE, JSON.stringify({items: items, generatedAt: bridge.generatedAt, accountKey: bridge.accountKey, selectedSources: bridge.selectedSources})); } catch (e) {}
    Data.settingsChanged();
  };
  function fresh() {
    return bridge.generatedAt && bridge.selectedSources === selectionStamp() && bridge.accountKey === owner() && Date.now() / 1000 - bridge.generatedAt < (account() ? 300 : 3600);
  }
  Data.hasKey = function () { return true; };
  function count() { return Math.max(1, Math.min(16, Prefs.cards())); }
  function collection(kind) {
    if (bridge.accountKey && bridge.accountKey !== owner()) return [];
    var choices = VoKinoSections.all();
    function section(id) {
      if (!choices.some(function (d) { return d.id === id && d.enabled; })) return [];
      return bridge.items.filter(function (p) {
        return id === 'continue' ? (p.section === 'history' || p.section === 'resume') && p.resume :
          id === 'history' ? p.section === 'history' || p.section === 'resume' : p.section === id;
      });
    }
    if (kind && kind.indexOf('vokino-') === 0) return section(kind.slice(7));
    var groups = [], mixed = [], seen = {}, longest = 0;
    choices.forEach(function (d) {
      if (!d.enabled) return;
      var list = section(d.id);
      if (d.id === 'history') list = list.filter(function (p) { return p.resume; }).concat(list.filter(function (p) { return !p.resume; }));
      groups.push(list); longest = Math.max(longest, list.length);
    });
    function add(p) { if (p && !seen[p.id]) { seen[p.id] = true; mixed.push(p); } }
    for (var i = 0; i < longest; i++) groups.forEach(function (list) { add(list[i]); });
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
    var rows = collection(kind), key = kind || 'overview', offset = bridge.offsets[key] || 0;
    if (offset >= rows.length) offset = bridge.offsets[key] = 0;
    return rows.slice(offset, offset + count()).map(function (p, i) {
      if (!kind || kind.indexOf('vokino-') !== 0) return p;
      var copy = {}; Object.keys(p).forEach(function (k) { copy[k] = p[k]; });
      copy.meta += ' · ' + (offset + i + 1) + ' / ' + rows.length;
      return copy;
    });
  };
  Data.showcase = function () { return Data.picks(null); };
  Data.image = function (path, size) {
    if (!/^https:\/\/(?:proxy\.vokino\.(?:pro|co|org|tv)|image\.tmdb\.org)\//.test(path || '')) return original.image(path, size);
    var wanted = size === 'w300' ? 'w185' : size === 'w342' ? 'w342' : 'w780';
    return path.replace(/\/t\/p\/(?:w\d+(?:_and_h\d+_bestv\d+)?|original)\//, '/t/p/' + wanted + '/');
  };
  Data.appFor = function (key) {
    return typeof key === 'string' && /^bridge-vokino:[a-f0-9]{24}$/.test(key) ? {id: key, title: 'VoKino'} : original.appFor(key);
  };
  Data.usable = function (key) {
    // The stock eligibility check only recognizes built-in streaming services.
    if (/^bridge-vokino:[a-f0-9]{24}$/.test(key || '')) return bridge.hasVoKino();
    return original.usable(key);
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
      if (s) localStorage.setItem('fmtv.return.selection', JSON.stringify({tab: s.tab, tabKey: VoKinoSections.tabs()[s.tab] ? VoKinoSections.tabs()[s.tab].key : null, card: Math.max(0, Math.min(15, s.card || 0)), shelf: s.shelf, zone: s.zone, offsets: bridge.offsets,
        search: window.VoKinoSearch ? VoKinoSearch.selection() : null,
        kinopoiskSearch: window.KinopoiskSearch ? KinopoiskSearch.selection() : null,
        iviSearch: window.IviSearch ? IviSearch.selection() : null,
        combinedSearch: window.CombinedSearch ? CombinedSearch.selection() : null,
        catalog: window.CatalogHome ? CatalogHome.selection() : null}));
    } catch (e) {}
  }
  bridge.takeReturnSelection = function () {
    var s = stored('fmtv.return.selection');
    try { localStorage.removeItem('fmtv.return.selection'); } catch (e) {}
    if (!(s && s.tab >= 0 && s.card >= 0 && s.card <= 15)) return null;
    var tabs = VoKinoSections.tabs();
    if (s.tabKey !== undefined) { s.tab = 0; tabs.forEach(function (t, i) { if (t.key === s.tabKey) s.tab = i; }); }
    s.tab = Math.min(tabs.length - 1, Math.floor(s.tab));
    var offsets = {};
    ['overview'].concat(VoKinoSections.all().map(function (d) { return 'vokino-' + d.id; })).forEach(function (k) { var n = s.offsets && s.offsets[k]; if (n >= 0 && n <= 256) offsets[k] = n; });
    s.offsets = offsets; return s;
  };
  function syncFavorites(done) { signal('/favorites?ids=' + encodeURIComponent(JSON.stringify(favoriteIds)), done); }
  bridge.setFavorites = function (ids, quiet) {
    var next = [];
    (Array.isArray(ids) ? ids : []).forEach(function (id) {
      if (typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) && id !== 'FreeMyTVio.FreeMyTV' &&
          !/(?:\.service|Service|\.Autostart)$/.test(id) && next.indexOf(id) < 0 && next.length < 128) next.push(id);
    });
    var changed = JSON.stringify(next) !== JSON.stringify(favoriteIds);
    favoriteIds = next;
    if (changed && !quiet) syncFavorites();
  };
  bridge.favorites = function () { return favoriteIds.slice(); };
  bridge.hasVoKino = function () { return favoriteIds.indexOf(appId) >= 0; };
  function launchWithReturn(id, start) {
    if (favoriteIds.indexOf(id) < 0) { signal('/cancel-watch'); start(); return; }
    rememberSelection();
    syncFavorites(function () {
      if (favoriteIds.indexOf(id) < 0) { signal('/cancel-watch'); start(); return; }
      signal('/watch/app?appId=' + encodeURIComponent(id), start);
    });
  }
  bridge.launchWithReturn = launchWithReturn;
  bridge.cancelReturn = function () { signal('/cancel-watch'); };
  function notifyVisible() { if (!document.hidden) syncFavorites(function () { signal('/home-visible'); }); }
  TV.launch = function (id, params, done) {
    if (id === '9Ur5IzDKqV.TizenYouTube' && favoriteIds.indexOf(id) < 0 && favoriteIds.indexOf(youtubeId) >= 0) id = youtubeId;
    if (typeof id !== 'string' || id.indexOf(prefix) !== 0) return launchWithReturn(id, function () {
      original.launch.call(TV, id, params, function (ok) { if (!ok) signal('/cancel-watch'); if (done) done(ok); });
    });
    var ident = id.slice(prefix.length);
    if (!/^[a-f0-9]{24}$/.test(ident)) { if (done) done(false); return; }
    var a = account(), base = a ? a.base : PUBLIC_BASE;
    bridge.lastAction = {id: ident, status: 'requesting'};
    launchWithReturn(appId, function () { try {
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
      var filter = '';
      ['sort', 'type'].forEach(function (key) { var value = current.searchParams.get(key); if (value) filter += '&' + key + '=' + encodeURIComponent(value); });
      if (current.pathname === b.pathname + '/search') filter += '&name=' + encodeURIComponent(current.searchParams.get('name') || '');
      return url.pathname.slice(b.pathname.length) + '?page=' + page + filter;
    } catch (e) { return ''; }
  }
  function normalize(rows, section) { return rows.map(function (r) { return bridge.fromSource(r, section); }).filter(function (p) { return !!p; }).slice(0, 16); }
  bridge.cancelSearch = function () {
    searchSeq++; if (searchAbort) searchAbort.abort(); searchAbort = null; bridge.searchState.loading = false;
  };
  bridge.search = function (query, page, done, target) {
    query = String(query || '').replace(/[\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120).replace(/[\ud800-\udbff]$/, '');
    bridge.cancelSearch();
    var seq = searchSeq, state = target || bridge.searchState, a = account(), base = a ? a.base : PUBLIC_BASE;
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
      if (!target) try { localStorage.setItem(SEARCH, JSON.stringify({query: query, page: page, nextPage: state.nextPage, items: state.items, savedAt: Date.now()})); } catch (e) {}
      if (done) done(null, state);
    });
  };
  function getFeed(base, path, token, section, done) {
    var items = [], seen = {}, visited = {}, pages = 0;
    function load(page) {
      if (!VoKinoSections.sources().some(function (d) { return d.id === section; })) { done(null, items); return; }
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
    var a = account(), stamp = owner(), selectedSources = selectionStamp();
    var wanted = VoKinoSections.sources(), results = {}, active = 0, at = 0, completed = 0, successes = 0;
    if (bridge.accountKey && bridge.accountKey !== stamp) { bridge.items = []; bridge.generatedAt = 0; }
    bridge.error = ''; Data.settingsChanged();
    function finish() {
      bridge.inFlight = false;
      if (stamp === owner()) {
        if (!wanted.length || successes) {
          var items = [];
          wanted.forEach(function (d) { items = items.concat(results[d.id] || bridge.items.filter(function (p) { return p.section === d.id; })); });
          bridge.accept(items, Date.now() / 1000, stamp, selectedSources);
        } else { bridge.error = 'Catalog unavailable'; Data.settingsChanged(); }
      }
      if (bridge.sectionsDirty || stamp !== owner() || selectionStamp() !== selectedSources) {
        bridge.sectionsDirty = false; setTimeout(function () { bridge.refresh(false); }, 0);
      }
    }
    function pump() {
      if (completed === wanted.length) { finish(); return; }
      while (active < 2 && at < wanted.length) (function (d) {
        active++;
        function done(err, items) {
          if (!err) { results[d.id] = items; successes++; }
          active--; completed++; pump();
        }
        if (stamp !== owner() || !VoKinoSections.sources().some(function (current) { return current.id === d.id; }) || (d.personal && !a)) done(null, []);
        else getFeed(d.personal ? a.base : PUBLIC_BASE, d.path, d.personal ? a.token : '', d.id, done);
      })(wanted[at++]);
    }
    pump();
  };
  bridge.sectionsChanged = function () {
    bridge.offsets = {};
    if (bridge.inFlight) bridge.sectionsDirty = true;
    else if (!fresh()) setTimeout(function () { bridge.refresh(false); }, 150);
    Data.settingsChanged();
  };
  function schedule() { if (!document.hidden && !fresh()) setTimeout(function () { bridge.refresh(false); }, 1600); }
  try {
    var shelf = Prefs.shelf();
    var tubeInstalled = false;
    try { tizen.application.getAppInfo(youtubeId); tubeInstalled = true; } catch (e) {}
    if (!localStorage.getItem('fmtv.youtube.favorite.rev') && tubeInstalled && Array.isArray(shelf) && shelf.indexOf('9Ur5IzDKqV.TizenYouTube') >= 0) {
      var seen = {};
      Prefs.set('shelf', shelf.map(function (id) { return id === '9Ur5IzDKqV.TizenYouTube' ? youtubeId : id; }).filter(function (id) { if (seen[id]) return false; seen[id] = true; return true; }));
    }
    localStorage.setItem('fmtv.youtube.favorite.rev', '1');
    if (!localStorage.getItem('fmtv.compact.rev')) { Prefs.set('cards', 2); localStorage.setItem('fmtv.compact.rev', '1'); }
    if (!localStorage.getItem('fmtv.cards16.rev')) { Prefs.set('cards', 16); localStorage.setItem('fmtv.cards16.rev', '1'); }
    var cached = stored(CACHE);
    if (!cached) { cached = stored('fmtv.vokino.feed.v4'); if (cached) cached.selectedSources = 'legacy'; }
    if (!cached) { cached = stored('fmtv.vokino.feed.v3'); if (cached) cached.generatedAt = 1; }
    if (cached && Array.isArray(cached.items) && cached.accountKey === owner()) bridge.accept(cached.items, cached.generatedAt, cached.accountKey, cached.selectedSources);
    var search = stored(SEARCH);
    if (search && typeof search.query === 'string' && search.query.length <= 120 && Date.now() - search.savedAt < 86400000 && Array.isArray(search.items)) {
      bridge.searchState = {query: search.query, page: Math.max(1, Math.min(9999, Number(search.page) || 1)),
        nextPage: Math.max(0, Math.min(9999, Number(search.nextPage) || 0)), items: search.items.filter(valid).slice(0, 16), loading: false, error: ''};
    }
  } catch (e) {}
  bridge.setFavorites(Prefs.shelf(), true);
  document.addEventListener('visibilitychange', function () { schedule(); notifyVisible(); });
  bridge.timer = setInterval(schedule, 60000);
  schedule();
  try { tizen.application.getAppInfo('FreeMyTVio.Autostart'); serviceAvailable = true; tizen.application.launch('FreeMyTVio.Autostart', function () {}, function () {}); } catch (e) {}
  setTimeout(notifyVisible, 0); setTimeout(notifyVisible, 2000);
})();
