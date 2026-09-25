/* ============================================================
   Интерактив расчёта: графики, таблица, подсказки.
   Единственный источник цифр — массив DATA (возраст, выплата
   в месяц, за год, накопленный итог). Всё остальное строится
   из него, поэтому график, таблица и карточки не расходятся.
   ============================================================ */
(function () {
  'use strict';

  // статические копии ленты нужны там, где нет скриптов; здесь их рисует компонент
  Array.prototype.forEach.call(document.querySelectorAll('.wave-fixed'), function (n) {
    if (n.parentNode) n.parentNode.removeChild(n);
  });

  /* данные клиента подставляет генератор КП */
  var CFG = /*@CFG*/{"data":[],"transfer":0,"payback":0,"guarLast":0,"start":55,"end":100,"keyAges":[]}/*@END*/;
  var DATA = CFG.data;
  var TRANSFER = CFG.transfer;       // сумма перевода = премия
  var PAYBACK_AGE = CFG.payback;     // год, в котором накопленные выплаты её возвращают
  var GUAR_LAST = CFG.guarLast;      // последний возрастной год гарантийного периода (< START — гарантии нет)
  var START = CFG.start, END = CFG.end;
  var NBSP = ' ';
  var byAge = {};
  DATA.forEach(function (d) { byAge[d.age] = d; });

  /* шаг и верх оси: 1, 2, 2,5, 5 × 10^k — чтобы делений было 4–6 */
  function niceScale(v) {
    var raw = v / 5, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / p;
    var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
    var top = Math.ceil(v * 1.04 / step) * step, ticks = [];
    for (var t = 0; t <= top + step / 2; t += step) ticks.push(t);
    return { max: top, ticks: ticks };
  }

  /* ── Форматирование ─────────────────────────────────────── */
  function fmt(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP); }
  function money(n) { return fmt(n) + NBSP + '₸'; }
  function mln(n) {
    if (n < 1e6) return Math.round(n / 1e3) + NBSP + 'тыс';
    var v = n / 1e6;
    var t = v >= 10 ? String(Math.round(v)) : v.toFixed(1).replace(/[.,]0$/, '').replace('.', ',');
    return t + NBSP + 'млн';
  }
  function ratio(n) {
    var v = n / TRANSFER;
    if (Math.abs(v - Math.round(v)) < 0.05) return String(Math.round(v));
    return v.toFixed(1).replace('.', ',');
  }
  function yearsWord(a) {
    var t = a % 100, o = a % 10;
    if (t > 10 && t < 20) return 'лет';
    if (o === 1) return 'год';
    if (o >= 2 && o <= 4) return 'года';
    return 'лет';
  }

  /* ── Всплывающая подсказка ──────────────────────────────── */
  var tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  var tipOn = false;

  function tipShow(html, x, y, anchor) {
    tip.innerHTML = html;
    tip.classList.add('is-on');
    tipOn = true;
    place(x, y, anchor);
  }
  function place(x, y, anchor) {
    var r = tip.getBoundingClientRect();
    var left = x - r.width / 2;
    var top = y - r.height - 14;
    if (top < 8) top = y + (anchor ? anchor + 14 : 22);
    left = Math.max(10, Math.min(left, window.innerWidth - r.width - 10));
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function tipHide() { tip.classList.remove('is-on'); tipOn = false; }

  window.addEventListener('scroll', function () { if (tipOn) tipHide(); }, { passive: true });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') tipHide(); });

  /* ── Структура суммы: сектор диаграммы ↔ подпись ────────── */
  var pieSegs = document.querySelectorAll('.pie-seg');
  var keyBtns = document.querySelectorAll('.stack-key [data-part]');
  function partOf(el) {
    if (el.getAttribute('data-part')) return el.getAttribute('data-part');
    var m = /pie-(own|div|top)/.exec(el.getAttribute('class') || '');
    return m ? m[1] : null;
  }
  function markPart(key) {
    Array.prototype.forEach.call(pieSegs, function (p) { p.classList.toggle('is-active', partOf(p) === key); });
    Array.prototype.forEach.call(keyBtns, function (b) { b.classList.toggle('is-active', partOf(b) === key); });
  }
  function bindPart(el) {
    var key = partOf(el);
    if (!key) return;
    el.addEventListener('pointerenter', function () { markPart(key); });
    el.addEventListener('click', function () { markPart(key); });
    el.addEventListener('focus', function () { markPart(key); });
  }
  Array.prototype.forEach.call(pieSegs, bindPart);
  Array.prototype.forEach.call(keyBtns, bindPart);
  var stackCard = document.querySelector('.stack-card');
  if (stackCard) stackCard.addEventListener('pointerleave', function () {
    if (!stackCard.querySelector('[data-part]:focus')) markPart(null);
  });

  /* ── Сетка выплат: подсказка под курсором ───────────────── */
  var dots = document.querySelectorAll('.waffle i[data-age]');
  Array.prototype.forEach.call(dots, function (d) {
    d.setAttribute('data-title', d.getAttribute('title') || '');
    d.removeAttribute('title');          // вместо системной подсказки — своя, в стиле отчёта
  });
  if (dots.length) {
    var waffles = document.querySelectorAll('.waffle');
    Array.prototype.forEach.call(waffles, function (w) {
      w.addEventListener('pointerover', function (e) {
        var d = e.target.closest ? e.target.closest('i[data-age]') : null;
        if (!d) return;
        var age = d.getAttribute('data-age'), mon = d.getAttribute('data-mon');
        var html = '<b>' + age + ' ' + yearsWord(+age) + ' · ' + mon + '</b>';
        if (d.getAttribute('data-none')) {
          html += '<em>в ЕНПФ выплат в этом месяце нет</em>';
        } else {
          html += '<div class="row"><span>Выплата за месяц</span><i>' + d.getAttribute('data-sum') + '</i></div>' +
                  '<div class="row"><span>За весь год</span><i>' + d.getAttribute('data-year') + '</i></div>';
        }
        var r = d.getBoundingClientRect();
        tipShow(html, r.left + r.width / 2, r.top, r.height);
      });
      w.addEventListener('pointerleave', tipHide);
    });
  }

  /* ── Общее состояние: выбранный возраст ─────────────────── */
  var state = { age: PAYBACK_AGE };
  var listeners = [];
  function onAge(fn) { listeners.push(fn); fn(state.age); }
  function setAge(age, from) {
    age = Math.max(START, Math.min(END, Math.round(age)));
    if (age === state.age && from !== 'init') return;
    state.age = age;
    listeners.forEach(function (fn) { fn(age, from); });
  }

  /* ── SVG-помощники ──────────────────────────────────────── */
  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    return e;
  }
  function frag(host) { while (host.firstChild) host.removeChild(host.firstChild); }

  function hoverAge(age, e) {
    var d = byAge[age];
    var done = d.cum >= TRANSFER;
    tipShow('<b>' + age + ' ' + yearsWord(age) + '</b>' +
      '<div class="row"><span>Выплата в месяц</span><i>' + money(d.m) + '</i></div>' +
      '<div class="row"><span>Выплата за год</span><i>' + money(d.y) + '</i></div>' +
      '<div class="row"><span>Получено всего</span><i>' + money(d.cum) + '</i></div>' +
      (done
        ? '<em>сумма перевода вернулась · выплаты продолжаются пожизненно</em>'
        : '<div class="row"><span>До суммы перевода</span><i>' + money(TRANSFER - d.cum) + '</i></div>'),
      e.clientX, e.clientY - 6, 20);
  }
  /* ── «Где ваши деньги»: подсказка и выбор возраста по столбцу ── */
  var flowCols = {};
  Array.prototype.forEach.call(document.querySelectorAll('.cf__col[data-age]'), function (c) {
    var age = +c.getAttribute('data-age');
    flowCols[age] = c;
    function show(e) {
      var recv = +c.getAttribute('data-recv'), surr = c.getAttribute('data-surr'), m = +c.getAttribute('data-m');
      var html = '<b>' + age + ' ' + yearsWord(age) + ' · ' + c.getAttribute('data-year') + ' г.</b>' +
        (m ? '<div class="row"><span>Выплата в месяц</span><i>' + money(m) + '</i></div>' : '') +
        '<div class="row"><span>Получено выплатами</span><i>' + money(recv) + '</i></div>' +
        '<div class="row"><span>Выкупная сумма</span><i>' + (surr === '' ? 'пока недоступна' : money(+surr)) + '</i></div>' +
        (recv >= TRANSFER ? '<em>сумма перевода вернулась · выплаты продолжаются пожизненно</em>'
          : !recv ? '<em>выплаты ещё не начались — деньги в договоре</em>' : '');
      var r = c.getBoundingClientRect();
      tipShow(html, r.left + r.width / 2, e && e.clientY ? e.clientY - 6 : r.top, 20);
    }
    c.addEventListener('pointerenter', show);
    c.addEventListener('pointermove', show);
    c.addEventListener('pointerleave', tipHide);
    c.addEventListener('click', function () { if (age >= START) setAge(age, 'chart'); });
  });
  function markPayback(age) {
    for (var a in flowCols) flowCols[a].classList.toggle('is-current', +a === age);
  }

  /* ── График 2: рост ежемесячной выплаты (START–END) ─────── */
  var grHost = document.getElementById('chart-growth');
  var grCur = null, grGeom = null;
  function drawGrowth() {
    var W = grHost.clientWidth || 720;
    var H = Math.max(250, Math.min(360, Math.round(W * 0.42)));
    var L = 58, R = 14, T = 18, B = 30;
    var iw = W - L - R, ih = H - T - B;
    var grScale = niceScale(byAge[END].m);
    var yMax = grScale.max;
    var x = function (age) { return L + (age - START) / (END - START) * iw; };
    var y = function (v) { return T + ih - (v / yMax) * ih; };
    grGeom = { x: x, y: y, L: L, R: R, T: T, ih: ih, W: W, H: H };

    var s = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img',
      'aria-label': 'Ежемесячная выплата растёт с ' + fmt(byAge[START].m) + ' тенге в ' + START + ' ' + yearsWord(START) + ' до ' + fmt(byAge[END].m) + ' тенге в ' + END + ' лет' });
    var defs = el('defs', {});
    var ag = el('linearGradient', { id: 'grA', x1: 0, y1: 0, x2: 0, y2: 1 });
    ag.appendChild(el('stop', { offset: 0, 'stop-color': '#47903C', 'stop-opacity': .26 }));
    ag.appendChild(el('stop', { offset: 1, 'stop-color': '#47903C', 'stop-opacity': .02 }));
    defs.appendChild(ag);
    s.appendChild(defs);

    // гарантийный период
    if (GUAR_LAST >= START) {
      var gx2 = x(Math.min(GUAR_LAST + .5, END));
      s.appendChild(el('rect', { x: L, y: T, width: Math.max(0, gx2 - L), height: ih, fill: '#E6EDF4', opacity: .75, rx: 6, class: 'gr-fade' }));
      var gl = el('text', { x: L + 8, y: T + 15, fill: '#5C7890', 'font-size': 11, 'font-weight': 800, class: 'gr-fade' });
      gl.textContent = 'гарантийный период';
      s.appendChild(gl);
    }

    // сетка
    grScale.ticks.forEach(function (v) {
      s.appendChild(el('line', { x1: L, y1: y(v), x2: W - R, y2: y(v), stroke: v ? '#F1F4F7' : '#DDE4EA', 'stroke-width': 1 }));
      var t = el('text', { x: L - 8, y: y(v) + 3.5, 'text-anchor': 'end', fill: '#9BA7B4', 'font-size': W < 560 ? 8.5 : 10, 'font-weight': 700 });
      t.textContent = v ? mln(v) : '0';
      s.appendChild(t);
    });
    var axis = [START];
    for (var ax = Math.ceil((START + 1) / 5) * 5; ax < END; ax += 5) if (ax - START >= 3) axis.push(ax);
    axis.push(END);
    axis.forEach(function (age) {
      var t = el('text', { x: x(age), y: H - 10, 'text-anchor': 'middle', fill: '#8B98A6', 'font-size': 11, 'font-weight': 700 });
      t.textContent = age;
      s.appendChild(t);
    });

    // площадь и линия
    var dLine = '', dArea = '';
    DATA.forEach(function (d, i) {
      dLine += (i ? 'L' : 'M') + x(d.age).toFixed(1) + ' ' + y(d.m).toFixed(1);
    });
    dArea = dLine + 'L' + x(END).toFixed(1) + ' ' + (T + ih) + 'L' + x(START).toFixed(1) + ' ' + (T + ih) + 'Z';
    s.appendChild(el('path', { d: dArea, fill: 'url(#grA)', class: 'gr-fade' }));
    var line = el('path', { d: dLine, fill: 'none', stroke: '#47903C', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'gr-line' });
    s.appendChild(line);

    // опорные точки
    CFG.keyAges.forEach(function (age) {
      var d = byAge[age];
      if (!d) return;
      s.appendChild(el('circle', { cx: x(age), cy: y(d.m), r: 4.5, fill: '#fff', stroke: '#47903C', 'stroke-width': 2.5, class: 'gr-fade' }));
      if (W > 560) {
        var t = el('text', {
          x: x(age) + (age === END ? -6 : age === START ? 6 : 0), y: y(d.m) - 12,
          'text-anchor': age === END ? 'end' : age === START ? 'start' : 'middle',
          fill: '#37742E', 'font-size': 11, 'font-weight': 800, class: 'gr-fade',
          stroke: '#fff', 'stroke-width': 3.5, 'paint-order': 'stroke fill', 'stroke-linejoin': 'round'
        });
        t.textContent = fmt(d.m);
        s.appendChild(t);
      }
    });

    // курсор выбранного возраста
    var cur = el('g', { class: 'gr-cursor gr-fade' });
    var cline = el('line', { y1: T, y2: T + ih, stroke: '#BBD034', 'stroke-width': 2 });
    var cdot = el('circle', { r: 6.5, fill: '#BBD034', stroke: '#fff', 'stroke-width': 2.5 });
    cur.appendChild(cline); cur.appendChild(cdot);
    s.appendChild(cur);
    grCur = { g: cur, line: cline, dot: cdot };

    var hit = el('rect', { x: L, y: T, width: iw, height: ih, fill: 'transparent', style: 'cursor:crosshair' });
    function pick(e) {
      var box = s.getBoundingClientRect();
      var age = Math.round(START + (e.clientX - box.left - L) / iw * (END - START));
      age = Math.max(START, Math.min(END, age));
      setAge(age, 'chart');
      hoverAge(age, e);
    }
    hit.addEventListener('pointermove', pick);
    hit.addEventListener('pointerdown', pick);
    hit.addEventListener('pointerleave', tipHide);
    s.appendChild(hit);

    frag(grHost);
    grHost.appendChild(s);
    var len = 0;
    try { len = line.getTotalLength(); } catch (e) { len = 0; }
    if (len) {
      line.style.strokeDasharray = len;
      line.style.strokeDashoffset = grHost.classList.contains('is-drawn') ? 0 : len;
    }
    grHost._line = line;
    moveCursor(state.age);
  }
  function moveCursor(age) {
    if (!grCur || !grGeom) return;
    var d = byAge[age];
    grCur.line.setAttribute('x1', grGeom.x(age));
    grCur.line.setAttribute('x2', grGeom.x(age));
    grCur.dot.setAttribute('cx', grGeom.x(age));
    grCur.dot.setAttribute('cy', grGeom.y(d.m));
  }

  /* ── Таблица ────────────────────────────────────────────── */
  var tbody = document.getElementById('sched-body');
  var scroll = document.getElementById('sched-scroll');
  var rows = {};
  Array.prototype.forEach.call(tbody.querySelectorAll('tr[data-age]'), function (tr) {
    var age = +tr.getAttribute('data-age');
    tr.addEventListener('click', function () { setAge(age, 'table'); });
    rows[age] = tr;
  });

  /* ── Синхронизация выбранного возраста ──────────────────── */
  var range = document.getElementById('age-range');
  var ageOut = document.getElementById('age-out');
  var ageHint = document.getElementById('age-hint');
  var oMonth = document.getElementById('o-month');
  var oYear = document.getElementById('o-year');
  var oCum = document.getElementById('o-cum');
  var oRatio = document.getElementById('o-ratio');

  range.addEventListener('input', function () { setAge(+range.value, 'range'); });

  var ageRadios = document.querySelectorAll('input[name="agepick"]');
  Array.prototype.forEach.call(ageRadios, function (r) {
    r.addEventListener('change', function () { setAge(+r.value, 'chip'); });
  });
  var ageLabels = document.querySelectorAll('.age-chips label');

  onAge(function (age, from) {
    var d = byAge[age];
    range.value = age;
    range.style.setProperty('--pct', ((age - START) / (END - START) * 100).toFixed(1) + '%');
    ageOut.textContent = age;
    ageOut.nextSibling.textContent = ' ' + yearsWord(age);
    ageHint.textContent = age < PAYBACK_AGE
      ? 'до возврата суммы перевода остаётся ' + money(TRANSFER - d.cum)
      : age === PAYBACK_AGE
        ? 'возраст, в котором суммарные выплаты возвращают сумму перевода'
        : age <= GUAR_LAST
          ? 'гарантийный период · выплаты продолжаются пожизненно'
          : 'после гарантийного периода · выплаты продолжаются пожизненно';
    oMonth.textContent = money(d.m);
    oYear.textContent = money(d.y);
    oCum.textContent = money(d.cum);
    oRatio.textContent = '×' + ratio(d.cum);

    moveCursor(age);
    markPayback(age);

    Array.prototype.forEach.call(ageRadios, function (r) {
      if (+r.value === age && !r.checked) r.checked = true;
    });
    Array.prototype.forEach.call(ageLabels, function (l) {
      l.classList.toggle('is-active', l.getAttribute('for') === 'ag' + age);
    });
    for (var a in rows) rows[a].classList.remove('is-current');
    var tr = rows[age];
    if (tr) {
      tr.classList.add('is-current');
      if (from && from !== 'init' && from !== 'table' && scroll.clientHeight) {
        scroll.scrollTop = Math.max(0, tr.offsetTop - scroll.clientHeight / 2 + tr.offsetHeight / 2);
      }
    }
  });

  /* ── Навигация: активный раздел ─────────────────────────── */
  var links = {};
  document.querySelectorAll('.nav a').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
  var sections = Object.keys(links).map(function (id) { return document.getElementById(id); }).filter(Boolean);
  function markNav() {
    var mid = window.innerHeight * 0.42, best = null;
    sections.forEach(function (sec) {
      var r = sec.getBoundingClientRect();
      if (r.top <= mid && r.bottom > mid) best = sec.id;
    });
    for (var id in links) links[id].classList.toggle('is-active', id === best);
  }
  window.addEventListener('scroll', markNav, { passive: true });
  markNav();

  /* ── Появление при прокрутке, счётчики, рост полос ──────── */
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // что появляется при прокрутке и каким движением
  var REVEAL_GROUPS = [
    ['.hero__badge,.hero h1,.hero__lead', 'reveal--left'],
    ['.chips .chip', 'reveal--pop'],
    ['.outcome', ''],
    ['.section-head', 'reveal--left'],
    ['.card,.client-bar,.contact,.ksj,.family,.payback-note', ''],
    ['.pcard,.src3,.payout,.perk,.level,.level-arrow,.cfact,.fact,.tile,.abbr,.srcard,.acc,.step,.mile,.tl-points li,.chain>div,.metric,.decade,.mflow__node,.alt,.cparam,.why__node,.wait-pair>div,.phase,.rest__opt,.cats__row,.doc', 'reveal--pop'],
    ['.tl-bar,.waffle,.pbnote__scale,.inout__side,.cmp-side', '']
  ];

  function fmtCount(node, target) {
    // бережный режим не отключает счёт, только укорачивает его
    var dur = REDUCED ? 550 : 1000, t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var k = Math.min(1, (ts - t0) / dur);
      node.textContent = fmt(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    }
    node.textContent = fmt(0);
    requestAnimationFrame(step);
  }

  function prepareCascades() {
    // точки сетки выплат и полосы таймлайна проявляются волной
    Array.prototype.forEach.call(document.querySelectorAll('.waffle'), function (w) {
      Array.prototype.forEach.call(w.querySelectorAll('i'), function (d, i) {
        d.style.transitionDelay = Math.min(i * 7, 700) + 'ms';
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tl-seg'), function (seg, i) {
      seg.style.transitionDelay = (i * 120) + 'ms';
    });
    Array.prototype.forEach.call(document.querySelectorAll('.pbnote__scale i'), function (b, i) {
      b.style.transitionDelay = (i * 55) + 'ms';
    });
  }

  function activate(el) {
    var bars = el.matches('[data-w]') ? [el] : el.querySelectorAll('[data-w]');
    Array.prototype.forEach.call(bars, function (b) { b.style.width = b.getAttribute('data-w') + '%'; });
    Array.prototype.forEach.call(el.querySelectorAll('.donut__arc'), function (a) { a.style.strokeDashoffset = 0; });
    var cnts = el.querySelectorAll('.cnt[data-count]');
    Array.prototype.forEach.call(cnts, function (c) {
      if (c._done) return;
      c._done = true;
      fmtCount(c, +c.getAttribute('data-count'));
    });
  }

  /* ⚠️ Появление считаем по позиции на каждом кадре прокрутки, а не наблюдателем:
     при быстром скролле IntersectionObserver пропускает блоки, «пролетевшие» между
     кадрами, и они навсегда остаются прозрачными. Здесь элемент показывается, как
     только его верх оказался выше нижней границы экрана — включая уже прокрученные. */
  var watch = [];
  function addWatch(el, run) { watch.push({ el: el, run: run }); }

  function pump() {
    if (!watch.length) return;
    var vh = window.innerHeight, left = [];
    for (var i = 0; i < watch.length; i++) {
      var w = watch[i], r = w.el.getBoundingClientRect();
      if (r.top < vh * 0.92 && r.bottom > -vh * 0.5) w.run();
      else if (r.top < 0) w.run();               // блок уже проскочили — показываем сразу
      else left.push(w);
    }
    watch = left;
  }
  var pumping = false;
  function schedulePump() {
    if (pumping) return;
    pumping = true;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { pumping = false; pump(); });
    });
  }

  function setupReveal() {
    var nodes = [];
    REVEAL_GROUPS.forEach(function (g) {
      Array.prototype.forEach.call(document.querySelectorAll(g[0]), function (el) {
        if (nodes.indexOf(el) !== -1) return;
        if (g[1]) el.classList.add(g[1]);
        nodes.push(el);
      });
    });
    var stackEl = document.getElementById('stack');
    prepareCascades();

    var seen = {};
    nodes.forEach(function (el) {
      el.classList.add('reveal');
      var pid = el.parentNode;
      var idx = seen.i === pid ? seen.n + 1 : 0;
      seen.i = pid; seen.n = idx;
      if (idx) el.style.transitionDelay = Math.min(idx * 70, 350) + 'ms';
      addWatch(el, function () { el.classList.add('is-in'); activate(el); });
    });

    // собственная анимация: круговая диаграмма, сетка выплат, полосы, графики
    Array.prototype.forEach.call(document.querySelectorAll('.pie,.waffle,.tl-bar,.pbnote__scale,.cf,.stairs'), function (el) {
      addWatch(el, function () { el.classList.add('is-in'); });
    });
    [grHost].forEach(function (host) {
      if (!host) return;
      addWatch(host, function () {
        host.classList.add('is-drawn');
        if (host === grHost && grHost._line) grHost._line.style.strokeDashoffset = 0;
      });
    });
    if (stackEl) addWatch(stackEl, function () { stackEl.classList.add('is-in'); });

    window.addEventListener('scroll', schedulePump, { passive: true });
    window.addEventListener('resize', schedulePump);
    schedulePump();
  }

  function markDrawn() {
    if (grHost) grHost.classList.add('is-drawn');
    if (grHost && grHost._line) grHost._line.style.strokeDashoffset = 0;
  }

  function showEverything() {           // печать: ничего не должно остаться скрытым
    Array.prototype.forEach.call(document.querySelectorAll('.pie,.waffle,.tl-bar,.pbnote__scale,.cf,.stairs'), function (el) {
      el.classList.add('is-in');
    });
    Array.prototype.forEach.call(document.querySelectorAll('.reveal'), function (el) {
      el.classList.add('is-in');
      el.style.transitionDelay = '0ms';
      activate(el);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.cnt[data-count]'), function (c) {
      c.textContent = fmt(+c.getAttribute('data-count'));
    });
    markDrawn();
  }

  /* ── Полоса прочитанного ────────────────────────────────── */
  var bar = document.getElementById('progress-bar');
  if (bar) {
    var ticking = false;
    var onScroll = function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var h = document.documentElement.scrollHeight - window.innerHeight;
        bar.style.width = (h > 0 ? Math.min(100, Math.max(0, window.scrollY / h * 100)) : 0) + '%';
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();
  }

  /* ── Лёгкий параллакс ленты ─────────────────────────────── */
  if (!REDUCED) {
    var pxHosts = document.querySelectorAll('.wave-host--hero,.wave-host--accent,.wave-host--contact');
    if (pxHosts.length) {
      var pxTick = false;
      var onPx = function () {
        if (pxTick) return;
        pxTick = true;
        requestAnimationFrame(function () {
          pxTick = false;
          var vh = window.innerHeight;
          Array.prototype.forEach.call(pxHosts, function (h) {
            var r = h.getBoundingClientRect();
            if (r.bottom < -200 || r.top > vh + 200) return;
            var k = (r.top + r.height / 2 - vh / 2) / vh;   // −1…1 по положению на экране
            h.style.transform = 'translate3d(0,' + (k * 26).toFixed(1) + 'px,0)';
          });
        });
      };
      window.addEventListener('scroll', onPx, { passive: true });
      window.addEventListener('resize', onPx);
      onPx();
    }
  }

  /* ── Печать ─────────────────────────────────────────────── */
  document.getElementById('btn-print').addEventListener('click', function () { window.print(); });

  /* ── Отрисовка и адаптив ────────────────────────────────── */
  function drawAll() { drawGrowth(); }
  drawAll();
  document.documentElement.classList.add('js-charts');
  setAge(PAYBACK_AGE, 'init');
  setupReveal();
  // страховка: если наблюдатель по какой-то причине не сработал (скрытая вкладка,
  // экспорт в PDF, старый движок) — показываем всё, страница не должна остаться пустой
  setTimeout(function () {
    var vh = window.innerHeight, stuck = false;
    Array.prototype.forEach.call(document.querySelectorAll('.reveal:not(.is-in)'), function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < vh && r.bottom > 0) stuck = true;
    });
    if (stuck) showEverything();
  }, 2500);

  var t = null, lastW = window.innerWidth;
  window.addEventListener('resize', function () {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(t);
    t = setTimeout(drawAll, 160);
  });
  // страховка: что бы ни случилось с наблюдателем, через 4 секунды
  // диаграмма должна быть видна
  setTimeout(function () {
    var pie = document.querySelector('.pie');
    if (pie && !pie.classList.contains('is-in')) {
      var r = pie.getBoundingClientRect();
      if (r.top < window.innerHeight * 1.5) {
        pie.classList.add('is-in');
        Array.prototype.forEach.call(pie.querySelectorAll('.pie-seg'), function (el) {
          if (el._full) el.style.strokeDasharray = el._full;
        });
      }
    }
  }, 4000);

  /* ── Круговая диаграмма: дуги «дорисовываются» ───────────────
     stroke-dasharray с var() Safari игнорирует, поэтому значения
     снимаем с атрибутов и выставляем стилем. */
  (function () {
    var segs = document.querySelectorAll('.pie-seg');
    if (!segs.length) return;
    Array.prototype.forEach.call(segs, function (el) {
      el._full = el.getAttribute('stroke-dasharray');
      if (!REDUCED) el.style.strokeDasharray = '0 672.3';
    });
    var pie = document.querySelector('.pie');
    if (!pie) return;
    addWatch(pie, function () {
      Array.prototype.forEach.call(segs, function (el) {
        el.style.strokeDasharray = el._full;
      });
    });
  })();

  /* ── Подсказка на столбцах «во сколько раз вернётся перевод» ─ */
  Array.prototype.forEach.call(document.querySelectorAll('.cmpchart svg'), function (svg) {
    svg.addEventListener('pointermove', function (e) {
      var bar = e.target.closest ? e.target.closest('.ax-bar') : null;
      if (!bar) { tipHide(); return; }
      var age = +bar.getAttribute('data-age');
      var row = null, i;
      for (i = 0; i < DATA.length; i++) if (DATA[i].age === age) row = DATA[i];
      if (!row) return;
      var html = '<b>К ' + age + ' годам — ' + fmt(row.cum) + '\u00a0₸</b>' +
                 '<em>складывается из ежемесячных выплат</em>';
      for (var q = START; q <= age; q += 5) {
        for (i = 0; i < DATA.length; i++) {
          if (DATA[i].age === q) {
            html += '<div class="row"><span>' + q + ' ' + yearsWord(q) + '</span><i>' +
                    fmt(DATA[i].m) + '\u00a0₸ в месяц</i></div>';
          }
        }
      }
      var r = bar.getBoundingClientRect();
      tipShow(html, r.left + r.width / 2, r.top, 0);
    });
    svg.addEventListener('pointerleave', tipHide);
  });

  // печать и сохранение в PDF: раскрываем аккордеоны, чтобы ответы попали в документ
  var reopened = [];
  window.addEventListener('beforeprint', function () {
    drawAll(); showEverything();
    reopened = [];
    Array.prototype.forEach.call(document.querySelectorAll('details:not([open])'), function (d) {
      d.open = true; reopened.push(d);
    });
  });
  window.addEventListener('afterprint', function () {
    reopened.forEach(function (d) { d.open = false; });
    reopened = [];
  });
})();
