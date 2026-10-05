/**
 * ตัวจำลอง Google Apps Script สำหรับรันเทสต์ในเครื่อง (Node)
 *
 * ไม่ต้องใช้บัญชี Google ไม่แตะชีตจริง — โหลดไฟล์ .gs ทุกไฟล์มาไว้ใน
 * ขอบเขตเดียวกันเหมือนในโปรเจกต์ Apps Script จริง แล้วจำลองชีตเป็น array
 *
 *   node tests/run.js          รันทุกไฟล์ t-*.js
 *
 * ไฟล์นี้ไม่ต้องวางใน Apps Script — ใช้ตรวจโค้ดก่อนส่งเท่านั้น
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GS = path.join(__dirname, '..', 'google-apps-script');

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/** formatDate แบบย่อ — รองรับเฉพาะรูปแบบที่โค้ดใช้จริง ตามเวลาเครื่อง (ตั้ง TZ=Asia/Bangkok) */
function formatDate(d, tz, fmt) {
  d = d instanceof Date ? d : new Date(d);
  const Y = d.getFullYear(), M = d.getMonth() + 1, D = d.getDate();
  const h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
  return fmt
    .replace(/yyyy/g, Y).replace(/MM/g, pad2(M)).replace(/dd/g, pad2(D))
    .replace(/HH/g, pad2(h)).replace(/mm/g, pad2(m)).replace(/ss/g, pad2(s))
    .replace(/\bM\b/g, M).replace(/\bd\b/g, D)
    .replace(/\bu\b/g, d.getDay() === 0 ? 7 : d.getDay());
}

function makeEnv() {
  const SHEETS = {};
  const PROPS = {};
  const CACHE = {};
  const SENT = [];      // ข้อความที่ส่งออก LINE
  const LOG = [];

  function sheetObj(name) {
    const s = SHEETS[name];
    if (!s) return null;
    const width = () => Math.max(s.headers.length, ...s.rows.map(r => r.length), 1);
    const pad = row => { const o = row.slice(); while (o.length < width()) o.push(''); return o; };
    const all = () => [s.headers.slice()].concat(s.rows.map(pad));
    const chain = {};
    ['setFontWeight', 'setBackground', 'setFontColor', 'setNumberFormat', 'setFontSize',
     'setWrap', 'setHorizontalAlignment', 'clearDataValidations', 'setBorder',
     'setVerticalAlignment', 'setFontStyle'].forEach(k => { chain[k] = function () { return this; }; });
    function range(r, c, nr, nc) {
      nr = nr === undefined ? 1 : nr; nc = nc === undefined ? 1 : nc;
      const read = () => {
        const a = all(), out = [];
        for (let i = 0; i < nr; i++) {
          const row = a[r - 1 + i] || [];
          const o = [];
          for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]);
          out.push(o);
        }
        return out;
      };
      const write = v => {
        for (let i = 0; i < v.length; i++) {
          const ri = r - 1 + i;
          let row;
          if (ri === 0) row = s.headers;
          else { while (s.rows.length < ri) s.rows.push([]); row = s.rows[ri - 1]; }
          for (let j = 0; j < v[i].length; j++) {
            while (row.length < c - 1 + j) row.push('');
            row[c - 1 + j] = v[i][j];
          }
        }
      };
      return Object.assign(Object.create(chain), {
        getValues: read,
        getDisplayValues: () => read().map(r => r.map(x =>
          x instanceof Date ? formatDate(x, '', 'd/M/yyyy HH:mm:ss') : String(x))),
        getValue: () => read()[0][0],
        getDisplayValue: () => String(read()[0][0]),
        setValues(v) { write(v); return this; },
        setValue(v) { write([[v]]); return this; },
        clearContent() { write(read().map(r => r.map(() => ''))); return this; },
        clear() { return this.clearContent(); },
        getRow: () => r, getColumn: () => c, getNumRows: () => nr, getNumColumns: () => nc,
        getSheet: () => sheetObj(name)
      });
    }
    return {
      getName: () => name,
      getLastRow: () => s.rows.length + (s.headers.length ? 1 : 0),
      getLastColumn: () => width(),
      getMaxRows: () => s.rows.length + 1,
      getMaxColumns: () => width(),
      getRange: range,
      getDataRange: () => range(1, 1, s.rows.length + 1, width()),
      appendRow(row) {
        if (!s.headers.length) s.headers = row.slice(); else s.rows.push(row.slice());
        return this;
      },
      deleteRow(r) { s.rows.splice(r - 2, 1); },
      insertColumnsAfter() {}, insertRowsAfter() {}, setFrozenRows() {}, setColumnWidth() {},
      autoResizeColumns() {}, hideSheet() {}, setName(n) { SHEETS[n] = s; delete SHEETS[name]; },
      clear() { s.headers = []; s.rows = []; return this; },
      clearContents() { s.rows = []; return this; },
      getDataValidations() { return []; }
    };
  }

  const ss = {
    getSheetByName: n => sheetObj(n),
    insertSheet(n) { SHEETS[n] = { headers: [], rows: [] }; return sheetObj(n); },
    getSheets: () => Object.keys(SHEETS).map(sheetObj),
    getId: () => 'test-ss', getUrl: () => 'https://test'
  };

  const ctx = {
    console, Date, Math, JSON, Object, Array, String, Number, RegExp, Error, isNaN, parseInt,
    parseFloat, encodeURIComponent, decodeURIComponent,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss, openById: () => ss, flush() {},
      getUi: () => { throw new Error('no ui in tests'); }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in PROPS ? PROPS[k] : null),
        setProperty(k, v) { PROPS[k] = String(v); return this; },
        deleteProperty(k) { delete PROPS[k]; return this; },
        getProperties: () => Object.assign({}, PROPS),
        setProperties(o) { Object.assign(PROPS, o); return this; }
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => (k in CACHE ? CACHE[k] : null),
        put(k, v) { CACHE[k] = v; }, remove(k) { delete CACHE[k]; }
      })
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      formatDate, getUuid: () => 'uuid-' + Math.random().toString(36).slice(2),
      sleep() {}, base64Encode: s => Buffer.from(String(s)).toString('base64')
    },
    UrlFetchApp: {
      fetch(url, opt) {
        if (/api\.line\.me/.test(url) && opt && opt.payload) SENT.push(JSON.parse(opt.payload));
        return { getResponseCode: () => 200, getContentText: () => '{}' };
      }
    },
    ContentService: {
      createTextOutput: t => ({ setMimeType() { return this; }, getContent: () => t }),
      MimeType: { JSON: 'json' }
    },
    ScriptApp: {
      getProjectTriggers: () => [], newTrigger: () => ({
        timeBased() { return this; }, everyMinutes() { return this; }, everyHours() { return this; },
        atHour() { return this; }, everyDays() { return this; }, onWeekDay() { return this; },
        create() { return this; } }),
      deleteTrigger() {}, getService: () => ({ getUrl: () => '' })
    },
    Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
    Logger: { log: m => LOG.push(String(m)) }
  };
  vm.createContext(ctx);

  // โหลดทุกไฟล์ต่อกันเป็นก้อนเดียว เหมือนที่ Apps Script รวมทุกไฟล์ไว้ในขอบเขตเดียว
  const order = ['pos-backend.gs', 'accounting.gs', 'line-intake.gs', 'line-expiry-alert.gs',
                 'stock-audit.gs', 'stock-costing.gs', 'monthly-report.gs'];
  const src = order.map(f => '// ── ' + f + '\n' + fs.readFileSync(path.join(GS, f), 'utf8')).join('\n');
  // var ที่ซ้ำกันระหว่างไฟล์ (เช่น TZ) ใน Apps Script ไม่เป็นไร ใน vm ก็ไม่เป็นไรเหมือนกัน
  vm.runInContext(src, ctx, { filename: 'project.gs' });

  ctx.__env = { SHEETS, PROPS, CACHE, SENT, LOG };
  return ctx;
}

/** ตัวช่วยตรวจผล */
function makeCheck(title) {
  let pass = 0, fail = 0;
  console.log('\n══ ' + title + ' ══');
  function eq(label, got, want) {
    const a = JSON.stringify(got), b = JSON.stringify(want);
    if (a === b) { pass++; console.log('  ✓', label); }
    else { fail++; console.log('  ✗', label, '\n      ได้:', a, '\n      ควรได้:', b); }
  }
  function section(t) { console.log('\n── ' + t + ' ──'); }
  function done() {
    console.log(`\n${fail ? '❌' : '✅'} ${title}: ผ่าน ${pass} / ไม่ผ่าน ${fail}`);
    return { pass, fail };
  }
  return { eq, section, done };
}

module.exports = { makeEnv, makeCheck, formatDate };
