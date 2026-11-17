/* Public MyShows rankings and profile lists. No account credentials are needed. */
(function () {
  'use strict';
  var KEY = 'fmtv.myshows.profile.v1', RPC = 'https://api.myshows.ru/v2/rpc/';
  var login = '', listeners = [], ttl = 15 * 60000;
  var tabs = {watching: true, later: true};
  try { login = localStorage.getItem(KEY) || ''; } catch (e) {}
  function feed() { return {items: {}, loading: false, error: '', at: 0}; }
  var top = feed(), profile = feed();
  function emit() { listeners.forEach(function (fn) { fn(); }); }
  function bridge() {
    try {
      var value = JSON.parse(localStorage.getItem('fmtv.myshows.catalog.v1'));
      if (!value || !/^[a-zA-Z0-9_-]{32,128}$/.test(value.key)) return null;
      var url = new URL(value.url);
      var local = /^(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2[0-9]|3[01]))(?:\.\d{1,3}){2}$|^[a-z0-9-]+\.local$/i;
      if (/^https?:$/.test(url.protocol) && local.test(url.hostname) && url.pathname === '/' &&
          !url.username && !url.password && !url.search && !url.hash) return {url: url.origin, key: value.key};
    } catch (e) {}
    return null;
  }
  function accountRequest(task, params, method, payload) {
    var connection = bridge();
    if (!connection) return Promise.reject(new Error('Подключите помощник MyShows в Home Assistant'));
    var url = new URL('/myshows/' + task, connection.url);
    url.searchParams.set('login', login);
    Object.keys(params).forEach(function (key) { url.searchParams.set(key, params[key]); });
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 25000);
    var options = {method: method || 'GET', credentials: 'omit', redirect: 'error',
      headers: {Authorization: 'Bearer ' + connection.key}, signal: controller.signal};
    if (payload) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(payload);
    }
    return fetch(url.href, options)
      .then(function (response) {
        if (!response.ok) return response.json().catch(function () { return {}; }).then(function (body) {
          throw new Error(body.error === 'login-required' ? 'Войдите в MyShows в помощнике Home Assistant' : 'Помощник MyShows не смог обновить список');
        });
        return task === 'poster' ? response.blob() : response.json();
      }).then(function (body) { clearTimeout(timer); return task === 'poster' ? body : body.result; }, function (error) { clearTimeout(timer); throw error; });
  }
  function requestRpc(body) {
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 12000);
    return fetch(RPC, {method: 'POST', credentials: 'omit', redirect: 'error', signal: controller.signal,
      headers: {'Content-Type': 'application/json', 'Accept-Language': 'ru'},
      body: JSON.stringify(body)})
      .then(function (r) { if (!r.ok) throw new Error('Ошибка MyShows'); return r.json(); })
      .then(function (result) { clearTimeout(timer); return result; }, function (error) {
        clearTimeout(timer);
        if (error.name === 'AbortError' || error.name === 'TypeError') throw new Error('MyShows временно недоступен.');
        throw error;
      });
  }

  function rpc(method, params) {
    return requestRpc({jsonrpc: '2.0', method: method, params: params, id: 1})
      .then(function (data) {
        var valid = method === 'shows.GetById' ? data.result && Number(data.result.id) === params.showId : Array.isArray(data.result);
        if (data.error || !valid) {
          var code = data.error && Number(data.error.code);
          throw new Error(code === 403 || code === 401 ? 'Профиль закрыт. Нужен открытый профиль MyShows.' :
            code === 404 ? 'Профиль MyShows не найден. Проверьте имя.' : 'MyShows временно недоступен.');
        }
        return data.result;
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

  var moviePosterQueue = [], activeMoviePosters = 0;
  function pumpMoviePosters() {
    while (activeMoviePosters < 3 && moviePosterQueue.length) (function (job) {
      if (!document.documentElement.contains(job.img)) return;
      activeMoviePosters++;
      accountRequest('poster', {path: new URL(job.url).pathname}).then(function (blob) {
        if (!document.documentElement.contains(job.img)) return;
        var objectUrl = URL.createObjectURL(blob);
        job.img.onload = job.img.onerror = function (event) {
          URL.revokeObjectURL(objectUrl);
          if (event.type === 'error') job.img.style.opacity = '0';
        };
        job.img.src = objectUrl;
      }).catch(function () { job.img.style.opacity = '0'; }).then(function () {
        activeMoviePosters--;
        pumpMoviePosters();
      });
    })(moviePosterQueue.shift());
  }

  function loadPoster(img, item) {
    function hide() { img.style.opacity = '0'; }
    if (item.type === 'movie') {
      if (item.poster && /^https:\/\/media\.myshows\.me\/movies\//.test(item.poster)) {
        moviePosterQueue.push({img: img, url: item.poster});
        pumpMoviePosters();
      } else if (item.poster) { img.onerror = hide; img.src = item.poster; }
      else hide();
      return;
    }
    function fallback() {
      img.onload = null; img.onerror = null; img.removeAttribute('src');
      fallbackPoster(item.showId || item.id).then(function (url) {
        if (!document.documentElement.contains(img)) return;
        if (!url) { hide(); return; }
        img.onerror = hide; img.src = url;
      });
    }
    var cached = posterCache.get(item.showId || item.id);
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
    var groups = {popular: [], watching: [], later: [], completed: new Set()}, seen = {};
    rows.forEach(function (entry) {
      var tab = personal ? entry && entry.watchStatus : 'popular';
      var card = item(entry, personal);
      if (!card) return;
      if (personal) {
        var watched = Number(entry.watchedEpisodes), total = Number(entry.totalEpisodes);
        if (Number.isInteger(watched) && Number.isInteger(total) && total > 0 && watched >= total) {
          groups.completed.add(card.id);
          return;
        }
      }
      if (personal && !Object.prototype.hasOwnProperty.call(tabs, tab)) return;
      var key = tab + ':' + card.id;
      if (!seen[key]) { groups[tab].push(card); seen[key] = true; }
    });
    return groups;
  }

  function visibleItems(items) {
    var completed = profile.items.completed;
    return completed ? items.filter(function (card) { return !completed.has(card.showId || card.id); }) : items;
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
  var recent = {items: [], candidates: [], candidatesAt: 0, at: 0, loading: false, failed: 0, ids: ''};
  var movies = {pages: {}, pending: {}, errors: {}};
  var refreshInterval = 60000;

  function movieItems(page) {
    if (!login || !bridge()) return {items: [], more: false};
    var state = movies, saved = state.pages[page], error = state.errors[page];
    if (!state.pending[page] && (!saved || Date.now() - saved.at >= refreshInterval) && (!error || Date.now() - error.at >= refreshInterval)) {
      state.pending[page] = true;
      accountRequest('movies', {page: page}).then(function (result) {
        if (!result || !Array.isArray(result.items)) throw new Error('Не удалось загрузить фильмы');
        var items = result.items.filter(function (m) {
          return m && /^[1-9][0-9]{0,9}$/.test(String(m.id)) && typeof m.title === 'string' && m.title.trim() &&
            typeof m.watched === 'boolean';
        }).map(function (m) {
          return {id: String(m.id), type: 'movie', title: m.title.slice(0, 180), watched: m.watched,
            poster: /^https:\/\/(?:media\.myshows\.me|cdn\.myshows\.me)\//.test(m.poster) ? m.poster : '',
            meta: [m.watched ? 'Посмотрел' : 'Буду смотреть', Number(m.year) || ''].filter(Boolean).join(' · ')};
        });
        state.pages[page] = {items: items, more: result.more === true, at: Date.now()};
        delete state.errors[page];
      }).catch(function (error) { state.errors[page] = {message: error.message, at: Date.now()}; })
        .then(function () { delete state.pending[page]; if (movies === state) emit(); });
    }
    return saved || {items: [], more: false};
  }

  function markMovie(id) {
    var state = movies;
    return accountRequest('mark', {id: id}, 'POST').then(function (result) {
      if (result !== true) throw new Error('MyShows не подтвердил отметку');
      if (movies !== state) return;
      Object.keys(state.pages).forEach(function (page) {
        state.pages[page].items.forEach(function (item) {
          if (item.id !== id) return;
          item.watched = true;
          item.meta = item.meta.replace(/^Буду смотреть/, 'Посмотрел');
        });
        state.pages[page].at = 0;
      });
      emit();
    });
  }

  function markMovieProgress(movie, progress) {
    var state = movies;
    return accountRequest('movie-progress', {}, 'POST', {
      title: movie.title, original: movie.original, year: movie.year, progress: progress
    }).then(function (result) {
      if (movies !== state || !result || result.status !== 'marked') return;
      Object.keys(state.pages).forEach(function (page) { state.pages[page].at = 0; });
      emit();
      FreeMyTV.toast('Фильм отмечен в MyShows');
    });
  }

  function episodeCard(episode, show, now) {
    var id = String(episode && episode.id), season = Number(episode && episode.seasonNumber), number = Number(episode && episode.episodeNumber);
    var aired = Date.parse(episode && (episode.airDateUTC || episode.airDate));
    if (!/^[1-9][0-9]{0,9}$/.test(id) || String(episode.showId) !== show.id || episode.isSpecial ||
        !Number.isInteger(season) || season < 1 || !Number.isInteger(number) || number < 1 ||
        !(aired <= now && aired >= now - 30 * 86400000)) return null;
    var code = 'S' + String(season).padStart(2, '0') + 'E' + String(number).padStart(2, '0');
    return {id: 'episode:' + id, showId: show.id, title: show.title, poster: show.poster, aired: aired,
      meta: code + ' · ' + new Date(aired).toLocaleDateString('ru-RU', {day: 'numeric', month: 'short'})};
  }

  function recentEpisodes() {
    var source = load('watching'), shows = visibleItems(source.items.watching || []), now = Date.now();
    if (!login || !bridge() || !shows.length) return [];
    var ids = shows.map(function (show) { return show.id; }).sort().join(',');
    if (recent.loading || (recent.ids === ids && now - recent.at < refreshInterval)) return visibleItems(recent.items);
    var previous = recent;
    var state = recent = {items: recent.ids === ids ? recent.items : [], candidates: [], candidatesAt: 0,
      at: 0, loading: true, failed: 0, ids: ids};
    var cursor = 0, active = 0, found = new Map();

    function applyWatchStatus() {
      var showIds = Array.from(new Set(state.candidates.map(function (card) { return card.showId; })));
      var watched = new Map(), pending = Promise.resolve();
      for (var i = 0; i < showIds.length; i += 18) (function (ids) {
        pending = pending.then(function () {
          if (state !== recent) return;
          return accountRequest('episodes', {ids: ids.join(',')}).then(function (rows) {
            if (!Array.isArray(rows)) throw new Error('Не удалось проверить отметки');
            rows.forEach(function (row) {
              if (row && Array.isArray(row.watched) && ids.indexOf(String(row.showId)) >= 0) {
                watched.set(String(row.showId), new Set(row.watched.map(String)));
              }
            });
            if (ids.some(function (id) { return !watched.has(id); })) state.failed++;
          }).catch(function (error) { state.failed++; state.error = error.message; });
        });
      })(showIds.slice(i, i + 18));
      pending.then(function () {
        if (state !== recent) return;
        state.items = state.candidates.filter(function (card) {
          var marks = watched.get(card.showId);
          return marks && !marks.has(card.id.slice('episode:'.length));
        });
        state.loading = false; state.at = Date.now(); emit();
      });
    }

    function collect(batch, response) {
      var byId = new Map((Array.isArray(response) ? response : []).filter(Boolean).map(function (entry) { return [entry.id, entry]; }));
      batch.forEach(function (show, i) {
        var data = byId.get(i + 1), details = data && data.result;
        if (!details || String(details.id) !== show.id || !Array.isArray(details.episodes)) { state.failed++; return; }
        details.episodes.forEach(function (episode) {
          var card = episodeCard(episode, show, now);
          if (card) found.set(card.id, card);
        });
      });
    }

    function pump() {
      if (state !== recent) return;
      if (cursor === shows.length && !active) {
        state.candidates = Array.from(found.values()).sort(function (a, b) { return b.aired - a.aired || a.title.localeCompare(b.title) || a.id.localeCompare(b.id); });
        state.candidatesAt = state.failed ? 0 : Date.now();
        applyWatchStatus(); return;
      }
      while (active < 2 && cursor < shows.length) (function (batch) {
        cursor += batch.length; active++;
        requestRpc(batch.map(function (show, i) {
          return {jsonrpc: '2.0', id: i + 1, method: 'shows.GetById', params: {showId: Number(show.id), withEpisodes: true}};
        })).then(function (response) { collect(batch, response); }, function () { state.failed += batch.length; })
          .then(function () { active--; pump(); });
      })(shows.slice(cursor, cursor + 6));
    }
    if (previous.ids === ids && now - previous.candidatesAt < ttl) {
      state.candidates = previous.candidates.filter(function (card) { return card.aired >= now - 30 * 86400000; });
      state.candidatesAt = previous.candidatesAt;
      applyWatchStatus();
    } else pump();
    return visibleItems(state.items);
  }

  function status(tab) {
    if ((tab === 'episodes' || tab === 'movies') && login && !bridge()) return 'Подключите помощник MyShows в Home Assistant';
    if (tab === 'movies' && login) {
      var error = movies.errors[0];
      return movies.pending[0] ? 'Загружаем фильмы…' : error ? error.message : 'Добавьте фильмы в «Буду смотреть» в MyShows';
    }
    if (tab === 'episodes' && login) {
      var source = load('watching');
      if (source.loading || recent.loading) return 'Загружаем новые серии…';
      if (source.error) return source.error;
      return recent.error || (recent.failed ? 'Не удалось проверить часть сериалов. Попробуйте позже.' : 'За последние 30 дней новых непросмотренных серий нет');
    }
    if (tab !== 'popular' && !login) return 'Укажите имя в Настройки → Профиль MyShows';
    var current = load(tab);
    return current.loading || (tab === 'popular' && !profile.at && profile.loading) ?
      'Загружаем MyShows…' : current.error || 'В этом списке пока нет сериалов';
  }
  function applyProfile(value, rows) {
    try { if (value) localStorage.setItem(KEY, value); else localStorage.removeItem(KEY); }
    catch (e) { throw new Error('Не удалось сохранить профиль на телевизоре.'); }
    login = value; profile = feed(); recent = {items: [], candidates: [], candidatesAt: 0, at: 0, loading: false, failed: 0, ids: ''};
    movies = {pages: {}, pending: {}, errors: {}};
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
  var movieDialog, movieButtons, movieHint, movieTitle, movieSelection, selectedMovie, movieAction = 0, marking = false;

  function paintMovie() {
    movieButtons.forEach(function (button, index) { button.classList.toggle('search-focus', index === movieAction); });
  }
  function closeMovie() {
    movieDialog.classList.remove('open');
    var selection = movieSelection;
    selectedMovie = null;
    CatalogHome.restore(selection);
  }
  function openMovie(item, selection) {
    if (!movieDialog) {
      movieDialog = node('div', 'layer sheet movie-search', document.getElementById('stage'));
      movieDialog.id = 'myshows-movie';
      movieDialog.setAttribute('role', 'dialog');
      movieDialog.setAttribute('aria-modal', 'true');
      var box = node('div', 'box', movieDialog);
      movieTitle = node('h2', 'search-title', box);
      movieTitle.id = 'myshows-movie-title';
      movieDialog.setAttribute('aria-labelledby', movieTitle.id);
      var actions = node('div', 'search-form', box);
      movieButtons = ['Найти для просмотра', 'Посмотрел'].map(function (label, index) {
        var button = node('button', 'search-submit', actions, label);
        button.type = 'button';
        button.onclick = function () { movieAction = index; chooseMovieAction(); };
        return button;
      });
      movieHint = node('div', 'search-status', box);
      movieHint.setAttribute('aria-live', 'polite');
    }
    selectedMovie = item; movieSelection = selection; movieAction = 0;
    movieTitle.textContent = item.title;
    movieHint.textContent = '← → — действие · OK — выбрать · Back — назад';
    FreeMyTV.state.zone = 'myshows-movie';
    movieDialog.classList.add('open');
    paintMovie();
  }
  function chooseMovieAction() {
    if (marking || !selectedMovie) return;
    var item = selectedMovie, selection = movieSelection;
    if (!movieAction) {
      closeMovie();
      CombinedSearch.openForTitle(item.title, selection);
      return;
    }
    marking = true;
    movieHint.textContent = 'Сохраняем отметку в MyShows…';
    markMovie(item.id).then(function () {
      marking = false; closeMovie();
      FreeMyTV.toast('Посмотрел — сохранено в MyShows');
    }).catch(function (error) {
      marking = false;
      movieHint.textContent = error.message || 'Не удалось сохранить отметку';
    });
  }
  document.addEventListener('keydown', function (event) {
    if (!selectedMovie) return;
    event.preventDefault(); event.stopImmediatePropagation(); FreeMyTV.poke();
    if (marking) return;
    var key = event.keyCode;
    if (key === 10009 || key === 27 || key === 461 || key === 8) closeMovie();
    else if (key === 37 || key === 39) { movieAction = key === 37 ? 0 : 1; paintMovie(); }
    else if ((key === 13 || key === 65376) && !event.repeat) chooseMovieAction();
  }, true);
  function matchEpisodes(series, keys) {
    function normalize(title) { return String(title || '').toLowerCase().trim().replace(/ё/g, 'е').replace(/\s+/g, ' '); }
    var title = normalize(series.name), original = normalize(series.original);
    if (!title || !Number.isInteger(series.year)) return Promise.resolve({});
    return rpc('shows.Search', {query: series.name}).then(function (shows) {
      var matched = {};
      shows.forEach(function (show) {
        if (Number(show.year) === series.year && /^[1-9][0-9]{0,8}$/.test(String(show.id)) &&
            (title === normalize(show.title) || (original && original === normalize(show.titleOriginal)))) matched[show.id] = true;
      });
      var ids = Object.keys(matched);
      if (ids.length !== 1) return {};
      return rpc('shows.GetById', {showId: Number(ids[0]), withEpisodes: true}).then(function (show) {
        var result = {};
        (show.episodes || []).forEach(function (episode) {
          if (episode.isSpecial || String(episode.showId) !== ids[0] || !/^[1-9][0-9]{0,8}$/.test(String(episode.id))) return;
          keys.forEach(function (key) {
            var parts = /^([1-9][0-9]*):([1-9][0-9]*):(\d{4}-\d{2}-\d{2})$/.exec(key);
            if (!parts || Number(parts[1]) !== Number(episode.seasonNumber) || Number(parts[2]) !== Number(episode.episodeNumber)) return;
            // VoKino may use the translated release date rather than the original premiere.
            var date = Date.parse(parts[3] + 'T00:00:00Z');
            var nearby = [episode.airDateUTC, episode.airDate].some(function (value) {
              var match = /^(\d{4}-\d{2}-\d{2})(?:T|\s|$)/.exec(value || '');
              return match && Math.abs(Date.parse(match[1] + 'T00:00:00Z') - date) <= 14 * 86400000;
            });
            if (!nearby) return;
            if (Object.prototype.hasOwnProperty.call(result, key)) {
              if (result[key] && result[key].id !== episode.id) result[key] = null;
            } else result[key] = episode;
          });
        });
        Object.keys(result).forEach(function (key) { if (!result[key]) delete result[key]; });
        return result;
      });
    });
  }

  window.MyShowsCatalog = {
    items: function (tab) {
      if (tab === 'episodes') return recentEpisodes();
      if (tab === 'movies') return movieItems(0).items;
      if (tab === 'popular') {
        var personal = load('watching');
        if (login && !personal.at && personal.loading) return [];
      }
      return visibleItems(load(tab).items[tab] || []);
    },
    recentInOverview: function () { load('watching'); return visibleItems(recent.items); },
    movieItems: movieItems, openMovie: openMovie,
    canMarkMovies: function () { return Boolean(login && bridge()); }, markMovieProgress: markMovieProgress,
    loadPoster: loadPoster, status: status, onChange: function (fn) { listeners.push(fn); },
    profile: function () { return login; }, open: open, close: close, matchEpisodes: matchEpisodes
  };
})();
