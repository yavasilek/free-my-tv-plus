/* Remote-friendly dock appearance. Only the dock background receives alpha. */
(function () {
  'use strict';
  var KEY = 'fmtv.dock-style.v1', opened = false, row = 0, modal, holder, savedLabel;
  var colors = [
    ['Белый', '#FFFFFF'], ['Черный', '#000000'], ['Графит', '#111111'], ['Серый', '#666666'],
    ['Красный', '#FF453A'], ['Оранжевый', '#FF9F0A'], ['Желтый', '#FFD60A'], ['Зеленый', '#30D158'],
    ['Голубой', '#64D2FF'], ['Синий', '#0A84FF'], ['Розовый', '#FF375F'], ['Фиолетовый', '#BF5AF2']
  ];
  function defaults() { return {border: '#FFFFFF', dock: '#111111', transparency: 40}; }
  function color(value, fallback) { return typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value) ? value.toUpperCase() : fallback; }
  function normalize(value) {
    var base = defaults(); value = value && typeof value === 'object' ? value : {};
    base.border = color(value.border, base.border); base.dock = color(value.dock, base.dock);
    if (typeof value.transparency === 'number' && isFinite(value.transparency)) base.transparency = Math.max(0, Math.min(100, Math.round(value.transparency)));
    return base;
  }
  var settings = defaults();
  try { settings = normalize(JSON.parse(localStorage.getItem(KEY))); } catch (e) {}
  var style = document.createElement('style'); style.id = 'dock-style-values'; document.head.appendChild(style);
  function apply() {
    var hex = settings.dock.slice(1), channels = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    style.textContent = '#platter{background:rgba(' + channels.join(',') + ',' + (100 - settings.transparency) / 100 + ')!important;box-shadow:none!important;}' +
      '#tiles .tile.focus::before,#tiles .tile.dock-preview::before{border-color:' + settings.border + ';}';
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); if (savedLabel) savedLabel.textContent = 'Сохранено'; }
    catch (e) { if (savedLabel) savedLabel.textContent = 'Не удалось сохранить'; }
    apply();
  }
  function node(tag, cls, parent, text) {
    var item = document.createElement(tag); if (cls) item.className = cls;
    if (text !== undefined) item.textContent = text; if (parent) parent.appendChild(item); return item;
  }
  function name(hex) { for (var i = 0; i < colors.length; i++) if (colors[i][1] === hex) return colors[i][0]; return 'Свой цвет'; }
  function preview() {
    var tiles = document.querySelectorAll('#tiles .tile'), selected = FreeMyTV.state.shelf;
    for (var i = 0; i < tiles.length; i++) tiles[i].classList.toggle('dock-preview', opened && i === selected);
  }
  function render() {
    if (!opened) return;
    holder.textContent = '';
    var labels = ['Цвет рамки', 'Цвет дока', 'Прозрачность дока', 'Сбросить оформление'];
    for (var i = 0; i < labels.length; i++) (function (index) {
      var item = node('button', 'dock-style-row' + (row === index ? ' focus' : ''), holder); item.type = 'button';
      node('span', 'dock-style-name', item, labels[index]);
      var value = node('span', 'dock-style-value', item);
      if (index < 2) {
        var hex = index === 0 ? settings.border : settings.dock;
        var swatch = node('span', 'dock-swatch', value); swatch.style.backgroundColor = hex;
        node('span', '', value, '‹ ' + name(hex) + ' ›');
      } else if (index === 2) value.textContent = '‹ ' + settings.transparency + '% ›';
      item.onmouseover = function () { if (row !== index) { row = index; render(); } };
      item.onclick = function () { row = index; change(1); };
    })(i);
  }
  function build() {
    if (modal) return;
    modal = node('div', 'layer sheet', document.getElementById('stage')); modal.id = 'dock-style';
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'dock-style-title');
    var box = node('div', 'dock-style-box', modal);
    var title = node('h2', '', box, 'Оформление дока'); title.id = 'dock-style-title';
    node('div', 'dock-style-description', box, 'Результат сразу виден в нижней панели');
    holder = node('div', 'dock-style-rows', box);
    var footer = node('div', 'dock-style-footer', box);
    node('span', '', footer, '↑↓ - выбрать · ←→ - изменить · Back - готово');
    savedLabel = node('span', 'dock-style-saved', footer, ''); savedLabel.setAttribute('aria-live', 'polite');
  }
  function change(direction) {
    FreeMyTV.poke();
    if (row < 2) {
      var key = row === 0 ? 'border' : 'dock', at = -1;
      for (var i = 0; i < colors.length; i++) if (colors[i][1] === settings[key]) at = i;
      settings[key] = colors[(at + direction + colors.length) % colors.length][1];
    } else if (row === 2) settings.transparency = Math.max(0, Math.min(100, settings.transparency + 5 * direction));
    else settings = defaults();
    save(); render();
  }
  function open() {
    if (!window.FreeMyTV || opened) return;
    build(); FreeMyTV.hideSaver(); FreeMyTV.hideAmbient(); FreeMyTV.poke();
    document.getElementById('settings').classList.remove('open');
    FreeMyTV.state.zone = 'dock-style'; opened = true; row = 0; savedLabel.textContent = '';
    FreeMyTV.move(0, 0); modal.classList.add('open'); render(); preview();
  }
  function close(restore) {
    if (!opened) return;
    opened = false; modal.classList.remove('open'); preview();
    if (restore !== false) FreeMyTV.showDockSettings();
  }
  document.addEventListener('keydown', function (e) {
    if (!opened) return;
    var k = e.keyCode;
    if ([TV.keys.up, TV.keys.down, TV.keys.left, TV.keys.right, TV.keys.ok, TV.keys.back, 27, 8].indexOf(k) < 0) return;
    e.stopImmediatePropagation(); e.preventDefault(); FreeMyTV.poke();
    if (k === TV.keys.up || k === TV.keys.down) { row = Math.max(0, Math.min(3, row + (k === TV.keys.down ? 1 : -1))); render(); }
    else if (k === TV.keys.left || k === TV.keys.right) change(k === TV.keys.left ? -1 : 1);
    else if (k === TV.keys.ok) change(1);
    else if (k === TV.keys.back || k === 27 || k === 8) close();
  }, true);
  window.DockStyle = {
    open: open, close: close, isOpen: function () { return opened; },
    values: function () { return {border: settings.border, dock: settings.dock, transparency: settings.transparency}; }
  };
  apply();
})();
