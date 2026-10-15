// Recipes: the same recipes as the frame's Recipes tab (DATA.recipes). Most arrive by texting the
// iMessage agent a recipe or a photo of one; here you can also add, edit and delete them, and put
// the ingredients on the shopping list.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { q: '', id: null };
  var STAPLES = /^(salt|kosher salt|sea salt|pepper|black pepper|salt and pepper|water|ice|oil|olive oil|vegetable oil|canola oil|cooking spray)$/i;

  function all() { return (D.recipes || []).slice().sort(function (a, b) { return b.at - a.at; }); }
  function get(id) { return (D.recipes || []).filter(function (r) { return r.id === id; })[0]; }
  function mins(m) { return m >= 60 ? Math.floor(m / 60) + ' hr' + (m % 60 ? ' ' + m % 60 + ' min' : '') : m + ' min'; }
  function meta(r) {
    var t = (r.prepMin || 0) + (r.cookMin || 0), bits = [];
    if (t) bits.push(mins(t));
    if (r.servings) bits.push('serves ' + r.servings);
    bits.push((r.ingredients || []).length + ' ingredients');
    return bits.join(' · ');
  }
  function matches(r, q) {
    q = q.toLowerCase();
    return !q || r.title.toLowerCase().indexOf(q) > -1 || (r.tags || []).some(function (t) { return t.indexOf(q) > -1; }) ||
      (r.ingredients || []).some(function (i) { return i.item.toLowerCase().indexOf(q) > -1; });
  }
  function row(r) {
    return '<button class="rcp-row" data-open="' + App.esc(r.id) + '">' +
      (r.photo ? '<img src="' + App.esc(r.photo) + '" alt="" loading="lazy">' : '<span class="rcp-ph">' + App.icon('utensils', 22) + '</span>') +
      '<span><b>' + App.esc(r.title) + '</b><small>' + meta(r) + '</small>' +
      ((r.tags || []).length ? '<em>' + r.tags.slice(0, 3).map(App.esc).join(' · ') + '</em>' : '') + '</span>' + App.icon('right', 18) + '</button>';
  }

  // ------------------------------------------------------------ list
  App.screen('recipes', {
    tab: 'more',
    render: function (el) {
      var L = all();
      el.innerHTML = '<button class="back" data-go="more">' + App.icon('left', 20) + 'More</button>' +
        App.head('Recipes', L.length ? L.length + (L.length === 1 ? ' recipe' : ' recipes') : 'Text Dommy a recipe to add one', '<button class="hd-add" data-add aria-label="Add recipe">' + App.icon('plus', 24) + '</button>') +
        (L.length ? '<form class="search rcp-search" onsubmit="return false">' + App.icon('search', 18) + '<input type="search" placeholder="Search recipes or ingredients" value="' + App.esc(V.q) + '"></form>' +
          '<div class="group rcp-list">' + L.filter(function (r) { return matches(r, V.q); }).map(row).join('') + '</div>'
          : '<div class="empty quiet"><b>No recipes yet.</b><i>Text Dommy one.</i><span>Send a recipe as a text, or a photo of a cookbook page, a screenshot or a handwritten card. It’s saved here and on the frame.</span></div>');
      var input = el.querySelector('.rcp-search input');
      if (input) input.oninput = function () {
        V.q = input.value.trim();
        el.querySelector('.rcp-list').innerHTML = all().filter(function (r) { return matches(r, V.q); }).map(row).join('') || '<p class="pad muted">Nothing matches.</p>';
      };
      if (!el.dataset.wired) {
        el.dataset.wired = '1';
        el.addEventListener('click', function (e) {
          var t;
          if ((t = e.target.closest('[data-go]'))) return App.go(t.dataset.go);
          if (e.target.closest('[data-add]')) return edit(null);
          if ((t = e.target.closest('[data-open]'))) { V.id = t.dataset.open; return App.go('recipe'); }
        });
      }
    }
  });

  // ------------------------------------------------------------ one recipe
  App.screen('recipe', {
    tab: 'more',
    render: function (el) {
      var r = get(V.id);
      if (!r) { el.innerHTML = '<button class="back" data-go="recipes">' + App.icon('left', 20) + 'Recipes</button><div class="empty"><b>That recipe is gone</b></div>'; return wire(el); }
      var by = r.by ? App.person(r.by) : null, pills = [], sec = null;
      if (r.prepMin) pills.push('Prep ' + mins(r.prepMin));
      if (r.cookMin) pills.push('Cook ' + mins(r.cookMin));
      if (r.servings) pills.push('Serves ' + App.esc(r.servings));
      el.innerHTML = '<button class="back" data-go="recipes">' + App.icon('left', 20) + 'Recipes</button>' +
        (r.photo ? '<button class="rcp-hero" data-photo><img src="' + App.esc(r.photo) + '" alt=""></button>' : '') +
        App.head(App.esc(r.title), (r.tags || []).length ? App.esc(r.tags.join(' · ')) : '') +
        (pills.length || r.source ? '<div class="pills rcp-pills">' + pills.map(function (p) { return '<span>' + p + '</span>'; }).join('') + (r.source ? '<span>' + App.esc(r.source) + '</span>' : '') + '</div>' : '') +
        '<button class="btn btn--solid btn--wide" data-shop>' + App.icon('cart', 18) + 'Add to shopping list</button>' +
        '<div class="sec-l">Ingredients</div><div class="group">' + (r.ingredients || []).map(function (i) {
          var head = '';
          if ((i.section || '') !== (sec || '')) { sec = i.section || ''; if (sec) head = '<div class="rcp-sec">' + App.esc(sec) + '</div>'; }
          return head + '<button class="rcp-ing" data-ing><i></i><span><b>' + App.esc(i.amount || '') + '</b> ' + App.esc(i.item) + (i.note ? '<small>, ' + App.esc(i.note) + '</small>' : '') + '</span></button>';
        }).join('') + '</div>' +
        '<div class="sec-l">Steps</div><ol class="card rcp-steps">' + (r.steps || []).map(function (s) { return '<li>' + App.esc(s) + '</li>'; }).join('') + '</ol>' +
        (r.notes ? '<div class="sec-l">Notes</div><div class="card"><p class="rcp-notes">' + App.esc(r.notes) + '</p></div>' : '') +
        '<div class="rcp-actions"><button class="btn" data-edit>' + App.icon('sliders', 18) + 'Edit</button><button class="btn btn--danger" data-del>Delete</button></div>' +
        '<p class="foot">' + (by ? 'Added by ' + App.esc(by.name) + ' · ' : '') + App.fmt.monthShort(new Date(r.at)) + ' ' + new Date(r.at).getDate() +
        (r.via === 'photo' ? ' · from a photo' : r.via === 'text' ? ' · from a text' : '') + '</p>';
      wire(el);
    }
  });
  function wire(el) {
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    el.addEventListener('click', function (e) {
      var t, r = get(V.id);
      if ((t = e.target.closest('[data-go]'))) return App.go(t.dataset.go);
      if (!r) return;
      if ((t = e.target.closest('[data-ing]'))) return t.classList.toggle('is-on');   // tick off while cooking (this phone only)
      if (e.target.closest('[data-shop]')) return shop(r);
      if (e.target.closest('[data-edit]')) return edit(r);
      if (e.target.closest('[data-photo]')) return photo(r);
      if (e.target.closest('[data-del]')) return App.confirm('Delete ' + App.esc(r.title) + '?', 'It’s removed from the frame and every phone.', 'Delete', function () {
        var before = (D.recipes || []).slice();
        D.recipes = before.filter(function (x) { return x.id !== r.id; });
        App.save(); App.go('recipes');
        App.toast('Deleted <b>' + App.esc(r.title) + '</b>', { icon: 'x', undo: function () { D.recipes = before; App.save(); App.rerender(); } });
      }, true);
    });
  }

  function photo(r) {
    var v = document.createElement('div');
    v.className = 'viewer is-open';
    v.innerHTML = '<img src="' + App.esc(r.photo) + '" alt=""><div class="vw-top"><button aria-label="Close">' + App.icon('x', 22) + '</button><span>' + App.esc(r.title) + '</span><span></span></div>';
    v.querySelector('button').onclick = function () { v.remove(); };
    document.body.appendChild(v);
  }

  // Pick which ingredients go on the list (pantry basics start unticked)
  function shop(r) {
    var pick = (r.ingredients || []).map(function (i) { return !STAPLES.test(i.item.trim()); });
    App.sheet('<div class="sh-pad"><div class="sh-kick">' + App.esc(r.title) + '</div><h2 class="sh-h">Add to shopping list</h2><div class="sh-list rcp-pick">' +
      (r.ingredients || []).map(function (i, k) {
        return '<button data-k="' + k + '" class="' + (pick[k] ? 'is-on' : '') + '"><i>' + App.icon('check', 14) + '</i><span>' + App.esc(i.item) + (i.amount ? '<small>' + App.esc(i.amount) + '</small>' : '') + '</span></button>';
      }).join('') + '</div><div class="sh-actions"><button class="btn" data-close>Cancel</button><button class="btn btn--solid" data-ok>Add <span data-n></span></button></div></div>', {
      onMount: function (s, close) {
        function n() { s.querySelector('[data-n]').textContent = pick.filter(Boolean).length; }
        n();
        s.addEventListener('click', function (e) {
          var b = e.target.closest('button'); if (!b) return;
          if (b.dataset.k != null) { pick[+b.dataset.k] = !pick[+b.dataset.k]; b.classList.toggle('is-on'); n(); }
          if (b.hasAttribute('data-ok')) {
            var items = (r.ingredients || []).filter(function (i, k) { return pick[k]; }).map(function (i) { return i.item; });
            if (!items.length) return close();
            b.disabled = true;
            App.post('/api/home/recipes/shop', { id: r.id, items: items, who: App.me() }).then(function (j) {
              close(); App.toast('Added ' + (j.added || []).length + ' to the shopping list', { icon: 'cart', ms: 2600 });
            }).catch(function (er) { b.disabled = false; App.toast(App.esc(er.message), { tone: 'error', icon: 'cart' }); });
          }
        });
      }
    });
  }

  // ------------------------------------------------------------ add / edit (one ingredient or step per line)
  function ingLine(i) { return [i.amount, i.item].filter(Boolean).join(' ') + (i.note ? ', ' + i.note : ''); }
  var UNIT = /^((?:\d+[\d\/\s.,-]*|½|¼|¾|⅓|⅔|a|an|one|two|three)\s*(?:cups?|c\.?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|l|liters?|cloves?|cans?|pinch(?:es)?|dash(?:es)?|sticks?|slices?|bunch(?:es)?|large|medium|small|handful)?\.?)\s+(.+)$/i;
  function parseIng(line, old) {
    var prev = (old || []).filter(function (i) { return ingLine(i) === line; })[0];
    if (prev) return prev;   // unchanged lines keep their section and detail
    var note = '', m, item = line;
    var c = line.indexOf(','); if (c > 0) { note = line.slice(c + 1).trim(); item = line.slice(0, c).trim(); }
    m = UNIT.exec(item);
    return m ? { item: m[2].trim(), amount: m[1].trim(), note: note || undefined } : { item: item, amount: '', note: note || undefined };
  }
  function edit(r) {
    var x = r || { title: '', ingredients: [], steps: [], tags: [] };
    function f(label, name, val, attrs) { return '<label class="fld"><span>' + label + '</span><input data-f="' + name + '" value="' + App.esc(val == null ? '' : val) + '"' + (attrs || '') + '></label>'; }
    App.sheet('<div class="sh-pad"><h2 class="sh-h">' + (r ? 'Edit recipe' : 'New recipe') + '</h2>' +
      f('Title', 'title', x.title, ' maxlength="120"') +
      '<div class="rcp-3">' + f('Serves', 'servings', x.servings, ' maxlength="40"') + f('Prep (min)', 'prep', x.prepMin, ' inputmode="numeric"') + f('Cook (min)', 'cook', x.cookMin, ' inputmode="numeric"') + '</div>' +
      '<label class="fld"><span>Ingredients · one per line, e.g. “2 lb chicken thighs, boneless”</span><textarea data-f="ings" rows="7">' + App.esc((x.ingredients || []).map(ingLine).join('\n')) + '</textarea></label>' +
      '<label class="fld"><span>Steps · one per line</span><textarea data-f="steps" rows="7">' + App.esc((x.steps || []).join('\n')) + '</textarea></label>' +
      f('Tags · comma separated', 'tags', (x.tags || []).join(', ')) + f('Source', 'source', x.source, ' maxlength="200"') +
      '<label class="fld"><span>Notes</span><textarea data-f="notes" rows="3">' + App.esc(x.notes || '') + '</textarea></label>' +
      '<div class="sh-actions"><button class="btn" data-close>Cancel</button><button class="btn btn--solid" data-save>Save</button></div></div>', {
      onMount: function (s, close) {
        var v = function (k) { return s.querySelector('[data-f="' + k + '"]').value.trim(); };
        var num = function (k) { var n = Math.round(+v(k)); return n > 0 ? n : null; };
        s.querySelector('[data-save]').onclick = function () {
          var title = v('title'); if (!title) return s.querySelector('[data-f=title]').focus();
          var clash = (D.recipes || []).some(function (o) { return o.title.toLowerCase() === title.toLowerCase() && (!r || o.id !== r.id); });
          if (clash) return App.toast('There’s already a recipe called that', { tone: 'error', icon: 'utensils' });
          var lines = function (k) { return v(k).split('\n').map(function (l) { return l.trim().replace(/^(\d+[.)]|[-•*])\s+/, ''); }).filter(Boolean); };
          var next = Object.assign({}, x, {
            title: title, servings: v('servings'), prepMin: num('prep'), cookMin: num('cook'),
            ingredients: lines('ings').map(function (l) { return parseIng(l, x.ingredients); }), steps: lines('steps'),
            tags: v('tags').split(',').map(function (t) { return t.trim().toLowerCase(); }).filter(Boolean).slice(0, 10),
            source: v('source'), notes: v('notes')
          });
          if (r) { next.edited = Date.now(); D.recipes = (D.recipes || []).map(function (o) { return o.id === r.id ? next : o; }); }
          else { next.id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); next.by = App.me(); next.at = Date.now(); next.via = 'phone'; D.recipes = [next].concat(D.recipes || []); }
          close(); App.save();
          V.id = next.id;
          if (App.current === 'recipe') App.rerender(); else App.go('recipe');
          App.toast((r ? 'Saved ' : 'Added ') + '<b>' + App.esc(title) + '</b>', { icon: 'check', ms: 2000 });
        };
      }
    });
  }
})();
