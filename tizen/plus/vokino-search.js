/* Remote-first search: native TV keyboard, five visible rows, no image effects. */
(function () {
  'use strict';
  window.createMovieSearch = function (options) {
  var bridge = options.bridge, opened = false, cursor = -2, first = -1, rendered = null;
  var prefix = options.id, service = options.name, where = options.where || service;
  var modal, input, submit, list, status, pageLabel, previous, next, rows = [], typingTimer = 0, valueWatcher = 0, observedValue = '', renderedCount = 0;
  function node(tag, cls, parent, value) {
    var e = document.createElement(tag); if (cls) e.className = cls;
    if (value !== undefined) e.textContent = value; if (parent) parent.appendChild(e); return e;
  }
  function state() { return bridge.searchState; }
  function touch() { if (window.FreeMyTV && FreeMyTV.poke) FreeMyTV.poke(); }
  function focusClass(e, on) { e.classList.toggle('search-focus', on); }
  function build() {
    if (modal) return;
    modal = node('div', 'layer sheet movie-search', document.getElementById('stage')); modal.id = prefix;
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', prefix + '-title');
    var box = node('div', 'box', modal), title = node('h2', 'search-title', box, (options.title || 'Поиск ' + service)); title.id = prefix + '-title';
    var label = node('label', 'search-label', box, 'Название фильма или сериала'); label.htmlFor = prefix + '-query';
    var form = node('div', 'search-form', box);
    input = node('input', 'search-query', form); input.id = prefix + '-query'; input.type = 'text'; input.maxLength = 120;
    input.placeholder = 'Например, Интерстеллар'; input.setAttribute('autocomplete', 'off'); input.setAttribute('spellcheck', 'false');
    input.onfocus = function () { cursor = -2; startValueWatch(); queueSearch(); paint(); };
    input.onblur = function () { stopValueWatch(); paint(); };
    input.oninput = queueSearch;
    input.addEventListener('compositionstart', queueSearch);
    input.addEventListener('compositionupdate', queueSearch);
    input.addEventListener('compositionend', queueSearch);
    submit = node('button', 'search-submit', form, 'Найти'); submit.type = 'button'; submit.onclick = function () { run(1); };
    status = node('div', 'search-status', box); status.setAttribute('aria-live', 'polite');
    list = node('div', 'search-results', box); list.setAttribute('aria-label', 'Результаты поиска');
    var paging = node('div', 'search-paging', box);
    previous = node('button', 'search-page', paging, 'Назад'); previous.type = 'button'; previous.onclick = function () { if (state().page > 1) run(state().page - 1); };
    pageLabel = node('span', 'search-page-label', paging);
    next = node('button', 'search-page', paging, 'Далее'); next.type = 'button'; next.onclick = function () { if (state().nextPage) run(state().nextPage); };
    node('div', 'search-hint', box, '↑↓ - выбрать · OK - открыть · ← → - страницы · Back - закрыть');
  }
  function paint() {
    if (!opened) return;
    var s = state(), compact = document.activeElement === input || window.innerHeight < window.innerWidth * 800 / 1920, count = compact ? 2 : 5;
    modal.classList.toggle('search-editing', compact);
    var start = Math.max(0, Math.min(Math.max(0, s.items.length - count), Math.max(0, cursor - 2)));
    status.textContent = s.opening ? 'Открываем в ' + where + '...' : typingTimer ? 'Ищем в ' + where + '...' : options.status && s.query.length >= 2 ? options.status() : s.loading ? 'Ищем в ' + where + '...' : s.error || (!s.query ? 'Введите минимум 2 символа - поиск начнется автоматически.' : !s.items.length ? 'Ничего не найдено. Попробуйте другое название.' : 'Результатов на странице: ' + s.items.length);
    modal.setAttribute('aria-busy', s.loading || s.opening ? 'true' : 'false');
    submit.textContent = s.loading ? 'Ищем...' : 'Найти';
    previous.disabled = s.loading || s.page <= 1; next.disabled = s.loading || !s.nextPage;
    pageLabel.textContent = s.query ? 'Страница ' + s.page : '';
    if (rendered !== s.items || first !== start || renderedCount !== count) {
      rendered = s.items; first = start; renderedCount = count; list.textContent = ''; rows = [];
      var visible = Math.min(count, s.items.length - start); list.style.height = Math.max(1, visible) * 96 + 'px';
      for (var i = start; i < start + visible; i++) (function (index) {
        var p = s.items[index], row = node('button', 'search-result', list); row.type = 'button';
        var url = options.image ? options.image(p) : Data.image(p.poster || p.backdrop, 'w300');
        if (url) { var poster = node('img', 'search-poster', row); poster.alt = ''; poster.onerror = function () { this.hidden = true; }; poster.src = url; }
        var text = node('span', 'search-result-text', row); node('span', 'search-name', text, p.title); node('span', 'search-meta', text, p.meta);
        var badge = options.annotation ? node('span', 'search-availability', row) : null;
        row.onclick = function () { cursor = index; activate(); };
        row.onmouseover = function () { if (document.activeElement !== input) { cursor = index; paint(); } };
        rows.push({index: index, element: row, badge: badge});
      })(i);
    }
    focusClass(input, cursor === -2); focusClass(submit, cursor === -1);
    rows.forEach(function (r) {
      focusClass(r.element, r.index === cursor);
      if (r.badge) {
        var info = options.annotation(s.items[r.index]);
        r.badge.hidden = !info; r.badge.textContent = info ? info.text : '';
        r.element.classList.toggle('has-availability', !!info); r.badge.classList.toggle('unavailable', !!info && info.kind === 'unavailable');
      }
    });
    focusClass(previous, cursor === s.items.length && !previous.disabled);
    focusClass(next, cursor === s.items.length + 1 && !next.disabled);
    if (options.visible) options.visible(rows.map(function (r) { return s.items[r.index]; }), paint);
  }
  function refresh() {
    if (options.incremental && cursor >= 0 && rendered && rendered !== state().items) {
      var index = state().items.indexOf(rendered[cursor]);
      if (index >= 0) cursor = index;
    }
    paint();
  }
  function queryValue() { return input.value.replace(/\s+/g, ' ').trim(); }
  function stopValueWatch() { if (valueWatcher) clearInterval(valueWatcher); valueWatcher = 0; }
  function startValueWatch() {
    stopValueWatch();
    // Samsung's first IME composition can update .value without an input event.
    // Compare text only while this field is focused; unchanged text does no work.
    valueWatcher = setInterval(function () { if (opened && document.activeElement === input) queueSearch(); }, 150);
  }
  function queueSearch() {
    if (!opened) return;
    if (input.value === observedValue) return;
    observedValue = input.value; touch(); clearTimeout(typingTimer); typingTimer = 0;
    if (options.incremental) bridge.cancelSearch();
    if (queryValue().length < 2) { bridge.search(input.value, 1, function () { paint(); }); return; }
    typingTimer = setTimeout(function () { typingTimer = 0; run(1, true); }, 400); paint();
  }
  function run(page, live) {
    if (!opened) return;
    touch(); clearTimeout(typingTimer); typingTimer = 0;
    var editing = document.activeElement === input;
    if (!live) { input.blur(); cursor = -1; }
    if (queryValue() === state().query && page === state().page &&
        (state().loading || (!state().error && !state().retry) || (options.incremental && editing && state().items.length))) {
      if ((!state().loading || options.incremental) && !live) cursor = state().items.length ? 0 : -1;
      paint(); return;
    }
    if (options.incremental && document.activeElement !== input) cursor = -1;
    bridge.search(input.value, page, function () {
      if (!opened) return;
      if (!options.incremental || cursor < 0) {
        cursor = document.activeElement === input ? -2 : state().items.length && (!state().error || options.incremental) ? 0 : -1;
        paint();
      } else refresh();
    });
    paint();
  }
  function open(selection, keyboard) {
    if (!window.FreeMyTV) return;
    build(); FreeMyTV.hideSaver(); touch(); opened = true;
    FreeMyTV.state.zone = prefix;
    modal.classList.add('open'); input.value = state().query; observedValue = input.value;
    window.dispatchEvent(new Event('resize'));
    cursor = selection && typeof selection.cursor === 'number' ? Math.max(-2, Math.min(state().items.length - 1, selection.cursor)) : -2;
    first = -1; paint();
    if (keyboard !== false) setTimeout(function () {
      if (!opened || cursor !== -2) return;
      input.focus(); try { input.setSelectionRange(0, input.value.length); } catch (e) {}
    }, 50);
  }
  function close(restore) {
    if (!opened) return;
    opened = false; stopValueWatch(); clearTimeout(typingTimer); typingTimer = 0; input.blur(); modal.classList.remove('open'); bridge.cancelSearch();
    if (options.visible) options.visible([], paint);
    window.dispatchEvent(new Event('resize'));
    if (restore !== false && options.returnTo && options.returnTo()) return;
    if (restore !== false && window.FreeMyTV) {
      FreeMyTV.state.zone = 'top'; FreeMyTV.state.top = (window.VoKinoSections ? VoKinoSections.tabs().length : 3) + options.slot; FreeMyTV.move(0, 0); touch();
    }
  }
  function activate() {
    var s = state(); touch();
    if (cursor === -2) { input.focus(); return; }
    if (cursor === -1) { run(1); return; }
    if ((s.loading && !options.incremental) || s.opening || (typingTimer && options.incremental)) return;
    if (cursor < s.items.length) {
      var p = s.items[cursor]; if (p) (options.launch || function (item, done) { TV.launch(item.app, null, done); })(p, function (ok, error) { if (!ok) { s.error = error || 'Не удалось открыть ' + (options.appName || service) + '. Попробуйте еще раз.'; paint(); } });
      paint();
    } else if (!s.loading && cursor === s.items.length && s.page > 1) run(s.page - 1);
    else if (!s.loading && cursor === s.items.length + 1 && s.nextPage) run(s.nextPage);
  }
  function positions() {
    var s = state(), out = [-2, -1];
    if (!s.loading || options.incremental) for (var i = 0; i < s.items.length; i++) out.push(i);
    if (!s.loading) {
      if (s.page > 1) out.push(s.items.length);
      if (s.nextPage) out.push(s.items.length + 1);
    }
    return out;
  }
  document.addEventListener('keydown', function (e) {
    if (!opened) return;
    var k = e.keyCode, editing = document.activeElement === input, back = k === 10009 || k === 27 || k === 65385;
    touch(); e.stopImmediatePropagation();
    if (editing) {
      if (k === 13 || k === 65376) { e.preventDefault(); run(1); }
      else if (back || k === 38 || k === 40) { e.preventDefault(); run(1); }
      return; // Native IME and character editing keep their default action.
    }
    if (back || k === 8) { e.preventDefault(); close(); return; }
    if (k === 13 || k === 65376) { e.preventDefault(); activate(); return; }
    if (k === 38 || k === 40) {
      e.preventDefault(); var options = positions(), at = options.indexOf(cursor);
      cursor = options[Math.max(0, Math.min(options.length - 1, at + (k === 40 ? 1 : -1)))]; paint();
    } else if (k === 37 || k === 39) {
      e.preventDefault(); var s = state();
      if (cursor < 0) { cursor = k === 37 ? -2 : -1; paint(); }
      else if (!s.loading && k === 37 && s.page > 1) run(s.page - 1);
      else if (!s.loading && k === 39 && s.nextPage) run(s.nextPage);
    }
  }, true);
  window.addEventListener('resize', function () { if (opened) paint(); });
  return {
    revision: 2,
    open: function () { if (options.allowed && !options.allowed()) return; open(null, true); }, close: close,
    restore: function (selection) { open(selection, false); },
    openQuery: function (query) { open(null, false); input.value = observedValue = query; run(1); },
    selection: function () { return opened ? {cursor: cursor} : null; },
    submit: function () { run(1); }, refresh: refresh, isOpen: function () { return opened; }
  };
  };
  window.VoKinoSearch = createMovieSearch({bridge: window.VoKinoBridge, id: 'vokino-search', name: 'VoKino', slot: 3});
})();
