/* Separate catalogue search. The API key lives only in this TV app's private storage. */
(function () {
  'use strict';
  var KEY = 'fmtv.kinopoisk.key.v1', CACHE = 'fmtv.kinopoisk.search.v1';
  var HOST = 'https://kinopoiskapiunofficial.tech', seq = 0, abort = null;
  var state = {query: '', page: 1, items: [], nextPage: 0, loading: false, error: ''};
  function key() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function hasKey() { return /^[A-Za-z0-9_-]{16,256}$/.test(key()); }
  function filmDetails(id, signal) { return fetch(HOST + '/api/v2.2/films/' + id, {headers: {'X-API-KEY': key(), 'Accept': 'application/json'}, credentials: 'omit', redirect: 'error', signal: signal}).then(function (r) { if (!r.ok) throw new Error('Request failed'); return r.json(); }); }
  var availability = createKinopoiskAvailability(filmDetails);
  function poster(url) { return /^https:\/\/(?:kinopoiskapiunofficial\.tech|st\.kp\.yandex\.net|avatars\.mds\.yandex\.net|image\.openmoviedb\.com)\//.test(url || '') ? url : ''; }
  function normalize(row) {
    var id = String(row && row.filmId || ''), title = row && (row.nameRu || row.nameEn);
    if (!/^[1-9][0-9]{0,9}$/.test(id) || !title) return null;
    return {id: id, title: String(title).slice(0, 180), poster: poster(row.posterUrlPreview) || poster(row.posterUrl),
      meta: [row.year, row.type === 'TV_SERIES' || row.type === 'MINI_SERIES' ? 'Сериал' : row.type === 'TV_SHOW' ? 'ТВ-шоу' : 'Фильм', row.rating && row.rating !== 'null' ? 'Рейтинг ' + row.rating : '', 'Кинопоиск'].filter(function (v) { return !!v; }).join(' · ')};
  }
  function cancel() { seq++; if (abort) abort.abort(); abort = null; state.loading = false; state.opening = false; }
  function setKey(value) {
    value = String(value || '').replace(/\s+/g, '');
    if (value && !/^[A-Za-z0-9_-]{16,256}$/.test(value)) return false;
    cancel();
    availability.clear();
    try { if (value) localStorage.setItem(KEY, value); else localStorage.removeItem(KEY); localStorage.removeItem(CACHE); }
    catch (e) { return false; }
    state.query = ''; state.items = []; state.error = ''; state.page = 1; state.nextPage = 0;
    if (window.CatalogFeeds) CatalogFeeds.reset('kinopoisk'); return true;
  }
  function search(query, page, done) {
    cancel(); var mine = seq;
    query = String(query || '').replace(/[\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120).replace(/[\ud800-\udbff]$/, '');
    page = Math.max(1, Math.min(20, Math.floor(Number(page) || 1)));
    state.query = query; state.page = page; state.items = []; state.error = ''; state.nextPage = 0;
    if (query.length < 2) state.error = 'Введите минимум 2 символа.';
    else if (!hasKey()) state.error = 'Добавьте API-ключ в настройках поиска Кинопоиска.';
    else if (!TopControls.kinopoiskApp()) state.error = 'Добавьте Кинопоиск в избранные приложения.';
    if (state.error) { if (done) done(new Error(state.error), state); return; }
    state.loading = true; abort = new AbortController(); var controller = abort;
    var timer = setTimeout(function () { controller.abort(); }, 12000);
    fetch(HOST + '/api/v2.1/films/search-by-keyword?keyword=' + encodeURIComponent(query) + '&page=' + page,
      {headers: {'X-API-KEY': key(), 'Accept': 'application/json'}, credentials: 'omit', redirect: 'error', signal: controller.signal})
      .then(function (r) {
        if (r.status === 404) return {films: [], pagesCount: 0};
        if (!r.ok) { var error = new Error('Request failed'); error.status = r.status; throw error; }
        return r.json();
      }).then(function (data) {
        if (mine !== seq) return;
        var seen = {};
        state.items = (Array.isArray(data.films) ? data.films : []).map(normalize).filter(function (p) { if (!p || seen[p.id]) return false; seen[p.id] = true; return true; }).slice(0, 20);
        state.nextPage = page < Math.min(20, Number(data.pagesCount) || 0) ? page + 1 : 0;
        state.loading = false; abort = null;
        try { localStorage.setItem(CACHE, JSON.stringify({query: query, page: page, items: state.items, nextPage: state.nextPage, savedAt: Date.now()})); } catch (e) {}
        if (done) done(null, state);
      }).catch(function (e) {
        if (mine !== seq) return;
        abort = null; state.loading = false;
        state.error = e.status === 401 || e.status === 403 ? 'API-ключ не принят. Проверьте его в настройках поиска Кинопоиска.' :
          e.status === 402 ? 'Лимит запросов вашего API-ключа исчерпан. Попробуйте позже.' : e.status === 429 ? 'Слишком много запросов. Подождите немного.' : 'Не удалось выполнить поиск. Попробуйте еще раз.';
        if (done) done(new Error(state.error), state);
      }).then(function () { clearTimeout(timer); });
  }
  try {
    var saved = JSON.parse(localStorage.getItem(CACHE));
    if (hasKey() && saved && Date.now() - saved.savedAt < 86400000 && Array.isArray(saved.items)) {
      state.query = String(saved.query || '').slice(0, 120); state.page = Math.max(1, Math.min(20, Number(saved.page) || 1));
      state.nextPage = Number(saved.nextPage) === state.page + 1 && state.page < 20 ? state.page + 1 : 0;
      state.items = saved.items.filter(function (p) { return p && /^[1-9][0-9]{0,9}$/.test(p.id) && typeof p.title === 'string' && p.title.length <= 180; }).slice(0, 20).map(function (p) { return {id: p.id, title: p.title, meta: String(p.meta || '').slice(0, 180), poster: poster(p.poster)}; });
    }
  } catch (e) {}
  function launch(item, done) {
    var app = TopControls.kinopoiskApp();
    if (!app || !hasKey() || !/^[1-9][0-9]{0,9}$/.test(item.id)) { done(false); return; }
    cancel(); var mine = seq, controller = abort = new AbortController(); state.opening = true;
    var timer = setTimeout(function () { controller.abort(); }, 12000);
    (availability.hdId(item.id) ? Promise.resolve({kinopoiskHDId: availability.hdId(item.id)}) : filmDetails(item.id, controller.signal))
      .then(function (data) {
        if (mine !== seq) return;
        clearTimeout(timer); abort = null;
        if (!/^[a-f0-9]{32}$/.test(data.kinopoiskHDId || '')) { state.opening = false; done(false, 'У этого фильма нет ссылки на карточку в ТВ-приложении Кинопоиска.'); return; }
        if (app !== TopControls.kinopoiskApp()) { state.opening = false; done(false); return; }
        VoKinoBridge.launchWithReturn(app, function () {
          function finish(ok) { state.opening = false; if (!ok) VoKinoBridge.cancelReturn(); done(ok); }
          if (mine !== seq || app !== TopControls.kinopoiskApp()) { finish(false); return; }
          try {
            var payload = new tizen.ApplicationControlData('PAYLOAD', [JSON.stringify({values: JSON.stringify({filmId: data.kinopoiskHDId})})]);
            tizen.application.launchAppControl(new tizen.ApplicationControl('http://samsung.com/appcontrol/operation/eden_resume', null, null, null, [payload]), app, function () { finish(true); }, function () { finish(false); });
          } catch (e) { finish(false); }
        });
      }).catch(function () { if (mine === seq) { abort = null; state.opening = false; done(false, 'Не удалось получить ссылку на фильм. Попробуйте еще раз.'); } })
      .then(function () { clearTimeout(timer); });
  }
  var modal, field, status, controls, cursor = 0, origin = 'settings', keyOpen = false;
  function node(tag, cls, parent, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; if (parent) parent.appendChild(e); return e; }
  function touch() { if (window.FreeMyTV) FreeMyTV.poke(); }
  function paintKey() {
    modal.classList.toggle('search-editing', document.activeElement === field || window.innerHeight < 800);
    controls.forEach(function (e, i) { e.classList.toggle('search-focus', cursor === i); });
  }
  function closeKey(restore) {
    if (!keyOpen) return;
    keyOpen = false; field.value = ''; field.blur(); modal.classList.remove('open');
    if (restore !== false) {
      if (origin === 'settings') FreeMyTV.showKinopoiskSettings();
      else { FreeMyTV.state.zone = 'top'; FreeMyTV.state.top = VoKinoSections.tabs().length + 4; FreeMyTV.move(0, 0); }
    }
    window.dispatchEvent(new Event('resize'));
  }
  function activateKey() {
    touch();
    if (!cursor) { field.focus(); return; }
    if (cursor === 2) {
      if (!setKey('')) { status.textContent = 'Не удалось удалить ключ.'; return; }
      closeKey(); return;
    }
    if (!field.value.trim()) { cursor = 0; field.focus(); paintKey(); return; }
    if (!setKey(field.value)) { status.textContent = 'Не удалось сохранить. Проверьте API-ключ.'; return; }
    closeKey(false); KinopoiskSearch.open();
  }
  function openKey(from) {
    if (!TopControls.kinopoiskApp()) return;
    origin = from === 'search' ? 'search' : 'settings';
    if (!modal) {
      modal = node('div', 'layer sheet movie-search', document.getElementById('stage')); modal.id = 'kinopoisk-key';
      modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'kinopoisk-key-title');
      var box = node('div', 'box', modal), title = node('h2', 'search-title', box, 'Ключ поиска Кинопоиска'); title.id = 'kinopoisk-key-title';
      var label = node('label', 'search-label', box, 'API-ключ Kinopoisk API Unofficial'); label.htmlFor = 'kinopoisk-key-value';
      var form = node('div', 'search-form', box);
      field = node('input', 'search-query', form); field.id = 'kinopoisk-key-value'; field.type = 'password'; field.maxLength = 256;
      ['autocorrect', 'autocapitalize', 'autocomplete'].forEach(function (name) { field.setAttribute(name, name === 'autocapitalize' ? 'none' : 'off'); }); field.setAttribute('spellcheck', 'false');
      var save = node('button', 'search-submit', form, 'Сохранить'); save.type = 'button'; save.onclick = function () { cursor = 1; activateKey(); };
      status = node('div', 'search-status', box); status.setAttribute('aria-live', 'polite');
      var remove = node('button', 'search-page', box, 'Удалить ключ'); remove.type = 'button'; remove.onclick = function () { cursor = 2; activateKey(); };
      node('div', 'search-hint', box, 'Получите ключ в профиле kinopoiskapiunofficial.tech.');
      node('div', 'search-hint', box, 'Ключ сохраняется на этом телевизоре. Back - закрыть.');
      controls = [field, save, remove]; field.onfocus = function () { cursor = 0; paintKey(); touch(); }; field.onblur = paintKey;
    }
    FreeMyTV.hideSaver(); document.getElementById('settings').classList.remove('open'); touch(); keyOpen = true; cursor = 0; field.value = ''; status.textContent = hasKey() ? 'Ключ уже сохранен. Для замены введите новый.' : 'Введите ключ, чтобы искать фильмы и сериалы.';
    controls[2].hidden = !hasKey(); FreeMyTV.state.zone = 'kinopoisk-key'; modal.classList.add('open'); paintKey(); window.dispatchEvent(new Event('resize'));
    setTimeout(function () { if (keyOpen) field.focus(); }, 50);
  }
  document.addEventListener('keydown', function (e) {
    if (!keyOpen) return;
    e.stopImmediatePropagation(); touch();
    var code = e.keyCode, editing = document.activeElement === field, back = code === 10009 || code === 27 || code === 65385;
    if (editing) {
      if (code === 13 || code === 65376 || code === 38 || code === 40 || back) { e.preventDefault(); field.blur(); cursor = back ? 0 : 1; paintKey(); }
      return;
    }
    if (back || code === 8) { e.preventDefault(); closeKey(); }
    else if (code === 13 || code === 65376) { e.preventDefault(); activateKey(); }
    else if (code >= 37 && code <= 40) { e.preventDefault(); cursor = Math.max(0, Math.min(hasKey() ? 2 : 1, cursor + (code === 37 || code === 38 ? -1 : 1))); paintKey(); }
  }, true);
  window.addEventListener('resize', function () { if (keyOpen) paintKey(); });
  function collection(type, page, signal) {
    if (!hasKey() || ['TOP_POPULAR_ALL', 'TOP_POPULAR_MOVIES', 'POPULAR_SERIES', 'TOP_250_MOVIES', 'FAMILY', 'KIDS_ANIMATION_THEME', 'CLOSES_RELEASES'].indexOf(type) < 0) return Promise.reject(new Error('Добавьте ключ поиска Кинопоиска в настройках'));
    page = Math.max(1, Math.min(50, Number(page) || 1));
    return fetch(HOST + '/api/v2.2/films/collections?type=' + encodeURIComponent(type) + '&page=' + page, {headers: {'X-API-KEY': key(), 'Accept': 'application/json'}, credentials: 'omit', redirect: 'error', signal: signal})
      .then(function (r) { if (!r.ok) { var error = new Error(r.status === 401 || r.status === 403 ? 'Проверьте ключ Кинопоиска' : r.status === 402 ? 'Лимит API Кинопоиска исчерпан' : 'Не удалось загрузить подборку'); error.status = r.status; throw error; } return r.json(); })
      .then(function (data) { if (!Array.isArray(data.items)) throw new Error('Подборка недоступна'); return {items: data.items.map(function (r) { return normalize({filmId: r.kinopoiskId, nameRu: r.nameRu, nameEn: r.nameEn, posterUrlPreview: r.posterUrlPreview, posterUrl: r.posterUrl, type: r.type, year: r.year, rating: r.ratingKinopoisk}); }).filter(function (p) { return !!p; }), nextPage: page < Math.min(50, Number(data.totalPages) || 0) ? page + 1 : 0}; });
  }
  window.KinopoiskCatalog = {searchState: state, search: search, cancelSearch: cancel, hasKey: hasKey, setKey: setKey, openKey: openKey, closeKey: closeKey, collection: collection, launch: launch};
  window.KinopoiskSearch = createMovieSearch({bridge: KinopoiskCatalog, id: 'kinopoisk-search', name: 'Кинопоиска', where: 'Кинопоиске', appName: 'Кинопоиск', slot: 4,
    annotation: availability.annotation, visible: availability.visible,
    image: function (p) { return p.poster; }, launch: launch,
    allowed: function () { if (!TopControls.kinopoiskApp()) return false; if (!hasKey()) { openKey('search'); return false; } return true; }});
})();
