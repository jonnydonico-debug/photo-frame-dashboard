// Shopping: the same shared list as the frame. Add with suggestions, check off, quantities, notes.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { store: 'all', q: '', showDone: false };

  function list() { return D.groceries = D.groceries || []; }
  function stores() { return D.stores || []; }
  function storeName(id) { var s = id && stores().filter(function (x) { return x.id === id; })[0]; return s ? s.name : ''; }
  // A store tab shows that store's items plus the ones that can be bought anywhere (no store)
  function inStore(g) { return V.store === 'all' || g.store === V.store || !storeName(g.store); }
  function categorize(name) {
    var n = name.toLowerCase(), C = D.catalog || [];
    var hit = C.filter(function (c) { return c[0].toLowerCase() === n; })[0] ||
      C.filter(function (c) { var a = c[0].toLowerCase(); return a.indexOf(n) > -1 || n.indexOf(a) > -1; })[0] ||
      C.filter(function (c) { return n.split(/\s+/).some(function (w) { return w.length > 3 && c[0].toLowerCase().indexOf(w) > -1; }); })[0];
    return hit ? hit[1] : 'Other';
  }
  function onList(name) { return list().filter(function (g) { return !g.done && g.name.toLowerCase() === name.toLowerCase(); })[0]; }
  function gid() { return D._gid ? D._gid() : 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function add(name) {
    name = String(name || '').trim(); if (!name) return;
    var g = onList(name);
    if (g) { g.qty = (g.qty || 1) + 1; App.toast(App.esc(g.name) + ' × ' + g.qty, { icon: 'plus', ms: 1600 }); }
    else {
      var old = list().filter(function (x) { return x.done && x.name.toLowerCase() === name.toLowerCase(); })[0];
      if (old) { old.done = false; old.qty = 1; }
      else {
        var cat = (D.catalog || []).filter(function (c) { return c[0].toLowerCase() === name.toLowerCase(); })[0];
        var st = V.store === 'all' ? '' : V.store;
        list().push({ id: gid(), name: cat ? cat[0] : name.charAt(0).toUpperCase() + name.slice(1), cat: categorize(name), qty: 1, store: st, done: false, note: '' });
      }
      App.toast('Added ' + App.esc(name), { icon: 'check', ms: 1400 });
    }
    App.save();
  }

  function rowHTML(g) {
    return '<div class="li" data-id="' + g.id + '"><button class="li-chk" data-check="' + g.id + '" aria-label="Got it"><span></span></button>' +
      '<button class="li-main" data-edit="' + g.id + '"><b>' + App.esc(g.name) + '</b>' + (g.note ? '<small>' + App.esc(g.note) + '</small>' : '') + '</button>' +
      (g.qty > 1 ? '<span class="li-qty">×' + g.qty + '</span>' : '') + '</div>';
  }
  function suggestions() {
    var q = V.q.trim().toLowerCase();
    if (!q) return '';
    var C = D.catalog || [];
    var m = C.filter(function (c) { return c[0].toLowerCase().indexOf(q) === 0; }).concat(C.filter(function (c) { return c[0].toLowerCase().indexOf(q) > 0; })).slice(0, 5);
    var exact = m.some(function (c) { return c[0].toLowerCase() === q; });
    return '<div class="sug">' + m.map(function (c) { var on = onList(c[0]); return '<button data-add="' + App.esc(c[0]) + '"><b>' + App.esc(c[0]) + '</b><small>' + (on ? 'On list · ×' + on.qty : App.esc(c[1])) + '</small>' + App.icon('plus', 20) + '</button>'; }).join('') +
      (exact ? '' : '<button data-add="' + App.esc(V.q.trim()) + '"><b>Add “' + App.esc(V.q.trim()) + '”</b><small>' + App.esc(categorize(V.q)) + '</small>' + App.icon('plus', 20) + '</button>') + '</div>';
  }
  function usuals() {
    var u = D.usuals || [];
    if (!u.length) return '';
    return '<div class="sec-l">Usuals</div><div class="chips">' + u.map(function (n) {
      var on = onList(n);
      return '<button class="chip' + (on ? ' is-on' : '') + '" data-add="' + App.esc(n) + '">' + (on ? App.icon('check', 14) : App.icon('plus', 14)) + App.esc(n) + '</button>';
    }).join('') + '</div>';
  }
  function body() {
    var open = list().filter(function (g) { return !g.done && inStore(g); });
    var done = list().filter(function (g) { return g.done && inStore(g); });
    var order = ((D.catOrder && D.catOrder.all) || []).concat(['Other']);
    var cats = order.filter(function (c, i) { return order.indexOf(c) === i; });
    open.forEach(function (g) { if (cats.indexOf(g.cat) < 0) cats.push(g.cat); });
    var groups;
    if (open.some(function (g) { return storeName(g.store); })) {
      // Split by store once anything has one; categories stay in aisle order inside each store
      var sorted = function (l) { return l.slice().sort(function (a, b) { return cats.indexOf(a.cat || 'Other') - cats.indexOf(b.cat || 'Other'); }); };
      groups = stores().filter(function (st) { return V.store === 'all' || st.id === V.store; }).map(function (st) { return { c: st.name, store: true, items: sorted(open.filter(function (g) { return g.store === st.id; })) }; })
        .concat([{ c: V.store === 'all' ? 'Any store' : 'Anywhere', store: true, items: sorted(open.filter(function (g) { return !storeName(g.store); })) }]).filter(function (x) { return x.items.length; });
    } else groups = cats.map(function (c) { return { c: c, items: open.filter(function (g) { return (g.cat || 'Other') === c; }) }; }).filter(function (x) { return x.items.length; });
    return (open.length ? groups.map(function (gr) {
      return '<div class="sec-l' + (gr.store ? ' sec-l--store' : '') + '">' + (gr.store ? App.icon('pin', 14) : '') + App.esc(gr.c) + '</div><div class="group">' + gr.items.map(rowHTML).join('') + '</div>';
    }).join('') : '<div class="empty">' + App.icon('check', 30) + '<b>All stocked up</b><span>Nothing left to buy.</span></div>') +
      usuals() +
      (done.length ? '<button class="done-h" data-toggle-done>' + App.icon('check', 18) + '<span>Got it (' + done.length + ')</span><small>' + (V.showDone ? 'Hide' : 'Show') + '</small></button>' +
        (V.showDone ? '<div class="group">' + done.map(function (g) { return '<button class="li li--done" data-revive="' + g.id + '"><span class="li-main"><b>' + App.esc(g.name) + '</b></span><small>Add back</small></button>'; }).join('') + '</div>' +
          '<button class="btn btn--ghost btn--wide" data-clear>Clear checked items</button>' : '') : '');
  }
  function find(id) { return list().filter(function (g) { return g.id === id; })[0]; }

  function edit(g) {
    App.sheet('<div class="sh-pad"><h2 class="sh-h">' + App.esc(g.name) + '</h2>' +
      '<div class="stepper"><button data-q="-1" aria-label="Fewer">' + App.icon('minus', 22) + '</button><b data-qv>' + (g.qty || 1) + '</b><button data-q="1" aria-label="More">' + App.icon('plus', 22) + '</button></div>' +
      '<label class="fld"><span>Note</span><input data-note value="' + App.esc(g.note || '') + '" placeholder="Brand, size, anything…" maxlength="80"></label>' +
      '<div class="sec-l">Where to buy</div><div class="chips st-chips">' + [{ id: '', name: 'Any store' }].concat(stores()).map(function (s) { return '<button data-st="' + App.esc(s.id) + '" class="chip' + ((storeName(g.store) ? g.store : '') === s.id ? ' is-on' : '') + '">' + App.esc(s.name) + '</button>'; }).join('') + '</div>' +
      '<div class="addbar addbar--store">' + App.icon('pin', 20) + '<input data-newstore placeholder="Another store…" maxlength="40" enterkeyhint="done" autocapitalize="words"></div>' +
      '<div class="sh-actions"><button class="btn btn--danger" data-del>Remove</button><button class="btn btn--solid" data-close>Done</button></div></div>', {
      onMount: function (s) {
        s.addEventListener('click', function (e) {
          var t;
          if ((t = e.target.closest('[data-q]'))) { g.qty = Math.max(1, (g.qty || 1) + +t.dataset.q); s.querySelector('[data-qv]').textContent = g.qty; App.save(); }
          if ((t = e.target.closest('[data-st]'))) { g.store = t.dataset.st; App.$$('[data-st]', s).forEach(function (b) { b.classList.toggle('is-on', b === t); }); App.save(); }
          if (e.target.closest('[data-del]')) {
            var keep = list().slice(); D.groceries = list().filter(function (x) { return x !== g; }); App.closeSheet(); App.save(); App.rerender();
            App.toast('Removed ' + App.esc(g.name), { icon: 'x', undo: function () { D.groceries = keep; App.save(); App.rerender(); } });
          }
        });
        s.querySelector('[data-note]').addEventListener('change', function (e) { g.note = e.target.value.trim(); App.save(); });
        var ns = s.querySelector('[data-newstore]');
        ns.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter' || !ns.value.trim()) return;
          e.preventDefault();
          fetch('/api/home/store', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HQ': '1' }, body: JSON.stringify({ name: ns.value.trim() }) })
            .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Couldn’t add the store'); return j; }); })
            .then(function (j) { if (!storeName(j.id)) D.stores = stores().concat([{ id: j.id, name: j.name }]); g.store = j.id; App.save(); App.closeSheet(); App.toast(App.esc(g.name) + ' · ' + App.esc(j.name), { icon: 'pin', ms: 1600 }); })
            .catch(function (er) { App.toast(App.esc(er.message), { icon: 'x' }); });
        });
      },
      onClose: function () { App.rerender(); }
    });
  }

  function paintList(el) { el.querySelector('.sh-body').innerHTML = body(); }
  function paintSug(el) { el.querySelector('.sh-sug').innerHTML = suggestions(); }

  App.screen('shopping', {
    render: function (el) {
      var count = list().filter(function (g) { return !g.done && inStore(g); }).length;
      var all = list().filter(function (g) { return !g.done; });
      var ss = stores().filter(function (st) { return st.id === V.store || all.some(function (g) { return g.store === st.id; }); });
      if (V.store !== 'all' && !ss.length) V.store = 'all';
      el.innerHTML = App.head('Shopping', count ? count + (count === 1 ? ' item to get' : ' items to get') : 'Shared with the frame') +
        (ss.length ? '<div class="seg seg--full">' + [{ id: 'all', name: 'All' }].concat(ss).map(function (s) { return '<button data-store="' + s.id + '" class="' + (V.store === s.id ? 'is-on' : '') + '">' + App.esc(s.name) + '</button>'; }).join('') + '</div>' : '') +
        '<form class="addbar">' + App.icon('plus', 22) + '<input type="text" placeholder="Add an item" enterkeyhint="done" autocomplete="off" autocapitalize="sentences" value="' + App.esc(V.q) + '"></form>' +
        '<div class="sh-sug">' + suggestions() + '</div><div class="sh-body">' + body() + '</div>';
      var input = el.querySelector('.addbar input');
      input.addEventListener('input', function () { V.q = input.value; paintSug(el); });
      el.querySelector('.addbar').addEventListener('submit', function (e) { e.preventDefault(); add(input.value); input.value = ''; V.q = ''; paintSug(el); paintList(el); });
      if (!el.dataset.wired) {
        el.dataset.wired = '1';
        el.addEventListener('click', function (e) {
          var t;
          if ((t = e.target.closest('[data-add]'))) { add(t.dataset.add); var i = el.querySelector('.addbar input'); if (V.q) { i.value = ''; V.q = ''; paintSug(el); } paintList(el); return; }
          if ((t = e.target.closest('[data-check]'))) {
            var g = find(t.dataset.check); if (!g) return;
            t.closest('.li').classList.add('is-checking');
            setTimeout(function () {
              g.done = true; App.save(); paintList(el);
              App.toast('Got ' + App.esc(g.name), { icon: 'check', undo: function () { g.done = false; App.save(); paintList(el); } });
            }, 280);
            return;
          }
          if ((t = e.target.closest('[data-edit]'))) { var g2 = find(t.dataset.edit); if (g2) edit(g2); return; }
          if ((t = e.target.closest('[data-revive]'))) { var g3 = find(t.dataset.revive); if (g3) { g3.done = false; g3.qty = 1; App.save(); paintList(el); } return; }
          if (e.target.closest('[data-toggle-done]')) { V.showDone = !V.showDone; paintList(el); return; }
          if (e.target.closest('[data-clear]')) {
            var keep = list().slice(); D.groceries = list().filter(function (x) { return !(x.done && inStore(x)); }); App.save(); paintList(el);
            App.toast('Cleared', { icon: 'check', undo: function () { D.groceries = keep; App.save(); paintList(el); } });
            return;
          }
          if ((t = e.target.closest('[data-store]'))) { V.store = t.dataset.store; App.rerender(); }
        });
      }
    }
  });
})();
