/*
 * Формулы Excel: разбор и вычисление по книге, прочитанной XlsxReader.
 * Считаем «лениво»: ячейка вычисляется, когда её спросили, результат запоминается до следующего ввода.
 * Функции — те, что встречаются в калькуляторах компании, и распространённые соседние;
 * незнакомая функция даёт #NAME? и попадает в book.unknown — генератор об этом скажет.
 */
(function (root) {
  'use strict';

  var COLS = 16385, MAXR = 1048576, MAXC = 16384, DEPTH = 400;

  /* ── значения ── */
  function Err(code) { this.e = code; }
  var ERR = {};
  ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#CIRC!'].forEach(function (c) { ERR[c] = new Err(c); });
  function err(code) { return ERR[code] || new Err(code); }
  var NA = ERR['#N/A'], VALUE = ERR['#VALUE!'], REF = ERR['#REF!'], DIV0 = ERR['#DIV/0!'], NUM = ERR['#NUM!'], NAME = ERR['#NAME?'];
  function isErr(v) { return v !== null && typeof v === 'object' && typeof v.e === 'string'; }
  var MISSING = { missing: true };           // пропущенный аргумент: IF(a,,b)
  var DEEP = { deep: true };                 // слишком длинная цепочка ссылок — досчитываем лист по порядку

  function Ref(sh, r1, c1, r2, c2) { this.sh = sh; this.r1 = r1; this.c1 = c1; this.r2 = r2; this.c2 = c2; }
  function Arr(rows) { this.rows = rows; }

  function colNum(s) { var n = 0; s = s.toUpperCase(); for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n; }
  function colName(c) { var s = ''; while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; } return s; }

  /* ── разбор формулы ── */
  var ERR_RE = /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|GETTING_DATA|SPILL!|CALC!)/i;
  var AFTER_REF = /[\w.( -￿]/;

  function tokenize(s) {
    var out = [], i = 0, n = s.length, m;
    while (i < n) {
      var ch = s.charAt(i);
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { i++; continue; }
      if (ch === '"') {
        var j = i + 1, v = '';
        for (;;) {
          if (j >= n) throw new Error('незакрытая строка');
          var cj = s.charAt(j);
          if (cj === '"') { if (s.charAt(j + 1) === '"') { v += '"'; j += 2; continue; } break; }
          v += cj; j++;
        }
        out.push({ k: 'str', v: v }); i = j + 1; continue;
      }
      if (ch === '#') {
        m = ERR_RE.exec(s.slice(i, i + 16));
        if (!m) throw new Error('непонятное ' + s.slice(i, i + 8));
        out.push({ k: 'err', v: m[0].toUpperCase() }); i += m[0].length; continue;
      }
      if ('(),;{}'.indexOf(ch) >= 0) { out.push({ k: ch }); i++; continue; }
      if (ch === '<' || ch === '>') {
        var two = s.substr(i, 2);
        if (two === '<=' || two === '>=' || two === '<>') { out.push({ k: 'op', v: two }); i += 2; continue; }
        out.push({ k: 'op', v: ch }); i++; continue;
      }
      if ('+-*/^&=%:'.indexOf(ch) >= 0) { out.push({ k: 'op', v: ch }); i++; continue; }

      var rest = s.slice(i), sheet = null, ext = false, pm = null;
      if (ch === "'") pm = /^'((?:[^']|'')+)'!/.exec(rest);
      else if (ch === '[') pm = /^\[(\d+)\]([^!\s"'(),;:+\-*\/^&=<>{}%#]*)!/.exec(rest);
      else pm = /^([^\s!"'(),;:+\-*\/^&=<>{}%#\[\]]+)!/.exec(rest);
      if (pm) {
        if (ch === '[') { ext = pm[1] !== '0'; sheet = pm[2] || null; }
        else {
          sheet = ch === "'" ? pm[1].replace(/''/g, "'") : pm[1];
          var bk = /^\[(\d+)\](.*)$/.exec(sheet);
          if (bk) { ext = bk[1] !== '0'; sheet = bk[2] || null; }
        }
        i += pm[0].length; rest = s.slice(i);
        if (rest.slice(0, 5).toUpperCase() === '#REF!') { out.push({ k: 'err', v: '#REF!' }); i += 5; continue; }
      }
      m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+):(\$?)([A-Za-z]{1,3})(\$?)(\d+)/.exec(rest);
      if (m && !AFTER_REF.test(rest.charAt(m[0].length))) {
        var ac1 = colNum(m[2]), ar1 = +m[4], ac2 = colNum(m[6]), ar2 = +m[8];
        if (ac1 <= MAXC && ac2 <= MAXC && ar1 >= 1 && ar2 >= 1 && ar1 <= MAXR && ar2 <= MAXR) {
          out.push({ k: 'area', sh: sheet, ext: ext, r1: ar1, c1: ac1, r2: ar2, c2: ac2, ca1: !!m[1], ra1: !!m[3], ca2: !!m[5], ra2: !!m[7] });
          i += m[0].length; continue;
        }
      }
      m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)/.exec(rest);
      if (m && !AFTER_REF.test(rest.charAt(m[0].length))) {
        var rc = colNum(m[2]), rr = +m[4];
        if (rc <= MAXC && rr >= 1 && rr <= MAXR) {
          out.push({ k: 'ref', sh: sheet, ext: ext, r: rr, c: rc, ca: !!m[1], ra: !!m[3] });
          i += m[0].length; continue;
        }
      }
      m = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})/.exec(rest);
      if (m && !AFTER_REF.test(rest.charAt(m[0].length))) {
        out.push({ k: 'area', sh: sheet, ext: ext, r1: 1, c1: colNum(m[2]), r2: MAXR, c2: colNum(m[4]), ca1: !!m[1], ra1: true, ca2: !!m[3], ra2: true });
        i += m[0].length; continue;
      }
      m = /^(\$?)(\d+):(\$?)(\d+)/.exec(rest);
      if (m && !AFTER_REF.test(rest.charAt(m[0].length))) {
        out.push({ k: 'area', sh: sheet, ext: ext, r1: +m[2], c1: 1, r2: +m[4], c2: MAXC, ca1: true, ra1: !!m[1], ca2: true, ra2: !!m[3] });
        i += m[0].length; continue;
      }
      if (!pm) {
        m = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
        if (m) { out.push({ k: 'num', v: +m[0] }); i += m[0].length; continue; }
      }
      m = /^[A-Za-z_\\ -￿][\w.\\? -￿]*/.exec(rest);
      if (m) {
        var id = m[0], up = id.toUpperCase();
        i += id.length;
        if (!pm && s.charAt(i) === '(') { out.push({ k: 'fn', v: up.replace(/^(_XLFN\.|_XLWS\.)+/, '') }); continue; }
        if (!pm && (up === 'TRUE' || up === 'FALSE')) { out.push({ k: 'bool', v: up === 'TRUE' }); continue; }
        out.push({ k: 'name', sh: sheet, ext: ext, v: id }); continue;
      }
      throw new Error('непонятное «' + rest.slice(0, 12) + '»');
    }
    return out;
  }

  function parse(text) {
    var t = tokenize(String(text).replace(/^=/, '')), p = 0;
    function peek() { return t[p]; }
    function op(v) { var k = t[p]; return k && k.k === 'op' && k.v === v; }
    function expect(k) { var tok = t[p++]; if (!tok || tok.k !== k) throw new Error('ожидалось «' + k + '»'); return tok; }
    function cmp() {
      var a = cat();
      while (peek() && peek().k === 'op' && /^(=|<>|<|>|<=|>=)$/.test(peek().v)) { var o = t[p++].v; a = { t: 'bin', op: o, a: a, b: cat() }; }
      return a;
    }
    function cat() { var a = add(); while (op('&')) { p++; a = { t: 'bin', op: '&', a: a, b: add() }; } return a; }
    function add() { var a = mul(); while (op('+') || op('-')) { var o = t[p++].v; a = { t: 'bin', op: o, a: a, b: mul() }; } return a; }
    function mul() { var a = pow(); while (op('*') || op('/')) { var o = t[p++].v; a = { t: 'bin', op: o, a: a, b: pow() }; } return a; }
    function pow() { var a = un(); while (op('^')) { p++; a = { t: 'bin', op: '^', a: a, b: un() }; } return a; }
    function un() {
      if (op('-')) { p++; return { t: 'neg', a: un() }; }
      if (op('+')) { p++; return un(); }
      return post();
    }
    function post() { var a = rng(); while (op('%')) { p++; a = { t: 'pct', a: a }; } return a; }
    function rng() { var a = prim(); while (op(':')) { p++; a = { t: 'rng', a: a, b: prim() }; } return a; }
    function literal() {
      var tok = t[p++], neg = false;
      if (tok && tok.k === 'op' && tok.v === '-') { neg = true; tok = t[p++]; }
      if (!tok) throw new Error('формула оборвалась');
      if (tok.k === 'num') return neg ? -tok.v : tok.v;
      if (tok.k === 'str') return tok.v;
      if (tok.k === 'bool') return tok.v;
      if (tok.k === 'err') return err(tok.v);
      throw new Error('в массиве только значения');
    }
    function prim() {
      var tok = t[p++];
      if (!tok) throw new Error('формула оборвалась');
      switch (tok.k) {
        case 'num': return { t: 'n', v: tok.v };
        case 'str': return { t: 's', v: tok.v };
        case 'bool': return { t: 'b', v: tok.v };
        case 'err': return { t: 'e', v: tok.v };
        case 'ref': return { t: 'ref', sh: tok.sh, ext: tok.ext, r: tok.r, c: tok.c, ra: tok.ra, ca: tok.ca };
        case 'area': return { t: 'area', sh: tok.sh, ext: tok.ext, r1: tok.r1, c1: tok.c1, r2: tok.r2, c2: tok.c2,
                              ra1: tok.ra1, ca1: tok.ca1, ra2: tok.ra2, ca2: tok.ca2 };
        case 'name': return { t: 'name', sh: tok.sh, ext: tok.ext, v: tok.v };
        case 'fn': {
          expect('(');
          var args = [];
          if (peek() && peek().k === ')') { p++; return { t: 'fn', v: tok.v, args: args }; }
          for (;;) {
            var nx = peek();
            if (!nx) throw new Error('не закрыта скобка');
            args.push(nx.k === ',' || nx.k === ')' ? { t: 'miss' } : cmp());
            var sep = t[p++];
            if (!sep) throw new Error('не закрыта скобка');
            if (sep.k === ')') break;
            if (sep.k !== ',') throw new Error('ожидалась запятая');
          }
          return { t: 'fn', v: tok.v, args: args };
        }
        case '(': { var e = cmp(); expect(')'); return e; }
        case '{': {
          var rows = [[]];
          for (;;) {
            rows[rows.length - 1].push(literal());
            var s2 = t[p++];
            if (!s2) throw new Error('не закрыт массив');
            if (s2.k === '}') break;
            if (s2.k === ';') rows.push([]);
            else if (s2.k !== ',') throw new Error('ожидалась запятая в массиве');
          }
          return { t: 'arr', rows: rows };
        }
      }
      throw new Error('неожиданное «' + (tok.v != null ? tok.v : tok.k) + '»');
    }
    var ast = cmp();
    if (p < t.length) throw new Error('лишнее в конце формулы');
    return ast;
  }

  /* ── числа как в Excel ── */
  function snap(v) { return v === 0 || !isFinite(v) ? v : +v.toPrecision(15); }
  function roundX(v, d, mode) { // mode: 0 — ROUND, 1 — ROUNDUP, -1 — ROUNDDOWN
    d = Math.trunc(d);
    var s = v < 0 ? -1 : 1, a = Math.abs(v), y, r;
    function go(z) { return mode === 0 ? Math.floor(z + 0.5) : mode > 0 ? Math.ceil(z) : Math.floor(z); }
    if (d >= 0) { var p = Math.pow(10, d); y = snap(a * p); r = go(y); return s * r / p; }
    var q = Math.pow(10, -d); y = snap(a / q); r = go(y); return s * r * q;
  }
  function approxEq(a, b) {
    if (a === b) return true;
    return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 3.552713678800501e-15; // 2^-48, как в LibreOffice
  }
  function numText(n) {
    if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
    return String(+n.toPrecision(15)).replace('e+', 'E+').replace('e-', 'E-');
  }
  var MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function daysIn(y, m) { return m === 2 && isLeap(y) ? 29 : MDAYS[m - 1]; }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

  function typeRank(v) { return typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 0; }
  function compare(a, b) {
    if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
    if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
    var ta = typeRank(a), tb = typeRank(b);
    if (ta !== tb) return ta < tb ? -1 : 1;
    if (ta === 0) return approxEq(a, b) ? 0 : a < b ? -1 : 1;
    if (ta === 1) { var x = a.toLowerCase(), y = b.toLowerCase(); return x === y ? 0 : x.localeCompare(y, 'ru') < 0 ? -1 : 1; }
    return a === b ? 0 : a ? 1 : -1;
  }
  /* точное совпадение для VLOOKUP/MATCH: текст без учёта регистра, * и ? — шаблоны */
  function matcher(v) {
    if (typeof v === 'string' && /[*?~]/.test(v)) {
      var re = new RegExp('^' + v.replace(/~([*?~])|([*?])|([.+^${}()|[\]\\\/])/g, function (m, esc, wild, sp) {
        return esc ? '\\' + esc : wild ? (wild === '*' ? '[\\s\\S]*' : '[\\s\\S]') : '\\' + sp;
      }) + '$', 'i');
      return function (x) { return typeof x === 'string' && re.test(x); };
    }
    return function (x) { return x !== null && typeRank(x) === typeRank(v) && compare(x, v) === 0; };
  }

  /* ── книга ── */
  function Book(raw) {
    this.raw = raw;
    this.XR = root.XlsxReader || (typeof module !== 'undefined' && typeof require === 'function' ? require('./xlsx.js') : null);
    this.date1904 = !!raw.date1904;
    this.sheets = raw.sheets.map(function (s) { return { name: s.name, state: s.state, xml: s.xml, p: null }; });
    this.sheetIdx = {};
    for (var k = 0; k < this.sheets.length; k++) this.sheetIdx[this.sheets[k].name.toLowerCase()] = k;
    this.names = {};
    raw.names.forEach(function (n) { this.names[n.local + '|' + n.name.toLowerCase()] = { name: n.name, text: n.ref, local: n.local, ast: null }; }, this);
    this.asts = new Map();
    this.memo = new Map(); this.busy = new Set(); this.over = new Map();
    this.depth = 0; this.deepAt = 0; this.unknown = {}; this.problems = []; this.today = null;
  }
  var B = Book.prototype;

  B.sheet = function (k) {
    var s = this.sheets[k];
    if (!s.p) { s.p = this.XR.parseSheet(s.xml, this.raw.sst, this.date1904); s.xml = null; }
    return s.p;
  };
  B.cell = function (sh, r, c) { return this.sheet(sh).cells.get(r * COLS + c); };
  B.addr = function (sh, r, c) { return this.sheets[sh].name + '!' + colName(c) + r; };
  function isFormula(cell) { return cell && (cell.f !== undefined || cell.si !== undefined); }

  B.compile = function (sh, text, where) {
    var ast = this.asts.get(text);
    if (ast) return ast;
    try { ast = parse(text); }
    catch (e) { this.problems.push({ where: where, text: text, msg: e.message }); ast = { t: 'e', v: '#NAME?' }; }
    this.asts.set(text, ast);
    return ast;
  };
  B.code = function (sh, cell, r, c) {
    if (cell.code) return cell.code;
    var s = this.sheet(sh), text, dr = 0, dc = 0;
    if (cell.f !== undefined && cell.f !== '') text = cell.f;
    else if (cell.si !== undefined && s.masters[cell.si]) { var m = s.masters[cell.si]; text = m.f; dr = r - m.r; dc = c - m.c; }
    if (cell.array || cell.dataTable || text === undefined) {
      this.problems.push({ where: this.addr(sh, r, c), msg: cell.array ? 'формула массива' : cell.dataTable ? 'таблица данных' : 'нет текста формулы' });
      return (cell.code = { ast: { t: 'e', v: '#VALUE!' }, dr: 0, dc: 0 });
    }
    return (cell.code = { ast: this.compile(sh, text, this.addr(sh, r, c)), dr: dr, dc: dc });
  };

  function key(sh, r, c) { return (sh * 1048577 + r) * COLS + c; }

  B.value = function (sh, r, c) {
    var k = key(sh, r, c);
    if (this.over.size && this.over.has(k)) return this.over.get(k);
    var cell = this.sheet(sh).cells.get(r * COLS + c);
    if (!cell) return null;
    if (!isFormula(cell)) return cell.v;
    var mv = this.memo.get(k);
    if (mv !== undefined) return mv;
    if (this.busy.has(k)) return ERR['#CIRC!'];
    if (this.depth >= DEPTH) { this.deepAt = sh; throw DEEP; }
    this.busy.add(k); this.depth++;
    var v;
    try {
      var code = this.code(sh, cell, r, c), x = { sh: sh, r: r, c: c, dr: code.dr, dc: code.dc };
      v = this.scalar(this.ev(code.ast, x), x);
      if (v === null || v === MISSING) v = 0;
    } finally { this.busy.delete(k); this.depth--; }
    this.memo.set(k, v);
    return v;
  };
  /* верхний уровень: длинные цепочки (график на 800 строк) досчитываем по порядку строк */
  B.at = function (sh, r, c) {
    for (var n = 0; n < 30; n++) {
      try { return this.value(sh, r, c); }
      catch (e) { if (e !== DEEP) throw e; this.warm(this.deepAt); }
    }
    return NUM;
  };
  B.warm = function (sh) {
    var cells = this.sheet(sh).cells, self = this;
    cells.forEach(function (cell, k) {
      if (!isFormula(cell)) return;
      try { self.value(sh, Math.floor(k / COLS), k % COLS); } catch (e) { if (e !== DEEP) throw e; }
    });
  };

  B.ev = function (n, x) {
    switch (n.t) {
      case 'n': case 's': case 'b': return n.v;
      case 'e': return err(n.v);
      case 'miss': return MISSING;
      case 'ref': case 'area': return this.refOf(n, x);
      case 'name': return this.name(n, x);
      case 'neg': { var a = this.num(this.ev(n.a, x), x); return isErr(a) ? a : -a; }
      case 'pct': { var b = this.num(this.ev(n.a, x), x); return isErr(b) ? b : b / 100; }
      case 'bin': return this.bin(n, x);
      case 'fn': { var f = FN[n.v]; if (!f) { this.unknown[n.v] = true; return NAME; } return f(n.args, x, this); }
      case 'arr': return new Arr(n.rows);
      case 'rng': {
        var p = this.ev(n.a, x), q = this.ev(n.b, x);
        if (isErr(p)) return p; if (isErr(q)) return q;
        if (!(p instanceof Ref) || !(q instanceof Ref) || p.sh !== q.sh) return VALUE;
        return new Ref(p.sh, Math.min(p.r1, q.r1), Math.min(p.c1, q.c1), Math.max(p.r2, q.r2), Math.max(p.c2, q.c2));
      }
    }
    return VALUE;
  };

  B.sheetOf = function (name, x) {
    if (name == null) return x ? x.sh : 0;
    var k = this.sheetIdx[String(name).toLowerCase()];
    return k === undefined ? -1 : k;
  };
  B.refOf = function (n, x) {
    if (n.ext) return REF;
    var sh = this.sheetOf(n.sh, x);
    if (sh < 0) return REF;
    if (n.t === 'ref') {
      var r = n.ra ? n.r : n.r + x.dr, c = n.ca ? n.c : n.c + x.dc;
      if (r < 1 || c < 1 || r > MAXR || c > MAXC) return REF;
      return new Ref(sh, r, c, r, c);
    }
    var r1 = n.ra1 ? n.r1 : n.r1 + x.dr, r2 = n.ra2 ? n.r2 : n.r2 + x.dr;
    var c1 = n.ca1 ? n.c1 : n.c1 + x.dc, c2 = n.ca2 ? n.c2 : n.c2 + x.dc;
    if (Math.min(r1, r2) < 1 || Math.min(c1, c2) < 1 || Math.max(r1, r2) > MAXR || Math.max(c1, c2) > MAXC) return REF;
    return new Ref(sh, Math.min(r1, r2), Math.min(c1, c2), Math.max(r1, r2), Math.max(c1, c2));
  };
  B.findName = function (name, sh, sheetOnly) {
    var low = String(name).toLowerCase();
    return (sh >= 0 && this.names[sh + '|' + low]) || (!sheetOnly && this.names['-1|' + low]) || null;
  };
  B.nameAst = function (def) {
    if (!def.ast) def.ast = this.compile(-1, def.text, 'имя ' + def.name);
    return def.ast;
  };
  B.name = function (n, x) {
    if (n.ext) return REF;
    var sh = n.sh != null ? this.sheetOf(n.sh, x) : x.sh;
    var def = this.findName(n.v, sh, n.sh != null);
    if (!def) return NAME;
    return this.ev(this.nameAst(def), { sh: x.sh, r: x.r, c: x.c, dr: 0, dc: 0 });
  };

  /* ── приведение типов ── */
  B.scalar = function (v, x) {
    if (v instanceof Ref) {
      if (v.r1 === v.r2 && v.c1 === v.c2) return this.value(v.sh, v.r1, v.c1);
      if (x && v.c1 === v.c2 && x.r >= v.r1 && x.r <= v.r2) return this.value(v.sh, x.r, v.c1);
      if (x && v.r1 === v.r2 && x.c >= v.c1 && x.c <= v.c2) return this.value(v.sh, v.r1, x.c);
      return VALUE;
    }
    if (v instanceof Arr) return v.rows[0][0];
    if (v === MISSING) return null;
    return v;
  };
  B.textNum = function (s) {
    var t = s.trim();
    if (!t) return VALUE;
    var pct = /%$/.test(t);
    if (pct) t = t.slice(0, -1).trim();
    t = t.replace(/[\s  ]/g, '');
    if (/^[+-]?(\d+([.,]\d*)?|[.,]\d+)([eE][+-]?\d+)?$/.test(t)) { var n = +t.replace(',', '.'); return pct ? n / 100 : n; }
    var d = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/.exec(t);
    if (d) return this.serial(+d[3], +d[2], +d[1]);
    var iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    if (iso) return this.serial(+iso[1], +iso[2], +iso[3]);
    return VALUE;
  };
  B.num = function (v, x) {
    v = this.scalar(v, x);
    if (typeof v === 'number') return v;
    if (v === null) return 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') return this.textNum(v);
    return v;
  };
  B.bool = function (v, x) {
    v = this.scalar(v, x);
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (v === null) return false;
    if (typeof v === 'string') {
      var u = v.trim().toUpperCase();
      if (u === 'TRUE' || u === 'ИСТИНА') return true;
      if (u === 'FALSE' || u === 'ЛОЖЬ') return false;
      return VALUE;
    }
    return v;
  };
  B.text = function (v, x) {
    v = this.scalar(v, x);
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return numText(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (v === null) return '';
    return v;
  };
  B.bin = function (n, x) {
    var a = this.scalar(this.ev(n.a, x), x), b = this.scalar(this.ev(n.b, x), x), o = n.op;
    if (o === '&') {
      a = this.text(a, x); if (isErr(a)) return a;
      b = this.text(b, x); if (isErr(b)) return b;
      return a + b;
    }
    if (o === '=' || o === '<>' || o === '<' || o === '>' || o === '<=' || o === '>=') {
      if (isErr(a)) return a; if (isErr(b)) return b;
      var c = compare(a, b);
      return o === '=' ? c === 0 : o === '<>' ? c !== 0 : o === '<' ? c < 0 : o === '>' ? c > 0 : o === '<=' ? c <= 0 : c >= 0;
    }
    var p = this.num(a, x); if (isErr(p)) return p;
    var q = this.num(b, x); if (isErr(q)) return q;
    var r;
    switch (o) {
      case '+': r = p + q; break;
      case '-': r = p - q; break;
      case '*': r = p * q; break;
      case '/': if (q === 0) return DIV0; r = p / q; break;
      case '^': if (p === 0 && q === 0) return NUM; r = Math.pow(p, q); break;
      default: return VALUE;
    }
    return isFinite(r) ? r : NUM;
  };

  /* обход аргумента: диапазон и массив — по ячейкам (inRange = true), одиночное значение — как есть */
  B.each = function (node, x, cb) {
    var v = this.ev(node, x);
    if (v instanceof Ref) {
      var s = this.sheet(v.sh), r2 = Math.min(v.r2, Math.max(s.maxR, v.r1)), c2 = Math.min(v.c2, Math.max(s.maxC, v.c1));
      for (var r = v.r1; r <= r2; r++) for (var c = v.c1; c <= c2; c++) if (cb(this.value(v.sh, r, c), true) === false) return;
      return;
    }
    if (v instanceof Arr) {
      for (var i = 0; i < v.rows.length; i++) for (var j = 0; j < v.rows[i].length; j++) if (cb(v.rows[i][j], true) === false) return;
      return;
    }
    cb(v, false);
  };
  /* диапазон → двумерный массив значений */
  B.grid = function (v) {
    if (v instanceof Arr) return v.rows;
    if (v instanceof Ref) {
      var out = [];
      for (var r = v.r1; r <= v.r2; r++) { var row = []; for (var c = v.c1; c <= v.c2; c++) row.push(this.value(v.sh, r, c)); out.push(row); }
      return out;
    }
    return [[v === MISSING ? null : v]];
  };

  /* ── даты: число дней, как в Excel (с «29.02.1900» в системе 1900) ── */
  B.serial = function (y, m, d) {
    y = Math.trunc(y); m = Math.trunc(m); d = Math.trunc(d);
    if (y >= 0 && y < 1900) y += 1900;
    if (y < 0 || y > 9999) return NUM;
    var dt = new Date(0);
    dt.setUTCFullYear(y, m - 1, d);
    var t = dt.getTime();
    if (this.date1904) { var s4 = Math.round((t - Date.UTC(1904, 0, 1)) / 864e5); return s4 < 0 ? NUM : s4; }
    var s = Math.round((t - Date.UTC(1899, 11, 30)) / 864e5);
    if (s <= 60) s -= 1;
    return s < 0 ? NUM : s;
  };
  B.ymd = function (s) {
    s = Math.floor(s);
    var t;
    if (this.date1904) { t = new Date(Date.UTC(1904, 0, 1) + s * 864e5); }
    else {
      if (s === 0) return { y: 1900, m: 1, d: 0 };
      if (s === 60) return { y: 1900, m: 2, d: 29 };
      t = new Date(Date.UTC(1899, 11, 30) + (s < 60 ? s + 1 : s) * 864e5);
    }
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  };
  B.todaySerial = function () {
    if (this.today != null) return this.today;
    var d = new Date();
    return this.serial(d.getFullYear(), d.getMonth() + 1, d.getDate());
  };

  /* ── функции ── */
  function args(bk, a, x, kinds) { // kinds: 'n' число, 's' текст, 'b' логическое, 'v' значение
    var out = [];
    for (var i = 0; i < kinds.length; i++) {
      var node = a[i], kd = kinds.charAt(i), v;
      if (!node) { out.push(undefined); continue; }
      var raw = bk.ev(node, x);
      if (raw === MISSING) { out.push(undefined); continue; }
      v = kd === 'n' ? bk.num(raw, x) : kd === 's' ? bk.text(raw, x) : kd === 'b' ? bk.bool(raw, x) : bk.scalar(raw, x);
      if (isErr(v)) return v;
      out.push(v);
    }
    return out;
  }
  function numFn(kinds, fn) {
    return function (a, x, bk) { var v = args(bk, a, x, kinds); if (isErr(v)) return v; var r = fn.apply(bk, v); return typeof r === 'number' && !isFinite(r) ? NUM : r; };
  }
  function agg(a, x, bk, onNum, textInArgsOk) {
    var bad = null;
    for (var i = 0; i < a.length && !bad; i++) {
      bk.each(a[i], x, function (v, inRange) {
        if (isErr(v)) { bad = v; return false; }
        if (inRange) { if (typeof v === 'number') onNum(v); return; }
        if (v === MISSING) { onNum(0); return; }
        var n = bk.num(v, x);
        if (isErr(n)) { if (!textInArgsOk) { bad = n; return false; } return; }
        onNum(n);
      });
    }
    return bad;
  }
  function logical(a, x, bk, onBool) {
    var bad = null, seen = false;
    for (var i = 0; i < a.length && !bad; i++) {
      if (a[i].t === 'miss') { seen = true; onBool(false); continue; }
      bk.each(a[i], x, function (v, inRange) {
        if (isErr(v)) { bad = v; return false; }
        if (v === null || v === MISSING) return;
        if (typeof v === 'string') { if (inRange) return; var b = bk.bool(v, x); if (isErr(b)) { bad = b; return false; } seen = true; onBool(b); return; }
        seen = true; onBool(typeof v === 'boolean' ? v : v !== 0);
      });
    }
    return bad || (seen ? null : VALUE);
  }
  function lookupPos(bk, want, list, type) { // list — значения; позиция с нуля или -1
    if (type === 0) {
      var eq = matcher(want);
      for (var i = 0; i < list.length; i++) if (eq(list[i])) return i;
      return -1;
    }
    var pos = -1;
    for (var j = 0; j < list.length; j++) {
      var v = list[j];
      if (v === null || isErr(v) || typeRank(v) !== typeRank(want)) continue;
      var c = compare(v, want);
      if (type > 0) { if (c <= 0) pos = j; else break; }
      else { if (c >= 0) pos = j; else break; }
    }
    return pos;
  }
  function yearFrac(bk, s, e, basis) {
    if (s > e) { var t = s; s = e; e = t; }
    if (s === e) return 0;
    var A = bk.ymd(s), Bd = bk.ymd(e), days = e - s;
    function lastFeb(D) { return D.m === 2 && D.d === daysIn(D.y, 2); }
    switch (basis) {
      case 0: {
        var d1 = A.d, d2 = Bd.d;
        if (d1 === 31 && d2 === 31) { d1 = 30; d2 = 30; }
        else if (d1 === 31) d1 = 30;
        else if (d1 === 30 && d2 === 31) d2 = 30;
        else if (A.m === 2 && Bd.m === 2 && lastFeb(A) && lastFeb(Bd)) { d1 = 30; d2 = 30; }
        else if (lastFeb(A)) d1 = 30;
        return ((Bd.y - A.y) * 360 + (Bd.m - A.m) * 30 + (d2 - d1)) / 360;
      }
      case 1: {
        var le = A.y === Bd.y || (A.y + 1 === Bd.y && (A.m > Bd.m || (A.m === Bd.m && A.d >= Bd.d)));
        if (le) {
          var len = 365;
          if (A.y === Bd.y && isLeap(A.y)) len = 366;
          else if ((Bd.m === 2 && Bd.d === 29) ||
                   (isLeap(A.y) && s < bk.serial(A.y, 3, 1) && e >= bk.serial(A.y, 3, 1)) ||
                   (isLeap(Bd.y) && e >= bk.serial(Bd.y, 3, 1) && s < bk.serial(Bd.y, 3, 1))) len = 366;
          return days / len;
        }
        var years = Bd.y - A.y + 1, total = bk.serial(Bd.y + 1, 1, 1) - bk.serial(A.y, 1, 1);
        return days / (total / years);
      }
      case 2: return days / 360;
      case 3: return days / 365;
      case 4: return ((Bd.y - A.y) * 360 + (Bd.m - A.m) * 30 + (Math.min(Bd.d, 30) - Math.min(A.d, 30))) / 360;
    }
    return NUM;
  }

  var RU_MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  function textFormat(bk, v, f) {
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'string') { var nv = bk.textNum(v); if (isErr(nv)) return v; v = nv; }
    if (v === null) v = 0;
    var secs = [], cur = '', q = false;
    for (var i = 0; i < f.length; i++) { var ch = f.charAt(i); if (ch === '"') q = !q; if (ch === ';' && !q) { secs.push(cur); cur = ''; } else cur += ch; }
    secs.push(cur);
    var sec = secs[0];
    if (v < 0 && secs.length > 1) { sec = secs[1]; v = -v; } else if (v === 0 && secs.length > 2) sec = secs[2];
    var bare = sec.replace(/"[^"]*"|\\./g, '');
    if (/[ДдГгDdYy]|[МмMm]/.test(bare) && !/[0#]/.test(bare)) {
      var D = bk.ymd(v);
      return sec.replace(/"([^"]*)"|\\(.)|ГГГГ|гггг|YYYY|yyyy|ГГ|гг|YY|yy|ММММ|мммм|MMMM|mmmm|ММ|мм|MM|mm|М|м|M|m|ДД|дд|DD|dd|Д|д|D|d/g, function (t, lit, esc) {
        if (lit != null) return lit;
        if (esc != null) return esc;
        var u = t.toUpperCase();
        if (u === 'ГГГГ' || u === 'YYYY') return String(D.y);
        if (u === 'ГГ' || u === 'YY') return ('0' + (D.y % 100)).slice(-2);
        if (u === 'ММММ' || u === 'MMMM') return RU_MONTHS[D.m - 1];
        if (u === 'ММ' || u === 'MM') return ('0' + D.m).slice(-2);
        if (u === 'М' || u === 'M') return String(D.m);
        if (u === 'ДД' || u === 'DD') return ('0' + D.d).slice(-2);
        return String(D.d);
      });
    }
    var pct = (bare.match(/%/g) || []).length;
    v = v * Math.pow(100, pct);
    var first = bare.search(/[0#?]/), last = Math.max(bare.lastIndexOf('0'), bare.lastIndexOf('#'), bare.lastIndexOf('?'));
    if (first < 0) return sec.replace(/"([^"]*)"/g, '$1');
    var pat = bare.slice(first, last + 1), pre = bare.slice(0, first), post = bare.slice(last + 1);
    var ru = /[0#?][  ][0#?]/.test(pat), dec = ru ? ',' : '.', grp = ru ? /[  ]/ : /,/;
    var dp = pat.indexOf(dec), intP = dp >= 0 ? pat.slice(0, dp) : pat, fracP = dp >= 0 ? pat.slice(dp + 1) : '';
    var nd = (fracP.match(/[0#?]/g) || []).length, minInt = (intP.match(/0/g) || []).length;
    var r = roundX(v, nd, 0), whole = Math.floor(Math.abs(r)), frac = Math.abs(r) - whole;
    var ip = whole === 0 && minInt === 0 ? '' : String(whole);
    while (ip.length < minInt) ip = '0' + ip;
    if (grp.test(intP)) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ru ? ' ' : ',');
    var fp = nd ? frac.toFixed(nd).slice(2) : '';
    if (nd) { var need = (fracP.match(/0/g) || []).length; while (fp.length > need && fp.charAt(fp.length - 1) === '0') fp = fp.slice(0, -1); }
    return (r < 0 ? '-' : '') + pre + ip + (fp ? dec + fp : '') + post.replace(/%/g, '%');
  }

  var FN = {
    IF: function (a, x, bk) {
      var c = bk.bool(bk.ev(a[0], x), x);
      if (isErr(c)) return c;
      if (c) return a.length > 1 ? bk.ev(a[1], x) : true;
      return a.length > 2 ? bk.ev(a[2], x) : false;
    },
    IFERROR: function (a, x, bk) {
      var v = bk.ev(a[0], x), s = bk.scalar(v, x);
      return isErr(s) ? bk.ev(a[1], x) : s;
    },
    IFNA: function (a, x, bk) {
      var v = bk.ev(a[0], x), s = bk.scalar(v, x);
      return isErr(s) && s.e === '#N/A' ? bk.ev(a[1], x) : s;
    },
    AND: function (a, x, bk) { var r = true, e = logical(a, x, bk, function (b) { r = r && b; }); return e || r; },
    OR: function (a, x, bk) { var r = false, e = logical(a, x, bk, function (b) { r = r || b; }); return e || r; },
    XOR: function (a, x, bk) { var r = false, e = logical(a, x, bk, function (b) { r = r !== b; }); return e || r; },
    NOT: function (a, x, bk) { var b = bk.bool(bk.ev(a[0], x), x); return isErr(b) ? b : !b; },
    TRUE: function () { return true; },
    FALSE: function () { return false; },
    CHOOSE: function (a, x, bk) {
      var i = bk.num(bk.ev(a[0], x), x);
      if (isErr(i)) return i;
      i = Math.trunc(i);
      return i >= 1 && i < a.length ? bk.ev(a[i], x) : VALUE;
    },

    ISBLANK: function (a, x, bk) { var v = bk.ev(a[0], x); return (v instanceof Ref ? bk.scalar(v, x) : v === MISSING ? null : v) === null; },
    ISNUMBER: function (a, x, bk) { return typeof bk.scalar(bk.ev(a[0], x), x) === 'number'; },
    ISTEXT: function (a, x, bk) { return typeof bk.scalar(bk.ev(a[0], x), x) === 'string'; },
    ISLOGICAL: function (a, x, bk) { return typeof bk.scalar(bk.ev(a[0], x), x) === 'boolean'; },
    ISERROR: function (a, x, bk) { return isErr(bk.scalar(bk.ev(a[0], x), x)); },
    ISERR: function (a, x, bk) { var v = bk.scalar(bk.ev(a[0], x), x); return isErr(v) && v.e !== '#N/A'; },
    ISNA: function (a, x, bk) { var v = bk.scalar(bk.ev(a[0], x), x); return isErr(v) && v.e === '#N/A'; },
    NA: function () { return NA; },

    INT: numFn('n', function (v) { return Math.floor(snap(v)); }),
    TRUNC: numFn('nn', function (v, d) { return roundX(v, d || 0, -1); }),
    ROUND: numFn('nn', function (v, d) { return roundX(v, d || 0, 0); }),
    ROUNDUP: numFn('nn', function (v, d) { return roundX(v, d || 0, 1); }),
    ROUNDDOWN: numFn('nn', function (v, d) { return roundX(v, d || 0, -1); }),
    ABS: numFn('n', Math.abs),
    SIGN: numFn('n', function (v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }),
    SQRT: numFn('n', function (v) { return v < 0 ? NUM : Math.sqrt(v); }),
    EXP: numFn('n', Math.exp),
    LN: numFn('n', function (v) { return v <= 0 ? NUM : Math.log(v); }),
    LOG10: numFn('n', function (v) { return v <= 0 ? NUM : Math.log(v) / Math.LN10; }),
    LOG: numFn('nn', function (v, b) { b = b === undefined ? 10 : b; return v <= 0 || b <= 0 || b === 1 ? NUM : Math.log(v) / Math.log(b); }),
    POWER: numFn('nn', function (v, p) { return v === 0 && p === 0 ? NUM : Math.pow(v, p); }),
    MOD: numFn('nn', function (v, d) { if (d === 0) return DIV0; var m = v - d * Math.floor(v / d); return snap(m); }),
    PI: function () { return Math.PI; },
    CEILING: numFn('nn', function (v, s) { if (s === undefined) s = 1; if (s === 0) return 0; return Math.ceil(snap(v / s)) * s; }),
    FLOOR: numFn('nn', function (v, s) { if (s === undefined) s = 1; if (s === 0) return DIV0; return Math.floor(snap(v / s)) * s; }),

    SUM: function (a, x, bk) { var s = 0, e = agg(a, x, bk, function (v) { s += v; }); return e || s; },
    PRODUCT: function (a, x, bk) { var s = 1, e = agg(a, x, bk, function (v) { s *= v; }); return e || s; },
    MAX: function (a, x, bk) { var m = -Infinity, e = agg(a, x, bk, function (v) { if (v > m) m = v; }); return e || (m === -Infinity ? 0 : m); },
    MIN: function (a, x, bk) { var m = Infinity, e = agg(a, x, bk, function (v) { if (v < m) m = v; }); return e || (m === Infinity ? 0 : m); },
    AVERAGE: function (a, x, bk) { var s = 0, n = 0, e = agg(a, x, bk, function (v) { s += v; n++; }); return e || (n ? s / n : DIV0); },
    COUNT: function (a, x, bk) {
      var n = 0;
      a.forEach(function (node) { bk.each(node, x, function (v, inRange) { if (typeof v === 'number' || (!inRange && !isErr(bk.num(v, x)) && v !== MISSING)) n++; }); });
      return n;
    },
    COUNTA: function (a, x, bk) {
      var n = 0;
      a.forEach(function (node) { bk.each(node, x, function (v) { if (v !== null && v !== MISSING) n++; }); });
      return n;
    },
    SUMPRODUCT: function (a, x, bk) {
      var grids = a.map(function (node) { return bk.grid(bk.ev(node, x)); }), s = 0;
      for (var g = 0; g < grids.length; g++) {
        if (grids[g].length !== grids[0].length || grids[g][0].length !== grids[0][0].length) return VALUE;
      }
      for (var i = 0; i < grids[0].length; i++) for (var j = 0; j < grids[0][0].length; j++) {
        var p = 1;
        for (var k = 0; k < grids.length; k++) { var v = grids[k][i][j]; if (isErr(v)) return v; p *= typeof v === 'number' ? v : 0; }
        s += p;
      }
      return s;
    },

    INDEX: function (a, x, bk) {
      var src = bk.ev(a[0], x);
      if (isErr(src)) return src;
      var one = a.length < 3 || a[2].t === 'miss';
      var r = a.length > 1 ? bk.num(bk.ev(a[1], x), x) : 0, c = !one ? bk.num(bk.ev(a[2], x), x) : 0;
      if (isErr(r)) return r; if (isErr(c)) return c;
      r = Math.trunc(r); c = Math.trunc(c);
      if (src instanceof Ref) {
        var nr = src.r2 - src.r1 + 1, nc = src.c2 - src.c1 + 1;
        if (one && a.length >= 2) { if (nr === 1) { c = r; r = 1; } else if (nc === 1) c = 1; }
        if (r < 0 || c < 0 || r > nr || c > nc) return REF;
        return new Ref(src.sh, r ? src.r1 + r - 1 : src.r1, c ? src.c1 + c - 1 : src.c1, r ? src.r1 + r - 1 : src.r2, c ? src.c1 + c - 1 : src.c2);
      }
      var g = bk.grid(src), gr = g.length, gc = g[0].length;
      if (one && a.length >= 2) { if (gr === 1) { c = r; r = 1; } else if (gc === 1) c = 1; }
      if (r < 0 || c < 0 || r > gr || c > gc) return REF;
      if (r && c) return g[r - 1][c - 1];
      if (r) return new Arr([g[r - 1]]);
      if (c) return new Arr(g.map(function (row) { return [row[c - 1]]; }));
      return new Arr(g);
    },
    MATCH: function (a, x, bk) {
      var want = bk.scalar(bk.ev(a[0], x), x);
      if (isErr(want)) return want;
      var src = bk.ev(a[1], x);
      if (isErr(src)) return src;
      var type = a.length > 2 && a[2].t !== 'miss' ? bk.num(bk.ev(a[2], x), x) : 1;
      if (isErr(type)) return type;
      var g = bk.grid(src), list;
      if (g.length === 1) list = g[0];
      else if (g[0].length === 1) list = g.map(function (row) { return row[0]; });
      else return NA;
      var pos = lookupPos(bk, want === null ? 0 : want, list, type > 0 ? 1 : type < 0 ? -1 : 0);
      return pos < 0 ? NA : pos + 1;
    },
    VLOOKUP: function (a, x, bk) { return lookup(a, x, bk, true); },
    HLOOKUP: function (a, x, bk) { return lookup(a, x, bk, false); },
    INDIRECT: function (a, x, bk) {
      var t = bk.text(bk.ev(a[0], x), x);
      if (isErr(t)) return t;
      t = t.trim();
      var a1 = true;
      if (a.length > 1) { var f = a[1].t === 'miss' ? false : bk.bool(bk.ev(a[1], x), x); if (isErr(f)) return f; a1 = f; }
      var nm = /^(?:(?:'((?:[^']|'')+)'|([^!]+))!)?([^!]+)$/.exec(t);
      if (!nm) return REF;
      var shName = nm[1] != null ? nm[1].replace(/''/g, "'") : nm[2], body = nm[3];
      var sh = shName != null ? bk.sheetOf(shName, x) : x.sh;
      if (sh < 0) return REF;
      var def = bk.findName(body, sh, shName != null);
      if (def) { var v = bk.ev(bk.nameAst(def), { sh: x.sh, r: x.r, c: x.c, dr: 0, dc: 0 }); return v instanceof Ref ? v : REF; }
      if (a1) {
        var m = /^\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(body);
        if (!m) return REF;
        var c1 = colNum(m[1]), r1 = +m[2], c2 = m[3] ? colNum(m[3]) : c1, r2 = m[4] ? +m[4] : r1;
        if (c1 > MAXC || c2 > MAXC || r1 < 1 || r2 < 1) return REF;
        return new Ref(sh, Math.min(r1, r2), Math.min(c1, c2), Math.max(r1, r2), Math.max(c1, c2));
      }
      var rc = /^R(\[-?\d+\]|\d+)?C(\[-?\d+\]|\d+)?$/i.exec(body);
      if (!rc) return REF;
      function part(s, base) { if (!s) return base; return s.charAt(0) === '[' ? base + +s.slice(1, -1) : +s; }
      var rr = part(rc[1], x.r), cc = part(rc[2], x.c);
      return rr >= 1 && cc >= 1 ? new Ref(sh, rr, cc, rr, cc) : REF;
    },
    OFFSET: function (a, x, bk) {
      var src = bk.ev(a[0], x);
      if (!(src instanceof Ref)) return isErr(src) ? src : VALUE;
      var v = args(bk, a.slice(1), x, 'nnnn');
      if (isErr(v)) return v;
      var r1 = src.r1 + Math.trunc(v[0] || 0), c1 = src.c1 + Math.trunc(v[1] || 0);
      var h = v[2] === undefined ? src.r2 - src.r1 + 1 : Math.trunc(v[2]), w = v[3] === undefined ? src.c2 - src.c1 + 1 : Math.trunc(v[3]);
      if (r1 < 1 || c1 < 1 || h < 1 || w < 1) return REF;
      return new Ref(src.sh, r1, c1, r1 + h - 1, c1 + w - 1);
    },
    ROW: function (a, x, bk) { if (!a.length || a[0].t === 'miss') return x.r; var v = bk.ev(a[0], x); return v instanceof Ref ? v.r1 : VALUE; },
    COLUMN: function (a, x, bk) { if (!a.length || a[0].t === 'miss') return x.c; var v = bk.ev(a[0], x); return v instanceof Ref ? v.c1 : VALUE; },
    ROWS: function (a, x, bk) { var v = bk.ev(a[0], x); return v instanceof Ref ? v.r2 - v.r1 + 1 : bk.grid(v).length; },
    COLUMNS: function (a, x, bk) { var v = bk.ev(a[0], x); return v instanceof Ref ? v.c2 - v.c1 + 1 : bk.grid(v)[0].length; },

    DATE: function (a, x, bk) { var v = args(bk, a, x, 'nnn'); if (isErr(v)) return v; return bk.serial(v[0] || 0, v[1] || 0, v[2] || 0); },
    YEAR: function (a, x, bk) { var v = args(bk, a, x, 'n'); if (isErr(v)) return v; return v[0] < 0 ? NUM : bk.ymd(v[0] || 0).y; },
    MONTH: function (a, x, bk) { var v = args(bk, a, x, 'n'); if (isErr(v)) return v; return v[0] < 0 ? NUM : bk.ymd(v[0] || 0).m; },
    DAY: function (a, x, bk) { var v = args(bk, a, x, 'n'); if (isErr(v)) return v; return v[0] < 0 ? NUM : bk.ymd(v[0] || 0).d; },
    EDATE: function (a, x, bk) {
      var v = args(bk, a, x, 'nn'); if (isErr(v)) return v;
      if ((v[0] || 0) < 0) return NUM;
      var D = bk.ymd(v[0] || 0), mm = D.m - 1 + Math.trunc(v[1] || 0), y = D.y + Math.floor(mm / 12), m = ((mm % 12) + 12) % 12 + 1;
      return bk.serial(y, m, Math.min(D.d, daysIn(y, m)));
    },
    EOMONTH: function (a, x, bk) {
      var v = args(bk, a, x, 'nn'); if (isErr(v)) return v;
      if ((v[0] || 0) < 0) return NUM;
      var D = bk.ymd(v[0] || 0);
      return bk.serial(D.y, D.m + Math.trunc(v[1] || 0) + 1, 0);
    },
    DATEDIF: function (a, x, bk) {
      var v = args(bk, a, x, 'nns'); if (isErr(v)) return v;
      var s = Math.floor(v[0] || 0), e = Math.floor(v[1] || 0), u = String(v[2] || '').toUpperCase();
      if (s < 0 || e < 0 || s > e) return NUM;
      var A = bk.ymd(s), Z = bk.ymd(e), months = (Z.y - A.y) * 12 + Z.m - A.m - (Z.d < A.d ? 1 : 0);
      switch (u) {
        case 'D': return e - s;
        case 'M': return months;
        case 'Y': return Math.floor(months / 12);
        case 'YM': return months % 12;
        case 'MD': return Z.d >= A.d ? Z.d - A.d : daysIn(Z.m === 1 ? Z.y - 1 : Z.y, Z.m === 1 ? 12 : Z.m - 1) - A.d + Z.d;
        case 'YD': { var t = bk.serial(Z.y, A.m, A.d); if (t > e) t = bk.serial(Z.y - 1, A.m, A.d); return e - t; }
      }
      return NUM;
    },
    YEARFRAC: function (a, x, bk) {
      var v = args(bk, a, x, 'nnn'); if (isErr(v)) return v;
      var basis = Math.trunc(v[2] || 0);
      if (basis < 0 || basis > 4 || (v[0] || 0) < 0 || (v[1] || 0) < 0) return NUM;
      return yearFrac(bk, Math.floor(v[0] || 0), Math.floor(v[1] || 0), basis);
    },
    DAYS: function (a, x, bk) { var v = args(bk, a, x, 'nn'); if (isErr(v)) return v; return Math.floor(v[0] || 0) - Math.floor(v[1] || 0); },
    WEEKDAY: function (a, x, bk) {
      var v = args(bk, a, x, 'nn'); if (isErr(v)) return v;
      var D = bk.ymd(v[0] || 0), wd = new Date(Date.UTC(D.y, D.m - 1, D.d)).getUTCDay(), t = v[1] || 1;
      return t === 2 ? (wd + 6) % 7 + 1 : t === 3 ? (wd + 6) % 7 : wd + 1;
    },
    TODAY: function (a, x, bk) { return bk.todaySerial(); },
    NOW: function (a, x, bk) { var d = new Date(); return bk.todaySerial() + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400; },

    CONCATENATE: function (a, x, bk) {
      var s = '';
      for (var i = 0; i < a.length; i++) { var t = bk.text(bk.ev(a[i], x), x); if (isErr(t)) return t; s += t; }
      return s;
    },
    CONCAT: function (a, x, bk) {
      var s = '', bad = null;
      for (var i = 0; i < a.length && !bad; i++) bk.each(a[i], x, function (v) { var t = bk.text(v === MISSING ? null : v, x); if (isErr(t)) { bad = t; return false; } s += t; });
      return bad || s;
    },
    TEXT: function (a, x, bk) {
      var v = bk.scalar(bk.ev(a[0], x), x), f = bk.text(bk.ev(a[1], x), x);
      if (isErr(v)) return v; if (isErr(f)) return f;
      return textFormat(bk, v, f);
    },
    LEN: function (a, x, bk) { var t = bk.text(bk.ev(a[0], x), x); return isErr(t) ? t : t.length; },
    LEFT: function (a, x, bk) { var v = args(bk, a, x, 'sn'); if (isErr(v)) return v; return v[0].slice(0, v[1] === undefined ? 1 : Math.max(0, v[1])); },
    RIGHT: function (a, x, bk) { var v = args(bk, a, x, 'sn'); if (isErr(v)) return v; var n = v[1] === undefined ? 1 : Math.max(0, v[1]); return n ? v[0].slice(-n) : ''; },
    MID: function (a, x, bk) { var v = args(bk, a, x, 'snn'); if (isErr(v)) return v; if (v[1] < 1 || v[2] < 0) return VALUE; return v[0].substr(v[1] - 1, v[2]); },
    TRIM: function (a, x, bk) { var t = bk.text(bk.ev(a[0], x), x); return isErr(t) ? t : t.replace(/ +/g, ' ').trim(); },
    UPPER: function (a, x, bk) { var t = bk.text(bk.ev(a[0], x), x); return isErr(t) ? t : t.toUpperCase(); },
    LOWER: function (a, x, bk) { var t = bk.text(bk.ev(a[0], x), x); return isErr(t) ? t : t.toLowerCase(); },
    VALUE: function (a, x, bk) { var v = bk.scalar(bk.ev(a[0], x), x); return typeof v === 'string' ? bk.textNum(v) : bk.num(v, x); },
    SINGLE: function (a, x, bk) { return bk.scalar(bk.ev(a[0], x), x); }
  };
  FN.CEILING_MATH = FN.CEILING;

  function lookup(a, x, bk, vertical) {
    var want = bk.scalar(bk.ev(a[0], x), x);
    if (isErr(want)) return want;
    var src = bk.ev(a[1], x);
    if (isErr(src)) return src;
    var idx = bk.num(bk.ev(a[2], x), x);
    if (isErr(idx)) return idx;
    idx = Math.trunc(idx);
    var approx = a.length > 3 && a[3].t !== 'miss' ? bk.bool(bk.ev(a[3], x), x) : a.length > 3 ? false : true;
    if (isErr(approx)) return approx;
    var g = bk.grid(src), n = vertical ? g.length : g[0].length, width = vertical ? g[0].length : g.length;
    if (idx < 1) return VALUE;
    if (idx > width) return REF;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(vertical ? g[i][0] : g[0][i]);
    var pos = lookupPos(bk, want === null ? 0 : want, keys, approx ? 1 : 0);
    if (pos < 0) return NA;
    var v = vertical ? g[pos][idx - 1] : g[idx - 1][pos];
    return v === null ? 0 : v;
  }

  /* ── доступ снаружи ── */
  // «ввод!G2», «calc!$AC$1:$AC$5», имя «nax» → Ref (или null)
  B.ref = function (text, sh) {
    var ast;
    try { ast = parse(text); } catch (e) { return null; }
    var v = this.ev(ast, { sh: sh || 0, r: 1, c: 1, dr: 0, dc: 0 });
    return v instanceof Ref ? v : null;
  };
  B.nameRef = function (name) {
    var def = this.findName(name, -1, false);
    if (!def) return null;
    var v = this.ev(this.nameAst(def), { sh: 0, r: 1, c: 1, dr: 0, dc: 0 });
    return v instanceof Ref ? v : null;
  };
  B.get = function (ref) { return ref ? this.at(ref.sh, ref.r1, ref.c1) : null; };
  B.values = function (ref) {
    var out = [];
    for (var r = ref.r1; r <= ref.r2; r++) for (var c = ref.c1; c <= ref.c2; c++) out.push(this.at(ref.sh, r, c));
    return out;
  };
  B.set = function (ref, v) { this.over.set(key(ref.sh, ref.r1, ref.c1), v); this.memo.clear(); };
  B.reset = function () { this.over.clear(); this.memo.clear(); };

  /* ячейки с формулами, от которых зависят roots (статически; INDIRECT/OFFSET — через все имена книги) */
  B.deps = function (sh, r, c, out) {
    var cell = this.cell(sh, r, c), self = this;
    if (!isFormula(cell)) return;
    var code = this.code(sh, cell, r, c);
    function walk(n, x) {
      switch (n.t) {
        case 'ref': case 'area': { var v = self.refOf(n, x); if (v instanceof Ref) out.push(v); return; }
        case 'name': {
          if (n.ext) return;
          var def = self.findName(n.v, n.sh != null ? self.sheetOf(n.sh, x) : x.sh, n.sh != null);
          if (def) walk(self.nameAst(def), { sh: x.sh, r: x.r, c: x.c, dr: 0, dc: 0 });
          return;
        }
        case 'fn': if (n.v === 'INDIRECT' || n.v === 'OFFSET') out.dynamic = true; n.args.forEach(function (q) { walk(q, x); }); return;
        case 'bin': case 'rng': walk(n.a, x); walk(n.b, x); return;
        case 'neg': case 'pct': walk(n.a, x); return;
      }
    }
    walk(code.ast, { sh: sh, r: r, c: c, dr: code.dr, dc: code.dc });
  };
  B.closure = function (roots) {
    var seen = new Set(), list = [], queue = [], self = this, dyn = false, namesAdded = false;
    function add(v) {
      if (!v) return;
      var s = self.sheet(v.sh), r2 = Math.min(v.r2, s.maxR), c2 = Math.min(v.c2, s.maxC);
      for (var r = v.r1; r <= r2; r++) for (var c = v.c1; c <= c2; c++) {
        if (!isFormula(s.cells.get(r * COLS + c))) continue;
        var k = key(v.sh, r, c);
        if (seen.has(k)) continue;
        seen.add(k); queue.push([v.sh, r, c]);
      }
    }
    roots.forEach(add);
    for (;;) {
      while (queue.length) {
        var q = queue.shift(), out = [];
        list.push(q);
        this.deps(q[0], q[1], q[2], out);
        if (out.dynamic) dyn = true;
        out.forEach(add);
      }
      if (!dyn || namesAdded) break;
      namesAdded = true;
      Object.keys(this.names).forEach(function (k) {
        var def = self.names[k];
        if (/^_xlnm\./i.test(def.name) || /\[\d+\]/.test(def.text)) return; // области печати и ссылки на другие файлы
        var v = self.ev(self.nameAst(def), { sh: Math.max(0, def.local), r: 1, c: 1, dr: 0, dc: 0 });
        if (v instanceof Ref) add(v);
      });
    }
    list.sort(function (p, q) { return p[0] - q[0] || p[1] - q[1] || p[2] - q[2]; });
    return list;
  };
  /* функции, которых нет в генераторе, среди формул list */
  B.unsupported = function (list) {
    var miss = {}, self = this;
    function walk(n) {
      if (n.t === 'fn') { if (!FN[n.v]) miss[n.v] = true; n.args.forEach(walk); }
      else if (n.t === 'bin' || n.t === 'rng') { walk(n.a); walk(n.b); }
      else if (n.t === 'neg' || n.t === 'pct') walk(n.a);
    }
    list.forEach(function (q) { walk(self.code(q[0], self.cell(q[0], q[1], q[2]), q[1], q[2]).ast); });
    return Object.keys(miss);
  };
  function same(v, cv) {
    if (typeof cv === 'number') return typeof v === 'number' && Math.abs(v - cv) <= 1e-9 * Math.max(1, Math.abs(cv));
    if (isErr(cv)) return isErr(v) && v.e === cv.e;
    if (typeof cv === 'string') return v === cv;
    if (typeof cv === 'boolean') return v === cv;
    return true;
  }
  /* сверка с результатами, которые Excel сохранил в файле для его текущих входных данных */
  B.selfTest = function (list) {
    var saved = this.over, bad = [], checked = 0, today = this.today;
    this.over = new Map(); this.memo.clear();
    var mod = /^(\d{4})-(\d{2})-(\d{2})/.exec(this.raw.modified || '');
    if (mod) this.today = this.serial(+mod[1], +mod[2], +mod[3]);
    for (var i = 0; i < list.length; i++) {
      var q = list[i], cell = this.cell(q[0], q[1], q[2]);
      if (cell.cv === undefined || cell.array || cell.dataTable) continue;
      var v = this.at(q[0], q[1], q[2]);
      checked++;
      if (!same(v, cell.cv)) bad.push({ addr: this.addr(q[0], q[1], q[2]), got: v, want: cell.cv });
    }
    this.over = saved; this.today = today; this.memo.clear();
    return { checked: checked, bad: bad };
  };
  B.isErr = isErr;

  var api = { Book: Book, parse: parse, tokenize: tokenize, isErr: isErr, err: err, Ref: Ref, colName: colName, colNum: colNum, COLS: COLS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FormulaBook = api;
})(this);
