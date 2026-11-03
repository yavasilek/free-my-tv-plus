/* Section choices stay on the TV. Public catalog descriptors never contain credentials. */
(function () {
  'use strict';
  var KEY = 'fmtv.vokino.sections.v1', opened = false, selected = 0, column = 0, moving = false;
  var modal, list, hint, stamp, empty;
  var definitions = [
    {id: 'history', name: 'История', path: '/timeline/list', personal: true},
    {id: 'favorites', name: 'Избранное', path: '/bookmarks/bookmark_list', personal: true},
    {id: 'continue', name: 'Продолжить просмотр', source: 'history', personal: true},
    {id: 'popular', name: 'Популярное', path: '/list?sort=popular'},
    {id: 'new', name: 'Новинки', path: '/list?sort=new'},
    {id: 'updates', name: 'Обновления', path: '/list?sort=updatings'},
    {id: 'rating', name: 'Высокий рейтинг', path: '/list?sort=rating'},
    {id: 'movies', name: 'Фильмы', path: '/list?type=movie&sort=popular'},
    {id: 'series', name: 'Сериалы', path: '/list?type=serial&sort=popular'},
    {id: 'cartoons', name: 'Мультфильмы', path: '/list?type=multfilm&sort=popular'},
    {id: 'cartoon-series', name: 'Мультсериалы', path: '/list?type=multserial&sort=popular'},
    {id: 'documentaries', name: 'Документальные фильмы', path: '/list?type=documovie&sort=popular'},
    {id: 'documentary-series', name: 'Документальные сериалы', path: '/list?type=docuserial&sort=popular'},
    {id: 'anime', name: 'Аниме', path: '/list?type=anime&sort=popular'},
    {id: 'tvshows', name: 'ТВ-шоу', path: '/list?type=tvshow&sort=popular'}
  ];
  function definition(id) { for (var i = 0; i < definitions.length; i++) if (definitions[i].id === id) return definitions[i]; return null; }
  function hasAccount() {
    try { var a = JSON.parse(localStorage.getItem('fmtv.vokino.account')); return !!(a && /^https:\/\/api\.vokino\.(pro|co|org|tv)\/v2$/.test(a.base) && typeof a.token === 'string' && a.token.length > 8 && a.key); } catch (e) { return false; }
  }
  function defaults() {
    var active = hasAccount() ? ['history', 'favorites'] : ['popular'];
    return {order: definitions.map(function (d) { return d.id; }), enabled: active};
  }
  function normalize(value) {
    if (!value || !Array.isArray(value.order) || !Array.isArray(value.enabled)) return defaults();
    var order = [];
    value.order.concat(definitions.map(function (d) { return d.id; })).forEach(function (id) { if (definition(id) && order.indexOf(id) < 0) order.push(id); });
    var enabled = order.filter(function (id) { return value.enabled.indexOf(id) >= 0; });
    return {order: order, enabled: enabled};
  }
  var settings;
  try { settings = normalize(JSON.parse(localStorage.getItem(KEY))); } catch (e) { settings = defaults(); }
  function rows() {
    return settings.order.map(function (id) { var d = definition(id); return {id: id, name: d.name, personal: !!d.personal,
      enabled: settings.enabled.indexOf(id) >= 0}; });
  }
  function tabs() { return [{key: null, name: 'Обзор'}].concat(rows().filter(function (d) { return d.enabled; }).map(function (d) { return {key: 'vokino-' + d.id, name: d.name}; })); }
  function sources() {
    var ids = [];
    rows().forEach(function (d) { if (!d.enabled) return; var id = definition(d.id).source || d.id; if (ids.indexOf(id) < 0) ids.push(id); });
    return ids.map(definition);
  }
  function save() {
    // Mirror enabled into the legacy field so older builds can still read the choices.
    try { localStorage.setItem(KEY, JSON.stringify({order: settings.order, enabled: settings.enabled, overview: settings.enabled.slice()})); if (stamp) stamp.textContent = 'Сохранено'; }
    catch (e) { if (stamp) stamp.textContent = 'Не удалось сохранить'; }
    if (window.FreeMyTV && FreeMyTV.refreshVoKinoTabs) FreeMyTV.refreshVoKinoTabs();
    if (window.VoKinoBridge && VoKinoBridge.sectionsChanged) VoKinoBridge.sectionsChanged();
    render();
  }
  function enable(id, on) {
    if (!definition(id)) return false;
    settings.enabled = settings.enabled.filter(function (x) { return x !== id; });
    if (on) settings.enabled.push(id);
    save(); return true;
  }
  function move(id, direction) {
    var at = settings.order.indexOf(id), to = at + direction;
    if (at < 0 || to < 0 || to >= settings.order.length) return false;
    settings.order.splice(at, 1); settings.order.splice(to, 0, id); save(); return true;
  }
  function node(tag, cls, parent, text) {
    var e = document.createElement(tag); if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text; if (parent) parent.appendChild(e); return e;
  }
  function build() {
    if (modal) return;
    modal = node('div', 'layer sheet', document.getElementById('stage')); modal.id = 'vokino-sections';
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'vokino-sections-title');
    var box = node('div', 'sections-box', modal), title = node('h2', '', box, 'Разделы VoKino'); title.id = 'vokino-sections-title';
    node('div', 'sections-description', box, 'Все включенные разделы попадают в Обзор');
    var header = node('div', 'sections-header', box); node('span', 'section-name', header, 'Раздел');
    node('span', 'section-toggle', header, 'Показывать'); node('span', 'section-order', header, 'Порядок');
    list = node('div', 'sections-list', box);
    hint = node('div', 'sections-hint', box); stamp = node('div', 'sections-stamp', box); stamp.setAttribute('aria-live', 'polite');
  }
  function render() {
    if (!opened) return;
    var data = rows(), first = Math.max(0, Math.min(data.length - 7, selected - 3));
    list.textContent = '';
    for (var i = first; i < Math.min(data.length, first + 7); i++) (function (index) {
      var d = data[index], row = node('div', 'sections-row' + (selected === index ? ' selected' : ''), list);
      node('span', 'section-name', row, d.name);
      for (var j = 0; j < 2; j++) (function (action) {
        var button = node('button', (action === 1 ? 'section-order' : 'section-toggle') + (selected === index && column === action ? ' focus' : ''), row,
          action === 0 ? d.enabled ? 'Да' : 'Нет' : (index + 1) + (moving && selected === index ? ' ↑↓' : ' ↕'));
        button.type = 'button'; button.setAttribute('aria-label', d.name + ': ' + ['показывать', 'порядок'][action]);
        if (action === 0) button.setAttribute('aria-pressed', d.enabled ? 'true' : 'false');
        button.onmouseover = function () { if (!moving && (selected !== index || column !== action)) { selected = index; column = action; render(); } };
        button.onclick = function () { selected = index; column = action; activate(); };
      })(j);
    })(i);
    hint.textContent = moving ? '↑↓ - изменить порядок · OK - готово · Back - завершить' : '↑↓ - раздел · ←→ - действие · OK - выбрать · Back - закрыть';
  }
  function activate() {
    if (moving) { moving = false; render(); return; }
    var d = rows()[selected];
    if (column === 0) enable(d.id, !d.enabled);
    else { moving = true; render(); }
  }
  function open() {
    if (!window.FreeMyTV || opened) return;
    build(); FreeMyTV.hideSaver(); FreeMyTV.hideAmbient(); FreeMyTV.poke();
    document.getElementById('settings').classList.remove('open');
    opened = true; selected = 0; column = 0; moving = false; stamp.textContent = '';
    FreeMyTV.state.zone = 'vokino-sections'; FreeMyTV.move(0, 0); modal.classList.add('open'); render();
  }
  function close(restore) {
    if (!opened) return; opened = false; moving = false; modal.classList.remove('open');
    if (restore !== false) FreeMyTV.showSectionSettings();
  }
  document.addEventListener('keydown', function (e) {
    if (!opened) return;
    var k = e.keyCode;
    if ([TV.keys.up, TV.keys.down, TV.keys.left, TV.keys.right, TV.keys.ok, TV.keys.back, 27, 8].indexOf(k) < 0) return;
    e.preventDefault(); e.stopImmediatePropagation(); FreeMyTV.poke();
    if (k === TV.keys.up || k === TV.keys.down) {
      var direction = k === TV.keys.down ? 1 : -1, next = Math.max(0, Math.min(settings.order.length - 1, selected + direction));
      if (moving && next !== selected) { var id = settings.order[selected]; selected = next; move(id, direction); }
      else { selected = next; render(); }
    } else if (!moving && (k === TV.keys.left || k === TV.keys.right)) { column = Math.max(0, Math.min(1, column + (k === TV.keys.right ? 1 : -1))); render(); }
    else if (k === TV.keys.ok) activate();
    else if (k === TV.keys.back || k === 27 || k === 8) { if (moving) { moving = false; render(); } else close(); }
  }, true);
  window.VoKinoSections = {
    all: rows, definition: definition, tabs: tabs, sources: sources, hasAccount: hasAccount,
    enable: enable, move: move, open: open, close: close,
    refreshEmpty: function (key, count) {
      if (!empty) { empty = node('div', '', document.getElementById('stage')); empty.id = 'vokino-empty'; }
      empty.hidden = count > 0;
      var def = key && definition(key.slice(7));
      empty.textContent = window.VoKinoBridge && VoKinoBridge.inFlight ? 'Загружаем карточки...' :
        key === null && !rows().some(function (d) { return d.enabled; }) ? 'Включите разделы VoKino в настройках' :
        def && def.personal && !hasAccount() ? 'Для этого раздела нужен подключенный аккаунт VoKino' :
        window.VoKinoBridge && VoKinoBridge.error ? 'Не удалось обновить раздел. Попробуем позже.' : 'В этом разделе пока нет доступных карточек';
    },
    reveal: function (index) {
      var strip = document.getElementById('tabs'), tab = strip && strip.children[index]; if (!tab) return;
      var quotes = document.getElementById('quotes'), width = 1340;
      if (quotes && quotes.children.length) {
        var scale = document.getElementById('stage').getBoundingClientRect().width / 1920;
        if (scale > 0) width = Math.max(320, Math.min(width, Math.floor((quotes.getBoundingClientRect().left - strip.getBoundingClientRect().left) / scale - 24)));
      }
      if (strip.style.width !== width + 'px') strip.style.width = width + 'px';
      if (tab.offsetLeft < strip.scrollLeft) strip.scrollLeft = tab.offsetLeft;
      else if (tab.offsetLeft + tab.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = tab.offsetLeft + tab.offsetWidth - strip.clientWidth;
    },
    isOpen: function () { return opened; }, selection: function () { return {row: selected, column: column, moving: moving}; }
  };
})();
