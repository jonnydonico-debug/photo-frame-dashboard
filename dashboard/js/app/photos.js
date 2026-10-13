// Photos: the shared album that plays on the frame. Grid, full-screen viewer with swipe, favourites.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { i: -1 };

  function photos() { return (D.photos || []).filter(function (p) { return p.src; }); }
  function fmtDate(s) { if (!s) return ''; var d = new Date(s + 'T12:00:00'); return isNaN(d) ? '' : App.fmt.month(d) + ' ' + d.getDate() + ', ' + d.getFullYear(); }

  function viewer(i) {
    var ps = photos(); if (!ps.length) return;
    V.i = (i + ps.length) % ps.length;
    var box = App.$('#viewer');
    if (!box) { box = document.createElement('div'); box.id = 'viewer'; box.className = 'viewer'; document.body.appendChild(box); wire(box); }
    var p = ps[V.i];
    box.innerHTML = '<img src="' + App.esc(p.src) + '" alt="">' +
      '<div class="vw-top"><button data-vx aria-label="Close">' + App.icon('x', 22) + '</button><span>' + (V.i + 1) + ' of ' + ps.length + '</span>' +
      '<button data-vfav class="' + (p.fav ? 'is-on' : '') + '" aria-label="Favourite">' + App.icon('heart', 22) + '</button></div>' +
      '<div class="vw-bot">' + App.esc([fmtDate(p.date), p.place].filter(Boolean).join(' · ')) + '</div>';
    box.classList.add('is-open');
    document.body.classList.add('no-scroll');
    // Preload the neighbours so swiping feels instant
    [1, -1].forEach(function (d) { var n = ps[(V.i + d + ps.length) % ps.length]; if (n) { var im = new Image(); im.src = n.src; } });
  }
  function close() { var b = App.$('#viewer'); if (b) b.classList.remove('is-open'); document.body.classList.remove('no-scroll'); V.i = -1; }
  function wire(box) {
    var x0 = null, y0 = null;
    box.addEventListener('click', function (e) {
      if (e.target.closest('[data-vx]')) return close();
      if (e.target.closest('[data-vfav]')) {
        var p = photos()[V.i]; if (!p) return;
        p.fav = !p.fav; App.save(); viewer(V.i);
        App.toast(p.fav ? 'Favourite · it’ll show up more on the frame' : 'Removed from favourites', { icon: 'heart', ms: 2000 });
        return;
      }
      if (e.target.tagName === 'IMG') { var w = window.innerWidth; viewer(V.i + (e.clientX > w / 2 ? 1 : -1)); }
    });
    box.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    box.addEventListener('touchend', function (e) {
      if (x0 == null) return;
      var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) viewer(V.i + (dx < 0 ? 1 : -1));
      else if (dy > 90) close();
    });
  }

  App.screen('photos', {
    tab: 'more',
    render: function (el) {
      var ps = photos(), favs = ps.filter(function (p) { return p.fav; }).length;
      el.innerHTML = '<button class="back" data-go="more">' + App.icon('left', 20) + 'More</button>' +
        App.head('Photos', ps.length ? ps.length + ' photos' + (favs ? ' · ' + favs + ' favourites' : '') + ' · from your shared album' : '') +
        (ps.length ? '<div class="pgrid">' + ps.map(function (p, i) {
          return '<button data-ph="' + i + '"><img src="' + App.esc(p.src) + '" alt="" loading="lazy">' + (p.fav ? '<i>' + App.icon('heart', 14) + '</i>' : '') + '</button>';
        }).join('') + '</div>' : '<div class="empty">' + App.icon('photo', 30) + '<b>No photos yet</b><span>Link your iCloud shared album in Admin → Photos. New photos you add to it show up here and on the frame.</span></div>');
      if (!el.dataset.wired) {
        el.dataset.wired = '1';
        el.addEventListener('click', function (e) {
          var t;
          if ((t = e.target.closest('[data-ph]'))) return viewer(+t.dataset.ph);
          if ((t = e.target.closest('[data-go]'))) App.go(t.dataset.go);
        });
      }
    },
    leave: close
  });
})();
