/*
 * Чтение .xlsx без библиотек: zip → XML → листы, ячейки, формулы, имена, списки проверки ввода.
 * Распаковку делает inflateRaw среды: в браузере — DecompressionStream, в node — zlib.
 * Ячейки листа разбираются при первом обращении: большие служебные листы калькулятора не трогаем.
 */
(function (root) {
  'use strict';

  var COLS = 16385; // ключ ячейки: r * COLS + c (строки и столбцы — с единицы)

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216; }

  /* zip: центральный каталог → { имя: { method, data } } */
  function unzip(bytes) {
    var end = -1, min = Math.max(0, bytes.length - 65557);
    for (var p = bytes.length - 22; p >= min; p--) if (u32(bytes, p) === 0x06054b50) { end = p; break; }
    if (end < 0) throw new Error('Это не файл Excel (.xlsx)');
    var count = u16(bytes, end + 10), q = u32(bytes, end + 16), out = {}, dec = new TextDecoder('utf-8');
    for (var k = 0; k < count; k++) {
      if (u32(bytes, q) !== 0x02014b50) throw new Error('Файл .xlsx повреждён');
      var method = u16(bytes, q + 10), size = u32(bytes, q + 20);
      var nl = u16(bytes, q + 28), xl = u16(bytes, q + 30), cl = u16(bytes, q + 32), off = u32(bytes, q + 42);
      var name = dec.decode(bytes.subarray(q + 46, q + 46 + nl));
      if (u32(bytes, off) !== 0x04034b50) throw new Error('Файл .xlsx повреждён');
      var start = off + 30 + u16(bytes, off + 26) + u16(bytes, off + 28);
      out[name] = { method: method, data: bytes.subarray(start, start + size) };
      q += 46 + nl + xl + cl;
    }
    return out;
  }

  function browserInflate(u8) {
    var ds;
    try { ds = new DecompressionStream('deflate-raw'); } catch (e) {
      return Promise.reject(new Error('Браузер не умеет открывать .xlsx — обновите его'));
    }
    return new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer()
      .then(function (b) { return new Uint8Array(b); });
  }

  /* ── XML ── */
  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  function unesc(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, function (m, g) {
      if (g.charAt(0) !== '#') return ENT[g];
      return String.fromCodePoint(g.charAt(1) === 'x' || g.charAt(1) === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
    });
  }
  /* Excel прячет управляющие символы в строках как _x000D_ */
  function xstr(s) {
    return s.indexOf('_x') < 0 ? s : s.replace(/_x([0-9A-Fa-f]{4})_/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); });
  }
  function attrs(s) {
    var o = {}, m, re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    while ((m = re.exec(s))) o[m[1]] = unesc(m[2] != null ? m[2] : m[3]);
    return o;
  }
  function texts(xml) {
    var s = '', m, re = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g;
    xml = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
    while ((m = re.exec(xml))) s += m[1];
    return xstr(unesc(s));
  }

  function colNum(letters) {
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) & 31);
    return n;
  }
  function a1(ref) {
    var m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref);
    return m ? { r: +m[2], c: colNum(m[1].toUpperCase()) } : null;
  }

  function sharedStrings(xml) {
    var out = [], m, re = /<si>([\s\S]*?)<\/si>|<si\/>/g;
    while ((m = re.exec(xml))) out.push(m[1] ? texts(m[1]) : '');
    return out;
  }

  function isoSerial(s, date1904) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
    if (!m) return { e: '#VALUE!' };
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    var base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    var v = (t - base) / 86400000;
    return !date1904 && v <= 60 ? v - 1 : v;
  }

  function decode(t, raw, inner, sst, date1904) {
    if (t === 'inlineStr') { var is = /<is>([\s\S]*?)<\/is>/.exec(inner); return is ? texts(is[1]) : ''; }
    if (raw == null) return undefined;
    switch (t) {
      case 's': return sst[+raw] != null ? sst[+raw] : '';
      case 'str': return xstr(unesc(raw));
      case 'b': return raw === '1' || raw === 'true';
      case 'e': return { e: unesc(raw) };
      case 'd': return isoSerial(raw, date1904);
      default: return raw === '' ? undefined : +raw;
    }
  }

  var F_RE = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/;
  var V_RE = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/;

  function parseValidations(xml) {
    var out = [], m, re = /<(?:\w+:)?dataValidation\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?dataValidation>)/g;
    while ((m = re.exec(xml))) {
      var a = attrs(m[1]), body = m[2] || '';
      var f1 = /<(?:\w+:)?formula1>([\s\S]*?)<\/(?:\w+:)?formula1>/.exec(body);
      var f2 = /<(?:\w+:)?formula2>([\s\S]*?)<\/(?:\w+:)?formula2>/.exec(body);
      var sq = a.sqref || ((/<(?:\w+:)?sqref>([^<]*)<\/(?:\w+:)?sqref>/.exec(body) || [])[1]) || '';
      function inner(x) { if (!x) return null; var f = /<(?:\w+:)?f>([\s\S]*?)<\/(?:\w+:)?f>/.exec(x[1]); return unesc(f ? f[1] : x[1]); }
      out.push({ type: a.type || 'any', operator: a.operator || '', formula1: inner(f1), formula2: inner(f2),
                 sqref: sq.trim().split(/\s+/).filter(Boolean) });
    }
    return out;
  }

  /* лист → Map ячеек { v } — значение, { f | si, cv } — формула и сохранённый Excel результат */
  function parseSheet(xml, sst, date1904) {
    var cells = new Map(), masters = {}, maxR = 0, maxC = 0;
    var s0 = xml.indexOf('<sheetData'), s1 = xml.indexOf('</sheetData>');
    var data = s0 >= 0 && s1 > s0 ? xml.slice(s0, s1) : '';
    var rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    var rm, cm, rowNo = 0;
    while ((rm = rowRe.exec(data))) {
      var ra = attrs(rm[1]);
      rowNo = ra.r ? +ra.r : rowNo + 1;
      if (!rm[2]) continue;
      var colNo = 0;
      cellRe.lastIndex = 0;
      while ((cm = cellRe.exec(rm[2]))) {
        var ca = attrs(cm[1]), pos = ca.r ? a1(ca.r) : null;
        var r = pos ? pos.r : rowNo, c = pos ? pos.c : colNo + 1;
        colNo = c;
        var inner = cm[2] || '', cell = {};
        var fm = inner ? F_RE.exec(inner) : null, vm = inner ? V_RE.exec(inner) : null;
        var val = decode(ca.t || 'n', vm ? vm[1] : null, inner, sst, date1904);
        if (fm) {
          var fa = attrs(fm[1]), text = fm[2] != null ? unesc(fm[2]) : '';
          if (fa.t === 'shared' && fa.si != null) {
            cell.si = +fa.si;
            if (text) { cell.f = text; masters[cell.si] = { f: text, r: r, c: c }; }
          } else {
            cell.f = text;
            if (fa.t === 'array') cell.array = fa.ref || true;
            if (fa.t === 'dataTable') cell.dataTable = true;
          }
          cell.cv = val;
        } else {
          if (val === undefined) continue; // пустая ячейка с оформлением
          cell.v = val;
        }
        cells.set(r * COLS + c, cell);
        if (r > maxR) maxR = r;
        if (c > maxC) maxC = c;
      }
    }
    return { cells: cells, masters: masters, maxR: maxR, maxC: maxC, validations: parseValidations(xml) };
  }

  function resolvePath(target) {
    if (!target) return '';
    if (target.charAt(0) === '/') return target.slice(1);
    var parts = ('xl/' + target).split('/'), out = [];
    parts.forEach(function (p) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); });
    return out.join('/');
  }

  /*
   * bytes — содержимое файла (Uint8Array); inflateRaw(u8) → Promise<Uint8Array>.
   * → Promise<{ sheets: [{ name, state, xml }], names: [{ name, local, ref, hidden }], sst, date1904, modified }>
   */
  function read(bytes, inflateRaw) {
    var inflate = inflateRaw || browserInflate;
    var zip;
    try { zip = unzip(bytes); } catch (e) { return Promise.reject(e); }
    var dec = new TextDecoder('utf-8');
    function text(name) {
      var e = zip[name];
      if (!e) return Promise.resolve(null);
      if (e.method === 0) return Promise.resolve(dec.decode(e.data));
      if (e.method !== 8) return Promise.reject(new Error('Неизвестное сжатие в .xlsx'));
      return Promise.resolve(inflate(e.data)).then(function (u8) { return dec.decode(u8); });
    }
    if (!zip['xl/workbook.xml']) return Promise.reject(new Error('Это не книга Excel: нет xl/workbook.xml'));
    return Promise.all([text('xl/workbook.xml'), text('xl/_rels/workbook.xml.rels'), text('xl/sharedStrings.xml'), text('docProps/core.xml')])
      .then(function (r) {
        var wb = r[0], rels = {}, m, re = /<Relationship\b([^>]*?)\/?>/g;
        while ((m = re.exec(r[1] || ''))) { var ra = attrs(m[1]); rels[ra.Id] = ra.Target; }
        var sheets = [], rs = /<sheet\b([^>]*?)\/?>/g;
        while ((m = rs.exec(wb))) {
          var a = attrs(m[1]), rid = null;
          Object.keys(a).forEach(function (k) { if (/(^|:)id$/.test(k)) rid = a[k]; });
          sheets.push({ name: a.name, state: a.state || 'visible', path: resolvePath(rels[rid]) });
        }
        var names = [], rn = /<definedName\b([^>]*?)>([\s\S]*?)<\/definedName>/g;
        while ((m = rn.exec(wb))) {
          var na = attrs(m[1]);
          names.push({ name: na.name, local: na.localSheetId != null ? +na.localSheetId : -1, ref: unesc(m[2]), hidden: na.hidden === '1' });
        }
        var core = r[3] || '';
        var modified = (/<dcterms:modified[^>]*>([^<]+)</.exec(core) || [])[1] || '';
        var out = {
          sheets: sheets, names: names, sst: sharedStrings(r[2] || ''),
          date1904: /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(wb), modified: modified
        };
        return Promise.all(sheets.map(function (s) { return text(s.path); })).then(function (xmls) {
          sheets.forEach(function (s, k) { s.xml = xmls[k] || ''; });
          return out;
        });
      });
  }

  var api = { read: read, parseSheet: parseSheet, unzip: unzip, a1: a1, colNum: colNum, COLS: COLS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XlsxReader = api;
})(this);
