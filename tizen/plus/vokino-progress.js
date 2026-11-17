/* Watch progress sent to the local MyShows helper on return from VoKino. */
(function () {
  'use strict';
  var CONFIG = 'fmtv.myshows.relay.v1', SESSION = 'fmtv.myshows.progress.v1';
  var SOURCE = 'fmtv-vokino-v1', MAX_AGE = 8 * 60 * 60 * 1000;
  var comparing = false, staged = false, generation = 0;
  var movieTypes = ['movie', 'multfilm', 'documovie'];
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) staged = false;
  });

  function config() {
    try {
      var url = new URL(localStorage.getItem(CONFIG) || '');
      var local = /^(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2[0-9]|3[01]))(?:\.\d{1,3}){2}$|^[a-z0-9-]+\.local$/i;
      if (!/^https?:$/.test(url.protocol) || !local.test(url.hostname) ||
          !/^\/api\/webhook\/[a-zA-Z0-9_-]{24,128}$/.test(url.pathname) ||
          url.search || url.hash || url.username || url.password) return null;
      return url.href;
    } catch (e) { return null; }
  }

  function get(url, options, timeout) {
    var control = new AbortController(), timer = setTimeout(function () { control.abort(); }, timeout);
    options.signal = control.signal;
    return fetch(url, options).then(function (response) {
      if (options.mode === 'no-cors') return null;
      if (!response.ok) throw new Error('Episode data unavailable');
      return response.json();
    }).then(function (data) {
      clearTimeout(timer); return data;
    }, function (error) {
      clearTimeout(timer); throw error;
    });
  }

  function episodeProgress(playlist) {
    var entries = {};
    (playlist.channels || []).forEach(function (season) {
      (season.submenu || []).forEach(function (entry) {
        var time = entry.timeline || {}, details = entry.details || {};
        var s = Number(time.season), e = Number(time.episode), current = Number(time.current), duration = Number(time.time);
        var date = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(details.air_date || '');
        if (!date || !Number.isInteger(s) || s < 1 || !Number.isInteger(e) || e < 1 ||
            !Number.isFinite(current) || !Number.isFinite(duration) || current < 0 || duration < current) return;
        var key = s + ':' + e + ':' + date[3] + '-' + date[2] + '-' + date[1];
        if (Object.prototype.hasOwnProperty.call(entries, key)) { entries[key] = null; return; }
        entries[key] = {current: current, duration: duration};
      });
    });
    return entries;
  }

  function reader(account, budget) {
    var deadline = Date.now() + budget, base = new URL(account.base);
    return function (path) {
      var url = new URL(path, base.origin);
      if (url.pathname !== '/v2/timeline/list' && !/^\/v2\/(?:view\/[a-f0-9]{24}$|online\/)/.test(url.pathname)) {
        return Promise.reject(new Error('Unexpected playlist'));
      }
      url = new URL(base.origin + url.pathname + url.search);
      url.searchParams.set('token', account.token);
      return get(url.href, {credentials: 'omit', redirect: 'error'}, Math.max(1, deadline - Date.now()));
    };
  }

  function movieHistory(request, titleId, pages) {
    var rows = Object.create(null), complete = false;
    function read(path, remaining) {
      return request(path).then(function (data) {
        if (!Array.isArray(data.channels) || !data.page) throw new Error('Invalid VoKino history');
        data.channels.forEach(function (entry) {
          var d = entry && entry.details;
          if (!d || movieTypes.indexOf(d.type) < 0 || !/^[a-f0-9]{24}$/.test(d.id) ||
              (titleId && d.id !== titleId) || rows[d.id]) return;
          var current = Number(d.current), duration = Number(d.time), year = Number(d.released);
          if (!d.name || !Number.isInteger(year) || year < 1888 || year > 2200 ||
              !Number.isFinite(current) || !Number.isFinite(duration) || duration < 60 ||
              current < 0 || current > duration) return;
          rows[d.id] = {current: current, duration: duration, title: String(d.name).slice(0, 180),
            original: String(d.originalname || '').slice(0, 180), year: year};
        });
        complete = !data.page.next;
        if (complete || (titleId && rows[titleId]) || remaining <= 1) return;
        return read(data.page.next, remaining - 1).catch(function () {});
      });
    }
    return read('/v2/timeline/list', pages).then(function () { return {kind: 'movie', rows: rows, complete: complete}; });
  }

  function snapshot(account, titleId, budget) {
    var request = reader(account, budget);
    var movies = window.MyShowsCatalog && MyShowsCatalog.canMarkMovies();
    if (!titleId) return movies ? movieHistory(request, null, 3) : Promise.resolve(null);
    return request('/v2/view/' + titleId).then(function (title) {
      var d = title.details;
      if (!d) return null;
      if (movies && movieTypes.indexOf(d.type) >= 0) return movieHistory(request, titleId, 3);
      if (!config() || ['serial', 'multserial', 'docuserial', 'tvshow', 'anime'].indexOf(d.type) < 0) return null;
      var sources = title.online || {}, rows = Object.create(null);
      return Promise.all(Object.keys(sources).slice(0, 8).map(function (name) {
        var source = sources[name], path = typeof source === 'string' ? source : source && source.playlist_url;
        if (!path) return null;
        return request(path).then(function (playlist) {
          rows[name] = episodeProgress(playlist);
        }).catch(function () {});
      })).then(function () {
        return {kind: 'episode', name: d.name, original: d.originalname, year: Number(d.released), rows: rows};
      });
    });
  }

  function changed(before, after, seconds) {
    var changes = {};
    Object.keys(after.rows).forEach(function (source) {
      var previous = before.rows[source], latest = after.rows[source];
      if (!previous) return;
      Object.keys(latest).forEach(function (key) {
        var start = previous[key], end = latest[key];
        if (!start || !end || end.duration <= 0 || end.current <= start.current) return;
        var progress = end.current / end.duration * 100;
        var observed = changes[key] || {progress: 0, candidate: false};
        observed.progress = Math.max(observed.progress, progress);
        // Time spent away from the launcher can disqualify a quick seek to the end.
        var crossed = start.current / (start.duration || end.duration) < 0.9 && progress >= 90;
        observed.candidate = observed.candidate || (crossed && seconds >= (end.current - start.current) * 0.8);
        changes[key] = observed;
      });
    });
    return changes;
  }

  function send(url, episode, observed) {
    var fields = {source: SOURCE, show_id: episode.showId, episode_id: episode.id,
      season: episode.seasonNumber, number: episode.episodeNumber, progress: observed.progress.toFixed(2),
      candidate: observed.candidate ? '1' : '0'};
    var body = Object.keys(fields).map(function (key) { return key + '=' + encodeURIComponent(fields[key]); }).join('&');
    // A simple cross-origin POST works on Tizen with the local webhook. Inspect HA to verify receipt.
    return get(url, {method: 'POST', mode: 'no-cors', credentials: 'omit',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: body}, 5000);
  }

  function cancel() {
    generation++;
    staged = false;
    try { localStorage.removeItem(SESSION); } catch (e) {}
  }

  function prepare(account, titleId, launch) {
    cancel();
    var started = generation;
    var profile = window.MyShowsCatalog && MyShowsCatalog.profile();
    if (!account || (!config() && !(profile && MyShowsCatalog.canMarkMovies())) ||
        (!titleId && !(profile && MyShowsCatalog.canMarkMovies())) || typeof AbortController !== 'function') { launch(); return; }
    snapshot(account, titleId, 2800).then(function (before) {
      if (started !== generation) return;
      if (before && (before.kind === 'movie' || Object.keys(before.rows).length)) {
        localStorage.setItem(SESSION, JSON.stringify({titleId: titleId, owner: account.key,
          base: account.base, profile: profile, at: Date.now(), before: before}));
        staged = true;
      }
    }).catch(function () {}).then(function () { if (started === generation) launch(); });
  }

  function finishedMovie(before, after, seconds) {
    var candidates = [];
    Object.keys(after.rows).forEach(function (id) {
      var start = before.rows[id], end = after.rows[id];
      var progress = end.current / end.duration * 100;
      if (progress < 90) return;
      if (start) {
        if (start.year !== end.year || start.current >= start.duration * 0.9 || start.current >= end.current ||
            Math.abs(start.duration - end.duration) > end.duration * 0.05 ||
            seconds < (end.current - start.current) * 0.8) return;
      } else if (seconds < end.current * (before.complete ? 0.8 : 1)) return;
      candidates.push({movie: end, progress: progress});
    });
    return candidates.length === 1 ? candidates[0] : null;
  }

  function checkMovie(account, session, seconds, attempt, started) {
    if (document.hidden || started !== generation || session.profile !== MyShowsCatalog.profile()) return Promise.resolve();
    return movieHistory(reader(account, 6000), session.titleId, 1).then(function (after) {
      if (document.hidden || started !== generation || session.profile !== MyShowsCatalog.profile()) return true;
      var finished = finishedMovie(session.before, after, seconds);
      if (!finished) return false;
      return MyShowsCatalog.markMovieProgress(finished.movie, finished.progress).then(function () { return true; });
    }).catch(function () { return false; }).then(function (done) {
      if (done || attempt >= 1 || seconds < 30 || document.hidden || started !== generation) return;
      return new Promise(function (resolve) { setTimeout(resolve, 5000); }).then(function () {
        return checkMovie(account, session, seconds, attempt + 1, started);
      });
    });
  }

  function resume(account) {
    var url = config(), session;
    if (document.hidden || staged || !account || !window.MyShowsCatalog) return;
    try {
      session = JSON.parse(localStorage.getItem(SESSION) || 'null');
      if (!session) return;
      localStorage.removeItem(SESSION);
    } catch (e) { return; }
    if (!session.before || session.owner !== account.key || session.base !== account.base ||
        Date.now() - session.at > MAX_AGE) return;
    var seconds = (Date.now() - session.at) / 1000;
    if (session.before.kind === 'movie') {
      if (session.titleId !== null && !/^[a-f0-9]{24}$/.test(session.titleId)) return;
      if (MyShowsCatalog.canMarkMovies()) checkMovie(account, session, seconds, 0, generation);
      return;
    }
    if (!url || comparing || !/^[a-f0-9]{24}$/.test(session.titleId)) return;
    comparing = true;
    snapshot(account, session.titleId, 7000).then(function (after) {
      if (!after || document.hidden || config() !== url) return;
      var changes = changed(session.before, after, seconds), keys = Object.keys(changes);
      if (!keys.length) return;
      return MyShowsCatalog.matchEpisodes(after, keys).then(function (episodes) {
        if (document.hidden || config() !== url) return;
        return Object.keys(episodes).reduce(function (pending, key) {
          return pending.then(function () { return send(url, episodes[key], changes[key]); });
        }, Promise.resolve());
      });
    }).catch(function () {}).then(function () { comparing = false; });
  }

  window.VoKinoProgress = {prepare: prepare, resume: resume, cancel: cancel};
})();
