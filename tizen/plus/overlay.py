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
    index = replace_once(index, '<script src="home.js"></script>', '<script src="dock-style.js"></script>\n<script src="home.js"></script>', 'dock styling entry point')
    index = replace_once(index, '<link rel="stylesheet" href="home.css">',
                         '<link rel="stylesheet" href="home.css">\n<link rel="stylesheet" href="performance.css">\n<link rel="stylesheet" href="vokino-search.css">\n<link rel="stylesheet" href="dock-style.css">', 'performance stylesheet')
    data = replace_once(files['data.js'].decode('utf-8'),
        "cards: function () { var n = pick('cards', 3); return n < 3 ? 3 : n > 6 ? 6 : n; }",
        "cards: function () { var n = pick('cards', 16); return n < 1 ? 1 : n > 16 ? 16 : n; }", 'card count')
    home = replace_once(files['home.js'].decode('utf-8'),
        '3 + (Prefs.cards() - 3 + (d || 1) + 4) % 4',
        '1 + (Prefs.cards() - 1 + (d || 1) + 16) % 16', 'card count setting')
    home = replace_once(home,
        "Prefs.set('cards', 1 + (Prefs.cards() - 1 + (d || 1) + 16) % 16); renderCards();",
        "Prefs.set('cards', 1 + (Prefs.cards() - 1 + (d || 1) + 16) % 16); VoKinoBridge.offsets = {}; renderCards();", 'reset pages after count change')
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
    home = replace_once(home, 'function sheetOpen() { return ', "function sheetOpen() { return st.zone === 'dock-style' || st.zone === 'vokino-search' || ", 'custom panels block screensaver')
    home = replace_once(home, 'function closeSheets() {', "function closeSheets() {\n    if (window.DockStyle) DockStyle.close(false);\n    if (window.VoKinoSearch) VoKinoSearch.close(false);", 'close custom panels with sheets')
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
        "var s = TV.name !== 'browser' || (window.VoKinoSearch && VoKinoSearch.isOpen()) ? window.innerWidth / 1920 : Math.min(window.innerWidth / 1920, window.innerHeight / 1080);", 'native keyboard must not shrink search')
    home = replace_once(home,
        'if (dx) st.card = Math.max(0, Math.min(cards.length - 1, st.card + dx));',
        '''if (dx) {
          if ((st.card + dx < 0 || st.card + dx >= cards.length) && VoKinoBridge.turnPage(TAB_KIND[st.tab], dx)) {
            st.card = dx > 0 ? 0 : Math.max(0, Data.picks(TAB_KIND[st.tab]).length - 1);
            renderCards();
          } else st.card = Math.max(0, Math.min(cards.length - 1, st.card + dx));
        }''', 'bounded card page navigation')
    home = replace_once(home, 'function reset() {', '''function restoreSelection() {
    var saved = VoKinoBridge.takeReturnSelection();
    if (!saved) return;
    hideSaver(); closeSheets(); selectTab(saved.tab); VoKinoBridge.offsets = saved.offsets; renderCards();
    st.card = Math.min(saved.card, Math.max(0, cards.length - 1));
    st.shelf = Math.min(saved.shelf || 0, Math.max(0, shelf.length - 1));
    st.zone = saved.zone === Z.SHELF || !cards.length ? Z.SHELF : Z.CARDS;
    updateFocus();
    if (saved.zone === 'vokino-search' && window.VoKinoSearch) VoKinoSearch.restore(saved.search);
  }

  function reset() {''', 'restore launcher selection')
    home = replace_once(home, '    reset();\n    loadApps(',
        '    reset();\n    restoreSelection();\n    loadApps(', 'restore after relaunch')
    home = replace_once(home, '    renderAll();\n    restInDrawer();',
        '    renderAll();\n    restoreSelection();\n    restInDrawer();', 'restore after cold start')
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
                  'performance.css': (ROOT / 'performance.css').read_bytes(),
                  'autostart.js': (ROOT / 'autostart.js').read_bytes()})
    return files
