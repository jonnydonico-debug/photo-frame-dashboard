// Recipes: everything texted to the iMessage agent (as text or a photo) or added on the phone.
// Saved on the Mac mini in DATA.recipes; photos come from /api/home/recipes/photo/<id>.jpg.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null, q: '', tag: '' };
  var STAPLES = /^(salt|kosher salt|sea salt|pepper|black pepper|salt and pepper|water|ice|oil|olive oil|vegetable oil|canola oil|cooking spray)$/i;

  function recipes() { return (D.recipes || []).slice().sort(function (a, b) { return b.at - a.at; }); }
  function total(r) { return (r.prepMin || 0) + (r.cookMin || 0); }
  function mins(m) { return m >= 60 ? Math.floor(m / 60) + ' hr' + (m % 60 ? ' ' + m % 60 + ' min' : '') : m + ' min'; }
  function meta(r) {
    var t = total(r), bits = [];
    if (t) bits.push(mins(t));
    if (r.servings) bits.push('serves ' + r.servings);
    bits.push((r.ingredients || []).length + ' ingredients');
    return bits.join(' · ');
  }
  function topTags() {
    var n = {};
    (D.recipes || []).forEach(function (r) { (r.tags || []).forEach(function (t) { n[t] = (n[t] || 0) + 1; }); });
    return Object.keys(n).sort(function (a, b) { return n[b] - n[a]; }).slice(0, 8);
  }
  function matches(r) {
    var q = V.q.toLowerCase();
    if (V.tag && (r.tags || []).indexOf(V.tag) < 0) return false;
    return !q || r.title.toLowerCase().indexOf(q) > -1 || (r.tags || []).some(function (t) { return t.indexOf(q) > -1; }) ||
      (r.ingredients || []).some(function (i) { return i.item.toLowerCase().indexOf(q) > -1; });
  }
  function card(r) {
    return '<button class="rc-card" data-rc="' + App.esc(r.id) + '">' +
      (r.photo ? '<span class="rc-img"><img src="' + App.esc(r.photo) + '" alt="" loading="lazy"></span>' : '<span class="rc-img rc-img--none">' + App.icon('utensils', 40) + '</span>') +
      '<span class="rc-body"><b>' + App.esc(r.title) + '</b><small>' + meta(r) + '</small>' +
      ((r.tags || []).length ? '<span class="rc-tags">' + r.tags.slice(0, 3).map(function (t) { return '<i>' + App.esc(t) + '</i>'; }).join('') + '</span>' : '') + '</span></button>';
  }

  function render() {
    if (!V.el) return;
    var all = recipes(), L = all.filter(matches), tags = topTags();
    V.el.innerHTML = '<div class="rc">' +
      '<header class="rc-head"><div><h2 class="serif">Recipes</h2><span class="label">' + (all.length ? all.length + (all.length === 1 ? ' recipe' : ' recipes') + ' · ' : '') + 'Text Dommy a recipe or a photo of one to add it</span></div>' +
      '<label class="rc-search">' + App.icon('search', 22) + '<input type="search" placeholder="Search recipes or ingredients" value="' + App.esc(V.q) + '"></label></header>' +
      (tags.length ? '<div class="rc-chips"><button class="chip' + (!V.tag ? ' is-on' : '') + '" data-tag="">All</button>' + tags.map(function (t) {
        return '<button class="chip' + (V.tag === t ? ' is-on' : '') + '" data-tag="' + App.esc(t) + '">' + App.esc(t) + '</button>';
      }).join('') + '</div>' : '') +
      '<div class="rc-grid">' + (L.length ? L.map(card).join('') : '') + '</div>' +
      (!all.length ? '<div class="rc-empty"><h2 class="serif">No recipes yet.</h2><p class="serif"><i>Text Dommy one.</i></p>' +
        '<span>Send the recipe as a text, or a photo of a cookbook page, a screenshot or a handwritten card. It shows up here and on the phone.</span></div>'
        : !L.length ? '<div class="rc-empty"><span>Nothing matches “' + App.esc(V.q || V.tag) + '”.</span></div>' : '') +
      '</div>';
    var input = V.el.querySelector('.rc-search input');
    input.addEventListener('input', function () {
      V.q = input.value.trim();
      var LL = recipes().filter(matches);
      V.el.querySelector('.rc-grid').innerHTML = LL.map(card).join('');
    });
  }

  // ------------------------------------------------------------ one recipe, readable from across the kitchen
  function ingList(r) {
    var out = '', sec = null;
    (r.ingredients || []).forEach(function (i) {
      if ((i.section || '') !== (sec || '')) { sec = i.section || ''; if (sec) out += '<li class="rc-sec">' + App.esc(sec) + '</li>'; }
      out += '<li><button class="rc-ing" data-ing><i></i><span><b>' + App.esc(i.amount || '') + '</b> ' + App.esc(i.item) + (i.note ? '<small>, ' + App.esc(i.note) + '</small>' : '') + '</span></button></li>';
    });
    return out;
  }
  function open(id) {
    var r = (D.recipes || []).filter(function (x) { return x.id === id; })[0]; if (!r) return;
    var by = r.by ? App.person(r.by) : null, pills = [];
    if (r.prepMin) pills.push('Prep ' + mins(r.prepMin));
    if (r.cookMin) pills.push('Cook ' + mins(r.cookMin));
    if (r.servings) pills.push('Serves ' + App.esc(r.servings));
    App.sheet('<div class="sheet-pad rc-sheet">' +
      '<header class="rc-sh-head">' + (r.photo ? '<button class="rc-sh-img" data-photo><img src="' + App.esc(r.photo) + '" alt=""></button>' : '') +
      '<div><div class="label">' + ((r.tags || []).length ? App.esc(r.tags.join(' · ')) : 'Recipe') + '</div><h2 class="serif sheet-h">' + App.esc(r.title) + '</h2>' +
      '<div class="rc-pills">' + pills.map(function (p) { return '<span>' + p + '</span>'; }).join('') +
      (r.source ? '<span>' + App.icon('pin', 15) + App.esc(r.source) + '</span>' : '') + '</div></div></header>' +
      '<div class="rc-cols"><section><div class="label">Ingredients</div><ul class="rc-ings">' + ingList(r) + '</ul></section>' +
      '<section><div class="label">Steps</div><ol class="rc-steps">' + (r.steps || []).map(function (s) { return '<li>' + App.esc(s) + '</li>'; }).join('') + '</ol>' +
      (r.notes ? '<div class="rc-notes"><div class="label">Notes</div><p>' + App.esc(r.notes) + '</p></div>' : '') + '</section></div>' +
      '<footer class="rc-foot"><small>' + (by ? 'Added by ' + App.esc(by.name) + ' · ' : '') + App.fmt.monthShort(new Date(r.at)) + ' ' + new Date(r.at).getDate() + (r.via === 'photo' ? ' · from a photo' : r.via === 'text' ? ' · from a text' : '') + '</small>' +
      '<button class="btn btn--solid" data-shop>' + App.icon('cart', 22) + 'Add to shopping list</button></footer></div>', {
      cls: 'sheet--wide sheet--recipe',
      onMount: function (s, close) {
        s.addEventListener('click', function (e) {
          var b = e.target.closest('button'); if (!b) return;
          if (b.hasAttribute('data-ing')) b.classList.toggle('is-on');   // tick off while cooking (this screen only)
          if (b.hasAttribute('data-shop')) { close(); shop(r); }
          if (b.hasAttribute('data-photo')) { close(); App.sheet('<div class="rc-photo"><img src="' + App.esc(r.photo) + '" alt=""></div>', { cls: 'sheet--wide sheet--photo', onClose: function () { setTimeout(function () { open(id); }, 0); } }); }
        });
      }
    });
  }

  // Pick which ingredients go on the list (pantry basics start unticked)
  function shop(r) {
    var pick = (r.ingredients || []).map(function (i) { return !STAPLES.test(i.item.trim()); });
    function count() { return pick.filter(Boolean).length; }
    App.sheet('<div class="sheet-pad"><div class="label">' + App.esc(r.title) + '</div><h2 class="serif sheet-h">Add to shopping list</h2>' +
      '<div class="rc-pick">' + (r.ingredients || []).map(function (i, k) {
        return '<button class="rc-pk' + (pick[k] ? ' is-on' : '') + '" data-k="' + k + '"><i>' + App.icon('check', 18) + '</i><span>' + App.esc(i.item) + (i.amount ? '<small>' + App.esc(i.amount) + '</small>' : '') + '</span></button>';
      }).join('') + '</div>' +
      '<div class="sheet-actions"><button class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--solid" data-go-shop>Add <span data-n>' + count() + '</span></button></div></div>', {
      cls: 'sheet--wide',
      onMount: function (s, close) {
        s.addEventListener('click', function (e) {
          var b = e.target.closest('button'); if (!b) return;
          if (b.dataset.k != null) { var k = +b.dataset.k; pick[k] = !pick[k]; b.classList.toggle('is-on', pick[k]); s.querySelector('[data-n]').textContent = count(); }
          if (b.hasAttribute('data-go-shop')) {
            var items = (r.ingredients || []).filter(function (i, k) { return pick[k]; }).map(function (i) { return i.item; });
            if (!items.length) return close();
            b.disabled = true;
            fetch('/api/home/recipes/shop', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HQ': '1' }, body: JSON.stringify({ id: r.id, items: items, who: 'frame' }) })
              .then(function (res) { return res.json().then(function (j) { if (!res.ok) throw new Error(j.error || 'Couldn’t reach the Mac mini'); return j; }); })
              .then(function (j) { close(); App.toast('Added ' + (j.added || []).length + ' to the shopping list', { icon: 'cart', ms: 3000 }); })
              .catch(function (er) { b.disabled = false; App.toast(App.esc(er.message), { tone: 'error', icon: 'cart' }); });
          }
        });
      }
    });
  }

  App.register('recipes', {
    show: function (el) {
      if (!V.el) {
        V.el = el;
        el.addEventListener('click', function (e) {
          var t;
          if ((t = e.target.closest('[data-tag]'))) { V.tag = t.dataset.tag; return render(); }
          if ((t = e.target.closest('[data-rc]'))) return open(t.dataset.rc);
        });
      }
      render();
    }
  });
})();
