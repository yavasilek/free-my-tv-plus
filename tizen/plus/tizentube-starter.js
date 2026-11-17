/* Start the Cobalt player only after its local proxy and internet are ready. */
(function () {
  'use strict';
  var player = 'xvvl3S1TT1.TizenTubeStandalone';
  var service = 'FMTVTube01.StandaloneService';
  var attempt = 0, stopped = false, opening = false, timer = null, request = null;
  function message(text) { document.getElementById('status').textContent = text; }
  function cancel() {
    stopped = true; attempt++; clearTimeout(timer);
    if (request) request.abort(); request = null;
  }
  function ready(current, deadline) {
    if (stopped || opening || current !== attempt || document.hidden) return;
    if (Date.now() >= deadline) {
      message('Не удалось подключиться. OK — повторить, Назад — выйти.'); return;
    }
    var xhr = request = new XMLHttpRequest(), settled = false;
    function finish(ok) {
      if (settled) return; settled = true;
      if (request === xhr) request = null;
      if (stopped || current !== attempt || document.hidden) return;
      if (!ok) { timer = setTimeout(function () { timer = null; ready(current, deadline); }, 700); return; }
      opening = true; message('Открываем YouTube…');
      try {
        tizen.application.launch(player, function () {
          if (stopped || current !== attempt) return;
          cancel(); tizen.application.getCurrentApplication().exit();
        }, function () {
          opening = false;
          message('Не удалось открыть TizenTube. OK — повторить, Назад — выйти.');
        });
      } catch (e) { opening = false; message('TizenTube не установлен. Назад — выйти.'); }
    }
    xhr.open('GET', 'http://127.0.0.1:8102/fmtv/ready', true); xhr.timeout = 3500;
    xhr.onload = function () { finish(xhr.status === 204); };
    xhr.onerror = xhr.ontimeout = function () { finish(false); };
    try { xhr.send(); } catch (e) { finish(false); }
  }
  function start() {
    cancel(); stopped = false; opening = false;
    var current = attempt, deadline = Date.now() + 20000;
    message('Подключаем YouTube…');
    // A package may start its own service. Launching TizenTube's service from
    // Free My TV is refused on retail Samsung firmware.
    try {
      tizen.application.launchAppControl(new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/service'),
        service, function () {}, function () {});
    } catch (e) {}
    ready(current, deadline);
  }
  document.addEventListener('keydown', function (event) {
    if (event.keyCode === 10009 || event.keyCode === 27) {
      cancel(); tizen.application.getCurrentApplication().exit();
    } else if (event.keyCode === 13 && !opening && !request && !timer) start();
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden && !opening) cancel(); });
  window.addEventListener('pagehide', cancel);
  window.addEventListener('load', start);
})();
