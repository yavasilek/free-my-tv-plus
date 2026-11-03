/* Anonymous search through Ivi's public web catalogue; no account/session transfer. */
(function () {
  'use strict';
  var CACHE = 'fmtv.ivi.search.v1', seq = 0, abort = null;
  var state = {query: '', page: 1, nextPage: 0, items: [], loading: false, error: ''};
  function image(url) { return /^https:\/\/(?:[a-z0-9-]+\.)*dfs\.ivi\.ru\//.test(url || '') ? url : ''; }
  function valid(p) { return p && /^[1-9][0-9]{0,9}$/.test(p.id) && ['video', 'compilation'].indexOf(p.type) >= 0 && typeof p.title === 'string'; }
  function normalize(row) {
    if (!row || ['video', 'compilation'].indexOf(row.object_type) < 0 || !row.title || !/^[1-9][0-9]{0,9}$/.test(String(row.id))) return null;
    var posters = Array.isArray(row.posters) ? row.posters : [], cover = posters.filter(function (p) { return p.type === 'poster-vertical'; })[0] || posters[0];
    return {id: String(row.id), type: row.object_type, title: String(row.title).slice(0, 180), poster: image(cover && cover.url),
      meta: [row.year, row.object_type === 'compilation' ? 'Сериал' : 'Фильм', row.kp_rating ? 'Рейтинг ' + row.kp_rating : '', 'Иви'].filter(function (v) { return !!v; }).join(' · ')};
  }
  function cancel() { seq++; if (abort) abort.abort(); abort = null; state.loading = false; }
  function search(query, page, done) {
    cancel(); var mine = seq;
    query = String(query || '').replace(/[\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120).replace(/[\ud800-\udbff]$/, '');
    page = Math.max(1, Math.min(50, Math.floor(Number(page) || 1)));
    state.query = query; state.page = page; state.items = []; state.nextPage = 0; state.error = '';
    if (query.length < 2) state.error = 'Введите минимум 2 символа.';
    else if (!TopControls.iviApp()) state.error = 'Добавьте Иви в избранные приложения.';
    if (state.error) { if (done) done(new Error(state.error), state); return; }
    state.loading = true; var controller = abort = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 12000);
    var from = (page - 1) * 20;
    var url = 'https://api2.ivi.ru/mobileapi/livesearch/v7/?query=' + encodeURIComponent(query) + '&subsite=353&app_version=870&object_type=content&from=' + from + '&to=' + (from + 20) + '&fields=id,title,year,kind,object_type,posters,kp_rating';
    fetch(url, {credentials: 'omit', redirect: 'error', signal: controller.signal})
      .then(function (r) { if (!r.ok) throw new Error('Request failed'); return r.json(); })
      .then(function (data) {
        if (mine !== seq) return;
        if (data.error || !Array.isArray(data.result)) throw new Error('Invalid response');
        var seen = {};
        state.items = data.result.slice(0, 20).map(normalize).filter(function (p) { if (!p || seen[p.type + p.id]) return false; seen[p.type + p.id] = true; return true; });
        state.nextPage = data.result.length > 20 && page < 50 ? page + 1 : 0;
        state.loading = false; abort = null;
        try { localStorage.setItem(CACHE, JSON.stringify({query: query, page: page, nextPage: state.nextPage, items: state.items, savedAt: Date.now()})); } catch (e) {}
        if (done) done(null, state);
      }).catch(function () { if (mine !== seq) return; abort = null; state.loading = false; state.error = 'Не удалось выполнить поиск в Иви. Попробуйте еще раз.'; if (done) done(new Error(state.error), state); })
      .then(function () { clearTimeout(timer); });
  }
  try {
    var saved = JSON.parse(localStorage.getItem(CACHE));
    if (saved && Date.now() - saved.savedAt < 86400000 && Array.isArray(saved.items)) {
      state.query = String(saved.query || '').slice(0, 120); state.page = Math.max(1, Math.min(50, Number(saved.page) || 1));
      state.nextPage = Number(saved.nextPage) === state.page + 1 && state.page < 50 ? state.page + 1 : 0;
      state.items = saved.items.filter(valid).slice(0, 20).map(function (p) { return {id: p.id, type: p.type, title: p.title.slice(0, 180), poster: image(p.poster), meta: String(p.meta || '').slice(0, 180)}; });
    }
  } catch (e) {}
  function launch(item, done) {
    var app = TopControls.iviApp(); if (!app || !valid(item)) { done(false); return; }
    VoKinoBridge.launchWithReturn(app, function () {
      function finish(ok) { if (!ok) VoKinoBridge.cancelReturn(); done(ok); }
      if (app !== TopControls.iviApp()) { finish(false); return; }
      try {
        var action = {action: item.type === 'compilation' ? '/compilation/open' : '/movie/open', action_params: {id: Number(item.id)}, g_source: 'free_my_tv'};
        var uri = 'http://tizen.ivi.ru/?titleid=' + encodeURIComponent(JSON.stringify(action));
        var payload = new tizen.ApplicationControlData('PAYLOAD', [JSON.stringify({values: uri})]);
        tizen.application.launchAppControl(new tizen.ApplicationControl('http://samsung.com/appcontrol/operation/eden_resume', null, null, null, [payload]), app, function () { finish(true); }, function () { finish(false); });
      } catch (e) { finish(false); }
    });
  }
  function collection(category, page, signal) {
    if ([14, 15, 17].indexOf(category) < 0) return Promise.reject(new Error('Неизвестная категория Иви'));
    page = Math.max(1, Math.min(50, Number(page) || 1)); var from = (page - 1) * 16;
    var url = 'https://www.ivi.ru/mobileapi/catalogue/v7/?subsite=353&app_version=870&category=' + category + '&from=' + from + '&to=' + (from + 16) + '&fields=id,title,object_type,posters,year,kp_rating';
    return fetch(url, {credentials: 'omit', redirect: 'error', signal: signal}).then(function (r) { if (!r.ok) throw new Error('Не удалось загрузить Иви'); return r.json(); }).then(function (data) { if (data.error || !Array.isArray(data.result)) throw new Error('Подборка Иви недоступна'); return {items: data.result.slice(0, 16).map(normalize).filter(function (p) { return !!p; }), nextPage: data.result.length > 16 && page < 50 ? page + 1 : 0}; }).catch(function () { throw new Error('Не удалось загрузить подборку Иви'); });
  }
  window.IviCatalog = {searchState: state, search: search, cancelSearch: cancel, collection: collection, launch: launch};
  window.IviSearch = createMovieSearch({bridge: IviCatalog, id: 'ivi-search', name: 'Иви', slot: 5, image: function (p) { return /\.(?:jpe?g|png|webp)$/.test(p.poster) ? p.poster + '/156x240/?q=75' : p.poster; }, launch: launch, allowed: function () { return !!TopControls.iviApp(); }});
})();
