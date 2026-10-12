// Games: chess for JD and Georgia on the frame, with a running win record.
// The game in progress is saved on the Mac mini, so it survives reloads and can be continued
// from a phone too.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null, screen: 'hub', game: null, sel: -1, targets: [] };
  var GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  var VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

  function people() {
    var ps = D.people && D.people.length >= 2 ? D.people.slice(0, 2) : [
      { id: 'jd', name: 'JD', color: '#6E8069', rgb: '110 128 105', ink: '#FFFFFF' },
      { id: 'georgia', name: 'Georgia', color: '#A8644A', rgb: '168 100 74', ink: '#FFFFFF' }];
    return ps;
  }
  function chessData() {
    D.games = D.games || {};
    var c = D.games.chess = D.games.chess || {};
    c.record = c.record || {};
    c.history = c.history || [];
    return c;
  }
  function name(id) { return App.person(id).name; }
  function save() { App.emit('data'); }

  // ------------------------------------------------------------ hub
  function hub() {
    var c = chessData(), ps = people(), r = c.record;
    var cur = c.current && !c.current.over ? c.current : null;
    return '<div class="gm-hub">' +
      '<div class="gm-hub-h"><h2 class="serif">Games</h2></div>' +
      '<div class="gm-chess card">' +
      '  <div class="gm-chess-art">' + ['r', 'n', 'b', 'q', 'k', 'p'].map(function (k, i) { return '<span class="pc pc--' + (i % 2 ? 'b' : 'w') + '">' + GLYPH[k] + '︎</span>'; }).join('') + '</div>' +
      '  <div class="gm-chess-main"><div class="label">Chess</div>' +
      '    <div class="gm-score">' + ps.map(function (p, i) {
        return (i ? '<span class="gm-vs">–</span>' : '') + '<span class="gm-player" style="' + App.pstyle(p) + '">' + App.avatar(p, 44) + '<b class="num">' + (r[p.id] || 0) + '</b><small>' + App.esc(p.name) + '</small></span>';
      }).join('') + '</div>' +
      '    <div class="gm-sub">' + (r.draws ? r.draws + (r.draws === 1 ? ' draw' : ' draws') + ' · ' : '') + c.history.length + (c.history.length === 1 ? ' game played' : ' games played') + '</div>' +
      '    <div class="gm-actions">' + (cur ? '<button class="btn btn--solid" data-continue>' + App.icon('play', 22) + 'Continue game</button>' : '') +
      '      <button class="btn' + (cur ? '' : ' btn--solid') + '" data-new>' + App.icon('plus', 22) + 'New game</button></div>' +
      '  </div></div>' +
      (c.history.length ? '<div class="label gm-recent-l">Recent games</div><div class="gm-recent">' + c.history.slice(-6).reverse().map(function (h) {
        var d = new Date(h.at);
        var res = h.winner ? '<b style="' + App.pstyle(h.winner) + '">' + App.esc(name(h.winner)) + ' won</b>' : '<b>Draw</b>';
        return '<div class="gm-row">' + res + '<span>' + App.esc(h.result) + ' · ' + h.moves + ' moves</span><small>' + App.fmt.dayShort(d) + ' ' + App.fmt.monthShort(d) + ' ' + d.getDate() + '</small></div>';
      }).join('') + '</div>' : '<p class="gm-note">Play a game and the record starts here.</p>') +
      '</div>';
  }

  // ------------------------------------------------------------ chess screen
  function playerFor(side) { var c = chessData().current; return side === 'w' ? c.white : c.black; }
  function material(lost) { return lost.reduce(function (s, k) { return s + VALUE[k]; }, 0); }
  function sideCard(side) {
    var c = chessData().current, g = V.game, pid = playerFor(side), p = App.person(pid);
    var turn = !c.over && g.turn() === side;
    var lostByOther = g.captured()[side === 'w' ? 'b' : 'w'];
    var adv = material(g.captured()[side === 'w' ? 'b' : 'w']) - material(g.captured()[side]);
    return '<div class="gm-side' + (turn ? ' is-turn' : '') + '" style="' + App.pstyle(p) + '">' + App.avatar(p, 44) +
      '<div><b>' + App.esc(p.name) + '</b><small>' + (side === 'w' ? 'White' : 'Black') + (turn ? (g.inCheck() ? ' · in check!' : ' · your move') : '') + '</small>' +
      '<span class="gm-caps">' + lostByOther.map(function (k) { return '<i class="pc pc--' + (side === 'w' ? 'b' : 'w') + '">' + GLYPH[k] + '︎</i>'; }).join('') + (adv > 0 ? '<em>+' + adv + '</em>' : '') + '</span></div></div>';
  }
  function boardHTML() {
    var g = V.game, b = g.board(), last = g.last || chessData().current.last, check = g.inCheck() ? b.indexOf(g.turn() === 'w' ? 'K' : 'k') : -1;
    var html = '';
    for (var i = 0; i < 64; i++) {
      var p = b[i], r = Math.floor(i / 8), c = i % 8, cls = 'sq ' + ((r + c) % 2 ? 'sq--d' : 'sq--l');
      if (i === V.sel) cls += ' is-sel';
      if (last && (i === last.from || i === last.to)) cls += ' is-last';
      if (i === check) cls += ' is-check';
      var tgt = V.targets.indexOf(i) > -1;
      html += '<button class="' + cls + '" data-sq="' + i + '">' +
        (c === 0 ? '<span class="sq-r">' + (8 - r) + '</span>' : '') + (r === 7 ? '<span class="sq-f">' + 'abcdefgh'[c] + '</span>' : '') +
        (p ? '<span class="pc pc--' + Chess.color(p) + '">' + GLYPH[Chess.type(p)] + '︎</span>' : '') +
        (tgt ? '<i class="' + (p ? 'cap' : 'dot') + '"></i>' : '') + '</button>';
    }
    return html;
  }
  function movesHTML() {
    var m = V.game.moves, rows = [];
    for (var i = 0; i < m.length; i += 2) rows.push('<li><span>' + (i / 2 + 1) + '.</span><b>' + m[i] + '</b><b>' + (m[i + 1] || '') + '</b></li>');
    return rows.slice(-8).join('');
  }
  function banner() {
    var c = chessData().current;
    if (!c.over) return '';
    return '<div class="gm-over">' + (c.winner ? '<b style="' + App.pstyle(c.winner) + '">' + App.esc(name(c.winner)) + ' wins!</b>' : '<b>Draw</b>') +
      '<span>' + App.esc(c.result) + '</span><button class="btn btn--solid" data-new>Rematch</button></div>';
  }
  function chessScreen() {
    return '<div class="gm-play">' +
      '<div class="gm-board">' + boardHTML() + '</div>' +
      '<div class="gm-panel">' +
      '  <button class="gm-back" data-hub>' + App.icon('left', 22) + ' Games</button>' +
      '  <div class="gm-black">' + sideCard('b') + '</div>' +
      '  <div class="gm-mid">' + banner() + '<ol class="gm-moves">' + movesHTML() + '</ol></div>' +
      '  <div class="gm-white">' + sideCard('w') + '</div>' +
      '  <div class="gm-tools">' +
      '    <button class="btn" data-undo>' + App.icon('undo', 22) + 'Undo</button>' +
      '    <button class="btn" data-draw>Draw</button>' +
      '    <button class="btn" data-resign>Resign</button>' +
      '  </div></div></div>';
  }
  function paintPlay() {
    if (V.screen !== 'chess' || !V.el) return;
    V.el.querySelector('.gm-board').innerHTML = boardHTML();
    V.el.querySelector('.gm-black').innerHTML = sideCard('b');
    V.el.querySelector('.gm-white').innerHTML = sideCard('w');
    V.el.querySelector('.gm-mid').innerHTML = banner() + '<ol class="gm-moves">' + movesHTML() + '</ol>';
  }
  function paint() {
    if (!V.el) return;
    var box = V.el.querySelector('.gm');
    if (V.screen === 'chess' && chessData().current) { loadGame(); box.innerHTML = chessScreen(); }
    else { V.screen = 'hub'; box.innerHTML = hub(); }
  }

  function loadGame() { V.game = new Chess.Game(chessData().current); }
  function store() {
    var c = chessData().current;
    Object.assign(c, V.game.save());
    var st = V.game.status();
    if (st.over && !c.over) finish(st.winner ? playerFor(st.winner) : null, st.result);
    save();
  }
  function finish(winner, result) {
    var c = chessData(), cur = c.current;
    cur.over = true; cur.winner = winner; cur.result = result;
    if (winner) c.record[winner] = (c.record[winner] || 0) + 1; else c.record.draws = (c.record.draws || 0) + 1;
    c.history.push({ at: Date.now(), white: cur.white, black: cur.black, winner: winner, result: result, moves: Math.ceil(V.game.moves.length / 2) });
    c.history = c.history.slice(-100);
    App.toast(winner ? '<b>' + App.esc(name(winner)) + '</b> wins · ' + App.esc(result) : 'Draw · ' + App.esc(result), { icon: 'star', ms: 5000 });
  }

  function newGame() {
    var ps = people(), c = chessData();
    var lastWhite = c.current ? c.current.white : ps[1].id;
    App.sheet('<div class="sheet-pad"><div class="label">New game of chess</div><h2 class="serif sheet-h">Who plays white?</h2>' +
      '<p class="sheet-p">White moves first.</p><div class="gm-pick">' + ps.map(function (p) {
        return '<button class="gm-pickbtn' + (p.id !== lastWhite ? ' is-sug' : '') + '" data-white="' + App.esc(p.id) + '" style="' + App.pstyle(p) + '">' + App.avatar(p, 56) + '<b>' + App.esc(p.name) + '</b><small>' + (p.id !== lastWhite ? 'Their turn to start' : '') + '</small></button>';
      }).join('') + '</div></div>', {
      onMount: function (s, close) {
        s.addEventListener('click', function (e) {
          var b = e.target.closest('[data-white]'); if (!b) return;
          var w = b.dataset.white, bl = ps.filter(function (p) { return p.id !== w; })[0].id;
          c.current = { white: w, black: bl, history: [Chess.START], moves: [], last: null, over: false, started: Date.now() };
          V.sel = -1; V.targets = []; V.screen = 'chess';
          close(); paint(); save();
        });
      }
    });
  }
  function askPromotion(side, cb) {
    App.sheet('<div class="sheet-pad"><div class="label">Promote pawn</div><h2 class="serif sheet-h">Choose a piece</h2><div class="gm-promo">' +
      ['q', 'r', 'b', 'n'].map(function (k) { return '<button data-promo="' + k + '"><span class="pc pc--' + side + '">' + GLYPH[k] + '︎</span></button>'; }).join('') + '</div></div>', {
      onMount: function (s, close) { s.addEventListener('click', function (e) { var b = e.target.closest('[data-promo]'); if (b) { close(); cb(b.dataset.promo); } }); }
    });
  }
  function confirmSheet(title, text, label, fn) {
    App.sheet('<div class="sheet-pad"><h2 class="serif sheet-h">' + title + '</h2><p class="sheet-p">' + text + '</p><div class="sheet-actions"><button class="btn" data-close>Cancel</button><button class="btn btn--solid" data-ok>' + label + '</button></div></div>', {
      onMount: function (s, close) { s.querySelector('[data-ok]').onclick = function () { close(); fn(); }; }
    });
  }

  function tapSquare(i) {
    var c = chessData().current;
    if (!c || c.over) return;
    var g = V.game, p = g.board()[i];
    if (V.sel >= 0 && V.targets.indexOf(i) > -1) {
      var from = V.sel, moving = g.board()[from];
      var promo = Chess.type(moving) === 'p' && (Math.floor(i / 8) === 0 || Math.floor(i / 8) === 7);
      var go = function (pr) {
        var res = g.move(from, i, pr);
        V.sel = -1; V.targets = [];
        if (res) store();
        paintPlay();
      };
      if (promo) return askPromotion(Chess.color(moving), go);
      return go();
    }
    if (p && Chess.color(p) === g.turn()) {
      V.sel = V.sel === i ? -1 : i;
      V.targets = V.sel >= 0 ? g.legalFrom(i).map(function (m) { return m.to; }).filter(function (t, k, a) { return a.indexOf(t) === k; }) : [];
    } else { V.sel = -1; V.targets = []; }
    paintPlay();
  }

  App.register('games', {
    show: function (el) {
      if (!V.el) {
        V.el = el;
        el.innerHTML = '<div class="gm"></div>';
        el.addEventListener('click', function (e) {
          var t;
          if ((t = e.target.closest('[data-sq]'))) return tapSquare(+t.dataset.sq);
          if (e.target.closest('[data-new]')) return newGame();
          if (e.target.closest('[data-continue]')) { V.screen = 'chess'; V.sel = -1; V.targets = []; return paint(); }
          if (e.target.closest('[data-hub]')) { V.screen = 'hub'; return paint(); }
          var c = chessData().current;
          if (!c) return;
          if (e.target.closest('[data-undo]')) {
            if (c.over) return App.toast('The game is over · start a rematch', { icon: 'undo', ms: 2200 });
            if (V.game.undo()) { V.sel = -1; V.targets = []; store(); paintPlay(); }
            return;
          }
          if (e.target.closest('[data-draw]') && !c.over) return confirmSheet('Call it a draw?', 'Both of you agree the game ends level.', 'Draw', function () { finish(null, 'agreed draw'); save(); paintPlay(); });
          if (e.target.closest('[data-resign]') && !c.over) {
            var side = V.game.turn(), loser = playerFor(side), winner = playerFor(side === 'w' ? 'b' : 'w');
            return confirmSheet(App.esc(name(loser)) + ' resigns?', App.esc(name(winner)) + ' gets the win.', 'Resign', function () { finish(winner, App.esc(name(loser)) + ' resigned'); save(); paintPlay(); });
          }
        });
      }
      paint();
    }
  });
  // A move made on another screen (phone) shows up here
  App.on('data', function () {
    if (!V.el || App.current !== 'games') return;
    if (V.screen === 'chess' && chessData().current) {
      var mine = V.game && V.game.fen(), theirs = chessData().current.history[chessData().current.history.length - 1];
      if (mine !== theirs) { loadGame(); V.sel = -1; V.targets = []; paintPlay(); }
    }
  });
})();
