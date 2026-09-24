/*
 * Повторяющиеся блоки отчёта: таблицы, сетки, диаграммы.
 * Разметка повторяет исходный отчёт, чтобы работали те же стили и скрипт.
 */
(function (root) {
  'use strict';

  var ICONS = /*@ICONS*/{}/*@END*/;
  var MON = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  var MON3 = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  var NBSP = '&nbsp;';

  function plain(v) { return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function nb(v) { return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP); }
  function word(n, one, few, many) {
    var t = n % 100, o = n % 10;
    if (t > 10 && t < 20) return many;
    return o === 1 ? one : (o >= 2 && o <= 4 ? few : many);
  }
  function r1(v) { return Math.round(v * 10) / 10; }

  function make(M) {
    var T = M.tenge, H = M.moneyH, Y = M.years, X = M.times, E = M.esc;
    var B = {};

    /* снимок графика для просмотрщиков без скриптов: его вставляет генератор */
    B.snapshots = { payback: '', growth: '' };
    B.snapshot = function (kind) { return B.snapshots[kind] || ''; };

    /* ── Выбор возраста: переключатель без скриптов работает по позициям ── */
    B.agePick = function () {
      var ages = M.slotAges, checked = ages.indexOf(M.payback.age);
      if (checked < 0) checked = 0;
      var radios = ages.map(function (a, i) {
        return '<input type="radio" name="agepick" id="ag' + (i + 1) + '" value="' + a + '"' + (i === checked ? ' checked' : '') + ' hidden>';
      }).join('');
      var chips = ages.map(function (a, i) { return '<label for="ag' + (i + 1) + '">' + Y(a) + '</label>'; }).join('');
      var scale = M.scaleAges.map(function (a) { return '<span>' + a + '</span>'; }).join('');
      var d = M.at(ages[checked]);
      var slots = ages.map(function (a, i) {
        var r = M.at(a);
        return '      <div class="age-slot" data-slot="' + (i + 1) + '" data-age="' + a + '">\n' +
          '        <b class="age-slot__title">В ' + Y(a) + ' — ' + M.slotTitle(a) + '</b>\n' +
          '        <div class="agepick__out">\n' +
          '          <div><span>Выплата в месяц</span><b class="num">' + T(r.m) + '</b></div>\n' +
          '          <div><span>Выплата за год</span><b class="num">' + T(r.y) + '</b></div>\n' +
          '          <div><span>Получено всего</span><b class="num">' + T(r.cum) + '</b></div>\n' +
          '          <div><span>К сумме перевода</span><b class="num">' + X(r.cum / M.premium) + '</b></div>\n' +
          '        </div>\n      </div>';
      }).join('\n');
      return '      <div class="agepick">\n        ' + radios + '\n' +
        '        <div class="agepick__head">\n' +
        '          <b>Показатели по возрасту<span class="js-only">: <span id="age-out">' + ages[checked] + '</span> ' + M.yearsWord(ages[checked]) + '</span></b>\n' +
        '          <span class="js-only" id="age-hint">' + M.ageHint(ages[checked]) + '</span>\n' +
        '        </div>\n' +
        '        <div class="age-chips">' + chips + '</div>\n' +
        '        <input type="range" id="age-range" min="' + M.s0 + '" max="' + M.horizon + '" step="1" value="' + ages[checked] + '" aria-label="Возраст для расчёта">\n' +
        '        <div class="agepick__scale">' + scale + '</div>\n' +
        '        <div class="agepick__out" id="age-live">\n' +
        '          <div><span>Выплата в месяц</span><b class="num" id="o-month">' + T(d.m) + '</b></div>\n' +
        '          <div><span>Выплата за год</span><b class="num" id="o-year">' + T(d.y) + '</b></div>\n' +
        '          <div><span>Получено всего</span><b class="num" id="o-cum">' + T(d.cum) + '</b></div>\n' +
        '          <div><span>К сумме перевода</span><b class="num" id="o-ratio">' + X(d.cum / M.premium) + '</b></div>\n' +
        '        </div>\n' +
        '        <div class="age-slots">\n' + slots + '\n        </div>\n      </div>';
    };

    /* ── Круговая диаграмма: дуги окружности, без масок (Safari) ── */
    B.pie = function () {
      var R = 107, L = 2 * Math.PI * R, GAP = 3;
      var parts = M.pieParts.filter(function (p) { return p.value > 0; });
      var total = parts.reduce(function (s, p) { return s + p.value; }, 0);
      var start = 0, segs = '', labels = '';
      parts.forEach(function (p) {
        var ln = L * p.value / total, dash = Math.max(0.5, ln - (parts.length > 1 ? GAP : 0)), period = dash + L;
        var off = ((period - start) % period + period) % period;
        segs += '            <circle class="pie-seg pie-' + p.key + '" cx="150" cy="150" r="' + R.toFixed(1) + '" fill="none" stroke="url(#' + p.grad + ')" stroke-width="50" stroke-dasharray="' + dash.toFixed(1) + ' ' + L.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 150 150)"/>\n';
        var mid = (start + ln / 2) / L * 2 * Math.PI - Math.PI / 2, share = p.value / total;
        if (share >= 0.04) labels += '          <text class="pie-pct" x="' + (150 + R * Math.cos(mid)).toFixed(1) + '" y="' + (150 + R * Math.sin(mid) + 6).toFixed(1) + '" text-anchor="middle">' + Math.round(share * 100) + '%</text>\n';
        start += ln;
      });
      var aria = 'Сумма перевода ' + plain(total) + ' тенге: ' + parts.map(function (p) { return p.aria + ' ' + Math.round(p.value / total * 100) + '%'; }).join(', ');
      return '        <svg width="300" height="300" class="pie" viewBox="0 0 300 300" role="img" aria-label="' + aria + '">\n' +
        '          <defs>\n' +
        '            <linearGradient id="pieOwn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6FA85F"/><stop offset="1" stop-color="#37742E"/></linearGradient>\n' +
        '            <linearGradient id="pieDiv" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#CBDE5C"/><stop offset="1" stop-color="#9DB82C"/></linearGradient>\n' +
        '            <linearGradient id="pieTop" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4A709A"/><stop offset="1" stop-color="#1D3650"/></linearGradient>\n' +
        '          </defs>\n' +
        '          <g class="pie-ring">\n' + segs + '          </g>\n' + labels +
        '          <text class="pie-sum" x="150" y="142" text-anchor="middle">' + T(total) + '</text>\n' +
        '          <text class="pie-cur" x="150" y="168" text-anchor="middle">' + (M.free ? 'сумма перевода' : 'порог оформления') + '</text>\n' +
        '        </svg>';
    };

    B.stackKey = function () {
      return '        <div class="stack-key">\n' + M.pieParts.filter(function (p) { return p.value > 0; }).map(function (p) {
        return '          <button type="button" data-part="' + p.key + '">\n' +
          '            <span class="nm"><i class="c-' + p.key + '"></i>' + p.name + '</span>\n' +
          '            <span class="val num"><span class="cnt" data-count="' + p.value + '">' + H(p.value) + '</span>&#160;₸</span>\n' +
          '            <span class="ds">' + p.note + '</span>\n' +
          '          </button>';
      }).join('\n') + '\n        </div>';
    };

    B.metrics = function () {
      return '      <div class="metrics">\n' + M.metrics.map(function (m) {
        return '        <div class="metric' + (m.accent ? ' metric--accent' : '') + '">\n' +
          '          <span>' + m.label + '</span><b class="num"><span class="cnt" data-count="' + m.value + '">' + H(m.value) + '</span>&#160;₸</b>\n' +
          '          <small>' + m.note + '</small>\n        </div>';
      }).join('\n') + '\n      </div>';
    };

    B.facts = function () {
      return '    <div class="facts-strip">\n' + M.facts.map(function (f) {
        return '      <div class="fact' + (f.accent ? ' fact--accent' : '') + '"><b' + (f.num ? ' class="num"' : '') + '>' + f.big + '</b><span>' + f.text + '</span></div>';
      }).join('\n') + '\n    </div>';
    };

    /* ── Полоса этапов, ось возрастов и ключевые точки ── */
    B.timeline = function () {
      var segs = [];
      if (M.deferral > 0) segs.push('<span class="tl-seg tl-wait" style="flex:' + M.deferral + '"><b>' + Y(M.deferral) + '</b><em class="tl-seg__d">до первой выплаты</em></span>');
      if (M.gp > 0) segs.push('<span class="tl-seg tl-guar" style="flex:' + M.gp + '"><b>' + Y(M.gp) + '</b><em class="tl-seg__d">гарантийный период</em></span>');
      segs.push('<span class="tl-seg tl-life" style="flex:' + Math.max(1, M.horizon - M.afterGuar) + '"><b>пожизненно</b><em class="tl-seg__d">выплаты продолжаются</em></span>');
      var from = M.age, span = M.horizon - from;
      var pos = function (a) { return r1((a - from) / span * 100); };
      var ticks = [{ age: from, cls: 'tl-tick tl-tick--start', x: 0 }];
      if (M.s0 > from) ticks.push({ age: M.s0, cls: 'tl-tick tl-tick--pay', x: pos(M.s0) });
      ticks.push({ age: M.payback.age, cls: 'tl-tick tl-tick--key', x: pos(M.payback.age) });
      if (M.gp > 0) ticks.push({ age: M.afterGuar, cls: 'tl-tick', x: pos(M.afterGuar) });
      // метки ближе 7% друг к другу не читаются — оставляем более важную
      var kept = [];
      ticks.forEach(function (t) {
        var clash = kept.filter(function (k) { return Math.abs(k.x - t.x) < 7; })[0];
        if (!clash) kept.push(t);
        else if (/--key/.test(t.cls)) kept[kept.indexOf(clash)] = t;
      });
      var scale = kept.map(function (t) {
        return '        <span class="' + t.cls + '" style="--x:' + t.x + '%"><i></i><b>' + Y(t.age) + '</b></span>';
      }).join('\n');
      var pts = M.points.map(function (p) {
        return '        <li' + (p.now ? ' class="is-now"' : '') + '><i' + (p.inf ? ' class="ic-inf"' : '') + '>' + (p.inf ? ICONS.inf : p.age) + '</i>' +
          (p.year ? '<em class="tl-year">' + p.year + '</em>' : '') + '<b>' + p.title + '</b><span>' + p.text + '</span></li>';
      }).join('\n');
      return '      <div class="tl-bar">\n        ' + segs.join('\n        ') + '\n      </div>\n' +
        '      <div class="tl-scale" aria-hidden="true">\n        <span class="tl-line"></span>\n' + scale +
        '\n        <span class="tl-tick tl-tick--end" style="--x:100%"><i></i><b>и далее</b></span>\n      </div>\n' +
        '      <ol class="tl-points">\n' + pts + '\n      </ol>';
    };

    /* ── Шесть преимуществ ── */
    B.perks = function () {
      return '    <div class="perks">\n' + M.perks.map(function (p) {
        return '      <article class="perk">\n' +
          '        <span class="perk__ic">' + ICONS['perk_' + p.icon] + '</span>\n' +
          '        <b class="perk__big">' + p.big + '</b>\n' +
          '        <span class="perk__t">' + p.title + '</span>\n' +
          '        <span class="perk__n">' + p.note + '</span>\n' +
          '      </article>';
      }).join('\n') + '\n    </div>';
    };

    /* ── «Ранний старт» и «Гарантия в деньгах» ── */
    var SHADES = ['#BDD6B2', '#AFCDA3', '#A0C493', '#8FBB82', '#7DB170', '#6AA65D', '#55994A', '#3F8B35'];
    function shade(i, n) {
      if (n <= 1) return SHADES[SHADES.length - 1];
      if (n === SHADES.length) return SHADES[i];
      var k = i / (n - 1) * (SHADES.length - 1), a = Math.floor(k), f = k - a;
      if (a >= SHADES.length - 1) return SHADES[SHADES.length - 1];
      var c1 = parseInt(SHADES[a].slice(1), 16), c2 = parseInt(SHADES[a + 1].slice(1), 16), out = '#';
      [16, 8, 0].forEach(function (s) {
        var v = Math.round(((c1 >> s) & 255) * (1 - f) + ((c2 >> s) & 255) * f);
        out += ('0' + v.toString(16)).slice(-2).toUpperCase();
      });
      return out;
    }
    function waffleHead(sumLabel) {
      return '          <div class="waffle__head"><span class="waffle__year"></span>' +
        MON3.map(function (m) { return '<span class="waffle__mon">' + m + '</span>'; }).join('') +
        '<span class="waffle__sum">' + sumLabel + '</span></div>\n';
    }
    B.compare = function () {
      var cards = [];
      if (M.earlyYears > 0) {
        var rows = [], empty = [];
        for (var a = M.s0, i = 0; a < M.enpf; a++, i++) {
          var r = M.at(a), col = shade(i, M.earlyYears);
          var e = '', f = '';
          for (var k = 0; k < 12; k++) {
            e += '<i title="' + a + ' ' + M.yearsWord(a) + ' · ' + MON[k] + ' · в ЕНПФ выплат нет" data-age="' + a + '" data-mon="' + MON[k] + '" data-none="1"></i>';
            f += '<i style="background:' + col + '" title="' + a + ' ' + M.yearsWord(a) + ' · ' + MON[k] + ' · ' + plain(r.m) + ' ₸" data-age="' + a + '" data-mon="' + MON[k] + '" data-sum="' + plain(r.m) + ' ₸" data-year="' + plain(r.y) + ' ₸"></i>';
          }
          empty.push('          <div class="waffle__row"><span class="waffle__year">' + a + '</span>' + e + '<span class="waffle__sum waffle__sum--zero">0&#160;₸</span></div>');
          rows.push('          <div class="waffle__row"><span class="waffle__year">' + a + '</span>' + f + '<span class="waffle__sum">' + nb(r.y) + NBSP + '₸</span></div>');
        }
        var n = M.earlyYears * 12;
        cards.push('      <article class="card cmp cmp--wide">\n' +
          '        <p class="eyebrow">Ранний старт</p>\n' +
          '        <h3>' + M.earlyTitle + '</h3>\n' +
          '        <p>В ЕНПФ деньги ждут ' + M.genYears(M.enpf) + '. По аннуитету они приходят каждый месяц ' + (M.immediate ? 'сразу' : 'уже с ' + M.startNum) + '.</p>\n' +
          '        <p class="waffle-legend"><span class="waffle-legend__key"><i></i>квадрат — одна выплата</span><span>строка — год, колонка — месяц</span><span class="js-only">наведите, чтобы увидеть сумму</span></p>\n\n' +
          '        <div class="cmp-split">\n          <div class="cmp-side">\n            <div class="cmp-side__head">\n' +
          '              <span class="cmp-side__tag">Если оставить в ЕНПФ</span>\n              <b class="cmp-side__big">0</b>\n' +
          '              <span class="cmp-side__note">выплат с ' + M.s0 + ' до ' + M.enpf + ' лет</span>\n            </div>\n' +
          '            <div class="waffle waffle--empty">\n' + waffleHead('') + empty.join('\n') + '\n            </div>\n          </div>\n' +
          '          <div class="cmp-side cmp-side--ann">\n            <div class="cmp-side__head">\n' +
          '              <span class="cmp-side__tag">По вашему аннуитету</span>\n              <b class="cmp-side__big">' + n + '</b>\n' +
          '              <span class="cmp-side__note">' + word(n, 'ежемесячная выплата', 'ежемесячные выплаты', 'ежемесячных выплат') + ' за те же ' + Y(M.earlyYears) + '</span>\n            </div>\n' +
          '            <div class="waffle">\n' + waffleHead('за год') + rows.join('\n') + '\n            </div>\n          </div>\n        </div>\n\n' +
          '        <div class="cmp-foot">\n          <div class="cmp-foot__sum">\n' +
          '            <b class="num"><span class="cnt" data-count="' + M.early.cum + '">' + H(M.early.cum) + '</span>&#160;₸</b>\n' +
          '            <span>придёт за ' + Y(M.earlyYears) + ' до ' + M.enpf + ' — и выплаты на этом не заканчиваются</span>\n          </div>\n' +
          '          <div class="cmp-foot__scale">\n' +
          '            <span><i class="lo"></i>' + T(M.first) + ' — первая выплата, дальше растёт</span>\n' +
          (M.earlyYears > 1 ? '            <span><i class="hi"></i>' + T(M.early.m) + ' — выплата в ' + Y(M.early.age) + ', перед ' + M.enpf + '-летием</span>\n' : '') +
          '          </div>\n        </div>\n      </article>');
      }
      if (M.gp > 0) {
        var ratio = M.guarLast.cum / M.premium, arc = 339.3;
        var off = ratio >= 1 ? 0 : r1(arc * (1 - ratio));
        cards.push('      <article class="card cmp">\n' +
          '        <p class="eyebrow">Гарантийный период в деньгах</p>\n' +
          '        <h3>Что закрывает гарантия ' + Y(M.gp) + '</h3>\n' +
          '        <p>Возрастные годы ' + M.s0 + '–' + M.guarLast.age + '.</p>\n' +
          '        <div class="donut-row">\n          <div class="donut-box">\n' +
          '            <svg width="132" height="132" class="donut" viewBox="0 0 132 132" role="img" aria-label="Выплаты за гарантийный период — ' + X(ratio).slice(1) + ' от суммы перевода">\n' +
          '              <circle cx="66" cy="66" r="54" fill="none" stroke="#EDF1F4" stroke-width="13"/>\n' +
          '              <circle class="donut__arc" cx="66" cy="66" r="54" fill="none" stroke="url(#donutG)" stroke-width="13" stroke-linecap="round"\n' +
          '                      stroke-dasharray="' + arc + '" stroke-dashoffset="' + off + '" transform="rotate(-90 66 66)"/>\n' +
          '              <defs><linearGradient id="donutG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6FA85F"/><stop offset="1" stop-color="#37742E"/></linearGradient></defs>\n' +
          '              <text class="d-val" x="66" y="74" text-anchor="middle">' + X(ratio) + '</text>\n' +
          '            </svg>\n            <span class="donut-cap">к сумме перевода</span>\n          </div>\n' +
          '          <div class="donut-facts">\n' +
          '            <div><b class="num"><span class="cnt" data-count="' + M.guarLast.cum + '">' + H(M.guarLast.cum) + '</span>&#160;₸</b><span>выплаты за ' + Y(M.gp) + ' гарантии</span></div>\n' +
          '            <div><b class="num"><span class="cnt" data-count="' + M.premium + '">' + H(M.premium) + '</span>&#160;₸</b><span>сумма перевода для сравнения</span></div>\n' +
          '            <div><b class="num">' + H(M.first) + ' → ' + T(M.guarLast.m) + '</b><span>так растёт выплата за ' + Y(M.gp) + ' гарантии</span></div>\n' +
          '          </div>\n        </div>\n      </article>');
      }
      // рядом с гарантией — её варианты (при отсутствии гарантии карточка вариантов одна)
      var alts = B.alts();
      if (alts && M.gp > 0) cards[cards.length - 1] = '    <div class="compare__pair">\n' + cards[cards.length - 1] + '\n' + alts + '\n    </div>';
      else if (alts) cards.push(alts);
      return cards.length ? '    <div class="compare">\n' + cards.join('\n\n') + '\n    </div>' : '';
    };

    /* ── Окупаемость ── */
    function surrCell(v) { return v === null || v === undefined ? 'пока недоступна' : v > 0 ? T(v) : '—'; }
    B.minitab = function () {
      return M.minitab.map(function (r) {
        return '            <tr' + (r.key ? ' class="is-key"' : '') + '><td>' + r.age + '</td><td class="num">' + T(r.m) + '</td><td class="num">' + T(r.cum) + '</td>' +
          '<td class="num">' + surrCell(M.at(r.age).surr) + '</td><td>' + r.what + '</td></tr>';
      }).join('\n');
    };
    B.paybackNote = function () {
      var n = M.payback.age - M.s0 + 1, on = Math.max(1, Math.round(n / 3));
      var cells = '';
      for (var k = 0; k < n; k++) cells += '<i' + (k >= n - on ? ' class="on"' : '') + ' style="--k:' + k + '"></i>';
      return '      <aside class="payback-note">\n' +
        '        <p class="eyebrow">Точка окупаемости</p>\n' +
        '        <div class="pbnote__big"><b>' + M.payback.age + '</b><span>' + M.yearsWord(M.payback.age) + '</span></div>\n' +
        '        <p class="pbnote__lead">возраст, когда сумма выплат сравняется с переданными накоплениями</p>\n' +
        '        <div class="pbnote__scale" aria-hidden="true" style="--n:' + n + '">' + cells + '</div>\n' +
        '        <div class="pbnote__axis"><span>' + M.s0 + '</span><span>' + M.payback.age + '</span></div>\n' +
        '        <div class="pbnote__facts">\n' +
        '          <div><b class="num">' + T(M.payback.cum) + '</b><span>получено ' + M.toYears(M.payback.age) + '</span></div>\n' +
        '          <div><b class="num">100%</b><span>суммы перевода вернулось</span></div>\n' +
        '        </div>\n' +
        '        <div class="pbnote__surr">\n' +
        '          <p class="pbnote__mtitle">Деньги в договоре</p>\n' +
        '          <b class="num">' + T(M.surrFirst) + '</b>\n' +
        '          <span>выкупная сумма с ' + M.surrFromText + ' — ' + M.pctNum(Math.round(M.surrFirst / M.premium * 1000) / 1000) + '% перевода. С каждой выплатой она уменьшается' +
        (M.zeroRow ? ' и ' + M.toYears(M.zeroRow.age) + ' становится нулём: деньги уже вернулись выплатами' : '') + '.</span>\n' +
        '        </div>\n' +
        '      </aside>';
    };
    /* ── Что вносите ── */
    B.inoutParts = function () {
      return '        <div class="inout__parts">\n' + M.pieParts.filter(function (p) { return p.value > 0; }).map(function (p) {
        return '          <span><i class="c-' + p.key + '"></i>' + T(p.value) + ' — ' + p.short + '</span>';
      }).join('\n') + '\n        </div>';
    };

    /* ── График «Во сколько раз вернётся перевод» ── */
    B.cmpChart = function () {
      var ages = M.cmpAges, Y0 = 340, Y1 = 86, X0 = 96, X1 = 616;
      var vmax = M.at(ages[ages.length - 1]).cum;
      var raw = vmax / 7, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), fr = raw / p;
      var step = (fr <= 1 ? 1 : fr <= 2 ? 2 : fr <= 2.5 ? 2.5 : fr <= 5 ? 5 : 10) * p;
      var top = Math.ceil(vmax * 1.02 / step) * step;
      var y = function (v) { return Y0 - v / top * (Y0 - Y1); };
      var mln = function (v) {
        if (!v) return '0';
        var m = v / 1e6;
        return (m >= 10 ? String(Math.round(m)) : String(r1(m)).replace('.', ',')) + ' млн';
      };
      var mlnT = function (v) { return String(r1(v / 1e6)).replace('.', ',').replace(/^(\d+)$/, '$1,0') + NBSP.replace('&nbsp;', ' ') + 'млн ₸'; };
      var out = '        <svg width="640" height="400" viewBox="0 0 640 400" role="img" aria-label="Сколько получено к возрасту в сравнении с переводом ' + plain(M.premium) + ' тенге">\n' +
        '        <text class="ax-unit" x="14" y="34">сумма выплат</text>\n' +
        '        <line class="ax-prem" x1="330" y1="30" x2="366" y2="30"/>\n' +
        '        <text class="ax-premcap ax-premcap--wide" x="374" y="34">перевод ' + plain(M.premium).replace(/ /g, ' ') + ' ₸</text>\n' +
        '        <text class="ax-premcap ax-premcap--narrow" x="250" y="34" text-anchor="start">перевод ' + mlnT(M.premium) + '</text>\n';
      for (var t = 0; t <= top + step / 2; t += step) {
        out += '        <line class="ax-grid" x1="' + X0.toFixed(1) + '" y1="' + y(t).toFixed(1) + '" x2="' + X1.toFixed(1) + '" y2="' + y(t).toFixed(1) + '"/>\n' +
          '        <text class="ax-y" x="' + (X0 - 10).toFixed(1) + '" y="' + (y(t) + 4).toFixed(1) + '" text-anchor="end">' + mln(t) + '</text>\n';
      }
      var stepX = (X1 - X0) / ages.length, bw = Math.min(62, stepX * 0.62);
      ages.forEach(function (a, k) {
        var r = M.at(a), cx = X0 + stepX * (k + 0.5), yy = y(r.cum), h = Math.max(Y0 - yy, 3);
        var small = r.cum < M.premium, x = r.cum / M.premium;
        out += '        <g class="ax-col">\n' +
          '          <rect data-age="' + a + '" class="ax-bar ' + (small ? 'is-small' : 'is-big') + '" x="' + (cx - bw / 2).toFixed(1) + '" y="' + yy.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="7"><title>' + M.barTip(a) + '</title></rect>\n' +
          '          <text class="ax-sum ' + (small ? 'is-small' : 'is-big') + '" x="' + cx.toFixed(1) + '" y="' + (yy - 10).toFixed(1) + '" text-anchor="middle">' + mlnT(r.cum) + '</text>\n' +
          (h > 44
            ? '          <text class="ax-mult ax-mult--in" x="' + cx.toFixed(1) + '" y="' + (yy + 26).toFixed(1) + '" text-anchor="middle">' + X(x) + '</text>\n'
            : '          <text class="ax-mult ' + (small ? 'is-small' : 'is-big') + '" x="' + cx.toFixed(1) + '" y="' + (yy - 35).toFixed(1) + '" text-anchor="middle">' + X(x) + '</text>\n') +
          '          <text class="ax-x" x="' + cx.toFixed(1) + '" y="368" text-anchor="middle">' + Y(a) + '</text>\n' +
          '        </g>\n';
      });
      var yp = y(M.premium);
      out += '        <line class="ax-prem" x1="' + X0.toFixed(1) + '" y1="' + yp.toFixed(1) + '" x2="' + X1.toFixed(1) + '" y2="' + yp.toFixed(1) + '"/>\n' +
        '        <line class="ax-line" x1="' + X0.toFixed(1) + '" y1="' + Y0.toFixed(1) + '" x2="' + X1.toFixed(1) + '" y2="' + Y0.toFixed(1) + '"/>\n' +
        '        <line class="ax-line" x1="' + X0.toFixed(1) + '" y1="' + (Y1 - 16).toFixed(1) + '" x2="' + X0.toFixed(1) + '" y2="' + Y0.toFixed(1) + '"/>\n' +
        '        </svg>';
      return out;
    };

    /* ── Десятилетия ── */
    var ORD = ['первые', 'второе', 'третье', 'четвёртое', 'пятое', 'шестое', 'седьмое'];
    B.decades = function () {
      var max = Math.max.apply(null, M.decades.map(function (d) { return d.sum; }));
      var rows = M.decades.map(function (d, i) {
        var full = d.to - d.from === 9;
        var sub = i === 0 ? 'первые десять лет' : full ? (ORD[i] || (i + 1) + '-е') + ' десятилетие' : 'после ' + (d.from - 1 + 1) + ' лет';
        if (!full && i > 0) sub = 'с ' + d.from + ' до ' + d.to + ' лет';
        return '          <div class="decade">\n' +
          '            <div class="decade__head"><b>' + d.from + '–' + d.to + ' лет</b><span>' + sub + ' · ' + d.count + ' ' + word(d.count, 'выплата', 'выплаты', 'выплат') + '</span></div>\n' +
          '            <div class="decade__bar"><i style="width:' + r1(d.sum / max * 100) + '%"></i></div>\n' +
          '            <div class="decade__nums"><b class="num"><span class="cnt" data-count="' + d.sum + '">' + plain(d.sum).replace(/ /g, ' ') + '</span> ₸</b><span>в среднем ' + plain(d.sum / d.count).replace(/ /g, ' ') + ' ₸ в месяц · ' + Math.round(d.sum / M.total.cum * 100) + '% всех выплат</span></div>\n' +
          '          </div>';
      }).join('\n');
      return '      <div class="decades">\n' + rows + '\n      </div>';
    };

    /* ── Пока клиент ждёт старта: выплата индексируется (выплата на дату договора → первая выплата) ── */
    B.stairs = function () {
      if (!M.stairs.length) return '';
      var top = M.stairs[M.stairs.length - 1].v, many = M.stairs.length > 9;
      var bars = M.stairs.map(function (st, k) {
        var last = k === M.stairs.length - 1;
        return '          <div class="stair' + (last ? ' is-last' : '') + (k === 0 ? ' is-first' : '') + '" style="--h:' + r1(st.v / top * 100) + '%;--k:' + k + '">' +
          '<b class="num">' + nb(st.v) + '</b><i></i><span>' + st.age + '</span></div>';
      }).join('\n');
      return '    <article class="card wait-card">\n' +
        '      <div class="wait-card__head">\n        <div>\n' +
        '          <p class="eyebrow">Пока вы ждёте старта</p>\n' +
        '          <h3>Выплата растёт ещё до первой выплаты: +' + Math.round(M.waitGrowth * 100) + '%</h3>\n' +
        '          <p class="chart-note">Индексация +' + M.indPct + '% начисляется каждый год и в период ожидания. По калькулятору выплата на дату договора — ' + T(M.payNow) +
        ', а первая выплата ' + M.beginText + ' — уже ' + T(M.first) + '.</p>\n' +
        '        </div>\n' +
        '        <div class="wait-pair">\n' +
        '          <div><span>на дату договора</span><b class="num">' + T(M.payNow) + '</b></div>\n' +
        '          <i aria-hidden="true">' + ARROW + '</i>\n' +
        '          <div class="is-hi"><span>первая выплата · ' + M.beginMonth + '</span><b class="num">' + T(M.first) + '</b></div>\n' +
        '        </div>\n      </div>\n' +
        '      <div class="stairs' + (many ? ' stairs--many' : '') + '" role="img" aria-label="Выплата с индексацией: ' + plain(M.payNow) + ' тенге на дату договора, ' + plain(M.first) + ' тенге к первой выплате">\n' +
        bars + '\n      </div>\n' +
        '      <p class="stairs__cap">возраст · размер выплаты с учётом индексации, ₸ в месяц</p>\n' +
        '    </article>';
    };

    /* ── Почему порог именно такой: ПМ → минимальная выплата → порог ── */
    var INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16.5v-5.2M12 8.2h.01"/></svg>';
    B.why = function () {
      var nax = String(Math.round(M.nax * 10) / 10).replace('.', ',');
      return '        <div class="why">\n' +
        '          <p class="why__t"><span class="why__ic">' + INFO + '</span>Почему порог именно такой</p>\n' +
        '          <div class="why__flow">\n' +
        '            <div class="why__node"><span>Прожиточный минимум' + (M.pmYear ? ' ' + M.pmYear : '') + '</span><b class="num">' + T(M.pm) + '</b><small>в месяц, по закону</small></div>\n' +
        '            <span class="why__op">×' + NBSP + M.minPayPct + '%</span>\n' +
        '            <div class="why__node"><span>Минимальная выплата</span><b class="num">' + T(M.minPay) + '</b><small>в месяц — ниже нельзя</small></div>\n' +
        '            <span class="why__op">×' + NBSP + nax + '</span>\n' +
        '            <div class="why__node why__node--hi"><span>Порог оформления</span><b class="num">' + T(M.threshold) + '</b><small>столько стоит такая выплата пожизненно</small></div>\n' +
        '          </div>\n' +
        '          <p class="why__foot">' + nax + ' — аннуитетный фактор калькулятора: цена 1' + NBSP + '₸ ежемесячной выплаты пожизненно' +
        (M.gp > 0 ? ', с индексацией и гарантией ' + Y(M.gp) : ', с индексацией') + '.</p>\n' +
        '        </div>';
    };

    /* ── Где деньги год за годом: получено выплатами + выкупная сумма (остаток в договоре) ── */
    B.flow = function () {
      var F = M.flow, top = M.flowMax * 1.06, n = F.length;
      var pct = function (v) { return r1(Math.max(0, v) / top * 100); };
      var cols = F.map(function (f, k) {
        var cls = f.age < M.s0 ? 'is-pre' : f.recv >= M.premium ? 'is-back' : 'is-recv';
        if (f.lock) cls += ' is-lock';
        if (f.age === M.payback.age) cls += ' is-key';
        var sv = Math.max(0, f.lock ? f.would : f.surr), sum = sv + f.recv;
        // столбец = выкупная сумма (сверху) + получено (снизу); доли — внутри столбца
        return '          <div class="cf__col ' + cls + '" style="--k:' + k + '" data-age="' + f.age + '" data-year="' + f.year + '" data-recv="' + f.recv +
          '" data-surr="' + (f.lock ? '' : f.surr) + '" data-m="' + f.m + '"><span class="cf__bar" style="height:' + pct(sum) + '%">' +
          (sv > 0 ? '<i class="cf__s" style="flex:' + r1(sv / sum * 100) + ' 1 0"></i>' : '') +
          (f.recv > 0 ? '<i class="cf__r" style="flex:' + r1(f.recv / sum * 100) + ' 1 0"></i>' : '') + '</span></div>';
      }).join('\n');
      var axis = F.map(function (f, k) {
        var key = f.age === M.payback.age, start = f.age === M.s0 && !M.immediate;
        var minor = !key && !start && k % 2 === 1 && k !== n - 1;
        return '<span class="' + (key ? 'is-key' : start ? 'is-start' : minor ? 'is-minor' : '') + '">' + f.age +
          (key ? '<small>окупаемость</small>' : start ? '<small>старт</small>' : '') + '</span>';
      }).join('');
      return '        <div class="cf" style="--n:' + n + ';--prem:' + pct(M.premium) + '%" role="img" aria-label="Сумма перевода ' + plain(M.premium) +
        ' тенге: выкупная сумма ' + plain(M.surrBase) + ' тенге с ' + M.surrFromText + ', выплаты возвращают перевод ' + M.toYears(M.payback.age) + '">\n' +
        '          <div class="cf__plot">\n' +
        '          <span class="cf__prem"><em>сумма перевода · ' + T(M.premium) + '</em></span>\n' + cols + '\n          </div>\n' +
        '          <div class="cf__axis">' + axis + '</div>\n' +
        '        </div>';
    };

    /* ── Варианты гарантийного периода ── */
    B.alts = function () {
      var A = M.alts;
      if (!A || A.length < 2) return '';
      var cur = A.filter(function (a) { return a.cur; })[0] || A[A.length - 1];
      var opts = A.map(function (a) {
        var dv = a.value - cur.value, pc = cur.value ? dv / cur.value * 100 : 0;
        var delta = a.cur ? '<em class="alt__me">в вашем расчёте</em>'
          : '<em class="alt__d ' + ((M.free ? dv > 0 : dv < 0) ? 'is-good' : 'is-less') + '">' + (dv > 0 ? '+' : '−') + nb(Math.abs(dv)) + NBSP + '₸ · ' +
            (dv > 0 ? '+' : '−') + String(Math.abs(Math.round(pc * 10) / 10)).replace('.', ',') + '%</em>';
        return '          <div class="alt' + (a.cur ? ' is-cur' : '') + '"><span class="alt__gp">' + (a.gp ? 'гарантия ' + Y(a.gp) : 'без гарантии') + '</span>' +
          '<b class="num">' + T(a.value) + '</b><span class="alt__u">' + (M.free ? 'первая выплата в месяц' : 'порог оформления') + '</span>' + delta + '</div>';
      }).join('\n');
      return '      <article class="card cmp alts">\n' +
        '        <p class="eyebrow">Варианты гарантии</p>\n' +
        '        <h3>' + (M.free ? 'Как гарантия меняет выплату' : 'Как гарантия меняет порог') + '</h3>\n' +
        '        <p>' + (M.free ? 'Та же сумма перевода — первая выплата при разном гарантийном периоде.' : 'Та же минимальная выплата — сколько нужно для оформления при разном гарантийном периоде.') +
        ' Чем длиннее гарантия, тем больше выплат гарантировано близким.</p>\n' +
        '        <div class="alts__row' + (A.length > 3 ? ' alts__row--4' : '') + '">\n' + opts + '\n        </div>\n' +
        '      </article>';
    };

    /* ── WhatsApp: главная кнопка и быстрые вопросы рядом с агентом ── */
    function waIcon(cls) { return '<img class="' + cls + '" src="' + ICONS.wa + '" alt="" width="24" height="24">'; }
    var ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13"/><path d="m12 6 6 6-6 6"/></svg>';
    B.contactAsk = function () {
      if (!M.agentWa) return '';
      var q = M.askList.map(function (a) {
        return '          <a class="qbtn" href="' + E(M.waLink(a.msg)) + '" target="_blank" rel="noopener">' +
          '<span class="qbtn__ic">' + waIcon('wa-ic') + '</span><span class="qbtn__t">' + a.title + '</span>' +
          '<span class="qbtn__go">' + ARROW + '</span></a>';
      }).join('\n');
      return '      <div class="contact__ask">\n' +
        '        <a class="btn-wa" href="' + E(M.waLink('Здравствуйте! У меня вопрос по расчёту пенсионного аннуитета')) + '" target="_blank" rel="noopener">' +
        waIcon('wa-ic') + 'Написать в WhatsApp</a>\n' +
        '        <p class="contact__ask-note">или выберите вопрос — текст сообщения подставится сам</p>\n' +
        '        <div class="qlist">\n' + q + '\n        </div>\n      </div>';
    };

    /* ── Таблица выплат по годам (с ней работает и скрипт) ── */
    B.schedRows = function () {
      return M.rows.map(function (d) {
        var guar = M.gp > 0 && d.age <= M.guarLast.age;
        var cls = (guar ? 'is-guaranteed ' : '') + (d.age === M.payback.age ? 'is-payback' : '');
        var tag = M.gp > 0 && d.age === M.afterGuar ? '<span class="tag tag--b">гарантия завершена</span>'
          : guar ? '<span class="tag tag--g">гарантийный период</span>' : '<span class="tag tag--n">' + (M.gp > 0 ? 'после гарантии' : 'пожизненно') + '</span>';
        var left = d.surr === null ? '<span class="tag tag--n">пока недоступна</span>'
          : d.surr > 0 ? nb(d.surr) + NBSP + '₸'
          : d.age === M.payback.age ? '<span class="tag tag--l">сумма перевода вернулась</span>' : '<span class="sched-dash">—</span>';
        return '<tr class="' + cls.trim() + '" data-age="' + d.age + '" data-group="' + (guar ? 'guaranteed' : 'after') + '">' +
          '<td data-label="Возраст">' + d.age + '<i> ' + M.yearsWord(d.age) + '</i><small class="yr">' + M.yearOf(d.age) + '</small></td>' +
          '<td data-label="Период">' + tag + '</td>' +
          '<td data-label="В месяц, ₸">' + nb(d.m) + '</td>' +
          '<td data-label="За год, ₸">' + nb(d.y) + '</td>' +
          '<td data-label="Получено всего, ₸">' + nb(d.cum) + '</td>' +
          '<td data-label="Выкупная сумма">' + left + '</td></tr>';
      }).join('');
    };

    return B;
  }

  var api = { make: make, setIcons: function (i) { ICONS = i; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReportBlocks = api;
})(this);
