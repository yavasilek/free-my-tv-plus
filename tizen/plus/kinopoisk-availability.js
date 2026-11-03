/* Public, anonymous ViewOption query used by Kinopoisk's own film page. */
(function () {
  'use strict';
  var QUERY = "query ViewOption($id: String!, $withPreOrder: Boolean!) { movieByContentUuid(contentUuid: $id) { id contentId viewOption { ...ViewOption __typename } availabilityOptions @include(if: $withPreOrder) { ...PreOrderAvailabilityOptions __typename } __typename } } fragment MoneyAmount on MoneyAmount { amount currency { currencyCode symbol __typename } __typename } fragment PreOrderOption on PreOrderOption { details { availabilityDate ... on PreOrderPurchasableDetails { price { amount currency { currencyCode symbol __typename } __typename } originalPrice { amount __typename } discount { percent __typename } purchaseItemId __typename } __typename } __typename } fragment ViewOption on ViewOption { type watchabilityStatus purchasabilityStatus downloadabilityStatus buttonText descriptionText texts { disclaimer __typename } originalButtonText optionMonetizationModels promotionActionType mainPromotionAbsoluteAmount { ...MoneyAmount __typename } mastercardPromotionAbsoluteAmount { ...MoneyAmount __typename } transactionalPrice { ...MoneyAmount __typename } transactionalMinimumPrice { ...MoneyAmount __typename } priceWithTotalDiscount { ...MoneyAmount __typename } availabilityAnnounce { availabilityDate type groupPeriodType announcePromise __typename } promotionIcons { avatarsUrl origSize { width height __typename } __typename } purchaseOptionCustomProperties contentPackageToBuy { billingFeatureName __typename } subscriptionBadge { image { avatarsUrl __typename } __typename } watchPeriod { timeToExpire watchPeriodStatus __typename } __typename } fragment PreOrderAvailabilityOptions on AvailabilityOptions { options { ... on PreOrderOption { ...PreOrderOption __typename } __typename } __typename } ";
  var KEY = 'fmtv.kinopoisk.availability.v1', TTL = 21600000;
  window.createKinopoiskAvailability = function (details) {
    var records = {}, queued = [], running = {}, active = 0, notify = function () {}, visible = {}, generation = 0;
    try {
      var saved = JSON.parse(localStorage.getItem(KEY));
      if (Array.isArray(saved)) saved.slice(0, 128).forEach(function (r) {
        if (r && /^[1-9][0-9]{0,9}$/.test(r.id) && ['available', 'unavailable'].indexOf(r.status) >= 0 && /^[a-f0-9]{32}$/.test(r.hdId) && Date.now() - r.at < TTL) records[r.id] = r;
      });
    } catch (e) {}
    function fresh(id) { var r = records[id]; return r && Date.now() - r.at < (r.status === 'unknown' ? 120000 : TTL); }
    function save() {
      var newest = Object.keys(records).map(function (id) { return records[id]; }).sort(function (a, b) { return b.at - a.at; }).slice(0, 128);
      records = {}; newest.forEach(function (r) { records[r.id] = r; });
      try { localStorage.setItem(KEY, JSON.stringify(newest.filter(function (r) { return r.status !== 'unknown'; }))); } catch (e) {}
    }
    function pump() {
      while (active < 2 && queued.length) (function (id) {
        if (!visible[id] || fresh(id) || running[id]) return;
        active++; var controller = new AbortController(), mine = generation; running[id] = controller;
        var timer = setTimeout(function () { controller.abort(); }, 12000), hdId = '';
        Promise.resolve().then(function () { return details(id, controller.signal); }).then(function (data) {
          if (mine !== generation || controller.signal.aborted) throw new Error('Cancelled');
          hdId = data && data.kinopoiskHDId || '';
          if (!/^[a-f0-9]{32}$/.test(hdId)) throw new Error('No confirmed TV link');
          return fetch('https://graphql.kinopoisk.ru/graphql/?operationName=ViewOption', {method: 'POST', credentials: 'omit', redirect: 'error', signal: controller.signal,
            headers: {'Content-Type': 'application/json', 'service-id': '25', 'x-kp-client-platform': 'web'},
            body: JSON.stringify({operationName: 'ViewOption', variables: {id: hdId, withPreOrder: true}, query: QUERY})});
        }).then(function (r) { if (!r.ok) throw new Error('Availability unavailable'); return r.json(); })
          .then(function (data) {
            if (mine !== generation) return;
            var movie = data.data && data.data.movieByContentUuid, option = movie && movie.viewOption;
            if (data.errors || !option || String(movie.id) !== id) throw new Error('No availability data');
            var status = option.watchabilityStatus === 'UNWATCHABLE' && option.purchasabilityStatus === 'UNPURCHASABLE' && !option.buttonText ? 'unavailable' : option.buttonText || option.watchabilityStatus === 'WATCHABLE' ? 'available' : 'unknown';
            records[id] = {id: id, hdId: hdId, status: status, at: Date.now()}; save();
          }).catch(function () { if (mine === generation) records[id] = {id: id, hdId: /^[a-f0-9]{32}$/.test(hdId) ? hdId : '', status: 'unknown', at: Date.now()}; })
          .then(function () { clearTimeout(timer); delete running[id]; active--; notify(); pump(); });
      })(queued.shift());
    }
    return {
      visible: function (rows, changed) {
        notify = changed; visible = {}; queued = [];
        rows.forEach(function (p) { if (!/^[1-9][0-9]{0,9}$/.test(p.id)) return; visible[p.id] = true; if (!fresh(p.id) && !running[p.id]) queued.push(p.id); }); pump();
      },
      annotation: function (p) {
        var r = fresh(p.id) && records[p.id];
        return !r ? {text: 'Проверяем...', kind: 'checking'} : r.status === 'unavailable' ? {text: 'Нет просмотра', kind: 'unavailable'} : r.status === 'unknown' ? {text: 'Не проверено', kind: 'unknown'} : null;
      },
      hdId: function (id) { return fresh(id) && records[id].hdId || ''; },
      clear: function () { generation++; records = {}; queued = []; visible = {}; Object.keys(running).forEach(function (id) { running[id].abort(); }); try { localStorage.removeItem(KEY); } catch (e) {} }
    };
  };
})();
