/* Service rows and tabs are configured independently; legacy VoKino choices migrate. */
(function () {
  'use strict';
  var KEY = 'fmtv.catalogs.v1', listeners = [];
  var defs = {
    kinopoisk: {name: 'Кинопоиск', tabs: [
      {id: 'overview', name: 'Обзор'}, {id: 'popular', name: 'Популярное', type: 'TOP_POPULAR_ALL'},
      {id: 'movies', name: 'Фильмы', type: 'TOP_POPULAR_MOVIES'}, {id: 'series', name: 'Сериалы', type: 'POPULAR_SERIES'},
      {id: 'top250', name: 'Топ-250', type: 'TOP_250_MOVIES'}, {id: 'family', name: 'Семейное', type: 'FAMILY'},
      {id: 'cartoons', name: 'Мультфильмы', type: 'KIDS_ANIMATION_THEME'}, {id: 'upcoming', name: 'Скоро', type: 'CLOSES_RELEASES'}]},
    vokino: {name: 'VoKino', tabs: [{id: 'overview', name: 'Обзор'}].concat(VoKinoSections.all().map(function (d) { return {id: d.id, name: d.name}; }))},
    ivi: {name: 'Иви', tabs: [{id: 'overview', name: 'Обзор'}, {id: 'movies', name: 'Фильмы', category: 14}, {id: 'series', name: 'Сериалы', category: 15}, {id: 'cartoons', name: 'Мультфильмы', category: 17}]}
  };
  function known(id) { return Object.prototype.hasOwnProperty.call(defs, id); }
  function tab(service, id) { var rows = known(service) ? defs[service].tabs : []; for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i]; return null; }
  function order(values, defaults) { var out = []; (Array.isArray(values) ? values : []).concat(defaults).forEach(function (id) { if (defaults.indexOf(id) >= 0 && out.indexOf(id) < 0) out.push(id); }); return out; }
  var fallbackEnabled = ['vokino'];
  if (TopControls.kinopoiskApp() && KinopoiskCatalog.hasKey()) fallbackEnabled.push('kinopoisk');
  if (TopControls.iviApp()) fallbackEnabled.push('ivi');
  var saved; try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  var settings = {order: order(saved && saved.order, ['kinopoisk', 'vokino', 'ivi']), enabled: saved && Array.isArray(saved.enabled) ? saved.enabled.filter(known) : fallbackEnabled, tabs: {}};
  Object.keys(defs).forEach(function (id) {
    var value = saved && saved.tabs && saved.tabs[id], ids = defs[id].tabs.map(function (t) { return t.id; });
    var active = id === 'vokino' ? ['overview'].concat(VoKinoSections.all().filter(function (d) { return d.enabled; }).map(function (d) { return d.id; })) : id === 'kinopoisk' ? ['overview', 'popular', 'movies', 'series'] : ['overview', 'movies', 'series'];
    settings.tabs[id] = {order: order(value && value.order, ids), enabled: value && Array.isArray(value.enabled) ? value.enabled.filter(function (key) { return ids.indexOf(key) >= 0; }) : active};
  });
  function services() { return settings.order.map(function (id) { return {id: id, name: defs[id].name, enabled: settings.enabled.indexOf(id) >= 0}; }); }
  function tabs(service, all) {
    if (!known(service)) return [];
    var value = settings.tabs[service], legacy = service === 'vokino' ? VoKinoSections.all() : [];
    return value.order.map(function (id) {
      var definition = tab(service, id), on = value.enabled.indexOf(id) >= 0;
      if (service === 'vokino' && id !== 'overview') on = legacy.some(function (d) { return d.id === id && d.enabled; });
      return {id: id, name: definition.name, enabled: on};
    }).filter(function (t) { return all || t.enabled; });
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {}
    listeners.forEach(function (fn) { fn(); }); render();
  }
  function enableService(id, on) { if (!known(id)) return false; settings.enabled = settings.enabled.filter(function (x) { return x !== id; }); if (on) settings.enabled.push(id); save(); return true; }
  function moveIn(list, id, direction) { var at = list.indexOf(id), to = at + direction; if (at < 0 || to < 0 || to >= list.length) return false; list.splice(at, 1); list.splice(to, 0, id); return true; }
  function moveService(id, direction) { if (!moveIn(settings.order, id, direction)) return false; save(); return true; }
  function enableTab(service, id, on) {
    if (!tab(service, id)) return false;
    var value = settings.tabs[service]; value.enabled = value.enabled.filter(function (x) { return x !== id; }); if (on) value.enabled.push(id);
    if (service === 'vokino' && id !== 'overview') VoKinoSections.enable(id, on);
    save(); return true;
  }
  function moveTab(service, id, direction) {
    if (!known(service) || !moveIn(settings.tabs[service].order, id, direction)) return false;
    if (service === 'vokino' && id !== 'overview') {
      var desired = settings.tabs[service].order.filter(function (x) { return x !== 'overview'; }), actual = VoKinoSections.all().map(function (d) { return d.id; });
      if (desired.indexOf(id) !== actual.indexOf(id)) VoKinoSections.move(id, direction);
    }
    save(); return true;
  }
  var modal, title, description, header, list, hint, opened = false, service = '', selected = 0, column = 0, moving = false;
  function node(tag, cls, parent, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; if (parent) parent.appendChild(e); return e; }
  function render() {
    if (!opened) return;
    var data = service ? tabs(service, true) : services(), first = Math.max(0, Math.min(data.length - 7, selected - 3));
    title.textContent = service ? 'Вкладки: ' + defs[service].name : 'Каталоги и вкладки';
    description.textContent = service ? 'Обзор собирается из всех включенных вкладок этого сервиса' : 'Выберите сервисы, их порядок и вкладки каждого ряда';
    header.textContent = ''; node('span', 'section-name', header, service ? 'Вкладка' : 'Сервис'); node('span', 'section-toggle', header, 'Показывать'); node('span', 'section-order', header, 'Порядок'); if (!service) node('span', 'section-order', header, 'Вкладки');
    list.textContent = '';
    for (var i = first; i < Math.min(data.length, first + 7); i++) (function (index) {
      var d = data[index], row = node('div', 'sections-row' + (index === selected ? ' selected' : ''), list); node('span', 'section-name', row, d.name);
      for (var j = 0; j < (service ? 2 : 3); j++) (function (action) {
        var button = node('button', (action === 0 ? 'section-toggle' : 'section-order') + (index === selected && action === column ? ' focus' : ''), row, action === 0 ? d.enabled ? 'Да' : 'Нет' : action === 1 ? String(index + 1) + (moving && selected === index ? ' ↑↓' : ' ↕') : '›');
        button.type = 'button'; button.setAttribute('aria-label', d.name + ': ' + ['показывать', 'порядок', 'вкладки'][action]); if (!action) button.setAttribute('aria-pressed', d.enabled ? 'true' : 'false');
        button.onclick = function () { selected = index; column = action; activate(); };
      })(j);
    })(i);
    hint.textContent = moving ? '↑↓ - изменить порядок · OK или Back - готово' : '↑↓ - строка · ←→ - действие · OK - выбрать · Back - назад';
  }
  function activate() {
    if (moving) { moving = false; render(); return; }
    var row = (service ? tabs(service, true) : services())[selected]; if (!row) return;
    if (!column) { if (service) enableTab(service, row.id, !row.enabled); else enableService(row.id, !row.enabled); }
    else if (column === 1) { moving = true; render(); }
    else { service = row.id; selected = 0; column = 0; render(); }
  }
  function open(id) {
    if (!modal) {
      modal = node('div', 'layer sheet', document.getElementById('stage')); modal.id = 'catalog-config'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
      var box = node('div', 'sections-box', modal); title = node('h2', '', box); description = node('div', 'sections-description', box); header = node('div', 'sections-header', box); list = node('div', 'sections-list', box); hint = node('div', 'sections-hint', box);
    }
    FreeMyTV.hideSaver(); FreeMyTV.hideAmbient(); FreeMyTV.poke(); document.getElementById('settings').classList.remove('open'); opened = true; service = known(id) ? id : ''; selected = 0; column = 0; moving = false; FreeMyTV.state.zone = 'catalog-config'; modal.classList.add('open'); render();
  }
  function close(restore) { if (!opened) return; opened = false; modal.classList.remove('open'); if (restore !== false) FreeMyTV.showCatalogSettings(); }
  document.addEventListener('keydown', function (e) {
    if (!opened) return; var key = e.keyCode;
    if ([37, 38, 39, 40, 13, 10009, 461, 27, 8].indexOf(key) < 0) return;
    e.preventDefault(); e.stopImmediatePropagation(); FreeMyTV.poke();
    if (key === 38 || key === 40) {
      var delta = key === 38 ? -1 : 1, data = service ? tabs(service, true) : services(), next = Math.max(0, Math.min(data.length - 1, selected + delta));
      if (moving && next !== selected) { var id = data[selected].id; selected = next; if (service) moveTab(service, id, delta); else moveService(id, delta); } else { selected = next; render(); }
    } else if (key === 37 || key === 39) { if (!moving) column = Math.max(0, Math.min(service ? 1 : 2, column + (key === 39 ? 1 : -1))); render(); }
    else if (key === 13) activate();
    else if (moving) { moving = false; render(); }
    else if (service) { service = ''; selected = 0; column = 0; render(); }
    else close();
  }, true);
  function syncVoKino() {
    var value = settings.tabs.vokino, overviewAt = value.order.indexOf('overview'), legacy = VoKinoSections.all();
    value.order = legacy.map(function (d) { return d.id; }); value.order.splice(Math.max(0, Math.min(value.order.length, overviewAt)), 0, 'overview');
    value.enabled = legacy.filter(function (d) { return d.enabled; }).map(function (d) { return d.id; }).concat(value.enabled.indexOf('overview') >= 0 ? ['overview'] : []); save();
  }
  window.CatalogConfig = {services: services, tabs: tabs, definition: tab, enableService: enableService, moveService: moveService, enableTab: enableTab, moveTab: moveTab, onChange: function (fn) { listeners.push(fn); }, open: open, close: close, isOpen: function () { return opened; }, syncVoKino: syncVoKino};
})();
