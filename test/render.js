/* Рендер отчёта в Node — для проверки шаблонов без браузера */
var fs = require('fs'), vm = require('vm'), path = require('path');
function loadKit() {
  var ctx = { console: console, TextDecoder: TextDecoder };
  ctx.globalThis = ctx; ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'dist', 'report-kit.js'), 'utf8'), ctx);
  return ctx.ReportKit;
}
module.exports = { loadKit: loadKit };
