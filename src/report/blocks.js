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
      }).join('\n') + '\n        </div>' +
        /* возможный дивиденд — не доля суммы: отдельной строкой (правило продукта от 06.10.2026) */
        (M.divNote ? '\n        <p class="stack-note">' + M.divNote + '</p>' : '');
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
          (p.year ? '<em class="tl-year">' + p.year + NBSP + 'г.</em>' : '') + '<b>' + p.title + '</b><span>' + p.text + '</span></li>';
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
    /* сумма в ячейке: до миллиона — полностью, дальше «1,05 млн», чтобы влезало в ячейку */
    function cellSum(v) { return v < 1e6 ? nb(v) : String(Math.round(v / 1e4) / 100).replace('.', ',') + NBSP + 'млн'; }
    function waffleHead(sumLabel) {
      return '          <div class="waffle__head"><span class="waffle__year"></span>' +
        MON3.map(function (m) { return '<span class="waffle__mon">' + m + '</span>'; }).join('') +
        '<span class="waffle__sum">' + sumLabel + '</span></div>\n';
    }
    B.compare = function () {
      var cards = [];
      if (M.earlyYears > 0) {
        var rows = [], empty = [];
        /* годы договора до начала выплат ЕНПФ; в последнем неполном году — только месяцы до этой даты (M.early по датам) */
        M.early.rows.forEach(function (r) {
          var a = r.age, e = '', f = '';
          for (var k = 0; k < 12; k++) {
            if (k >= r.n) { e += '<i class="is-out" aria-hidden="true"></i>'; f += '<i class="is-out" aria-hidden="true"></i>'; continue; }
            e += '<i title="' + a + ' ' + M.yearsWord(a) + ' · ' + MON[k] + ' · в ЕНПФ выплат нет" data-age="' + a + '" data-mon="' + MON[k] + '" data-m3="' + MON3[k] + '" data-none="1"><b>0</b></i>';
            f += '<i title="' + a + ' ' + M.yearsWord(a) + ' · ' + MON[k] + ' · ' + plain(r.m) + ' ₸" data-age="' + a + '" data-mon="' + MON[k] + '" data-m3="' + MON3[k] + '" data-sum="' + plain(r.m) + ' ₸" data-year="' + plain(r.y) + ' ₸"><b>' + cellSum(r.m) + '</b></i>';
          }
          empty.push('          <div class="waffle__row"><span class="waffle__year">' + a + '</span>' + e + '<span class="waffle__sum">0' + NBSP + '₸</span></div>');
          rows.push('          <div class="waffle__row"><span class="waffle__year">' + a + '</span>' + f + '<span class="waffle__sum">' + nb(r.y) + NBSP + '₸</span></div>');
        });
        var n = M.early.payments, after = M.at(M.enpf);
        cards.push('      <article class="card cmp cmp--wide">\n' +
          '        <p class="eyebrow">Ранний старт</p>\n' +
          '        <h3>' + M.earlyTitle + '</h3>\n' +
          '        <p>В ЕНПФ деньги ждут ' + M.enpfGen + '. По аннуитету они приходят каждый месяц ' + (M.immediate ? 'сразу' : 'уже с ' + M.startNum) + '.</p>\n' +
          '        <p class="waffle-legend"><span class="waffle-legend__key"><i></i>в ячейке — выплата за месяц, ₸</span><span>строка — год, колонка — месяц</span><span>справа — сумма за год</span></p>\n\n' +
          '        <div class="cmp-split cmp-split--sums">\n          <div class="cmp-side">\n            <div class="cmp-side__head">\n' +
          '              <span class="cmp-side__tag">Если оставить в ЕНПФ</span>\n              <b class="cmp-side__big num">0' + NBSP + '₸</b>\n' +
          '              <span class="cmp-side__note">за ' + M.earlyText + ' — ' + (M.immediate ? 'с оформления' : 'с ' + M.startNum) + ' до ' + M.enpfGen + ' выплат нет</span>\n            </div>\n' +
          '            <div class="waffle waffle--sums waffle--zero">\n' + waffleHead('за год') + empty.join('\n') + '\n            </div>\n          </div>\n' +
          '          <div class="cmp-side cmp-side--ann">\n            <div class="cmp-side__head">\n' +
          '              <span class="cmp-side__tag">По вашему аннуитету</span>\n' +
          '              <b class="cmp-side__big num"><span class="cnt" data-count="' + M.early.cum + '">' + H(M.early.cum) + '</span>' + NBSP + '₸</b>\n' +
          /* срок — полные месяцы, а выплат может быть на одну больше (3 месяца и 22 дня — 4 выплаты): тогда без «за те же …» */
          '              <span class="cmp-side__note">придёт ' + (n === M.early.months ? 'за те же ' + M.earlyText : 'до начала выплат ЕНПФ') + ' — ' + n + ' ' + word(n, 'ежемесячная выплата', 'ежемесячные выплаты', 'ежемесячных выплат') + '</span>\n            </div>\n' +
          '            <div class="waffle waffle--sums">\n' + waffleHead('за год') + rows.join('\n') + '\n            </div>\n          </div>\n        </div>\n\n' +
          (after && after.age >= M.enpf
            ? '        <div class="cmp-next">\n          <b class="num">от ' + T(after.m) + '</b>\n' +
              '          <span>в месяц с ' + M.enpfGen + ' — и дальше выплаты продолжаются пожизненно, каждый год +' + M.indPct + '%</span>\n        </div>\n'
            : '') +
          '      </article>');
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

    /* ── По годам: сколько получено к каждому возрасту (отдельно от графика по десятилетиям) ──
       Два варианта рисунка: широкий и узкий для телефона — подписи читаются на любом экране. */
    function yearSvg(W, H, narrow) {
      var rows = M.rows, X0 = narrow ? 46 : 78, X1 = W - (narrow ? 8 : 14), Y1 = narrow ? 50 : 58, Y0 = H - (narrow ? 34 : 40);
      var vmax = rows[rows.length - 1].cum;
      var raw = vmax / 5, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), fr = raw / p;
      var step = (fr <= 1 ? 1 : fr <= 2 ? 2 : fr <= 2.5 ? 2.5 : fr <= 5 ? 5 : 10) * p;
      var top = Math.ceil(vmax * 1.04 / step) * step;
      var y = function (v) { return Y0 - v / top * (Y0 - Y1); };
      var mln = function (v) { if (!v) return '0'; var m = v / 1e6; return (m >= 10 ? String(Math.round(m)) : String(r1(m)).replace('.', ',')) + ' млн'; };
      var n = rows.length, stepX = (X1 - X0) / n, bw = Math.max(2.5, Math.min(22, stepX * 0.7));
      var cx = function (k) { return X0 + stepX * (k + 0.5); };
      var out = '        <svg class="yc ' + (narrow ? 'yc--narrow' : 'yc--wide') + '" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Сколько получено к каждому возрасту с ' + rows[0].age + ' до ' + rows[n - 1].age + ' лет; сумма перевода ' + plain(M.premium) + ' тенге возвращается ' + M.toYears(M.payback.age) + '">\n';
      for (var t = 0; t <= top + step / 2; t += step) {
        out += '        <line class="ax-grid" x1="' + X0 + '" y1="' + y(t).toFixed(1) + '" x2="' + X1 + '" y2="' + y(t).toFixed(1) + '"/>\n' +
          '        <text class="yc-y" x="' + (X0 - 8) + '" y="' + (y(t) + 4).toFixed(1) + '" text-anchor="end">' + mln(t) + '</text>\n';
      }
      var pk = -1;
      rows.forEach(function (r, k) {
        var small = r.cum < M.premium, yy = y(r.cum), h = Math.max(Y0 - yy, 1.5);
        if (r.age === M.payback.age) pk = k;
        out += '        <rect data-age="' + r.age + '" class="ax-bar ' + (small ? 'is-small' : 'is-big') + '" x="' + (cx(k) - bw / 2).toFixed(1) + '" y="' + yy.toFixed(1) +
          '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="' + Math.min(4, bw / 2).toFixed(1) + '" style="transition-delay:' + Math.round(k * 14) + 'ms"><title>' + M.barTip(r.age) + '</title></rect>\n';
        var every = narrow ? 10 : 5;
        if (k === 0 || (r.age % every === 0 && r.age - rows[0].age >= (narrow ? 4 : 3)) || k === n - 1 && r.age % every === 0)
          out += '        <text class="yc-x" x="' + cx(k).toFixed(1) + '" y="' + (Y0 + 18) + '" text-anchor="middle">' + r.age + '</text>\n';
      });
      var yp = y(M.premium);
      out += '        <line class="ax-prem" x1="' + X0 + '" y1="' + yp.toFixed(1) + '" x2="' + X1 + '" y2="' + yp.toFixed(1) + '"/>\n' +
        '        <text class="yc-cap" x="' + (X0 + 6) + '" y="' + (yp - 8).toFixed(1) + '">перевод ' + (narrow ? mln(M.premium).replace(' млн', NBSP + 'млн') : plain(M.premium)) + ' ₸</text>\n';
      if (pk >= 0) {
        var px = cx(pk), lx = Math.max(X0 + 40, Math.min(X1 - 40, px));
        out += '        <line class="yc-pb" x1="' + px.toFixed(1) + '" y1="' + (Y0 - 2) + '" x2="' + px.toFixed(1) + '" y2="' + (Y1 - 20) + '"/>\n' +
          '        <text class="yc-pbcap" x="' + lx.toFixed(1) + '" y="' + (Y1 - 26) + '" text-anchor="middle">окупаемость · ' + Y(M.payback.age) + '</text>\n';
      }
      out += '        <line class="ax-line" x1="' + X0 + '" y1="' + Y0 + '" x2="' + X1 + '" y2="' + Y0 + '"/>\n' +
        '        <text class="yc-unit" x="' + X1 + '" y="' + (H - 4) + '" text-anchor="end">возраст, лет</text>\n' +
        '        </svg>';
      return out;
    }
    B.yearChart = function () { return yearSvg(1000, 360, false) + '\n' + yearSvg(420, 300, true); };

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
        '            <div class="why__node"><span>Прожиточный минимум' + (M.pmYear ? ' ' + M.pmYear + NBSP + 'г.' : '') + '</span><b class="num">' + T(M.pm) + '</b><small>в месяц, по закону</small></div>\n' +
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

    /* ── Накоплений больше порога: переводить всё не обязательно, остаток — на жильё или лечение ── */
    B.rest = function () {
      var m = M.minimal;
      if (!m) return '';
      var onlyThr = m.premium === M.threshold;
      return '    <article class="card rest">\n' +
        '      <div class="rest__txt">\n' +
        '        <p class="eyebrow">Остаток в ЕНПФ</p>\n' +
        '        <h3>Переводить всё не обязательно</h3>\n' +
        '        <p>Минимум для договора — порог ' + T(M.threshold) + '. Остальное можно оставить в ЕНПФ: после договора аннуитета порог достаточности ЕНПФ на остаток не действует — его можно снять на жильё или лечение.</p>\n' +
        '      </div>\n' +
        '      <div class="rest__opts">\n' +
        '        <div class="rest__opt is-cur"><span class="rest__k">перевести всё</span><b class="num">' + T(M.premium) + '</b>' +
        '<small>первая выплата — от ' + T(M.first) + ' в месяц</small><em class="rest__me">в этом расчёте</em></div>\n' +
        '        <div class="rest__opt"><span class="rest__k">' + (onlyThr ? 'перевести только порог' : 'перевести минимум') + '</span><b class="num">' + T(m.premium) + '</b>' +
        '<small>первая выплата — от ' + T(m.first) + ' в месяц</small><em class="rest__plus"><b class="num">+' + NBSP + T(m.rest) + '</b> остаются в ЕНПФ — на жильё или лечение</em></div>\n' +
        '      </div>\n' +
        '      <p class="rest__foot">Можно выбрать и сумму между ними — агент пересчитает выплату.</p>\n' +
        '    </article>';
    };

    /* ── Пороги по категориям калькулятора: вредное производство и инвалидность снижают порог ── */
    B.cats = function () {
      var C = M.cats;
      if (!C || C.length < 2) return '';
      var own = M.catOwn, std = own.kind === 'std', money = M.catMoney;
      var top = Math.max.apply(null, C.map(function (c) { return c.threshold; }).concat([money])) * 1.03;
      var has = function (k) { return C.some(function (c) { return c.kind === k && !c.own; }); };
      var what = has('oppv') && has('inv') ? 'Вредное производство или инвалидность снижают' : has('oppv') ? 'Вредное производство снижает'
        : has('inv') ? 'Инвалидность снижает' : 'Льготная категория снижает';
      var higher = C.some(function (c) { return !c.own && c.first != null && c.first > M.first; });
      var save = M.catStd ? M.catStd.threshold - own.threshold : 0;
      var lede = std
        ? what + ' порог' + (higher ? ', а выплата при той же сумме выходит больше' : '') + '.'
        : (save > 0 ? 'Без льготы порог был бы ' + T(M.catStd.threshold) + ' — ваша категория снижает его на ' + T(save) + '.' : 'Порог зависит от категории клиента.');
      lede += ' Всё по калькулятору компании — для вашего возраста' + (M.gp > 0 ? ' и гарантии ' + Y(M.gp) : '') + '.';
      var mp = r1(money / top * 100);
      var head = '        <div class="cats__row cats__row--head"><span></span><span class="cats__track">' +
        (money > 0 ? '<em class="cats__mark' + (mp > 62 ? ' is-r' : mp < 38 ? ' is-l' : '') + '">' + M.catMoneyName + ' · ' + T(money) + '</em>' : '') +
        '</span><span class="cats__thr">порог</span><span class="cats__pay">первая выплата</span></div>';
      var rows = C.map(function (c) {
        var pay = c.own ? '<b class="num">' + T(c.first) + '</b><small class="cats__me">ваш расчёт</small>'
          : c.first != null ? '<b class="num">' + T(c.first) + '</b><small class="cats__ok">хватает</small>'
          : '<small class="cats__no">доплата ' + T(c.topup) + '</small>';
        return '        <div class="cats__row' + (c.own ? ' is-own' : '') + (c.enough ? ' is-ok' : '') + '">' +
          '<div class="cats__name"><b>' + E(c.label) + '</b><small>' + (c.hint ? E(c.hint) + ' · ' : '') + c.from + '</small></div>' +
          '<div class="cats__track"><i style="width:' + r1(c.threshold / top * 100) + '%"></i></div>' +
          '<div class="cats__thr"><b class="num">' + T(c.threshold) + '</b></div>' +
          '<div class="cats__pay">' + pay + '</div></div>';
      }).join('\n');
      var how = [];
      if (C.some(function (c) { return c.kind === 'oppv' && !c.own; })) how.push('вредное производство — выписка ЕНПФ, где видны ОППВ за 60 месяцев и больше');
      if (C.some(function (c) { return c.kind === 'inv' && !c.own; })) how.push('инвалидность — справка о социальном статусе с egov.kz');
      return '    <article class="card cats">\n' +
        '      <p class="eyebrow">' + (std ? 'Льготные категории' : 'Ваша категория') + '</p>\n' +
        '      <h3>' + (std ? 'Порог ниже, если есть льгота' : 'Льгота снижает порог') + '</h3>\n' +
        '      <p class="cats__lede">' + lede + '</p>\n' +
        '      <div class="cats__plot"' + (money > 0 ? ' style="--own:' + mp + '%"' : '') + '>\n' + head + '\n' + rows + '\n      </div>\n' +
        (how.length ? '      <p class="cats__foot"><b>Как подтвердить:</b> ' + how.join('; ') + '.' + (std ? ' Если льгота есть — скажите агенту, он пересчитает.' : '') + '</p>\n' : '') +
        '    </article>';
    };

    /* ── Документы для оформления ── */
    var DOC_IC = {
      id: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5.4" width="18" height="13.2" rx="2.6"/><circle cx="8.8" cy="11" r="2.1"/><path d="M5.6 15.8c.5-1.5 1.7-2.3 3.2-2.3s2.7.8 3.2 2.3"/><path d="M14.6 9.8h3.8M14.6 13.2h3.8"/></svg>',
      doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.6 3.2h6.6l5.2 5.2v12.4H6.6Z"/><path d="M13.2 3.2v5.2h5.2"/><path d="M9.6 13h6M9.6 16.4h6"/></svg>',
      bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3.6 9.2 8.4-5 8.4 5"/><path d="M5.6 9.8v7.4M9.9 9.8v7.4M14.1 9.8v7.4M18.4 9.8v7.4"/><path d="M3.4 20h17.2"/></svg>',
      pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4.2L19 9.2a2.6 2.6 0 0 0-3.7-3.7L4.5 16.3Z"/><path d="m13.6 7.2 3.7 3.7"/></svg>',
      cert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.6 3.2h6.6l5.2 5.2v12.4H6.6Z"/><path d="M13.2 3.2v5.2h5.2"/><path d="m9.4 14.4 2 2 3.8-4"/></svg>'
    };
    B.docs = function () {
      var kind = M.catOwn ? M.catOwn.kind : '';
      var D = [
        { ic: 'id', t: 'Удостоверение личности', n: 'копия' },
        { ic: 'doc', t: 'Выписка с пенсионного счёта', n: kind === 'oppv' ? 'из ЕНПФ — в ней видны ОППВ за 60 месяцев' : 'из ЕНПФ — сумма ваших накоплений' },
        { ic: 'bank', t: 'Банковские реквизиты', n: 'счёт с IBAN — на него придут выплаты' },
        { ic: 'pen', t: 'Заявление на договор', n: 'заполните вместе с агентом' }
      ];
      if (kind === 'inv') D.push({ ic: 'cert', t: 'Справка о социальном статусе', n: 'с egov.kz — подтверждает группу инвалидности' });
      return '    <article class="card docs">\n' +
        '      <div class="docs__head"><p class="eyebrow">Документы</p><h3>Что понадобится для оформления</h3></div>\n' +
        '      <ul class="docs__list docs__list--' + D.length + '">\n' + D.map(function (d) {
          return '        <li class="doc"><span class="doc__ic">' + DOC_IC[d.ic] + '</span><b>' + d.t + '</b><small>' + d.n + '</small></li>';
        }).join('\n') + '\n      </ul>\n' +
        '    </article>';
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
          '<td data-label="Возраст">' + d.age + '<i> ' + M.yearsWord(d.age) + '</i><small class="yr">' + M.yearOf(d.age) + NBSP + 'г.</small></td>' +
          '<td data-label="Период">' + tag + '</td>' +
          '<td data-label="В месяц, ₸">' + nb(d.m) + '</td>' +
          '<td data-label="За год, ₸">' + nb(d.y) + '</td>' +
          '<td data-label="Получено всего, ₸">' + nb(d.cum) + '</td>' +
          '<td data-label="Выкупная сумма">' + left + '</td></tr>';
      }).join('');
    };

    /* ════ «ЕНПФ или аннуитет» (раздел 08b-enpf): всё — в сегодняшних деньгах, данные — M.enpfCmp ════ */
    var V = M.enpfCmp;
    var EN_IC = {
      info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5h.01"/></svg>',
      scale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16M7 6.4h10"/><path d="M7 6.4 4.2 12.6h5.6ZM17 6.4l-2.8 6.2h5.6Z"/><path d="M8.6 20h6.8"/></svg>',
      check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.4 12.2 2.4 2.4 4.8-5"/></svg>'
    };
    /* число с ключом для сверки с библиотекой (см. report-model kv) */
    function K(key, v, f, cls, tag) { return V.kv(key, v, f, cls, tag); }
    function ageWord(a) { return a + NBSP + M.yearsWord(a); }
    function ageGen(a) { return a + NBSP + (a % 10 === 1 && a % 100 !== 11 ? 'года' : 'лет'); }

    /* возраст с дробью: 63 → «63 лет», 62,5 → «62,5 года» (после «с»/«до») */
    function ageGenX(a) {
      if (Math.abs(a - Math.round(a)) < 1e-9) return ageGen(Math.round(a));
      return String(r1(a)).replace('.', ',') + NBSP + 'года';
    }
    function ageWordX(a) { return Math.abs(a - Math.round(a)) < 1e-9 ? ageWord(Math.round(a)) : String(r1(a)).replace('.', ',') + NBSP + 'года'; }
    /* первый возраст без выплаты ЕНПФ (после последней строки таблицы ЕНПФ) */
    function enpfZeroAge() { var e = V.enpf; return e.lump || e.endExact == null ? null : Math.ceil(e.endExact + 1 - 1e-9); }

    /* ── Две карточки: что даёт каждый путь. ЕНПФ — ровно цифры калькулятора ЕНПФ ── */
    B.enpfCards = function () {
      var e = V.enpf, s = V.sl;
      var eBig = e.lump ? K('c.enpf.lump', e.lumpReal, 't', 'cmp-side__big') : K('c.enpf.first', e.firstReal, 't', 'cmp-side__big');
      var eNote = e.lump ? 'одной суммой ' + (e.retired ? 'сразу' : 'в ' + ageWord(e.start)) + ' · в ценах 2026' + NBSP + 'г.'
        : (V.fromCalc ? 'в месяц (ОПВ) · в ценах 2026' + NBSP + 'г. — как на enpf.kz' : 'в месяц · по формуле Правил выплат');
      var eList = [];
      if (!e.retired) eList.push('выход на пенсию по ЕНПФ — ' + e.startDateText + ' (' + ageWordX(e.startExact) + ')');
      if (e.lump) eList.push('накоплений к пенсии не больше 12 минимальных пенсий — ЕНПФ выплатит их сразу, ежемесячных выплат не будет');
      else if (e.years) eList.push('выплаты ' + e.rangeText + ', затем 0' + NBSP + '₸');
      if (V.fromCalc && !e.lump) {
        if (Math.abs(e.pes.monthly - e.opt.monthly) >= 1)
          eList.push('по сценариям калькулятора ЕНПФ — от ' + K('c.enpf.pes', e.pes.monthly, 't', '', 'span') + ' до ' + K('c.enpf.opt', e.opt.monthly, 't', '', 'span') + ' в месяц');
        else if (e.pes.years !== e.opt.years)
          eList.push('по сценариям калькулятора ЕНПФ — от ' + Y(e.pes.years) + ' до ' + Y(e.opt.years) + ' выплат');
      }
      if (!V.fromCalc) eList.push('размер назначает ЕНПФ по заявлению');
      eList.push('остаток на счёте наследуется полностью');
      if (V.live) eList.push('сверено с калькулятором ЕНПФ ' + V.live.dateText + ' — совпадает');
      var sList = [
        'выплаты ' + s.startText + (s.immediate ? ' после оформления' : ' (' + s.startDateText + ')') + ' — пожизненно',
        'по договору ' + K('c.sl.firstN', s.firstNominal, 't', '', 'span') + ' в месяц в ' + s.startYear + NBSP + 'г., дальше +' + M.pctNum(s.ind) + NBSP + '% каждый год',
        'размер и рост выплаты закреплены договором — от доходности не зависят'
      ];
      if (s.gp > 0) sList.push('гарантийный период ' + Y(s.gp) + ': невыплаченное за эти годы получат близкие');
      function list(L) { return '          <ul class="vs-list">\n' + L.map(function (t) { return '            <li>' + t + '</li>'; }).join('\n') + '\n          </ul>\n'; }
      return '    <article class="card cmp cmp--wide vs-split-card">\n' +
        '      <div class="cmp-split vs-split">\n' +
        '        <div class="cmp-side cmp-side--enpf">\n          <div class="cmp-side__head">\n' +
        '            <span class="cmp-side__tag">Если оставить в ЕНПФ</span>\n            ' + eBig + '\n' +
        '            <span class="cmp-side__note">' + eNote + '</span>\n          </div>\n' + list(eList) +
        '        </div>\n' +
        '        <div class="cmp-side cmp-side--ann">\n          <div class="cmp-side__head">\n' +
        '            <span class="cmp-side__tag">Если перевести в аннуитет Standard Life</span>\n            ' + K('c.sl.first', s.firstReal, 't', 'cmp-side__big') + '\n' +
        '            <span class="cmp-side__note">в месяц ' + s.startText + ' · в ценах 2026' + NBSP + 'г. (по договору — ' + K('c.sl.firstN2', s.firstNominal, 't', '', 'span') + ')</span>\n          </div>\n' + list(sList) +
        '        </div>\n      </div>\n    </article>';
    };

    /* ── Как проверить на enpf.kz: точный ввод и строки, которые надо читать ── */
    B.enpfCheck = function () {
      var e = V.enpf, kz = V.kszh;
      function li(L) { return L.map(function (t) { return '            <li>' + t + '</li>'; }).join('\n'); }
      var left;
      if (V.fromCalc) {
        var inputs = e.siteInputs.map(function (p) { return '«' + E(p[0]) + '» — <b>' + E(p[1]) + '</b>'; });
        var read = e.lump
          ? ['«В том числе: ОПВ» — <b>' + plain(e.lumpReal) + NBSP + '₸</b> (одна выплата)']
          : ['«В том числе: ОПВ» — <b>' + plain(e.firstReal) + NBSP + '₸</b> в месяц',
             '«Количество лет до исчерпания накоплений по ОПВ» — <b>' + e.years + '</b>',
             '«Возраст и дата выхода на пенсию» — <b>' + String(r1(e.startExact)).replace('.', ',') + ', ' + E(e.startDateText) + '</b>'];
        left = '        <div class="vs-check__col">\n          <h4>Прогнозный пенсионный калькулятор</h4>\n' +
          '          <p>enpf.kz → «Онлайн сервисы» → «Прогнозный пенсионный калькулятор». Введите:</p>\n          <ol>\n' + li(inputs) + '\n          </ol>\n' +
          '          <p>Нажмите «Рассчитать», на вопрос об изъятии ответьте «Нет». Сценарий «Реалистичный», «Без перевода в УИП». Смотрите:</p>\n          <ul>\n' + li(read) + '\n          </ul>\n' +
          '          <p class="vs-check__small">Цифры ЕНПФ — по калькулятору ЕНПФ на ' + V.calcDateText.replace(/\.$/, '') + '. Они зависят от даты расчёта (в другие дни могут отличаться на несколько тенге), а ЕНПФ может изменить методику расчёта. Если на enpf.kz сейчас другие цифры — попросите агента обновить расчёт.</p>\n' +
          '        </div>\n';
      } else {
        left = '        <div class="vs-check__col">\n          <h4>Выплата из ЕНПФ</h4>\n' +
          '          <p>Прогнозный калькулятор ЕНПФ не считает тех, кто уже достиг пенсионного возраста. Выплата посчитана по формуле Правил выплат: 6,5' + NBSP + '% накоплений в год, но не меньше 70' + NBSP + '% прожиточного минимума. Точный размер назначает ЕНПФ (1418).</p>\n' +
          '        </div>\n';
      }
      var right = '';
      if (kz) {
        var b = kz.body;
        var kin = ['«Пол» — <b>' + (b.sex === '1' ? 'Мужской' : 'Женский') + '</b>', '«Дата рождения» — <b>' + E(b.birthday) + '</b>',
          '«Общая сумма пенсионных накоплений / размер выплаты» — <b>пенсионные накопления, ' + plain(+b.totalPension) + '</b>',
          '«Гарантийный период» — <b>' + E(b.warrPeriod) + '</b>',
          '«Выбор договора пенсионного аннуитета» — <b>' + (b.pensann === '1' ? 'Отложенный аннуитет' : 'Немедленный аннуитет') + '</b>',
          '«Наличие уплаты ОППВ в совокупности не менее 60 календарных месяцев» — <b>' + (b.paymentOppv === '1' ? 'Да' : 'Нет') + '</b>',
          '«Возраст начала страховых (аннуитетных) выплат, лет» — <b>' + E(b.insStartDay) + '</b>',
          '«Группа инвалидности» — <b>' + ({ '1': 'Инв. 1 гр.', '2': 'Инв. 2 гр.', '3': 'Инв. 3 гр.' }[b.disability] || 'Нет') + '</b>'];
        right = '        <div class="vs-check__col">\n          <h4>Калькулятор аннуитета ЕНПФ</h4>\n' +
          '          <p>enpf.kz → «Калькулятор по расчёту страховой премии и страховой выплаты из страховой организации». Введите:</p>\n          <ol>\n' + li(kin) + '\n          </ol>\n' +
          '          <p>Покажет (в тенге, без пересчёта в «текущие цены»): первую выплату <b>' + plain(kz.firstPayment) + NBSP + '₸</b>' +
          (kz.threshold > +b.totalPension ? ' и минимальную сумму для договора <b>' + plain(kz.threshold) + NBSP + '₸</b>' : '') + '.</p>\n' +
          '        </div>\n';
      }
      return '    <article class="card vs-check">\n' +
        '      <div class="vs-check__head">\n        <p class="eyebrow">Проверьте сами</p>\n        <h3>Как проверить цифры ЕНПФ на enpf.kz</h3>\n' +
        '        <p>Будущие взносы не вводим (зарплата 1' + NBSP + '₸): они продолжают поступать в ЕНПФ в обоих вариантах и выплачиваются ЕНПФ отдельно. Если указать свою зарплату, ЕНПФ покажет больше — за счёт этих будущих взносов.</p>\n      </div>\n' +
        '      <div class="vs-check__cols">\n' + left + right + '      </div>\n    </article>';
    };

    /* ── Калькуляторы аннуитета на enpf.kz: их точные цифры и чем они отличаются от нашего договора ── */
    B.enpfAnnuityCalc = function () {
      var kz = V.kszh, offer = V.offer, s = V.sl, parts = [];
      if (kz) {
        var v = kz.vsSl || {}, d = Math.round(kz.firstPayment - s.firstNominal);
        var p = 'Для такого же договора калькулятор аннуитета ЕНПФ покажет первую выплату ' + K('a.kszh.first', kz.firstPayment, 't', '', 'span') +
          ' с ' + E(kz.firstPeriod) + ' (у нас — ' + K('a.sl.first', s.firstNominal, 't', '', 'span') + ' с ' + s.startDateText + ')';
        if (kz.threshold > s.premium) p += ', причём посчитает её на сумму ' + K('a.kszh.prem', kz.threshold, 't', '', 'span') + ' — это его минимум для такого договора (у нас договор на ' + K('a.sl.prem', s.premium, 't', '', 'span') + ')';
        p += '. ';
        if (d > 0) {
          p += 'Это на ' + K('a.diff', d, 't', '', 'span') + ' больше нашей первой выплаты. ';
          var ma = v.enpfMonthlyAhead, ca = v.enpfCumAhead;
          p += 'Но у ЕНПФ выплата растёт на 7' + NBSP + '% в год, у нас — на ' + M.pctNum(s.ind) + NBSP + '%' +
            (ma ? ': ежемесячная выплата по нашему договору больше с ' + ageGenX(ma.toAge + 1) : '') + '. ' +
            (ca ? 'По сумме полученного ЕНПФ впереди с ' + ca.fromAge + ' до ' + ageGenX(ca.toAge + 1) + ', дальше — наш договор.' : 'По сумме полученного наш договор впереди всё время.');
        } else if (d < 0) {
          p += 'Наша первая выплата больше на ' + K('a.diff', -d, 't', '', 'span') + ' и растёт быстрее: +' + M.pctNum(s.ind) + NBSP + '% в год против 7' + NBSP + '%.';
        } else p += 'Первые выплаты равны; наша растёт быстрее: +' + M.pctNum(s.ind) + NBSP + '% в год против 7' + NBSP + '%.';
        parts.push(p);
        parts.push('Почему цифры отличаются: калькулятор ЕНПФ считает по параметрам до 2026' + NBSP + 'г. — доходность 8' + NBSP + '%, индексация 7' + NBSP + '%; по действующей Методике АРРФР №' + NBSP + '45 (ред. 27.01.2026) индексация — не ниже 8' + NBSP + '%, по ней считает Standard Life. ' +
          'Кроме того, у калькулятора ЕНПФ договор начинается со следующего дня рождения (' + kz.contractYear + NBSP + 'г.), и минимальную выплату он берёт по прожиточному минимуму того года.');
      }
      if (offer && offer.monthly > 0) {
        parts.push('Прогнозный калькулятор ЕНПФ после расчёта сам предложит «пожизненный аннуитет»: ' + K('a.offer', offer.monthly, 't', '', 'span') + ' в месяц с ' + ageGenX(offer.fromAge) +
          ' (в ценах 2026' + NBSP + 'г., дальше +2' + NBSP + '% в год). Это аннуитет, купленный в возрасте ' + ageWordX(offer.fromAge) + ' на накопления, выросшие к тому времени в ЕНПФ; по нашему договору выплаты идут ' + s.startText + '.');
      }
      if (!parts.length) return '';
      return '    <article class="card vs-kszh">\n' +
        '      <p class="eyebrow">Калькуляторы аннуитета на enpf.kz</p>\n' +
        '      <h3>Что покажет ЕНПФ про аннуитет</h3>\n' +
        parts.map(function (t) { return '      <p>' + t + '</p>'; }).join('\n') + '\n    </article>';
    };

    /* ── Графики: в месяц и нарастающим итогом (широкий и узкий рисунок, как «По годам») ── */
    function niceTop(v, n) {
      var raw = Math.max(v, 1) / n, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), fr = raw / p;
      var step = (fr <= 1 ? 1 : fr <= 2 ? 2 : fr <= 2.5 ? 2.5 : fr <= 5 ? 5 : 10) * p;
      return { step: step, top: Math.ceil(v * 1.06 / step) * step || step };
    }
    function axisMoney(v, cum) {
      if (!v) return '0';
      if (cum || v >= 1e6) { var m = v / 1e6; return (m >= 10 ? String(Math.round(m)) : String(r1(m)).replace('.', ',')) + ' млн'; }
      return Math.round(v / 1e3) + ' тыс';
    }
    /* подпись значения на графике: всегда с десятыми — «13,1 млн», чтобы близкие суммы не сливались */
    function capMln(v) { return String(Math.round(v / 1e5) / 10).replace('.', ',') + ' млн'; }
    function vsSvg(kind, W, H, narrow) {
      var S = V.series, cum = kind === 'cum';
      var a0 = S[0].age, a1 = S[S.length - 1].age;
      var X0 = narrow ? 46 : 62, X1 = W - (narrow ? 8 : 14), Y1 = narrow ? 46 : 50, Y0 = H - (narrow ? 30 : 34);
      var key = cum ? { s: 'sc', e: 'ec', p: 'ecp', o: 'eco' } : { s: 's', e: 'e', p: 'ep', o: 'eo' };
      var vmax = 0;
      S.forEach(function (r) { vmax = Math.max(vmax, r[key.s], r[key.e], r[key.p], r[key.o]); });
      var sc = niceTop(vmax, narrow ? 4 : 5);
      var x = function (a) { return X0 + (a - a0) / (a1 + 1 - a0) * (X1 - X0); };
      var y = function (v) { return Y0 - v / sc.top * (Y0 - Y1); };
      var f1 = function (v) { return v.toFixed(1); };
      var refRow = S.filter(function (r) { return r.age === V.refAge; })[0];
      var aria = cum
        ? 'Получено всего к возрасту, в ценах 2026 года' + (refRow ? ': к ' + V.refAge + ' годам аннуитет ' + plain(refRow.sc) + ' тенге, ЕНПФ ' + plain(refRow.ec) + ' тенге' : '')
        : 'Выплата в месяц, в ценах 2026 года: аннуитет ' + V.sl.startText + ' пожизненно, ЕНПФ ' + V.enpf.rangeText;
      var out = '        <svg class="vs-svg ' + (narrow ? 'vs-svg--narrow' : 'vs-svg--wide') + '" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + aria + '">\n';
      for (var t = 0; t <= sc.top + sc.step / 2; t += sc.step) {
        out += '        <line class="vs-grid' + (t ? '' : ' vs-grid--0') + '" x1="' + X0 + '" y1="' + f1(y(t)) + '" x2="' + X1 + '" y2="' + f1(y(t)) + '"/>\n' +
          '        <text class="vs-y" x="' + (X0 - 7) + '" y="' + f1(y(t) + 4) + '" text-anchor="end">' + axisMoney(t, cum) + '</text>\n';
      }
      var every = narrow ? 10 : 5;
      S.forEach(function (r, k) {
        if (k === 0 || (r.age % every === 0 && r.age - a0 >= (narrow ? 4 : 3)))
          out += '        <text class="vs-x" x="' + f1(x(r.age)) + '" y="' + (Y0 + 18) + '" text-anchor="middle">' + r.age + '</text>\n';
      });
      /* линии: в месяц — ступеньки (выплата постоянна весь год), итог — точки на конец каждого года */
      function stepPath(get) {
        var d = '', on = false;
        S.forEach(function (r) {
          var v = get(r);
          if (v > 0.5) {
            d += (on ? 'L' : 'M') + f1(x(r.age)) + ' ' + f1(y(v)) + 'L' + f1(x(r.age + 1)) + ' ' + f1(y(v));
            on = true;
          } else if (on) { d += 'L' + f1(x(r.age)) + ' ' + f1(y(0)); on = false; }
        });
        return d;
      }
      function cumPath(get) {
        var d = 'M' + f1(x(a0)) + ' ' + f1(y(0));
        S.forEach(function (r) { d += 'L' + f1(x(r.age + 1)) + ' ' + f1(y(get(r))); });
        return d;
      }
      var band = '';
      if (cum) {
        var up = 'M' + f1(x(a0)) + ' ' + f1(y(0)), dn = '';
        S.forEach(function (r) { up += 'L' + f1(x(r.age + 1)) + ' ' + f1(y(Math.max(r.ecp, r.eco))); });
        for (var j = S.length - 1; j >= 0; j--) dn += 'L' + f1(x(S[j].age + 1)) + ' ' + f1(y(Math.min(S[j].ecp, S[j].eco)));
        band = up + dn + 'L' + f1(x(a0)) + ' ' + f1(y(0)) + 'Z';
      } else {
        S.forEach(function (r) {
          var hi = Math.max(r.ep, r.eo), lo = Math.min(r.ep, r.eo);
          if (hi > 0.5) band += 'M' + f1(x(r.age)) + ' ' + f1(y(hi)) + 'L' + f1(x(r.age + 1)) + ' ' + f1(y(hi)) + 'L' + f1(x(r.age + 1)) + ' ' + f1(y(lo)) + 'L' + f1(x(r.age)) + ' ' + f1(y(lo)) + 'Z';
        });
      }
      if (band) out += '        <path class="vs-band" d="' + band + '"/>\n';
      var sPath = cum ? cumPath(function (r) { return r.sc; }) : stepPath(function (r) { return r.s; });
      if (sPath) {
        var sFrom = cum ? x(a0) : x(Math.max(a0, V.sl.start));
        out += '        <path class="vs-area" d="' + sPath + 'L' + f1(x(a1 + 1)) + ' ' + f1(y(0)) + 'L' + f1(sFrom) + ' ' + f1(y(0)) + 'Z"/>\n' +
          '        <path class="vs-sl" d="' + sPath + '"/>\n';
      }
      var ePath = cum ? cumPath(function (r) { return r.ec; }) : stepPath(function (r) { return r.e; });
      if (ePath) out += '        <path class="vs-enpf" d="' + ePath + '"/>\n';
      /* отметки: старт аннуитета, старт ЕНПФ, конец выплат ЕНПФ */
      var marks = [];
      if (V.sl.start >= a0) marks.push({ a: V.sl.start, cls: 'vs-mark--sl', t: (narrow ? 'аннуитет · ' : 'аннуитет: старт · ') + V.sl.startLabel });
      if (V.enpf.start >= a0) marks.push({ a: V.enpf.start, cls: 'vs-mark--enpf', t: (V.enpf.lump ? (narrow ? 'ЕНПФ разово · ' : 'ЕНПФ: одной суммой · ') : (narrow ? 'ЕНПФ · ' : 'ЕНПФ: старт · ')) + V.enpf.startLabel });
      var z = enpfZeroAge();
      if (z != null && z <= a1) marks.push({ a: z, cls: 'vs-mark--enpf', t: narrow ? 'ЕНПФ: 0 · ' + z : 'ЕНПФ: выплаты закончились · ' + z });
      marks.sort(function (p, q) { return p.a - q.a; });
      marks.forEach(function (m, k) {
        var mx = x(m.a), ty = Y1 - 30 + (k % 2) * 14, right = mx > X0 + (X1 - X0) * 0.62;
        out += '        <line class="vs-mark ' + m.cls + '" x1="' + f1(mx) + '" y1="' + f1(ty + 4) + '" x2="' + f1(mx) + '" y2="' + Y0 + '"/>\n' +
          '        <text class="vs-mcap ' + m.cls + '" x="' + f1(mx + (right ? -5 : 5)) + '" y="' + f1(ty) + '" text-anchor="' + (right ? 'end' : 'start') + '">' + m.t + '</text>\n';
      });
      if (cum && refRow) {
        var rx = x(V.refAge + 1), ys = y(refRow.sc), ye = y(refRow.ec), slUp = ys <= ye, gap = Math.abs(ys - ye) < 18;
        out += '        <circle class="vs-dot vs-dot--sl" cx="' + f1(rx) + '" cy="' + f1(ys) + '" r="4.5"/>\n' +
          '        <circle class="vs-dot vs-dot--enpf" cx="' + f1(rx) + '" cy="' + f1(ye) + '" r="4.5"/>\n' +
          '        <text class="vs-vcap vs-vcap--sl" x="' + f1(rx - 8) + '" y="' + f1(slUp ? ys - 9 : ys + 17 + (gap ? 6 : 0)) + '" text-anchor="end">' + capMln(refRow.sc) + '</text>\n' +
          '        <text class="vs-vcap vs-vcap--enpf" x="' + f1(rx - 8) + '" y="' + f1(slUp ? ye + 17 + (gap ? 6 : 0) : ye - 9) + '" text-anchor="end">' + capMln(refRow.ec) + '</text>\n';
      }
      /* поле подсказки: возраст под курсором считает скрипт КП, цифры — CFG.enpf (без скрипта — общая подпись) */
      out += '        <rect class="vs-hit" x="' + X0 + '" y="' + Y1 + '" width="' + (X1 - X0) + '" height="' + (Y0 - Y1) + '" data-a0="' + a0 + '" data-a1="' + a1 +
        '"><title>' + (cum ? 'Получено всего к возрасту' : 'Выплата в месяц') + ', в сегодняшних деньгах: аннуитет — зелёная линия, ЕНПФ — пунктир</title></rect>\n';
      out += '        <line class="vs-axis" x1="' + X0 + '" y1="' + Y0 + '" x2="' + X1 + '" y2="' + Y0 + '"/>\n' +
        (narrow ? '' : '        <text class="vs-unit" x="' + X1 + '" y="' + (H - 4) + '" text-anchor="end">возраст, лет</text>\n') +
        '        </svg>';
      return out;
    }
    B.enpfChart = function (kind) { return vsSvg(kind, 560, 330, false) + '\n' + vsSvg(kind, 420, 300, true); };

    /* ── Таблица по возрастам ── */
    B.enpfTable = function () {
      var rows = V.table.map(function (r) {
        var eCell = r.enpfLump > 0 ? '<span class="vs-tab__lump">одной суммой</span>'
          : r.enpfM > 0.5 ? K('t.' + r.age + '.em', r.enpfM, 't') : '<span class="vs-tab__none">—</span>';
        var sCell = r.slM > 0.5 ? K('t.' + r.age + '.sm', r.slM, 't') + '<small>' + K('t.' + r.age + '.smn', r.slMN, 't', '', 'span') + ' по договору</small>' : '<span class="vs-tab__none">—</span>';
        return '          <tr' + (r.key ? ' class="is-key"' : '') + '><td>' + ageWord(r.age) + '</td>' +
          '<td class="is-enpf" data-label="ЕНПФ в месяц">' + eCell + '</td><td class="is-enpf" data-label="ЕНПФ: получено всего">' + K('t.' + r.age + '.ec', r.enpfCum, 't') + '</td>' +
          '<td class="is-ann" data-label="Аннуитет в месяц">' + sCell + '</td><td class="is-ann" data-label="Аннуитет: получено всего">' + K('t.' + r.age + '.sc', r.slCum, 't') + '</td></tr>';
      }).join('\n');
      return '      <div class="vs-scroll"><table class="vs-tab">\n' +
        '        <thead><tr><th rowspan="2">Возраст</th><th colspan="2" class="is-enpf">Оставить в ЕНПФ</th><th colspan="2" class="is-ann">Аннуитет Standard Life</th></tr>\n' +
        '          <tr><th class="is-enpf">в месяц</th><th class="is-enpf">получено всего</th><th class="is-ann">в месяц</th><th class="is-ann">получено всего</th></tr></thead>\n' +
        '        <tbody>\n' + rows + '\n        </tbody>\n' +
        '      </table></div>';
    };

    /* ── Три факта ── */
    B.enpfFacts = function () {
      var f = [], e = V.enpf, s = V.sl;
      if (V.early > 0) f.push('<div class="fact"><b>на ' + V.earlyText + '</b><span>раньше начинаются выплаты: ' + s.startText + ', а не ' + e.startText + '</span></div>');
      /* клиент уже достиг пенсионного возраста ЕНПФ: выигрыша во времени нет — так и пишем, а не «на 0 лет раньше» */
      else f.push('<div class="fact"><b>' + s.startText + '</b><span>начинаются выплаты аннуитета' +
        (e.retired ? (V.early === 0 ? ' — ЕНПФ тоже платит сразу: пенсионный возраст уже наступил' : '; ЕНПФ платит сразу: пенсионный возраст уже наступил')
          : V.early === 0 ? ' — как и в ЕНПФ' : '') + '</span></div>');
      f.push('<div class="fact"><b>пожизненно</b><span>платит аннуитет; ЕНПФ — ' + (e.lump ? 'одной суммой' : e.years ? Y(e.years) + (V.fromCalc ? ' (по калькулятору ЕНПФ)' : ' (по формуле Правил)') : '—') + '</span></div>');
      var ahead = V.diff >= 0;
      f.push('<div class="fact' + (ahead ? ' fact--accent' : '') + '">' + K('f.diff', Math.abs(V.diff), 'm') +
        '<span>' + (ahead ? 'больше получите по аннуитету' : 'больше даст ЕНПФ') + ' к ' + V.refAge + ' годам — в ценах 2026' + NBSP + 'г.' +
        /* взнос клиента входит только в аннуитет: без оговорки разница выглядела бы чистым выигрышем */
        (s.topUp > 0 ? (ahead ? ', до вычета вашего взноса ' : '; ваш взнос ') + K('v.topup', s.topUp, 't', '', 'span') + (ahead ? '' : ' остаётся у вас и сюда не входит') : '') +
        '</span></div>');
      return '    <div class="facts-strip vs-facts">\n      ' + f.join('\n      ') + '\n    </div>';
    };

    /* ── Если клиента не станет: по аннуитету — суммы договора; по ЕНПФ — остаток наследуется полностью (сумм ЕНПФ не показывает) ── */
    B.enpfInherit = function () {
      var I = V.inherit, s = V.sl;
      var top = Math.max.apply(null, I.map(function (r) { return r.sl || 0; }).concat([1]));
      var rows = I.map(function (r) {
        return '        <div class="vs-inh__row vs-inh__row--sl">' +
          '<span class="vs-inh__age">' + ageWord(r.age) + (r.now ? '<small>сейчас</small>' : '') + '</span>' +
          '<span class="vs-inh__cell is-ann"><i style="width:' + r1((r.sl || 0) / top * 100) + '%"></i>' + K('i.' + r.age + '.s', r.sl || 0, 't') + '</span></div>';
      }).join('\n');
      var how = (s.immediate ? '' : 'до начала выплат — выкупная сумма, ') +
        (s.gp > 0 ? 'после старта — невыплаченные выплаты гарантийного периода (' + Y(s.gp) + '), после него — ничего'
                  : 'после старта — ничего (гарантийный период не выбран)');
      return '    <article class="card vs-inh">\n' +
        '      <div class="vs-inh__head">\n        <p class="eyebrow">Если вас не станет</p>\n        <h3>Что достанется близким</h3>\n' +
        '        <p>В ЕНПФ весь остаток на счёте наследуется полностью. По аннуитету ' + how + '; кроме того, близким — выплата на погребение не меньше 35 МРП (' +
        K('i.burial', s.burial, 't', '', 'span') + '). Суммы по аннуитету — по договору, в тенге.' +
        (s.topUp > 0 ? ' В варианте ЕНПФ ваш взнос ' + K('i.topup', s.topUp, 't', '', 'span') + ' остаётся у вас и тоже достанется близким.' : '') +
        '</p>\n      </div>\n' +
        '      <div class="vs-inh__rows">\n' +
        '        <div class="vs-inh__row vs-inh__row--head vs-inh__row--sl"><span>возраст</span><span class="is-ann">по аннуитету получат близкие</span></div>\n' +
        rows + '\n      </div>\n' +
        '    </article>';
    };

    /* ── Как посчитано: допущения и источники ── */
    B.enpfNotes = function () {
      return '    <div class="note-card vs-notes">\n' +
        '      <span class="note-card__ic">' + EN_IC.info + '</span>\n' +
        '      <div>\n        <b>Как посчитано</b>\n        <ol>\n' +
        V.notes.map(function (n) { return '          <li>' + n + '</li>'; }).join('\n') +
        '\n        </ol>\n      </div>\n    </div>';
    };
    B.enpfIcon = function (k) { return EN_IC[k] || ''; };

    /* ── Слепок: что показывал ЕНПФ на дату расчёта (запросы и цифры) — невидимые данные в КП, для подтверждения позже ── */
    B.enpfSnapshot = function () {
      if (!V.snapshot) return '';
      return '    <script type="application/json" id="enpf-snapshot">' + JSON.stringify(V.snapshot).replace(/</g, '\\u003c') + '</script>';
    };

    return B;
  }

  var api = { make: make, setIcons: function (i) { ICONS = i; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReportBlocks = api;
})(this);
