/* Independent, remote-navigable service rows above the existing app dock. */
(function () {
  'use strict';
  var root, holder, empty, elements = {}, choices = {}, activeService = '', part = 'cards', lastUtility = 2;
  function node(tag, cls, parent, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; if (parent) parent.appendChild(e); return e; }
  function services() { return CatalogConfig.services().filter(function (s) { return s.enabled; }); }
  function state(id) {
    var tabs = CatalogConfig.tabs(id), s = choices[id] || (choices[id] = {tab: '', card: 0, page: 1});
    if (!tabs.some(function (t) { return t.id === s.tab; })) { s.tab = tabs.length ? tabs[0].id : ''; s.card = 0; s.page = 1; }
    return s;
  }
  function oldTopCount() { return VoKinoSections.tabs().length; }
  function utilities(slot) { lastUtility = TopControls.preferred(slot); FreeMyTV.state.zone = 'top'; FreeMyTV.state.top = oldTopCount() + lastUtility; FreeMyTV.move(0, 0); focus(); }
  function focusRow(id, area) {
    var rows = services(); if (!rows.length) { utilities(2); return; }
    activeService = rows.some(function (s) { return s.id === id; }) ? id : rows[0].id; part = area || 'cards'; state(activeService);
    FreeMyTV.state.zone = part === 'tabs' ? 'catalog-tabs' : 'catalog-cards'; FreeMyTV.move(0, 0); FreeMyTV.poke(); render();
  }
  function image(service, item) {
    if (service === 'vokino') return Data.image(item.poster, 'w300');
    if (service === 'ivi' && /\.(?:jpe?g|png|webp)$/.test(item.poster)) return item.poster + '/156x240/?q=75';
    return item.poster;
  }
  function revealImages(id) {
    var view = elements[id]; if (!view || !view.cards) return;
    var left = view.cards.scrollLeft, width = view.cards.clientWidth;
    [].forEach.call(view.cards.children, function (card) { var img = card.querySelector('img'); if (img && !img.getAttribute('src') && card.offsetLeft + card.offsetWidth >= left - 180 && card.offsetLeft <= left + width + 180) { var url = img.getAttribute('data-src'); if (url) img.src = url; } });
  }
  function focus() {
    if (FreeMyTV.state.zone === 'top' && FreeMyTV.state.top >= oldTopCount() && TopControls.slots().indexOf(FreeMyTV.state.top - oldTopCount()) >= 0) lastUtility = FreeMyTV.state.top - oldTopCount();
    var custom = /^catalog-(tabs|cards)$/.test(FreeMyTV.state.zone), rows = services();
    if (custom) part = FreeMyTV.state.zone === 'catalog-tabs' ? 'tabs' : 'cards';
    rows.forEach(function (service) {
      var id = service.id, view = elements[id], selected = state(id); if (!view) return;
      view.box.classList.toggle('catalog-active', custom && id === activeService);
      [].forEach.call(view.tabs.children, function (t) { var on = t.getAttribute('data-tab') === selected.tab; t.classList.toggle('on', on); t.classList.toggle('focus', custom && id === activeService && part === 'tabs' && on); });
      [].forEach.call(view.cards.children, function (card, i) { card.classList.toggle('focus', custom && id === activeService && part === 'cards' && i === selected.card); });
    });
    if (custom && elements[activeService]) {
      var selected = state(activeService), view = elements[activeService], tab = view.tabs.querySelector('[data-tab="' + selected.tab + '"]'), card = view.cards.children[selected.card];
      if (tab) { if (tab.offsetLeft < view.tabs.scrollLeft) view.tabs.scrollLeft = tab.offsetLeft; else if (tab.offsetLeft + tab.offsetWidth > view.tabs.scrollLeft + view.tabs.clientWidth) view.tabs.scrollLeft = tab.offsetLeft + tab.offsetWidth - view.tabs.clientWidth; }
      if (card && part === 'cards') { if (card.offsetLeft < view.cards.scrollLeft) view.cards.scrollLeft = card.offsetLeft; else if (card.offsetLeft + card.offsetWidth > view.cards.scrollLeft + view.cards.clientWidth) view.cards.scrollLeft = card.offsetLeft + card.offsetWidth - view.cards.clientWidth; }
      var top = view.box.offsetTop, bottom = top + view.box.offsetHeight;
      if (top < root.scrollTop) root.scrollTop = top;
      else if (bottom > root.scrollTop + root.clientHeight) root.scrollTop = bottom - root.clientHeight;
    }
    rows.forEach(function (s) { var view = elements[s.id]; if (view && view.box.offsetTop < root.scrollTop + root.clientHeight && view.box.offsetTop + view.box.offsetHeight > root.scrollTop) revealImages(s.id); });
  }
  function render() {
    if (!root) return;
    var rows = services(), wanted = rows.map(function (s) { return s.id; }).join(',');
    if (holder.getAttribute('data-services') !== wanted) { holder.textContent = ''; elements = {}; holder.setAttribute('data-services', wanted); }
    empty.hidden = !!rows.length;
    rows.forEach(function (service) {
      var id = service.id, selected = state(id), tabs = CatalogConfig.tabs(id), view = elements[id];
      if (!view) {
        var box = node('section', 'catalog-row', holder); box.setAttribute('aria-label', service.name); box.setAttribute('data-service', id);
        var header = node('div', 'catalog-header', box); node('h2', 'catalog-name', header, service.name);
        view = elements[id] = {box: box, tabs: node('div', 'catalog-tabs', header), cards: node('div', 'catalog-cards', box), status: node('div', 'catalog-status', box), stamp: '', tabStamp: ''};
        view.cards.onscroll = function () { revealImages(id); };
      }
      var tabStamp = tabs.map(function (t) { return t.id; }).join(',');
      if (view.tabStamp !== tabStamp) {
        view.tabStamp = tabStamp; view.tabs.textContent = '';
        tabs.forEach(function (tab) { var button = node('button', 'catalog-tab', view.tabs, tab.name); button.type = 'button'; button.setAttribute('data-tab', tab.id); button.onclick = function () { selectTab(id, tab.id); focusRow(id, 'tabs'); }; });
      }
      var items = selected.tab ? CatalogFeeds.picks(id, selected.tab, selected.page) : [], stamp = selected.tab + ':' + selected.page + ':' + items.map(function (p) { return p.id + ':' + (p.type || '') + ':' + p.title; }).join('|');
      if (stamp !== view.stamp) {
        view.stamp = stamp; view.items = items; view.cards.textContent = ''; if (items.length) selected.card = Math.max(0, Math.min(selected.card, items.length - 1));
        items.forEach(function (item, index) {
          var button = node('button', 'catalog-card', view.cards); button.type = 'button'; button.setAttribute('aria-label', item.title);
          var url = image(id, item);
          if (url) {
            var poster = node('img', 'catalog-poster', button); poster.alt = ''; poster.setAttribute('data-src', url);
            poster.onerror = function () { this.style.opacity = '0'; };
          } else node('span', 'catalog-poster', button);
          node('span', 'catalog-title', button, item.title); node('span', 'catalog-meta', button, item.meta);
          button.onclick = function () { selected.card = index; focusRow(id, 'cards'); launch(); };
        });
      }
      view.status.hidden = items.length > 0; view.status.textContent = selected.tab ? CatalogFeeds.status(id, selected.tab, selected.page) : 'Включите вкладки этого сервиса в настройках';
    });
    if (activeService && !rows.some(function (s) { return s.id === activeService; }) && /^catalog-/.test(FreeMyTV.state.zone)) { activeService = rows.length ? rows[0].id : ''; if (!activeService) utilities(2); }
    focus();
  }
  function selectTab(id, tab) { var selected = state(id); if (selected.tab === tab) return; selected.tab = tab; selected.card = 0; selected.page = 1; if (id === 'vokino') VoKinoBridge.resetPage(tab === 'overview' ? null : 'vokino-' + tab); render(); }
  function page(direction) {
    var selected = state(activeService), key = selected.tab === 'overview' ? null : 'vokino-' + selected.tab;
    if (direction < 0) { if (selected.page <= 1) return false; if (activeService === 'vokino' && !VoKinoBridge.turnPage(key, -1)) return false; selected.page--; }
    else { if (!CatalogFeeds.next(activeService, selected.tab, selected.page)) return false; selected.page++; }
    selected.card = direction > 0 ? 0 : Math.max(0, Prefs.cards() - 1); render(); return true;
  }
  function launch() {
    var view = elements[activeService], selected = state(activeService), item = view && view.items && view.items[selected.card]; if (!item || view.opening) return;
    if (activeService === 'myshows') { CombinedSearch.openForTitle(item.title, CatalogHome.selection()); return; }
    view.opening = true; FreeMyTV.poke();
    function done(ok, error) { view.opening = false; if (!ok) FreeMyTV.toast(error || 'Не удалось открыть карточку'); }
    if (activeService === 'vokino') TV.launch(item.app, null, done);
    else if (activeService === 'kinopoisk') KinopoiskCatalog.launch(item, done);
    else IviCatalog.launch(item, done);
  }
  function move(dx, dy) {
    var rows = services(), at = rows.findIndex(function (s) { return s.id === activeService; }), selected = state(activeService), tabs = CatalogConfig.tabs(activeService), view = elements[activeService];
    if (dx && part === 'tabs') { var index = tabs.findIndex(function (t) { return t.id === selected.tab; }); index = Math.max(0, Math.min(tabs.length - 1, index + dx)); if (tabs[index]) selectTab(activeService, tabs[index].id); }
    else if (dx && view) { var to = selected.card + dx; if (to < 0 || to >= view.items.length) { if (page(dx)) return; } selected.card = Math.max(0, Math.min(Math.max(0, view.items.length - 1), to)); }
    else if (dy < 0 && part === 'cards') part = 'tabs';
    else if (dy < 0) { if (at > 0) { activeService = rows[at - 1].id; part = 'cards'; } else { utilities(lastUtility); return; } }
    else if (dy > 0 && part === 'tabs' && view && view.items.length) part = 'cards';
    else if (dy > 0 && at + 1 < rows.length) { activeService = rows[at + 1].id; part = 'tabs'; }
    else if (dy > 0) { FreeMyTV.state.zone = 'shelf'; FreeMyTV.move(0, 0); focus(); return; }
    FreeMyTV.state.zone = part === 'tabs' ? 'catalog-tabs' : 'catalog-cards'; focus();
  }
  document.addEventListener('keydown', function (e) {
    var st = FreeMyTV.state, custom = st.zone === 'catalog-tabs' || st.zone === 'catalog-cards', utility = st.zone === 'top' && st.top >= oldTopCount();
    if (!custom && !(st.zone === 'shelf' && e.keyCode === 38) && !(utility && [37, 39, 40].indexOf(e.keyCode) >= 0)) return;
    if ([37, 38, 39, 40, 13, 10009, 461, 27, 8].indexOf(e.keyCode) < 0) return;
    e.preventDefault(); e.stopImmediatePropagation(); if (FreeMyTV.poke(e.keyCode === TV.keys.ok)) return;
    if (st.zone === 'shelf') { var rows = services(); focusRow(activeService || (rows.length ? rows[rows.length - 1].id : ''), 'cards'); return; }
    if (utility) { lastUtility = st.top - oldTopCount(); if (e.keyCode === 40) focusRow(services()[0] && services()[0].id, 'tabs'); else { var slots = TopControls.slots(), at = slots.indexOf(lastUtility); utilities(slots[Math.max(0, Math.min(slots.length - 1, at + (e.keyCode === 39 ? 1 : -1)))]); } return; }
    if (e.keyCode >= 37 && e.keyCode <= 40) move(e.keyCode === 37 ? -1 : e.keyCode === 39 ? 1 : 0, e.keyCode === 38 ? -1 : e.keyCode === 40 ? 1 : 0);
    else if (e.keyCode === 13) { if (part === 'tabs') { part = 'cards'; FreeMyTV.state.zone = 'catalog-cards'; focus(); } else launch(); }
    else { FreeMyTV.state.zone = 'shelf'; FreeMyTV.move(0, 0); focus(); }
  }, true);
  document.documentElement.classList.add('catalog-main');
  root = node('div', '', document.getElementById('stage')); root.id = 'catalog-home'; holder = node('div', 'catalog-rows', root); empty = node('div', 'catalog-no-services', root, 'Включите каталоги и вкладки в настройках');
  root.onscroll = function () { services().forEach(function (s) { var view = elements[s.id]; if (view && view.box.offsetTop < root.scrollTop + root.clientHeight && view.box.offsetTop + view.box.offsetHeight > root.scrollTop) revealImages(s.id); }); };
  function resetPages() { Object.keys(choices).forEach(function (id) { choices[id].page = 1; choices[id].card = 0; }); VoKinoBridge.offsets = {}; render(); }
  window.CatalogHome = {resetPages: resetPages, refresh: render, paint: focus, focus: focusRow, selection: function () { return {service: activeService, part: part, choices: JSON.parse(JSON.stringify(choices))}; }, restore: function (saved) { if (!saved) return; services().forEach(function (s) { var row = saved.choices && saved.choices[s.id]; if (row && typeof row.tab === 'string') choices[s.id] = {tab: row.tab, card: Math.max(0, Math.min(15, Number(row.card) || 0)), page: Math.max(1, Math.min(1000, Number(row.page) || 1))}; }); focusRow(saved.service, saved.part === 'tabs' ? 'tabs' : 'cards'); }};
  CatalogConfig.onChange(resetPages);
  CatalogFeeds.onChange(render); MyShowsCatalog.onChange(render); Data.onChange(render); render();
})();
