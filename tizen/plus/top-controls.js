/* Optional utility icons retain stable action IDs; Settings and Search stay reachable. */
(function () {
  'use strict';
  var KEY = 'fmtv.top-controls.v1', saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
  var values = {liveTV: saved.liveTV !== false, inputs: saved.inputs !== false, vokino: saved.vokino !== false, kinopoisk: saved.kinopoisk !== false, ivi: saved.ivi !== false};
  function kinopoiskApp() {
    var ids = window.VoKinoBridge ? VoKinoBridge.favorites() : [];
    for (var i = 0; i < ids.length; i++) if (/\.kpTizen$/i.test(ids[i])) return ids[i];
    return '';
  }
  function slots() {
    var out = []; if (values.liveTV) out.push(0); if (values.inputs) out.push(1);
    out.push(2); if (values.vokino) out.push(3); if (kinopoiskApp() && values.kinopoisk) out.push(4); if (iviApp() && values.ivi) out.push(5); return out;
  }
  function iviApp() { var ids = window.VoKinoBridge ? VoKinoBridge.favorites() : []; for (var i = 0; i < ids.length; i++) if (/\.ivi$/i.test(ids[i])) return ids[i]; return ''; }
  window.TopControls = {
    values: function () { return {liveTV: values.liveTV, inputs: values.inputs, vokino: values.vokino, kinopoisk: values.kinopoisk, ivi: values.ivi}; },
    kinopoiskApp: kinopoiskApp, iviApp: iviApp,
    slots: slots,
    preferred: function (last) { var visible = slots(); return visible.indexOf(last) >= 0 ? last : visible[0]; },
    step: function (current, direction, tabs) {
      var stops = [], actions = slots();
      for (var i = 0; i < tabs; i++) stops.push(i);
      actions.forEach(function (slot) { stops.push(tabs + slot); });
      var at = stops.indexOf(current);
      if (at < 0) return tabs + actions[0];
      return stops[Math.max(0, Math.min(stops.length - 1, at + direction))];
    },
    toggle: function (key) {
      if (key !== 'liveTV' && key !== 'inputs' && key !== 'vokino' && (key !== 'kinopoisk' || !kinopoiskApp()) && (key !== 'ivi' || !iviApp())) return;
      values[key] = !values[key];
      try { localStorage.setItem(KEY, JSON.stringify(values)); } catch (e) {}
      if (window.FreeMyTV && FreeMyTV.refreshTopControls) FreeMyTV.refreshTopControls();
    }
  };
})();
