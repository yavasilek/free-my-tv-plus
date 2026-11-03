/* One query across the selected providers, with independent results and cancellation. */
(function () {
  'use strict';
  var KEY = 'fmtv.combined-search.v1', saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
  var enabled = saved.enabled !== false, selected = {};
  var sources = [
    {id: 'vokino', name: 'VoKino', api: VoKinoBridge, available: VoKinoBridge.hasVoKino,
      image: function (p) { return Data.image(p.poster || p.backdrop, 'w300'); },
      launch: function (p, done) { TV.launch(p.app, null, done); }},
    {id: 'kinopoisk', name: 'Кинопоиск', api: KinopoiskCatalog,
      available: function () { return !!TopControls.kinopoiskApp() && KinopoiskCatalog.hasKey(); },
      image: function (p) { return p.poster; }, launch: KinopoiskCatalog.launch},
    {id: 'ivi', name: 'Иви', api: IviCatalog, available: TopControls.iviApp,
      image: IviCatalog.image, launch: IviCatalog.launch}
  ];
  sources.forEach(function (source) { selected[source.id] = !saved.sources || saved.sources[source.id] !== false; });
  var state = {query: '', page: 1, items: [], nextPage: 0, loading: false, opening: false, error: '', retry: false};
  var plans = {}, progress = {}, running = [], generation = 0, view, origin = null;

  function cancel() {
    generation++;
    running.forEach(function (source) {
      source.api.cancelSearch();
      progress[source.id] = 'прервано';
    });
    if (state.opening) KinopoiskCatalog.cancelSearch();
    state.retry = state.retry || !!running.length;
    running = []; state.loading = false; state.opening = false;
  }

  function search(query, page, done) {
    cancel();
    query = String(query || '').replace(/[\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120).replace(/[\ud800-\udbff]$/, '');
    if (query !== state.query) plans = {};
    state.query = query; state.page = page; state.items = []; state.nextPage = 0;
    state.error = ''; state.retry = false; progress = {};
    if (query.length < 2) { done(); return; }
    if (!plans[1]) {
      plans[1] = {};
      sources.forEach(function (source) { if (selected[source.id]) plans[1][source.id] = 1; });
    }
    var plan = plans[page] || {}, next = {}, groups = {}, request = generation;
    running = sources.filter(function (source) {
      if (!selected[source.id]) return false;
      if (!source.available()) {
        progress[source.id] = source.id === 'kinopoisk' && TopControls.kinopoiskApp() ? 'нужен API-ключ' : 'добавьте в избранное';
        return false;
      }
      if (!plan[source.id]) { progress[source.id] = 'больше нет'; return false; }
      progress[source.id] = 'поиск…';
      return true;
    });
    state.loading = !!running.length;
    if (!state.loading) { done(); return; }
    running.slice().forEach(function (source) {
      source.api.search(query, plan[source.id], function (error, result) {
        if (request !== generation) return;
        running = running.filter(function (pending) { return pending !== source; });
        if (error) {
          progress[source.id] = 'ошибка';
          state.retry = true;
        } else {
          progress[source.id] = String(result.items.length);
          groups[source.id] = result.items.map(function (item) {
            return {source: source, item: item, title: item.title, meta: item.meta};
          });
          var mixed = [];
          for (var i = 0; i < 20; i++) sources.forEach(function (provider) {
            var group = groups[provider.id];
            if (group && group[i]) mixed.push(group[i]);
          });
          state.items = mixed;
          if (result.nextPage) next[source.id] = result.nextPage;
        }
        state.loading = !!running.length;
        if (!state.loading) {
          if (page < 50 && Object.keys(next).length) { plans[page + 1] = next; state.nextPage = page + 1; }
          else delete plans[page + 1];
        }
        done();
      }, {});
    });
  }

  function status() {
    if (state.error) return state.error;
    var labels = sources.filter(function (source) { return progress[source.id]; }).map(function (source) {
      return source.name + ' · ' + progress[source.id];
    });
    return labels.length ? labels.join('    /    ') : 'Выберите сервисы в настройках общего поиска.';
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({enabled: enabled, sources: selected})); } catch (e) {}
    cancel(); plans = {}; progress = {};
    state.items = []; state.page = 1; state.nextPage = 0; state.retry = true;
    if (window.FreeMyTV) FreeMyTV.refreshTopControls();
  }

  function selection() {
    var position = view.selection();
    if (!position) return null;
    var result = state.items[position.cursor];
    return {query: state.query, page: state.page, plans: plans, cursor: position.cursor, origin: origin,
      source: result ? result.source.id : '', id: result ? result.item.id : '', type: result ? result.item.type : ''};
  }

  function restore(value) {
    if (!value || (!enabled && !value.origin) || typeof value.query !== 'string') return;
    origin = value.origin || null;
    function index() {
      return state.items.findIndex(function (result) {
        return result.source.id === value.source && result.item.id === value.id && result.item.type === value.type;
      });
    }
    var at = index();
    if (state.query === value.query && state.page === value.page && at >= 0) { view.restore({cursor: at}); return; }
    state.query = value.query;
    plans = {};
    for (var page = 1; value.plans && page <= 50 && value.plans[page]; page++) {
      var plan = plans[page] = {};
      sources.forEach(function (source) {
        var n = Number(value.plans[page][source.id]);
        if (Number.isInteger(n) && n > 0 && n <= 9999) plan[source.id] = n;
      });
    }
    view.restore({cursor: -1});
    var restored = false;
    search(value.query, Math.max(1, Math.min(50, Number(value.page) || 1)), function () {
      if (!view.isOpen()) return;
      var found = index();
      if (!restored && found >= 0) { restored = true; view.restore({cursor: found}); }
      else view.refresh();
    });
  }

  view = createMovieSearch({bridge: {searchState: state, search: search, cancelSearch: cancel},
    id: 'combined-search', name: 'Общий поиск', title: 'Общий поиск', where: 'выбранных сервисах', slot: 6,
    incremental: true, status: status, allowed: function () { return enabled; },
    returnTo: function () {
      if (!origin || !window.CatalogHome) return false;
      var previous = origin; origin = null; CatalogHome.restore(previous); return true;
    },
    image: function (result) { return result.source.image(result.item); },
    launch: function (result, done) {
      if (!result.source.available()) { done(false, 'Сервис сейчас недоступен. Проверьте настройки поиска.'); return; }
      state.error = ''; state.opening = true;
      var request = generation;
      result.source.launch(result.item, function (ok, error) {
        if (request !== generation) return;
        state.opening = false; done(ok, error || 'Не удалось открыть карточку в ' + result.source.name + '.'); view.refresh();
      });
    },
    annotation: function (result) { return result.source.id === 'kinopoisk' ? KinopoiskCatalog.availability.annotation(result.item) : null; },
    visible: function (results, paint) { KinopoiskCatalog.availability.visible(results.filter(function (r) { return r.source.id === 'kinopoisk'; }).map(function (r) { return r.item; }), paint); }
  });

  window.CombinedSearch = {open: function () {
      origin = null; view.open();
      if (view.isOpen() && state.retry && state.query.length >= 2) search(state.query, 1, view.refresh);
    }, close: view.close, isOpen: view.isOpen, selection: selection, restore: restore,
    openForTitle: function (title, previous) { origin = previous; view.openQuery(title); },
    enabled: function () { return enabled; },
    settings: function () {
      var rows = [{label: 'Кнопка «Общий поиск»', toggle: enabled, step: function () { enabled = !enabled; save(); }}];
      if (enabled) sources.forEach(function (source) {
        rows.push({label: 'Общий поиск · ' + source.name, toggle: selected[source.id], step: function () {
          selected[source.id] = !selected[source.id]; save();
        }});
      });
      return rows;
    }
  };
})();
