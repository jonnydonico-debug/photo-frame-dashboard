// Notes: the same sticky notes as the frame. New notes are signed by whoever this phone belongs to.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { draft: '' };

  function sorted() { return (D.notes || []).slice().sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (a.done ? 1 : 0) - (b.done ? 1 : 0) || b.at - a.at; }); }
  function card(n) {
    var p = App.person(n.by);
    return '<button class="note' + (n.pinned ? ' is-pinned' : '') + (n.done ? ' is-done' : '') + '" data-note="' + App.esc(n.id) + '" style="' + App.pstyle(p) + '">' +
      '<span class="note-t">' + App.esc(n.text).replace(/\n/g, '<br>') + '</span>' +
      '<span class="note-m">' + App.avatar(p, 20) + '<b>' + App.esc(p.name) + '</b><small>' + App.fmt.ago(n.at) + '</small>' + (n.pinned ? App.icon('pin', 15) : '') + '</span></button>';
  }
  function add(el) {
    var ta = el.querySelector('.compose textarea'), text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    D.notes = (D.notes || []).concat([{ id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: text, by: App.me() || App.people()[0].id, at: Date.now(), pinned: false }]);
    V.draft = ''; ta.value = ''; ta.blur();
    App.save(); App.rerender();
    App.toast('Note added', { icon: 'check', ms: 1500 });
  }
  function open(id) {
    var n = (D.notes || []).filter(function (x) { return x.id === id; })[0]; if (!n) return;
    var p = App.person(n.by);
    App.sheet('<div class="sh-pad" style="' + App.pstyle(p) + '"><div class="sh-kick">' + App.esc(p.name) + ' · ' + App.fmt.ago(n.at) + '</div>' +
      '<textarea class="note-edit" maxlength="500">' + App.esc(n.text) + '</textarea>' +
      '<div class="sh-list"><button data-pin>' + App.icon('pin', 20) + (n.pinned ? 'Unpin' : 'Pin to top') + '</button>' +
      '<button data-done>' + App.icon('check', 20) + (n.done ? 'Mark not done' : 'Mark done') + '</button>' +
      '<button class="is-danger" data-del>' + App.icon('x', 20) + 'Delete</button></div></div>', {
      onMount: function (s, close) {
        var ta = s.querySelector('textarea');
        ta.addEventListener('change', function () { var t = ta.value.trim(); if (t && t !== n.text) { n.text = t; App.save(); } });
        s.querySelector('[data-pin]').onclick = function () { n.pinned = !n.pinned; close(); App.save(); };
        s.querySelector('[data-done]').onclick = function () { n.done = !n.done; close(); App.save(); };
        s.querySelector('[data-del]').onclick = function () {
          var keep = D.notes; D.notes = D.notes.filter(function (x) { return x !== n; }); close(); App.save(); App.rerender();
          App.toast('Note deleted', { icon: 'x', undo: function () { D.notes = keep; App.save(); App.rerender(); } });
        };
      },
      onClose: function () { var t = App.$('.note-edit'); if (t && t.value.trim() && t.value.trim() !== n.text) { n.text = t.value.trim(); App.save(); } App.rerender(); }
    });
  }

  App.screen('notes', {
    render: function (el) {
      var L = sorted(), me = App.me() ? App.person(App.me()) : null;
      el.innerHTML = App.head('Notes', L.length ? L.length + (L.length === 1 ? ' note' : ' notes') + ' · on the frame too' : 'Shows up on the frame right away') +
        '<div class="card compose"><textarea placeholder="Pick up milk, call the plumber, love you…" maxlength="500" rows="3">' + App.esc(V.draft) + '</textarea>' +
        '<div class="compose-f">' + (me ? '<span class="compose-by">' + App.avatar(me, 22) + App.esc(me.name) + '</span>' : '<span></span>') + '<button class="btn btn--solid" data-add>' + App.icon('plus', 18) + 'Add</button></div></div>' +
        (L.length ? '<div class="notes">' + L.map(card).join('') + '</div>' : '<div class="empty">' + App.icon('pin', 30) + '<b>No notes yet</b><span>Write one above. It appears on the frame straight away.</span></div>');
      el.querySelector('.compose textarea').addEventListener('input', function (e) { V.draft = e.target.value; });
      if (!el.dataset.wired) {
        el.dataset.wired = '1';
        el.addEventListener('click', function (e) {
          var t;
          if (e.target.closest('[data-add]')) return add(el);
          if ((t = e.target.closest('[data-note]'))) return open(t.dataset.note);
        });
      }
    }
  });
})();
