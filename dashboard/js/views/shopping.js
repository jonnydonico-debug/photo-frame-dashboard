// Shopping: categorized list (left) + quick-add with usuals (right).
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null, store: 'all', query: '', drawer: false, pending: {}, flash: null };

  // A store tab shows that store's items plus the ones that can be bought anywhere (no store)
  function inStore(g) { return V.store === 'all' || g.store === V.store || !storeName(g.store); }
  function open() { return D.groceries.filter(function (g) { return !g.done && inStore(g); }); }
  function done() { return D.groceries.filter(function (g) { return g.done && inStore(g); }); }
  function stores() { return D.stores || []; }
  function storeName(id) { var s = id && stores().filter(function (x) { return x.id === id; })[0]; return s ? s.name : ''; }
  function catOrder() { var C = D.catOrder || {}; return (C[V.store] || C.all || []).concat(['Other']); }
  // Split into store sections once anything on the list has a store
  function sectioned() { return open().some(function (g) { return storeName(g.store); }); }

  function categorize(name) {
    var n = name.toLowerCase();
    var hit = D.catalog.filter(function (c) { return c[0].toLowerCase() === n; })[0] ||
      D.catalog.filter(function (c) { var a = c[0].toLowerCase(); return a.indexOf(n) > -1 || n.indexOf(a) > -1; })[0] ||
      D.catalog.filter(function (c) { return n.split(/\s+/).some(function (w) { return w.length > 3 && c[0].toLowerCase().indexOf(w) > -1; }); })[0];
    return hit ? hit[1] : 'Other';
  }
  function find(name, isDone) {
    return D.groceries.filter(function (g) { return !!g.done === isDone && g.name.toLowerCase() === name.toLowerCase(); })[0];
  }

  function row(g) {
    return '<div class="s-row' + (V.pending[g.id] ? ' is-checking' : '') + '" data-id="' + g.id + '">' +
      '<button class="s-hit" data-check="' + g.id + '">' +
      '<span class="s-box">' + App.icon('check', 22) + '</span>' +
      '<span class="s-name"><b>' + App.esc(g.name) + '</b>' + (g.note ? '<small>' + App.esc(g.note) + '</small>' : '') + '</span>' +
      '</button>' +
      '<button class="s-where" data-where="' + g.id + '" aria-label="Which store">' + App.icon('pin', 20) + '<span>' + (storeName(g.store) ? App.esc(storeName(g.store)) : 'Store') + '</span></button>' +
      '<div class="s-qty"><button data-qty="-1" data-id="' + g.id + '" aria-label="Less">' + App.icon('minus', 22) + '</button><span class="num">' + g.qty + '</span><button data-qty="1" data-id="' + g.id + '" aria-label="More">' + App.icon('plus', 22) + '</button></div>' +
      '</div>';
  }

  function byCat(list) {
    var order = catOrder();
    return list.slice().sort(function (a, b) { var x = order.indexOf(a.cat), y = order.indexOf(b.cat); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y); });
  }
  function storeSections(items) {
    var ids = stores().map(function (s) { return s.id; }).filter(function (id) { return V.store === 'all' || id === V.store; });
    var secs = ids.map(function (id) { return { key: 'store:' + id, name: storeName(id), items: byCat(items.filter(function (g) { return g.store === id; })) }; });
    secs.push({ key: 'store:', name: V.store === 'all' ? 'Any store' : 'Anywhere', items: byCat(items.filter(function (g) { return !storeName(g.store); })) });
    return secs.filter(function (x) { return x.items.length; });
  }
  function listHTML() {
    var items = open(), order = catOrder();
    var groups = sectioned() ? storeSections(items).map(function (x) { return { cat: x.key, label: x.name, items: x.items, store: true }; })
      : order.map(function (cat) { return { cat: cat, label: cat, items: items.filter(function (g) { return g.cat === cat; }) }; }).filter(function (x) { return x.items.length; });
    var d = done();
    return (items.length ? groups.map(function (gr) {
      return '<div class="s-cat' + (gr.store ? ' s-cat--store' : '') + '" data-cat="' + App.esc(gr.cat) + '"><div class="s-cat-h">' + (gr.store ? '<span class="s-store-h">' + App.icon('pin', 18) + App.esc(gr.label) + '</span>' : '<span class="label">' + App.esc(gr.label) + '</span>') + '<span class="label" data-cat-count>' + gr.items.length + '</span></div>' + gr.items.map(row).join('') + '</div>';
    }).join('') : '<div class="s-empty serif">All stocked up.<br><i>Nothing left to buy.</i></div>') +
      (d.length ? '<div class="s-drawer' + (V.drawer ? ' is-open' : '') + '">' +
        '<button class="s-drawer-h" data-drawer><span>' + App.icon('check', 22) + ' Got it <b class="num">(' + d.length + ')</b></span><span class="label">' + (V.drawer ? 'Hide' : 'Show') + '</span></button>' +
        (V.drawer ? '<div class="s-drawer-list">' + d.map(function (g) {
          return '<button class="s-got" data-revive="' + g.id + '">' + App.esc(g.name) + '<span class="label">Add back</span></button>';
        }).join('') + '<button class="btn btn--ghost s-clear" data-clear>Clear ' + d.length + ' checked items</button></div>' : '') +
        '</div>' : '');
  }

  function suggestHTML() {
    var q = V.query.trim().toLowerCase();
    if (q) {
      var matches = D.catalog.filter(function (c) { return c[0].toLowerCase().indexOf(q) === 0; })
        .concat(D.catalog.filter(function (c) { var i = c[0].toLowerCase().indexOf(q); return i > 0; })).slice(0, 5);
      var exact = matches.some(function (m) { return m[0].toLowerCase() === q; });
      return '<div class="label">Suggestions</div><div class="s-ac">' + matches.map(function (m) {
        var on = find(m[0], false);
        return '<button class="s-ac-row" data-add="' + App.esc(m[0]) + '"><b>' + App.esc(m[0]) + '</b><span class="label">' + (on ? 'On list · ×' + on.qty : m[1]) + '</span>' + App.icon('plus', 26) + '</button>';
      }).join('') + (exact ? '' : '<button class="s-ac-row s-ac-row--new" data-add="' + App.esc(V.query.trim()) + '"><b>Add “' + App.esc(V.query.trim()) + '”</b><span class="label">' + categorize(V.query) + '</span>' + App.icon('plus', 26) + '</button>') + '</div>';
    }
    return '<div class="label">Usuals · tap to add</div><div class="s-usuals">' + D.usuals.map(usualTile).join('') + '</div>';
  }
  function usualTile(name) {
    var on = find(name, false);
    return '<button class="s-tile' + (on ? ' is-on' : '') + '" data-add="' + App.esc(name) + '">' +
      '<b>' + App.esc(name) + '</b><span>' + (on ? App.icon('check', 16) + 'On list' + (on.qty > 1 ? ' ×' + on.qty : '') : categorize(name)) + '</span></button>';
  }

  // ---- granular updates (full list + usuals rebuild costs ~500ms on the wall tablet)
  function swap(old, html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    old.parentNode.replaceChild(tmp.firstChild, old);
  }
  function refreshSuggestFor(g) {
    if (V.query.trim()) return paintSuggest();
    var t = V.el.querySelector('.s-usuals [data-add="' + App.esc(g.name) + '"]');
    if (t) swap(t, usualTile(g.name));
  }
  function catCount(cat) {
    var c = V.el.querySelector('.s-cat[data-cat="' + cat + '"]');
    if (!c) return;
    var n = c.querySelectorAll('.s-row').length;
    if (!n) c.parentNode.removeChild(c);
    else c.querySelector('[data-cat-count]').textContent = n;
  }
  function inView(g) { return !g.done && inStore(g); }
  function insertRow(g) {
    if (sectioned() || V.el.querySelector('.s-cat--store')) return paintList();
    var cat = V.el.querySelector('.s-cat[data-cat="' + g.cat + '"]');
    if (!inView(g)) return paintHead();
    if (!cat) return paintList();
    var tmp = document.createElement('div');
    tmp.innerHTML = row(g);
    cat.appendChild(tmp.firstChild);
    catCount(g.cat);
    paintHead();
  }
  function removeRow(g) {
    var r = V.el.querySelector('.s-list [data-id="' + g.id + '"]');
    var drawer = V.el.querySelector('.s-drawer');
    if (!r || !drawer || V.drawer || !open().length || V.el.querySelector('.s-cat--store')) return paintList();
    r.parentNode.removeChild(r);
    catCount(g.cat);
    drawer.querySelector('.num').textContent = '(' + done().length + ')';
    paintHead();
  }
  function flash(g) {
    var r = V.el.querySelector('.s-list [data-id="' + g.id + '"]');
    if (!r) return;
    r.classList.add('is-flash');
    if (r.scrollIntoView) r.scrollIntoView({ block: 'nearest' });
    setTimeout(function () { r.classList.remove('is-flash'); }, 1200);
  }

  function paintList() { var l = V.el.querySelector('.s-list'); var st = l.scrollTop; l.innerHTML = listHTML(); l.scrollTop = st; paintHead(); }
  function paintSuggest() { V.el.querySelector('.s-suggest').innerHTML = suggestHTML(); }
  function paintHead() {
    var all = D.groceries.filter(function (g) { return !g.done; });
    V.el.querySelector('.s-count').innerHTML = '<span class="num">' + open().length + '</span> to get';
    // Tabs only for stores that have something on the list (or the one being looked at)
    var tabs = stores().filter(function (s) { return s.id === V.store || all.some(function (g) { return g.store === s.id; }); });
    if (V.store !== 'all' && !tabs.length) V.store = 'all';
    V.el.querySelector('.s-stores').style.display = tabs.length ? '' : 'none';
    V.el.querySelector('.s-stores').innerHTML = [['all', 'All']].concat(tabs.map(function (s) { return [s.id, s.name]; })).map(function (s) {
      var n = s[0] === 'all' ? all.length : all.filter(function (g) { return g.store === s[0]; }).length;
      return '<button class="' + (V.store === s[0] ? 'is-on' : '') + '" data-store="' + App.esc(s[0]) + '">' + App.esc(s[1]) + ' <span class="num">' + n + '</span></button>';
    }).join('');
  }
  function render() {
    V.el.innerHTML = '<div class="shop">' +
      '<header class="s-head"><div><div class="label">Shared list</div><h1 class="serif">Groceries</h1></div><div class="s-count"></div><div class="seg s-stores"></div></header>' +
      '<div class="s-list"></div>' +
      '<aside class="s-side">' +
      '  <div class="s-add">' +
      '    <label class="s-input-wrap">' + App.icon('plus', 30) + '<input class="s-input" placeholder="Add an item…" autocomplete="off" enterkeyhint="done"></label>' +
      '  </div>' +
      '  <div class="s-suggest"></div>' +
      '</aside></div>';
    var input = V.el.querySelector('.s-input');
    input.value = V.query;
    input.addEventListener('input', function () { V.query = input.value; paintSuggest(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && input.value.trim()) { add(input.value); } });
    paintList(); paintSuggest();
  }

  function add(name) {
    name = name.trim();
    var g = find(name, false), msg;
    if (g) {
      g.qty++;
      msg = 'Already on the list · now <b>×' + g.qty + '</b> ' + App.esc(g.name);
      var q = V.el.querySelector('.s-list [data-id="' + g.id + '"] .s-qty .num');
      if (q) q.textContent = g.qty;
    } else if ((g = find(name, true))) {
      g.done = false; g.qty = 1;
      msg = 'Added back <b>' + App.esc(g.name) + '</b>';
      paintList();
    } else {
      var cat = D.catalog.filter(function (c) { return c[0].toLowerCase() === name.toLowerCase(); })[0];
      g = { id: D._gid(), name: cat ? cat[0] : name.charAt(0).toUpperCase() + name.slice(1), cat: categorize(name), qty: 1, store: V.store === 'all' ? '' : V.store, done: false, note: '' };
      D.groceries.push(g);
      msg = 'Added <b>' + App.esc(g.name) + '</b>' + (storeName(g.store) ? ' for ' + App.esc(storeName(g.store)) : ' to ' + g.cat);
      insertRow(g);
    }
    var hadQuery = !!V.query.trim();
    V.query = '';
    var input = V.el.querySelector('.s-input');
    if (input) input.value = '';
    if (hadQuery) paintSuggest(); else refreshSuggestFor(g);
    flash(g);
    App.emit('data');
    App.toast(msg, { icon: 'cart', ms: 3000 });
  }

  function check(g) {
    V.pending[g.id] = true;
    var rowEl = V.el.querySelector('[data-id="' + g.id + '"]');
    rowEl.classList.add('is-checking');
    setTimeout(function () {
      if (!V.pending[g.id]) return;
      delete V.pending[g.id];
      g.done = true;
      removeRow(g);
      refreshSuggestFor(g);
      App.emit('data');
    }, 1200);
    App.toast('<b>' + App.esc(g.name) + '</b> checked off', {
      icon: 'check',
      undo: function () {
        var wasDone = g.done;
        delete V.pending[g.id];
        g.done = false;
        if (wasDone) paintList();
        else { var r = V.el.querySelector('.s-list [data-id="' + g.id + '"]'); if (r) r.classList.remove('is-checking'); }
        refreshSuggestFor(g);
        App.emit('data');
      }
    });
  }

  function pickStore(g) {
    function chips() {
      return [['', 'Any store']].concat(stores().map(function (s) { return [s.id, s.name]; })).map(function (s) {
        return '<button class="chip' + ((g.store || '') === s[0] || (!s[0] && !storeName(g.store)) ? ' is-on' : '') + '" data-pick="' + App.esc(s[0]) + '">' + App.esc(s[1]) + '</button>';
      }).join('');
    }
    App.sheet('<div class="sheet-pad"><div class="label">Where to buy</div><h2 class="serif sheet-h">' + App.esc(g.name) + '</h2>' +
      '<div class="chips s-pick">' + chips() + '</div>' +
      '<div class="s-newstore"><input class="s-input" data-newstore placeholder="Another store…" maxlength="40" enterkeyhint="done"><button class="btn" data-addstore>Add</button></div>' +
      '<div class="sheet-actions"><button class="btn btn--solid" data-close>Done</button></div></div>', {
      onMount: function (s, close) {
        function set(id) {
          g.store = id; App.emit('data'); close(); paintList();
          App.toast('<b>' + App.esc(g.name) + '</b> · ' + (storeName(id) ? App.esc(storeName(id)) : 'any store'), { icon: 'pin', ms: 2000 });
        }
        function addNew() {
          var inp = s.querySelector('[data-newstore]'), name = inp.value.trim(); if (!name) return inp.focus();
          fetch('/api/home/store', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HQ': '1' }, body: JSON.stringify({ name: name }) })
            .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Couldn’t add the store'); return j; }); })
            .then(function (j) { if (!storeName(j.id)) D.stores = stores().concat([{ id: j.id, name: j.name }]); set(j.id); })
            .catch(function (er) { App.toast(App.esc(er.message), { tone: 'error', icon: 'pin' }); });
        }
        s.querySelector('[data-newstore]').addEventListener('keydown', function (e) { if (e.key === 'Enter') addNew(); });
        s.addEventListener('click', function (e) {
          var b = e.target.closest('button'); if (!b) return;
          if (b.dataset.pick != null) set(b.dataset.pick);
          if (b.hasAttribute('data-addstore')) addNew();
        });
      }
    });
  }

  function onClick(e) {
    var t;
    if ((t = e.target.closest('[data-where]'))) { var gw = D.groceries.filter(function (x) { return x.id === t.dataset.where; })[0]; if (gw) pickStore(gw); return; }
    if ((t = e.target.closest('[data-check]'))) {
      var g = D.groceries.filter(function (x) { return x.id === t.dataset.check; })[0];
      if (g && !V.pending[g.id]) check(g);
      else if (g) { delete V.pending[g.id]; t.parentNode.classList.remove('is-checking'); }
      return;
    }
    if ((t = e.target.closest('[data-qty]'))) {
      var q = D.groceries.filter(function (x) { return x.id === t.dataset.id; })[0];
      q.qty = Math.max(1, q.qty + +t.dataset.qty);
      t.parentNode.querySelector('.num').textContent = q.qty;
      refreshSuggestFor(q);
      return;
    }
    if ((t = e.target.closest('[data-add]'))) return add(t.dataset.add);
    if ((t = e.target.closest('[data-store]'))) { V.store = t.dataset.store; return paintList(); }
    if ((t = e.target.closest('[data-drawer]'))) { V.drawer = !V.drawer; return paintList(); }
    if ((t = e.target.closest('[data-revive]'))) {
      var r = D.groceries.filter(function (x) { return x.id === t.dataset.revive; })[0];
      r.done = false; paintList(); paintSuggest(); App.emit('data');
      return App.toast('Added back <b>' + App.esc(r.name) + '</b>', { icon: 'cart', ms: 2500 });
    }
    if ((t = e.target.closest('[data-clear]'))) {
      var gone = done();
      D.groceries = D.groceries.filter(function (x) { return gone.indexOf(x) < 0; });
      V.drawer = false;
      paintList();
      App.toast('Cleared ' + gone.length + ' items', {
        icon: 'check', undo: function () { D.groceries = D.groceries.concat(gone); paintList(); }
      });
    }
  }

  App.register('shopping', {
    show: function (el) {
      if (!V.el) { V.el = el; el.addEventListener('click', onClick); }
      render();
    }
  });
})();
