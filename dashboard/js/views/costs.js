// Costs: what the house's Claude agents have spent on the Claude API (from the Mac mini's ledger,
// server/costs.mjs). Display only; the budget and prices are set in Admin → Costs.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null };

  function money(v) {
    if (!v) return '$0';
    if (v < 0.995) { var c = v * 100; return c < 0.1 ? '<0.1¢' : c.toFixed(c < 10 ? 1 : 0) + '¢'; }
    return '$' + v.toFixed(2);
  }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : /h$/.test(w) ? 'es' : 's'); }
  function ago(t) {
    var s = Math.round((Date.now() - t) / 1000);
    return s < 90 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' hr ago' : new Date(t).toLocaleDateString();
  }

  function stat(label, o) {
    return '<div class="cs-mini"><span class="label">' + label + '</span><b class="num">' + money(o.cost) + '</b>' +
      '<small>' + plural(o.calls, 'call') + (o.searches ? ' · ' + plural(o.searches, 'search') : '') + '</small></div>';
  }
  function chart(days) {
    var max = Math.max.apply(null, days.map(function (d) { return d.cost; }).concat([0.0001]));
    var today = days.length - 1;
    return '<div class="cs-chart">' + days.map(function (d, i) {
      var h = d.cost ? Math.max(3, d.cost / max * 100) : 0, day = +d.date.slice(8);
      return '<div class="cs-col' + (i === today ? ' is-today' : '') + '"><i style="height:' + h + '%"></i><span>' + (i === today ? 'Today' : day % 5 === 0 ? day : '') + '</span></div>';
    }).join('') + '</div>';
  }
  function list(rows) {
    if (!rows.length) return '<p class="cs-empty">Nothing yet this month.</p>';
    var top = rows[0].cost || 1;
    return rows.slice(0, 5).map(function (r) {
      return '<div class="cs-row"><div class="cs-row-top"><span>' + r.name + '</span><b class="num">' + money(r.cost) + '</b></div>' +
        '<div class="cs-rbar"><i style="width:' + Math.max(2, r.cost / top * 100) + '%"></i></div>' +
        '<small>' + plural(r.calls, 'call') + '</small></div>';
    }).join('');
  }

  function render() {
    if (!V.el) return;
    var C = D.costs;
    if (!C) {
      V.el.innerHTML = '<div class="cs"><header class="cs-head"><h2 class="serif">Costs</h2></header>' +
        '<section class="card cs-wait">' + App.icon('clock', 32) + '<p>Waiting for the Mac mini…</p></section></div>';
      return;
    }
    var B = C.budget, pct = B ? Math.min(100, C.month.cost / B * 100) : 0;
    var monthName = new Date().toLocaleDateString('en-US', { month: 'long' });
    V.el.innerHTML = '<div class="cs">' +
      '<header class="cs-head"><h2 class="serif">Costs</h2><span class="label">Claude API · updated ' + ago(C.updated) + '</span></header>' +
      '<div class="cs-top">' +
        '<section class="card cs-hero">' +
          '<span class="label">' + monthName + ' so far</span>' +
          '<b class="cs-big num">' + money(C.month.cost) + '</b>' +
          '<p class="cs-sub">On pace for about <b>' + money(C.forecast) + '</b> this month</p>' +
          (B ? '<div class="cs-budget"><div class="cs-bar"><i class="' + (pct >= 100 ? 'is-over' : pct >= 80 ? 'is-warn' : '') + '" style="width:' + pct + '%"></i></div>' +
            '<small>' + Math.round(pct) + '% of the ' + money(B) + ' monthly budget</small></div>' : '<p class="cs-note">No monthly budget set (Admin → Costs).</p>') +
          '<div class="cs-minis">' + stat('Today', C.today) + stat('7 days', C.week) + stat('Last month', C.lastMonth) + '</div>' +
        '</section>' +
        '<section class="card cs-days"><div class="cs-card-h"><span class="label">Last 30 days</span><b class="num">' +
          money(C.days.reduce(function (a, d) { return a + d.cost; }, 0)) + '</b></div>' + chart(C.days) + '</section>' +
      '</div>' +
      '<div class="cs-bottom">' +
        '<section class="card cs-list"><span class="label">By agent</span>' + list(C.byAgent) + '</section>' +
        '<section class="card cs-list"><span class="label">By where it came from</span>' + list(C.byChannel) + '</section>' +
        '<section class="card cs-list"><span class="label">By model</span>' + list(C.byModel) +
          (C.month.searches ? '<p class="cs-note">' + plural(C.month.searches, 'web search') + ' this month</p>' : '') + '</section>' +
      '</div>' +
    '</div>';
  }

  App.register('costs', {
    show: function (el) { V.el = el; render(); }
  });
  App.on('live', function (keys) { if (App.current === 'costs' && keys.indexOf('costs') > -1) render(); });
})();
