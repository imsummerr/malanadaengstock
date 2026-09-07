/************************************************************
 * 🔍 เตือนเช็คสต็อก + คำนวณของหาย
 *
 *  1) เตือนนับสต็อก — ทุกวันอาทิตย์ และทุกสิ้นเดือน ส่งเข้ากลุ่มของแต่ละที่
 *     นับไปแล้ววันนั้นก็ไม่เตือนซ้ำ
 *
 *  2) คำนวณของหาย — เทียบ "ที่ควรเหลือ" กับ "ที่นับได้จริง" ระหว่างการนับ 2 ครั้งล่าสุด
 *
 *     ครัวกลาง  ตรวจได้ทีละรายการแบบเป๊ะ ๆ
 *               เพราะครัวกลางไม่มีการขาย ของเข้ากับของออกรู้หมดทุกชิ้น
 *
 *     สาขา      ตรวจได้เป็น "ยอดรวมไม้" เท่านั้น
 *               เพราะหน้า POS นับยอดขายเป็นจำนวนไม้ตามราคา ไม่ได้เก็บว่าขายไม้อะไร
 *               จึงบอกได้ว่าหายกี่ไม้ แต่บอกไม่ได้ว่าหายรายการไหน
 *
 * วิธีติดตั้ง: อ่าน STOCK-AUDIT-README.md ในโฟลเดอร์เดียวกัน
 ************************************************************/

var AUDIT_SHEET = 'ของหาย';

var AUDIT_HEADERS = [
  'สถานที่', 'รายการ', 'นับครั้งก่อน', 'ของเข้า', 'ส่งออก/ขาย', 'ของเสีย',
  'ควรเหลือ', 'นับได้จริง', 'ต่าง', 'มูลค่า(บาท)', 'หน่วย'
];

/** เตือนนับสต็อกตอนกี่โมง (19 = 1 ทุ่ม) */
var AUDIT_REMIND_HOUR = 19;

function auditTz_()    { return (typeof TZ === 'string' && TZ) ? TZ : 'Asia/Bangkok'; }
function auditRound_(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }

function auditSheetName_(key, fallback) {
  return (typeof key === 'string' && key) ? key : fallback;
}

/** ครัวกลางชื่ออะไร */
function auditCentral_() { return (typeof CENTRAL === 'string' && CENTRAL) ? CENTRAL : 'ครัวกลาง'; }

/** เวลาของแถว → มิลลิวินาที */
function auditTime_(v) {
  if (typeof timeOf_ === 'function') return timeOf_(v);
  if (!v) return 0;
  var d = (v instanceof Date) ? v : new Date(v);
  var t = d.getTime();
  return isNaN(t) ? 0 : t;
}

/** อ่านชีตประวัติเป็น array — ใช้ readMoves_ ของ pos-backend ถ้ามี */
function auditMoves_(sheetName) {
  if (typeof readMoves_ === 'function') {
    try { return readMoves_(sheetName) || []; } catch (e) { return []; }
  }
  return [];
}

// ══════════════════════════════════════════════════════════════
//  1) เตือนเช็คสต็อก
// ══════════════════════════════════════════════════════════════

/** วันนี้เป็นวันสุดท้ายของเดือนไหม */
function auditIsMonthEnd_(d) {
  var next = new Date(d.getTime());
  next.setDate(next.getDate() + 1);
  return next.getDate() === 1;
}

/** สถานที่ทั้งหมดที่ต้องนับสต็อก — ครัวกลาง + สาขาที่ตั้งกลุ่มไลน์ไว้ */
function auditLocations_() {
  var out = [auditCentral_()];
  var groups = {};
  try {
    if (typeof stockLineGroups_ === 'function') groups = stockLineGroups_() || {};
  } catch (e) {}
  Object.keys(groups).forEach(function (b) { if (out.indexOf(b) === -1) out.push(b); });
  return out;
}

/** สถานที่นี้นับสต็อกไปแล้วในวันนี้หรือยัง */
function auditCountedToday_(loc) {
  var today = Utilities.formatDate(new Date(), auditTz_(), 'yyyy-MM-dd');
  var rows = auditMoves_(auditSheetName_(typeof SHEET_COUNT !== 'undefined' ? SHEET_COUNT : '', 'เช็คสต็อกรายสัปดาห์'));
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].loc !== loc) continue;
    var t = auditTime_(rows[i].when);
    if (!t) continue;
    if (Utilities.formatDate(new Date(t), auditTz_(), 'yyyy-MM-dd') === today) return true;
  }
  return false;
}

/**
 * เตือนนับสต็อก — ตั้ง trigger ให้รันทุกวัน ตัวมันเองจะเช็คเองว่าวันนี้ต้องเตือนไหม
 * เตือนวันอาทิตย์ และวันสุดท้ายของเดือน
 */
function remindStockCount() {
  var now = new Date();
  var isSunday   = Number(Utilities.formatDate(now, auditTz_(), 'u')) === 7;
  var isMonthEnd = auditIsMonthEnd_(now);
  if (!isSunday && !isMonthEnd) return;

  var why = isMonthEnd && isSunday ? 'วันอาทิตย์ + สิ้นเดือน'
          : isMonthEnd             ? 'สิ้นเดือนแล้ว'
                                   : 'วันอาทิตย์แล้ว';

  auditLocations_().forEach(function (loc) {
    if (auditCountedToday_(loc)) return;   // นับไปแล้ว ไม่ต้องจี้ซ้ำ

    var msg = '📋 ถึงเวลาเช็คสต็อก — ' + loc + '\n\n' +
              why + ' อย่าลืมนับสต็อกให้ครบทุกรายการ\n\n' +
              'เข้าเว็บสต็อก → เลือก "เช็คสต็อกรายสัปดาห์"\n' +
              'เลือกสถานที่ ' + loc + ' แล้วนับให้ครบ\n\n' +
              (isMonthEnd ? 'สิ้นเดือนต้องนับให้ครบทุกที่ เพื่อปิดยอดของหายประจำเดือน\n\n' : '') +
              'นับเสร็จแล้วยอดในระบบจะกลับมาตรงกับของจริง';

    try {
      if (typeof stockNotify_ === 'function') stockNotify_(loc, msg);
      else Logger.log('ไม่มี stockNotify_ — ' + msg);
    } catch (e) {
      Logger.log('เตือนนับสต็อก ' + loc + ' ไม่สำเร็จ: ' + e.message);
    }
  });
}

/** รันครั้งเดียว — ตั้ง trigger เตือนนับสต็อกทุกวันตอน 1 ทุ่ม */
function setupStockAuditTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'remindStockCount') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('remindStockCount').timeBased()
    .everyDays(1).atHour(AUDIT_REMIND_HOUR).create();

  Logger.log('ตั้ง trigger แล้ว — เช็คทุกวันตอน ' + AUDIT_REMIND_HOUR + ' น.');
  Logger.log('จะเตือนเฉพาะวันอาทิตย์กับวันสุดท้ายของเดือน และข้ามที่ที่นับไปแล้ว');
  Logger.log('สถานที่ที่จะเตือน: ' + auditLocations_().join(', '));
}

/** ลองส่งข้อความเตือนเดี๋ยวนี้เลย ไม่ต้องรอวันอาทิตย์ */
function testRemindNow() {
  auditLocations_().forEach(function (loc) {
    var r = (typeof stockNotify_ === 'function')
      ? stockNotify_(loc, '📋 (ทดสอบ) ถึงเวลาเช็คสต็อก — ' + loc)
      : { sent: false, message: 'ไม่มี stockNotify_' };
    Logger.log(loc + ': ' + (r.sent ? 'ส่งแล้ว ✅' : 'ไม่ได้ส่ง — ' + r.message));
  });
}

// ══════════════════════════════════════════════════════════════
//  2) คำนวณของหาย
// ══════════════════════════════════════════════════════════════

/**
 * การนับ 2 ครั้งล่าสุดของสถานที่นั้น
 * หนึ่งครั้ง = ทุกแถวที่เวลาเดียวกัน (handleStockCount_ เขียนทุกรายการด้วยเวลาเดียว)
 * คืน null ถ้ายังนับไม่ถึง 2 ครั้ง — เทียบไม่ได้ ต้องมีจุดตั้งต้นก่อน
 */
function auditLastTwoCounts_(loc) {
  var rows = auditMoves_(auditSheetName_(typeof SHEET_COUNT !== 'undefined' ? SHEET_COUNT : '', 'เช็คสต็อกรายสัปดาห์'))
    .filter(function (m) { return m.loc === loc; });
  if (!rows.length) return null;

  var byTime = {};
  rows.forEach(function (m) {
    var t = auditTime_(m.when);
    if (!t) return;
    // ปัดเป็นนาที เผื่อเขียนคร่อมวินาที
    var key = Math.floor(t / 60000) * 60000;
    if (!byTime[key]) byTime[key] = {};
    byTime[key][m.item] = m.qty;
  });

  var times = Object.keys(byTime).map(Number).sort(function (a, b) { return a - b; });
  if (times.length < 2) return null;

  var tB = times[times.length - 1], tA = times[times.length - 2];
  return { tA: tA, tB: tB, a: byTime[tA], b: byTime[tB] };
}

/** รวมความเคลื่อนไหวของสถานที่หนึ่งในช่วงเวลา (tA, tB] */
function auditMovement_(loc, tA, tB) {
  var central = auditCentral_();
  var inn = {}, out = {}, waste = {};
  var addTo = function (o, k, v) { if (k) o[k] = auditRound_((o[k] || 0) + v); };

  auditMoves_(auditSheetName_(typeof SHEET_INCOMING !== 'undefined' ? SHEET_INCOMING : '', 'จำนวนของเข้า'))
    .forEach(function (m) {
      var t = auditTime_(m.when);
      if (!(t > tA && t <= tB)) return;
      if (m.loc === loc) addTo(inn, m.item, m.qty);
      // ของเข้าร้าน 1 แถว = บวกให้สาขา และหักออกจากครัวกลาง (ไม่ได้เขียนแถวหักแยก)
      if (loc === central && m.kind === 'ของเข้าร้าน' && m.loc !== central) addTo(out, m.item, m.qty);
    });

  auditMoves_(auditSheetName_(typeof SHEET_WASTE !== 'undefined' ? SHEET_WASTE : '', 'ของเสีย'))
    .forEach(function (m) {
      var t = auditTime_(m.when);
      if (!(t > tA && t <= tB) || m.loc !== loc) return;
      addTo(waste, m.item, m.qty);
    });

  return { inn: inn, out: out, waste: waste };
}

/**
 * ไม้ที่ขายไปของสาขาหนึ่งในช่วงเวลา — อ่านจาก POS_Orders
 * นับ "รวมไม้" กับ "รวมมาม่า" เพราะทั้งสองอย่างเก็บสต็อกเป็นไม้
 * คืนยอดเงินมาด้วย เอาไว้คิดราคาขายเฉลี่ยต่อไม้
 */
function auditSold_(branch, tA, tB) {
  var name = auditSheetName_(typeof SHEET_ORDERS !== 'undefined' ? SHEET_ORDERS : '', 'POS_Orders');
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return { sticks: 0, baht: 0, orders: 0 };

  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  var idx = {};
  v[0].forEach(function (h, i) { idx[String(h).trim()] = i; });

  var num = function (x) {
    if (typeof num_ === 'function') return num_(x);
    var n = parseFloat(String(x).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  };

  var sticks = 0, baht = 0, orders = 0;
  for (var i = 1; i < v.length; i++) {
    var r = v[i];
    var when = String(r[idx['วันที่']] || '') + ' ' + String(r[idx['เวลา']] || '');
    var t = auditTime_(when);
    if (!t || !(t > tA && t <= tB)) continue;
    if (branch && idx['สาขา'] !== undefined) {
      var same = (typeof sameBranch_ === 'function')
        ? sameBranch_(r[idx['สาขา']], branch)
        : String(r[idx['สาขา']]).trim() === branch;
      if (!same) continue;
    }
    orders++;
    sticks += num(r[idx['รวมไม้']]) + num(r[idx['รวมมาม่า']]);
    baht   += num(r[idx['ยอดสุทธิ']]);
  }
  return { sticks: auditRound_(sticks), baht: auditRound_(baht), orders: orders };
}

/** ราคาขายต่อหน่วยย่อยของรายการนั้น ไว้ตีมูลค่าของที่หาย */
function auditPriceOf_(itemsByName, name) {
  var it = itemsByName[name];
  return (it && it.price > 0) ? it.price : 10;
}

/**
 * ตรวจของหายของทุกสถานที่ — คืนผลเป็น array ไว้เขียนชีตและสรุปลงไลน์
 * ครัวกลางตรวจทีละรายการ · สาขาตรวจเป็นยอดรวมไม้
 */
function auditRun_() {
  var central = auditCentral_();
  var items = (typeof getStockItems_ === 'function') ? (getStockItems_() || []) : [];
  var byName = {};
  items.forEach(function (it) { byName[it.name] = it; });

  var out = [];
  auditLocations_().forEach(function (loc) {
    var c = auditLastTwoCounts_(loc);
    if (!c) { out.push({ loc: loc, skip: 'ยังนับไม่ถึง 2 ครั้ง เทียบไม่ได้' }); return; }

    var mv = auditMovement_(loc, c.tA, c.tB);
    var res = {
      loc: loc, tA: c.tA, tB: c.tB,
      perItem: [], lostBaht: 0,
      isCentral: loc === central
    };

    // รวมยอดฝั่งไม้ไว้ใช้กับสาขา
    var stickBefore = 0, stickIn = 0, stickWaste = 0, stickAfter = 0;

    Object.keys(byName).forEach(function (name) {
      var it    = byName[name];
      var qa    = Number(c.a[name]) || 0;
      var qb    = Number(c.b[name]) || 0;
      var i_    = Number(mv.inn[name]) || 0;
      var o_    = Number(mv.out[name]) || 0;
      var w_    = Number(mv.waste[name]) || 0;

      if (it.subUnit === 'ไม้') {
        stickBefore += qa; stickIn += i_; stickWaste += w_; stickAfter += qb;
      }

      if (!res.isCentral) return;   // สาขาไม่คิดทีละรายการ เพราะไม่รู้ว่าขายอะไรไป

      var expect = auditRound_(qa + i_ - o_ - w_);
      var diff   = auditRound_(qb - expect);
      if (qa === 0 && qb === 0 && i_ === 0 && o_ === 0 && w_ === 0) return;

      res.perItem.push({
        item: name, before: qa, inn: i_, out: o_, waste: w_,
        expect: expect, after: qb, diff: diff, unit: it.subUnit,
        baht: auditRound_(diff * auditPriceOf_(byName, name))
      });
      if (diff < 0) res.lostBaht = auditRound_(res.lostBaht + Math.abs(diff) * auditPriceOf_(byName, name));
    });

    if (!res.isCentral) {
      var sold = auditSold_(loc, c.tA, c.tB);
      var expect = auditRound_(stickBefore + stickIn - stickWaste - sold.sticks);
      var diff   = auditRound_(stickAfter - expect);
      var perStick = sold.sticks > 0 ? auditRound_(sold.baht / sold.sticks) : 10;

      res.stick = {
        before: auditRound_(stickBefore), inn: auditRound_(stickIn),
        waste: auditRound_(stickWaste), sold: sold.sticks, soldBaht: sold.baht,
        orders: sold.orders, expect: expect, after: auditRound_(stickAfter),
        diff: diff, perStick: perStick,
        baht: auditRound_(diff * perStick)
      };
      if (diff < 0) res.lostBaht = auditRound_(Math.abs(diff) * perStick);
    }

    out.push(res);
  });

  return out;
}

// ══════════════════════════════════════════════════════════════
//  รายงาน
// ══════════════════════════════════════════════════════════════

function auditDate_(t) {
  return Utilities.formatDate(new Date(t), auditTz_(), 'd/M/yy HH:mm');
}

/** เขียนชีต "ของหาย" */
function buildLossReport() {
  var results = auditRun_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(AUDIT_SHEET) || ss.insertSheet(AUDIT_SHEET);
  sh.clear();

  sh.getRange(1, 1).setValue(
    'ของหาย — เทียบการนับสต็อก 2 ครั้งล่าสุดของแต่ละที่ · สร้างเมื่อ ' +
    Utilities.formatDate(new Date(), auditTz_(), 'd/M/yyyy HH:mm') +
    ' · ชีตนี้ระบบเขียนทับทุกครั้ง'
  ).setFontSize(10).setFontColor('#8e8e97');

  sh.getRange(2, 1, 1, AUDIT_HEADERS.length).setValues([AUDIT_HEADERS])
    .setFontWeight('bold').setBackground('#fee2e2').setFontColor('#991b1b');
  sh.setFrozenRows(2);

  var rows = [];
  results.forEach(function (r) {
    if (r.skip) { rows.push([r.loc, '(' + r.skip + ')', '', '', '', '', '', '', '', '', '']); return; }

    rows.push([r.loc + '  ' + auditDate_(r.tA) + ' → ' + auditDate_(r.tB),
               '', '', '', '', '', '', '', '', '', '']);

    if (r.isCentral) {
      r.perItem.forEach(function (p) {
        rows.push([r.loc, p.item, p.before, p.inn, p.out, p.waste,
                   p.expect, p.after, p.diff, p.baht, p.unit]);
      });
    } else {
      var s = r.stick;
      rows.push([r.loc, 'รวมทุกรายการที่นับเป็นไม้', s.before, s.inn, s.sold, s.waste,
                 s.expect, s.after, s.diff, s.baht, 'ไม้']);
      rows.push([r.loc, '  ↳ ขายไป ' + s.orders + ' บิล เป็นเงิน ' + s.soldBaht +
                 ' บาท (เฉลี่ย ' + s.perStick + ' บาท/ไม้)', '', '', '', '', '', '', '', '', '']);
    }
  });

  if (!rows.length) rows.push(['ยังไม่มีข้อมูลพอให้เทียบ', '', '', '', '', '', '', '', '', '', '']);
  sh.getRange(3, 1, rows.length, AUDIT_HEADERS.length).setValues(rows);
  sh.getRange(3, 3, rows.length, 8).setNumberFormat('#,##0.##');
  sh.autoResizeColumns(1, 2);

  results.forEach(function (r) {
    if (r.skip) Logger.log(r.loc + ' — ' + r.skip);
    else Logger.log(r.loc + ' — ของหายคิดเป็นเงิน ' + r.lostBaht + ' บาท');
  });
  return results;
}

/** สรุปสั้น ๆ ไว้ตอบในไลน์เวลาพิมพ์ "ของหาย" */
function auditSummary_() {
  var results = auditRun_();
  if (!results.length) return '🔍 ยังไม่มีสถานที่ให้ตรวจครับ';

  var lines = ['🔍 ของหาย — เทียบการนับ 2 ครั้งล่าสุด', ''];
  var money = function (n) {
    var v = Math.round((Number(n) || 0) * 100) / 100;
    return String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  results.forEach(function (r) {
    if (r.skip) { lines.push('▸ ' + r.loc, '   ' + r.skip, ''); return; }

    lines.push('▸ ' + r.loc + '  (' + auditDate_(r.tA) + ' → ' + auditDate_(r.tB) + ')');

    if (r.isCentral) {
      var bad = r.perItem.filter(function (p) { return p.diff < 0; })
        .sort(function (a, b) { return a.diff - b.diff; }).slice(0, 5);
      if (!bad.length) lines.push('   ครบทุกรายการ ไม่มีของหาย 🎉');
      else {
        bad.forEach(function (p) {
          lines.push('   • ' + p.item + ' หาย ' + money(p.diff) + ' ' + p.unit +
                     ' (~' + money(p.baht) + ' บาท)');
        });
        lines.push('   รวมของหาย ~' + money(r.lostBaht) + ' บาท');
      }
    } else {
      var s = r.stick;
      lines.push('   ควรเหลือ ' + money(s.expect) + ' ไม้ · นับได้ ' + money(s.after) + ' ไม้');
      lines.push('   ขายไป ' + money(s.sold) + ' ไม้ = ' + money(s.soldBaht) + ' บาท');
      if (s.diff < 0)      lines.push('   ⚠️ หายไป ' + money(s.diff) + ' ไม้ (~' + money(s.baht) + ' บาท)');
      else if (s.diff > 0) lines.push('   เกินมา ' + money(s.diff) + ' ไม้ — อาจนับพลาดหรือลืมลงของเข้า');
      else                 lines.push('   ตรงพอดี 🎉');
    }
    lines.push('');
  });

  lines.push('ครัวกลางตรวจได้ทีละรายการ');
  lines.push('สาขาตรวจได้แค่ยอดรวมไม้ เพราะ POS ไม่ได้เก็บว่าขายไม้อะไร');
  return lines.join('\n');
}

/** ดูผลใน Log โดยไม่ต้องสร้างชีต */
function previewLoss() { Logger.log(auditSummary_()); }
