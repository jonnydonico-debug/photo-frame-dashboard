// Notes: quick sticky notes from JD and Georgia. Saved on the Mac mini, shared with every screen.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null, by: null };

  function people() { return D.people && D.people.length ? D.people : [{ id: 'jd', name: 'JD', color: '#6E8069', rgb: '110 128 105', ink: '#FFFFFF' }]; }
  function ago(t) {
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + ' hr ago';
    var d = new Date(t);
    return App.fmt.dayShort(d) + ' ' + App.fmt.monthShort(d) + ' ' + d.getDate();
  }
  function list() {
    return (D.notes || []).slice().sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.at - a.at; });
  }
  function note(n) {
    var p = App.person(n.by);
    return '<button class="nt-card' + (n.pinned ? ' is-pinned' : '') + (n.done ? ' is-done' : '') + '" data-note="' + App.esc(n.id) + '" style="' + App.pstyle(p) + '">' +
      '<span class="nt-text">' + App.esc(n.text).replace(/\n/g, '<br>') + '</span>' +
      '<span class="nt-meta">' + App.avatar(p, 24) + '<b>' + App.esc(p.name) + '</b><small>' + ago(n.at) + '</small>' + (n.pinned ? App.icon('pin', 18) : '') + '</span></button>';
  }
  function composer() {
    var ps = people();
    if (!V.by || !ps.some(function (p) { return p.id === V.by; })) V.by = ps[0].id;
    return '<div class="label">New note</div>' +
      '<textarea class="nt-input" placeholder="Pick up milk, call the plumber, love you…" maxlength="500"></textarea>' +
      '<div class="nt-who">' + ps.map(function (p) {
        return '<button class="nt-whobtn' + (p.id === V.by ? ' is-on' : '') + '" data-by="' + App.esc(p.id) + '" style="' + App.pstyle(p) + '">' + App.avatar(p, 34) + '<span>' + App.esc(p.name) + '</span></button>';
      }).join('') + '</div>' +
      '<button class="btn btn--solid nt-add" data-add>' + App.icon('plus', 24) + 'Add note</button>';
  }
  function paintList() {
    var L = list();
    V.el.querySelector('.nt-grid').innerHTML = L.length ? L.map(note).join('') :
      '<div class="nt-empty"><h2 class="serif">No notes yet</h2><p>Write one on the left. It shows up on every screen right away.</p></div>';
    V.el.querySelector('.nt-count').textContent = L.length ? L.length + (L.length === 1 ? ' note' : ' notes') : '';
  }
  function save() { App.emit('data'); }

  function add() {
    var ta = V.el.querySelector('.nt-input'), text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    D.notes = (D.notes || []).concat([{ id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: text, by: V.by, at: Date.now(), pinned: false }]);
    ta.value = ''; ta.blur();
    paintList(); save();
    App.toast('Note added', { icon: 'check', ms: 1800 });
  }
  function openNote(id) {
    var n = (D.notes || []).filter(function (x) { return x.id === id; })[0];
    if (!n) return;
    var p = App.person(n.by);
    App.sheet('<div class="sheet-pad nt-sheet" style="' + App.pstyle(p) + '"><div class="label">' + App.esc(p.name) + ' · ' + ago(n.at) + '</div>' +
      '<p class="nt-sheet-text serif">' + App.esc(n.text).replace(/\n/g, '<br>') + '</p>' +
      '<div class="sheet-actions">' +
      '<button class="btn" data-pin>' + App.icon('pin', 22) + (n.pinned ? 'Unpin' : 'Pin to top') + '</button>' +
      '<button class="btn" data-done>' + App.icon('check', 22) + (n.done ? 'Not done' : 'Mark done') + '</button>' +
      '<button class="btn btn--solid" data-del>' + App.icon('x', 22) + 'Delete</button></div></div>', {
      onMount: function (s, close) {
        s.querySelector('[data-pin]').onclick = function () { n.pinned = !n.pinned; close(); paintList(); save(); };
        s.querySelector('[data-done]').onclick = function () { n.done = !n.done; close(); paintList(); save(); };
        s.querySelector('[data-del]').onclick = function () {
          var keep = D.notes;
          D.notes = D.notes.filter(function (x) { return x !== n; });
          close(); paintList(); save();
          App.toast('Note deleted', { icon: 'x', undo: function () { D.notes = keep; paintList(); save(); } });
        };
      }
    });
  }

  App.register('notes', {
    show: function (el) {
      V.el = el;
      if (!el.firstChild) {
        el.innerHTML = '<div class="nt"><section class="nt-compose card"></section>' +
          '<section class="nt-board"><div class="nt-head"><h2 class="serif">Notes</h2><span class="nt-count label"></span></div><div class="nt-grid"></div></section></div>';
        el.addEventListener('click', function (e) {
          var t;
          if ((t = e.target.closest('[data-by]'))) { V.by = t.dataset.by; App.$$('[data-by]', el).forEach(function (b) { b.classList.toggle('is-on', b === t); }); return; }
          if (e.target.closest('[data-add]')) return add();
          if ((t = e.target.closest('[data-note]'))) return openNote(t.dataset.note);
        });
      }
      el.querySelector('.nt-compose').innerHTML = composer();
      paintList();
    }
  });
  App.on('minute', function () { if (App.current === 'notes' && V.el) paintList(); });
})();
