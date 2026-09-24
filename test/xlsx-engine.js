/* Калькулятор из .xlsx: генератор считает по формулам самого файла.
   Сверка: (1) формулы файла против значений, сохранённых Excel; (2) ответы LibreOffice по профилям excel-cases;
   (3) случайные клиенты — расчёт по файлу против встроенного движка (должны совпасть до тенге).
   Путь к файлу: KP_XLSX=… node test/xlsx-engine.js (по умолчанию ~/Downloads/КП ПА/ПА калькулятор 21.09.2026.xlsx) */
var fs = require('fs'), path = require('path'), zlib = require('zlib');
var K = require('./render.js').loadKit();
var file = process.env.KP_XLSX || path.join(process.env.HOME, 'Downloads', 'КП ПА', 'ПА калькулятор 21.09.2026.xlsx');
if (!fs.existsSync(file)) { console.log('нет файла калькулятора — пропускаю: ' + file); process.exit(0); }
var cases = require('./excel-cases.json'), xl = require('./excel-results.json');
function inflate(u8) { return new Uint8Array(zlib.inflateRawSync(u8)); }

var t0 = Date.now();
K.loadCalculator(new Uint8Array(fs.readFileSync(file)), path.basename(file), inflate).then(function (E) {
  var bad = 0;
  console.log('файл: ' + E.fileName + ' · версия ' + E.label + ' · ' + (Date.now() - t0) + ' мс');
  console.log('параметры: ' + JSON.stringify(E.params));
  console.log('категории: ' + E.lists.categories.join(' | '));
  console.log('формул в расчёте: ' + E.formulas + ', сверено с Excel: ' + E.check.checked + ', расхождений: ' + E.check.bad.length);
  E.check.bad.slice(0, 5).forEach(function (b) { console.log('   ' + b.addr + ': код ' + JSON.stringify(b.got) + ' ≠ Excel ' + JSON.stringify(b.want)); });
  bad += E.check.bad.length;
  console.log('отличия от встроенного: ' + (E.diff(K.MORT).join('; ') || 'нет'));

  function near(a, b) { return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)) : String(a) === String(b); }

  /* ответы LibreOffice */
  cases.forEach(function (c) {
    var r = E.compute({ calcDate: c.calc, dob: c.dob, sex: c.sex, category: c.cat, oppv: c.oppv, guarantee: c.gp,
                        savings: c.sav, redemption: c.red, contribution: c.con });
    var x = xl[c.id];
    var checks = [['статус', x.status, r.excelStatus], ['возраст', +x.x, r.age], ['старт', +x.x0, r.startAge], ['отсрочка', x.d, r.deferral],
                  ['nax', +x.nax, r.nax], ['порог', x.minPrem, r.threshold]];
    if (r.mode === 'free') checks.push(['выплата при выходе', x.payPension, r.first]);
    var f = checks.filter(function (k) { return !near(k[2], k[1]); });
    bad += f.length;
    console.log((f.length ? '✗ ' : '✓ ') + c.id.padEnd(9) + ' порог ' + r.threshold + ' · первая выплата ' + r.first + ' · ' + r.mode +
      f.map(function (k) { return '\n    ' + k[0] + ': LibreOffice ' + k[1] + ' ≠ файл ' + k[2]; }).join(''));
  });

  /* случайные клиенты: файл против встроенного движка */
  var seed = 20260924;
  function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
  function pickOf(a) { return a[Math.floor(rnd() * a.length)]; }
  function d2(n) { return ('0' + n).slice(-2); }
  var N = +(process.env.N || 1500), diffs = 0, t1 = Date.now();
  for (var k = 0; k < N; k++) {
    var y = 1948 + Math.floor(rnd() * 40), dob = y + '-' + d2(1 + Math.floor(rnd() * 12)) + '-' + d2(1 + Math.floor(rnd() * 28));
    if (rnd() < 0.15) dob = pickOf(['1976-02-29', '1972-02-29', '1968-02-29', '1980-02-29', '1980-01-31', '1971-08-31', '1975-06-30',
                                    '1975-07-01', '1976-01-01', '1976-06-30', '1976-07-01', '1974-12-31', '1986-09-24']);
    var calc = pickOf(['2026-09-24', '2026-12-31', '2027-02-28', '2027-03-01', '2026-10-15', '2028-02-29', '2026-02-28']);
    var input = { calcDate: calc, dob: dob, sex: pickOf(['мужской', 'женский']), category: pickOf(K.categories),
                  oppv: rnd() < 0.2 ? 'Да' : 'Нет', guarantee: Math.floor(rnd() * 11), savings: Math.floor(rnd() * 30e6),
                  redemption: rnd() < 0.2 ? Math.floor(rnd() * 3e6) : 0, contribution: rnd() < 0.3 ? Math.floor(rnd() * 5e6) : 0, dividendRate: 0.11 };
    var a = E.compute(input), b = K.compute(input);
    var keys = ['status', 'excelStatus', 'fundsStatus', 'mode', 'threshold', 'premium', 'topup', 'dividend', 'first', 'payAtSigning',
                'startAge', 'startAgeInt', 'deferral', 'ageInt', 'nax', 'minPay', 'minPayAtPension'];
    var f2 = keys.filter(function (q) { return !near(a[q], b[q]); });
    if (a.rows.length !== b.rows.length || a.rows.some(function (r, i) { return r.m !== b.rows[i].m || r.cum !== b.rows[i].cum || r.age !== b.rows[i].age; })) f2.push('rows');
    if (f2.length) {
      diffs++;
      if (diffs <= 5) console.log('✗ ' + JSON.stringify(input) + '\n    ' + f2.map(function (q) { return q + ': файл ' + JSON.stringify(a[q]) + ' ≠ встроенный ' + JSON.stringify(b[q]); }).join('\n    '));
    }
  }
  bad += diffs;
  console.log((diffs ? '✗ ' : '✓ ') + N + ' случайных клиентов: расхождений ' + diffs + ' · ' + Math.round((Date.now() - t1) / N * 10) / 10 + ' мс на расчёт');
  console.log(bad ? '\nрасхождений: ' + bad : '\nрасчёт по файлу совпадает с Excel и встроенным движком');
  process.exit(bad ? 1 : 0);
}).catch(function (e) { console.error('ОШИБКА: ' + e.stack); process.exit(1); });
