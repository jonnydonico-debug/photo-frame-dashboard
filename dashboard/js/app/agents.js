// Agents: the household's Claude agent team (who answers texts, what's scheduled, what they did
// lately, read from the Mac mini) plus, when set up, the AI plan usage shown on the frame's Agents tab.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { team: null, loading: false, error: '' };

  function load() {
    if (V.loading) return;
    V.loading = true;
    App.get('/api/admin/agents').then(function (j) { V.team = j; V.error = ''; })
      .catch(function (e) { V.error = e.message; })
      .then(function () { V.loading = false; if (App.current === 'agents') App.rerender(); });
  }

  function plans() {
    var as = D.agents || [];
    if (!as.length) return '';
    return '<div class="sec-l">AI plans · usage limits</div>' + as.map(function (a) {
      return '<div class="card ag2" style="--c:' + App.esc(a.color) + '"><div class="ag2-h"><i></i><b>' + App.esc(a.name) + '</b><small>' + App.esc(a.plan || '') + '</small>' +
        '<span class="' + (a.status === 'ok' ? 'is-ok' : 'is-warn') + '">' + (a.status === 'ok' ? 'Operational' : 'Degraded') + '</span></div>' +
        (a.incident ? '<p class="ag2-inc">' + App.esc(a.incident) + '</p>' : '') +
        (a.meters || []).map(function (m) {
          return '<div class="ag2-m"><div><span>' + App.esc(m.label) + '</span><b>' + m.used + '%</b></div><div class="cs2-bar"><i class="' + (m.used >= 85 ? 'is-over' : '') + '" style="width:' + m.used + '%"></i></div></div>';
        }).join('') + '</div>';
    }).join('');
  }

  function team() {
    if (!V.team) return V.error ? '<div class="card"><p class="muted">' + App.esc(V.error) + '</p></div>' : '<div class="card"><p class="muted">Loading the team…</p></div>';
    var T = V.team, ags = T.agents || [], byId = {};
    ags.forEach(function (a) { byId[a.id] = a; });
    var scheds = (T.schedules || []).filter(function (x) { return x.kind !== 'reminder'; }), runs = (T.runs || []).filter(function (r) { return !r.parent; }).slice(0, 12);
    return '<div class="sec-l">Team</div><div class="group">' + ags.map(function (a) {
      var boss = a.parent && byId[a.parent];
      return '<div class="ag2-row' + (a.enabled === false ? ' is-off' : '') + '"><span class="ag2-ico">' + App.esc(a.icon || '🤖') + '</span><span class="ag2-t"><b>' + App.esc(a.name) +
        ((a.channels || []).indexOf('imessage') > -1 ? '<em>Answers texts</em>' : '') + '</b><small>' + App.esc(a.role || '') + (boss ? ' · reports to ' + App.esc(boss.name) : '') + '</small></span>' +
        '<span class="ag2-st">' + (a.enabled === false ? 'Off' : 'On') + '</span></div>';
    }).join('') + '</div>' +
      (scheds.length ? '<div class="sec-l">Schedules</div><div class="group">' + scheds.map(function (s) {
        return '<div class="ag2-row' + (s.enabled === false ? ' is-off' : '') + '"><span class="ag2-ico">' + App.icon('clock', 18) + '</span><span class="ag2-t"><b>' + App.esc(s.title || '') + '</b><small>' + App.esc(s.whenText || '') + '</small></span>' +
          '<span class="ag2-st">' + (s.enabled === false ? 'Off' : 'On') + '</span></div>';
      }).join('') + '</div>' : '') +
      '<div class="sec-l">Recent activity</div><div class="group">' + (runs.length ? runs.map(function (r) {
        var a = byId[r.agent] || {};
        return '<div class="ag2-run"><div class="ag2-run-h"><span>' + App.esc(a.icon || '🤖') + ' ' + App.esc(a.name || r.agent) + (r.channel ? ' · ' + App.esc(r.channel === 'imessage' ? 'iMessage' : r.channel) : '') + '</span><small>' + App.fmt.ago(r.at) + '</small></div>' +
          '<b>' + App.esc(r.input || '') + '</b>' + (r.output ? '<p>' + App.esc(String(r.output).slice(0, 220)) + (String(r.output).length > 220 ? '…' : '') + '</p>' : '') + '</div>';
      }).join('') : '<p class="pad muted">Nothing yet.</p>') + '</div>';
  }

  App.screen('agents', {
    tab: 'more',
    render: function (el) {
      if (!V.team && !V.loading) load();
      el.innerHTML = '<button class="back" data-go="more">' + App.icon('left', 20) + 'More</button>' +
        App.head('Agents', 'Your Claude team at home', '<button class="hd-add" data-reload aria-label="Refresh">' + App.icon('undo', 20) + '</button>') +
        team() + plans() + '<p class="foot">Change agents and schedules in Admin → Agents.</p>';
      if (!el.dataset.wired) {
        el.dataset.wired = '1';
        el.addEventListener('click', function (e) {
          var t;
          if ((t = e.target.closest('[data-go]'))) return App.go(t.dataset.go);
          if (e.target.closest('[data-reload]')) { V.team = null; App.rerender(); }
        });
      }
    },
    leave: function () { V.team = null; }
  });
})();
