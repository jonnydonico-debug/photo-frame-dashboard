// Costs: what the house's Claude agents have spent on the Claude API — the same numbers as the
// frame's Costs tab (DATA.costs, sent live by the Mac mini). Budget and prices are set in Admin.
(function () {
  'use strict';
  var D = window.DATA;

  function money(v) {
    if (!v) return '$0';
    if (v < 0.995) { var c = v * 100; return c < 0.1 ? '<0.1¢' : c.toFixed(c < 10 ? 1 : 0) + '¢'; }
    return '$' + v.toFixed(2);
  }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : /h$/.test(w) ? 'es' : 's'); }
  function stat(label, o) {
    return '<div class="cs2-mini"><small>' + label + '</small><b>' + money(o.cost) + '</b><span>' + plural(o.calls, 'call') + '</span></div>';
  }
  function list(title, rows, extra) {
    var top = rows.length ? rows[0].cost || 1 : 1;
    return '<div class="sec-l">' + title + '</div><div class="card">' + (rows.length ? rows.slice(0, 5).map(function (r) {
      return '<div class="cs2-row"><div><span>' + App.esc(r.name) + '</span><b>' + money(r.cost) + '</b></div>' +
        '<div class="cs2-bar"><i style="width:' + Math.max(2, r.cost / top * 100) + '%"></i></div><small>' + plural(r.calls, 'call') + '</small></div>';
    }).join('') : '<p class="muted">Nothing yet this month.</p>') + (extra || '') + '</div>';
  }

  App.screen('costs', {
    tab: 'more',
    render: function (el) {
      var C = D.costs;
      var head = '<button class="back" data-go="more">' + App.icon('left', 20) + 'More</button>';
      if (!C) {
        el.innerHTML = head + App.head('Costs', 'Claude API') + '<div class="empty">' + App.icon('clock', 36) + '<b>Waiting for the Mac mini…</b></div>';
      } else {
        var B = C.budget, pct = B ? Math.min(100, C.month.cost / B * 100) : 0;
        var max = Math.max.apply(null, C.days.map(function (d) { return d.cost; }).concat([0.0001]));
        el.innerHTML = head + App.head('Costs', 'Claude API · updated ' + App.fmt.ago(C.updated)) +
          '<div class="card cs2-hero"><small>' + App.fmt.month(new Date()) + ' so far</small><b>' + money(C.month.cost) + '</b>' +
          '<p>On pace for about <strong>' + money(C.forecast) + '</strong> this month</p>' +
          (B ? '<div class="cs2-bar cs2-bar--big"><i class="' + (pct >= 100 ? 'is-over' : pct >= 80 ? 'is-warn' : '') + '" style="width:' + pct + '%"></i></div><p class="muted">' + Math.round(pct) + '% of the ' + money(B) + ' monthly budget</p>'
            : '<p class="muted">No monthly budget set (Admin → Costs).</p>') +
          '<div class="cs2-minis">' + stat('Today', C.today) + stat('7 days', C.week) + stat('Last month', C.lastMonth) + '</div></div>' +
          '<div class="sec-l">Last 30 days</div><div class="card"><div class="cs2-chart">' + C.days.map(function (d, i) {
            var h = d.cost ? Math.max(3, d.cost / max * 100) : 0;
            return '<span class="' + (i === C.days.length - 1 ? 'is-today' : '') + '"><i style="height:' + h + '%"></i></span>';
          }).join('') + '</div><div class="cs2-axis"><span>30 days ago</span><span>Today</span></div></div>' +
          list('By agent', C.byAgent) + list('By where it came from', C.byChannel) +
          list('By model', C.byModel, C.month.searches ? '<p class="muted cs2-note">' + plural(C.month.searches, 'web search') + ' this month</p>' : '');
      }
      if (!el.dataset.wired) {
        el.dataset.wired = '1';
        el.addEventListener('click', function (e) { var t = e.target.closest('[data-go]'); if (t) App.go(t.dataset.go); });
      }
    },
    live: function (keys) { if (keys.indexOf('costs') > -1) App.rerender(); }
  });
})();
