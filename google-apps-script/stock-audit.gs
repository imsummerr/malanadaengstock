/************************************************************
 * 🔔 เตือนเช็คสต็อก — ทุกวันอาทิตย์ และทุกสิ้นเดือน
 *
 * ส่งเข้ากลุ่มไลน์ของแต่ละที่ตอน 1 ทุ่ม
 * ที่ไหนนับไปแล้ววันนั้น ก็ไม่เตือนซ้ำ
 *
 * ── ทำไมต้องนับให้ตรงเวลา ──
 * ยอดขายไม่ได้ถูกหักออกจากสต็อกทีละบิล การนับจริงจึงเป็นอย่างเดียวที่ทำให้
 * ยอดกลับมาตรง และเป็นจุดตั้งต้นให้ "คำนวณของหาย" รอบถัดไป
 * นับไม่สม่ำเสมอ = ช่วงเทียบกว้างจนหาสาเหตุไม่เจอว่าของหายตอนไหน
 *
 * ⚠️ ไฟล์นี้ไม่ได้คำนวณของหาย — ของนั้นมีอยู่แล้วในหน้าสรุปยอดขาย
 *    แท็บ "🔎 คำนวณของหาย" (pos-dashboard.html) ซึ่งทำได้ละเอียดกว่า
 *    หักเดลิเวอรี่ ส่วนลด น้ำจิ้มแถม แล้วเทียบกับยอดขายจริงให้ด้วย
 *    ถ้าเขียนซ้ำอีกที่ เลขสองที่จะไม่ตรงกันแล้วไม่รู้จะเชื่ออันไหน
 *
 * วิธีติดตั้ง: อ่าน STOCK-AUDIT-README.md ในโฟลเดอร์เดียวกัน
 ************************************************************/

/** เตือนตอนกี่โมง (19 = 1 ทุ่ม) */
var AUDIT_REMIND_HOUR = 19;

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
