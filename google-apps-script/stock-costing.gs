/************************************************************
 *  ต้นทุนแบบเข้าก่อนออกก่อน (FIFO) + บัญชีครัวกลาง / บัญชีสาขา
 *
 *  ไม่มีชีตเก็บ "ยอดต้นทุนคงเหลือ" แยกต่างหาก — คำนวณสดจากชีตที่มีอยู่แล้ว
 *  ทุกครั้งที่เรียก เพราะยอดที่เก็บไว้จะเพี้ยนทันทีที่มีใครแก้แถวย้อนหลัง
 *  แล้วไม่มีใครรู้ว่าเพี้ยนตั้งแต่เมื่อไหร่ (เหมือนยอดสต็อกที่คิดจากการนับล่าสุด)
 *
 *  ของเดินทางสามชั้น ต้นทุนก็เดินตาม
 *    1) ซื้อเข้าครัวกลาง   สร้างชั้นต้นทุนใหม่ ราคาต่อหน่วยจากบิลในไลน์
 *    2) แพ็คของ            กินชั้นของดิบ แล้วโยนต้นทุนไปเป็นของที่แพ็คแล้ว
 *    3) ส่งเข้าร้าน         กินชั้นครัวกลาง สร้างชั้นที่สาขา "ราคาเท่าเดิม"
 *                          ของออกจากครัวกลางแล้ว = สาขาเป็นหนี้เต็มจำนวนทันที
 *    4) เช็คสต็อก          นับได้เท่าไหร่คือเท่านั้น ส่วนที่หายไปคือของที่ใช้จริง
 *                          → เป็นค่าใช้จ่ายวัตถุดิบ และเป็นยอดที่ถึงกำหนดจ่าย
 *
 *  ยอดค้างชำระ = ของที่รับไปทั้งหมด − ที่จ่ายคืนแล้ว
 *  ขายได้เท่าไหร่ก็จ่ายคืนเท่านั้น ที่เหลือค้างไว้เท่ากับของที่ยังวางอยู่
 *  ของเสียที่สาขาก็ยังต้องจ่าย เพราะของออกจากครัวกลางไปแล้ว ทิ้งแล้วหนี้ไม่หาย
 *
 *  ครัวกลางไม่มีกำไรไม่มีขาดทุน — ส่งต่อที่ต้นทุนจริง กำไรไปโผล่ที่สาขาทั้งหมด
 *  ตัวเลขที่ครัวกลางจึงเป็น "เงินที่จมอยู่ในของ" ล้วน ๆ
 ************************************************************/

var COST_SHEET_PAY    = 'บัญชี_สาขาจ่ายคืน';      // กรอกเอง เวลาสาขาโอนเงินคืนครัวกลาง
var COST_SHEET_STOCK  = 'บัญชี_มูลค่าสต็อก';       // ผลลัพธ์ เขียนทับทุกครั้งที่สั่ง
var COST_SHEET_LEDGER = 'บัญชี_ครัวกลางกับสาขา';   // ผลลัพธ์ เขียนทับทุกครั้งที่สั่ง
var COST_SHEET_PL     = 'บัญชี_กำไรแต่ละที่';       // ผลลัพธ์ เขียนทับทุกครั้งที่สั่ง

var COST_PAY_COLS = ['วันที่', 'สาขา', 'จำนวนเงิน', 'วิธีจ่าย', 'หมายเหตุ'];

/** ปัดเป็นสตางค์ — เงินไม่มีทศนิยมที่สาม */
function costBaht_(n) { return Math.round((Number(n) || 0) * 100) / 100; }
/** ปัดจำนวนของ — กันเศษทศนิยมลอยจากการลบกันไปมา */
function costQty_(n)  { return Math.round((Number(n) || 0) * 10000) / 10000; }

function costCentral_() { return (typeof CENTRAL === 'string' && CENTRAL) ? CENTRAL : 'ครัวกลาง'; }

/**
 * วันเริ่มนับใหม่ — อะไรที่เกิดก่อนวันนี้ ระบบไม่เอามาคิดเลย
 *
 * ไม่ลบแถวเก่าทิ้ง เพราะลบแล้วเอากลับไม่ได้ และประวัติที่เคยลงไว้ก็หายด้วย
 * ใช้วิธีขีดเส้นแทน อยากย้อนดูของเก่าก็แค่เลื่อนวันกลับ
 * ตั้งด้วย setStartDate('2026-10-01') · ล้างเส้นด้วย clearStartDate()
 */
function costStartDate_(loc) {
  var st = costStarts_();
  if (!loc) return st.all;
  return Math.max(st.all, st.byLoc[String(loc).trim()] || 0);
}

/**
 * วันเริ่มนับทั้งหมด อ่านครั้งเดียวต่อรอบ
 * ถูกเรียกทุกแถวของทุกชีต ถ้าไปอ่าน Script Property ทุกครั้งจะช้ามาก
 *
 *   all    ขีดเส้นทั้งระบบ (ACC_START_DATE)
 *   byLoc  ขีดเส้นเฉพาะที่ (ACC_START_BY_LOC) — เช่นสาขาเริ่มเดือนใหม่
 *          แต่ครัวกลางยังเดินต่อ ไม่ต้องทิ้งประวัติครัวกลางไปด้วย
 */
function costStarts_() {
  return cached_('cost:starts', function () {
    var props = PropertiesService.getScriptProperties();
    var byLoc = {}, raw = {};
    try { raw = JSON.parse(props.getProperty('ACC_START_BY_LOC') || '{}') || {}; } catch (e) {}
    Object.keys(raw).forEach(function (k) { byLoc[String(k).trim()] = costYmdTime_(raw[k]); });
    return { all: costYmdTime_(props.getProperty('ACC_START_DATE')), byLoc: byLoc, raw: raw };
  });
}
/**
 * 'yyyy-MM-dd' = เที่ยงคืนวันนั้น · 'yyyy-MM-dd HH:mm' = ตั้งแต่นาทีนั้น
 * ใส่เวลาได้เพื่อใช้ "ยอดนับปิดร้านเมื่อคืน" เป็นฐาน แล้วเริ่มนับยอดขายวันรุ่งขึ้น
 */
var COST_START_RE = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/;
function costYmdTime_(v) {
  var m = String(v || '').trim().match(COST_START_RE);
  if (!m) return 0;
  var d = new Date(m[1] + 'T' + (m[2] ? ('0' + m[2]).slice(-2) + ':' + m[3] : '00:00') + ':00');
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

/**
 * วันที่ + เวลาของแถวบิล/ค่าใช้จ่าย (เก็บแยกสองช่อง) → เวลาเดียว
 * เส้นเริ่มนับเป็นนาทีได้ (เช่นยอดนับ 17:23) บิลหลังจากนั้นในวันเดียวกันต้องยังถูกนับ
 * ถ้าดูแค่วันที่ บิลทั้งวันจะถูกมองว่าอยู่ก่อนเส้น แล้วยอดขายคืนนั้นหายจากบัญชี
 */
function costRowTime_(dateCell, timeCell) {
  var base = dateCell instanceof Date ? dateCell
           : (typeof rptDateOf_ === 'function' ? rptDateOf_(dateCell) : new Date(String(dateCell || '')));
  if (!base || isNaN(base.getTime())) return dateCell;
  var h = 0, m = 0, s = 0;
  if (timeCell instanceof Date && !isNaN(timeCell.getTime())) {
    h = timeCell.getHours(); m = timeCell.getMinutes(); s = timeCell.getSeconds();
  } else {
    var x = String(timeCell == null ? '' : timeCell).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (x) { h = Number(x[1]); m = Number(x[2]); s = Number(x[3] || 0); }
  }
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m, s);
}

/** แถวนี้เกิดก่อนวันเริ่มนับของที่นั้นหรือเปล่า — ไม่บอกที่ = ดูเส้นทั้งระบบ */
function costBefore_(v, loc) {
  var start = costStartDate_(loc);
  if (!start) return false;
  var t = costTime_(v);
  return t > 0 && t < start;
}

/**
 * เริ่มนับใหม่เฉพาะที่ เช่น setLocationStart('ตลาดทรัพย์พัฒนา', '2026-10-01')
 *
 * ของสาขานั้นก่อนวันนี้ (รับของ ขาย ค่าใช้จ่าย นับสต็อก จ่ายคืน) ไม่ถูกนำมาคิด
 * ครัวกลางไม่โดนด้วย ของที่ครัวกลางส่งออกไปก่อนวันนี้ยังตัดจากครัวกลางตามปกติ
 * แค่ไม่ไปเป็นหนี้ของสาขา เพราะสาขาเริ่มนับใหม่แล้ว
 *
 * แล้วให้สาขานับสต็อกในวันนั้นก่อนเปิดขาย = ยอดตั้งต้น
 * ระบบคิดมูลค่าให้จากต้นทุนล่าสุดที่รู้ ไม่นับเป็นค่าใช้จ่ายวัตถุดิบ
 */
function setLocationStart(loc, ymd) {
  loc = String(loc || '').trim();
  var v = String(ymd || '').trim();
  if (!loc || !COST_START_RE.test(v)) {
    Logger.log('ใช้แบบนี้: setLocationStart(\'ตลาดทรัพย์พัฒนา\', \'2026-10-01\')');
    return;
  }
  var props = PropertiesService.getScriptProperties();
  var raw = {};
  try { raw = JSON.parse(props.getProperty('ACC_START_BY_LOC') || '{}') || {}; } catch (e) {}
  raw[loc] = v;
  props.setProperty('ACC_START_BY_LOC', JSON.stringify(raw));
  if (typeof cacheClear_ === 'function') cacheClear_();
  Logger.log('ตั้งให้ ' + loc + ' เริ่มนับใหม่ตั้งแต่ ' + v + '\n' +
             'ยอดขาย ค่าใช้จ่าย ของเข้า และการนับสต็อกของที่นี่ก่อนวันนั้น จะไม่ถูกนำมาคิด\n' +
             'ครัวกลางเดินต่อตามปกติ · แถวเก่ายังอยู่ในชีตครบ ไม่ได้ลบ\n\n' +
             'วันที่ ' + v + ' ให้นับสต็อกที่ ' + loc + ' ก่อนเปิดขาย = ยอดตั้งต้น\n' +
             'แล้วนับอีกรอบหลังปิดร้าน = ได้ต้นทุนของที่ใช้ไปวันนั้น');
  if (typeof refreshCostingSheets === 'function') refreshCostingSheets();
}

/**
 * เมนู — ใช้ยอดที่นับล่าสุดของสาขาเป็นฐาน แล้วเริ่มนับยอดขายใหม่ต่อจากนั้น
 * เช่น ปิดร้าน 5/10 นับเสร็จ 22:38 → ขีดเส้นที่ 22:38 ยอดนับรอบนั้นคือยอดตั้งต้น
 * ยอดขาย ค่าใช้จ่าย ของเสียก่อนหน้านั้นไม่นำมาคิด ยอดขายเริ่มนับวันรุ่งขึ้น
 * ไม่ต้องนับสต็อกใหม่ก่อนเปิดร้าน
 */
/** สาขาที่ใช้ตอนรันจากหน้า Apps Script (กด ▶ ที่ useLatestCountAsBase) */
var LATEST_BASE_BRANCH = 'ตลาดทรัพย์พัฒนา';

/**
 * แบบไม่ต้องมีกล่องถาม — เลือกฟังก์ชันนี้ในหน้า Apps Script แล้วกด ▶ ได้เลย
 * (รันจากหน้า Apps Script เรียกกล่องถามในชีตไม่ได้ จะขึ้น "Cannot call getUi")
 * ผลดูที่ "บันทึกการดำเนินการ" ด้านล่าง
 */
function useLatestCountAsBase() {
  var r = startFromLatestCount_(LATEST_BASE_BRANCH);
  Logger.log(r
    ? '✅ ' + LATEST_BASE_BRANCH + ' — ยอดตั้งต้น = ที่นับเมื่อ ' + r.label +
      '\nยอดขาย/ค่าใช้จ่าย/ของเสีย นับตั้งแต่หลังจากนั้น'
    : '❌ ไม่เจอยอดนับสต็อกของ "' + LATEST_BASE_BRANCH + '"');
}

function promptStartFromLatestCount() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); }
  catch (e) { useLatestCountAsBase(); return; }   // รันจากหน้า Apps Script — ไม่มีกล่องถาม
  var a = ui.prompt('ใช้ยอดนับล่าสุดเป็นฐาน', 'ชื่อสาขา (ตรงกับที่ใช้ในระบบ)', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  var loc = String(a.getResponseText() || '').trim();
  var r = startFromLatestCount_(loc);
  if (!r) { ui.alert('ไม่เจอยอดนับสต็อกของ "' + loc + '"'); return; }
  ui.alert('ตั้งแล้ว — ' + loc + '\n\nยอดตั้งต้น = ที่นับเมื่อ ' + r.label + '\n' +
           'ยอดขาย/ค่าใช้จ่าย/ของเสีย นับตั้งแต่หลังจากนั้น\n' +
           'ไม่ต้องนับสต็อกก่อนเปิดร้าน ปิดร้านแล้วนับตามปกติ');
}

/** หารอบนับล่าสุด (ไม่ใช่เช็คระดับ/ล้างยอด) แล้วขีดเส้นที่นาทีนั้น */
function startFromLatestCount_(loc) {
  loc = String(loc || '').trim();
  var best = 0;
  readMoves_(SHEET_COUNT).forEach(function (m) {
    if (m.loc !== loc || m.kind === 'ล้างยอด') return;
    if (typeof KIND_LEVEL_COUNT === 'string' && m.kind === KIND_LEVEL_COUNT) return;
    var t = costTime_(m.when);
    if (t > best) best = t;
  });
  if (!best) return null;
  // ปัดลงเป็นนาที — แถวรอบเดียวกันเขียนพร้อมกันในนาทีนั้น
  var v = Utilities.formatDate(new Date(best), costTz_(), 'yyyy-MM-dd HH:mm');
  setLocationStart(loc, v);
  return { start: v, label: Utilities.formatDate(new Date(best), costTz_(), 'd/M/yyyy HH:mm') };
}

/** ยกเลิกเส้นของที่นั้น กลับไปใช้เส้นทั้งระบบ */
function clearLocationStart(loc) {
  loc = String(loc || '').trim();
  var props = PropertiesService.getScriptProperties();
  var raw = {};
  try { raw = JSON.parse(props.getProperty('ACC_START_BY_LOC') || '{}') || {}; } catch (e) {}
  delete raw[loc];
  props.setProperty('ACC_START_BY_LOC', JSON.stringify(raw));
  if (typeof cacheClear_ === 'function') cacheClear_();
  Logger.log('ยกเลิกวันเริ่มนับของ ' + loc + ' แล้ว');
  if (typeof refreshCostingSheets === 'function') refreshCostingSheets();
}

/**
 * เมนู — เริ่มนับใหม่ทุกที่พร้อมกัน (ครัวกลาง + ทุกสาขา) ตั้งแต่วันที่ที่ใส่
 * ไม่ล้างอะไรทิ้ง แค่ขีดเส้น — วันนั้นทุกที่นับสต็อกก่อนเริ่มงาน = ยอดตั้งต้น
 * มูลค่ายอดตั้งต้นคิดจากราคาทุนล่าสุดที่เคยซื้อ (ดูประวัติก่อนเส้นได้)
 */
function promptStartDate() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); }
  catch (e) {
    // กด ▶ จากหน้า Apps Script เปิดกล่องถามไม่ได้ — ตั้งเป็น "วันนี้" ให้เลย แล้วบอกผลใน log
    var today = Utilities.formatDate(new Date(), costTz_(), 'yyyy-MM-dd');
    setStartDate(today);
    Logger.log('✅ เริ่มนับใหม่ทุกที่ตั้งแต่ ' + today + ' — วันนี้ให้ครัวกลางและทุกสาขานับสต็อกเป็นยอดตั้งต้น');
    return;
  }
  var a = ui.prompt('เริ่มนับใหม่ทุกที่พร้อมกัน',
    'วันที่เริ่ม เป็น yyyy-MM-dd เช่น 2026-10-01', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  var v = String(a.getResponseText() || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { ui.alert('รูปแบบวันไม่ถูก ต้องเป็น 2026-10-01'); return; }
  setStartDate(v);
  ui.alert('ตั้งแล้ว — วันที่ ' + v + ' ให้ครัวกลางและทุกสาขานับสต็อกก่อนเริ่มงาน\n' +
           'แล้วนับอีกรอบตอนปิดร้าน');
}

/** เมนู — ถามชื่อสาขากับวันที่ แล้วตั้งให้ */
function promptLocationStart() {
  var ui = SpreadsheetApp.getUi();
  var a = ui.prompt('เริ่มนับใหม่เฉพาะสาขา',
    'ชื่อสาขา (ตรงกับที่ใช้ในระบบ)', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  var b = ui.prompt('เริ่มนับใหม่เฉพาะสาขา',
    'วันที่เริ่ม เป็น yyyy-MM-dd เช่น 2026-10-01', ui.ButtonSet.OK_CANCEL);
  if (b.getSelectedButton() !== ui.Button.OK) return;
  setLocationStart(a.getResponseText(), b.getResponseText());
  ui.alert('ตั้งแล้ว — วันนั้นให้นับสต็อกก่อนเปิดขายเป็นยอดตั้งต้น');
}

/** ขีดเส้นเริ่มนับใหม่ เช่น setStartDate('2026-10-01') */
function setStartDate(ymd) {
  var v = String(ymd || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    Logger.log('รูปแบบวันต้องเป็น yyyy-MM-dd เช่น setStartDate(\'2026-10-01\')');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('ACC_START_DATE', v);
  if (typeof cacheClear_ === 'function') cacheClear_();
  Logger.log('ตั้งวันเริ่มนับใหม่เป็น ' + v + '\n' +
             'ยอดขาย ค่าใช้จ่าย และของที่เคลื่อนไหวก่อนวันนี้ จะไม่ถูกนำมาคิดอีก\n' +
             'แถวเก่ายังอยู่ในชีตครบ ไม่ได้ลบ — เลื่อนวันกลับเมื่อไหร่ก็เห็นเหมือนเดิม');
  if (typeof refreshCostingSheets === 'function') refreshCostingSheets();
}

/** ยกเลิกเส้น กลับไปนับทุกอย่างตั้งแต่แถวแรก */
function clearStartDate() {
  PropertiesService.getScriptProperties().deleteProperty('ACC_START_DATE');
  if (typeof cacheClear_ === 'function') cacheClear_();
  Logger.log('ยกเลิกวันเริ่มนับใหม่แล้ว — กลับไปนับทุกอย่างตั้งแต่แถวแรก');
  if (typeof refreshCostingSheets === 'function') refreshCostingSheets();
}

/** ดูว่าตอนนี้ขีดเส้นไว้วันไหน */
function showStartDate() {
  var v = PropertiesService.getScriptProperties().getProperty('ACC_START_DATE');
  Logger.log(v ? 'ทั้งระบบ: นับตั้งแต่ ' + v + ' เป็นต้นไป'
               : 'ทั้งระบบ: ยังไม่ได้ขีดเส้น — นับทุกอย่างตั้งแต่แถวแรก');
  var raw = costStarts_().raw;
  Object.keys(raw).forEach(function (k) { Logger.log(k + ': นับตั้งแต่ ' + raw[k]); });
}
function costTz_()      { return (typeof TZ === 'string' && TZ) ? TZ : 'Asia/Bangkok'; }

function costTime_(v) {
  if (v instanceof Date) return v.getTime();
  var d = new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

/* ═══════════════════ ราคาที่ซื้อมาจริง ═══════════════════ */

/**
 * ราคาที่จ่ายจริงต่อการซื้อหนึ่งครั้ง — จากชีต "ซื้อของเข้า" ที่บอทไลน์เขียนไว้
 * คีย์คือ messageId + ชื่อของ เพราะข้อความเดียวซื้อหลายอย่างได้
 * ข้อความเดียวพูดถึงของตัวเดิมสองบรรทัด ก็รวมเงินเข้าด้วยกัน
 */
function costPaidByMsg_() {
  return cached_('cost:paid', function () {
    var out = {};
    var name = (typeof INTAKE_SHEET === 'string') ? INTAKE_SHEET : 'ซื้อของเข้า';
    var sh = sheet_(name);
    if (!sh || sh.getLastRow() < 2) return out;

    var v = sh.getDataRange().getValues();
    var head = v[0].map(function (h) { return String(h).trim(); });
    var iItem = head.indexOf('รายการ');
    var iBaht = head.indexOf('จำนวนเงิน');
    var iMsg  = head.indexOf('messageId');
    if (iItem === -1 || iBaht === -1) return out;

    var iGram = head.indexOf('น้ำหนัก(กรัม)');
    var iKg   = head.indexOf('บาท/กก.');
    // ราคาต่อโลที่พิมพ์มา ("โลละ 122") — ใช้ตัวนี้เป็นต้นทุน ไม่เอายอดรวมมาหาร
    // ยอดรวมมักปัดเศษ (1.546 โล × 122 = 188.61 แต่จ่าย 188.5) หารกลับได้ 121.93 ไม่ตรงที่ซื้อ
    // จับคู่กับแถวของเข้าด้วยน้ำหนัก: ของที่นับเป็น กก. = กรัม/1000 · ของที่นับเป็นกรัม = กรัม
    out.__perKg = {};
    for (var r = 1; r < v.length; r++) {
      var item = String(v[r][iItem] || '').trim();
      var baht = Number(v[r][iBaht]) || 0;
      if (!item || !baht) continue;
      var key = (iMsg === -1 ? '' : String(v[r][iMsg] || '').trim()) + '|' + item;
      out[key] = costBaht_((out[key] || 0) + baht);
      var gram = iGram === -1 ? 0 : Number(v[r][iGram]) || 0;
      var pk   = iKg === -1 ? 0 : Number(v[r][iKg]) || 0;
      if (gram > 0 && pk > 0) {
        out.__perKg[key + '|' + costQty_(gram / 1000)] = pk;            // นับเป็น กก.
        out.__perKg[key + '|g' + costQty_(gram)] = pk / 1000;            // นับเป็นกรัม
      }
    }
    return out;
  });
}

/* ═══════════════════ ไล่เหตุการณ์ตามเวลา ═══════════════════ */

/**
 * ทุกความเคลื่อนไหวของทุกที่ เรียงตามเวลา
 * เวลาเท่ากันให้เรียงตาม step — ซื้อเข้าก่อน แพ็คทีหลัง ส่งของถัดไป
 * แล้วปิดท้ายด้วยการนับ เพราะการนับคือ "สรุปว่าตกลงเหลือเท่าไหร่"
 * ถ้าเอาการนับไปไว้ก่อนของที่เข้าเวลาเดียวกัน ของที่เพิ่งเข้าจะถูกนับทับหาย
 */
function costEvents_(all) {
  var ev = [];
  var central = costCentral_();
  var paid = costPaidByMsg_();

  // 1) ของเข้า — ครัวกลางคือซื้อเข้ามาใหม่ · สาขาคือรับมาจากครัวกลาง
  var shIn = sheet_(SHEET_INCOMING);
  if (shIn && shIn.getLastRow() > 1) {
    var mapIn = ensureCols_(shIn, MOVE_COLS.concat(['messageId']));
    var vin = shIn.getRange(2, 1, shIn.getLastRow() - 1, shIn.getLastColumn()).getValues();
    // ข้อความเดียวซื้อของชื่อเดียวกันสองบรรทัดได้ (หัวไหล่ 2 ถุงคนละน้ำหนัก)
    // ราคาในชีตซื้อของรวมเป็นก้อนเดียวตาม messageId+ชื่อ ต้องแบ่งตามจำนวน
    // ไม่งั้นทุกแถวได้ราคาเต็มก้อน ต้นทุนเบิ้ลเป็นสองเท่า
    var qtyOfKey = {};
    if (mapIn['messageId'] !== undefined) {
      vin.forEach(function (r) {
        var k = String(r[mapIn['messageId']] || '').trim() + '|' + String(r[mapIn['รายการ']] || '').trim();
        qtyOfKey[k] = (qtyOfKey[k] || 0) + (costQty_(r[mapIn['จำนวน']]) || 0);
      });
    }
    vin.forEach(function (r) {
      var item = String(r[mapIn['รายการ']] || '').trim();
      if (!item) return;
      var qty = costQty_(r[mapIn['จำนวน']]);
      if (!(qty > 0)) return;
      var loc = String(r[mapIn['สาขา']] || '').trim();
      var msg = mapIn['messageId'] !== undefined ? String(r[mapIn['messageId']] || '').trim() : '';
      var kind = String(r[mapIn['ประเภท']] || '').trim();
      if (kind === 'ของเข้าร้าน' && loc !== central) {
        ev.push({ t: costTime_(r[mapIn['วันที่เวลา']]), step: 3, type: 'ส่งเข้าร้าน',
                  loc: loc, item: item, qty: qty });
      } else {
        var key = msg + '|' + item, all = qtyOfKey[key] || qty;
        var pkMap = paid.__perKg || {};
        var perUnit = msg ? (pkMap[key + '|' + qty] || pkMap[key + '|g' + qty] || 0) : 0;
        ev.push({ t: costTime_(r[mapIn['วันที่เวลา']]), step: 1, type: 'ซื้อเข้า',
                  loc: loc, item: item, qty: qty, unit: perUnit,
                  paid: costBaht_((paid[key] || 0) * (all > 0 ? qty / all : 1)) });
      }
    });
  }

  // 2) แพ็คของ — กินของดิบ ได้ของที่แพ็คแล้ว
  var shPk = sheet_(SHEET_PACK);
  if (shPk && shPk.getLastRow() > 1) {
    var mapPk = ensureCols_(shPk, PACK_COLS);
    var vpk = shPk.getRange(2, 1, shPk.getLastRow() - 1, shPk.getLastColumn()).getValues();
    vpk.forEach(function (r) {
      var item = String(r[mapPk['รายการ']] || '').trim();
      var raws = [];
      for (var k = 0; k < PACK_RAW_SLOTS; k++) {
        var c = packRawCols_(k);
        if (mapPk[c.name] === undefined) continue;
        var rn = String(r[mapPk[c.name]] || '').trim();
        var rq = costQty_(r[mapPk[c.qty]]);
        if (rn && rq > 0) raws.push({ name: rn, qty: rq });
      }
      if (!item && !raws.length) return;
      ev.push({ t: costTime_(r[mapPk['วันที่เวลา']]), step: 2, type: 'แพ็คของ',
                loc: String(r[mapPk['สาขา']] || '').trim() || central,
                item: item, qty: costQty_(r[mapPk['จำนวน']]), raws: raws });
    });
  }

  // 3) ของเสีย
  var shW = sheet_(SHEET_WASTE);
  if (shW && shW.getLastRow() > 1) {
    var mapW = ensureCols_(shW, MOVE_COLS);
    var vw = shW.getRange(2, 1, shW.getLastRow() - 1, shW.getLastColumn()).getValues();
    vw.forEach(function (r) {
      var item = String(r[mapW['รายการ']] || '').trim();
      var qty = costQty_(r[mapW['จำนวน']]);
      if (!item || !(qty > 0)) return;
      ev.push({ t: costTime_(r[mapW['วันที่เวลา']]), step: 4, type: 'ของเสีย',
                loc: String(r[mapW['สาขา']] || '').trim(), item: item, qty: qty,
                reason: String(r[mapW['ประเภท']] || '').trim() });
    });
  }

  // 4) เช็คสต็อก
  var shC = sheet_(SHEET_COUNT);
  if (shC && shC.getLastRow() > 1) {
    var mapC = ensureCols_(shC, MOVE_COLS);
    var vc = shC.getRange(2, 1, shC.getLastRow() - 1, shC.getLastColumn()).getValues();
    var hc = shC.getRange(1, 1, 1, shC.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    var iCost = hc.indexOf(COUNT_COST_COL), iTo = hc.indexOf(COUNT_CHARGE_COL);
    vc.forEach(function (r) {
      var item = String(r[mapC['รายการ']] || '').trim();
      if (!item) return;
      // ล้างยอดตั้งต้น ไม่ใช่ของที่ถูกใช้ไป จึงไม่คิดเป็นค่าใช้จ่ายวัตถุดิบ
      var kindC = String(r[mapC['ประเภท']] || '').trim();
      // เช็คระดับไม่มีตัวเลข ถ้าเอามาคิดจะกลายเป็นนับได้ 0 แล้วตัดเป็นใช้ไปหมด
      if (typeof KIND_LEVEL_COUNT === 'string' && kindC === KIND_LEVEL_COUNT) return;
      ev.push({ t: costTime_(r[mapC['วันที่เวลา']]), step: 5,
                type: kindC === 'ล้างยอด' ? 'ล้างยอด' : 'เช็คสต็อก',
                loc: String(r[mapC['สาขา']] || '').trim(), item: item,
                qty: costQty_(r[mapC['จำนวน']]),
                // ตั้งยอดครัวกลาง (setCentralStock_) — ราคาทุนที่บอกมา กับที่ที่รับส่วนที่หายไป
                cost: iCost === -1 ? 0 : Number(r[iCost]) || 0,
                chargeTo: iTo === -1 ? '' : String(r[iTo] || '').trim() });
    });
  }

  // ตัดของก่อนวันเริ่มนับออกตั้งแต่ต้นทาง — แต่ละที่มีเส้นของตัวเองได้
  // all = ขอทุกแถวไม่ตัด ใช้ตอนหาราคาทุนล่าสุด (ของเก่าก็บอกราคาได้)
  if (!all) {
    ev = ev.filter(function (e) {
      // แถวที่ไม่มีวันที่ (เช่นพิมพ์เพิ่มเองในชีตแล้วลืมใส่วัน) บอกไม่ได้ว่าอยู่ก่อนหรือหลังเส้น
      // ถ้าเก็บไว้มันจะถูกเรียงไปอยู่หน้าสุด แล้วค้างเป็นสต็อกผีหลังเริ่มนับใหม่ — ถือว่าอยู่ก่อนเส้น
      if (!(e.t > 0)) return !costStartDate_(e.loc || central);
      if (e.type === 'ส่งเข้าร้าน') {
        // ส่งของมีสองฝั่ง ครัวกลางยังไม่เริ่ม = ทิ้งทั้งคู่
        if (e.t < costStartDate_(central)) return false;
        // ครัวกลางเริ่มแล้วแต่สาขายังไม่เริ่ม = ตัดออกจากครัวกลาง แต่ไม่ไปเป็นของสาขา
        if (e.t < costStartDate_(e.loc)) e.preStart = true;
        return true;
      }
      return !(e.t < costStartDate_(e.loc));
    });
  }
  ev.sort(function (a, b) { return (a.t - b.t) || (a.step - b.step); });
  return ev;
}

/* ═══════════════════ เครื่องคิดต้นทุน ═══════════════════ */

/**
 * ไล่ทุกเหตุการณ์ตั้งแต่แถวแรก แล้วคืนสภาพ ณ ตอนนี้
 *   layers  ชั้นต้นทุนที่ยังเหลือ  loc → item → [{qty, cost}]
 *   used    ของที่ออกไปแล้ว       loc → { ใช้ไป, ของเสีย, นับเกิน }
 *   sent    มูลค่าของที่ส่งไปให้สาขาสะสม = ยอดหนี้ก่อนหักเงินที่จ่ายคืน
 *   moved   มูลค่าที่ส่งออกจากครัวกลาง แยกรายสินค้า
 *   log     ต้นทุนที่รับรู้แต่ละครั้ง พร้อมวันที่ — บัญชีเอาไปลงให้ตรงเดือน
 *   warn    จุดที่ตัวเลขไม่สมบูรณ์ ต้องบอก ไม่ใช่กลืนเงียบ ๆ
 */
function costReplay_() {
  return cached_('cost:replay', costReplayRaw_);
}

function costReplayRaw_(all) {
  var central = costCentral_();
  var lay = {}, used = {}, sent = {}, moved = {}, warn = [], log = [];
  var lastCost = {};     // loc|item → ต้นทุนต่อหน่วยที่รู้ล่าสุด ไว้เดาตอนไม่มีบิล
  // ราคาจากประวัติทั้งหมด รวมก่อนวันเริ่มนับ — ยอดตั้งต้นของสาขาต้องมีราคา
  // ไม่งั้นนับวันแรกแล้วต้นทุนเป็น 0 กำไรวันนั้นจะดูดีเกินจริงทั้งก้อน
  var book = all ? {} : costPriceBook_();

  function box(loc, item) {
    if (!lay[loc]) lay[loc] = {};
    if (!lay[loc][item]) lay[loc][item] = [];
    return lay[loc][item];
  }
  function bucket(loc) {
    if (!used[loc]) used[loc] = { ใช้ไป: 0, ของเสีย: 0, นับเกิน: 0, items: {} };
    return used[loc];
  }
  function noteItem(loc, item, what, qty, value, when) {
    // จดวันที่ไว้ด้วย บัญชีจะได้เอาไปลงให้ตรงเดือน
    if (what !== 'นับเกิน' && value) {
      log.push({ t: when, loc: loc, item: item, kind: what, qty: qty, value: value });
    }
    var b = bucket(loc);
    if (!b.items[item]) b.items[item] = { ใช้ไป: 0, ของเสีย: 0, นับเกิน: 0, qty: 0 };
    b[what] = costBaht_(b[what] + value);
    b.items[item][what] = costBaht_(b.items[item][what] + value);
    if (what !== 'นับเกิน') b.items[item].qty = costQty_(b.items[item].qty + qty);
  }
  function total(loc, item) {
    return costQty_(box(loc, item).reduce(function (s, l) { return s + l.qty; }, 0));
  }
  function put(loc, item, qty, cost, shown) {
    if (!(qty > 0)) return;
    // shown = ราคาต่อหน่วยที่พิมพ์มาเอง (โลละ 84) ไว้โชว์ — คิดเงินยังใช้ cost
    box(loc, item).push(shown > 0 ? { qty: qty, cost: cost, shown: shown } : { qty: qty, cost: cost });
    if (cost > 0) lastCost[loc + '|' + item] = cost;
  }
  /**
   * ดึงของออกแบบเข้าก่อนออกก่อน
   * คืน parts มาด้วย = ดึงมาจากชั้นไหนบ้าง ชั้นละเท่าไหร่ ราคาเท่าไหร่
   * ตอนส่งเข้าร้านต้องยกทั้งชั้นไปตั้งที่สาขา ไม่ใช่เฉลี่ยรวมเป็นราคาเดียว
   * ไม่งั้นของที่ซื้อมาคนละราคาจะถูกกลืนเป็นราคากลาง แล้วต้นทุนที่สาขา
   * จะไม่ตรงกับตอนที่รับมา
   */
  function take(loc, item, qty) {
    var a = box(loc, item), value = 0, got = 0, parts = [];
    while (qty > 0.00001 && a.length) {
      var l = a[0];
      var n = Math.min(l.qty, qty);
      value += n * l.cost;
      parts.push({ qty: costQty_(n), cost: l.cost });
      got += n; l.qty = costQty_(l.qty - n); qty = costQty_(qty - n);
      if (l.qty <= 0.00001) a.shift();
    }
    return { qty: costQty_(got), value: costBaht_(value),
             short: costQty_(qty), parts: parts };
  }
  function guessCost(loc, item) {
    return lastCost[loc + '|' + item] || lastCost[central + '|' + item] ||
           book[loc + '|' + item] || book[central + '|' + item] || 0;
  }

  // รอบนับแรกหลังเส้นเริ่มนับของสาขา = ยอดตั้งต้น
  // ของพวกนั้นครัวกลางส่งไปก่อนเริ่มนับ สาขาไม่ได้จ่ายคืน จึงไม่ใช่ต้นทุนของสาขา → มูลค่า 0
  // (ครัวกลางยังตีมูลค่ายอดตั้งต้นตามราคาที่ซื้อมาเหมือนเดิม เพราะเป็นเงินของครัวกลางเอง)
  var baseAt = {};
  function isBranchBase(e) {
    if (all || e.loc === central || !costStartDate_(e.loc)) return false;
    if (baseAt[e.loc] === undefined) baseAt[e.loc] = e.t;
    return Math.abs(e.t - baseAt[e.loc]) <= 60000;
  }

  costEvents_(all).forEach(function (e) {
    if (e.type === 'ซื้อเข้า') {
      // ซื้อผ่านไลน์จะมีราคามาด้วย · กรอกในเว็บไม่มี ต้องเดาจากราคาล่าสุด
      // มูลค่า = เงินที่จ่ายจริง (75.25) · ราคาต่อโลที่โชว์ = ที่พิมพ์มา (โลละ 84)
      // ถ้าเอา 84 × 0.896 จะได้ 75.26 ไม่ตรงกับที่จ่าย เพราะร้านปัดเศษยอดรวม
      var unit = e.paid > 0 ? e.paid / e.qty : (e.unit > 0 ? e.unit : guessCost(e.loc, e.item));
      if (!(unit > 0)) {
        warn.push({ when: e.t, loc: e.loc, item: e.item,
                    msg: 'ไม่รู้ราคาที่ซื้อมา — คิดต้นทุนเป็น 0' });
      }
      put(e.loc, e.item, e.qty, unit, e.unit > 0 ? e.unit : 0);

    } else if (e.type === 'แพ็คของ') {
      // ต้นทุนของที่แพ็คแล้ว = ต้นทุนของดิบที่กินไปทั้งหมด หารด้วยจำนวนที่ได้
      var sum = 0;
      e.raws.forEach(function (r) {
        var t = take(e.loc, r.name, r.qty);
        sum += t.value;
        if (t.short > 0) {
          warn.push({ when: e.t, loc: e.loc, item: r.name,
                      msg: 'แพ็คของโดยที่ของดิบในระบบไม่พอ ขาด ' + t.short });
        }
      });
      if (e.qty > 0) put(e.loc, e.item, e.qty, sum / e.qty);

    } else if (e.type === 'ส่งเข้าร้าน' && e.preStart) {
      // ส่งไปก่อนสาขาเริ่มนับใหม่ — ออกจากครัวกลางจริง แต่ไม่ใช่หนี้รอบนี้ของสาขา
      var t0 = take(central, e.item, e.qty);
      moved[e.item] = costBaht_((moved[e.item] || 0) + t0.value);

    } else if (e.type === 'ส่งเข้าร้าน') {
      // กินชั้นครัวกลางตามลำดับที่ซื้อมา แล้วยกไปตั้งที่สาขาในราคาเดิมเป๊ะ
      var t2 = take(central, e.item, e.qty);
      var unitCost = t2.qty > 0 ? t2.value / t2.qty : guessCost(central, e.item);
      var value = costBaht_(t2.value + t2.short * unitCost);
      if (t2.short > 0) {
        warn.push({ when: e.t, loc: central, item: e.item,
                    msg: 'ส่งเข้าร้านมากกว่าที่ครัวกลางมี ขาด ' + t2.short +
                         ' — คิดต้นทุนจากราคาล่าสุดแทน' });
      }
      // ยกทั้งชั้นไปตั้งที่สาขา ราคาต่อหน่วยของแต่ละชั้นเท่าเดิมเป๊ะ
      t2.parts.forEach(function (pt) { put(e.loc, e.item, pt.qty, pt.cost); });
      if (t2.short > 0) put(e.loc, e.item, t2.short, unitCost);
      // ของที่นับเป็นระดับ (กระดูกหมู น้ำดำ) นับเป็นตัวเลขไม่ได้ ต้นทุนจึงไม่มีวัน
      // ถูกตัดจากการนับ — ถือว่าใช้ไปทันทีที่ถึงสาขา ไม่งั้นค้างเป็นสต็อกตลอดไป
      if (typeof isLevelItem_ === 'function' && isLevelItem_(e.item)) {
        var tl = take(e.loc, e.item, e.qty);
        noteItem(e.loc, e.item, 'ใช้ไป', tl.qty, tl.value, e.t);
      }
      // ของออกจากครัวกลางแล้วเป็นหนี้ทันทีเต็มจำนวน — จะขายได้หรือทิ้งก็หนี้เท่าเดิม
      sent[e.loc] = costBaht_((sent[e.loc] || 0) + value);
      moved[e.item] = costBaht_((moved[e.item] || 0) + value);

    } else if (e.type === 'ของเสีย') {
      var t3 = take(e.loc, e.item, e.qty);
      noteItem(e.loc, e.item, 'ของเสีย', t3.qty, t3.value, e.t);

    } else if (e.type === 'ล้างยอด') {
      // ทิ้งชั้นต้นทุนเดิมทั้งหมด แล้วตั้งใหม่ตามยอดที่สั่ง ไม่ลงบัญชีอะไรเลย
      // ใช้ตอนเริ่มระบบหรือรีเซ็ต ไม่ใช่การนับสต็อกปกติ
      box(e.loc, e.item).length = 0;
      if (e.qty > 0) put(e.loc, e.item, e.qty, guessCost(e.loc, e.item));

    } else if (e.type === 'เช็คสต็อก') {
      // นับได้เท่าไหร่คือเท่านั้น ส่วนที่หายไประหว่างสองรอบนับคือของที่ใช้ไป
      var have = total(e.loc, e.item);
      var diff = costQty_(have - e.qty);
      var base = isBranchBase(e);
      if (diff > 0.00001) {
        var t4 = take(e.loc, e.item, diff);
        // ตั้งยอดครัวกลางแล้วบอกว่าส่วนที่หายไปเป็นของสาขาไหน (ส่งไปแล้วไม่ได้ลง)
        // → เป็นค่าวัตถุดิบของสาขานั้น ไม่ใช่ของครัวกลาง (ไม่ไปเป็นหนี้ที่ต้องจ่ายคืน)
        if (e.chargeTo && e.chargeTo !== e.loc) {
          noteItem(e.chargeTo, e.item, 'ใช้ไป', t4.qty, t4.value, e.t);
          bucket(e.chargeTo).ตัดจากครัวกลาง = costBaht_((bucket(e.chargeTo).ตัดจากครัวกลาง || 0) + t4.value);
        } else {
          noteItem(e.loc, e.item, 'ใช้ไป', t4.qty, t4.value, e.t);
        }
      } else if (diff < -0.00001) {
        // นับได้มากกว่าในระบบ — รวมถึงการนับวันแรกหลังเริ่มนับใหม่ (ยอดตั้งต้น)
        // ไม่ใช่ค่าใช้จ่าย ใส่มูลค่าตามราคาที่บอกมา หรือต้นทุนล่าสุดที่รู้
        var add = -diff;
        var c = e.cost > 0 ? e.cost : (base ? 0 : guessCost(e.loc, e.item));
        if (!(c > 0) && !all && !base) {
          warn.push({ when: e.t, loc: e.loc, item: e.item,
                      msg: 'นับได้เกินระบบแต่ไม่รู้ราคาทุน — คิดเป็น 0' });
        }
        put(e.loc, e.item, add, c, e.cost > 0 ? e.cost : 0);
        noteItem(e.loc, e.item, 'นับเกิน', add, costBaht_(add * c), e.t);
      }
    }
  });

  log.sort(function (a, b) { return a.t - b.t; });
  return { layers: lay, used: used, sent: sent, moved: moved, warn: warn, log: log,
           lastCost: lastCost };
}

/** ราคาทุนล่าสุดของทุกอย่าง จากประวัติทั้งหมด ไม่สนเส้นเริ่มนับ */
function costPriceBook_() {
  return cached_('cost:prices', function () { return costReplayRaw_(true).lastCost; });
}

/* ═══════════════════ เงินที่สาขาจ่ายคืนแล้ว ═══════════════════ */

/** ยอดที่สาขาโอนคืนครัวกลางแล้ว — กรอกเองในชีต COST_SHEET_PAY */
function costPaidBack_() {
  var out = {};
  var sh = sheet_(COST_SHEET_PAY);
  if (!sh || sh.getLastRow() < 2) return out;
  var map = ensureCols_(sh, COST_PAY_COLS);
  sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues().forEach(function (r) {
    var loc = String(r[map['สาขา']] || '').trim();
    if (costBefore_(r[map['วันที่']], loc)) return;
    var baht = Number(r[map['จำนวนเงิน']]) || 0;
    if (!loc || !baht) return;
    out[loc] = costBaht_((out[loc] || 0) + baht);
  });
  return out;
}

/* ═══════════════════ รายรับและค่าใช้จ่ายของแต่ละที่ ═══════════════════ */

/** เงินที่ขายได้ แยกตามสาขา — จากบิลหน้าร้านและเดลิเวอรี่ */
function costIncome_() {
  var out = {};
  function add(loc, key, baht) {
    loc = String(loc || '').trim();
    if (!loc || !baht) return;
    if (!out[loc]) out[loc] = { หน้าร้าน: 0, เดลิเวอรี่: 0, รวม: 0, ค่าคอม: 0, ตามแอป: {} };
    out[loc][key] = costBaht_(out[loc][key] + baht);
    out[loc]['รวม'] = costBaht_(out[loc]['รวม'] + baht);
  }

  var sh = sheet_(SHEET_ORDERS);
  if (sh && sh.getLastRow() > 1) {
    var v = sh.getDataRange().getValues();
    var h = v[0].map(function (x) { return String(x).trim(); });
    var iLoc = h.indexOf('สาขา'), iNet = h.indexOf('ยอดสุทธิ'), iDate = h.indexOf('วันที่');
    var iTime = h.indexOf('เวลา');
    if (iLoc !== -1 && iNet !== -1) {
      for (var r = 1; r < v.length; r++) {
        if (iDate !== -1 && costBefore_(costRowTime_(v[r][iDate], iTime === -1 ? '' : v[r][iTime]), v[r][iLoc])) continue;
        add(v[r][iLoc], 'หน้าร้าน', Number(v[r][iNet]) || 0);
      }
    }
  }

  // เดลิเวอรี่เก็บรายการไว้เป็น JSON ไม่มียอดเงินตรง ๆ ต้องคูณราคาเอง
  var shD = sheet_(SHEET_DELIVERY);
  if (shD && shD.getLastRow() > 1) {
    var price = {};
    if (typeof itemCatalogue_ === 'function') {
      try { itemCatalogue_().forEach(function (it) { if (it.price) price[it.name] = it.price; }); }
      catch (e) {}
    }
    var vd = shD.getDataRange().getValues();
    var hd = vd[0].map(function (x) { return String(x).trim(); });
    var jLoc = hd.indexOf('สาขา'), jData = hd.indexOf('ข้อมูล');
    var jPf  = hd.indexOf('แพลตฟอร์ม'), jAmt = hd.indexOf('ยอดเงิน');
    if (jLoc !== -1 && jData !== -1) {
      var jDate = hd.indexOf('วันที่'), jTime = hd.indexOf('เวลา');
      for (var d = 1; d < vd.length; d++) {
        if (jDate !== -1 && costBefore_(costRowTime_(vd[d][jDate], jTime === -1 ? '' : vd[d][jTime]), vd[d][jLoc])) continue;
        // ยอดที่แอปแจ้งแม่นกว่าการเดาจากรายการราคา เพราะราคาบนแอปตั้งสูงกว่าหน้าร้าน
        var amt = jAmt === -1 ? 0 : Number(vd[d][jAmt]) || 0;
        if (!amt) {
          try {
            JSON.parse(vd[d][jData] || '[]').forEach(function (it) {
              amt += (Number(it.qty) || 0) * (price[it.name] || 0);
            });
          } catch (e) {}
        }
        if (!amt) continue;
        var loc2 = String(vd[d][jLoc] || '').trim();
        add(loc2, 'เดลิเวอรี่', amt);
        // ค่า GP ที่แอปหัก — คิดจากราคาบนแอป ไม่ใช่เงินที่โอนเข้าบัญชี
        var pf = jPf === -1 ? '' : String(vd[d][jPf] || '').trim();
        var cut = (typeof deliveryCutRate_ === 'function') ? deliveryCutRate_(pf) : 0;
        var fee = costBaht_(amt * cut);
        if (!out[loc2]) return;
        if (!out[loc2]['ค่าคอม']) out[loc2]['ค่าคอม'] = 0;
        if (!out[loc2]['ตามแอป']) out[loc2]['ตามแอป'] = {};
        out[loc2]['ค่าคอม'] = costBaht_(out[loc2]['ค่าคอม'] + fee);
        var key = pf || 'ไม่ระบุแอป';
        if (!out[loc2]['ตามแอป'][key]) out[loc2]['ตามแอป'][key] = { ขาย: 0, ค่าคอม: 0 };
        out[loc2]['ตามแอป'][key]['ขาย'] = costBaht_(out[loc2]['ตามแอป'][key]['ขาย'] + amt);
        out[loc2]['ตามแอป'][key]['ค่าคอม'] = costBaht_(out[loc2]['ตามแอป'][key]['ค่าคอม'] + fee);
      }
    }
  }
  return out;
}

/** เงินสดที่จ่ายออกหน้าร้าน แยกตามสาขาและประเภท */
function costOutgo_() {
  var out = {};
  var sh = sheet_(SHEET_EXPENSE);
  if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getDataRange().getValues();
  var h = v[0].map(function (x) { return String(x).trim(); });
  var iLoc = h.indexOf('สาขา'), iBaht = h.indexOf('จำนวนเงิน'), iType = h.indexOf('ประเภท');
  var iDate = h.indexOf('วันที่'), iTime = h.indexOf('เวลา');
  if (iLoc === -1 || iBaht === -1) return out;
  for (var r = 1; r < v.length; r++) {
    if (iDate !== -1 && costBefore_(costRowTime_(v[r][iDate], iTime === -1 ? '' : v[r][iTime]), v[r][iLoc])) continue;
    var loc = String(v[r][iLoc] || '').trim();
    var baht = Number(v[r][iBaht]) || 0;
    if (!loc || !baht) continue;
    var type = iType === -1 ? 'อื่น ๆ' : (String(v[r][iType] || '').trim() || 'อื่น ๆ');
    if (!out[loc]) out[loc] = { รวม: 0, ตามประเภท: {} };
    out[loc]['รวม'] = costBaht_(out[loc]['รวม'] + baht);
    out[loc]['ตามประเภท'][type] = costBaht_((out[loc]['ตามประเภท'][type] || 0) + baht);
  }
  return out;
}

/* ═══════════════════ สรุปให้อ่านง่าย ═══════════════════ */

/**
 * ภาพรวมทั้งระบบ ณ วินาทีนี้
 *   stock   มูลค่าวัตถุดิบคงเหลือ แยกตามที่ และแยกรายตัว
 *   owed    ค้างชำระ = ที่ส่งไปสะสม − ที่จ่ายคืนแล้ว
 *   used    ค่าใช้จ่ายวัตถุดิบสะสมของแต่ละที่
 */
function costSummary_() {
  var rep = costReplay_();
  var back = costPaidBack_();
  var central = costCentral_();

  var stock = {};
  Object.keys(rep.layers).forEach(function (loc) {
    var rows = [], sum = 0;
    Object.keys(rep.layers[loc]).forEach(function (item) {
      var qty = 0, value = 0, shown = null;
      rep.layers[loc][item].forEach(function (l) {
        qty += l.qty; value += l.qty * l.cost;
        // ทุกชั้นพิมพ์ราคาต่อโลเท่ากัน = โชว์ราคานั้น ไม่งั้นโชว์ค่าเฉลี่ย
        shown = (shown === null) ? (l.shown || 0) : (shown === l.shown ? shown : 0);
      });
      qty = costQty_(qty); value = costBaht_(value);
      if (qty <= 0.00001 && value === 0) return;
      // จำนวนแบบเดียวกับหน้าสต็อกคงเหลือ (แพ็ค/ไม้/ชิ้น) — เดิมโชว์เลขหน่วยเล็กสุดเฉย ๆ
      // เต้าชีส 34 (ชิ้น) กับ "1 แพ็ค 7 ไม้" เลยดูเหมือนไม่ตรงกันทั้งที่เป็นยอดเดียวกัน
      var it = (typeof findStockItem_ === 'function') ? findStockItem_(item) : null;
      var bu = it && typeof baseUnitOf_ === 'function' ? baseUnitOf_(it) : '';
      // ราคาต่อกรัม/ต่ออันเล็กมาก (0.1049) ปัดเป็นสตางค์ไม่ได้ เก็บ 4 ตำแหน่ง
      var r4 = function (n) { return Math.round((Number(n) || 0) * 10000) / 10000; };
      var unit = r4(shown > 0 ? shown : (qty > 0 ? value / qty : 0));
      // ต้นทุนต่อหน่วยที่ขาย (ไม้) ไม่ใช่ต่อชิ้น — เต้าชีส 2.88/ชิ้น = 5.77/ไม้
      var per = it && typeof perStickOf_ === 'function' ? perStickOf_(it) : 1;
      rows.push({ item: item, qty: qty, value: value, baseUnit: bu,
                  text: it && typeof fmtPack_ === 'function' ? fmtPack_(qty, it) : String(qty),
                  unit: unit,
                  subUnit: it ? it.subUnit : bu,
                  unitSub: per > 1 ? r4(qty > 0 ? value / qty * per : unit * per) : unit });
      sum += value;
    });
    rows.sort(function (a, b) { return b.value - a.value; });
    stock[loc] = { rows: rows, total: costBaht_(sum) };
  });

  var income = costIncome_(), outgo = costOutgo_();

  var owed = {};
  function seat(loc) {
    if (owed[loc]) return owed[loc];
    var u = rep.used[loc] || {};
    var sent = rep.sent[loc] || 0;
    var paid = back[loc] || 0;
    // ของที่ตัดจากครัวกลางตอนตั้งยอด ไม่ได้ส่งผ่านระบบ จึงไม่ใช่หนี้ที่ต้องจ่ายคืน
    var gone = costBaht_((u['ใช้ไป'] || 0) + (u['ของเสีย'] || 0) - (u['ตัดจากครัวกลาง'] || 0));
    // เงินที่สาขาถืออยู่ = ขายได้ − จ่ายค่าใช้จ่ายหน้าร้าน − โอนคืนครัวกลางไปแล้ว
    var cash = costBaht_(((income[loc] || {})['รวม'] || 0) -
                         ((outgo[loc] || {})['รวม'] || 0) - paid);
    owed[loc] = {
      ส่งไปแล้ว:   sent,                              // ของออกจากครัวกลาง = หนี้ทันที
      ใช้ไป:       u['ใช้ไป'] || 0,
      ของเสีย:     u['ของเสีย'] || 0,
      จ่ายคืนแล้ว: paid,
      // จ่ายครบแล้วของที่เหลือไม่ใช่หนี้ เป็นวัตถุดิบคงเหลือของสาขาเฉย ๆ
      ค้างชำระ:    costBaht_(sent - paid),
      ค่าของที่ใช้ไปแล้ว: costBaht_(Math.max(0, gone - paid)),
      เงินในมือ: cash,
      // มีเงินเท่าไหร่ก็จ่ายเท่านั้น แต่ไม่เกินยอดที่ค้างอยู่
      // ใช้ของไปแค่ 180 แต่มีเงิน 600 ค้างอยู่ 300 ก็เคลียร์ 300 ไปเลย
      // ของที่ยังไม่ได้ใช้ก็ยังอยู่ในสต็อกสาขาเหมือนเดิม แค่จ่ายเงินล่วงหน้าไว้
      จ่ายได้เลย: costBaht_(Math.max(0, Math.min(cash, sent - paid))),
      วัตถุดิบคงเหลือ: (stock[loc] || { total: 0 }).total
    };
    return owed[loc];
  }
  Object.keys(rep.sent).forEach(seat);
  Object.keys(rep.used).forEach(function (l) { if (l !== central) seat(l); });
  Object.keys(back).forEach(seat);
  delete owed[central];

  // งบของแต่ละที่ — สาขามีรายได้ ครัวกลางไม่มี (ส่งต่อที่ต้นทุน)
  var pl = {};
  var locs = {};
  [stock, owed, rep.used, income, outgo].forEach(function (o) {
    Object.keys(o).forEach(function (l) { locs[l] = true; });
  });
  Object.keys(locs).forEach(function (loc) {
    var inc = income[loc] || { หน้าร้าน: 0, เดลิเวอรี่: 0, รวม: 0, ค่าคอม: 0, ตามแอป: {} };
    var u = rep.used[loc] || { ใช้ไป: 0, ของเสีย: 0 };
    var ex = outgo[loc] || { รวม: 0, ตามประเภท: {} };
    var cogs = costBaht_((u['ใช้ไป'] || 0) + (u['ของเสีย'] || 0));
    var fee = inc['ค่าคอม'] || 0;
    pl[loc] = {
      รายได้: inc['รวม'], หน้าร้าน: inc['หน้าร้าน'], เดลิเวอรี่: inc['เดลิเวอรี่'],
      ค่าคอมแอป: fee, ตามแอป: inc['ตามแอป'] || {},
      // เงินที่เข้ากระเป๋าจริง = ราคาบนแอป − ค่า GP − VAT ของ GP
      เงินเข้าจริง: costBaht_(inc['รวม'] - fee),
      ค่าใช้จ่ายวัตถุดิบ: u['ใช้ไป'] || 0,
      ของเสีย: u['ของเสีย'] || 0,
      กำไรขั้นต้น: costBaht_(inc['รวม'] - fee - cogs),
      ค่าใช้จ่ายอื่น: ex['รวม'], ตามประเภท: ex['ตามประเภท'],
      กำไรสุทธิ: costBaht_(inc['รวม'] - fee - cogs - ex['รวม']),
      วัตถุดิบคงเหลือ: (stock[loc] || { total: 0 }).total
    };
  });

  return { central: central, stock: stock, owed: owed,
           used: rep.used, pl: pl, warn: rep.warn };
}

/* ═══════════════════ เขียนลงชีต ═══════════════════ */

function costWriteSheet_(name, headers, rows, note) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  var top = [[note]];
  sh.getRange(1, 1, 1, 1).setValues(top).setFontWeight('bold');
  sh.getRange(2, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#f3f3f4');
  if (rows.length) sh.getRange(3, 1, rows.length, headers.length).setValues(rows);
  sh.setFrozenRows(2);
  return sh;
}

/** มูลค่าสต็อกทุกที่ → ชีต "บัญชี_มูลค่าสต็อก" */
function buildStockValue() {
  cacheClear_();
  var s = costSummary_();
  var rows = [];
  Object.keys(s.stock).forEach(function (loc) {
    if (!s.stock[loc].rows.length) return;      // ไม่มีของก็ไม่ต้องมีแถวรวม
    s.stock[loc].rows.forEach(function (r) {
      rows.push([loc, r.item, r.text || r.qty, r.unitSub != null ? r.unitSub : r.unit,
                 r.subUnit || r.baseUnit || '', r.value, r.qty, r.baseUnit || '']);
    });
    rows.push([loc, '— รวม —', '', '', '', s.stock[loc].total, '', '']);
  });
  // คงเหลือแบบเดียวกับหน้าสต็อก · ต้นทุนต่อหน่วยที่ขาย (ไม้/ถุง/กก.) · จำนวนหน่วยเล็กสุดไว้ท้ายตาราง
  costWriteSheet_(COST_SHEET_STOCK,
    ['สถานที่', 'สินค้า', 'คงเหลือ', 'ต้นทุน', 'ต่อ', 'มูลค่า', 'จำนวน (หน่วยเล็กสุด)', 'หน่วยเล็กสุด'], rows,
    'มูลค่าสต็อกแบบเข้าก่อนออกก่อน · อัปเดตเมื่อ ' +
    Utilities.formatDate(new Date(), costTz_(), 'd/M/yyyy HH:mm') +
    ' · สั่งใหม่ได้ด้วย buildStockValue()');

  if (s.warn.length) {
    Logger.log('⚠️ มีจุดที่ตัวเลขไม่สมบูรณ์ ' + s.warn.length + ' จุด:\n  ' +
      s.warn.slice(0, 20).map(function (w) {
        return w.loc + ' · ' + w.item + ' — ' + w.msg;
      }).join('\n  '));
  }
  Logger.log('เขียนชีต "' + COST_SHEET_STOCK + '" แล้ว ' + rows.length + ' แถว');
}

/** ครัวกลางส่งของไปเท่าไหร่ สาขาใช้ไปเท่าไหร่ ค้างชำระเท่าไหร่ */
function buildBranchLedger() {
  cacheClear_();
  var s = costSummary_();
  var rows = [];
  Object.keys(s.owed).forEach(function (loc) {
    var u = s.used[loc] || { ใช้ไป: 0, ของเสีย: 0, นับเกิน: 0 };
    var st = s.stock[loc] || { total: 0 };
    var o = s.owed[loc];
    rows.push([loc, o['ส่งไปแล้ว'], o['ใช้ไป'], o['ของเสีย'], o['จ่ายคืนแล้ว'],
               o['ค้างชำระ'], o['เงินในมือ'], o['จ่ายได้เลย'], st.total]);
  });
  var c = s.central;
  var uc = s.used[c] || { ใช้ไป: 0, ของเสีย: 0 };
  rows.push([c + ' (คงเหลือในครัว)', '', uc['ใช้ไป'], uc['ของเสีย'], '', '', '', '',
             (s.stock[c] || { total: 0 }).total]);

  costWriteSheet_(COST_SHEET_LEDGER,
    ['สถานที่', 'รับของไปแล้ว', 'ใช้ไปจริง', 'ของเสีย', 'จ่ายคืนแล้ว',
     'ค้างชำระ', 'เงินในมือ', 'จ่ายได้เลย', 'มูลค่าวัตถุดิบคงเหลือ'], rows,
    'ของออกจากครัวกลางแล้วเป็นหนี้ทันที · มีเงินเท่าไหร่จ่ายเท่านั้น แต่ไม่เกินที่ค้าง · อัปเดตเมื่อ ' +
    Utilities.formatDate(new Date(), costTz_(), 'd/M/yyyy HH:mm') +
    ' · สาขาจ่ายคืนกรอกในชีต "' + COST_SHEET_PAY + '"');
  Logger.log('เขียนชีต "' + COST_SHEET_LEDGER + '" แล้ว ' + rows.length + ' แถว');
}

/** สร้างชีตให้กรอกเงินที่สาขาโอนคืนครัวกลาง */
function setupCosting() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(COST_SHEET_PAY);
  if (!sh) {
    sh = ss.insertSheet(COST_SHEET_PAY);
    sh.getRange(1, 1, 1, COST_PAY_COLS.length).setValues([COST_PAY_COLS])
      .setFontWeight('bold').setBackground('#f3f3f4');
    sh.setFrozenRows(1);
    Logger.log('สร้างชีต "' + COST_SHEET_PAY + '" แล้ว — เวลาสาขาโอนเงินคืนครัวกลาง มากรอกที่นี่');
  } else {
    Logger.log('มีชีต "' + COST_SHEET_PAY + '" อยู่แล้ว');
  }
  refreshCostingSheets();
  Logger.log('\nอยากให้ชีตอัปเดตเองทุกชั่วโมง สั่ง setupCostingTriggers() อีกทีนึง');
}

/* ═══════════════════ ให้ชีตอัปเดตเอง ═══════════════════ */

/** กำไรขาดทุนแยกตามที่ — ครัวกลางไม่มีรายได้ เพราะส่งต่อที่ต้นทุน */
function buildLocationPL() {
  cacheClear_();
  var s = costSummary_();
  var rows = [];
  Object.keys(s.pl).sort().forEach(function (loc) {
    var p = s.pl[loc];
    rows.push([loc, p['หน้าร้าน'], p['เดลิเวอรี่'], p['ค่าคอมแอป'], p['รายได้'],
               p['ค่าใช้จ่ายวัตถุดิบ'], p['ของเสีย'], p['กำไรขั้นต้น'],
               p['ค่าใช้จ่ายอื่น'], p['กำไรสุทธิ'], p['วัตถุดิบคงเหลือ']]);
  });
  costWriteSheet_(COST_SHEET_PL,
    ['สถานที่', 'ขายหน้าร้าน', 'เดลิเวอรี่ (ราคาบนแอป)', 'ค่าคอม+VAT', 'รายได้รวม',
     'ค่าใช้จ่ายวัตถุดิบ', 'ของเสีย', 'กำไรขั้นต้น',
     'ค่าใช้จ่ายอื่น', 'กำไรสุทธิ', 'วัตถุดิบคงเหลือ'], rows,
    'ตัวเลขสะสมตั้งแต่เริ่มระบบ · ครัวกลางไม่มีรายได้เพราะส่งต่อที่ต้นทุน · อัปเดตเมื่อ ' +
    Utilities.formatDate(new Date(), costTz_(), 'd/M/yyyy HH:mm'));
  Logger.log('เขียนชีต "' + COST_SHEET_PL + '" แล้ว ' + rows.length + ' แถว');
}

/** เขียนทุกชีตรวดเดียว */
function refreshCostingSheets() {
  cacheClear_();
  buildStockValue();
  buildBranchLedger();
  buildLocationPL();
}

/* ═══════════════════ ตั้งยอดครัวกลางตามของที่มีจริง ═══════════════════ */

/** ช่องเพิ่มในชีตเช็คสต็อก ใช้เฉพาะตอนตั้งยอดครัวกลาง */
var COUNT_COST_COL   = 'ต้นทุน/หน่วย';
var COUNT_CHARGE_COL = 'ส่วนที่หายเป็นค่าวัตถุดิบของ';

/**
 * ครัวกลางนับของจริงพร้อมราคา — [ชื่อในระบบ, จำนวน(หน่วยเล็กสุด), ราคาทุน/หน่วยเล็กสุด, ที่มา]
 * ของที่ระบบเคยมีแต่ไม่อยู่ในรายการ = ไม่มีแล้ว (นับเป็น 0)
 * ส่วนที่หายไปจากครัวกลาง = ส่งไปสาขาแล้วไม่ได้ลง → เป็นค่าวัตถุดิบของสาขา chargeTo
 * ของที่มีมากกว่าในระบบ ตั้งมูลค่าตามราคาที่บอก (ไม่ใช่ค่าใช้จ่าย)
 * สต็อกสาขาไม่ถูกแตะ
 */
function setCentralStock_(list, chargeTo, who) {
  var central = costCentral_();
  var miss = function () {
    return list.filter(function (x) { return !findStockItem_(x[0]); }).map(function (x) { return x[0]; });
  };
  if (miss().length && typeof addSupplyItems === 'function') { addSupplyItems(); cacheClear_(); }
  if (miss().length) {
    Logger.log('❌ ไม่มีชื่อนี้ในชีตรายการสินค้า: ' + miss().join(', ') + '\nรัน fixItemList แล้วลองใหม่');
    return null;
  }
  var sh = sheet_(SHEET_COUNT);
  var map = ensureCols_(sh, MOVE_COLS.concat([COUNT_COST_COL, COUNT_CHARGE_COL]));
  var now = new Date();
  var rows = [], listed = {};
  function row(it, qty, cost, note) {
    var s = splitUnits_(qty, it), r = {
      'วันที่เวลา': now, 'สาขา': central, 'ผู้ตรวจ': who || 'เจ้าของร้าน', 'รายการ': it.name,
      'จำนวน': costQty_(qty), 'หน่วย': baseUnitOf_(it), 'หมายเหตุ': note, 'ประเภท': 'เช็คสต็อก',
      'แพ็ค': s.packs, 'เศษ': s.sticks, 'เศษ(ชิ้น)': s.pieces,
      'ไม้ต่อแพ็ค': it.perPack, 'ชิ้นต่อไม้': perStickOf_(it)
    };
    r[COUNT_COST_COL] = cost || '';
    r[COUNT_CHARGE_COL] = chargeTo || '';
    rows.push(r);
  }
  list.forEach(function (x) {
    var it = findStockItem_(x[0]);
    listed[it.name] = true;
    row(it, x[1], x[2], 'ตั้งยอดครัวกลาง' + (x[3] ? ' · ' + x[3] : ''));
  });
  // ของที่ระบบยังมีที่ครัวกลาง (ทั้งยอดสต็อกและชั้นต้นทุน) แต่ของจริงไม่มีแล้ว
  var gone = {};
  var bal = stockBalances_()[central] || {};
  Object.keys(bal).forEach(function (k) { if (Math.abs(bal[k]) > 0.00001) gone[k] = 1; });
  var lay = costReplay_().layers[central] || {};
  Object.keys(lay).forEach(function (k) {
    if (lay[k].some(function (l) { return l.qty > 0.00001; })) gone[k] = 1;
  });
  Object.keys(gone).forEach(function (k) {
    if (listed[k]) return;
    var it = findStockItem_(k);
    if (it) row(it, 0, 0, 'ตั้งยอดครัวกลาง · ไม่มีแล้ว');
  });
  appendRows_(sh, map, rows);
  SpreadsheetApp.flush();
  cacheClear_();

  // สรุปว่าตัดอะไรไปเป็นค่าวัตถุดิบสาขาเท่าไหร่
  var rep = costReplay_(), t = now.getTime(), sum = 0, lines = [];
  rep.log.forEach(function (l) {
    if (l.loc !== chargeTo || l.kind !== 'ใช้ไป' || Math.abs(costTime_(l.t) - t) > 60000) return;
    var it = findStockItem_(l.item);
    lines.push('  • ' + l.item + ' ' + (it ? fmtPack_(l.qty, it) : l.qty) + ' = ' + costBaht_(l.value) + ' บาท');
    sum += l.value;
  });
  var st = costSummary_().stock[central] || { total: 0, rows: [] };
  var text = '✅ ตั้งยอดครัวกลางแล้ว ' + rows.length + ' รายการ\n' +
    'มูลค่าของในครัวกลางตอนนี้ ' + costBaht_(st.total).toLocaleString() + ' บาท\n\n' +
    'ส่วนที่หายไป → ค่าวัตถุดิบของ ' + chargeTo + ' ' + costBaht_(sum).toLocaleString() + ' บาท\n' +
    (lines.join('\n') || '  (ไม่มี)');
  Logger.log(text);
  if (typeof refreshCostingSheets === 'function') refreshCostingSheets();
  return { rows: rows.length, charged: costBaht_(sum), central: st.total, text: text };
}

/**
 * ของในครัวกลางที่นับจริง 8/10/2026 (เจ้าของร้านส่งมาในแชต)
 * ราคาเป็นต่อหน่วยเล็กสุดในระบบ — กล่อง/ห่อ/โล แปลงแล้ว
 */
var CENTRAL_STOCK_20261008 = [
  ['กะหล่ำ (ดิบ)',                  3.125, 27.25,       '3.125 โล โลละ 27.25'],
  // ในระบบมี 0.1 โล (85 บาท) อยู่แล้ว ที่เกินมา 1.417 โล คิดโลละ 266
  ['สาหร่าย (ดิบ)',                 1.517, 266,         '1.417 โล โลละ 266 + 0.1 โล 85 บาท'],
  // ซื้อมา 471.68 = 22 กล่อง × 21.44 → กล่องละ 21.44 (ม้วนละ 1.79)
  ['ฟองเต้าหู้ม้วน (ดิบ)',           216,   21.44 / 12,  '18 กล่อง × 12 ม้วน กล่องละ 21.44'],
  ['ช้อน',                         500,   11.54 / 100, '5 แพ็ค × 100 อัน แพ็คละ 11.54'],
  ['มันเทศ (ดิบ)',                  6,     10.92,       'เส้นมันเทศ 6 ถุง (ถุงละ 200 กรัม) ถุงละ 10.92'],
  ['ผงหม่าล่า',                     2900,  10.49 / 100, 'พริกผงจีน 29 ห่อ × 100 กรัม ห่อละ 10.49'],
  ['เบสหม่าล่า',                    1000,  160 / 1000,  '1000 มล 160 บาท'],
  ['นมผง',                         200,   110 / 1000,  '200 กรัม โลละ 110'],
  ['น้ำจิ้มงา (ดิบ)',                4,     89.6,        '4 ถุง ถุงละ 89.6'],
  ['น้ำดำ',                         8,     75.3,        '8 ถุง ถุงละ 75.3'],
  ['พริกป่น',                       170,   125 / 1000,  'พริกป่นไทย 170 กรัม โลละ 125'],
  ['เต้าหู้หลอด (ดิบ)',              1,     54,          '12 หลอด (1 ถุง) 54 บาท'],
  ['ข้าวโพดฝัก (ดิบ)',               1,     25,          '3 ฝัก (≈1 โล) 25 บาท'],
  ['ถ้วย 2 ออน',                    50,    25 / 50,     '1 แพ็ค 25 บาท'],
  ['ไม้เสียบเบอร์ 8',                1,     18,          '1 แพ็ค 18 บาท'],
  ['เห็ดออเร็นจิ (ดิบ)',             0.749, 60,          '0.749 โล โลละ 60'],
  ['แมงกะพรุน (ดิบ)',               0.378, 70,          '0.378 โล โลละ 70'],
  ['หัวไหล่หมูติดหนังสไลซ์ (ดิบ)',    1.357, 122,         '1.357 โล โลละ 122'],
  ['ไก่ (ดิบ)',                     0.896, 84,          'อกไก่ 0.896 โล โลละ 84'],
  ['วุ้นเส้นเกาหลี (ดิบ)',            0.5,   62,          '0.5 โล 31 บาท']
];

/** กด ▶ ครั้งเดียวในหน้า Apps Script — ผลดูที่บันทึกการดำเนินการ (รันซ้ำไม่ได้ กันลงซ้ำ) */
function setCentralStock20261008() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('CENTRAL_STOCK_20261008')) {
    Logger.log('ตั้งยอดครัวกลางชุดนี้ไปแล้วเมื่อ ' + props.getProperty('CENTRAL_STOCK_20261008') +
               ' — ไม่ลงซ้ำ');
    return;
  }
  var r = setCentralStock_(CENTRAL_STOCK_20261008, 'ตลาดทรัพย์พัฒนา', 'เจ้าของร้าน');
  if (r) props.setProperty('CENTRAL_STOCK_20261008', Utilities.formatDate(new Date(), costTz_(), 'd/M/yyyy HH:mm'));
}

/**
 * ตั้งให้ชีตอัปเดตเองทุกชั่วโมง
 * ไม่ได้ให้อัปเดตทุกครั้งที่บันทึกของ เพราะการคิดต้นทุนต้องไล่ทุกแถวตั้งแต่ต้น
 * ถ้าไปแขวนไว้ท้ายปุ่มบันทึก คนกดจะรอนานขึ้นทุกครั้งโดยไม่จำเป็น
 * อยากได้ตัวเลขสด ๆ เดี๋ยวนั้นให้ดูหน้าเว็บ ซึ่งคิดตอนเปิดอยู่แล้ว
 */
function setupCostingTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshCostingSheets') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshCostingSheets').timeBased().everyHours(1).create();
  Logger.log('ตั้งให้ชีตบัญชีอัปเดตเองทุกชั่วโมงแล้ว');
}

/** เมนูในชีต — เจ้าของจะได้ไม่ต้องเข้า Apps Script เพื่อกดอัปเดต */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('📒 บัญชี')
      .addItem('อัปเดตตัวเลขเดี๋ยวนี้', 'refreshCostingSheets')
      .addItem('ดูสรุปย่อ', 'previewCosting')
      .addSeparator()
      .addItem('📊 รายงานเดือนนี้', 'monthlyReportThisMonth')
      .addItem('📊 รายงานเดือนที่แล้ว', 'monthlyReportLastMonth')
      .addSeparator()
      .addItem('🧹 รวมแถวสินค้าที่ชื่อซ้ำ', 'mergeDuplicateItems')
      .addSeparator()
      .addItem('ตั้งค่าครั้งแรก', 'setupCosting')
      .addItem('ให้อัปเดตเองทุกชั่วโมง', 'setupCostingTriggers')
      .addItem('🧹 ลบรายการที่ลงไลน์ผิด (ทั้งวัน)', 'deleteIntakeDay')
      .addItem('🧹 ล้างยอดติดลบ (เลือกสถานที่)', 'zeroNegativeStock')
      .addItem('💵 ดูผลเทียบเงินปิดร้านวันนี้', 'previewCashClose')
      .addSeparator()
      .addItem('⚠️ ล้างสต็อก — เริ่มระบบใหม่เท่านั้น', 'resetStockToZero')
      .addItem('⚠️ เริ่มใหม่ทั้งระบบ (ของ + เงิน)', 'resetEverything')
      .addItem('🗓️ เริ่มนับใหม่ทุกที่พร้อมกัน (ตั้งยอดตั้งต้น)', 'promptStartDate')
      .addItem('🗓️ เริ่มนับใหม่เฉพาะสาขา (ตั้งยอดตั้งต้น)', 'promptLocationStart')
      .addItem('🗓️ ใช้ยอดนับล่าสุดของสาขาเป็นฐาน (เริ่มยอดขายใหม่)', 'promptStartFromLatestCount')
      .addItem('ดูวันเริ่มนับ', 'showStartDate')
      .addToUi();
  } catch (e) { /* เปิดจาก trigger ไม่มี UI ข้ามไป */ }
}

/** ดูสรุปเร็ว ๆ ใน Log ไม่ต้องเปิดชีต */
function previewCosting() {
  cacheClear_();
  var s = costSummary_();
  var out = ['📊 ต้นทุนและยอดค้างชำระ ณ ' +
             Utilities.formatDate(new Date(), costTz_(), 'd/M/yyyy HH:mm')];
  Object.keys(s.stock).forEach(function (loc) {
    out.push('\n📍 ' + loc + ' — มูลค่าสต็อก ' + s.stock[loc].total.toLocaleString() + ' บาท');
    s.stock[loc].rows.slice(0, 8).forEach(function (r) {
      out.push('   ' + r.item + '  ' + (r.text || r.qty) + ' · ' + (r.subUnit || '') + 'ละ ' +
               (r.unitSub != null ? r.unitSub : r.unit) + ' = ' + r.value);
    });
    if (s.stock[loc].rows.length > 8) out.push('   … อีก ' + (s.stock[loc].rows.length - 8) + ' รายการ');
  });
  Object.keys(s.owed).forEach(function (loc) {
    var o = s.owed[loc];
    out.push('\n💰 ' + loc +
             '\n   รับของไปแล้ว ' + o['ส่งไปแล้ว'].toLocaleString() +
             ' · จ่ายคืนแล้ว ' + o['จ่ายคืนแล้ว'].toLocaleString() +
             ' → ค้างชำระ ' + o['ค้างชำระ'].toLocaleString() + ' บาท' +
             '\n   ใช้ไปจริง ' + o['ใช้ไป'].toLocaleString() +
             ' + ของเสีย ' + o['ของเสีย'].toLocaleString() +
             '\n   เงินในมือ ' + o['เงินในมือ'].toLocaleString() +
             ' → จ่ายได้เลย ' + o['จ่ายได้เลย'].toLocaleString() + ' บาท' +
             '\n   วัตถุดิบคงเหลือ ' + o['วัตถุดิบคงเหลือ'].toLocaleString() + ' บาท');
  });
  if (s.warn.length) {
    out.push('\n⚠️ จุดที่ตัวเลขไม่สมบูรณ์ ' + s.warn.length + ' จุด');
    s.warn.slice(0, 10).forEach(function (w) {
      out.push('   ' + w.loc + ' · ' + w.item + ' — ' + w.msg);
    });
  }
  Logger.log(out.join('\n'));
}
