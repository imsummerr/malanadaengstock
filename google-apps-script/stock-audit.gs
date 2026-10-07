/************************************************************
 * 🔔 เตือนเช็คสต็อก + แจ้งของหาย
 *
 * 1) เตือนให้นับสต็อก ทุกวันอาทิตย์ และทุกสิ้นเดือน ตอน 1 ทุ่ม
 *    ที่ไหนนับไปแล้ววันนั้น ก็ไม่เตือนซ้ำ
 *
 * 2) พอนับเสร็จ เทียบทันทีว่า "ของที่หายไป" กับ "เงินที่ได้มา" ตรงกันไหม
 *    ไม่ตรงเกินที่กำหนด → แจ้งเข้ากลุ่มไลน์ของที่นั้นเลย
 *      สาขา     — มูลค่าของที่ใช้ไป (หักเดลิเวอรี่) เทียบกับยอดขายจริง
 *      ครัวกลาง — ไม่มีการขาย ของที่ส่งออกสาขาถูกหักให้แล้ว
 *                 ที่ยังขาดอยู่จึงคือของหายล้วน ๆ ไม่ต้องเทียบเงิน
 *
 * ── ทำไมต้องนับให้ตรงเวลา ──
 * ยอดขายไม่ได้ถูกหักออกจากสต็อกทีละบิล การนับจริงจึงเป็นอย่างเดียวที่ทำให้
 * ยอดกลับมาตรง และเป็นจุดตั้งต้นให้รอบถัดไป
 * นับไม่สม่ำเสมอ = ช่วงเทียบกว้างจนหาสาเหตุไม่เจอว่าของหายตอนไหน
 *
 * ⚠️ ตัวเลขในไลน์เป็นตัวเตือนให้รู้ตัวเร็ว ไม่ใช่ตัวตัดสิน
 *    ตัวจริงอยู่ที่หน้าสรุปยอดขาย แท็บ "🔎 คำนวณของหาย" (pos-dashboard.html)
 *    ซึ่งตั้งราคา/หน่วยเองได้ หักน้ำจิ้มแถม แยกดูรายตัว และซ่อนรายการที่ไม่หายได้
 *    ไลน์ใช้ "ราคาขาย/หน่วยย่อย" ในชีตรายการสินค้าเป็นหลัก จึงอาจต่างกันบ้าง
 *    ทุกข้อความจึงบอกตัวเลขดิบที่เอามาเทียบไว้ครบ และชี้ทางไปหน้านั้นเสมอ
 *
 * วิธีติดตั้ง: อ่าน STOCK-AUDIT-README.md ในโฟลเดอร์เดียวกัน
 ************************************************************/

/** เตือนตอนกี่โมง (19 = 1 ทุ่ม) */
var AUDIT_REMIND_HOUR = 19;

/**
 * ของหายเกินกี่บาทถึงจะแจ้ง — 0 = หายเท่าไหร่ก็แจ้ง แม้แต่ชิ้นเดียว
 * ถ้าวันหนึ่งเด้งถี่จนรำคาญ ตั้ง Script Property AUDIT_GAP_BAHT เป็นตัวเลขที่รับได้
 * แต่ค่าเริ่มต้นคือแจ้งหมด เพราะของหาย 20 บาททุกอาทิตย์ ปีหนึ่งก็พันกว่าบาท
 */
var AUDIT_GAP_BAHT = 0;

/** แจ้งรายการที่หายเยอะสุดกี่รายการ */
var AUDIT_TOP_N = 8;

function auditTz_()      { return (typeof TZ === 'string' && TZ) ? TZ : 'Asia/Bangkok'; }
function auditCentral_() { return (typeof CENTRAL === 'string' && CENTRAL) ? CENTRAL : 'ครัวกลาง'; }

function auditTime_(v) {
  if (typeof timeOf_ === 'function') return timeOf_(v);
  if (!v) return 0;
  var d = (v instanceof Date) ? v : new Date(v);
  var t = d.getTime();
  return isNaN(t) ? 0 : t;
}

/** วันนี้เป็นวันสุดท้ายของเดือนไหม — บวกไปอีกวันแล้วดูว่าเป็นวันที่ 1 หรือยัง */
function auditIsMonthEnd_(d) {
  var next = new Date(d.getTime());
  next.setDate(next.getDate() + 1);
  return next.getDate() === 1;
}

/** สถานที่ที่ต้องนับสต็อก — ครัวกลาง + สาขาที่ตั้งกลุ่มไลน์ไว้ */
function auditLocations_() {
  var out = [auditCentral_()];
  var groups = {};
  try {
    if (typeof stockLineGroups_ === 'function') groups = stockLineGroups_() || {};
  } catch (e) {}
  Object.keys(groups).forEach(function (b) { if (out.indexOf(b) === -1) out.push(b); });
  return out;
}

/** ที่นี่นับสต็อกไปแล้ววันนี้หรือยัง */
function auditCountedToday_(loc) {
  if (typeof readMoves_ !== 'function') return false;

  var sheetName = (typeof SHEET_COUNT === 'string') ? SHEET_COUNT : 'เช็คสต็อกรายสัปดาห์';
  var today = Utilities.formatDate(new Date(), auditTz_(), 'yyyy-MM-dd');
  var rows;
  try { rows = readMoves_(sheetName) || []; } catch (e) { return false; }

  for (var i = 0; i < rows.length; i++) {
    if (rows[i].loc !== loc) continue;
    var t = auditTime_(rows[i].when);
    if (t && Utilities.formatDate(new Date(t), auditTz_(), 'yyyy-MM-dd') === today) return true;
  }
  return false;
}

/**
 * เตือนนับสต็อก — trigger รันทุกวัน ตัวมันเองเช็คว่าวันนี้ต้องเตือนไหม
 * ทำแบบนี้เพราะเดือนมี 28-31 วัน ตั้ง trigger วันสิ้นเดือนตรง ๆ ไม่ได้
 */
function remindStockCount() {
  var now = new Date();
  var isSunday   = Number(Utilities.formatDate(now, auditTz_(), 'u')) === 7;
  var isMonthEnd = auditIsMonthEnd_(now);
  if (!isSunday && !isMonthEnd) return;

  var why = (isMonthEnd && isSunday) ? 'วันอาทิตย์ + สิ้นเดือน'
          : isMonthEnd               ? 'สิ้นเดือนแล้ว'
                                     : 'วันอาทิตย์แล้ว';

  auditLocations_().forEach(function (loc) {
    if (auditCountedToday_(loc)) return;   // นับไปแล้ว ไม่ต้องจี้ซ้ำ

    var msg = '📋 ถึงเวลาเช็คสต็อก — ' + loc + '\n\n' +
              why + ' อย่าลืมนับสต็อกให้ครบทุกรายการ\n\n' +
              'เข้าเว็บสต็อก → "เช็คสต็อกรายสัปดาห์"\n' +
              'เลือกสถานที่ ' + loc + ' แล้วนับให้ครบ\n\n' +
              (isMonthEnd ? 'สิ้นเดือนต้องนับให้ครบทุกที่ เพื่อปิดยอดประจำเดือน\n\n' : '') +
              'นับเสร็จแล้วยอดในระบบจะกลับมาตรงกับของจริง\n' +
              'แล้วดูของหายได้ที่หน้าสรุปยอดขาย แท็บ "คำนวณของหาย"';

    try {
      if (typeof stockNotify_ === 'function') stockNotify_(loc, msg);
      else Logger.log('ไม่มี stockNotify_ — ' + msg);
    } catch (e) {
      Logger.log('เตือนนับสต็อก ' + loc + ' ไม่สำเร็จ: ' + e.message);
    }
  });
}

/** รันครั้งเดียว — ตั้ง trigger เตือนนับสต็อก */
function setupStockAuditTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'remindStockCount') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('remindStockCount').timeBased()
    .everyDays(1).atHour(AUDIT_REMIND_HOUR).create();

  Logger.log('ตั้ง trigger แล้ว — เช็คทุกวันตอน ' + AUDIT_REMIND_HOUR + ' น.');
  Logger.log('เตือนเฉพาะวันอาทิตย์กับวันสุดท้ายของเดือน และข้ามที่ที่นับไปแล้ว');
  Logger.log('สถานที่ที่จะเตือน: ' + auditLocations_().join(', '));
}

/** ลองส่งข้อความเตือนเดี๋ยวนี้ ไม่ต้องรอวันอาทิตย์ */
function testRemindNow() {
  auditLocations_().forEach(function (loc) {
    var r = (typeof stockNotify_ === 'function')
      ? stockNotify_(loc, '📋 (ทดสอบ) ถึงเวลาเช็คสต็อก — ' + loc)
      : { sent: false, message: 'ไม่มี stockNotify_' };
    Logger.log(loc + ': ' + (r.sent ? 'ส่งแล้ว ✅' : 'ไม่ได้ส่ง — ' + r.message));
  });
}

/** เช็คว่าใครนับไปแล้วบ้างวันนี้ */
function whoCountedToday() {
  auditLocations_().forEach(function (loc) {
    Logger.log(loc + ': ' + (auditCountedToday_(loc) ? 'นับแล้ว ✅' : 'ยังไม่ได้นับ'));
  });
}

// ══════════════════════════════════════════════════════════════
//  ของหาย — เทียบของที่หายไปกับเงินที่ได้มา ตอนนับสต็อกเสร็จ
// ══════════════════════════════════════════════════════════════

function auditRound_(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function auditGapLimit_() {
  var raw = PropertiesService.getScriptProperties().getProperty('AUDIT_GAP_BAHT');
  var v = Number(raw);
  return (raw !== null && raw !== '' && v > 0) ? v : AUDIT_GAP_BAHT;
}

/** 12340 → "12,340" — เขียนเองแทน toLocaleString จะได้ไม่ขึ้นกับ locale ของโปรเจกต์ */
function auditBaht_(n) {
  var v = Math.round(Number(n) || 0);
  var sign = v < 0 ? '-' : '';
  var s = String(Math.abs(v)), out = '';
  while (s.length > 3) { out = ',' + s.slice(-3) + out; s = s.slice(0, -3); }
  return sign + s + out;
}

/** yyyy-MM-dd HH:mm:ss — ใช้เทียบช่วงเวลาแบบ string ได้ตรง ๆ เพราะเลขเรียงตัวอยู่แล้ว */
function auditStamp_(d) { return Utilities.formatDate(d, auditTz_(), 'yyyy-MM-dd HH:mm:ss'); }

function auditShort_(d) { return Utilities.formatDate(d, auditTz_(), 'd/M/yyyy HH:mm'); }

/** เติมศูนย์หน้าชั่วโมง — "9:05" เทียบ string กับ "10:00" แล้วจะกลับด้าน ถ้าไม่เติม */
function auditPadTime_(v) {
  var m = String(v == null ? '' : v).trim().match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return '00:00:00';
  return ('0' + m[1]).slice(-2) + ':' + m[2] + ':' + (m[3] || '00');
}

/** วันที่+เวลาของแถวหนึ่ง เป็น string ที่เทียบกันได้ */
function auditRowStamp_(dateCell, timeCell) {
  var d = (typeof normDate_ === 'function') ? normDate_(dateCell) : String(dateCell || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  return d + ' ' + auditPadTime_(timeCell);
}

/**
 * เวลาที่นับสต็อกที่นี่ "ครั้งก่อนหน้า" — ไม่ใช่ครั้งที่เพิ่งนับไป
 * เผื่อ 60 วินาที เพราะแถวที่เพิ่งเขียนอาจถูกชีตปัดมิลลิวินาทีจนต่ำกว่า now นิดเดียว
 * ถ้าไม่เผื่อ มันจะหยิบรอบที่เพิ่งนับมาเป็น "รอบก่อน" แล้วช่วงเทียบกลายเป็นศูนย์
 */
function auditPrevCountTime_(loc, now) {
  if (typeof readMoves_ !== 'function') return 0;
  var sheetName = (typeof SHEET_COUNT === 'string') ? SHEET_COUNT : 'เช็คสต็อกรายสัปดาห์';
  var cutoff = now.getTime() - 60000;
  var rows;
  try { rows = readMoves_(sheetName) || []; } catch (e) { return 0; }

  var best = 0;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].loc !== loc) continue;
    // เช็คระดับไม่มีตัวเลข ไม่ใช่รอบนับ
    if (typeof KIND_LEVEL_COUNT === 'string' && rows[i].kind === KIND_LEVEL_COUNT) continue;
    // นับก่อนวันเริ่มนับใหม่ไม่ใช่ "รอบก่อน" — รอบแรกหลังเส้นคือรอบฐาน
    // ไม่งั้นจะไปเทียบกับยอดเดือนก่อนแล้วขึ้นว่านับเกินเป็นร้อยชิ้น
    if (typeof costBefore_ === 'function' && costBefore_(rows[i].when, loc)) continue;
    var t = auditTime_(rows[i].when);
    if (t && t < cutoff && t > best) best = t;
  }
  return best;
}

/**
 * ของที่ขายออกไปจริง + เงินที่ได้ ในช่วงที่กำหนด
 *   pieces    = รวมไม้ + รวมมาม่า + รวมของอื่น = จำนวนชิ้นที่ขายหน้าร้าน (มีเงิน)
 *   dlvPieces = ชิ้นที่ออกไปกับเดลิเวอรี่ — ของออกจริงแต่เงินไปเข้าที่แพลตฟอร์ม
 *   sauceCups = ถ้วยน้ำจิ้มที่แถมไป — ของออกจริง ไม่มีเงิน
 *   gross     = ยอดรวมก่อนหักส่วนลด · discount = ส่วนลดที่ให้ลูกค้า
 *   revenue   = ยอดสุทธิ = gross − discount = เงินที่ได้จริง
 */
function auditSales_(loc, fromStamp, toStamp) {
  var out = { revenue: 0, gross: 0, discount: 0, orders: 0,
              pieces: 0, sticks: 0, mama: 0, other: 0,
              sauceCups: 0, dlvPieces: 0, dlvOrders: 0 };
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  /**
   * อ่านเฉพาะแถวในช่วงที่ต้องการ — ชีตบิลโตวันละหลายสิบแถว อ่านทั้งชีตทุกครั้งจะช้าขึ้นเรื่อย ๆ
   * อ่านคอลัมน์วันที่ก่อน (เบา) ไล่จากล่างขึ้นบนหาแถวแรกของช่วง แล้วค่อยอ่านเฉพาะส่วนนั้น
   * บิลที่ส่งค้างแล้วขึ้นทีหลังอาจวันที่เก่ากว่าแถวข้างบน — เจอแถวเก่ากว่าติดกัน 30 แถวถึงจะหยุด
   */
  function scan(sheetName, fn) {
    var sh = ss.getSheetByName(sheetName);
    var last = sh ? sh.getLastRow() : 0;
    if (last < 2) return;
    var width = sh.getLastColumn();
    var head = sh.getRange(1, 1, 1, width).getDisplayValues()[0];
    var idx = {};
    head.forEach(function (h, i) { idx[String(h).trim()] = i; });
    if (idx['วันที่'] === undefined) return;
    var fromDay = String(fromStamp).slice(0, 10), start = last - 1, older = 0;
    var dates = sh.getRange(2, idx['วันที่'] + 1, last - 1, 1).getDisplayValues();
    for (var d = dates.length - 1; d >= 0; d--) {
      var dk = (typeof normDate_ === 'function') ? normDate_(dates[d][0]) : String(dates[d][0]);
      if (dk && dk < fromDay) { if (++older >= 30) break; } else { older = 0; start = d; }
    }
    if (start > last - 2) return;
    var v = [head].concat(sh.getRange(start + 2, 1, last - 1 - start, width).getDisplayValues());
    for (var i = 1; i < v.length; i++) {
      var stamp = auditRowStamp_(v[i][idx['วันที่']], v[i][idx['เวลา']]);
      if (!stamp || stamp <= fromStamp || stamp > toStamp) continue;
      var b = idx['สาขา'] !== undefined ? v[i][idx['สาขา']] : '';
      var same = (typeof sameBranch_ === 'function')
        ? sameBranch_(b, loc) : String(b || '').trim() === loc;
      if (!same) continue;
      fn(v[i], idx);
    }
  }

  var n = function (x) { return (typeof num_ === 'function') ? num_(x) : (parseFloat(String(x).replace(/,/g, '')) || 0); };

  // เงินที่ไม่ได้อยู่ในลิ้นชัก — ลูกค้าสแกน/โอนเข้าบัญชี กับค่าใช้จ่ายที่หยิบเงินสดไปจ่าย
  // เงินสดคือ "เงินสด" (หรือช่องว่างของแถวเก่า) อย่างเดียว — โอน / ไทยช่วยไทย ไม่เข้าลิ้นชัก
  out.transfer = 0; out.cashSales = 0; out.expCash = 0; out.expOther = 0; out.expenses = [];
  out.byMethod = {}; out.redeem = 0; out.untracked = 0;
  // อ่านชีตบิลรอบเดียว เก็บทุกอย่างที่ต้องใช้ (เดิมอ่านสองรอบ)
  out.firstStamp = ''; out.lastStamp = '';
  scan((typeof SHEET_ORDERS === 'string') ? SHEET_ORDERS : 'POS_Orders', function (r, idx) {
    out.orders++;
    var st = auditRowStamp_(r[idx['วันที่']], r[idx['เวลา']]);
    if (!out.firstStamp || st < out.firstStamp) out.firstStamp = st;
    if (st > out.lastStamp) out.lastStamp = st;
    if (idx['ส่วนลดแต้ม'] !== undefined) out.redeem += n(r[idx['ส่วนลดแต้ม']]);
    if (idx['ยอดมาม่า'] !== undefined) out.untracked += n(r[idx['ยอดมาม่า']]);
    if (idx['ยอดของอื่น'] !== undefined) out.untracked += n(r[idx['ยอดของอื่น']]);
    var how = idx['วิธีชำระเงิน'] !== undefined ? String(r[idx['วิธีชำระเงิน']] || '').trim() : '';
    var net = n(r[idx['ยอดสุทธิ']]);
    if (!how || how === 'เงินสด') out.cashSales += net;
    else { out.transfer += net; out.byMethod[how] = auditRound_((out.byMethod[how] || 0) + net); }
    out.gross    += n(r[idx['ยอดรวม']]);
    out.discount += n(r[idx['ส่วนลด']]);
    out.revenue  += n(r[idx['ยอดสุทธิ']]);
    out.sticks   += n(r[idx['รวมไม้']]);
    out.mama     += n(r[idx['รวมมาม่า']]);
    out.other    += (idx['รวมของอื่น'] !== undefined ? n(r[idx['รวมของอื่น']]) : 0);
    out.sauceCups += (idx['จำนวนน้ำจิ้ม'] !== undefined ? n(r[idx['จำนวนน้ำจิ้ม']]) : 0);
  });
  out.pieces = out.sticks + out.mama + out.other;

  scan((typeof SHEET_EXPENSE === 'string') ? SHEET_EXPENSE : 'POS_Expenses', function (r, idx) {
    var amt = n(r[idx['จำนวนเงิน']]);
    var how = idx['วิธีจ่าย'] !== undefined ? String(r[idx['วิธีจ่าย']] || '').trim() : '';
    // แถวเก่าที่ช่องวิธีจ่ายว่าง = เงินสด (ตามที่ตั้งไว้ใน EXPENSE_HEADERS)
    if (!how || how === 'เงินสด') out.expCash += amt; else out.expOther += amt;
    out.expenses.push({ type: idx['ประเภท'] !== undefined ? r[idx['ประเภท']] : '',
                        amount: amt, cash: !how || how === 'เงินสด' });
  });
  out.transfer = auditRound_(out.transfer);
  out.redeem = auditRound_(out.redeem);
  out.untracked = auditRound_(out.untracked);
  out.cashSales = auditRound_(out.cashSales);
  out.expCash = auditRound_(out.expCash);
  out.expOther = auditRound_(out.expOther);

  scan((typeof SHEET_DELIVERY === 'string') ? SHEET_DELIVERY : 'POS_Delivery', function (r, idx) {
    out.dlvOrders++;
    out.dlvPieces += n(r[idx['รวมจำนวน']]);
  });

  out.revenue  = auditRound_(out.revenue);
  out.gross    = auditRound_(out.gross);
  out.discount = auditRound_(out.discount);
  return out;
}

/**
 * สินค้าตัวนี้ขายเป็นอะไร — ต้องรู้ว่าจะเอาไปเทียบกับตัวเลขไหนใน POS
 *   piece = นับเป็นชิ้น (ไม้ ถุง มัด ที่ อัน) → เทียบกับ รวมไม้+รวมมาม่า+รวมของอื่น
 *   sauce = ถ้วยน้ำจิ้ม                      → เทียบกับ จำนวนน้ำจิ้ม
 *   other = หน่วยที่ POS ไม่ได้นับ            → เทียบไม่ได้ รายงานเฉย ๆ
 *
 * ครัวกลางซื้อเข้าเป็นกิโล แต่ชีตสต็อกนับ "หลังเสียบไม้/จัดถุงแล้ว" เสมอ
 * เจอหน่วยกรัม/กิโลในชีตนี้ = ยังไม่ได้ตั้งหน่วย ไม่ใช่ของที่ขายเป็นกิโลจริง
 * รัน fixItemList ใน pos-backend.gs เพื่อตั้งหน่วยและราคาให้ครบ
 */
// ทุกหน่วยที่ "นับเป็นชิ้นแล้วขายชิ้นละ 10" — POS นับรวมกันหมดใน รวมไม้
// ตกหล่นตัวไหน ของตัวนั้นจะหลุดไปกลุ่ม "เทียบไม่ได้" แล้วของหายจะไม่ถูกจับ
// ห่อ = มาม่า ซึ่งหน้าร้านนับรวมใน "ชิ้นที่ขาย" ด้วย ต้องอยู่ฝั่งเดียวกัน
var AUDIT_PIECE_UNITS = ['ไม้', 'ถุง', 'มัด', 'ที่', 'อัน', 'ชิ้น', 'ท่อน', 'กระปุก', 'แผ่น', 'ห่อ'];
var AUDIT_RAW_UNITS   = /^(กรัม|กก\.?|กิโล|กิโลกรัม|g|kg)$/i;

function auditGroupOf_(item) {
  var name = String(item.name || '');
  if (/น้ำจิ้ม|ถ้วย/.test(name)) return 'sauce';
  return AUDIT_PIECE_UNITS.indexOf(String(item.subUnit || '').trim()) !== -1 ? 'piece' : 'other';
}

/**
 * นับของที่ใช้ไปในช่วงนี้ แยกตามกลุ่มหน่วยขาย
 * counts = [{ item, counted, sys, diff }]  โดย diff = นับได้ − ยอดระบบ
 *   ยอดระบบ = ยกมา + ของเข้า − ของเสีย   (ยอดขายไม่ได้ถูกหักทีละบิล)
 *   ดังนั้น −diff = ยกมา + ของเข้า − ของเสีย − นับได้ = "ของที่หายไปจากชั้น"
 * ตัวนี้ยังรวมของที่ขายไปอยู่ ต้องเอายอดขายจริงจาก POS มาหักอีกที
 */
function auditUsage_(counts) {
  var g = {
    piece: { used: 0, value: 0, items: [] },
    sauce: { used: 0, value: 0, items: [] },
    other: { used: 0, value: 0, items: [] },
    free:  { used: 0, value: 0, items: [] }      // ของแถม (กะหล่ำ) — บอกให้รู้ ไม่นับเป็นของหาย
  };
  var overs = [], noPrice = [], rawUnits = [];

  (counts || []).forEach(function (c) {
    var it = c.item;
    if (!it) return;
    if (it.free) {
      var fu = Math.round((-c.diff) * 1000) / 1000;
      g.free.used += fu;
      if (fu > 0) g.free.items.push({ name: it.name, qty: fu, unit: it.subUnit, value: 0 });
      return;
    }
    // ยอดเก็บเป็นชิ้นสำหรับของที่ไม้หนึ่งมีหลายชิ้น (เต้าชีส 2 ชิ้น/ไม้) แต่ POS กับราคาเป็น "ต่อไม้"
    // ไม่แปลงก่อน เต้าชีส 30 ชิ้นจะกลายเป็นขาย 30 ไม้ = 300 บาท แทนที่จะเป็น 15 ไม้ = 150
    var per = (typeof perStickOf_ === 'function') ? perStickOf_(it) : 1;
    var used = Math.round((-c.diff) / per * 1000) / 1000;
    var k = auditGroupOf_(it);
    if (k === 'other' && used > 0 && AUDIT_RAW_UNITS.test(String(it.subUnit || '').trim())) {
      rawUnits.push(it.name);
    }
    g[k].used += used;
    if (it.price > 0) g[k].value += used * it.price;
    else if (used > 0 && k !== 'sauce') noPrice.push(it.name);

    if (used > 0) g[k].items.push({ name: it.name, qty: used, unit: it.subUnit,
                                    value: auditRound_(used * (it.price || 0)) });
    else if (used < 0) overs.push({ name: it.name, qty: -used, unit: it.subUnit });
  });

  Object.keys(g).forEach(function (k) {
    g[k].used = Math.round(g[k].used * 1000) / 1000;
    g[k].value = auditRound_(g[k].value);
    g[k].items.sort(function (a, b) { return b.qty - a.qty; });
  });
  g.overs = overs;
  g.noPrice = noPrice;
  g.rawUnits = rawUnits;
  return g;
}

/**
 * เทียบของหาย — เรียกจาก handleStockCount_ ทันทีที่นับเสร็จ
 *
 * สูตร (นับเป็นชิ้น ไม่ใช่เป็นบาท):
 *   ควรเหลือ = ยกมา + ของเข้า − ของเสีย − ขายหน้าร้าน − เดลิเวอรี่ − น้ำจิ้มแถม
 *   ของหาย   = ควรเหลือ − ที่นับได้จริง
 *
 * เทียบเป็นชิ้นเพราะ POS รู้ว่าขายไปกี่ไม้จริง ๆ ไม่ต้องผ่านราคาเลย
 * ถ้าเทียบเป็นบาท ราคาในชีตผิดนิดเดียวก็เพี้ยนทั้งก้อน และส่วนลดจะถูกนับซ้ำ
 * ราคาเอาไว้แปลงของที่หายเป็นเงินตอนท้ายเท่านั้น
 *
 * เงิน: ยอดรวม − ส่วนลดที่แถมลูกค้า = ยอดสุทธิ = เงินที่ควรได้
 * ส่วนลดจึงไม่ถูกนับเป็นของหาย เพราะของออกไปจริงและตั้งใจให้ไป
 *
 * ครัวกลางไม่ได้ขายของ และของที่ส่งไปสาขาถูกหักออกจากยอดระบบแล้ว
 * ของที่ใช้ไปทั้งหมดจึงคือของหายเลย ไม่ต้องหักอะไร
 *
 * คืน object สรุปเสมอ ส่งไลน์ไม่สำเร็จก็ไม่ throw — ของลงชีตไปแล้ว
 */
function auditAfterCount_(loc, counts, now) {
  loc = String(loc || '').trim();
  now = now || new Date();

  var prevMs = auditPrevCountTime_(loc, now);
  if (!prevMs) {
    // รอบแรกของที่นี่ ยังไม่มีอะไรให้เทียบ แต่ต้องบอก ไม่งั้นจะนึกว่าระบบไม่ทำงาน
    var base = { alerted: false, loc: loc,
                 reason: 'รอบฐาน — ยังไม่เคยนับที่นี่มาก่อน จึงยังไม่มีอะไรให้เทียบ',
                 text: '📋 ' + loc + ' นับสต็อกรอบแรกแล้ว\n\n' +
                       'รอบนี้เป็น "รอบฐาน" ยังไม่มีรอบก่อนหน้าให้เทียบ\n' +
                       'นับรอบหน้าเมื่อไหร่ ระบบจะเริ่มบอกของหายให้' };
    try {
      if (typeof stockNotify_ === 'function') {
        var b = stockNotify_(loc, base.text);
        base.lineSent = b.sent; base.lineMsg = b.message;
      }
    } catch (e) { base.lineMsg = e.message; }
    return base;
  }

  var prev = new Date(prevMs);
  var g = auditUsage_(counts);
  var limit = auditGapLimit_();
  var isCentral = (loc === auditCentral_());

  // ราคาเฉลี่ยของ "ของที่ออกจากชั้นไปจริง" ในช่วงนี้ ใช้แปลงชิ้นที่หายเป็นเงิน
  // ไม่ใช้ราคาขายเฉลี่ยจากบิล เพราะของที่หายอาจไม่ใช่ของที่ขายดี
  var perPiece = g.piece.used > 0 ? g.piece.value / g.piece.used : 0;

  var result = { loc: loc, from: auditShort_(prev), to: auditShort_(now),
                 usedPieces: g.piece.used, usedValue: g.piece.value,
                 limit: limit, alerted: false };

  var head = 'ช่วงที่เทียบ ' + auditShort_(prev) + ' → ' + auditShort_(now);
  var lines = [];
  var lostPieces, lostValue, lostSauce = 0, s = null;

  /**
   * ส่งข้อความสั้น ๆ แล้วจบ — ใช้กับกรณีที่ยังไม่มีของหายให้แจ้ง
   * เงียบไปเฉย ๆ ไม่ได้ เพราะแยกไม่ออกว่า "ของครบ" กับ "โค้ดไม่ทำงาน/หน่วยพัง"
   * ซึ่งเคยเกิดมาแล้วตอนราคาเป็น 0 ทั้งชีต แล้วไม่มีใครรู้ว่าระบบเงียบอยู่
   */
  function say_(text, reason) {
    result.reason = reason;
    result.text = text;
    try {
      if (typeof stockNotify_ === 'function') {
        var r = stockNotify_(loc, text);
        result.lineSent = r.sent;
        result.lineMsg = r.message;
      }
    } catch (e) { result.lineMsg = e.message; }
    return result;
  }

  if (isCentral) {
    lostPieces = g.piece.used;
    lostValue  = g.piece.value;
    lostSauce  = g.sauce.used;
  } else {
    s = auditSales_(loc, auditStamp_(prev), auditStamp_(now));
    if (!s.orders && !s.dlvOrders) {
      return say_('📋 ' + loc + ' นับสต็อกแล้ว แต่ช่วงนี้ไม่มีบิลขายเลย\n' +
                  head + '\nยังไม่มีอะไรให้หัก เลยเทียบของหายไม่ได้',
                  'ไม่มีบิลขายในช่วงนี้เลย ยังไม่มีอะไรให้หัก');
    }
    lostPieces = Math.round((g.piece.used - s.pieces - s.dlvPieces) * 1000) / 1000;
    lostValue  = auditRound_(lostPieces * perPiece);
    lostSauce  = Math.round((g.sauce.used - s.sauceCups) * 1000) / 1000;

    result.soldPieces = s.pieces;
    result.deliveryPieces = s.dlvPieces;
    result.gross = s.gross;
    result.discount = s.discount;
    result.revenue = s.revenue;
    result.orders = s.orders;
  }

  result.lostPieces = lostPieces;
  result.lostValue  = lostValue;
  result.lostSauce  = lostSauce;

  // ของหายเท่าไหร่ก็แจ้ง — เกณฑ์เริ่มต้นเป็น 0
  // ดูที่ "จำนวนชิ้น" เป็นหลัก ไม่ใช่มูลค่า เพราะถ้าราคายังไม่ได้ตั้ง
  // มูลค่าจะเป็น 0 แล้วของที่หายจริงจะหลุดไปเงียบ ๆ แบบที่เคยเป็น
  var hasLoss = lostPieces > 0 || lostSauce > 0;
  if (!hasLoss) {
    var okLine = isCentral
      ? 'ออกจากชั้น ' + g.piece.used + ' ชิ้น — ส่งสาขาครบ ไม่มีของหาย'
      : 'ออกจากชั้น ' + g.piece.used + ' ชิ้น · ขายหน้าร้าน ' + s.pieces +
        (s.dlvPieces ? ' · เดลิเวอรี่ ' + s.dlvPieces : '') +
        (lostPieces < 0 ? ' → นับได้เกินที่ควรเหลือ ' + (-lostPieces) + ' ชิ้น'
                        : ' → ครบพอดี');
    var extra = (lostPieces < 0) ? '\nเช็คว่าลงของเข้าครบไหม' : '';
    return say_('✅ ' + loc + ' เช็คสต็อกแล้วของไม่ขาด\n' + head + '\n' + okLine + extra,
                'ไม่มีของหาย');
  }
  if (limit > 0 && lostValue <= limit) {
    return say_('📋 ' + loc + ' ของหาย ' + lostPieces + ' ชิ้น ≈ ' + auditBaht_(lostValue) + ' บาท\n' +
                head + '\nไม่เกินเกณฑ์ที่ตั้งไว้ (' + auditBaht_(limit) + ' บาท)',
                'ของหาย ' + lostPieces + ' ชิ้น ≈ ' + auditBaht_(lostValue) +
                ' บาท ไม่เกินเกณฑ์ ' + auditBaht_(limit));
  }

  if (isCentral) {
    lines.push('⚠️ ครัวกลางนับสต็อกแล้วของไม่ครบ');
    lines.push('');
    lines.push(head);
    lines.push('');
    lines.push('ครัวกลางไม่ได้ขายของ และของที่ส่งไปสาขาถูกหักให้แล้ว');
    lines.push('ที่ยังขาดอยู่จึงยังหาสาเหตุไม่ได้');
    lines.push('');
    lines.push('ของหาย ' + lostPieces + ' ชิ้น ≈ ' + auditBaht_(lostValue) + ' บาท');
  } else {
    lines.push('⚠️ เช็คสต็อกแล้วของหาย — ' + loc);
    lines.push('');
    lines.push(head);
    lines.push('');
    lines.push('ของที่ออกจากชั้น   ' + g.piece.used + ' ชิ้น');
    lines.push('หักขายหน้าร้าน    −' + s.pieces + ' ชิ้น');
    if (s.dlvPieces > 0) lines.push('หักเดลิเวอรี่      −' + s.dlvPieces + ' ชิ้น');
    lines.push('');
    lines.push('ของหาย ' + lostPieces + ' ชิ้น ≈ ' + auditBaht_(lostValue) + ' บาท');
    lines.push('');
    lines.push('เงินที่ได้');
    lines.push('  ยอดขาย   ' + auditBaht_(s.gross) + ' บาท  (' + s.orders + ' บิล)');
    if (s.discount > 0) lines.push('  ส่วนลด    −' + auditBaht_(s.discount) + ' บาท');
    lines.push('  ได้จริง   ' + auditBaht_(s.revenue) + ' บาท');
  }

  // น้ำจิ้มแถมออกไปจริงแต่ไม่มีเงิน หักแล้วยังขาดแปลว่าถ้วยหายเพิ่ม
  if (g.free.items.length) {
    lines.push('');
    lines.push('ของแถม (ไม่คิดเงิน ไม่นับเป็นของหาย): ' +
               g.free.items.map(function (x) { return x.name + ' ' + x.qty + ' ' + x.unit; }).join(', '));
  }
  if (lostSauce > 0) {
    lines.push('');
    lines.push('น้ำจิ้ม  ใช้ไป ' + g.sauce.used + ' ถ้วย' +
               (s ? ' · แถมไป ' + s.sauceCups + ' ถ้วย' : '') +
               ' → หาย ' + lostSauce + ' ถ้วย');
  }

  if (g.piece.items.length) {
    lines.push('');
    lines.push(isCentral ? 'หายเยอะสุด' : 'ออกจากชั้นเยอะสุด');
    g.piece.items.slice(0, AUDIT_TOP_N).forEach(function (x) {
      lines.push('• ' + x.name + '  ' + x.qty + ' ' + x.unit);
    });
    if (g.piece.items.length > AUDIT_TOP_N) {
      lines.push('• (อีก ' + (g.piece.items.length - AUDIT_TOP_N) + ' รายการ)');
    }
  }

  // นับได้มากกว่ายอดระบบ = ลงของเข้าไม่ครบ หรือนับผิด ควรรู้ไว้ด้วย
  if (g.overs.length) {
    lines.push('');
    lines.push('นับได้เกินยอดระบบ — เช็คว่าลงของเข้าครบไหม');
    g.overs.slice(0, 5).forEach(function (x) {
      lines.push('• ' + x.name + '  เกิน ' + x.qty + ' ' + x.unit);
    });
  }

  // POS นับเป็นชิ้น ของที่หน่วยไม่ใช่ชิ้นเลยเอามาหักไม่ได้ ต้องดูเอง
  if (g.other.used > 0) {
    lines.push('');
    lines.push('เทียบกับ POS ไม่ได้ ใช้ไป ' + g.other.used +
               ' ≈ ' + auditBaht_(g.other.value) + ' บาท');
    if (g.rawUnits.length) {
      // ชีตสต็อกต้องนับหลังเสียบไม้/จัดถุงแล้ว เจอกรัมแปลว่ายังไม่ได้ตั้งหน่วย
      lines.push('เพราะยังตั้งหน่วยเป็นกิโล/กรัมอยู่: ' + g.rawUnits.slice(0, 5).join(', '));
      lines.push('แก้โดยรัน fixItemList ใน Apps Script');
    } else {
      lines.push('ดูเองในหน้าคำนวณของหาย');
    }
  }
  if (g.noPrice.length) {
    lines.push('');
    lines.push('ยังไม่ได้ตั้งราคาขาย ตีมูลค่าไม่ได้: ' + g.noPrice.slice(0, 5).join(', '));
  }

  lines.push('');
  lines.push('ดูรายตัวได้ที่หน้าสรุปยอดขาย → แท็บ "คำนวณของหาย"');

  var sent = { sent: false, message: 'ไม่มี stockNotify_' };
  try {
    if (typeof stockNotify_ === 'function') sent = stockNotify_(loc, lines.join('\n'));
  } catch (e) {
    sent = { sent: false, message: e.message };
  }

  result.alerted = true;
  result.lineSent = sent.sent;
  result.lineMsg = sent.message;
  result.text = lines.join('\n');
  return result;
}

/* ───────────────────────── ทดสอบด้วยมือ ───────────────────────── */

/**
 * สร้าง counts ของ "รอบที่นับล่าสุด" ขึ้นมาใหม่จากชีต — ใช้เฉพาะตอนทดสอบ
 * ของจริง handleStockCount_ ส่ง counts มาให้ตรง ๆ อยู่แล้ว ไม่ผ่านทางนี้
 * ยอดระบบ = ยอดนับรอบก่อน + ของเข้า − ของเสีย ระหว่างสองรอบ (นิยามเดียวกับ stockBalances_)
 */
function auditRebuildCounts_(loc) {
  var items = {};
  getStockItems_().forEach(function (i) { items[i.name] = i; });

  var rows = readMoves_(SHEET_COUNT).filter(function (m) { return m.loc === loc; });
  if (!rows.length) return null;

  var times = rows.map(function (m) { return auditTime_(m.when); })
                  .filter(Boolean).sort(function (a, b) { return b - a; });
  if (!times.length) return null;

  var lastT = times[0];
  var prevT = 0;
  for (var i = 0; i < times.length; i++) { if (times[i] < lastT - 60000) { prevT = times[i]; break; } }
  if (!prevT) return null;

  var counted = {}, opening = {};
  rows.forEach(function (m) {
    var t = auditTime_(m.when);
    if (t >= lastT - 60000) counted[m.item] = m.qty;
    else if (t >= prevT - 60000 && t <= prevT + 60000) opening[m.item] = m.qty;
  });

  var moved = {};
  readMoves_(SHEET_INCOMING).forEach(function (m) {
    if (m.loc !== loc) return;
    var t = auditTime_(m.when);
    if (t > prevT && t <= lastT) moved[m.item] = (moved[m.item] || 0) + m.qty;
  });
  readMoves_(SHEET_WASTE).forEach(function (m) {
    if (m.loc !== loc) return;
    var t = auditTime_(m.when);
    if (t > prevT && t <= lastT) moved[m.item] = (moved[m.item] || 0) - m.qty;
  });

  var out = [];
  Object.keys(counted).forEach(function (name) {
    var it = items[name];
    if (!it) return;
    var sys = (opening[name] || 0) + (moved[name] || 0);
    out.push({ item: it, counted: counted[name], sys: sys,
               diff: Math.round((counted[name] - sys) * 1000) / 1000 });
  });
  return { counts: out, at: new Date(lastT) };
}

/**
 * ลองเทียบของหายกับเงินของรอบที่นับล่าสุด โดยไม่ต้องรอให้นับใหม่
 * ส่งเข้าไลน์จริง ถ้าเกินเกณฑ์ — อยากดูเฉย ๆ ใช้ previewShrink แทน
 */
function testShrinkNow() {
  auditLocations_().forEach(function (loc) {
    var b = auditRebuildCounts_(loc);
    if (!b) { Logger.log(loc + ': ยังไม่มีการนับสองรอบให้เทียบ'); return; }
    var r = auditAfterCount_(loc, b.counts, b.at);
    Logger.log(loc + ': ' + (r.alerted ? 'แจ้งแล้ว ' + (r.lineSent ? '✅' : '❌ ' + r.lineMsg)
                                       : 'ไม่ต้องแจ้ง — ' + r.reason));
  });
}

/** ดูตัวเลขเฉย ๆ ไม่ส่งไลน์ — เห็นทุกบรรทัดของสูตร จะได้รู้ว่าเลขไหนเพี้ยน */
function previewShrink() {
  auditLocations_().forEach(function (loc) {
    var b = auditRebuildCounts_(loc);
    if (!b) { Logger.log('── ' + loc + ' ──\nยังมีการนับไม่ถึงสองรอบ เทียบไม่ได้\n'); return; }

    var prevMs = auditPrevCountTime_(loc, b.at);
    if (!prevMs) { Logger.log('── ' + loc + ' ──\nไม่มีรอบก่อนหน้า\n'); return; }

    var g = auditUsage_(b.counts);
    var msg = '── ' + loc + ' ──\n' +
              'ช่วง ' + auditShort_(new Date(prevMs)) + ' → ' + auditShort_(b.at) + '\n' +
              'ของออกจากชั้น ' + g.piece.used + ' ชิ้น (มูลค่า ' + auditBaht_(g.piece.value) + ' บาท)\n';

    if (loc === auditCentral_()) {
      msg += 'ครัวกลางไม่ขายของ → ของหาย ' + g.piece.used + ' ชิ้น\n';
    } else {
      var s = auditSales_(loc, auditStamp_(new Date(prevMs)), auditStamp_(b.at));
      var per = g.piece.used > 0 ? g.piece.value / g.piece.used : 0;
      var lost = Math.round((g.piece.used - s.pieces - s.dlvPieces) * 1000) / 1000;
      msg += 'หักขายหน้าร้าน −' + s.pieces + ' ชิ้น (ไม้ ' + s.sticks + ' · มาม่า ' + s.mama +
             ' · ของอื่น ' + s.other + ')\n' +
             'หักเดลิเวอรี่ −' + s.dlvPieces + ' ชิ้น (' + s.dlvOrders + ' ออเดอร์)\n' +
             'ของหาย ' + lost + ' ชิ้น ≈ ' + auditBaht_(lost * per) + ' บาท\n' +
             'น้ำจิ้ม ใช้ไป ' + g.sauce.used + ' · แถมไป ' + s.sauceCups +
             ' → หาย ' + Math.round((g.sauce.used - s.sauceCups) * 1000) / 1000 + '\n' +
             'เงิน: ยอดขาย ' + auditBaht_(s.gross) + ' − ส่วนลด ' + auditBaht_(s.discount) +
             ' = ได้จริง ' + auditBaht_(s.revenue) + ' บาท (' + s.orders + ' บิล)\n';
    }
    if (g.other.used) msg += 'เทียบกับ POS ไม่ได้ (ชั่งกรัม) ' + g.other.used + '\n';
    if (g.noPrice.length) msg += 'ยังไม่ได้ตั้งราคา: ' + g.noPrice.join(', ') + '\n';
    msg += 'เกณฑ์แจ้งเตือน ' + auditBaht_(auditGapLimit_()) + ' บาท';
    Logger.log(msg + '\n');
  });
}

/** ลองเช็คของใกล้หมดทุกที่เดี๋ยวนี้ — เตือนจริงถ้าเจอ */
function testLowStockNow() {
  var names = getStockItems_().map(function (i) { return i.name; });
  auditLocations_().forEach(function (loc) {
    checkLowStock_(names, loc);
    Logger.log('เช็คของใกล้หมดที่ ' + loc + ' แล้ว');
  });
}

/** ล้างสถานะ "เคยเตือนไปแล้ว" ทั้งหมด — รอบหน้าจะเตือนใหม่ทุกอย่างที่ต่ำอยู่ */
function resetLowStockFlags() {
  var props = PropertiesService.getScriptProperties();
  var n = 0;
  Object.keys(props.getProperties()).forEach(function (k) {
    if (k.indexOf('LOWSTOCK_') === 0) { props.deleteProperty(k); n++; }
  });
  Logger.log('ล้างแล้ว ' + n + ' รายการ');
}

/* ═══════════════════════ ปิดร้าน — เทียบเงินสด ═══════════════════════
 *
 * พนักงานทำแค่ 2 อย่างตอนเก็บร้าน: นับสต็อก (หน้าสต็อก) กับกรอกเงินสดที่นับได้ (หน้า POS)
 * ทำอันไหนก่อนก็ได้ พออีกอันเข้ามา ระบบเทียบให้ทันที แล้วแจ้งเข้ากลุ่มไลน์นับสต็อก
 *
 *   ขายไปตามสต็อก  = Σ (ยกมา + ของเข้า − ของเสีย − นับได้ตอนปิด) × ราคาขาย
 *   เงินสดที่ควรมี = ขายไปตามสต็อก + มาม่า/ของอื่นที่ไม่มีในสต็อก − เดลิเวอรี่ − ส่วนลด − แลกแต้ม
 *                  − ลูกค้าโอน/ไทยช่วยไทย − ค่าใช้จ่ายเงินสด + เงินทอนตั้งต้น
 *
 *   เดลิเวอรี่ / ลูกค้าโอน / ไทยช่วยไทย — ของออกจริง แต่เงินไม่ได้เข้าลิ้นชัก
 *   ค่าใช้จ่ายที่โอนจ่าย ไม่ได้หยิบจากลิ้นชัก จึงไม่หัก
 *
 * ของที่ราคาขายในชีตรายการสินค้าเป็น 0 / ว่าง ไม่ถูกคิดเป็นเงิน
 * ของที่ไม่ได้ขายเป็นชิ้น (เช่นใส่หม้อรวม) ให้ตั้งราคาเป็น 0 ไม่งั้นจะขึ้นว่าเงินขาดทุกวัน
 *
 * ตั้งค่าได้ใน Script Properties (ไม่ตั้ง = ค่าเริ่มต้น)
 *   CASH_FLOAT     เงินทอนที่ใส่ลิ้นชักไว้ตอนเปิดร้าน (บาท) — ค่าเริ่มต้น 0
 *   CASH_GAP_BAHT  ต่างไม่เกินกี่บาทถือว่าตรง — ค่าเริ่มต้น 0
 *
 * พนักงานไม่เห็นยอดที่ควรมี เห็นแค่ว่าบันทึกแล้ว — ไม่งั้นจะกรอกให้ตรงแทนการนับจริง
 */
var SHEET_CASH = 'POS_ปิดร้าน';
var CASH_HEADERS = ['วันที่', 'เวลา', 'สาขา', 'พนักงาน', 'เงินสดที่นับได้', 'หมายเหตุ',
                    'close_id', 'ควรมี', 'ต่าง', 'ผลเทียบ'];
/** ร้านปิดเลยเที่ยงคืนได้ — ตี 4 ยังนับเป็นของวันก่อน (ตรงกับ pos.html) */
var CASH_DAY_CUT_HOURS = 4;

function cashProp_(key, def) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  var n = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
  return isNaN(n) ? def : n;
}

/** วันทำการ — เอาเวลาถอยไป 4 ชั่วโมงก่อนค่อยดูวันที่ */
function cashBizDay_(ms) {
  return Utilities.formatDate(new Date(ms - CASH_DAY_CUT_HOURS * 3600000), auditTz_(), 'yyyy-MM-dd');
}

function cashSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_CASH);
  if (!sh) {
    sh = ss.insertSheet(SHEET_CASH);
    sh.appendRow(CASH_HEADERS);
    sh.getRange(1, 1, 1, CASH_HEADERS.length)
      .setFontWeight('bold').setBackground('#dcfce7').setFontColor('#166534');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** แถวปิดร้านทั้งหมดของที่นี้ [{row, ms, cash, staff}] */
function cashRows_(loc) {
  var sh = cashSheet_();
  if (sh.getLastRow() < 2) return [];
  var v = sh.getRange(1, 1, sh.getLastRow(), CASH_HEADERS.length).getDisplayValues();
  var idx = {};
  v[0].forEach(function (h, i) { idx[String(h).trim()] = i; });
  var out = [];
  for (var i = 1; i < v.length; i++) {
    var b = v[i][idx['สาขา']];
    var same = (typeof sameBranch_ === 'function') ? sameBranch_(b, loc) : String(b).trim() === loc;
    if (!same) continue;
    var stamp = auditRowStamp_(v[i][idx['วันที่']], v[i][idx['เวลา']]);
    if (!stamp) continue;
    var ms = new Date(stamp.replace(' ', 'T') + '+07:00').getTime();
    out.push({ row: i + 1, ms: ms, staff: v[i][idx['พนักงาน']],
               cash: num_(v[i][idx['เงินสดที่นับได้']]), id: v[i][idx['close_id']],
               result: idx['ผลเทียบ'] !== undefined ? String(v[i][idx['ผลเทียบ']] || '') : '' });
  }
  return out;
}

/** รอบนับสต็อกจริง (ไม่ใช่เช็คระดับ/ล้างยอด/ก่อนวันเริ่ม) ของที่นี้ — เวลาแต่ละรอบ เรียงใหม่ → เก่า */
function cashCountTimes_(loc) {
  var seen = {}, out = [];
  readMoves_(SHEET_COUNT).forEach(function (m) {
    if (m.loc !== loc || m.kind === 'ล้างยอด') return;
    if (typeof KIND_LEVEL_COUNT === 'string' && m.kind === KIND_LEVEL_COUNT) return;
    if (typeof costBefore_ === 'function' && costBefore_(m.when, loc)) return;
    var t = auditTime_(m.when);
    if (!t) return;
    var key = Math.round(t / 60000);          // แถวรอบเดียวกันเขียนพร้อมกัน ห่างกันไม่ถึงนาที
    if (seen[key]) return;
    seen[key] = 1; out.push(t);
  });
  return out.sort(function (a, b) { return b - a; });
}

/**
 * ของที่ใช้ไประหว่างรอบนับก่อนหน้า กับรอบนับ atMs — เป็นหน่วยไม้ พร้อมมูลค่า
 * ยกมาของแต่ละรายการ = ยอดนับครั้งล่าสุดของรายการนั้นก่อนรอบนี้ (ไม่ต้องอยู่รอบเดียวกันทุกตัว)
 */
function cashUsage_(loc, atMs) {
  var items = {};
  getStockItems_().forEach(function (i) { items[i.name] = i; });

  var counted = {}, last = {};
  readMoves_(SHEET_COUNT).forEach(function (m) {
    if (m.loc !== loc) return;
    if (typeof KIND_LEVEL_COUNT === 'string' && m.kind === KIND_LEVEL_COUNT) return;
    var t = auditTime_(m.when);
    if (!t) return;
    if (Math.abs(t - atMs) <= 60000) { if (m.kind !== 'ล้างยอด') counted[m.item] = m.qty; return; }
    if (t < atMs - 60000 && (!last[m.item] || t >= last[m.item].t)) last[m.item] = { t: t, qty: m.qty };
  });

  var moved = {};
  function add(sheet, sign) {
    readMoves_(sheet).forEach(function (m) {
      if (m.loc !== loc) return;
      var t = auditTime_(m.when), from = last[m.item] ? last[m.item].t : 0;
      if (t > from && t <= atMs + 60000) moved[m.item] = (moved[m.item] || 0) + sign * m.qty;
    });
  }
  add(SHEET_INCOMING, 1);
  add(SHEET_WASTE, -1);

  var out = { value: 0, sticks: 0, items: [], overs: [] };
  Object.keys(counted).forEach(function (name) {
    var it = items[name];
    if (!it || it.level || !last[name]) return;          // ไม่มียอดยกมา = รอบฐานของตัวนี้ ยังคิดไม่ได้
    var per = perStickOf_(it);
    var used = Math.round((last[name].qty + (moved[name] || 0) - counted[name]) / per * 1000) / 1000;
    if (!used) return;
    var price = Number(it.price) || 0;
    var value = auditRound_(used * price);
    if (used < 0) { out.overs.push({ name: name, qty: -used, unit: it.subUnit }); }
    if (price > 0) { out.value += value; out.sticks += used; }
    if (used > 0) out.items.push({ name: name, qty: used, unit: it.subUnit, value: value });
  });
  out.value = auditRound_(out.value);
  out.sticks = Math.round(out.sticks * 1000) / 1000;
  out.items.sort(function (a, b) { return b.value - a.value || b.qty - a.qty; });
  return out;
}

/** เวลาเริ่มวันทำการ (ตี 4 ของวันนั้น) เป็นมิลลิวินาที */
function cashDayStart_(day) {
  return new Date(day + 'T' + ('0' + CASH_DAY_CUT_HOURS).slice(-2) + ':00:00+07:00').getTime();
}

function cashStampMs_(stamp) {
  return stamp ? new Date(String(stamp).replace(' ', 'T') + '+07:00').getTime() : 0;
}

/**
 * รอบนับปิดร้านของวันทำการ day = รอบนับแรกหลังบิลสุดท้ายของวันนั้น
 * (นับเช้าวันรุ่งขึ้นก่อนเปิดขายก็ได้ ของไม่ขยับแล้ว)
 * วันนั้นไม่มีบิลเลย = ใช้รอบนับล่าสุดของวันนั้น
 * คืน { countMs, prevMs, lastBill } — countMs 0 = ยังไม่ได้นับปิดร้าน
 */
function cashCloseCount_(loc, day) {
  var times = cashCountTimes_(loc);                      // ใหม่ → เก่า
  var start = cashDayStart_(day), end = start + 24 * 3600000;
  var bills = auditSales_(loc, auditStamp_(new Date(start)), auditStamp_(new Date(end - 1000)));
  var lastBill = cashStampMs_(bills.lastStamp);
  var pick = -1;
  if (lastBill) {
    for (var i = times.length - 1; i >= 0; i--) {         // เก่า → ใหม่ หาอันแรกหลังบิลสุดท้าย
      if (times[i] < lastBill - 60000) continue;
      // ระหว่างบิลสุดท้ายกับรอบนับนี้ต้องไม่มีบิลใหม่ (ของวันถัดไป)
      if (times[i] > end && auditSales_(loc, bills.lastStamp, auditStamp_(new Date(times[i]))).orders) break;
      pick = i; break;
    }
  } else {
    for (var j = 0; j < times.length; j++) if (cashBizDay_(times[j]) === day) { pick = j; break; }
  }
  if (pick < 0) return { countMs: 0, prevMs: 0, lastBill: lastBill };
  return { countMs: times[pick], prevMs: times[pick + 1] || 0, lastBill: lastBill };
}

/**
 * เทียบเงินสดของวันทำการหนึ่ง — ต้องมีทั้งรอบนับปิดร้านและเงินที่กรอก
 * ขาดอย่างใดอย่างหนึ่ง = คืน null เงียบ ๆ (รออีกอันเข้ามาแล้วค่อยเทียบ)
 *
 * เงินในลิ้นชัก = ของวันทำการนั้นทั้งวัน (ตี 4 ถึงปิดร้าน)
 * ของที่ขายไป   = ระหว่างรอบนับก่อนหน้า (นับล่าสุดที่ลง) ถึงรอบนับปิดร้าน
 * สองช่วงนี้ไม่เท่ากันได้ เช่นนับกลางวันหลังขายไปแล้วบางบิล
 *   → บิลเงินสดของวันนั้นที่ขายก่อนรอบนับก่อนหน้า บวกเพิ่มจาก POS (เงินอยู่ในลิ้นชักแล้ว)
 *   → บิลเงินสดของเมื่อวานที่อยู่ในช่วงนับ หักออก (เงินอยู่ลิ้นชักเมื่อวาน)
 *   → ค่าใช้จ่ายเงินสด นับตามวันทำการ ไม่ใช่ตามรอบนับ
 */
function cashCheck_(loc, day, opt) {
  opt = opt || {};
  var cashes = cashRows_(loc).filter(function (c) { return cashBizDay_(c.ms) === day; });
  // ดูย้อนหลังจากเมนูได้แม้ยังไม่มีใครกรอกเงิน — โชว์แค่ยอดที่ควรมี
  if (!cashes.length && !opt.silent) return null;
  var cash = cashes.length ? cashes[cashes.length - 1]          // กรอกใหม่ = ใช้อันล่าสุด
                           : { row: 0, ms: 0, cash: null, staff: '' };

  var cc = cashCloseCount_(loc, day);
  var countMs = cc.countMs, prevMs = cc.prevMs;
  if (!countMs) return null;                                    // ยังไม่ได้นับหลังบิลสุดท้าย
  if (!prevMs) {
    return cashSay_(loc, cash, null, '📋 ' + loc + ' — รับยอดเงินปิดร้าน ' + auditBaht_(cash.cash || 0) +
      ' บาทแล้ว\nแต่รอบนับนี้เป็นรอบฐาน ยังไม่มีรอบก่อนให้คิดว่าขายไปเท่าไหร่\nพรุ่งนี้ปิดร้านแล้วจะเทียบให้', opt);
  }

  var dayStart = cashDayStart_(day);
  var st = function (ms) { return auditStamp_(new Date(ms)); };
  var u = cashUsage_(loc, countMs);
  var s = auditSales_(loc, st(prevMs), st(countMs + 60000));                 // ช่วงนับสต็อก
  var sDay = auditSales_(loc, st(dayStart - 1000), st(Math.max(countMs + 60000, cash.ms)));  // ทั้งวัน
  var pre = prevMs > dayStart ? auditSales_(loc, st(dayStart - 1000), st(prevMs)).cashSales : 0;
  var old = prevMs < dayStart ? auditSales_(loc, st(prevMs), st(dayStart - 1000)).cashSales : 0;
  var perStick = u.sticks > 0 ? u.value / u.sticks : 10;
  var dlv = auditRound_(s.dlvPieces * perStick);
  var flt = cashProp_('CASH_FLOAT', 0);
  var expected = auditRound_(u.value + s.untracked - dlv - s.discount - s.redeem -
                             s.transfer + pre - old - sDay.expCash + flt);
  var noCash = cash.cash == null;
  var diff = noCash ? 0 : auditRound_(cash.cash - expected);
  var gap = cashProp_('CASH_GAP_BAHT', 0);
  var ok = Math.abs(diff) <= gap;
  // ถ้าเชื่อตัวเลขใน POS — เอาไว้แยกว่า "เงินหาย" หรือ "ขายแล้วไม่ได้กด POS"
  var posExpected = auditRound_(sDay.cashSales - sDay.expCash + flt);
  var hm = function (ms) { return Utilities.formatDate(new Date(ms), auditTz_(), 'HH:mm'); };

  var L = [];
  L.push(noCash ? '📋 ปิดร้าน ' + loc + ' — ยังไม่มีคนกรอกเงินที่นับได้'
                : (ok ? '✅ ' : '⚠️ ') + 'ปิดร้าน ' + loc + ' — ' + (ok ? 'เงินตรง' : 'เงินไม่ตรง'));
  L.push('นับสต็อก ' + auditShort_(new Date(prevMs)) + ' → ' + auditShort_(new Date(countMs)));
  L.push('');
  L.push('ขายไปตามสต็อก ' + u.sticks + ' ชิ้น   ' + auditBaht_(u.value) + ' บาท');
  if (s.untracked) L.push('+ มาม่า/ของอื่นที่ไม่ได้นับสต็อก   ' + auditBaht_(s.untracked));
  if (dlv)        L.push('− เดลิเวอรี่ ' + s.dlvPieces + ' ชิ้น   ' + auditBaht_(dlv));
  if (s.discount) L.push('− ส่วนลด   ' + auditBaht_(s.discount));
  if (s.redeem)   L.push('− แลกแต้ม   ' + auditBaht_(s.redeem));
  Object.keys(s.byMethod || {}).forEach(function (k) {
    L.push('− ' + (/โอน|สแกน/.test(k) ? 'ลูกค้าโอน' : k) + '   ' + auditBaht_(s.byMethod[k]));
  });
  if (pre)        L.push('+ เงินสดบิลก่อนนับรอบ ' + hm(prevMs) + '   ' + auditBaht_(pre));
  if (old)        L.push('− เงินสดบิลของวันก่อน (อยู่ลิ้นชักวันก่อน)   ' + auditBaht_(old));
  if (sDay.expCash) L.push('− ค่าใช้จ่ายเงินสดวันนี้   ' + auditBaht_(sDay.expCash));
  if (flt)        L.push('+ เงินทอนตั้งต้น   ' + auditBaht_(flt));
  L.push('= เงินสดที่ควรมี   ' + auditBaht_(expected) + ' บาท');
  if (!noCash) L.push('', 'นับได้จริง   ' + auditBaht_(cash.cash) + ' บาท (' + (cash.staff || '-') + ')');
  if (!ok) L.push((diff < 0 ? '🔻 ขาด ' : '🔺 เกิน ') + auditBaht_(Math.abs(diff)) + ' บาท');
  L.push('');
  L.push('เทียบ POS: ขายเงินสดวันนี้ ' + auditBaht_(sDay.cashSales) + ' บาท (ทั้งหมด ' + sDay.orders + ' บิล)' +
         ' → ควรมี ' + auditBaht_(posExpected));
  if (!ok || noCash) {
    if (u.sticks < 0) {
      L.push('👉 สต็อกเพิ่มขึ้นแทนที่จะลด — มีของเข้าร้านที่ยังไม่ได้ลง เลยเทียบเงินจากสต็อกไม่ได้');
      L.push('   ลงของเข้าร้านย้อนหลังแล้วกด 💵 ดูผลเทียบเงินปิดร้าน ใหม่ หรือดูเทียบ POS ไปก่อน');
    } else {
      var gapPos = auditRound_(u.value - (s.gross - s.untracked) - dlv);
      if (Math.abs(gapPos) >= 10) {
        L.push(gapPos > 0
          ? '👉 ของออกมากกว่าที่กด POS ' + auditBaht_(gapPos) + ' บาท — ขายแล้วไม่ได้กด / ลงของเสียไม่ครบ / ของหาย'
          : '👉 กด POS มากกว่าของที่ออก ' + auditBaht_(-gapPos) + ' บาท — ลงของเข้าไม่ครบ หรือนับสต็อกเกิน');
      } else {
        L.push('👉 ของออกตรงกับ POS' + (noCash ? '' : ' — ที่ต่างคือเงินในลิ้นชัก'));
      }
    }
    if (u.overs.length) {
      var overs = u.overs.slice().sort(function (a, b) { return b.qty - a.qty; });
      L.push('');
      L.push('นับได้เกินที่ควรเหลือ (ลืมลงของเข้า?) ' + overs.length + ' รายการ');
      overs.slice(0, 10).forEach(function (x) { L.push('• ' + x.name + ' ' + x.qty + ' ' + x.unit); });
      if (overs.length > 10) L.push('• …อีก ' + (overs.length - 10) + ' รายการ');
    }
  }
  return cashSay_(loc, cash, noCash ? { expected: expected, diff: null, ok: null }
                                    : { expected: expected, diff: diff, ok: ok }, L.join('\n'), opt);
}

/** จดผลลงแถวปิดร้าน แล้วแจ้งกลุ่ม */
function cashSay_(loc, cash, res, text, opt) {
  try {
    var sh = cashSheet_();
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    var c = function (h) { return head.indexOf(h) + 1; };
    if (res && res.ok != null && cash.row && c('ควรมี') && c('ต่าง') && c('ผลเทียบ')) {
      sh.getRange(cash.row, c('ควรมี')).setValue(res.expected);
      sh.getRange(cash.row, c('ต่าง')).setValue(res.diff);
      sh.getRange(cash.row, c('ผลเทียบ')).setValue(res.ok ? 'ตรง' : (res.diff < 0 ? 'ขาด' : 'เกิน'));
    }
  } catch (e) { Logger.log('cashSay_ write: ' + e.message); }
  var out = { text: text, ok: res ? res.ok : null, expected: res ? res.expected : null,
              diff: res ? res.diff : null, lineSent: false };
  if (opt.silent) return out;
  try {
    if (typeof stockNotify_ === 'function') {
      var r = stockNotify_(loc, text);
      out.lineSent = r.sent; out.lineMsg = r.message;
    }
  } catch (e) { out.lineMsg = e.message; }
  return out;
}

/** หน้า POS ส่งเงินที่นับได้ตอนปิดร้านมา */
function handleCashClose_(body) {
  var session = checkToken_(body.token);
  if (!session) return { success: false, code: 401, message: 'Session หมดอายุ กรุณา Login ใหม่' };
  var c = body.close || {};
  var loc = String(c.branch || session.branch || '').trim();
  if (!loc) return { success: false, message: 'ไม่รู้ว่าเป็นสาขาไหน' };
  var raw = String(c.cash == null ? '' : c.cash).trim();
  var cash = num_(raw);
  if (raw === '' || cash < 0) return { success: false, message: 'กรอกจำนวนเงินที่นับได้' };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var now = new Date();
  try {
    var sh = cashSheet_();
    if (c.closeId && cashRows_(loc).some(function (r) { return r.id === String(c.closeId); })) {
      return { success: true, duplicated: true };
    }
    sh.appendRow([
      Utilities.formatDate(now, auditTz_(), 'yyyy-MM-dd'),
      Utilities.formatDate(now, auditTz_(), 'HH:mm:ss'),
      loc, c.staff || session.name || '', cash, c.note || '', c.closeId || ''
    ]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  var res = null;
  try { res = cashCheck_(loc, cashBizDay_(now.getTime())); }
  catch (e) { Logger.log('cashCheck_: ' + e.message); }
  var out = { success: true, checked: !!(res && res.expected != null),
              waiting: !res,
              message: res ? 'บันทึกแล้ว ระบบเทียบกับสต็อกและแจ้งเจ้าของร้านแล้ว'
                           : 'บันทึกแล้ว — อย่าลืมนับสต็อกปิดร้าน ระบบจะเทียบเงินให้ทันทีที่นับเสร็จ' };
  // ยอดที่ควรมีให้เจ้าของร้านดูคนเดียว
  if (session.role === 'owner' && res) { out.expected = res.expected; out.diff = res.diff; }
  return out;
}

/** เรียกจาก handleStockCount_ — ถ้าวันนี้กรอกเงินไว้ก่อนแล้ว เทียบเลย */
function cashCheckAfterCount_(loc, now) {
  var ms = (now || new Date()).getTime(), day = cashBizDay_(ms);
  var r = cashCheck_(loc, day);
  if (r) return r;
  // นับเช้าวันรุ่งขึ้นก่อนเปิดร้าน — เมื่อวานกรอกเงินไว้แต่ยังไม่ได้เทียบ ก็เทียบให้ตอนนี้
  var prev = cashBizDay_(cashDayStart_(day) - 3600000);
  var waiting = cashRows_(loc).filter(function (c) { return cashBizDay_(c.ms) === prev; });
  if (waiting.length && !waiting[waiting.length - 1].result) return cashCheck_(loc, prev);
  return null;
}

/** ลองเทียบโดยไม่ส่งไลน์ — เลือกวันได้ (เว้นว่าง = วันนี้) ผลขึ้นเป็นกล่องข้อความ */
function previewCashClose() {
  var day = cashBizDay_(Date.now()), ui = null;
  try {
    ui = SpreadsheetApp.getUi();
    var r = ui.prompt('ดูผลเทียบเงินปิดร้าน', 'วันที่ (ปปปป-ดด-วว) เว้นว่าง = ' + day, ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    var t = String(r.getResponseText() || '').trim();
    if (t) day = t;
  } catch (e) { ui = null; }
  var parts = [];
  auditLocations_().forEach(function (loc) {
    if (loc === auditCentral_()) return;
    var r = cashCheck_(loc, day, { silent: true });
    parts.push(r ? r.text : loc + ' — วันที่ ' + day + ' ยังไม่ได้นับสต็อกปิดร้าน (ต้องนับหลังบิลสุดท้าย)');
  });
  var text = parts.join('\n\n────────\n\n');
  Logger.log(text);
  if (ui) ui.alert('เทียบเงินปิดร้าน ' + day + ' (ไม่ได้ส่งไลน์)', text, ui.ButtonSet.OK);
}
