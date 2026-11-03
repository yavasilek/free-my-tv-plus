/* Bounded public collection loading; VoKino keeps its existing private adapter. */
(function () {
  'use strict';
  var KEY = 'fmtv.catalog.feeds.v1', cache = {}, queue = [], running = {}, active = 0, listeners = [], generations = {kinopoisk: 0, ivi: 0};
  function emit() { listeners.forEach(function (fn) { fn(); }); }
  function cacheKey(service, tab, page) { return service + ':' + tab + ':' + page; }
  function allowed(service, tab) { return CatalogConfig.services().some(function (s) { return s.id === service && s.enabled; }) && CatalogConfig.tabs(service).some(function (t) { return t.id === tab; }); }
  function valid(service, p) { return p && /^[1-9][0-9]{0,9}$/.test(p.id) && typeof p.title === 'string' && p.title.length <= 180 && (!p.poster || (service === 'kinopoisk' ? /^https:\/\/(?:kinopoiskapiunofficial\.tech|st\.kp\.yandex\.net|avatars\.mds\.yandex\.net|image\.openmoviedb\.com)\//.test(p.poster) : /^https:\/\/(?:[a-z0-9-]+\.)*dfs\.ivi\.ru\//.test(p.poster))) && (service !== 'ivi' || ['video', 'compilation'].indexOf(p.type) >= 0); }
  function fresh(value, service) { return value && !value.error && Date.now() - value.at < (service === 'kinopoisk' ? 21600000 : 3600000); }
  function save() {
    var entries = Object.keys(cache).sort(function (a, b) { return cache[b].at - cache[a].at; }).slice(0, 40), out = {}, kept = {};
    entries.forEach(function (key) { kept[key] = cache[key]; if (!cache[key].error) out[key] = cache[key]; }); cache = kept; try { localStorage.setItem(KEY, JSON.stringify(out)); } catch (e) {}
  }
  try {
    var saved = JSON.parse(localStorage.getItem(KEY));
    Object.keys(saved || {}).slice(0, 40).forEach(function (key) {
      var parts = key.split(':'), value = saved[key];
      if (['kinopoisk', 'ivi'].indexOf(parts[0]) >= 0 && CatalogConfig.definition(parts[0], parts[1]) && /^[1-9][0-9]?$/.test(parts[2]) && value && Array.isArray(value.items) && Date.now() - value.at < 21600000) cache[key] = {items: value.items.filter(function (p) { return valid(parts[0], p); }).slice(0, parts[0] === 'kinopoisk' ? 20 : 16), nextPage: Math.max(0, Math.min(50, Number(value.nextPage) || 0)), at: value.at};
    });
  } catch (e) {}
  function ensure(service, tab, page) {
    if (service === 'vokino' || tab === 'overview' || !allowed(service, tab)) return;
    if ((service === 'kinopoisk' && (!TopControls.kinopoiskApp() || !KinopoiskCatalog.hasKey())) || (service === 'ivi' && !TopControls.iviApp())) return;
    var key = cacheKey(service, tab, page), value = cache[key];
    if (fresh(value, service) || (value && value.error && Date.now() < value.retryAt) || running[key] || queue.some(function (job) { return job.key === key; })) return;
    queue.push({service: service, tab: tab, page: page, key: key, generation: generations[service]}); pump();
  }
  function pump() {
    while (active < 2 && queue.length) (function (job) {
      if (!allowed(job.service, job.tab) || job.generation !== generations[job.service] || (job.service === 'kinopoisk' && (!TopControls.kinopoiskApp() || !KinopoiskCatalog.hasKey())) || (job.service === 'ivi' && !TopControls.iviApp())) return;
      var definition = CatalogConfig.definition(job.service, job.tab), controller = new AbortController(); active++; running[job.key] = controller;
      var timer = setTimeout(function () { controller.abort(); }, 12000);
      Promise.resolve().then(function () { return job.service === 'kinopoisk' ? KinopoiskCatalog.collection(definition.type, job.page, controller.signal) : IviCatalog.collection(definition.category, job.page, controller.signal); })
        .then(function (value) { if (job.generation !== generations[job.service]) return; cache[job.key] = {items: value.items.filter(function (p) { return valid(job.service, p); }).slice(0, job.service === 'kinopoisk' ? 20 : 16), nextPage: value.nextPage, at: Date.now()}; save(); })
        .catch(function (e) { if (job.generation !== generations[job.service]) return; var old = cache[job.key]; cache[job.key] = {items: old && old.items || [], nextPage: old && old.nextPage || 0, at: Date.now(), retryAt: Date.now() + (e.status === 401 || e.status === 403 ? 86400000 : e.status === 402 ? 3600000 : 300000), error: e.message || 'Не удалось загрузить подборку'}; })
        .then(function () { clearTimeout(timer); active--; delete running[job.key]; emit(); pump(); });
    })(queue.shift());
  }
  function mix(groups) {
    var mixed = [], seen = {};
    for (var i = 0; i < 20; i++) groups.forEach(function (group) {
      var p = group[i], key = p && (p.type || '') + ':' + p.id;
      if (p && !seen[key]) { seen[key] = true; mixed.push(p); }
    });
    return mixed;
  }
  function picks(service, tab, page) {
    if (service === 'myshows') {
      var items = tab === 'overview' ? mix(CatalogConfig.tabs(service).filter(function (t) {
        return t.id !== 'overview';
      }).map(function (t) { return t.id === 'episodes' ? MyShowsCatalog.recentInOverview() : MyShowsCatalog.items(t.id); })) : MyShowsCatalog.items(tab);
      return items.slice((page - 1) * Prefs.cards(), page * Prefs.cards());
    }
    if (service === 'vokino') return Data.picks(tab === 'overview' ? null : 'vokino-' + tab).map(function (p) { return {id: p.id, title: p.title, poster: p.poster, meta: p.meta, app: p.app}; });
    if ((service === 'kinopoisk' && (!TopControls.kinopoiskApp() || !KinopoiskCatalog.hasKey())) || (service === 'ivi' && !TopControls.iviApp())) return [];
    if (tab === 'overview') {
      var groups = CatalogConfig.tabs(service).filter(function (t) { return t.id !== 'overview'; }).map(function (t) { ensure(service, t.id, 1); return (cache[cacheKey(service, t.id, 1)] || {}).items || []; });
      return mix(groups).slice((page - 1) * Prefs.cards(), page * Prefs.cards());
    }
    var count = Prefs.cards(), size = service === 'kinopoisk' ? 20 : 16, start = (page - 1) * count, sourcePage = Math.floor(start / size) + 1, offset = start % size;
    ensure(service, tab, sourcePage); var value = cache[cacheKey(service, tab, sourcePage)], items = value && value.items || [];
    if (offset + count > size && value && value.nextPage) { ensure(service, tab, sourcePage + 1); items = items.concat((cache[cacheKey(service, tab, sourcePage + 1)] || {}).items || []); }
    return items.slice(offset, offset + count);
  }
  function next(service, tab, page) {
    if (service === 'vokino') return VoKinoBridge.turnPage(tab === 'overview' ? null : 'vokino-' + tab, 1);
    if (tab === 'overview' || service === 'myshows') return picks(service, tab, page + 1).length > 0;
    var count = Prefs.cards(), size = service === 'kinopoisk' ? 20 : 16, end = page * count, sourcePage = Math.floor((end - 1) / size) + 1, value = cache[cacheKey(service, tab, sourcePage)];
    return !!value && (value.items.length > (end - 1) % size + 1 || !!value.nextPage);
  }
  function status(service, tab, page) {
    if (service === 'myshows') {
      var sources = tab === 'overview' ? CatalogConfig.tabs(service).filter(function (t) { return t.id !== 'overview'; }) : [{id: tab}];
      return sources.length ? MyShowsCatalog.status(sources[0].id) : 'Включите вкладки MyShows в настройках';
    }
    if (service === 'kinopoisk' && !TopControls.kinopoiskApp()) return 'Добавьте Кинопоиск в избранные приложения';
    if (service === 'kinopoisk' && !KinopoiskCatalog.hasKey()) return 'Добавьте ключ поиска Кинопоиска в настройках';
    if (service === 'ivi' && !TopControls.iviApp()) return 'Добавьте Иви в избранные приложения';
    if (service === 'vokino') return VoKinoBridge.inFlight ? 'Загружаем...' : VoKinoBridge.error ? 'Не удалось обновить VoKino' : 'В этой вкладке пока нет карточек';
    var sourcePage = Math.floor((page - 1) * Prefs.cards() / (service === 'kinopoisk' ? 20 : 16)) + 1;
    var key = cacheKey(service, tab, sourcePage), value = cache[key];
    if (running[key] || queue.some(function (j) { return j.key === key; })) return 'Загружаем...';
    if (tab === 'overview') { var sources = CatalogConfig.tabs(service).filter(function (t) { return t.id !== 'overview'; }); if (!sources.length) return 'Включите вкладки этого сервиса в настройках'; if (sources.some(function (t) { return running[cacheKey(service, t.id, 1)]; })) return 'Загружаем...'; var failed = sources.map(function (t) { return cache[cacheKey(service, t.id, 1)]; }).filter(function (v) { return v && v.error; }); if (failed.length) return failed[0].error; }
    return value && value.error || 'В этой вкладке пока нет карточек';
  }
  function reset(service) {
    if (['kinopoisk', 'ivi'].indexOf(service) < 0) return;
    generations[service]++; queue = queue.filter(function (job) { return job.service !== service; });
    Object.keys(cache).forEach(function (key) { if (key.indexOf(service + ':') === 0) delete cache[key]; });
    Object.keys(running).forEach(function (key) { if (key.indexOf(service + ':') === 0) running[key].abort(); }); save(); emit();
  }
  window.CatalogFeeds = {picks: picks, next: next, status: status, reset: reset, onChange: function (fn) { listeners.push(fn); }};
})();
