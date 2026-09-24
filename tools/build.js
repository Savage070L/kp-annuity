#!/usr/bin/env node
/*
 * Сборка генератора КП.
 *   dist/report-kit.js — всё, что нужно для отчёта: расчёт, модель, шаблоны, стили, скрипты
 *   index.html         — страница генератора (одним файлом, работает без интернета)
 */
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var SRC = path.join(ROOT, 'src');
var REP = path.join(SRC, 'report');
function read(p) { return fs.readFileSync(p, 'utf8'); }

/* разделы отчёта → функции-шаблоны */
function sectionsJs() {
  var files = fs.readdirSync(path.join(REP, 'sections')).filter(function (f) { return /\.html$/.test(f); }).sort();
  var fns = files.map(function (f) {
    var html = read(path.join(REP, 'sections', f));
    if (html.indexOf('`') >= 0) throw new Error('обратная кавычка в ' + f);
    return '  /* ' + f + ' */\n  function (M, B, T, H, Y, X, E) { return `' + html + '`; }';
  });
  return '[\n' + fns.join(',\n') + '\n]';
}

function kit() {
  var icons = read(path.join(REP, 'icons.json'));
  var blocks = read(path.join(REP, 'blocks.js')).replace('/*@ICONS*/{}/*@END*/', icons.trim());
  var mort = read(path.join(SRC, 'mort-compact.json')).trim();
  var parts = {
    head: read(path.join(REP, 'head.html')),
    tail: read(path.join(REP, 'tail.html')),
    fonts: read(path.join(REP, 'fonts.css')),
    styles: read(path.join(REP, 'styles.css')),
    wave: read(path.join(REP, 'wavepanel.js')),
    app: read(path.join(REP, 'app.js'))
  };
  // тексты вставок — в JSON, чтобы кавычки и переводы строк не ломали код
  var assets = JSON.stringify(parts);
  return [
    '/* Генератор КП «Пенсионный аннуитет» — собрано tools/build.js, руками не править */',
    read(path.join(SRC, 'engine.js')),
    read(path.join(SRC, 'xlsx.js')),
    read(path.join(SRC, 'formula.js')),
    read(path.join(SRC, 'calc-xlsx.js')),
    read(path.join(SRC, 'report-model.js')),
    blocks,
    '(function (root) {',
    '  "use strict";',
    '  var MORT = ' + mort + ';',
    '  var ASSETS = ' + assets + ';',
    '  var SECTIONS = ' + sectionsJs() + ';',
    '  /* calc — результат AnnuityEngine.compute; snapshots — снимки графиков для просмотра без скриптов */',
    '  function render(calc, client, agent, snapshots) {',
    '    var RM = root.ReportModel;',
    '    var M = RM.build(calc, client, agent);',
    '    var B = root.ReportBlocks.make(M);',
    '    if (snapshots) B.snapshots = snapshots;',
    '    var body = SECTIONS.map(function (fn) { return fn(M, B, M.tenge, M.moneyH, M.years, M.times, M.esc); }).join("");',
    '    var app = ASSETS.app.replace(/\\/\\*@CFG\\*\\/[\\s\\S]*?\\/\\*@END\\*\\//, JSON.stringify(M.cfg).replace(/</g, "\\\\u003c"));',
    '    var head = ASSETS.head.replace("<title>Пенсионный аннуитет — персональный расчёт</title>",',
    '      "<title>Пенсионный аннуитет — расчёт для " + M.esc(M.nameGen) + "</title>");',
    '    return head + "<style>" + ASSETS.fonts + "</style>\\n<style>" + ASSETS.styles + "</style>\\n</head>\\n<body>" + body +',
    '      "<script>" + ASSETS.wave + "</script>\\n<script>" + app + "</script>" + ASSETS.tail;',
    '  }',
    '  /* расчёт для КП: основной сценарий + варианты гарантии и порог через год (тем же калькулятором) */',
    '  function plan(input, engine) {',
    '    var run = function (inp, lite) { return engine ? engine.compute(inp, { lite: lite }) : root.AnnuityEngine.compute(inp, MORT); };',
    '    var calc = run(input, false);',
    '    if (!calc || (calc.errors && calc.errors.length) || !calc.rows) return calc;',
    '    try {',
    '      var max = calc.tariff.maxGuarantee, gps = [0, 5, 10];',
    '      if (gps.indexOf(calc.guarantee) < 0) gps.push(calc.guarantee);',
    '      gps = gps.filter(function (g) { return max == null || g <= max; }).sort(function (a, b) { return a - b; });',
    '      calc.alts = gps.map(function (g) {',
    '        var r = g === calc.guarantee ? calc : run(Object.assign({}, input, { guarantee: g }), true);',
    '        return { gp: g, first: r.first, threshold: r.threshold, premium: r.premium, topup: r.topup, mode: r.mode };',
    '      });',
    '      var d = root.AnnuityEngine.parseDate(input.calcDate);',
    '      var nx = run(Object.assign({}, input, { calcDate: root.AnnuityEngine.isoDate(new Date(d.getFullYear() + 1, d.getMonth(), d.getDate())) }), true);',
    '      if (nx && !(nx.errors && nx.errors.length)) calc.next = { threshold: nx.threshold, first: nx.first };',
    '    } catch (e) { /* варианты — дополнение, без них КП тоже соберётся */ }',
    '    return calc;',
    '  }',
    '  root.ReportKit = { render: render, plan: plan, model: function (c, cl, ag) { return root.ReportModel.build(c, cl, ag); },',
    '    compute: function (input) { return root.AnnuityEngine.compute(input, MORT); }, MORT: MORT,',
    '    loadCalculator: function (bytes, name, inflate) { return root.XlsxCalculator.load(bytes, name, inflate); },',
    '    tariff: root.AnnuityEngine.TARIFF, categories: Object.keys(root.AnnuityEngine.CATEGORIES),',
    '    fonts: ASSETS.fonts, genitive: root.ReportModel.genitiveName, dateRu: root.ReportModel.dateRu };',
    '})(typeof window !== "undefined" ? window : globalThis);',
    ''
  ].join('\n');
}

var out = kit();
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'report-kit.js'), out);
console.log('dist/report-kit.js', Math.round(Buffer.byteLength(out) / 1024), 'КБ');

var genTpl = path.join(SRC, 'generator.html');
if (fs.existsSync(genTpl)) {
  var page = read(genTpl).replace('<!--@KIT-->', function () { return '<script>' + out.replace(/<\/script/gi, '<\\/script') + '</script>'; });
  fs.writeFileSync(path.join(ROOT, 'index.html'), page);
  console.log('index.html', Math.round(Buffer.byteLength(page) / 1024), 'КБ');
}
