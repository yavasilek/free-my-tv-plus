/* Watch progress sent to the local MyShows helper on return from VoKino. */
(function () {
  'use strict';
  var CONFIG = 'fmtv.myshows.relay.v1', SESSION = 'fmtv.myshows.progress.v1';
  var SOURCE = 'fmtv-vokino-v1', MAX_AGE = 8 * 60 * 60 * 1000;
  var comparing = false, staged = false, generation = 0;
  var movieTypes = ['movie', 'multfilm', 'documovie'];
  var seriesTypes = ['serial', 'multserial', 'docuserial', 'tvshow', 'anime'];
  var HISTORY = 'fmtv.myshows.history-sync.v1', HISTORY_STATE = 'fmtv.myshows.history-state.v1';
  var syncing = false, syncTimer = 0;
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

  function historyState() {
    try {
      var value = JSON.parse(localStorage.getItem(HISTORY_STATE) || 'null');
      return value && value.version === 1 && Array.isArray(value.queue) && Array.isArray(value.seen) &&
        Array.isArray(value.failed) && Array.isArray(value.visited) ? value : null;
    } catch (e) { return null; }
  }
  function historyStatus() {
    if (localStorage.getItem(HISTORY) !== '1') return '';
    var job = historyState();
    if (!job || !window.MyShowsCatalog || job.profile !== MyShowsCatalog.profile()) return '';
    if (job.phase === 'error') return 'Не удалось сверить историю с MyShows. Повторим автоматически; проверьте помощник Home Assistant.';
    var text = 'История VoKino: проверено сериалов ' + job.checked + ', добавлено отметок ' + job.confirmed;
    return (job.phase === 'done' ? text : 'Сверяем историю VoKino: ' + job.checked + ' сериалов, ' + job.confirmed + ' отметок') +
      (job.failed.length ? ', не удалось проверить: ' + job.failed.length : '') +
      (job.unmatched ? ', не сопоставлено серий: ' + job.unmatched : '');
  }
  function nextHistoryPath(account, value) {
    if (!value) return '';
    var base = new URL(account.base), url = new URL(value, base.href + '/');
    if (!/^https?:$/.test(url.protocol) || url.host !== base.host || url.pathname !== '/v2/timeline/list' ||
        !/^[1-9][0-9]{0,5}$/.test(url.searchParams.get('page') || '')) throw new Error('Invalid history page');
    return '/v2/timeline/list?page=' + url.searchParams.get('page');
  }
  function syncHistory(account, force) {
    if (syncing || document.hidden || staged || comparing || localStorage.getItem(SESSION) ||
        localStorage.getItem(HISTORY) !== '1' || !config() || !account ||
        !/^https:\/\/api\.vokino\.(org|pro|co|tv)\/v2$/.test(account.base) ||
        !window.MyShowsCatalog || !MyShowsCatalog.canSyncEpisodes()) return Promise.resolve();
    clearTimeout(syncTimer); syncTimer = 0;
    var profile = MyShowsCatalog.profile(), started = generation, job = historyState(), now = Date.now();
    if (!job || job.version !== 1 || job.owner !== account.key || job.base !== account.base || job.profile !== profile ||
        (job.phase === 'done' && (force || now - job.finishedAt >= 1800000))) {
      job = {version: 1, owner: account.key, base: account.base, profile: profile, at: now, phase: 'scanning',
        path: '/v2/timeline/list', visited: [], queue: [], seen: [], failed: [], checked: 0, confirmed: 0, unmatched: 0, work: null};
    }
    if (job.phase === 'done' || (job.retryAt && now < job.retryAt)) return Promise.resolve();
    syncing = true;
    function active() {
      var current;
      try { current = JSON.parse(localStorage.getItem('fmtv.vokino.account')); } catch (e) {}
      return !document.hidden && started === generation && localStorage.getItem(HISTORY) === '1' && config() &&
        MyShowsCatalog.profile() === profile && current && current.key === account.key && current.base === account.base;
    }
    function save() {
      if (!active()) return;
      localStorage.setItem(HISTORY_STATE, JSON.stringify(job));
      if (window.Data) Data.settingsChanged();
    }
    function finishTitle() {
      job.queue.shift(); job.work = null; job.checked++; job.attempts = 0; job.retryAt = 0; job.phase = 'scanning'; save();
    }
    function episodeMap(list) {
      var result = {};
      list.forEach(function (item) { result[item.key] = item.episode; }); return result;
    }
    function submitBatch() {
      if (!active()) return Promise.resolve();
      var work = job.work;
      if (!work.remaining.length) { finishTitle(); return Promise.resolve(); }
      var batch = work.remaining.slice(0, 3);
      return MyShowsCatalog.missingEpisodes(episodeMap(batch)).then(function (missing) {
        if (!active()) return;
        work.remaining = work.remaining.slice(batch.length);
        work.pending = batch.filter(function (item) { return !!missing[item.key]; });
        work.sentAt = Date.now(); job.phase = 'waiting'; save();
        return work.pending.reduce(function (pending, item) {
          return pending.then(function () {
            if (active()) return send(config(), item.episode, {progress: item.progress, candidate: true});
          });
        }, Promise.resolve());
      });
    }
    function checkWork() {
      var work = job.work;
      if (!work.pending.length) return submitBatch();
      return MyShowsCatalog.missingEpisodes(episodeMap(work.pending)).then(function (missing) {
        if (!active()) return;
        var previous = work.pending.length;
        work.pending = work.pending.filter(function (item) { return !!missing[item.key]; });
        var confirmed = previous - work.pending.length;
        job.confirmed += confirmed;
        if (confirmed) MyShowsCatalog.invalidateWatchStatus();
        save();
        if (!work.pending.length) return submitBatch();
        if (Date.now() - work.sentAt >= 90000) {
          work.remaining = work.pending.concat(work.remaining); work.pending = [];
          throw new Error('MyShows did not confirm the mark');
        }
      });
    }
    function processTitle() {
      if (!active()) return Promise.resolve();
      if (job.work) return checkWork();
      if (!job.queue.length) {
        if (!job.path) { job.phase = 'done'; job.finishedAt = Date.now(); save(); return Promise.resolve(); }
        var path = job.path;
        return reader(account, 10000)(path).then(function (data) {
          if (!active()) return;
          if (!Array.isArray(data.channels) || !data.page) throw new Error('Invalid VoKino history');
          var next = nextHistoryPath(account, data.page.next);
          if (next && (next === path || job.visited.indexOf(next) >= 0)) throw new Error('History pagination loop');
          if (job.visited.length >= 10000) throw new Error('History pagination limit');
          job.visited.push(path); job.path = next;
          data.channels.forEach(function (entry) {
            var d = entry && entry.details;
            if (!d || seriesTypes.indexOf(d.type) < 0 || !/^[a-f0-9]{24}$/.test(d.id) || job.seen.indexOf(d.id) >= 0) return;
            job.seen.push(d.id); job.queue.push(d.id);
          });
          save(); return processTitle();
        });
      }
      return snapshot(account, job.queue[0], 10000).then(function (series) {
        if (!active()) return;
        if (!series || series.kind !== 'episode') { finishTitle(); return; }
        var observed = {};
        Object.keys(series.rows).forEach(function (source) {
          Object.keys(series.rows[source]).forEach(function (key) {
            var value = series.rows[source][key], date = key.split(':')[2];
            if (value && value.duration >= 60 && value.current / value.duration >= 0.9 &&
                Date.parse(date + 'T00:00:00Z') <= Date.now()) observed[key] = Math.max(observed[key] || 0, value.current / value.duration * 100);
          });
        });
        var keys = Object.keys(observed);
        if (!keys.length) { finishTitle(); return; }
        return MyShowsCatalog.matchEpisodes(series, keys).then(function (matches) {
          if (!active()) return;
          job.unmatched = (job.unmatched || 0) + keys.length - Object.keys(matches).length;
          var unique = {};
          Object.keys(matches).forEach(function (key) {
            var episode = matches[key], id = episode.showId + '/' + episode.id;
            if (!unique[id]) unique[id] = {key: key, episode: episode, progress: observed[key]};
            else unique[id].progress = Math.max(unique[id].progress, observed[key]);
          });
          job.work = {remaining: Object.keys(unique).map(function (id) { return unique[id]; }), pending: []};
          save(); return submitBatch();
        });
      });
    }
    save();
    return processTitle().catch(function () {
      if (!active()) return;
      job.phase = 'error'; job.attempts = (job.attempts || 0) + 1; job.retryAt = Date.now() + 30000;
      if (job.attempts >= 3 && job.queue.length && !(job.work && job.work.pending.length)) {
        job.failed.push(job.queue[0]); finishTitle();
      } else save();
    }).then(function () {
      syncing = false;
      if (!active() || job.phase === 'done') return;
      syncTimer = setTimeout(function () { syncTimer = 0; syncHistory(account); }, job.retryAt ? Math.max(3500, job.retryAt - Date.now()) : 3500);
    });
  }

  function historyEnabled() { return localStorage.getItem(HISTORY) === '1'; }
  function setHistoryEnabled(value) {
    localStorage.setItem(HISTORY, value ? '1' : '0'); clearTimeout(syncTimer); syncTimer = 0;
    if (window.Data) Data.settingsChanged();
    if (value) {
      var account;
      try { account = JSON.parse(localStorage.getItem('fmtv.vokino.account')); } catch (e) {}
      syncHistory(account, true);
    }
  }
  window.VoKinoProgress = {prepare: prepare, resume: resume, cancel: cancel, syncHistory: syncHistory, historyStatus: historyStatus,
    historyEnabled: historyEnabled, setHistoryEnabled: setHistoryEnabled};
})();
