// Small, complete chess rules engine: legal moves (castling, en passant, promotion), check,
// checkmate, stalemate, draws by insufficient material / 50 moves / threefold, FEN and SAN.
window.Chess = (function () {
  'use strict';
  var FILES = 'abcdefgh';
  var START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  function sqName(i) { return FILES[i % 8] + (8 - Math.floor(i / 8)); }
  function sqIndex(n) { return (8 - +n[1]) * 8 + FILES.indexOf(n[0]); }
  function color(p) { return p ? (p === p.toUpperCase() ? 'w' : 'b') : null; }
  function type(p) { return p ? p.toLowerCase() : null; }

  function parse(fen) {
    var f = fen.split(' '), board = [];
    f[0].split('/').forEach(function (row) {
      for (var i = 0; i < row.length; i++) {
        var c = row[i];
        if (/\d/.test(c)) for (var k = 0; k < +c; k++) board.push(null); else board.push(c);
      }
    });
    return { board: board, turn: f[1] || 'w', castle: f[2] === '-' ? '' : (f[2] || ''), ep: f[3] && f[3] !== '-' ? sqIndex(f[3]) : -1, half: +(f[4] || 0), full: +(f[5] || 1) };
  }
  function fen(s) {
    var rows = [];
    for (var r = 0; r < 8; r++) {
      var row = '', e = 0;
      for (var c = 0; c < 8; c++) {
        var p = s.board[r * 8 + c];
        if (!p) e++; else { if (e) { row += e; e = 0; } row += p; }
      }
      if (e) row += e;
      rows.push(row);
    }
    return rows.join('/') + ' ' + s.turn + ' ' + (s.castle || '-') + ' ' + (s.ep >= 0 ? sqName(s.ep) : '-') + ' ' + s.half + ' ' + s.full;
  }

  var KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  var KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  var DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]], ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  function at(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8 ? r * 8 + c : -1; }

  function attacked(b, sq, by) {
    var r = Math.floor(sq / 8), c = sq % 8, i, t, p;
    // pawns
    var dir = by === 'w' ? 1 : -1; // white pawns attack upward (from higher rank index)
    [[dir, -1], [dir, 1]].forEach(function () {});
    for (i = -1; i <= 1; i += 2) {
      t = at(r + dir, c + i);
      if (t >= 0 && b[t] === (by === 'w' ? 'P' : 'p')) return true;
    }
    for (i = 0; i < 8; i++) { t = at(r + KN[i][0], c + KN[i][1]); if (t >= 0 && b[t] === (by === 'w' ? 'N' : 'n')) return true; }
    for (i = 0; i < 8; i++) { t = at(r + KG[i][0], c + KG[i][1]); if (t >= 0 && b[t] === (by === 'w' ? 'K' : 'k')) return true; }
    function ray(dirs, kinds) {
      for (var d = 0; d < dirs.length; d++) {
        var rr = r + dirs[d][0], cc = c + dirs[d][1];
        while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
          p = b[rr * 8 + cc];
          if (p) { if (color(p) === by && kinds.indexOf(type(p)) > -1) return true; break; }
          rr += dirs[d][0]; cc += dirs[d][1];
        }
      }
      return false;
    }
    return ray(DIAG, 'bq') || ray(ORTH, 'rq');
  }
  function kingSq(b, side) { return b.indexOf(side === 'w' ? 'K' : 'k'); }
  function inCheck(s, side) { side = side || s.turn; return attacked(s.board, kingSq(s.board, side), side === 'w' ? 'b' : 'w'); }

  function pseudo(s) {
    var b = s.board, me = s.turn, them = me === 'w' ? 'b' : 'w', out = [];
    function add(f, t, extra) { out.push(Object.assign({ from: f, to: t, piece: b[f], captured: b[t] || null }, extra || {})); }
    for (var f = 0; f < 64; f++) {
      var p = b[f]; if (!p || color(p) !== me) continue;
      var r = Math.floor(f / 8), c = f % 8, k = type(p), t, i;
      if (k === 'p') {
        var dir = me === 'w' ? -1 : 1, startRow = me === 'w' ? 6 : 1, lastRow = me === 'w' ? 0 : 7;
        t = at(r + dir, c);
        if (t >= 0 && !b[t]) {
          if (r + dir === lastRow) 'qrbn'.split('').forEach(function (pr) { add(f, t, { promo: pr }); }); else add(f, t);
          var t2 = at(r + 2 * dir, c);
          if (r === startRow && !b[t2]) add(f, t2, { double: true });
        }
        for (i = -1; i <= 1; i += 2) {
          t = at(r + dir, c + i); if (t < 0) continue;
          if (b[t] && color(b[t]) === them) {
            if (r + dir === lastRow) 'qrbn'.split('').forEach(function (pr) { add(f, t, { promo: pr }); }); else add(f, t);
          } else if (t === s.ep) add(f, t, { enpassant: true, captured: me === 'w' ? 'p' : 'P' });
        }
      } else if (k === 'n' || k === 'k') {
        var steps = k === 'n' ? KN : KG;
        for (i = 0; i < 8; i++) { t = at(r + steps[i][0], c + steps[i][1]); if (t >= 0 && color(b[t]) !== me) add(f, t); }
        if (k === 'k') {
          var home = me === 'w' ? 60 : 4, K = me === 'w' ? 'K' : 'k', Q = me === 'w' ? 'Q' : 'q';
          if (f === home && !attacked(b, f, them)) {
            if (s.castle.indexOf(K) > -1 && !b[f + 1] && !b[f + 2] && b[f + 3] === (me === 'w' ? 'R' : 'r') && !attacked(b, f + 1, them) && !attacked(b, f + 2, them)) add(f, f + 2, { castle: 'k' });
            if (s.castle.indexOf(Q) > -1 && !b[f - 1] && !b[f - 2] && !b[f - 3] && b[f - 4] === (me === 'w' ? 'R' : 'r') && !attacked(b, f - 1, them) && !attacked(b, f - 2, them)) add(f, f - 2, { castle: 'q' });
          }
        }
      } else {
        var dirs = k === 'b' ? DIAG : k === 'r' ? ORTH : DIAG.concat(ORTH);
        for (i = 0; i < dirs.length; i++) {
          var rr = r + dirs[i][0], cc = c + dirs[i][1];
          while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
            t = rr * 8 + cc;
            if (!b[t]) add(f, t); else { if (color(b[t]) === them) add(f, t); break; }
            rr += dirs[i][0]; cc += dirs[i][1];
          }
        }
      }
    }
    return out;
  }

  function apply(s, m) {
    var b = s.board.slice(), me = s.turn, p = b[m.from];
    b[m.to] = m.promo ? (me === 'w' ? m.promo.toUpperCase() : m.promo) : p;
    b[m.from] = null;
    if (m.enpassant) b[m.to + (me === 'w' ? 8 : -8)] = null;
    if (m.castle === 'k') { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = null; }
    if (m.castle === 'q') { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = null; }
    var castle = s.castle;
    function drop(ch) { castle = castle.replace(ch, ''); }
    if (p === 'K') { drop('K'); drop('Q'); } if (p === 'k') { drop('k'); drop('q'); }
    [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']].forEach(function (x) { if (m.from === x[0] || m.to === x[0]) drop(x[1]); });
    return {
      board: b, turn: me === 'w' ? 'b' : 'w', castle: castle,
      ep: m.double ? (m.from + m.to) / 2 : -1,
      half: type(p) === 'p' || m.captured ? 0 : s.half + 1,
      full: s.full + (me === 'b' ? 1 : 0)
    };
  }

  function legal(s) {
    return pseudo(s).filter(function (m) { var n = apply(s, m); return !attacked(n.board, kingSq(n.board, s.turn), n.turn); });
  }

  function san(s, m, all) {
    var out;
    if (m.castle) out = m.castle === 'k' ? 'O-O' : 'O-O-O';
    else {
      var k = type(m.piece), cap = m.captured ? 'x' : '';
      if (k === 'p') out = (cap ? FILES[m.from % 8] : '') + cap + sqName(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
      else {
        var same = all.filter(function (o) { return o !== m && o.to === m.to && o.piece === m.piece && o.from !== m.from; });
        var dis = '';
        if (same.length) {
          if (!same.some(function (o) { return o.from % 8 === m.from % 8; })) dis = FILES[m.from % 8];
          else if (!same.some(function (o) { return Math.floor(o.from / 8) === Math.floor(m.from / 8); })) dis = sqName(m.from)[1];
          else dis = sqName(m.from);
        }
        out = k.toUpperCase() + dis + cap + sqName(m.to);
      }
    }
    var n = apply(s, m);
    if (inCheck(n)) out += legal(n).length ? '+' : '#';
    return out;
  }

  function insufficient(b) {
    var rest = b.filter(function (p) { return p && type(p) !== 'k'; });
    if (!rest.length) return true;
    return rest.length === 1 && (type(rest[0]) === 'b' || type(rest[0]) === 'n');
  }

  // A game: FEN history so it can be saved, synced, undone and checked for repetition.
  function Game(saved) {
    this.history = (saved && saved.history) || [START];
    this.moves = (saved && saved.moves) || [];
    this.last = (saved && saved.last) || null;
  }
  Game.prototype.state = function () { return parse(this.history[this.history.length - 1]); };
  Game.prototype.fen = function () { return this.history[this.history.length - 1]; };
  Game.prototype.turn = function () { return this.state().turn; };
  Game.prototype.board = function () { return this.state().board; };
  Game.prototype.legalFrom = function (sq) { return legal(this.state()).filter(function (m) { return m.from === sq; }); };
  Game.prototype.move = function (from, to, promo) {
    var s = this.state(), all = legal(s);
    var m = all.filter(function (x) { return x.from === from && x.to === to && (!x.promo || x.promo === (promo || 'q')); })[0];
    if (!m) return null;
    var note = san(s, m, all);
    this.history.push(fen(apply(s, m)));
    this.moves.push(note);
    this.last = { from: from, to: to };
    return { san: note, captured: m.captured };
  };
  Game.prototype.undo = function () {
    if (this.history.length < 2) return false;
    this.history.pop(); this.moves.pop();
    this.last = null;
    return true;
  };
  Game.prototype.inCheck = function () { return inCheck(this.state()); };
  Game.prototype.status = function () {
    var s = this.state(), moves = legal(s);
    if (!moves.length) return inCheck(s) ? { over: true, result: 'checkmate', winner: s.turn === 'w' ? 'b' : 'w' } : { over: true, result: 'stalemate' };
    if (insufficient(s.board)) return { over: true, result: 'insufficient material' };
    if (s.half >= 100) return { over: true, result: 'fifty-move rule' };
    var key = function (f) { return f.split(' ').slice(0, 4).join(' '); }, now = key(this.fen());
    if (this.history.filter(function (f) { return key(f) === now; }).length >= 3) return { over: true, result: 'threefold repetition' };
    return { over: false };
  };
  Game.prototype.captured = function () {
    var full = { p: 8, n: 2, b: 2, r: 2, q: 1 }, b = this.board(), out = { w: [], b: [] };
    ['w', 'b'].forEach(function (side) {
      Object.keys(full).forEach(function (k) {
        var have = b.filter(function (p) { return p && type(p) === k && color(p) === side; }).length;
        for (var i = have; i < full[k]; i++) out[side].push(k);
      });
    });
    return out; // pieces each side has lost
  };
  Game.prototype.save = function () { return { history: this.history.slice(), moves: this.moves.slice(), last: this.last }; };

  return { Game: Game, sqName: sqName, color: color, type: type, START: START, _parse: parse, _legal: legal };
})();
