/* Сверка расчёта с калькулятором «ПА калькулятор 21.09.2026.xlsx».
   excel-results.json — ответы самого Excel (пересчитан в LibreOffice) для профилей из excel-cases.json. */
var K = require('./render.js').loadKit();
var cases = require('./excel-cases.json'), xl = require('./excel-results.json');
var bad = 0;
cases.forEach(function (c) {
  var r = K.compute({ calcDate: c.calc, dob: c.dob, sex: c.sex, category: c.cat, oppv: c.oppv, guarantee: c.gp,
                      savings: c.sav, redemption: c.red, contribution: c.con });
  var x = xl[c.id], BP = c.sav + c.red + c.con;
  var paySign = BP / r.nax, pension = Math.round(Math.round(paySign) * Math.pow(1.08, r.deferral));
  var checks = [['статус', x.status, r.excelStatus], ['возраст', +x.x, r.age], ['старт выплат', +x.x0, r.startAge],
    ['отсрочка', x.d, r.deferral], ['аннуитетный фактор', +x.nax, r.nax], ['порог', x.minPrem, r.threshold],
    ['выплата на дату', +x.paySign, paySign], ['выплата при выходе на пенсию', x.payPension, pension]];
  var fails = checks.filter(function (k) {
    return typeof k[1] === 'number' ? Math.abs(k[1] - k[2]) > 1e-6 * Math.max(1, Math.abs(k[1])) : String(k[1]) !== String(k[2]);
  });
  bad += fails.length;
  console.log((fails.length ? '✗ ' : '✓ ') + c.id.padEnd(9) + ' порог ' + r.threshold + ', выплата при выходе ' + x.payPension +
    fails.map(function (f) { return '\n    ' + f[0] + ': Excel ' + f[1] + ' ≠ код ' + f[2]; }).join(''));
});

/* Правило продукта от 06.10.2026: дивиденд не уменьшает доплату. Своих средств меньше порога — доплата = порог − свои
   средства. Так считает и сам Excel: статус «ok» только при BP (ввод!G19 = накопления + выкупная + взнос) ≥ мин. премии
   (ввод!G2: IF(BP<J16,"недостаточно средств",…)); дивиденд — отдельная строка График!D3 = ROUND(ставка·BP). */
console.log('\nправило 06.10.2026 — дивиденд не уменьшает доплату:');
var ruleBad = 0;
cases.forEach(function (c) {
  var r = K.compute({ calcDate: c.calc, dob: c.dob, sex: c.sex, category: c.cat, oppv: c.oppv, guarantee: c.gp,
                      savings: c.sav, redemption: c.red, contribution: 0 });
  var x = xl[c.id], own = c.sav + c.red, f = [];
  if (r.mode === 'threshold') {
    if (r.topup !== x.minPrem - own) f.push('доплата ' + r.topup + ' ≠ порог Excel − свои средства ' + (x.minPrem - own));
    if (r.premium !== x.minPrem) f.push('премия ' + r.premium + ' ≠ порог Excel ' + x.minPrem);
    // c зачётом дивиденда BP оказался бы ниже порога — Excel сказал бы «недостаточно средств»
    if (!(own + r.topup - r.dividend < x.minPrem)) f.push('проверка «с зачётом дивиденда не хватает» не сработала');
  } else if (r.topup !== 0) f.push('своих средств хватает, а доплата ' + r.topup);
  ruleBad += f.length;
  console.log((f.length ? '✗ ' : '✓ ') + c.id.padEnd(9) + ' без взноса: ' + (r.mode === 'threshold'
    ? 'доплата ' + r.topup + ' = ' + x.minPrem + ' − ' + own + ' (дивиденд ' + r.dividend + ' отдельно)' : 'доплата не нужна') +
    f.map(function (m) { return '\n    ' + m; }).join(''));
});
/* эталонный КП (М 10.03.1979, 5 800 000 ₸, ГП 15): там порог 9 837 712 (ROUNDUP), по Excel 9 837 711 (ROUND) */
var ref = K.compute({ calcDate: '2026-09-18', dob: '1979-03-10', sex: 'мужской', category: 'Стандартный', oppv: 'Нет', guarantee: 15,
                      savings: 5800000, redemption: 0, contribution: 0 });
var refOk = ref.threshold === 9837711 && ref.topup === 4037711 && ref.dividend === 1082148 && 9837712 - 5800000 === 4037712;
if (!refOk) ruleBad++;
console.log((refOk ? '✓ ' : '✗ ') + 'эталон  ГП 15: доплата ' + ref.topup + ' (эталонный КП: 9 837 712 − 5 800 000 = 4 037 712, а не 2 955 564)');
bad += ruleBad;
console.log(bad ? '\nрасхождений: ' + bad : '\nрасчёт совпадает с калькулятором');
process.exit(bad ? 1 : 0);
