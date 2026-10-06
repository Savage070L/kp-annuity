#!/usr/bin/env node
/*
 * Копирует библиотеку «Калькулятор ЕНПФ» в генератор КП и приводит её к стилю генератора.
 *
 *   node tools/sync-enpf.js                 — источник по умолчанию: ~/Downloads/Калькулятор ЕНПФ/lib
 *   ENPF_LIB=/путь/к/lib node tools/sync-enpf.js
 *   node tools/sync-enpf.js --check         — только проверить, что src/enpf совпадает с библиотекой (код 1, если нет)
 *
 * Библиотека — ES-модули (import/export), а генератор — обычные скрипты, которые tools/build.js склеивает
 * в один файл. Поэтому каждый модуль оборачивается в функцию, а import/export заменяются реестром
 * window.EnpfLib (в Node — globalThis.EnpfLib):
 *   import { a, b as c } from './x.js'  →  const { a, b: c } = __EL.require('x.js');
 *   import X from './data/y.js'         →  const X = __EL.require('data/y.js').default;
 *   export function f / export const k →  function f / const k   (имена — в __EL.define('модуль', {...}))
 *   export default {...}                →  const __default = {...}
 *   export { A, B }                     →  только в список экспортов
 * Код модулей не меняется ни в одном символе, кроме этих строк: исправления вносить в библиотеку и запускать
 * этот скрипт снова. Порядок файлов — по зависимостям (номер в имени), tools/build.js берёт их по имени.
 * В src/enpf/manifest.json — sha256 исходников: test/enpf-compare.js по нему видит, что копия устарела.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var ROOT = path.join(__dirname, '..');
var OUT = path.join(ROOT, 'src', 'enpf');
var LIB = process.env.ENPF_LIB || path.join(process.env.HOME || '', 'Downloads', 'Калькулятор ЕНПФ', 'lib');
/* путь для комментариев и EnpfLib.source: домашняя папка — «~» (index.html публикуется, имя пользователя в нём не нужно) */
var HOME = process.env.HOME || '';
var LIB_LABEL = HOME && LIB.indexOf(HOME + path.sep) === 0 ? '~' + LIB.slice(HOME.length) : LIB;
/* что нужно генератору: модель сравнения и живой клиент ЕНПФ (остальное подтянется по import) */
var ENTRIES = ['compare.js', 'enpf-api.js'];
var MARK = 'tools/sync-enpf.js';

function sha(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function fail(msg) { console.error('sync-enpf: ' + msg); process.exit(1); }

/* разбор одного модуля: зависимости, импорты, экспорты, тело без import/export */
function parse(rel) {
  var file = path.join(LIB, rel);
  if (!fs.existsSync(file)) fail('нет файла ' + file);
  var src = fs.readFileSync(file, 'utf8');
  if (/\bimport\s*\(|import\.meta/.test(src)) fail(rel + ': динамический import / import.meta не поддерживаются');
  if (/__EL\b|__enpfRoot\b/.test(src)) fail(rel + ': имя __EL занято');
  var deps = [], imports = [], exportsList = [];
  var dir = path.posix.dirname(rel);
  function resolve(spec) {
    if (!/^\.\.?\//.test(spec)) fail(rel + ': импорт не из библиотеки — ' + spec);
    return path.posix.normalize(path.posix.join(dir, spec));
  }
  var body = src;
  // import { a, b as c } from './x.js';  (в том числе в несколько строк)
  body = body.replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?[ \t]*$/gm, function (_, names, spec) {
    var dep = resolve(spec);
    deps.push(dep);
    var list = names.split(',').map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) {
      var m = /^(\w+)(?:\s+as\s+(\w+))?$/.exec(s);
      if (!m) fail(rel + ': не разобран импорт «' + s + '»');
      return m[2] ? m[1] + ': ' + m[2] : m[1];
    });
    return "const { " + list.join(', ') + " } = __EL.require('" + dep + "');";
  });
  // import X from './data/y.js';
  body = body.replace(/^import\s+(\w+)\s+from\s*'([^']+)';?[ \t]*$/gm, function (_, name, spec) {
    var dep = resolve(spec);
    deps.push(dep);
    return 'const ' + name + " = __EL.require('" + dep + "').default;";
  });
  if (/^import\s/m.test(body)) fail(rel + ': остался неразобранный import');
  if (/^export\s+\*/m.test(body)) fail(rel + ': export * не поддерживается');
  // export { A, B as C };
  body = body.replace(/^export\s*\{([^}]*)\};?[ \t]*$/gm, function (_, names) {
    names.split(',').map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (s) {
      var m = /^(\w+)(?:\s+as\s+(\w+))?$/.exec(s);
      if (!m) fail(rel + ': не разобран экспорт «' + s + '»');
      exportsList.push(m[2] ? m[2] + ': ' + m[1] : m[1]);
    });
    return '';
  });
  // export default <выражение>
  var hasDefault = false;
  body = body.replace(/^export\s+default\s+/m, function () { hasDefault = true; return 'const __default = '; });
  // export const|let|var|function|async function|class ИМЯ
  body = body.replace(/^export\s+((?:async\s+)?function\*?\s+|const\s+|let\s+|var\s+|class\s+)(\w+)/gm, function (_, kw, name) {
    exportsList.push(name);
    return kw + name;
  });
  if (/^export\s/m.test(body)) fail(rel + ': остался неразобранный export');
  if (hasDefault) exportsList.push('default: __default');
  return { rel: rel, src: src, sha: sha(src), deps: deps, body: body, exports: exportsList };
}

/* обход зависимостей: каждый модуль — после тех, что он импортирует */
var mods = {}, order = [];
function visit(rel, stack) {
  if (mods[rel] && mods[rel].done) return;
  if (stack.indexOf(rel) >= 0) fail('циклическая зависимость: ' + stack.concat(rel).join(' → '));
  var m = mods[rel] || (mods[rel] = parse(rel));
  m.deps.forEach(function (d) { visit(d, stack.concat(rel)); });
  m.done = true;
  order.push(rel);
}
if (!fs.existsSync(LIB)) fail('нет библиотеки: ' + LIB + ' (укажите путь в ENPF_LIB)');
ENTRIES.forEach(function (e) { visit(e, []); });

function fileName(i, rel) { return String(i + 1).padStart(2, '0') + '-' + rel.replace(/\//g, '-'); }

function wrap(m, i) {
  return [
    '/* ════ EnpfLib · ' + m.rel + ' ════',
    ' * Копия ' + path.join(LIB_LABEL, m.rel),
    ' * (sha256 ' + m.sha.slice(0, 16) + '…), приведена к обычному скрипту инструментом ' + MARK + ':',
    ' * import/export заменены реестром window.EnpfLib, остальной код — как в библиотеке.',
    ' * Руками не править: исправлять в библиотеке и запускать node tools/sync-enpf.js. */',
    '(function (__enpfRoot) {',
    "'use strict';",
    'const __EL = __enpfRoot.EnpfLib;',
    m.body.replace(/\s+$/, ''),
    '',
    "__EL.define('" + m.rel + "', { " + m.exports.join(', ') + ' });',
    "})(typeof window !== 'undefined' ? window : globalThis);",
    ''
  ].join('\n');
}

var manifest = {
  _about: 'Копия библиотеки «Калькулятор ЕНПФ» для генератора КП. Создано ' + MARK + ' — руками не править.',
  source: LIB_LABEL,
  entries: ENTRIES,
  files: order.map(function (rel, i) { return { module: rel, file: fileName(i, rel), sha256: mods[rel].sha }; })
};

var loader = [
  '/* ════ EnpfLib · реестр модулей ════',
  ' * Библиотека «Калькулятор ЕНПФ» (' + LIB_LABEL + ') внутри генератора КП.',
  ' * Модули src/enpf/NN-*.js регистрируются здесь по порядку зависимостей; последний файл (99-index.js)',
  ' * собирает все экспорты в window.EnpfLib — как lib/index.js. Создано ' + MARK + ', руками не править. */',
  '(function (root) {',
  "  'use strict';",
  '  var modules = {};',
  '  root.EnpfLib = {',
  '    source: ' + JSON.stringify(LIB_LABEL) + ',',
  '    files: ' + JSON.stringify(manifest.files.map(function (f) { return { module: f.module, sha256: f.sha256 }; })) + ',',
  '    modules: modules,',
  '    define: function (name, exp) { modules[name] = exp; },',
  "    require: function (name) { var m = modules[name]; if (!m) throw new Error('EnpfLib: модуль ' + name + ' не загружен'); return m; }",
  '  };',
  "})(typeof window !== 'undefined' ? window : globalThis);",
  ''
].join('\n');

var index = [
  '/* ════ EnpfLib · общий вход (как lib/index.js) ════',
  ' * Все экспорты модулей — свойствами window.EnpfLib; имена уникальны (иначе сборка падает). Создано ' + MARK + '. */',
  '(function (root) {',
  "  'use strict';",
  '  var L = root.EnpfLib;',
  '  ' + JSON.stringify(order) + '.forEach(function (name) {',
  '    var m = L.require(name);',
  '    Object.keys(m).forEach(function (k) {',
  "      if (k === 'default') return;",
  "      if (Object.prototype.hasOwnProperty.call(L, k)) throw new Error('EnpfLib: имя ' + k + ' экспортируют два модуля');",
  '      L[k] = m[k];',
  '    });',
  '  });',
  "  L.MORTALITY = L.require('data/mortality.js').default;",
  "})(typeof window !== 'undefined' ? window : globalThis);",
  ''
].join('\n');

var outputs = {};
outputs['00-loader.js'] = loader;
order.forEach(function (rel, i) { outputs[fileName(i, rel)] = wrap(mods[rel], i); });
outputs['99-index.js'] = index;
outputs['manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';

/* синтаксис каждого файла — до записи */
var vm = require('vm');
Object.keys(outputs).forEach(function (f) {
  if (/\.js$/.test(f)) {
    try { new vm.Script(outputs[f], { filename: f }); } catch (e) { fail(f + ': ' + e.message); }
  }
});

if (process.argv.indexOf('--check') >= 0) {
  var stale = Object.keys(outputs).filter(function (f) {
    var p = path.join(OUT, f);
    return !fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== outputs[f];
  });
  if (stale.length) { console.log('src/enpf устарел: ' + stale.join(', ') + ' — запустите node tools/sync-enpf.js'); process.exit(1); }
  console.log('src/enpf совпадает с ' + LIB);
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
/* старые файлы, созданные этим скриптом, — удалить (модуль могли переименовать или убрать) */
fs.readdirSync(OUT).forEach(function (f) {
  if (outputs[f] || !/\.js$/.test(f)) return;
  var text = fs.readFileSync(path.join(OUT, f), 'utf8');
  if (text.indexOf(MARK) >= 0) fs.unlinkSync(path.join(OUT, f));
});
var changed = 0;
Object.keys(outputs).forEach(function (f) {
  var p = path.join(OUT, f);
  if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === outputs[f]) return;
  fs.writeFileSync(p, outputs[f]);
  changed++;
});
console.log('src/enpf: ' + order.length + ' модулей из ' + LIB + ' (' + order.join(', ') + '); изменено файлов: ' + changed);
console.log('дальше: node tools/build.js');
