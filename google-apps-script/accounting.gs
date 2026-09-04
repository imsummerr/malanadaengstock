/************************************************************
 * 📒 บัญชีรายรับ-รายจ่าย สำหรับนิติบุคคล
 *
 * รวบรวมเงินเข้า-เงินออกที่ระบบเก็บไว้อยู่แล้ว (ขายหน้าร้าน เดลิเวอรี่
 * ค่าใช้จ่าย ซื้อของเข้า) มาจัดเป็นรูปแบบที่ส่งให้ผู้ทำบัญชีได้เลย
 *
 *   บัญชี_สมุดรายวัน     ทุกรายการเงินเข้า-ออก เรียงตามวัน พร้อมรหัสบัญชี
 *   บัญชี_งบกำไรขาดทุน   รายได้ ต้นทุน ค่าใช้จ่าย กำไรสุทธิ แยกเป็นรายเดือน
 *   บัญชี_สรุปภาษี        VAT ขาย-ซื้อ และภาษีหัก ณ ที่จ่าย รายเดือน
 *   บัญชี_รายการเพิ่ม     ช่องกรอกเอง สำหรับเงินที่ระบบไม่รู้ (เงินเดือน ค่าเช่า ยอดโอนแพลตฟอร์ม)
 *   บัญชี_ผังบัญชี        รหัสบัญชีทั้งหมด ไว้ให้ผู้ทำบัญชีจับคู่กับโปรแกรมของเขา
 *
 * ⚠️ อ่านให้จบก่อนใช้
 *   ไฟล์นี้ทำ "บัญชีเบื้องต้น" ให้ครบและตรวจสอบได้ แต่ตามกฎหมาย (พ.ร.บ.การบัญชี
 *   พ.ศ. 2543) นิติบุคคลต้องมีผู้ทำบัญชีที่ขึ้นทะเบียน และงบการเงินต้องผ่าน
 *   ผู้สอบบัญชีรับอนุญาต (CPA) ก่อนยื่น DBD/สรรพากร
 *   → ใช้ไฟล์นี้เป็น "ข้อมูลตั้งต้นที่สะอาด" ส่งให้เขา ไม่ใช่ใช้แทนเขา
 *
 * วิธีติดตั้ง: อ่าน ACCOUNTING-README.md ในโฟลเดอร์เดียวกัน
 ************************************************************/

// ══════════════════════════════════════════════════════════════
//  ตั้งค่า
// ══════════════════════════════════════════════════════════════

var ACC_SHEET_JOURNAL = 'บัญชี_สมุดรายวัน';
var ACC_SHEET_PL      = 'บัญชี_งบกำไรขาดทุน';
var ACC_SHEET_TAX     = 'บัญชี_สรุปภาษี';
var ACC_SHEET_MANUAL  = 'บัญชี_รายการเพิ่ม';
var ACC_SHEET_COA     = 'บัญชี_ผังบัญชี';

var ACC_VAT_RATE = 0.07;

/** ผังบัญชี — group ใช้จัดกลุ่มในงบกำไรขาดทุน */
var ACC_ACCOUNTS = [
  { code: '4100', name: 'รายได้จากการขาย — หน้าร้าน',        group: 'รายได้' },
  { code: '4110', name: 'รายได้จากการขาย — เดลิเวอรี่',       group: 'รายได้' },
  { code: '4900', name: 'รายได้อื่น',                         group: 'รายได้' },

  { code: '5100', name: 'ซื้อวัตถุดิบ / ต้นทุนขาย',            group: 'ต้นทุนขาย' },

  { code: '6100', name: 'ค่าเช่าที่',                          group: 'ค่าใช้จ่าย' },
  { code: '6200', name: 'ค่าแรงและเงินเดือน',                  group: 'ค่าใช้จ่าย' },
  { code: '6300', name: 'ค่าสาธารณูปโภค (แก๊ส น้ำแข็ง ไฟ น้ำ)', group: 'ค่าใช้จ่าย' },
  { code: '6400', name: 'วัสดุสิ้นเปลือง (ไม้เสียบ ถุง ถ้วย)',   group: 'ค่าใช้จ่าย' },
  { code: '6500', name: 'ค่าคอมมิชชั่นแพลตฟอร์มเดลิเวอรี่',     group: 'ค่าใช้จ่าย' },
  { code: '6900', name: 'ค่าใช้จ่ายอื่น',                      group: 'ค่าใช้จ่าย' }
];

/** ประเภทค่าใช้จ่ายในชีต POS_Expenses → รหัสบัญชี (ต้องตรงกับ EXPENSE_TYPES) */
var ACC_EXPENSE_MAP = {
  'ค่าที่':      '6100',
  'ค่าแรง':     '6200',
  'ค่าแก๊ส':    '6300',
  'ค่าน้ำแข็ง':  '6300',
  'ค่าไม้เสียบ': '6400',
  'ค่าของสด':   '5100',
  'อื่น ๆ':      '6900'
};

/**
 * ภาษีหัก ณ ที่จ่าย ที่ระบบคำนวณให้ได้ — คิดเฉพาะที่อัตราตายตัวจริง ๆ
 * ค่าเช่า 5% · ค่าจ้างทำของ/บริการ 3%
 * ⚠️ ไม่รวมเงินเดือนพนักงานประจำ เพราะใช้ ภ.ง.ด.1 คำนวณตามขั้นบันได
 *    ระบบเดาแทนไม่ได้ ต้องให้ผู้ทำบัญชีคำนวณ
 */
var ACC_WHT_RATES = { '6100': 0.05 };

var ACC_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

var ACC_JOURNAL_HEADERS = [
  'วันที่', 'เลขที่เอกสาร', 'รับ/จ่าย', 'รหัสบัญชี', 'ชื่อบัญชี', 'รายละเอียด', 'สาขา',
  'จำนวนเงินรวม', 'ฐานภาษี', 'VAT', 'หัก ณ ที่จ่าย', 'จ่ายสุทธิ', 'เอกสาร', 'ที่มา'
];

var ACC_MANUAL_HEADERS = [
  'วันที่', 'รับ/จ่าย', 'รหัสบัญชี', 'รายละเอียด', 'จำนวนเงิน',
  'VAT', 'หัก ณ ที่จ่าย', 'เอกสาร', 'หมายเหตุ'
];

function accProps_() { return PropertiesService.getScriptProperties(); }
function accProp_(key, fallback) {
  var v = accProps_().getProperty(key);
  return (v === null || v === undefined || v === '') ? fallback : String(v).trim();
}
function accTz_()     { return (typeof TZ === 'string' && TZ) ? TZ : 'Asia/Bangkok'; }
function accVatOn_()  { return String(accProp_('ACC_VAT', 'off')).toLowerCase() === 'on'; }
function accWhtOn_()  { return String(accProp_('ACC_WHT', 'off')).toLowerCase() === 'on'; }

function accNum_(v) {
  if (typeof num_ === 'function') return num_(v);
  var n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

/** วันที่จากชีต → 'yyyy-MM-dd' (ใช้ตัวเดียวกับ POS เพื่อให้ตัวเลขตรงกัน) */
function accDate_(v) {
  if (typeof normDate_ === 'function') return normDate_(v);
  if (v instanceof Date) return Utilities.formatDate(v, accTz_(), 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}

function accRound_(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function accAccountName_(code) {
  for (var i = 0; i < ACC_ACCOUNTS.length; i++) {
    if (ACC_ACCOUNTS[i].code === code) return ACC_ACCOUNTS[i].name;
  }
  return '(ไม่รู้จักรหัส ' + code + ')';
}

function accSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/** อ่านชีตเป็น array ของ object ตามชื่อหัวคอลัมน์ — ไม่มีชีตก็คืน [] */
function accRead_(sheetName) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];

  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  var head = v[0], out = [];
  for (var i = 1; i < v.length; i++) {
    var row = {};
    for (var c = 0; c < head.length; c++) {
      var key = String(head[c]).trim();
      if (key) row[key] = v[i][c];
    }
    out.push(row);
  }
  return out;
}

// ══════════════════════════════════════════════════════════════
//  รวบรวมรายการจากทุกชีต
// ══════════════════════════════════════════════════════════════

/**
 * สร้างหนึ่งรายการในสมุดรายวัน
 * amount = เงินที่รับหรือจ่ายจริงทั้งก้อน (รวม VAT แล้วถ้ามี)
 * vatIn  = ใส่ค่ามาเองเมื่อรู้ยอด VAT จากใบกำกับภาษี · null = ให้คำนวณตามการตั้งค่า
 */
function accEntry_(o) {
  var amount = accRound_(o.amount);
  var vat = 0;

  if (o.vat !== null && o.vat !== undefined && o.vat !== '') {
    vat = accRound_(o.vat);
  } else if (accVatOn_() && o.vatable) {
    // ราคาขายหน้าร้านเป็นราคารวม VAT อยู่แล้ว จึงถอดออกมา ไม่ใช่บวกเพิ่ม
    vat = accRound_(amount - amount / (1 + ACC_VAT_RATE));
  }

  var base = accRound_(amount - vat);

  var wht = 0;
  if (o.wht !== null && o.wht !== undefined && o.wht !== '') {
    wht = accRound_(o.wht);
  } else if (accWhtOn_() && o.kind === 'จ่าย' && ACC_WHT_RATES[o.code]) {
    wht = accRound_(base * ACC_WHT_RATES[o.code]);
  }

  return {
    date:   o.date,
    no:     o.no || '',
    kind:   o.kind,
    code:   o.code,
    detail: o.detail || '',
    branch: o.branch || '',
    amount: amount,
    base:   base,
    vat:    vat,
    wht:    wht,
    net:    accRound_(amount - wht),
    doc:    o.doc || 'ไม่ระบุ',
    source: o.source || ''
  };
}

/** ขายหน้าร้าน — ใช้ "ยอดสุทธิ" ตัวเดียวกับที่หน้า Dashboard นับ */
function accFromOrders_(year) {
  var out = [];
  accRead_(typeof SHEET_ORDERS === 'string' ? SHEET_ORDERS : 'POS_Orders').forEach(function (r) {
    var date = accDate_(r['วันที่']);
    if (date.slice(0, 4) !== year) return;
    var amount = accNum_(r['ยอดสุทธิ']);
    if (!amount) return;

    out.push(accEntry_({
      date: date, no: r['เลขที่ออเดอร์'], kind: 'รับ', code: '4100',
      detail: 'ขายหน้าร้าน' + (r['วิธีชำระเงิน'] ? ' (' + r['วิธีชำระเงิน'] + ')' : ''),
      branch: r['สาขา'], amount: amount, vatable: true,
      doc: 'บิลขาย', source: 'POS_Orders'
    }));
  });
  return out;
}

/**
 * เดลิเวอรี่ — ชีตนี้เก็บแค่ชื่อเมนูกับจำนวน ไม่มีช่องเงิน
 * จึงคูณราคาจากรายการราคาเดียวกับที่ POS ใช้ ได้เป็น "ยอดขายก่อนหักค่าคอม"
 * เป็นตัวประมาณการ ไม่ใช่ยอดที่แพลตฟอร์มโอนเข้าบัญชีจริง
 * ยอดโอนจริงกับค่าคอมมิชชั่น ให้กรอกในชีตบัญชี_รายการเพิ่ม
 */
function accFromDelivery_(year) {
  var priceOf = function (name) {
    if (typeof PRICE_LIST === 'object' && PRICE_LIST && PRICE_LIST[name] !== undefined) return PRICE_LIST[name];
    return (typeof PRICE_DEFAULT === 'number') ? PRICE_DEFAULT : 10;
  };

  var out = [];
  accRead_(typeof SHEET_DELIVERY === 'string' ? SHEET_DELIVERY : 'POS_Delivery').forEach(function (r) {
    var date = accDate_(r['วันที่']);
    if (date.slice(0, 4) !== year) return;

    var amount = 0;
    try {
      JSON.parse(r['ข้อมูล'] || '[]').forEach(function (it) {
        amount += (Number(it.qty) || 0) * priceOf(it.name);
      });
    } catch (e) {}
    if (!amount) return;

    out.push(accEntry_({
      date: date, no: r['เลขที่ออเดอร์'], kind: 'รับ', code: '4110',
      detail: 'เดลิเวอรี่ (ประมาณการจากรายการราคา)',
      branch: r['สาขา'], amount: amount, vatable: true,
      doc: 'ออเดอร์แพลตฟอร์ม', source: 'POS_Delivery'
    }));
  });
  return out;
}

/** เงินสดที่จ่ายออกจากร้าน */
function accFromExpenses_(year) {
  var out = [];
  accRead_(typeof SHEET_EXPENSE === 'string' ? SHEET_EXPENSE : 'POS_Expenses').forEach(function (r) {
    var date = accDate_(r['วันที่']);
    if (date.slice(0, 4) !== year) return;
    var amount = accNum_(r['จำนวนเงิน']);
    if (!amount) return;

    var type = String(r['ประเภท'] || 'อื่น ๆ').trim();
    out.push(accEntry_({
      date: date, no: r['เลขที่'], kind: 'จ่าย',
      code: ACC_EXPENSE_MAP[type] || '6900',
      detail: type + (r['รายละเอียด'] ? ' — ' + r['รายละเอียด'] : ''),
      branch: r['สาขา'], amount: amount,
      doc: 'ไม่ระบุ', source: 'POS_Expenses'
    }));
  });
  return out;
}

/**
 * ซื้อของเข้า (จากไลน์) — เป็นต้นทุนขาย
 * รายการที่ส่งรูปบิลมามีหลักฐานประกอบ ถือว่าเอกสารดีกว่าที่พิมพ์มาเฉย ๆ
 * ตรงนี้สำคัญกับนิติบุคคล เพราะรายจ่ายที่ไม่มีเอกสารหักภาษีไม่ได้
 */
function accFromPurchases_(year) {
  var out = [];
  accRead_(typeof INTAKE_SHEET === 'string' ? INTAKE_SHEET : 'ซื้อของเข้า').forEach(function (r) {
    var date = accDate_(r['วันที่']);
    if (date.slice(0, 4) !== year) return;
    var amount = accNum_(r['จำนวนเงิน']);
    if (!amount) return;

    out.push(accEntry_({
      date: date, no: r['เลขที่'], kind: 'จ่าย', code: '5100',
      detail: 'ซื้อ ' + (r['รายการ'] || '') +
              (accNum_(r['น้ำหนัก(กรัม)']) ? ' ' + accNum_(r['น้ำหนัก(กรัม)']) + ' ก.' : ''),
      branch: r['สถานที่'], amount: amount,
      doc: String(r['ที่มา']).trim() === 'รูป' ? 'มีรูปบิล' : 'ไม่มีเอกสาร',
      source: INTAKE_SHEET
    }));
  });
  return out;
}

/** รายการที่กรอกเอง — เงินเดือน ค่าเช่าตามสัญญา ยอดโอนแพลตฟอร์ม ค่าคอม ฯลฯ */
function accFromManual_(year) {
  var out = [];
  accRead_(ACC_SHEET_MANUAL).forEach(function (r) {
    var date = accDate_(r['วันที่']);
    if (date.slice(0, 4) !== year) return;
    var amount = accNum_(r['จำนวนเงิน']);
    if (!amount) return;

    var code = String(r['รหัสบัญชี'] || '').trim();
    var kind = String(r['รับ/จ่าย'] || '').trim() === 'รับ' ? 'รับ' : 'จ่าย';

    out.push(accEntry_({
      date: date, no: '', kind: kind, code: code || (kind === 'รับ' ? '4900' : '6900'),
      detail: r['รายละเอียด'] || '', branch: '', amount: amount,
      vat: String(r['VAT'] || '').trim() === '' ? null : accNum_(r['VAT']),
      wht: String(r['หัก ณ ที่จ่าย'] || '').trim() === '' ? null : accNum_(r['หัก ณ ที่จ่าย']),
      doc: r['เอกสาร'] || 'ไม่ระบุ', source: ACC_SHEET_MANUAL
    }));
  });
  return out;
}

/** รวมทุกแหล่ง เรียงตามวันที่ */
function accCollect_(year) {
  var all = []
    .concat(accFromOrders_(year))
    .concat(accFromDelivery_(year))
    .concat(accFromExpenses_(year))
    .concat(accFromPurchases_(year))
    .concat(accFromManual_(year));

  all.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.kind === b.kind ? 0 : (a.kind === 'รับ' ? -1 : 1);
  });
  return all;
}

// ══════════════════════════════════════════════════════════════
//  เขียนรายงาน
// ══════════════════════════════════════════════════════════════

function accWriteHead_(sh, headers, note) {
  sh.clear();
  var row = 1;
  if (note) {
    sh.getRange(1, 1).setValue(note).setFontSize(10).setFontColor('#8e8e97');
    row = 2;
  }
  sh.getRange(row, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#fee2e2').setFontColor('#991b1b');
  sh.setFrozenRows(row);
  return row;
}

function accWriteJournal_(entries, year) {
  var sh = accSheet_(ACC_SHEET_JOURNAL);
  var head = accWriteHead_(sh, ACC_JOURNAL_HEADERS,
    'สมุดรายวัน ปี ' + year + ' — สร้างเมื่อ ' +
    Utilities.formatDate(new Date(), accTz_(), 'd/M/yyyy HH:mm') +
    ' · ชีตนี้ระบบเขียนทับทุกครั้งที่สร้างใหม่ ห้ามแก้ในนี้');

  if (!entries.length) {
    sh.getRange(head + 1, 1).setValue('ยังไม่มีรายการในปีนี้');
    return sh;
  }

  var rows = entries.map(function (e) {
    return [e.date, e.no, e.kind, e.code, accAccountName_(e.code), e.detail, e.branch,
            e.amount, e.base, e.vat || '', e.wht || '', e.net, e.doc, e.source];
  });

  sh.getRange(head + 1, 1, rows.length, ACC_JOURNAL_HEADERS.length).setValues(rows);
  sh.getRange(head + 1, 1, rows.length, 1).setNumberFormat('@');
  sh.getRange(head + 1, 8, rows.length, 5).setNumberFormat('#,##0.00');
  sh.autoResizeColumns(1, 7);
  return sh;
}

/** ยอดรวมของรหัสบัญชีนั้น แยกตามเดือน 0..11 */
function accByMonth_(entries) {
  var map = {};
  entries.forEach(function (e) {
    var m = parseInt(e.date.slice(5, 7), 10) - 1;
    if (isNaN(m) || m < 0 || m > 11) return;
    if (!map[e.code]) map[e.code] = new Array(12).fill(0);
    map[e.code][m] = accRound_(map[e.code][m] + e.base);
  });
  return map;
}

function accWritePL_(entries, year) {
  var sh = accSheet_(ACC_SHEET_PL);
  var headers = ['รหัส', 'บัญชี'].concat(ACC_MONTHS).concat(['รวมทั้งปี']);
  var head = accWriteHead_(sh, headers,
    'งบกำไรขาดทุน ปี ' + year + (accVatOn_() ? ' (ตัวเลขไม่รวม VAT)' : '') +
    ' — สร้างเมื่อ ' + Utilities.formatDate(new Date(), accTz_(), 'd/M/yyyy HH:mm'));

  var byCode = accByMonth_(entries);
  var rows = [], bold = [], groups = ['รายได้', 'ต้นทุนขาย', 'ค่าใช้จ่าย'];
  var sums = {};

  var sumRow = function (label, arr) {
    return ['', label].concat(arr.map(function (n) { return accRound_(n); }))
      .concat([accRound_(arr.reduce(function (a, b) { return a + b; }, 0))]);
  };
  var addArr = function (a, b) { return a.map(function (n, i) { return n + b[i]; }); };

  groups.forEach(function (g) {
    var total = new Array(12).fill(0);
    rows.push(['', '── ' + g + ' ──'].concat(new Array(13).fill('')));
    bold.push(rows.length);

    ACC_ACCOUNTS.filter(function (a) { return a.group === g; }).forEach(function (a) {
      var arr = byCode[a.code] || new Array(12).fill(0);
      total = addArr(total, arr);
      rows.push([a.code, a.name].concat(arr.map(function (n) { return n || ''; }))
        .concat([accRound_(arr.reduce(function (x, y) { return x + y; }, 0)) || '']));
    });

    rows.push(sumRow('รวม' + g, total));
    bold.push(rows.length);
    sums[g] = total;
  });

  var gross = sums['รายได้'].map(function (n, i) { return accRound_(n - sums['ต้นทุนขาย'][i]); });
  var net   = gross.map(function (n, i) { return accRound_(n - sums['ค่าใช้จ่าย'][i]); });

  rows.push(new Array(15).fill(''));
  rows.push(sumRow('กำไรขั้นต้น', gross));           bold.push(rows.length);
  rows.push(sumRow('กำไร (ขาดทุน) สุทธิ', net));      bold.push(rows.length);

  sh.getRange(head + 1, 1, rows.length, headers.length).setValues(rows);
  sh.getRange(head + 1, 3, rows.length, 13).setNumberFormat('#,##0.00');
  bold.forEach(function (r) {
    sh.getRange(head + r, 1, 1, headers.length).setFontWeight('bold').setBackground('#f6f6f7');
  });
  sh.setColumnWidth(2, 260);
  return { sheet: sh, net: net, revenue: sums['รายได้'], cogs: sums['ต้นทุนขาย'], expense: sums['ค่าใช้จ่าย'] };
}

function accWriteTax_(entries, year) {
  var sh = accSheet_(ACC_SHEET_TAX);
  var headers = ['เดือน', 'VAT ขาย', 'VAT ซื้อ', 'VAT ต้องนำส่ง', 'หัก ณ ที่จ่ายที่หักไว้',
                 'รายจ่ายที่ยังไม่มีเอกสาร'];
  var note = accVatOn_()
    ? 'สรุปภาษี ปี ' + year + ' — ตัวช่วยคำนวณเท่านั้น ไม่ใช่แบบยื่นภาษี ให้ผู้ทำบัญชีตรวจก่อนยื่น ภ.พ.30 / ภ.ง.ด.53'
    : 'สรุปภาษี ปี ' + year + ' — ยังปิด VAT อยู่ (ACC_VAT = off) ช่อง VAT จึงเป็น 0';
  var head = accWriteHead_(sh, headers, note);

  var vatOut = new Array(12).fill(0), vatIn = new Array(12).fill(0);
  var wht = new Array(12).fill(0), noDoc = new Array(12).fill(0);

  entries.forEach(function (e) {
    var m = parseInt(e.date.slice(5, 7), 10) - 1;
    if (isNaN(m) || m < 0 || m > 11) return;
    if (e.kind === 'รับ') vatOut[m] = accRound_(vatOut[m] + e.vat);
    else {
      vatIn[m] = accRound_(vatIn[m] + e.vat);
      wht[m]   = accRound_(wht[m] + e.wht);
      if (e.doc === 'ไม่มีเอกสาร' || e.doc === 'ไม่ระบุ') noDoc[m] = accRound_(noDoc[m] + e.amount);
    }
  });

  var rows = ACC_MONTHS.map(function (name, m) {
    return [name, vatOut[m] || '', vatIn[m] || '', accRound_(vatOut[m] - vatIn[m]) || '',
            wht[m] || '', noDoc[m] || ''];
  });
  var tot = function (a) { return accRound_(a.reduce(function (x, y) { return x + y; }, 0)); };
  rows.push(['รวมทั้งปี', tot(vatOut), tot(vatIn), accRound_(tot(vatOut) - tot(vatIn)), tot(wht), tot(noDoc)]);

  sh.getRange(head + 1, 1, rows.length, headers.length).setValues(rows);
  sh.getRange(head + 1, 2, rows.length, 5).setNumberFormat('#,##0.00');
  sh.getRange(head + rows.length, 1, 1, headers.length).setFontWeight('bold').setBackground('#f6f6f7');
  sh.autoResizeColumns(1, headers.length);
  return { noDocTotal: tot(noDoc) };
}

// ══════════════════════════════════════════════════════════════
//  ฟังก์ชันที่เรียกใช้จริง
// ══════════════════════════════════════════════════════════════

/** รันครั้งเดียว — สร้างชีตผังบัญชีกับชีตกรอกเอง แล้วบอกว่าตั้งค่าอะไรไว้ */
function setupAccounting() {
  var coa = accSheet_(ACC_SHEET_COA);
  accWriteHead_(coa, ['รหัสบัญชี', 'ชื่อบัญชี', 'หมวด'],
    'ผังบัญชี — ส่งให้ผู้ทำบัญชีจับคู่กับรหัสในโปรแกรมของเขา');
  coa.getRange(3, 1, ACC_ACCOUNTS.length, 3).setValues(
    ACC_ACCOUNTS.map(function (a) { return [a.code, a.name, a.group]; }));
  coa.autoResizeColumns(1, 3);

  var man = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ACC_SHEET_MANUAL);
  if (!man) {
    man = accSheet_(ACC_SHEET_MANUAL);
    accWriteHead_(man, ACC_MANUAL_HEADERS,
      'กรอกเองตรงนี้ — เงินที่ระบบไม่รู้ เช่น เงินเดือน ค่าเช่าตามสัญญา ยอดโอนจากแพลตฟอร์ม ' +
      'ค่าคอมมิชชั่น ดอกเบี้ย · ชีตนี้ระบบไม่เขียนทับ');
    man.getRange(3, 1, 2, ACC_MANUAL_HEADERS.length).setValues([
      ['2026-01-31', 'จ่าย', '6200', 'เงินเดือนพนักงาน ม.ค.', 24000, '', '', 'สลิปโอน', 'ตัวอย่าง — ลบทิ้งได้'],
      ['2026-01-31', 'จ่าย', '6500', 'ค่าคอมมิชชั่น Grab ม.ค.', 3500, '', '', 'ใบแจ้งยอด', 'ตัวอย่าง — ลบทิ้งได้']
    ]);
    man.getRange(3, 1, man.getMaxRows() - 2, 1).setNumberFormat('@');
    man.autoResizeColumns(1, ACC_MANUAL_HEADERS.length);
    Logger.log('สร้างชีต "' + ACC_SHEET_MANUAL + '" พร้อมตัวอย่าง 2 แถว (ลบทิ้งได้)');
  } else {
    Logger.log('มีชีต "' + ACC_SHEET_MANUAL + '" อยู่แล้ว — ไม่แตะข้อมูลเดิม');
  }

  Logger.log('\nการตั้งค่าตอนนี้');
  Logger.log('  ACC_VAT = ' + (accVatOn_() ? 'on — ถอด VAT 7% ออกจากยอดขาย' : 'off — ไม่คิด VAT (ค่าเริ่มต้น)'));
  Logger.log('  ACC_WHT = ' + (accWhtOn_() ? 'on — คำนวณหัก ณ ที่จ่ายค่าเช่า 5% ให้' : 'off — ไม่คำนวณ (ค่าเริ่มต้น)'));
  Logger.log('\n⚠️ จดทะเบียน VAT แล้วต้องตั้ง ACC_VAT = on ไม่งั้นตัวเลขจะผิด');
  Logger.log('\nต่อไปรัน buildAccountingThisYear() เพื่อสร้างรายงาน');
}

/** สร้างรายงานทั้งหมดของปีที่ระบุ เช่น buildAccounting('2026') */
function buildAccounting(year) {
  year = String(year || new Date().getFullYear());

  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    var entries = accCollect_(year);
    accWriteJournal_(entries, year);
    var pl  = accWritePL_(entries, year);
    var tax = accWriteTax_(entries, year);

    var revenue = pl.revenue.reduce(function (a, b) { return a + b; }, 0);
    var net     = pl.net.reduce(function (a, b) { return a + b; }, 0);

    Logger.log('สร้างรายงานปี ' + year + ' เสร็จแล้ว — ' + entries.length + ' รายการ');
    Logger.log('  รายได้รวม        ' + accMoney_(revenue) + ' บาท');
    Logger.log('  กำไร(ขาดทุน)สุทธิ ' + accMoney_(net) + ' บาท');
    if (tax.noDocTotal > 0) {
      Logger.log('  ⚠️ รายจ่ายที่ยังไม่มีเอกสาร ' + accMoney_(tax.noDocTotal) +
                 ' บาท — ส่วนนี้นิติบุคคลหักเป็นรายจ่ายทางภาษีไม่ได้');
    }
    return { year: year, count: entries.length, revenue: revenue, net: net };
  } finally {
    lock.releaseLock();
  }
}

function buildAccountingThisYear() {
  return buildAccounting(Utilities.formatDate(new Date(), accTz_(), 'yyyy'));
}

function accMoney_(n) {
  var v = accRound_(n);
  var neg = v < 0;
  var s = String(Math.abs(v).toFixed(2)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + s;
}

/**
 * สรุปสั้น ๆ ของเดือนที่ระบุ ไว้ตอบในไลน์
 * อ่านจากข้อมูลดิบตรง ๆ ไม่ต้องรอสร้างรายงานก่อน
 */
function accMonthSummary_(yyyymm) {
  var year  = yyyymm.slice(0, 4);
  var month = yyyymm.slice(0, 7);

  var entries = accCollect_(year).filter(function (e) { return e.date.slice(0, 7) === month; });
  if (!entries.length) return '📒 เดือน ' + month + ' ยังไม่มีรายการครับ';

  var byGroup = { 'รายได้': 0, 'ต้นทุนขาย': 0, 'ค่าใช้จ่าย': 0 };
  var groupOf = {};
  ACC_ACCOUNTS.forEach(function (a) { groupOf[a.code] = a.group; });

  var noDoc = 0, byCode = {};
  entries.forEach(function (e) {
    var g = groupOf[e.code] || 'ค่าใช้จ่าย';
    byGroup[g] = accRound_(byGroup[g] + e.base);
    byCode[e.code] = accRound_((byCode[e.code] || 0) + e.base);
    if (e.kind === 'จ่าย' && (e.doc === 'ไม่มีเอกสาร' || e.doc === 'ไม่ระบุ')) {
      noDoc = accRound_(noDoc + e.amount);
    }
  });

  var net = accRound_(byGroup['รายได้'] - byGroup['ต้นทุนขาย'] - byGroup['ค่าใช้จ่าย']);
  var m = parseInt(month.slice(5, 7), 10) - 1;

  var lines = ['📒 งบเดือน ' + ACC_MONTHS[m] + ' ' + year, ''];
  lines.push('รายได้        ' + accMoney_(byGroup['รายได้']));
  lines.push('ต้นทุนขาย     -' + accMoney_(byGroup['ต้นทุนขาย']));
  lines.push('ค่าใช้จ่าย     -' + accMoney_(byGroup['ค่าใช้จ่าย']));
  lines.push('─────────────');
  lines.push((net >= 0 ? 'กำไรสุทธิ     ' : 'ขาดทุนสุทธิ   ') + accMoney_(net) + ' บาท');

  var top = Object.keys(byCode).filter(function (c) { return (groupOf[c] || '') !== 'รายได้'; })
    .sort(function (a, b) { return byCode[b] - byCode[a]; }).slice(0, 3);
  if (top.length) {
    lines.push('', 'จ่ายมากสุด');
    top.forEach(function (c) { lines.push('• ' + accAccountName_(c) + ' ' + accMoney_(byCode[c])); });
  }

  if (noDoc > 0) {
    lines.push('', '⚠️ รายจ่ายไม่มีเอกสาร ' + accMoney_(noDoc) + ' บาท');
    lines.push('ส่วนนี้หักเป็นรายจ่ายทางภาษีไม่ได้ — ถ่ายบิลส่งมาเก็บไว้ด้วยครับ');
  }
  lines.push('', 'ตัวเลขนี้ยังไม่ผ่านผู้ทำบัญชี ใช้ดูภายในร้าน');
  return lines.join('\n');
}

/** ดูงบเดือนนี้ใน Log โดยไม่ต้องสร้างรายงาน */
function previewAccountingThisMonth() {
  Logger.log(accMonthSummary_(Utilities.formatDate(new Date(), accTz_(), 'yyyy-MM')));
}
