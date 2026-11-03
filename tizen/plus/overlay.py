"""Opt-in Tizen 6+ overlay. Fail closed if upstream integration points change."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def replace_once(text, old, new, label):
    if text.count(old) != 1:
        raise ValueError('Upstream compatibility check failed: ' + label)
    return text.replace(old, new, 1)


def apply(files):
    files = dict(files)
    for name in ('config.xml', 'index.html', 'data.js', 'home.js'):
        files[name] = files[name].replace(b'\r\n', b'\n')
    manifest = files['config.xml'].decode('utf-8')
    if 'id="FreeMyTVio.FreeMyTV"' not in manifest:
        raise ValueError('Unexpected Free My TV application id')
    index = replace_once(files['index.html'].decode('utf-8'), '<script src="home.js"></script>',
                         '<script src="vokino-adapter.js"></script>\n<script src="vokino-search.js"></script>\n<script src="home.js"></script>\n<script src="favorites.js"></script>', 'home entry point')
    index = replace_once(index, '<html lang="en">', '<html lang="en" class="lite">', 'lightweight TV rendering')
    index = replace_once(index, '<script src="vokino-adapter.js"></script>', '<script src="vokino-sections.js"></script>\n<script src="vokino-adapter.js"></script>', 'section preferences before data adapter')
    index = replace_once(index, '<script src="home.js"></script>', '<script src="dock-style.js"></script>\n<script src="top-controls.js"></script>\n<script src="kinopoisk-availability.js"></script>\n<script src="kinopoisk-search.js"></script>\n<script src="ivi-search.js"></script>\n<script src="combined-search.js"></script>\n<script src="home.js"></script>', 'appearance and utility controls entry point')
    index = replace_once(index, '<script src="home.js"></script>', '<script src="catalog-config.js"></script>\n<script src="catalog-feeds.js"></script>\n<script src="home.js"></script>', 'catalogue models before home')
    index = replace_once(index, '<script src="favorites.js"></script>', '<script src="favorites.js"></script>\n<script src="catalog-home.js"></script>', 'service rows after launcher initialization')
    index = replace_once(index, '<link rel="stylesheet" href="home.css">',
                         '<link rel="stylesheet" href="home.css">\n<link rel="stylesheet" href="performance.css">\n<link rel="stylesheet" href="vokino-search.css">\n<link rel="stylesheet" href="dock-style.css">\n<link rel="stylesheet" href="vokino-sections.css">', 'performance stylesheet')
    index = replace_once(index, '<link rel="stylesheet" href="vokino-sections.css">', '<link rel="stylesheet" href="vokino-sections.css">\n<link rel="stylesheet" href="catalog-home.css">', 'service-row stylesheet')
    data = replace_once(files['data.js'].decode('utf-8'),
        "cards: function () { var n = pick('cards', 3); return n < 3 ? 3 : n > 6 ? 6 : n; }",
        "cards: function () { var n = pick('cards', 16); return n < 1 ? 1 : n > 16 ? 16 : n; }", 'card count')
    home = replace_once(files['home.js'].decode('utf-8'),
        '3 + (Prefs.cards() - 3 + (d || 1) + 4) % 4',
        '1 + (Prefs.cards() - 1 + (d || 1) + 16) % 16', 'card count setting')
    home = replace_once(home,
        "Prefs.set('cards', 1 + (Prefs.cards() - 1 + (d || 1) + 16) % 16); renderCards();",
        "Prefs.set('cards', 1 + (Prefs.cards() - 1 + (d || 1) + 16) % 16); VoKinoBridge.offsets = {}; renderCards(); if (window.CatalogHome) CatalogHome.resetPages();", 'reset pages after count change')
    home = replace_once(home, "var TAB_KIND = [null, 'movie', 'tv'];",
        "var TAB_KIND = [null, 'vokino-history', 'vokino-favorites'];", 'personal tabs')
    home = replace_once(home, "var names = [tr('Explore'), tr('Movies'), tr('Shows')];",
        "var names = [tr('Explore'), 'История', 'Избранное'];", 'personal tab labels')
    home = replace_once(home, 'st.tab = i;',
        'st.tab = i;\n    VoKinoBridge.resetPage(TAB_KIND[i]);', 'reset personal page on tab selection')
    home = replace_once(home,
        "var defs = [['live_tv', tr('light|Live TV')], ['hdmi', tr('HDMI Inputs')], ['settings', tr('light|Settings')]];",
        "var defs = [['live_tv', tr('light|Live TV')], ['hdmi', tr('HDMI Inputs')], ['settings', tr('light|Settings')], ['search', 'Поиск VoKino']];", 'search button')
    home = replace_once(home, 'for (var b = 0; b < 3; b++) {', 'for (var b = 0; b < 4; b++) {', 'four home buttons')
    home = replace_once(home, '(1596 + 88 * b)', '(1508 + 88 * b)', 'home button spacing')
    home = replace_once(home, 'sym(defs[b][0], r);', "if (defs[b][0] === 'search') el('span', 'search-icon', r); else sym(defs[b][0], r);", 'search symbol')
    home = replace_once(home, 'Math.min(5, st.top + dx)', 'Math.min(6, st.top + dx)', 'search button remote focus')
    home = replace_once(home, 'else openSettings();\n        return;\n      case Z.CARDS:',
        'else if (st.top === 6) VoKinoSearch.open();\n        else openSettings();\n        return;\n      case Z.CARDS:', 'open search from remote')
    home = replace_once(home, 'function sheetOpen() { return ', "function sheetOpen() { return st.zone === 'dock-style' || st.zone === 'combined-search' || st.zone === 'ivi-search' || st.zone === 'kinopoisk-key' || st.zone === 'kinopoisk-search' || st.zone === 'vokino-search' || ", 'custom panels block screensaver')
    home = replace_once(home, 'function closeSheets() {', "function closeSheets() {\n    if (window.CombinedSearch) CombinedSearch.close(false);\n    if (window.IviSearch) IviSearch.close(false);\n    if (window.KinopoiskSearch) KinopoiskSearch.close(false);\n    if (window.KinopoiskCatalog) KinopoiskCatalog.closeKey(false);\n    if (window.DockStyle) DockStyle.close(false);\n    if (window.VoKinoSearch) VoKinoSearch.close(false);", 'close custom panels with sheets')
    home = replace_once(home, 'hideSaver: hideSaver, toast: toast', 'hideSaver: hideSaver, toast: toast, poke: poke', 'search activity resets idle timer')
    home = replace_once(home, 'shelf = out;', 'shelf = out;\n    VoKinoBridge.setFavorites(shelf.map(function (a) { return a.id; }));', 'synchronize favorite app targets')
    home = replace_once(home, "label: tr('Shelf'), value:", "label: 'Избранные приложения', value:", 'favorites setting name')
    home = replace_once(home, "      {label: tr('Dim'), value: dimName(),",
        "      {label: 'Оформление дока', value: '›', dockStyle: true, step: function (d) { if (d >= 0) DockStyle.open(); }},\n      {label: tr('Dim'), value: dimName(),", 'dock appearance next to theme setting')
    home = replace_once(home, "title.appendChild(document.createTextNode(tr('Shelf')));",
        "title.appendChild(document.createTextNode('Избранные приложения'));", 'favorites editor title')
    home = replace_once(home, "var a = e.rows[i], at = e.ids.indexOf(a.id), row = el('div', 'row', holder, a.title);",
        "var a = e.rows[i], at = e.ids.indexOf(a.id), row = el('div', 'row', holder);\n      el('span', 'favorite-name', row, a.title);", 'bounded favorite names')
    home = replace_once(home, "at >= 0 ? '#' + (at + 1) : tr('shelf|Off')",
        "at >= 0 ? '← ' + (at + 1) + ' →' : 'Не добавлено'", 'visible reorder controls')
    home = replace_once(home, "tr('OK adds or removes an app. ← → change the order.')",
        "'OK - добавить/убрать · ← → - порядок · Back - готово'", 'favorites editor hint')
    home = replace_once(home, 'function openShelfEdit() {', 'function openShelfEdit(selectedId) {', 'open favorites at selected app')
    home = replace_once(home, '    st.edit = 0;\n    renderShelfEdit();',
        '    st.edit = 0;\n    editList().rows.forEach(function (a, i) { if (a.id === selectedId) st.edit = i; });\n    renderShelfEdit();', 'focus selected favorite')
    home = replace_once(home, '    revealShelf();', '    revealShelf();\n    if (window.FavoriteControls) FavoriteControls.update();', 'favorites help follows focus')
    home = replace_once(home, 'state: st, move: move, activate: activate,',
        'state: st, move: move, activate: activate, showDockSettings: function () { openSettings(); for (var i = 0; i < rowsNow.length; i++) if (rowsNow[i].dockStyle) st.row = i; updateFocus(); }, editFavorites: function () { openShelfEdit(shelf[st.shelf] && shelf[st.shelf].id); },', 'custom settings and favorites editor access')
    home = replace_once(home, "var s = TV.name !== 'browser' ? window.innerWidth / 1920 : Math.min(window.innerWidth / 1920, window.innerHeight / 1080);",
        "var s = TV.name !== 'browser' || (window.VoKinoSearch && VoKinoSearch.isOpen()) || (window.KinopoiskSearch && KinopoiskSearch.isOpen()) || (window.IviSearch && IviSearch.isOpen()) || (window.CombinedSearch && CombinedSearch.isOpen()) || st.zone === 'kinopoisk-key' ? window.innerWidth / 1920 : Math.min(window.innerWidth / 1920, window.innerHeight / 1080);", 'native keyboard must not shrink search')
    home = replace_once(home,
        'if (dx) st.card = Math.max(0, Math.min(cards.length - 1, st.card + dx));',
        '''if (dx) {
          if ((st.card + dx < 0 || st.card + dx >= cards.length) && VoKinoBridge.turnPage(TAB_KIND[st.tab], dx)) {
            st.card = dx > 0 ? 0 : Math.max(0, Data.picks(TAB_KIND[st.tab]).length - 1);
            renderCards();
          } else st.card = Math.max(0, Math.min(cards.length - 1, st.card + dx));
        }''', 'bounded card page navigation')
    home = replace_once(home, 'function reset() {', '''function restoreSelection() {
    if (!window.CatalogHome && document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', restoreSelection, {once: true}); return; }
    if (!window.FreeMyTV) { setTimeout(restoreSelection, 0); return; }
    var saved = VoKinoBridge.takeReturnSelection();
    if (!saved) return;
    hideSaver(); closeSheets(); selectTab(saved.tab); VoKinoBridge.offsets = saved.offsets; renderCards();
    st.card = Math.min(saved.card, Math.max(0, cards.length - 1));
    st.shelf = Math.min(saved.shelf || 0, Math.max(0, shelf.length - 1));
    st.zone = saved.zone === Z.SHELF || !cards.length ? Z.SHELF : Z.CARDS;
    updateFocus();
    if (saved.zone === 'vokino-search' && window.VoKinoSearch) VoKinoSearch.restore(saved.search);
    if (saved.zone === 'kinopoisk-search' && window.KinopoiskSearch && TopControls.kinopoiskApp()) KinopoiskSearch.restore(saved.kinopoiskSearch);
    if (saved.zone === 'combined-search' && window.CombinedSearch) CombinedSearch.restore(saved.combinedSearch);
    if (saved.zone === 'ivi-search' && window.IviSearch && TopControls.iviApp()) IviSearch.restore(saved.iviSearch);
    if ((saved.zone === 'catalog-tabs' || saved.zone === 'catalog-cards') && window.CatalogHome) CatalogHome.restore(saved.catalog);
  }

  function reset() {''', 'restore launcher selection')
    home = replace_once(home, '    reset();\n    loadApps(',
        '    reset();\n    restoreSelection();\n    loadApps(', 'restore after relaunch')
    home = replace_once(home, '    renderAll();\n    restInDrawer();',
        '    renderAll();\n    restoreSelection();\n    restInDrawer();', 'restore after cold start')
    home = configure_sections(home)
    home = configure_top_controls(home)
    home = replace_once(home, '    followSoon();', '    followSoon();\n    if (window.CatalogHome) CatalogHome.paint();', 'catalogue focus follows launcher focus')
    home = replace_once(home, "      {label: 'Разделы VoKino',", "      {label: 'Каталоги и вкладки', value: '›', catalogs: true, step: function (d) { if (d >= 0) CatalogConfig.open(); }},\n      {label: 'Разделы VoKino',", 'catalogue configuration setting')
    home = replace_once(home, "function sheetOpen() { return ", "function sheetOpen() { return st.zone === 'catalog-config' || ", 'catalogue configuration blocks screensaver')
    home = replace_once(home, 'function closeSheets() {', 'function closeSheets() {\n    if (window.CatalogConfig) CatalogConfig.close(false);', 'close catalogue configuration with sheets')
    home = replace_once(home, 'state: st, move: move, activate: activate,', 'state: st, move: move, activate: activate, showCatalogSettings: function () { openSettings(); for (var i = 0; i < rowsNow.length; i++) if (rowsNow[i].catalogs) st.row = i; updateFocus(); },', 'return to catalogue configuration setting')
    if '<tizen:service ' in manifest:
        raise ValueError('Upstream now declares a service; review before combining')
    service = '''    <feature name="http://tizen.org/feature/web.service"/>
    <tizen:service id="FreeMyTVio.Autostart" auto-restart="true" on-boot="true">
        <tizen:content src="autostart.js"/>
        <tizen:name>Free My TV Autostart</tizen:name>
        <tizen:description>Open Free My TV when the TV is switched on</tizen:description>
    </tizen:service>
'''
    manifest = manifest.replace('<name>Free My TV</name>', '<name>Free My TV Plus</name>')
    manifest = manifest.replace('required_version="2.3"', 'required_version="6.0"')
    files.update({'index.html': index.encode(), 'data.js': data.encode(), 'home.js': home.encode(),
                  'config.xml': manifest.replace('</widget>', service + '</widget>').encode(),
                  'vokino-adapter.js': (ROOT / 'compact-adapter.js').read_bytes(),
                  'vokino-search.js': (ROOT / 'vokino-search.js').read_bytes(),
                  'vokino-search.css': (ROOT / 'vokino-search.css').read_bytes(),
                  'favorites.js': (ROOT / 'favorites.js').read_bytes(),
                  'dock-style.js': (ROOT / 'dock-style.js').read_bytes(),
                  'dock-style.css': (ROOT / 'dock-style.css').read_bytes(),
                  'vokino-sections.js': (ROOT / 'vokino-sections.js').read_bytes(),
                  'vokino-sections.css': (ROOT / 'vokino-sections.css').read_bytes(),
                  'top-controls.js': (ROOT / 'top-controls.js').read_bytes(),
                  'kinopoisk-search.js': (ROOT / 'kinopoisk-search.js').read_bytes(),
                  'kinopoisk-availability.js': (ROOT / 'kinopoisk-availability.js').read_bytes(),
                  'combined-search.js': (ROOT / 'combined-search.js').read_bytes(),
                  'ivi-search.js': (ROOT / 'ivi-search.js').read_bytes(),
                  'catalog-config.js': (ROOT / 'catalog-config.js').read_bytes(),
                  'catalog-feeds.js': (ROOT / 'catalog-feeds.js').read_bytes(),
                  'catalog-home.js': (ROOT / 'catalog-home.js').read_bytes(),
                  'catalog-home.css': (ROOT / 'catalog-home.css').read_bytes(),
                  'performance.css': (ROOT / 'performance.css').read_bytes(),
                  'autostart.js': (ROOT / 'autostart.js').read_bytes()})
    return files


def configure_sections(home):
    """Tab indices and utility-button indices follow the user's enabled sections."""
    replacements = [
        ("var TAB_KIND = [null, 'vokino-history', 'vokino-favorites'];", "var TAB_KIND = VoKinoSections.tabs().map(function (t) { return t.key; });"),
        ("var names = [tr('Explore'), 'История', 'Избранное'];", "var names = VoKinoSections.tabs().map(function (t) { return t.name; });"),
        ("for (var i = 0; i < 3; i++) {\n      var t = el('button', 'tab', tabs, names[i]);", "for (var i = 0; i < names.length; i++) {\n      var t = el('button', 'tab', tabs, names[i]);"),
        ('hover(r, Z.TOP, 3 + b);', 'hover(r, Z.TOP, TAB_KIND.length + b);'),
        ('st.top === 3 + i', 'st.top === TAB_KIND.length + i'),
        ('st.top >= 3', 'st.top >= TAB_KIND.length'),
        ('st.top < 3) st.top = 3;', 'st.top < TAB_KIND.length) st.top = TAB_KIND.length;'),
        ('if (st.top < 3) return;', 'if (st.top < TAB_KIND.length) return;'),
        ('if (st.top === 3) { var live', 'if (st.top === TAB_KIND.length) { var live'),
        ('else if (st.top === 4) {', 'else if (st.top === TAB_KIND.length + 1) {'),
        ('else if (st.top === 6) VoKinoSearch.open();', 'else if (st.top === TAB_KIND.length + 3) VoKinoSearch.open();'),
        ('st.top = Data.hasKey() ? st.tab : 3;', 'st.top = Data.hasKey() ? st.tab : TAB_KIND.length;'),
        ('Math.max(Data.hasKey() ? 0 : 3, Math.min(6, st.top + dx))', 'Math.max(Data.hasKey() ? 0 : TAB_KIND.length, Math.min(TAB_KIND.length + 3, st.top + dx))'),
        ('if (st.top < 3) selectTab(st.top);', 'if (st.top < TAB_KIND.length) selectTab(st.top);'),
        ('st.top < 3 ? 0 : cards.length - 1', 'st.top < TAB_KIND.length ? 0 : cards.length - 1'),
        ('index < 3 && !Data.hasKey()', 'index < TAB_KIND.length && !Data.hasKey()'),
        ('if (index < 3) selectTab(index);', 'if (index < TAB_KIND.length) selectTab(index);'),
        ("return st.zone === 'dock-style' ||", "return st.zone === 'vokino-sections' || st.zone === 'dock-style' ||"),
        ('function closeSheets() {', 'function closeSheets() {\n    if (window.VoKinoSections) VoKinoSections.close(false);'),
        ("      {label: tr('Picks per tab'),", "      {label: 'Разделы VoKino', value: '›', sections: true, step: function (d) { if (d >= 0) VoKinoSections.open(); }},\n      {label: tr('Picks per tab'),"),
        ('var list = Data.picks(TAB_KIND[st.tab]);', 'var list = Data.picks(TAB_KIND[st.tab]);\n    VoKinoSections.refreshEmpty(TAB_KIND[st.tab], list.length);\n    VoKinoSections.reveal(st.tab);'),
        ('if (window.FavoriteControls) FavoriteControls.update();', 'if (window.FavoriteControls) FavoriteControls.update();\n    VoKinoSections.reveal(st.tab);'),
        ('state: st, move: move, activate: activate,', 'state: st, move: move, activate: activate, refreshVoKinoTabs: refreshVoKinoTabs, showSectionSettings: function () { openSettings(); for (var i = 0; i < rowsNow.length; i++) if (rowsNow[i].sections) st.row = i; updateFocus(); },'),
    ]
    for old, new in replacements:
        home = replace_once(home, old, new, 'dynamic VoKino sections: ' + old[:60])
    return replace_once(home, '  function selectTab(i) {', '''  function refreshVoKinoTabs() {
    var key = TAB_KIND[st.tab];
    TAB_KIND = VoKinoSections.tabs().map(function (t) { return t.key; });
    st.tab = Math.max(0, TAB_KIND.indexOf(key));
    if (st.zone === Z.TOP) st.top = st.tab;
    cards = []; renderTop(); renderCards(); updateFocus();
  }

  function selectTab(i) {''', 'refresh visible tabs after section edits')


def configure_top_controls(home):
    home = replace_once(home, "['search', 'Поиск VoKino']];", "['search', 'Поиск VoKino'], ['kinopoisk', 'Поиск Кинопоиска'], ['ivi', 'Поиск Иви'], ['combined', 'Общий поиск']];", 'separate catalogue search buttons')
    home = replace_once(home, 'for (var b = 0; b < 4; b++) {', 'for (var b = 0; b < defs.length; b++) {', 'utility button count')
    home = replace_once(home, "else sym(defs[b][0], r);", "else if (defs[b][0] === 'kinopoisk' || defs[b][0] === 'ivi') el('span', 'kinopoisk-search-icon', r, defs[b][0] === 'ivi' ? 'И' : 'К'); else if (defs[b][0] === 'combined') el('span', 'search-icon combined-search-icon', r); else sym(defs[b][0], r);", 'distinct catalogue search marks')
    home = replace_once(home, 'else if (st.top === TAB_KIND.length + 3) VoKinoSearch.open();', 'else if (st.top === TAB_KIND.length + 3 && TopControls.values().vokino) VoKinoSearch.open();\n        else if (st.top === TAB_KIND.length + 4 && TopControls.kinopoiskApp()) KinopoiskSearch.open();\n        else if (st.top === TAB_KIND.length + 5 && TopControls.iviApp()) IviSearch.open();\n        else if (st.top === TAB_KIND.length + 6) CombinedSearch.open();', 'open catalogue search')
    home = replace_once(home, 'VoKinoBridge.setFavorites(shelf.map(function (a) { return a.id; }));', 'VoKinoBridge.setFavorites(shelf.map(function (a) { return a.id; }));\n    if (window.FreeMyTV && FreeMyTV.refreshTopControls) FreeMyTV.refreshTopControls();', 'utility buttons follow favorite membership')
    home = replace_once(home, "    var names = ['Bitcoin',", """    var searchRows = [{label: 'Кнопка «Поиск VoKino»', toggle: TopControls.values().vokino, step: function () { TopControls.toggle('vokino'); }}];
    if (TopControls.kinopoiskApp()) searchRows.push({label: 'Кнопка «Поиск Кинопоиска»', toggle: TopControls.values().kinopoisk, step: function () { TopControls.toggle('kinopoisk'); }});
    if (TopControls.iviApp()) searchRows.push({label: 'Кнопка «Поиск Иви»', toggle: TopControls.values().ivi, step: function () { TopControls.toggle('ivi'); }});
    if (TopControls.kinopoiskApp()) searchRows.push({label: 'Ключ поиска Кинопоиска', value: KinopoiskCatalog.hasKey() ? 'Сохранен' : 'Не задан', kinopoiskKey: true, step: function (d) { if (d >= 0) KinopoiskCatalog.openKey(); }});
    Array.prototype.splice.apply(rows, [6, 0].concat(CombinedSearch.settings(), searchRows));
    var names = ['Bitcoin',""", 'adjacent catalogue search settings')
    home = replace_once(home, 'var TAB_KIND = VoKinoSections.tabs()', 'var lastUtility = 2;\n  var TAB_KIND = VoKinoSections.tabs()', 'remember the upper utility row')
    home = replace_once(home, 'r.style.left = (1508 + 88 * b)', '''var visible = TopControls.slots(), position = visible.indexOf(b);
      r.style.display = position < 0 ? 'none' : '';
      r.setAttribute('data-top-action', ['liveTV', 'inputs', 'settings', 'search', 'kinopoisk', 'ivi', 'combined'][b]);
      r.style.left = (1772 - 88 * (visible.length - 1 - position))''', 'pack visible upper icons at the right edge')
    home = replace_once(home, '    revealShelf();', '''    revealShelf();
    if (st.zone === Z.TOP && st.top >= TAB_KIND.length && TopControls.slots().indexOf(st.top - TAB_KIND.length) >= 0) lastUtility = st.top - TAB_KIND.length;''', 'remember focused upper action')
    home = replace_once(home, 'Math.max(Data.hasKey() ? 0 : TAB_KIND.length, Math.min(TAB_KIND.length + 3, st.top + dx))',
        'TopControls.step(st.top, dx, TAB_KIND.length)', 'skip hidden upper actions')
    home = replace_once(home, '''        } else if (dy > 0) {
          if (cards.length) { st.zone = Z.CARDS; st.card = Math.min(cards.length - 1, st.top < TAB_KIND.length ? 0 : cards.length - 1); }
          else st.zone = Z.SHELF;
        }''', '''        } else if (dy < 0 && st.top < TAB_KIND.length) {
          st.top = TAB_KIND.length + TopControls.preferred(lastUtility);
        } else if (dy > 0) {
          if (st.top >= TAB_KIND.length) st.top = st.tab;
          else if (cards.length) { st.zone = Z.CARDS; st.card = 0; }
          else st.zone = Z.SHELF;
        }''', 'vertical navigation between tabs and utility buttons')
    home = replace_once(home, "      {label: tr('Dim'), value: dimName(),", '''      {label: 'Кнопка «Телеканалы»', toggle: TopControls.values().liveTV, step: function () { TopControls.toggle('liveTV'); }},
      {label: 'Кнопка «Входы HDMI»', toggle: TopControls.values().inputs, step: function () { TopControls.toggle('inputs'); }},
      {label: tr('Dim'), value: dimName(),''', 'optional Live TV and HDMI icons')
    home = replace_once(home, 'state: st, move: move, activate: activate,',
        '''state: st, move: move, activate: activate, refreshTopControls: function () {
      if (st.top >= TAB_KIND.length) st.top = TAB_KIND.length + TopControls.preferred(st.top - TAB_KIND.length);
      renderTop(); updateFocus();
      if (window.CatalogHome) CatalogHome.refresh();
    },''', 'refresh utility icon visibility without losing focus')
    home = replace_once(home, 'state: st, move: move, activate: activate,', 'state: st, move: move, activate: activate, showKinopoiskSettings: function () { openSettings(); for (var i = 0; i < rowsNow.length; i++) if (rowsNow[i].kinopoiskKey) st.row = i; updateFocus(); },', 'return from the Kinopoisk key setting')
    return home
