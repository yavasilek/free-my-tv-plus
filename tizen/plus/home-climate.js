/* Read-only Home Assistant climate for the home screen and clock. */
(function () {
  'use strict';
  var key = 'fmtv.home.climate.v1', climate = null, source = '', readAt = 0, pending = false;
  var labels = {
    'clear-night': 'Ясно', cloudy: 'Облачно', exceptional: 'Особые условия', fog: 'Туман',
    hail: 'Град', lightning: 'Гроза', 'lightning-rainy': 'Гроза с дождём', partlycloudy: 'Переменная облачность',
    pouring: 'Ливень', rainy: 'Дождь', snowy: 'Снег', 'snowy-rainy': 'Мокрый снег',
    sunny: 'Солнечно', windy: 'Ветрено', 'windy-variant': 'Ветрено'
  };
  var strip;

  function endpoint() {
    try {
      var url = new URL(localStorage.getItem(key) || '');
      var local = /^(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2[0-9]|3[01]))(?:\.\d{1,3}){2}$|^[a-z0-9-]+\.local$/i;
      if (/^https?:$/.test(url.protocol) && local.test(url.hostname) &&
          /^\/api\/webhook\/[a-zA-Z0-9_-]{32,128}$/.test(url.pathname) &&
          !url.username && !url.password && !url.search && !url.hash) return url.href;
    } catch (e) {}
    return '';
  }

  function validNumber(value, min, max) {
    return typeof value === 'number' && isFinite(value) && value >= min && value <= max;
  }

  function readings() {
    return climate && source === endpoint() && Date.now() - readAt < 5 * 60000 ? climate : null;
  }

  function conditions(weather) {
    return Object.prototype.hasOwnProperty.call(labels, weather.condition) ? labels[weather.condition] : '';
  }

  function outside(data, fallback) {
    var weather = data && data.weather;
    if (weather && validNumber(weather.temperature, -100, 80)) {
      return {temperature: Data.degrees(weather.temperature), condition: conditions(weather)};
    }
    if (fallback && validNumber(fallback.temp, -100, 80)) {
      return {temperature: Data.degrees(fallback.temp), condition: Data.condition(fallback.code, fallback.isDay)};
    }
    return null;
  }

  function roomText(room, humidity) {
    var values = [];
    if (validNumber(room.temperature, -60, 80)) values.push(Data.degrees(room.temperature));
    if (humidity && validNumber(room.humidity, 0, 100)) values.push(Math.round(room.humidity) + '%');
    return values.join(' · ');
  }

  function roomReadings(data, humidity) {
    return (data ? data.rooms : []).slice(0, 4).reduce(function (items, room) {
      var name = room && typeof room.name === 'string' ? room.name.trim().slice(0, 24) : '';
      var value = name ? roomText(room, humidity) : '';
      if (value) items.push({name: name, value: value});
      return items;
    }, []);
  }

  function renderStrip() {
    var data = readings(), weather = outside(data, null);
    var items = roomReadings(data, true);
    if (weather) items.unshift({name: 'На улице', value: weather.temperature, condition: weather.condition});
    strip.textContent = '';
    items.forEach(function (item) {
      var line = document.createElement('span'), label = document.createElement('span');
      var value = document.createElement('strong');
      label.className = 'ha-label';
      label.textContent = item.name;
      value.textContent = item.value;
      line.appendChild(label);
      line.appendChild(value);
      if (item.condition !== undefined) {
        line.className = 'ha-outdoor';
        if (item.condition) {
          var condition = document.createElement('span');
          condition.className = 'ha-condition';
          condition.textContent = item.condition;
          line.appendChild(condition);
        }
      }
      strip.appendChild(line);
    });
    strip.hidden = !items.length;
    document.documentElement.classList.toggle('ha-climate-visible', items.length > 0);
  }

  function refresh() {
    if (document.hidden) return;
    var url = endpoint();
    if (!url || typeof AbortController === 'undefined' || pending) return;
    var control = new AbortController(), timer = setTimeout(function () { control.abort(); }, 5000);
    pending = true;
    fetch(url, {cache: 'no-store', credentials: 'omit', redirect: 'error', signal: control.signal})
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (value) {
        if (url === endpoint() && value && value.version === 1 && Array.isArray(value.rooms)) {
          climate = value; source = url; readAt = Date.now();
        }
      }).catch(function () {}).then(function () {
        clearTimeout(timer); pending = false; renderStrip();
      });
  }

  window.HomeClimate = {saver: function (screen, fallback) {
    var data = readings(), weather = outside(data, fallback), side = screen.querySelector('.side');
    if (!side) {
      side = document.createElement('div');
      side.className = 'side';
      ['temp', 'cond'].forEach(function (name) {
        var line = document.createElement('div');
        line.className = name;
        side.appendChild(line);
      });
      screen.appendChild(side);
    }
    var roomLine = side.querySelector('.ha-ambient-rooms');
    if (!roomLine) {
      roomLine = document.createElement('div');
      roomLine.className = 'ha-ambient-rooms';
      side.appendChild(roomLine);
    }
    side.querySelector('.temp').textContent = weather ? weather.temperature : '';
    side.querySelector('.cond').textContent = weather ? weather.condition : '';
    roomLine.textContent = '';
    roomReadings(data, false).forEach(function (room) {
      var line = document.createElement('span'), value = document.createElement('strong');
      line.textContent = room.name + ' ';
      value.textContent = room.value;
      line.appendChild(value);
      roomLine.appendChild(line);
    });
    side.hidden = !weather && !roomLine.textContent;
  }};
  strip = document.createElement('div');
  strip.id = 'ha-climate';
  strip.hidden = true;
  document.getElementById('top').appendChild(strip);
  Data.onChange(renderStrip);
  document.addEventListener('visibilitychange', refresh);
  setInterval(refresh, 60000);
  refresh();
})();
