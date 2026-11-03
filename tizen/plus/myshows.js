/* Public MyShows rankings and profile lists. No account credentials are needed. */
(function () {
  'use strict';
  var KEY = 'fmtv.myshows.profile.v1', RPC = 'https://api.myshows.ru/v2/rpc/';
  var login = '', listeners = [], ttl = 15 * 60000;
  var tabs = {watching: true, later: true, finished: true};
  try { login = localStorage.getItem(KEY) || ''; } catch (e) {}
  function feed() { return {items: {}, loading: false, error: '', at: 0}; }
  var top = feed(), profile = feed();
  function emit() { listeners.forEach(function (fn) { fn(); }); }
  function rpc(method, params) {
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 12000);
    return fetch(RPC, {method: 'POST', credentials: 'omit', redirect: 'error', signal: controller.signal,
      headers: {'Content-Type': 'application/json', 'Accept-Language': 'ru'},
      body: JSON.stringify({jsonrpc: '2.0', method: method, params: params, id: 1})})
      .then(function (r) { if (!r.ok) throw new Error('Ошибка MyShows'); return r.json(); })
      .then(function (data) {
        var valid = method === 'shows.GetById' ? data.result && Number(data.result.id) === params.showId : Array.isArray(data.result);
        if (data.error || !valid) {
          var code = data.error && Number(data.error.code);
          throw new Error(code === 403 || code === 401 ? 'Профиль закрыт. Нужен открытый профиль MyShows.' :
            code === 404 ? 'Профиль MyShows не найден. Проверьте имя.' : 'MyShows временно недоступен.');
        }
        return data.result;
      }).then(function (result) { clearTimeout(timer); return result; }, function (error) {
        clearTimeout(timer);
        if (error.name === 'AbortError' || error.name === 'TypeError') throw new Error('MyShows временно недоступен.');
        throw error;
      });
  }
  var mediaRetryAt = 0, posterCache = new Map(), pendingPosters = {}, posterQueue = [], posterRequests = 0;

  function pumpPosters() {
    while (posterRequests < 2 && posterQueue.length) (function (job) {
      posterRequests++;
      rpc('shows.GetById', {showId: Number(job.id), withEpisodes: false})
        .then(function (show) {
          var id = String(show.kinopoiskId || '');
          return /^[1-9][0-9]{0,9}$/.test(id) ? 'https://st.kp.yandex.net/images/film_iphone/iphone360_' + id + '.jpg' : '';
        }).catch(function () { return ''; }).then(function (url) {
          if (posterCache.size >= 128) posterCache.delete(posterCache.keys().next().value);
          posterCache.set(job.id, {url: url, retryAt: Date.now() + 120000});
          delete pendingPosters[job.id]; posterRequests--;
          job.resolve(url); pumpPosters();
        });
    })(posterQueue.shift());
  }

  function fallbackPoster(id) {
    var cached = posterCache.get(id);
    if (cached && (cached.url || Date.now() < cached.retryAt)) return Promise.resolve(cached.url);
    if (pendingPosters[id]) return pendingPosters[id];
    var promise = new Promise(function (resolve) { posterQueue.push({id: id, resolve: resolve}); });
    pendingPosters[id] = promise; pumpPosters(); return promise;
  }

  function loadPoster(img, item) {
    function hide() { img.style.opacity = '0'; }
    function fallback() {
      img.onload = null; img.onerror = null; img.removeAttribute('src');
      fallbackPoster(item.id).then(function (url) {
        if (!document.documentElement.contains(img)) return;
        if (!url) { hide(); return; }
        img.onerror = hide; img.src = url;
      });
    }
    var cached = posterCache.get(item.id);
    if (!item.poster || Date.now() < mediaRetryAt || (cached && cached.url)) { fallback(); return; }
    var timeout = setTimeout(function () {
      // A stalled host also affects the next covers scrolled into view.
      mediaRetryAt = Date.now() + 300000; fallback();
    }, 3000);
    img.onload = function () { clearTimeout(timeout); img.onload = null; img.onerror = null; };
    img.onerror = function () { clearTimeout(timeout); fallback(); };
    img.src = item.poster;
  }

  function item(entry, personal) {
    var show = entry && entry.show;
    if (!show || !/^[1-9][0-9]{0,9}$/.test(String(show.id)) || !(show.title || show.titleOriginal)) return null;
    var year = Number(show.year), rating = Number(show.rating), watched = Number(entry.watchedEpisodes), total = Number(entry.totalEpisodes);
    return {id: String(show.id), title: String(show.title || show.titleOriginal).slice(0, 180),
      poster: /^https:\/\/media\.myshows\.me\/shows\//.test(show.image || '') ? show.image : '',
      meta: [personal && Number.isInteger(watched) && Number.isInteger(total) && total > 0 && watched >= 0 ?
        watched + '/' + total + ' серий' : rating > 0 && rating <= 5 ? rating.toFixed(1).replace('.', ',') + ' / 5' : '',
        year >= 1900 && year <= 2200 ? year : ''].filter(Boolean).join(' · ')};
  }
  function classify(rows, personal) {
    var groups = {popular: [], watching: [], later: [], finished: []}, seen = {};
    rows.forEach(function (entry) {
      var tab = personal ? entry && entry.watchStatus : 'popular';
      if (personal && !Object.prototype.hasOwnProperty.call(tabs, tab)) return;
      var card = item(entry, personal), key = card && tab + ':' + card.id;
      if (card && !seen[key]) { groups[tab].push(card); seen[key] = true; }
    });
    return groups;
  }
  function load(tab) {
    var publicTab = tab === 'popular', current = publicTab ? top : profile;
    if ((!publicTab && !login) || current.loading || Date.now() - current.at < (current.error ? 120000 : ttl)) return current;
    current.loading = true;
    rpc(publicTab ? 'shows.Top' : 'profile.Shows', publicTab ? {count: 100} : {login: login})
      .then(function (rows) { current.items = classify(rows, !publicTab); current.error = ''; })
      .catch(function (error) { current.error = error.message; })
      .then(function () { current.at = Date.now(); current.loading = false; emit(); });
    return current;
  }
  function status(tab) {
    if (tab !== 'popular' && !login) return 'Укажите имя в Настройки → Профиль MyShows';
    var current = load(tab);
    return current.loading ? 'Загружаем MyShows…' : current.error || 'В этом списке пока нет сериалов';
  }
  function applyProfile(value, rows) {
    try { if (value) localStorage.setItem(KEY, value); else localStorage.removeItem(KEY); }
    catch (e) { throw new Error('Не удалось сохранить профиль на телевизоре.'); }
    login = value; profile = feed();
    if (value) { profile.items = classify(rows, true); profile.at = Date.now(); }
    emit();
  }

  var modal, input, button, hint, opened = false, busy = false, request = 0;
  var profileHint = 'Чтобы отключить профиль, оставьте поле пустым и сохраните.';
  function node(tag, cls, parent, label) {
    var e = document.createElement(tag); e.className = cls;
    if (label) e.textContent = label;
    parent.appendChild(e); return e;
  }
  function paint() {
    var editing = document.activeElement === input;
    modal.classList.toggle('search-editing', editing || window.innerHeight < window.innerWidth * 800 / 1920);
    input.classList.toggle('search-focus', editing);
    button.classList.toggle('search-focus', !editing);
  }
  function close(restore) {
    if (!opened) return;
    opened = false; busy = false; request++; input.blur(); modal.classList.remove('open');
    if (restore !== false) FreeMyTV.showMyShowsSettings();
    window.dispatchEvent(new Event('resize'));
  }
  function save() {
    if (busy) return;
    var value = input.value.trim();
    if (value && !/^[A-Za-z0-9_.-]{1,64}$/.test(value)) { hint.textContent = 'Введите имя профиля латиницей, без ссылки.'; return; }
    input.blur(); busy = true; button.disabled = true; var mine = ++request;
    hint.textContent = value ? 'Проверяем открытый профиль…' : 'Отключаем профиль…';
    (value ? rpc('profile.Shows', {login: value}) : Promise.resolve([])).then(function (rows) {
      if (mine !== request) return;
      applyProfile(value, rows); close();
    }).catch(function (error) {
      if (mine !== request) return;
      busy = false; button.disabled = false; hint.textContent = error.message;
    });
  }
  function open() {
    if (!modal) {
      modal = node('div', 'layer sheet movie-search', document.getElementById('stage')); modal.id = 'myshows-profile';
      modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'myshows-profile-title');
      var box = node('div', 'box', modal);
      node('h2', 'search-title', box, 'Профиль MyShows').id = 'myshows-profile-title';
      node('label', 'search-label', box, 'Имя открытого профиля').htmlFor = 'myshows-profile-login';
      var form = node('div', 'search-form', box);
      input = node('input', 'search-query', form); input.id = 'myshows-profile-login'; input.maxLength = 64;
      input.setAttribute('autocomplete', 'off'); input.setAttribute('spellcheck', 'false'); input.onfocus = input.onblur = paint;
      input.oninput = function () { if (!busy) hint.textContent = profileHint; };
      button = node('button', 'search-submit', form, 'Сохранить'); button.type = 'button'; button.onclick = save;
      hint = node('div', 'search-status', box); hint.setAttribute('aria-live', 'polite');
    }
    FreeMyTV.hideSaver(); FreeMyTV.hideAmbient(); FreeMyTV.poke();
    document.getElementById('settings').classList.remove('open');
    opened = true; button.disabled = false; input.value = login;
    hint.textContent = profileHint;
    FreeMyTV.state.zone = 'myshows-profile'; modal.classList.add('open');
    window.dispatchEvent(new Event('resize')); paint();
    setTimeout(function () { if (opened) input.focus(); }, 50);
  }
  document.addEventListener('keydown', function (event) {
    if (!opened) return;
    event.stopImmediatePropagation(); FreeMyTV.poke();
    var key = event.keyCode, editing = document.activeElement === input;
    var back = key === 10009 || key === 27 || key === 65385;
    if (editing && (back || key === 13 || key === 65376 || key === 40)) { event.preventDefault(); input.blur(); }
    else if (!editing && (back || key === 8)) { event.preventDefault(); close(); }
    else if (!editing && (key === 13 || key === 65376) && !busy) { event.preventDefault(); save(); }
    else if (!editing && (key === 37 || key === 38) && !busy) { event.preventDefault(); input.focus(); }
  }, true);
  window.addEventListener('resize', function () { if (opened) paint(); });
  window.MyShowsCatalog = {
    items: function (tab) { return load(tab).items[tab] || []; },
    loadPoster: loadPoster, status: status, onChange: function (fn) { listeners.push(fn); },
    profile: function () { return login; }, open: open, close: close
  };
})();
