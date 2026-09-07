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

/** ต่างกันเกินกี่บาทถึงจะแจ้ง — ตั้งทับได้ที่ Script Property AUDIT_GAP_BAHT */
var AUDIT_GAP_BAHT = 200;

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
  var v = Number(PropertiesService.getScriptProperties().getProperty('AUDIT_GAP_BAHT'));
  return v > 0 ? v : AUDIT_GAP_BAHT;
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
    var t = auditTime_(rows[i].when);
    if (t && t < cutoff && t > best) best = t;
  }
  return best;
}

/**
 * ยอดขายหน้าร้าน + จำนวนชิ้นที่ออกไปกับเดลิเวอรี่ ในช่วงที่กำหนด
 *   revenue  = ผลรวม "ยอดสุทธิ" (หักส่วนลดมาแล้ว) = เงินที่ได้จริง
 *   pieces   = ไม้ + มาม่า + ของอื่น ที่ขายหน้าร้าน — ไว้หาราคาเฉลี่ยต่อชิ้น
 *   dlvPieces= ชิ้นที่ออกไปกับเดลิเวอรี่ ของออกแต่เงินไม่ได้เข้าที่ร้าน ต้องหักออก
 */
function auditSales_(loc, fromStamp, toStamp) {
  var out = { revenue: 0, orders: 0, pieces: 0, dlvPieces: 0, dlvOrders: 0 };
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  function scan(sheetName, fn) {
    var sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 2) return;
    var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
    var idx = {};
    v[0].forEach(function (h, i) { idx[String(h).trim()] = i; });
    if (idx['วันที่'] === undefined) return;
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

  scan((typeof SHEET_ORDERS === 'string') ? SHEET_ORDERS : 'POS_Orders', function (r, idx) {
    out.orders++;
    out.revenue += n(r[idx['ยอดสุทธิ']]);
    out.pieces  += n(r[idx['รวมไม้']]) + n(r[idx['รวมมาม่า']]) +
                   (idx['รวมของอื่น'] !== undefined ? n(r[idx['รวมของอื่น']]) : 0);
  });

  scan((typeof SHEET_DELIVERY === 'string') ? SHEET_DELIVERY : 'POS_Delivery', function (r, idx) {
    out.dlvOrders++;
    out.dlvPieces += n(r[idx['รวมจำนวน']]);
  });

  out.revenue = auditRound_(out.revenue);
  return out;
}

/**
 * เทียบของที่หายกับเงินที่ได้ — เรียกจาก handleStockCount_ ทันทีที่นับเสร็จ
 * counts = [{ item, counted, sys, diff }]  โดย diff = นับได้ − ยอดระบบ
 *   ยอดระบบ = ยกมา + ของเข้า − ของเสีย  (ยอดขายไม่ได้ถูกหักทีละบิล)
 *   ดังนั้น −diff = ของที่หายไปจากสต็อกช่วงนี้ = สูตรเดียวกับหน้า "คำนวณของหาย"
 * คืน object สรุปเสมอ ส่งไลน์ไม่สำเร็จก็ไม่ throw — ของลงชีตไปแล้ว
 */
function auditAfterCount_(loc, counts, now) {
  loc = String(loc || '').trim();
  now = now || new Date();

  var prevMs = auditPrevCountTime_(loc, now);
  if (!prevMs) {
    return { alerted: false, reason: 'รอบฐาน — ยังไม่เคยนับที่นี่มาก่อน จึงยังไม่มีอะไรให้เทียบ' };
  }

  var prev = new Date(prevMs);
  var lost = [], overs = [], lostValue = 0, noPrice = [];

  (counts || []).forEach(function (c) {
    var it = c.item;
    if (!it) return;
    if (!(it.price > 0)) {                    // ถ้วย ช้อน นม — ไม่มีราคาขาย ตีมูลค่าไม่ได้
      if (c.diff < 0) noPrice.push(it.name);
      return;
    }
    var gone = Math.round((-c.diff) * 1000) / 1000;
    lostValue += gone * it.price;             // ติดลบได้ นับได้เกินระบบถือว่าหักกลบกัน
    var v = auditRound_(gone * it.price);
    if (gone > 0)      lost.push({ name: it.name, qty: gone, unit: it.subUnit, value: v });
    else if (gone < 0) overs.push({ name: it.name, qty: -gone, unit: it.subUnit });
  });

  lostValue = auditRound_(lostValue);
  lost.sort(function (a, b) { return b.value - a.value; });

  var limit = auditGapLimit_();
  var head = 'ช่วงที่เทียบ ' + auditShort_(prev) + ' → ' + auditShort_(now);
  var isCentral = (loc === auditCentral_());
  var result = { loc: loc, from: auditShort_(prev), to: auditShort_(now),
                 lostValue: lostValue, limit: limit, alerted: false };

  var lines = [];
  if (isCentral) {
    // ครัวกลางไม่ได้ขายของ ของที่ส่งออกสาขาถูกหักออกจากยอดระบบให้แล้ว
    // ที่ยังขาดอยู่จึงไม่มีอะไรมาอธิบายได้ = ของหายล้วน ๆ
    result.gap = lostValue;
    if (lostValue <= limit) {
      result.reason = 'ต่างกัน ' + auditBaht_(lostValue) + ' บาท ไม่เกิน ' + auditBaht_(limit);
      return result;
    }
    lines.push('⚠️ ครัวกลางนับสต็อกแล้วของไม่ครบ');
    lines.push('');
    lines.push(head);
    lines.push('');
    lines.push('ครัวกลางไม่ได้ขายของ และของที่ส่งไปสาขาถูกหักให้แล้ว');
    lines.push('ที่ยังขาดอยู่จึงยังหาสาเหตุไม่ได้');
    lines.push('');
    lines.push('ขาดไป ' + auditBaht_(lostValue) + ' บาท');
  } else {
    var s = auditSales_(loc, auditStamp_(prev), auditStamp_(now));
    // ราคาเฉลี่ยต่อชิ้นจากบิลจริงในช่วงเดียวกัน — ไม่ต้องตั้งค่าเอง ไม่ต้องเดา
    var avg = s.pieces > 0 ? s.revenue / s.pieces : 0;
    var dlvValue = auditRound_(s.dlvPieces * avg);
    var expect = auditRound_(lostValue - dlvValue);
    var gap = auditRound_(expect - s.revenue);

    result.revenue = s.revenue;
    result.orders = s.orders;
    result.deliveryValue = dlvValue;
    result.expect = expect;
    result.gap = gap;

    if (!s.orders) {
      result.reason = 'ไม่มีบิลขายในช่วงนี้เลย ยังไม่เทียบเงิน';
      return result;
    }
    if (gap <= limit) {
      result.reason = 'ต่างกัน ' + auditBaht_(gap) + ' บาท ไม่เกิน ' + auditBaht_(limit);
      return result;
    }

    lines.push('⚠️ เช็คสต็อกแล้วเงินไม่ตรงกับของ — ' + loc);
    lines.push('');
    lines.push(head);
    lines.push('');
    lines.push('มูลค่าของที่ใช้ไป   ' + auditBaht_(lostValue) + ' บาท');
    if (s.dlvPieces > 0) {
      lines.push('หักเดลิเวอรี่ ' + auditBaht_(s.dlvPieces) + ' ชิ้น  −' + auditBaht_(dlvValue) + ' บาท');
      lines.push('ควรได้เงิน        ' + auditBaht_(expect) + ' บาท');
    }
    lines.push('เงินที่ได้จริง       ' + auditBaht_(s.revenue) + ' บาท  (' + s.orders + ' บิล)');
    lines.push('');
    lines.push('ขาดไป ' + auditBaht_(gap) + ' บาท');
  }

  if (lost.length) {
    lines.push('');
    lines.push('หายเยอะสุด');
    lost.slice(0, AUDIT_TOP_N).forEach(function (x) {
      lines.push('• ' + x.name + '  ' + x.qty + ' ' + x.unit + ' = ' + auditBaht_(x.value) + ' บาท');
    });
    if (lost.length > AUDIT_TOP_N) lines.push('• (อีก ' + (lost.length - AUDIT_TOP_N) + ' รายการ)');
  }

  // นับได้มากกว่ายอดระบบ = ลงของเข้าไม่ครบ หรือนับผิด ควรรู้ไว้ด้วย
  if (overs.length) {
    lines.push('');
    lines.push('นับได้เกินยอดระบบ — เช็คว่าลงของเข้าครบไหม');
    overs.slice(0, 5).forEach(function (x) {
      lines.push('• ' + x.name + '  เกิน ' + x.qty + ' ' + x.unit);
    });
  }
  if (noPrice.length) {
    lines.push('');
    lines.push('ยังไม่ได้ตั้งราคาขาย ตีมูลค่าไม่ได้: ' + noPrice.slice(0, 5).join(', '));
  }

  lines.push('');
  lines.push('ตัวเลขนี้ใช้ "ราคาขาย/หน่วยย่อย" ในชีตรายการสินค้า');
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

/** ดูตัวเลขเฉย ๆ ไม่ส่งไลน์ */
function previewShrink() {
  auditLocations_().forEach(function (loc) {
    var b = auditRebuildCounts_(loc);
    if (!b) { Logger.log('── ' + loc + ' ──\nยังมีการนับไม่ถึงสองรอบ เทียบไม่ได้\n'); return; }

    var prevMs = auditPrevCountTime_(loc, b.at);
    if (!prevMs) { Logger.log('── ' + loc + ' ──\nไม่มีรอบก่อนหน้า\n'); return; }

    var lostValue = 0;
    b.counts.forEach(function (c) {
      if (c.item.price > 0) lostValue += (-c.diff) * c.item.price;
    });
    lostValue = auditRound_(lostValue);

    var msg = '── ' + loc + ' ──\n' +
              'ช่วง ' + auditShort_(new Date(prevMs)) + ' → ' + auditShort_(b.at) + '\n' +
              'มูลค่าของที่ใช้ไป ' + auditBaht_(lostValue) + ' บาท\n';
    if (loc !== auditCentral_()) {
      var s = auditSales_(loc, auditStamp_(new Date(prevMs)), auditStamp_(b.at));
      var avg = s.pieces > 0 ? s.revenue / s.pieces : 0;
      var dlv = auditRound_(s.dlvPieces * avg);
      msg += 'เดลิเวอรี่ ' + s.dlvPieces + ' ชิ้น = ' + auditBaht_(dlv) + ' บาท\n' +
             'เงินที่ได้จริง ' + auditBaht_(s.revenue) + ' บาท (' + s.orders + ' บิล)\n' +
             'ขาดไป ' + auditBaht_(lostValue - dlv - s.revenue) + ' บาท\n';
    }
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
