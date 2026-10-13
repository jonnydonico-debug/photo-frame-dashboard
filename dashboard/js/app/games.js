// Games: chess with the same record and the same game in progress as the frame.
// Play on one phone together, or continue a game started on the frame. The board turns so your
// pieces are at the bottom when it's your game.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { screen: 'hub', game: null, sel: -1, targets: [] };
  var GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  var VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

  function chess() {
    D.games = D.games || {};
    var c = D.games.chess = D.games.chess || {};
    c.record = c.record || {}; c.history = c.history || [];
    return c;
  }
  function two() { var ps = App.people(); return ps.length >= 2 ? ps.slice(0, 2) : ps.concat(ps); }
  function name(id) { return App.person(id).name; }
  function cur() { return chess().current; }
  function playerFor(side) { var c = cur(); return side === 'w' ? c.white : c.black; }
  function flipped() { var c = cur(), me = App.me(); return !!(c && me && c.black === me && c.white !== me); }
  function pc(color, k) { return '<span class="pc pc--' + color + '">' + GLYPH[k] + '︎</span>'; }

  // ------------------------------------------------------------ hub
  function hub() {
    var c = chess(), ps = two(), r = c.record, live = c.current && !c.current.over ? c.current : null, me = App.me();
    var turnNote = '';
    if (live) { var g = new Chess.Game(live), who = g.turn() === 'w' ? live.white : live.black; turnNote = who === me ? 'Your move' : App.esc(name(who)) + '’s move'; }
    return App.head('Games') +
      '<div class="card gm-card"><div class="card-h">' + pc('w', 'k') + '<span>Chess</span></div>' +
      '<div class="gm-score">' + ps.map(function (p, i) {
        return (i ? '<span class="gm-vs">–</span>' : '') + '<span class="gm-pl" style="' + App.pstyle(p) + '">' + App.avatar(p, 40) + '<b>' + (r[p.id] || 0) + '</b><small>' + App.esc(p.name) + '</small></span>';
      }).join('') + '</div>' +
      '<p class="gm-sub">' + (r.draws ? r.draws + (r.draws === 1 ? ' draw · ' : ' draws · ') : '') + c.history.length + (c.history.length === 1 ? ' game played' : ' games played') + '</p>' +
      (live ? '<button class="btn btn--solid btn--wide" data-continue>' + App.icon('play', 18) + 'Continue game · ' + turnNote + '</button>' : '') +
      '<button class="btn btn--wide' + (live ? '' : ' btn--solid') + '" data-new>' + App.icon('plus', 18) + 'New game</button></div>' +
      (c.history.length ? '<div class="sec-l">Recent games</div><div class="group">' + c.history.slice(-8).reverse().map(function (h) {
        var d = new Date(h.at);
        return '<div class="gm-row"><span>' + (h.winner ? '<b style="' + App.pstyle(h.winner) + '">' + App.esc(name(h.winner)) + ' won</b>' : '<b>Draw</b>') + '<small>' + App.esc(h.result) + ' · ' + h.moves + ' moves</small></span><em>' + App.fmt.monthShort(d) + ' ' + d.getDate() + '</em></div>';
      }).join('') + '</div>' : '<p class="muted pad">Play a game and the record starts here.</p>');
  }

  // ------------------------------------------------------------ board
  function side(sideC) {
    var c = cur(), g = V.game, p = App.person(playerFor(sideC)), turn = !c.over && g.turn() === sideC;
    var caps = g.captured()[sideC === 'w' ? 'b' : 'w'];
    var adv = caps.reduce(function (s, k) { return s + VALUE[k]; }, 0) - g.captured()[sideC].reduce(function (s, k) { return s + VALUE[k]; }, 0);
    return '<div class="gm-side' + (turn ? ' is-turn' : '') + '" style="' + App.pstyle(p) + '">' + App.avatar(p, 30) +
      '<span><b>' + App.esc(p.name) + '</b><small>' + (sideC === 'w' ? 'White' : 'Black') + (turn ? (g.inCheck() ? ' · in check!' : ' · to move') : '') + '</small></span>' +
      '<span class="gm-caps">' + caps.map(function (k) { return '<i class="pc pc--' + (sideC === 'w' ? 'b' : 'w') + '">' + GLYPH[k] + '︎</i>'; }).join('') + (adv > 0 ? '<em>+' + adv + '</em>' : '') + '</span></div>';
  }
  function board() {
    var g = V.game, b = g.board(), last = g.last || cur().last, chk = g.inCheck() ? b.indexOf(g.turn() === 'w' ? 'K' : 'k') : -1, f = flipped(), html = '';
    for (var k = 0; k < 64; k++) {
      var i = f ? 63 - k : k, p = b[i], r = Math.floor(i / 8), c = i % 8, cls = 'sq ' + ((r + c) % 2 ? 'sq--d' : 'sq--l');
      if (i === V.sel) cls += ' is-sel';
      if (last && (i === last.from || i === last.to)) cls += ' is-last';
      if (i === chk) cls += ' is-check';
      var tgt = V.targets.indexOf(i) > -1, kr = Math.floor(k / 8), kc = k % 8;
      html += '<button class="' + cls + '" data-sq="' + i + '">' +
        (kc === 0 ? '<span class="sq-r">' + (8 - r) + '</span>' : '') + (kr === 7 ? '<span class="sq-f">' + 'abcdefgh'[c] + '</span>' : '') +
        (p ? pc(Chess.color(p), Chess.type(p)) : '') + (tgt ? '<i class="' + (p ? 'cap' : 'dot') + '"></i>' : '') + '</button>';
    }
    return html;
  }
  function moves() {
    var m = V.game.moves, out = [];
    for (var i = 0; i < m.length; i += 2) out.push('<span><em>' + (i / 2 + 1) + '.</em>' + m[i] + ' ' + (m[i + 1] || '') + '</span>');
    return out.slice(-6).join('');
  }
  function over() {
    var c = cur(); if (!c.over) return '';
    return '<div class="gm-over">' + (c.winner ? '<b style="' + App.pstyle(c.winner) + '">' + App.esc(name(c.winner)) + ' wins!</b>' : '<b>Draw</b>') + '<span>' + App.esc(c.result) + '</span><button class="btn btn--solid" data-new>Rematch</button></div>';
  }
  function play() {
    var top = flipped() ? 'w' : 'b', bottom = top === 'w' ? 'b' : 'w';
    return '<button class="back" data-hub>' + App.icon('left', 20) + 'Games</button>' +
      '<div class="gm-play"><div class="gm-top">' + side(top) + '</div>' +
      '<div class="gm-board">' + board() + '</div>' +
      '<div class="gm-bottom">' + side(bottom) + '</div>' +
      '<div class="gm-mid">' + over() + '<div class="gm-moves">' + moves() + '</div></div>' +
      '<div class="gm-tools"><button class="btn" data-undo>' + App.icon('undo', 18) + 'Undo</button><button class="btn" data-draw>Draw</button><button class="btn" data-resign>Resign</button></div></div>';
  }
  function el() { return App.$('.scr[data-scr="games"]'); }
  function paintPlay() {
    var e = el(); if (!e || V.screen !== 'chess') return;
    var top = flipped() ? 'w' : 'b', bottom = top === 'w' ? 'b' : 'w';
    e.querySelector('.gm-board').innerHTML = board();
    e.querySelector('.gm-top').innerHTML = side(top);
    e.querySelector('.gm-bottom').innerHTML = side(bottom);
    e.querySelector('.gm-mid').innerHTML = over() + '<div class="gm-moves">' + moves() + '</div>';
  }

  // ------------------------------------------------------------ actions
  function store() {
    var c = cur();
    Object.assign(c, V.game.save());
    var st = V.game.status();
    if (st.over && !c.over) finish(st.winner ? playerFor(st.winner) : null, st.result);
    App.save();
  }
  function finish(winner, result) {
    var c = chess(), g = c.current;
    g.over = true; g.winner = winner; g.result = result;
    if (winner) c.record[winner] = (c.record[winner] || 0) + 1; else c.record.draws = (c.record.draws || 0) + 1;
    c.history.push({ at: Date.now(), white: g.white, black: g.black, winner: winner, result: result, moves: Math.ceil(V.game.moves.length / 2) });
    c.history = c.history.slice(-100);
    App.toast(winner ? '<b>' + App.esc(name(winner)) + '</b> wins · ' + App.esc(result) : 'Draw · ' + App.esc(result), { icon: 'star', ms: 4000 });
  }
  function newGame() {
    var ps = two(), c = chess(), lastWhite = c.current ? c.current.white : ps[1].id;
    App.sheet('<div class="sh-pad"><h2 class="sh-h">Who plays white?</h2><p class="sh-p">White moves first.</p><div class="gm-pick">' + ps.map(function (p) {
      return '<button data-white="' + App.esc(p.id) + '" style="' + App.pstyle(p) + '">' + App.avatar(p, 52) + '<b>' + App.esc(p.name) + '</b><small>' + (p.id !== lastWhite ? 'Their turn to start' : '&nbsp;') + '</small></button>';
    }).join('') + '</div></div>', {
      onMount: function (s, close) {
        s.addEventListener('click', function (e) {
          var b = e.target.closest('[data-white]'); if (!b) return;
          var w = b.dataset.white, bl = ps.filter(function (p) { return p.id !== w; })[0].id;
          // Starting over abandons any game in progress; it doesn't count for anyone.
          c.current = { white: w, black: bl, history: [Chess.START], moves: [], last: null, over: false, started: Date.now() };
          V.sel = -1; V.targets = []; V.screen = 'chess'; V.game = new Chess.Game(c.current);
          close(); App.save(); App.rerender();
        });
      }
    });
  }
  function promote(color, cb) {
    App.sheet('<div class="sh-pad"><h2 class="sh-h">Promote pawn</h2><div class="gm-promo">' + ['q', 'r', 'b', 'n'].map(function (k) { return '<button data-promo="' + k + '">' + pc(color, k) + '</button>'; }).join('') + '</div></div>', {
      onMount: function (s, close) { s.addEventListener('click', function (e) { var b = e.target.closest('[data-promo]'); if (b) { close(); cb(b.dataset.promo); } }); }
    });
  }
  function tap(i) {
    var c = cur(); if (!c || c.over) return;
    var g = V.game, p = g.board()[i];
    if (V.sel >= 0 && V.targets.indexOf(i) > -1) {
      var from = V.sel, mv = g.board()[from];
      var go = function (pr) { var ok = g.move(from, i, pr); V.sel = -1; V.targets = []; if (ok) { store(); if (navigator.vibrate) navigator.vibrate(12); } paintPlay(); };
      if (Chess.type(mv) === 'p' && (Math.floor(i / 8) === 0 || Math.floor(i / 8) === 7)) return promote(Chess.color(mv), go);
      return go();
    }
    if (p && Chess.color(p) === g.turn()) {
      V.sel = V.sel === i ? -1 : i;
      V.targets = V.sel >= 0 ? g.legalFrom(i).map(function (m) { return m.to; }).filter(function (t, k, a) { return a.indexOf(t) === k; }) : [];
    } else { V.sel = -1; V.targets = []; }
    paintPlay();
  }

  App.screen('games', {
    tab: 'more',
    render: function (e) {
      if (V.screen === 'chess' && cur()) { V.game = new Chess.Game(cur()); e.innerHTML = play(); }
      else { V.screen = 'hub'; e.innerHTML = '<button class="back" data-go="more">' + App.icon('left', 20) + 'More</button>' + hub(); }
      if (!e.dataset.wired) {
        e.dataset.wired = '1';
        e.addEventListener('click', function (ev) {
          var t;
          if ((t = ev.target.closest('[data-sq]'))) return tap(+t.dataset.sq);
          if (ev.target.closest('[data-new]')) return newGame();
          if (ev.target.closest('[data-continue]')) { V.screen = 'chess'; V.sel = -1; V.targets = []; return App.rerender(); }
          if (ev.target.closest('[data-hub]')) { V.screen = 'hub'; return App.rerender(); }
          if ((t = ev.target.closest('[data-go]'))) return App.go(t.dataset.go);
          var c = cur(); if (!c) return;
          if (ev.target.closest('[data-undo]')) {
            if (c.over) return App.toast('The game is over · start a rematch', { icon: 'undo', ms: 2000 });
            if (V.game.undo()) { V.sel = -1; V.targets = []; store(); paintPlay(); }
            return;
          }
          if (ev.target.closest('[data-draw]') && !c.over) return App.confirm('Call it a draw?', 'You both agree the game ends level.', 'Draw', function () { finish(null, 'agreed draw'); App.save(); paintPlay(); });
          if (ev.target.closest('[data-resign]') && !c.over) {
            var me = App.me(), sideC = (me && (me === c.white || me === c.black) && c.white !== c.black) ? (me === c.white ? 'w' : 'b') : V.game.turn();
            var loser = playerFor(sideC), winner = playerFor(sideC === 'w' ? 'b' : 'w');
            return App.confirm(App.esc(name(loser)) + ' resigns?', App.esc(name(winner)) + ' gets the win.', 'Resign', function () { finish(winner, name(loser) + ' resigned'); App.save(); paintPlay(); }, true);
          }
        });
      }
    },
    reset: function () { V.screen = 'hub'; },
    live: function () {}
  });
  // A move made on the frame (or the other phone) shows up here straight away
  App.on('data', function () {
    if (App.current !== 'games' || V.screen !== 'chess' || !cur() || !V.game) return;
    var theirs = cur().history[cur().history.length - 1];
    if (V.game.fen() !== theirs) { V.game = new Chess.Game(cur()); V.sel = -1; V.targets = []; paintPlay(); }
  });
})();
