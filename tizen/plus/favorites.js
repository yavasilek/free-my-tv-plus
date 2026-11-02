/* A short OK launches; holding OK edits favorites without opening the app first. */
(function () {
  'use strict';
  var pressed = false, consumed = false, timer = 0, selected = -1;
  var hint = document.createElement('div');
  hint.id = 'favorites-hint';
  hint.textContent = 'Удерживайте OK - изменить избранное';
  document.getElementById('stage').appendChild(hint);
  function update() { hint.hidden = FreeMyTV.state.zone !== 'shelf' || !VoKinoBridge.favorites().length; }
  function clear() { clearTimeout(timer); timer = 0; pressed = false; consumed = false; }
  document.addEventListener('keydown', function (e) {
    if (e.keyCode !== TV.keys.ok) { clear(); return; }
    if (!pressed && FreeMyTV.state.zone !== 'shelf') return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (pressed) return;
    pressed = true; selected = FreeMyTV.state.shelf;
    consumed = false;
    timer = setTimeout(function () {
      timer = 0; consumed = true;
      if (FreeMyTV.state.zone === 'shelf' && FreeMyTV.state.shelf === selected && !FreeMyTV.poke(false)) FreeMyTV.editFavorites();
      update();
    }, 850);
  }, true);
  document.addEventListener('keyup', function (e) {
    if (e.keyCode !== TV.keys.ok || !pressed) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var activate = !consumed && FreeMyTV.state.zone === 'shelf' && FreeMyTV.state.shelf === selected;
    clear();
    if (activate && !FreeMyTV.poke(true)) FreeMyTV.activate();
    update();
  }, true);
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', function () { if (document.hidden) clear(); });
  window.FavoriteControls = {update: update};
  update();
})();
