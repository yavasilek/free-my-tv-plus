/* Watch progress sent to the local MyShows helper on return from VoKino. */
(function () {
  'use strict';
  var CONFIG = 'fmtv.myshows.relay.v1', SESSION = 'fmtv.myshows.progress.v1';
  var SOURCE = 'fmtv-vokino-v1', MAX_AGE = 8 * 60 * 60 * 1000;
  var comparing = false, staged = false, generation = 0;
  var movieTypes = ['movie', 'multfilm', 'documovie'];
  var seriesTypes = ['serial', 'multserial', 'docuserial', 'tvshow', 'anime'];
  function status(state, extra) {
    try { localStorage.setItem('fmtv.myshows.progress.status.v1', JSON.stringify({state: state, at: Date.now(), details: extra || ''})); } catch (e) {}
  }
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
    options.cache = 'no-store';
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
        var seasonLabel = /^(?:Сезон|Season)\s+([1-9][0-9]*)$/i.exec(String(season.title || '').trim());
        var episodeLabel = /^(?:Серия|Episode)\s+([1-9][0-9]*)$/i.exec(String(entry.title || '').trim());
        var s = Number(time.season || (seasonLabel && seasonLabel[1])), e = Number(time.episode || (episodeLabel && episodeLabel[1]));
        var current = entry.timeline ? Number(time.current) : 0, duration = entry.timeline ? Number(time.time) : 0;
        var date = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(details.air_date || '');
        if (!date || !Number.isInteger(s) || s < 1 || !Number.isInteger(e) || e < 1 ||
            (seasonLabel && Number(seasonLabel[1]) !== s) || (episodeLabel && Number(episodeLabel[1]) !== e) ||
            !Number.isFinite(current) || !Number.isFinite(duration) || current < 0 || duration < current) return;
        var iso = date[3] + '-' + date[2] + '-' + date[1], parsed = new Date(iso + 'T00:00:00Z');
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return;
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
      if (Date.now() >= deadline) return Promise.reject(new Error('VoKino progress timed out'));
      var url = new URL(path, base.origin);
      if (url.pathname !== '/v2/timeline/list' && !/^\/v2\/(?:view\/[a-f0-9]{24}$|online\/)/.test(url.pathname)) {
        return Promise.reject(new Error('Unexpected playlist'));
      }
      url = new URL(base.origin + url.pathname + url.search);
      url.searchParams.set('token', account.token);
      return get(url.href, {credentials: 'omit', redirect: 'error'}, Math.max(1, deadline - Date.now())).then(function (data) {
        if (!data || data.error) throw new Error('VoKino progress unavailable');
        return data;
      });
    };
  }

  function movieHistory(request, titleId, pages) {
    var rows = Object.create(null), complete = false, series = [];
    function read(path, remaining) {
      return request(path).then(function (data) {
        if (!Array.isArray(data.channels) || !data.page) throw new Error('Invalid VoKino history');
        data.channels.forEach(function (entry) {
          var d = entry && entry.details;
          if (d && seriesTypes.indexOf(d.type) >= 0 && /^[a-f0-9]{24}$/.test(d.id) && series.indexOf(d.id) < 0 && series.length < 3) series.push(d.id);
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
    return read('/v2/timeline/list', pages).then(function () { return {kind: 'movie', rows: rows, complete: complete, series: series}; });
  }

  function snapshot(account, titleId, budget) {
    var request = reader(account, budget);
    var movies = window.MyShowsCatalog && MyShowsCatalog.canMarkMovies();
    function titleSnapshot(id) { return request('/v2/view/' + id).then(function (title) {
      var d = title.details;
      if (!d) return null;
      if (movies && movieTypes.indexOf(d.type) >= 0) return movieHistory(request, id, 3);
      if (!config() || seriesTypes.indexOf(d.type) < 0) return null;
      var sources = title.online || {}, rows = Object.create(null);
      return Promise.all(Object.keys(sources).slice(0, 8).map(function (name) {
        var source = sources[name], path = typeof source === 'string' ? source : source && source.playlist_url;
        if (!path) return null;
        return request(path).then(function (playlist) {
          rows[name] = episodeProgress(playlist);
        }).catch(function () {});
      })).then(function () {
        if (!Object.keys(rows).length) throw new Error('No episode progress available');
        return {kind: 'episode', name: d.name, original: d.originalname, year: Number(d.released), rows: rows};
      });
    }); }
    if (titleId) return titleSnapshot(titleId);
    return movieHistory(request, null, 3).then(function (history) {
      var episodes = Object.create(null);
      return Promise.all((config() ? history.series : []).map(function (id) {
        return titleSnapshot(id).then(function (value) { if (value && value.kind === 'episode') episodes[id] = value; }).catch(function () {});
      })).then(function () { return {kind: 'bundle', movies: movies ? history : null, episodes: episodes}; });
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
        typeof AbortController !== 'function') { launch(); return; }
    snapshot(account, titleId, 2800).then(function (before) {
      if (started !== generation) return;
      if (before && (before.kind === 'movie' || (before.kind === 'bundle' ? before.movies || Object.keys(before.episodes).length : Object.keys(before.rows).length))) {
        localStorage.setItem(SESSION, JSON.stringify({titleId: titleId, owner: account.key,
          base: account.base, profile: profile, at: Date.now(), before: before}));
        staged = true;
        status('prepared');
      }
    }).catch(function () { status('baseline-unavailable'); }).then(function () { if (started === generation) launch(); });
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

  function checkEpisodes(account, session, seconds, started, sent, attempt) {
    var url = config();
    function active() { return !document.hidden && started === generation && config() === url && session.profile === MyShowsCatalog.profile(); }
    if (!url || !active()) return Promise.resolve();
    var baselines = session.before.kind === 'bundle' ? session.before.episodes : {};
    if (session.before.kind === 'episode') baselines[session.titleId] = session.before;
    var ids = Object.keys(baselines), failed = false, unmapped = false;
    return Promise.all(ids.map(function (id) {
      return snapshot(account, id, 7000).then(function (after) {
        if (!after || after.kind !== 'episode' || !active()) return;
        var changes = changed(baselines[id], after, seconds), keys = Object.keys(changes);
        if (!keys.length) return;
        return MyShowsCatalog.matchEpisodes(after, keys).then(function (episodes) {
          if (!active()) return;
          if (Object.keys(episodes).length < keys.length) unmapped = true;
          return Object.keys(episodes).reduce(function (pending, key) {
            return pending.then(function () {
              var stamp = id + '/' + key + '/' + (changes[key].candidate ? '1' : '0');
              if (!active() || sent[stamp]) return;
              return send(url, episodes[key], changes[key]).then(function () {
                sent[stamp] = true;
                // An opaque webhook response confirms submission, not a saved MyShows mark.
                status(changes[key].candidate ? 'candidate-submitted' : 'progress-submitted');
              });
            });
          }, Promise.resolve());
        });
      }).catch(function () { failed = true; });
    })).then(function () {
      if (!active()) return;
      if (failed) status('progress-unavailable');
      else if (unmapped) status('episode-not-matched');
      else if (!Object.keys(sent).length) status('no-new-progress');
      // Providers may persist playback after the launcher has already become visible.
      if (attempt >= 2 || seconds < 30 || !ids.length) return {retry: failed};
      return new Promise(function (resolve) { setTimeout(resolve, attempt ? 10000 : 5000); }).then(function () {
        return checkEpisodes(account, session, seconds, started, sent, attempt + 1);
      });
    });
  }

  function resume(account) {
    var url = config(), session;
    if (document.hidden || staged || comparing || !account || !window.MyShowsCatalog) return;
    try {
      session = JSON.parse(localStorage.getItem(SESSION) || 'null');
      if (!session) return;
    } catch (e) { return; }
    if (!session.before || session.owner !== account.key || session.base !== account.base ||
        session.profile !== MyShowsCatalog.profile() || Date.now() < session.at || Date.now() - session.at > MAX_AGE) {
      localStorage.removeItem(SESSION); return;
    }
    var seconds = (Date.now() - session.at) / 1000;
    if (session.titleId !== null && !/^[a-f0-9]{24}$/.test(session.titleId)) { localStorage.removeItem(SESSION); return; }
    if (['movie', 'episode', 'bundle'].indexOf(session.before.kind) < 0) { localStorage.removeItem(SESSION); return; }
    comparing = true;
    var started = generation, tasks = [], movieBefore = session.before.kind === 'bundle' ? session.before.movies : session.before;
    if (movieBefore && movieBefore.kind === 'movie' && MyShowsCatalog.canMarkMovies()) {
      tasks.push(checkMovie(account, {titleId: session.titleId, before: movieBefore, profile: session.profile}, seconds, 0, started));
    }
    if (url && session.before.kind !== 'movie') tasks.push(checkEpisodes(account, session, seconds, started, {}, 0));
    Promise.all(tasks).catch(function () { status('progress-unavailable'); return [{retry: true}]; }).then(function (results) {
      comparing = false;
      if (started === generation && !document.hidden && !results.some(function (result) { return result && result.retry; })) {
        try {
          var current = JSON.parse(localStorage.getItem(SESSION) || 'null');
          if (current && current.at === session.at && current.owner === session.owner) localStorage.removeItem(SESSION);
        } catch (e) {}
      }
    });
  }

  window.VoKinoProgress = {prepare: prepare, resume: resume, cancel: cancel};
})();
