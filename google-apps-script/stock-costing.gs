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

// ส่งกำไร = ส่วนของเงินที่เกินหนี้ค่าของทั้งหมด ณ ตอนที่บันทึก (สิ้นเดือนสาขาส่งเงินทั้งหมด)
// ระบบแบ่งให้ตอนบันทึก — ว่าง (แถวเก่า/กรอกเอง) ระบบเติมให้ตอนแจ้งไลน์ · ยังว่างอยู่ = คืนค่าของทั้งก้อน
var COST_PAY_COLS = ['วันที่', 'สาขา', 'จำนวนเงิน', 'วิธีจ่าย', 'หมายเหตุ', 'ธุรกิจ', 'ส่งกำไร'];

/**
 * ค่าไม้เสียบ (9/10) — ครัวกลางคิดกับสาขาไม้ละ 0.09 (แพ็คละ 18 บาท 200 ไม้)
 * ติดไปกับต้นทุนของที่ขายเป็นไม้ทุกตัวตอนส่งเข้าร้าน = ต้นทุนสาขา + หนี้ที่ต้องคืนครัวกลาง
 * ครัวกลางไม่ตัดไม้ตอนแพ็ค — นับสต็อกแล้วไม้หายไปเท่าไหร่ เป็นค่าใช้จ่ายของครัวกลางเอง
 */
var SKEWER_ITEM = 'ไม้เสียบเบอร์ 8';
var SKEWER_PACK_BAHT = 18, SKEWER_PER_PACK = 200;
var SKEWER_START_DATE = '2026-10-09';        // ส่งก่อนวันนี้ไม่คิดค่าไม้ย้อนหลัง
function skewerPerStick_() { return SKEWER_PACK_BAHT / SKEWER_PER_PACK; }

/**
 * เงินหมุนเวียนครัวกลาง (cash cycle) — ซื้อของ → แพ็คส่งสาขา → สาขาขายแล้วคืนเงิน → ซื้อรอบใหม่
 *   เงินออก: ซื้อของเข้าครัวกลาง · ซื้อของลองสูตร · ค่าใช้จ่ายของครัวกลาง
 *   เงินเข้า: สาขาคืนค่าของ · สาขาส่งกำไรสิ้นเดือน · เจ้าของใส่ทุน (ถอนออก = ติดลบ)
 * เริ่มนับตั้งแต่วันตั้งยอดครัวกลาง (8/10) — เปลี่ยนได้ที่ Script Property CENTRAL_CASH_FROM
 * เงินทุน/ถอนเงิน ลงชีต COST_SHEET_CASH เอง หรือพิมพ์ในไลน์กลุ่มครัวกลาง "ใส่ทุน 5000" / "ถอนเงิน 2000"
 */
var COST_SHEET_CASH = 'บัญชี_เงินครัวกลาง';
var COST_CASH_COLS = ['วันที่', 'รายการ', 'จำนวนเงิน', 'ธุรกิจ', 'หมายเหตุ'];
var CENTRAL_CASH_FROM = '2026-10-08';
function centralCashFrom_() {
  var p = '';
  try { p = PropertiesService.getScriptProperties().getProperty('CENTRAL_CASH_FROM') || ''; } catch (e) {}
  return costYmdTime_(p || CENTRAL_CASH_FROM);
}
/** ช่วงที่ใช้คิดว่าส่งของวันละเท่าไหร่ — เอาไว้บอกว่าเงินหมุนกลับมาในกี่วัน */
var CASH_CYCLE_DAYS = 30;
/** ส่งของนี้ qty (หน่วยเล็กสุด) ไปสาขา ใช้ไม้กี่ไม้ — ของที่ไม่ได้ขายเป็นไม้ = 0 */
function skewerSticks_(item, qty, t) {
  if (!(qty > 0) || typeof findStockItem_ !== 'function') return 0;
  if (SKEWER_START_DATE && t && t < new Date(SKEWER_START_DATE + 'T00:00:00+07:00').getTime()) return 0;
  var it = findStockItem_(item);
  if (!it || it.kind !== KIND_PACKED || String(it.subUnit || '').trim() !== 'ไม้') return 0;
  var per = typeof perStickOf_ === 'function' ? perStickOf_(it) : 1;
  return costQty_(qty / (per > 0 ? per : 1));
}

/** ปัดเป็นสตางค์ — เงินไม่มีทศนิยมที่สาม */
function costBaht_(n) { return Math.round((Number(n) || 0) * 100) / 100; }
/** ปัดจำนวนของ — กันเศษทศนิยมลอยจากการลบกันไปมา */
function costQty_(n)  { return Math.round((Number(n) || 0) * 10000) / 10000; }

/** ธุรกิจของสินค้า / แถว — ว่าง = หม่าล่า */
function costBizOf_(item) {
  return (typeof bizOfItem_ === 'function') ? bizOfItem_(item) : 'หม่าล่า';
}
function costBizCell_(v) {
  var b = String(v == null ? '' : v).trim();
  return /เบเกอรี/.test(b) ? 'เบเกอรี่' : 'หม่าล่า';
}
var COST_BIZES = ['หม่าล่า', 'เบเกอรี่'];
/**
 * ค่าใช้จ่ายที่ใช้ร่วมกัน — ไม่ได้เขียนธุรกิจกำกับ แบ่งให้เบเกอรี่ตามสัดส่วนนี้ ที่เหลือหม่าล่า
 *   ค่าที่ 120 → หม่าล่า 60 เบเกอรี่ 60 · ค่าพนักงาน (ค่าแรง) 300 → 150 / 150
 * ค่าน้ำ ค่าน้ำแข็ง ค่าไฟ และอื่น ๆ ที่ไม่ได้อยู่ในนี้ = หม่าล่าทั้งหมด
 */
var COST_SHARED_TYPES = { 'ค่าที่': 0.5, 'ค่าแรง': 0.5 };
/**
 * เริ่มแบ่งตั้งแต่วันที่เบเกอรี่เริ่มขาย (BAKERY_START_DATE) — ก่อนนั้นเป็นหม่าล่าทั้งหมด
 *   ค่าที่   แบ่งครึ่งทุกวัน แม้วันนั้นเบเกอรี่ไม่ได้ขาย
 *   ค่าแรง  แบ่งครึ่งเฉพาะวันที่เบเกอรี่ขาย · วันไม่ขาย = หม่าล่า 300 เต็ม
 */
var COST_SHARED_SALE_DAYS_ONLY = { 'ค่าแรง': true };

/**
 * วันที่เบเกอรี่ขาย — วันที่พนักงานสาขากรอกยอดเบเกอรี่หลังขายแล้วมีขาย
 * คืน { 'สาขา|yyyy-MM-dd': true }
 */
function costBakeryDays_() {
  return cached_('cost:bakerydays', function () {
    var out = {};
    if (typeof bakeryMoneyRows_ !== 'function') return out;
    bakeryMoneyRows_().forEach(function (r) {
      if (typeof BAKERY_START_DATE === 'string' && r.day < BAKERY_START_DATE) return;
      if (r.money > 0 || r.sold > 0) out[r.loc + '|' + r.day] = true;
    });
    return out;
  });
}
/** วันทำการของแถวค่าใช้จ่าย (ตี 4 ยังเป็นวันก่อน เหมือนปิดร้าน) */
function costExpenseDay_(dateCell, timeCell) {
  var t = costRowTime_(dateCell, timeCell);
  var ms = t instanceof Date ? t.getTime() : costTime_(t);
  if (!ms) return '';
  return (typeof cashBizDay_ === 'function') ? cashBizDay_(ms) : Utilities.formatDate(new Date(ms), costTz_(), 'yyyy-MM-dd');
}

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
  var lay = {}, used = {}, sent = {}, sentBiz = {}, moved = {}, warn = [], log = [];
  var skewer = {};       // สาขา → { sticks, baht } ค่าไม้เสียบที่ครัวกลางคิดกับสาขา
  var buys = [], sendLog = [];   // เงินหมุนเวียนครัวกลาง — ซื้อเข้า / ส่งสาขา ตามเวลา
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
    if (!used[loc]) {
      used[loc] = { ใช้ไป: 0, ของเสีย: 0, นับเกิน: 0, items: {}, biz: {} };
      COST_BIZES.forEach(function (z) { used[loc].biz[z] = { ใช้ไป: 0, ของเสีย: 0, นับเกิน: 0, ตัดจากครัวกลาง: 0 }; });
    }
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
    var bz = b.biz[costBizOf_(item)];
    bz[what] = costBaht_(bz[what] + value);
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
    // เบเกอรี่ต้นทุนคงที่ต่อชิ้น (ไดฟุกุ 6.5 · บราวนี่ 6)
    var bk = (typeof bakeryCost_ === 'function') ? bakeryCost_(item) : 0;
    if (bk > 0) return bk;
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
      var bkc = (typeof bakeryCost_ === 'function') ? bakeryCost_(e.item) : 0;
      var unit = bkc > 0 ? bkc
               : e.paid > 0 ? e.paid / e.qty : (e.unit > 0 ? e.unit : guessCost(e.loc, e.item));
      if (!(unit > 0)) {
        warn.push({ when: e.t, loc: e.loc, item: e.item,
                    msg: 'ไม่รู้ราคาที่ซื้อมา — คิดต้นทุนเป็น 0' });
      }
      put(e.loc, e.item, e.qty, unit, e.unit > 0 ? e.unit : 0);
      if (e.loc === central) {
        buys.push({ t: e.t, item: e.item, value: e.paid > 0 ? e.paid : costBaht_(unit * e.qty) });
      }

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
      // ค่าไม้เสียบ ไม้ละ 0.09 บวกเข้าต้นทุนต่อหน่วยที่สาขา (เต้าชีส 2 ชิ้น/ไม้ = ชิ้นละ 0.045)
      var sticks = all ? 0 : skewerSticks_(e.item, e.qty, e.t);
      var stickBaht = costBaht_(sticks * skewerPerStick_());
      var plus = sticks > 0 ? sticks * skewerPerStick_() / e.qty : 0;
      if (stickBaht > 0) {
        value = costBaht_(value + stickBaht);
        var sk = skewer[e.loc] || (skewer[e.loc] = { sticks: 0, baht: 0 });
        sk.sticks = costQty_(sk.sticks + sticks); sk.baht = costBaht_(sk.baht + stickBaht);
      }
      // ยกทั้งชั้นไปตั้งที่สาขา ราคาต่อหน่วยของแต่ละชั้นเท่าเดิมเป๊ะ
      t2.parts.forEach(function (pt) { put(e.loc, e.item, pt.qty, pt.cost + plus); });
      if (t2.short > 0) put(e.loc, e.item, t2.short, unitCost + plus);
      // ของที่นับเป็นระดับ (กระดูกหมู น้ำดำ) นับเป็นตัวเลขไม่ได้ ต้นทุนจึงไม่มีวัน
      // ถูกตัดจากการนับ — ถือว่าใช้ไปทันทีที่ถึงสาขา ไม่งั้นค้างเป็นสต็อกตลอดไป
      if (typeof isLevelItem_ === 'function' && isLevelItem_(e.item)) {
        var tl = take(e.loc, e.item, e.qty);
        noteItem(e.loc, e.item, 'ใช้ไป', tl.qty, tl.value, e.t);
      }
      // ของออกจากครัวกลางแล้วเป็นหนี้ทันทีเต็มจำนวน — จะขายได้หรือทิ้งก็หนี้เท่าเดิม
      sent[e.loc] = costBaht_((sent[e.loc] || 0) + value);
      if (!sentBiz[e.loc]) sentBiz[e.loc] = {};
      var sz = costBizOf_(e.item);
      sentBiz[e.loc][sz] = costBaht_((sentBiz[e.loc][sz] || 0) + value);
      sendLog.push({ t: e.t, loc: e.loc, biz: sz, value: value });
      moved[e.item] = costBaht_((moved[e.item] || 0) + value - stickBaht);

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
          var cz = bucket(e.chargeTo).biz[costBizOf_(e.item)];
          cz['ตัดจากครัวกลาง'] = costBaht_(cz['ตัดจากครัวกลาง'] + t4.value);
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
  return { layers: lay, used: used, sent: sent, sentBiz: sentBiz, moved: moved, warn: warn, log: log,
           lastCost: lastCost, skewer: skewer, buys: buys, sendLog: sendLog };
}

/** ราคาทุนล่าสุดของทุกอย่าง จากประวัติทั้งหมด ไม่สนเส้นเริ่มนับ */
function costPriceBook_() {
  return cached_('cost:prices', function () { return costReplayRaw_(true).lastCost; });
}

/* ═══════════════════ เงินที่สาขาจ่ายคืนแล้ว ═══════════════════ */

/**
 * ยอดที่สาขาโอนเข้าครัวกลางแล้ว — กรอกเองในชีต COST_SHEET_PAY หรือพิมพ์ "คืนเงิน" ในไลน์
 * profitOnly = เอาเฉพาะส่วนที่เป็นกำไร (ช่อง "ส่งกำไร") · ไม่ส่ง = ยอดรวมทั้งคืนค่าของและกำไร
 */
function costPaidBack_(biz, profitOnly, from) {
  var out = {};
  var sh = sheet_(COST_SHEET_PAY);
  if (!sh || sh.getLastRow() < 2) return out;
  var map = ensureCols_(sh, COST_PAY_COLS);
  sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues().forEach(function (r) {
    // ไม่บอกธุรกิจ = หม่าล่า · ไม่ส่ง biz มา = รวมทุกธุรกิจ
    if (biz && costBizCell_(r[map['ธุรกิจ']]) !== biz) return;
    var loc = String(r[map['สาขา']] || '').trim();
    if (costBefore_(r[map['วันที่']], loc)) return;
    if (from && costTime_(r[map['วันที่']]) < from) return;
    var baht = Number(r[map['จำนวนเงิน']]) || 0;
    if (profitOnly) baht = Math.min(baht, Number(r[map['ส่งกำไร']]) || 0);
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
function costOutgo_(biz, from) {
  var out = {};
  var sh = sheet_(SHEET_EXPENSE);
  if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getDataRange().getValues();
  var h = v[0].map(function (x) { return String(x).trim(); });
  var iLoc = h.indexOf('สาขา'), iBaht = h.indexOf('จำนวนเงิน'), iType = h.indexOf('ประเภท');
  var iDate = h.indexOf('วันที่'), iTime = h.indexOf('เวลา'), iBiz = h.indexOf('ธุรกิจ');
  if (iLoc === -1 || iBaht === -1) return out;
  for (var r = 1; r < v.length; r++) {
    if (iDate !== -1 && costBefore_(costRowTime_(v[r][iDate], iTime === -1 ? '' : v[r][iTime]), v[r][iLoc])) continue;
    if (from && iDate !== -1 && costTime_(costRowTime_(v[r][iDate], iTime === -1 ? '' : v[r][iTime])) < from) continue;
    var loc = String(v[r][iLoc] || '').trim();
    var baht = Number(v[r][iBaht]) || 0;
    if (!loc || !baht) continue;
    var type = iType === -1 ? 'อื่น ๆ' : (String(v[r][iType] || '').trim() || 'อื่น ๆ');
    // แยกบัญชีหม่าล่า/เบเกอรี่ — เขียนธุรกิจกำกับมา = ของธุรกิจนั้นทั้งก้อน
    // ไม่ได้เขียน: ค่าที่ / ค่าแรง(ค่าพนักงาน) แบ่งครึ่ง · อย่างอื่นเป็นหม่าล่าหมด
    if (biz) {
      var tag = iBiz === -1 ? '' : String(v[r][iBiz] || '').trim();
      // ค่าที่ แบ่งครึ่งทุกวันตั้งแต่เบเกอรี่เริ่มขาย · ค่าแรง แบ่งเฉพาะวันที่เบเกอรี่ขาย
      var cut = 0;
      if (!tag && COST_SHARED_TYPES.hasOwnProperty(type)) {
        var day = costExpenseDay_(v[r][iDate], iTime === -1 ? '' : v[r][iTime]);
        var started = !(typeof BAKERY_START_DATE === 'string') || (day && day >= BAKERY_START_DATE);
        var saleDay = !COST_SHARED_SALE_DAYS_ONLY[type] || costBakeryDays_()[loc + '|' + day];
        if (started && saleDay) cut = COST_SHARED_TYPES[type];
      }
      var share = tag ? (costBizCell_(tag) === biz ? 1 : 0)
                      : (biz === 'เบเกอรี่' ? cut : 1 - cut);
      if (!share) continue;
      baht = costBaht_(baht * share);
    }
    if (!out[loc]) out[loc] = { รวม: 0, ตามประเภท: {} };
    out[loc]['รวม'] = costBaht_(out[loc]['รวม'] + baht);
    out[loc]['ตามประเภท'][type] = costBaht_((out[loc]['ตามประเภท'][type] || 0) + baht);
  }
  return out;
}

/** เงินทุนที่เจ้าของใส่/ถอน (ชีต COST_SHEET_CASH) — ถอนออกเป็นเลขติดลบ · ไม่บอกธุรกิจ = หม่าล่า */
function costCapital_(biz) {
  var sh = sheet_(COST_SHEET_CASH), sum = 0;
  if (!sh || sh.getLastRow() < 2) return 0;
  var map = ensureCols_(sh, COST_CASH_COLS);
  sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues().forEach(function (r) {
    if (biz && costBizCell_(r[map['ธุรกิจ']]) !== biz) return;
    sum += Number(String(r[map['จำนวนเงิน']]).replace(/,/g, '')) || 0;
  });
  return costBaht_(sum);
}

/** ของที่ซื้อมาลองสูตร (ไม่เข้าสต็อก) ของครัวกลาง — เงินออกจากครัวกลางจริง */
function costRndSpend_(biz, from) {
  var name = (typeof INTAKE_SHEET === 'string') ? INTAKE_SHEET : 'ซื้อของเข้า';
  var rnd = (typeof INTAKE_KIND_RND === 'string') ? INTAKE_KIND_RND : 'พัฒนาสูตร';
  var sh = sheet_(name), sum = 0;
  if (!sh || sh.getLastRow() < 2) return 0;
  var v = sh.getDataRange().getValues();
  var h = v[0].map(function (x) { return String(x).trim(); });
  var iKind = h.indexOf('ประเภทซื้อ'), iLoc = h.indexOf('สถานที่'), iBaht = h.indexOf('จำนวนเงิน');
  var iDate = h.indexOf('วันที่'), iTime = h.indexOf('เวลา'), iItem = h.indexOf('รายการ');
  if (iKind === -1 || iBaht === -1) return 0;
  var central = costCentral_();
  for (var r = 1; r < v.length; r++) {
    if (String(v[r][iKind] || '').trim() !== rnd) continue;
    if (iLoc !== -1 && String(v[r][iLoc] || '').trim() && String(v[r][iLoc]).trim() !== central) continue;
    if (from && iDate !== -1 && costTime_(costRowTime_(v[r][iDate], iTime === -1 ? '' : v[r][iTime])) < from) continue;
    if (biz && iItem !== -1 && costBizOf_(String(v[r][iItem] || '').trim()) !== biz) continue;
    sum += Number(v[r][iBaht]) || 0;
  }
  return costBaht_(sum);
}

/**
 * รอบเงิน: ของอยู่ในครัวกลางกี่วัน + รอสาขาจ่ายกี่วัน (ส่งของเฉลี่ยวันละเท่าไหร่ใน 30 วันล่าสุด)
 * ส่งของวันละ 500 ครัวกลางมีของ 3000 = ของอยู่ ~6 วัน · สาขาค้าง 1500 = รอ ~3 วัน → เงินกลับมาใน ~9 วัน
 */
function costCycleDays_(c) {
  var rate = Number(c['ส่งของต่อวัน']) || 0;
  var r1 = function (n) { return Math.round(n * 10) / 10; };
  c['วันของอยู่ครัวกลาง'] = rate > 0 ? r1(c['ของในครัวกลาง'] / rate) : null;
  c['วันรอสาขาจ่าย'] = rate > 0 ? r1(c['สาขาค้างจ่าย'] / rate) : null;
  c['รอบเงิน'] = rate > 0 ? r1(c['วันของอยู่ครัวกลาง'] + c['วันรอสาขาจ่าย']) : null;
  return c;
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
  var central = costCentral_();

  // ของคงเหลือ — แยกตามธุรกิจของสินค้า (เบเกอรี่ / หม่าล่า)
  var stockBy = {};
  COST_BIZES.forEach(function (z) { stockBy[z] = {}; });
  Object.keys(rep.layers).forEach(function (loc) {
    var rows = {}, sum = {};
    COST_BIZES.forEach(function (z) { rows[z] = []; sum[z] = 0; });
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
      var z = costBizOf_(item);
      rows[z].push({ item: item, qty: qty, value: value, baseUnit: bu, biz: z,
                     text: it && typeof fmtPack_ === 'function' ? fmtPack_(qty, it) : String(qty),
                     unit: unit,
                     subUnit: it ? it.subUnit : bu,
                     unitSub: per > 1 ? r4(qty > 0 ? value / qty * per : unit * per) : unit });
      sum[z] += value;
    });
    COST_BIZES.forEach(function (z) {
      rows[z].sort(function (a, b) { return b.value - a.value; });
      stockBy[z][loc] = { rows: rows[z], total: costBaht_(sum[z]) };
    });
  });

  // รายได้เบเกอรี่มาจากยอดเงินที่พนักงานกรอกหลังขาย ไม่ใช่บิล POS
  function bakeryIncome() {
    var raw = (typeof bakeryIncome_ === 'function') ? bakeryIncome_() : {}, out = {};
    Object.keys(raw).forEach(function (loc) {
      var x = raw[loc];
      out[loc] = { หน้าร้าน: x['รวม'], เดลิเวอรี่: 0, รวม: x['รวม'], ค่าคอม: 0, ตามแอป: {},
                   เงินสด: x['เงินสด'], เงินโอน: x['เงินโอน'], ไทยช่วยไทย: x['ไทยช่วยไทย'] };
    });
    return out;
  }

  function part(biz) {
    var stock = stockBy[biz];
    var income = biz === 'เบเกอรี่' ? bakeryIncome() : costIncome_();
    var outgo = costOutgo_(biz), back = costPaidBack_(biz), backProfit = costPaidBack_(biz, true);
    var used = {};
    Object.keys(rep.used).forEach(function (loc) {
      used[loc] = rep.used[loc].biz ? rep.used[loc].biz[biz] : rep.used[loc];
    });

    // เงินหมุนเวียนครัวกลาง ตั้งแต่วันเริ่มนับเงิน
    function cashBook() {
      var from = centralCashFrom_(), now = Date.now();
      var sum = function (o) { return costBaht_(Object.keys(o).reduce(function (a, k) { return a + (o[k] || 0); }, 0)); };
      var buy = costBaht_((rep.buys || []).reduce(function (a, b) {
        return a + (b.t >= from && costBizOf_(b.item) === biz ? b.value : 0);
      }, 0));
      var allIn = sum(costPaidBack_(biz, false, from)), profitIn = sum(costPaidBack_(biz, true, from));
      var c = {
        ตั้งแต่: from ? Utilities.formatDate(new Date(from), costTz_(), 'd/M/yyyy') : '',
        เงินทุน: costCapital_(biz),
        ซื้อของ: buy,
        ลองสูตร: costRndSpend_(biz, from),
        ค่าใช้จ่าย: ((costOutgo_(biz, from)[central] || {})['รวม']) || 0,
        รับคืนค่าของ: costBaht_(allIn - profitIn),
        รับกำไร: profitIn,
        ของในครัวกลาง: (stock[central] || { total: 0 }).total,
        สาขาค้างจ่าย: costBaht_(Object.keys(owed).reduce(function (a, l) { return a + Math.max(0, owed[l]['ค้างชำระ']); }, 0))
      };
      c['คงเหลือ'] = costBaht_(c['เงินทุน'] + c['รับคืนค่าของ'] + c['รับกำไร'] - c['ซื้อของ'] - c['ลองสูตร'] - c['ค่าใช้จ่าย']);
      c['ทุนหมุนเวียน'] = costBaht_(c['คงเหลือ'] + c['ของในครัวกลาง'] + c['สาขาค้างจ่าย']);
      var since = Math.max(from, now - CASH_CYCLE_DAYS * 86400000);
      var days = Math.max(1, (now - since) / 86400000);
      var sent = (rep.sendLog || []).reduce(function (a, x) { return a + (x.t >= since && x.biz === biz ? x.value : 0); }, 0);
      c['ส่งของต่อวัน'] = costBaht_(sent / days);
      return costCycleDays_(c);
    }

    var owed = {};
    function seat(loc) {
      if (owed[loc]) return owed[loc];
      var u = used[loc] || {};
      var sent = (rep.sentBiz[loc] || {})[biz] || 0;
      // เงินที่โอนเข้าครัวกลาง = คืนค่าของ + ส่งกำไร (สิ้นเดือน) — กำไรไม่ได้ลดหนี้ค่าของ
      var profitSent = backProfit[loc] || 0;
      var paid = costBaht_((back[loc] || 0) - profitSent);
      // ของที่ตัดจากครัวกลางตอนตั้งยอด ไม่ได้ส่งผ่านระบบ จึงไม่ใช่หนี้ที่ต้องจ่ายคืน
      var gone = costBaht_((u['ใช้ไป'] || 0) + (u['ของเสีย'] || 0) - (u['ตัดจากครัวกลาง'] || 0));
      // เงินที่สาขาถืออยู่ = ขายได้ − จ่ายค่าใช้จ่ายหน้าร้าน − โอนเข้าครัวกลางไปแล้ว (ทั้งค่าของและกำไร)
      var cash = costBaht_(((income[loc] || {})['รวม'] || 0) -
                           ((outgo[loc] || {})['รวม'] || 0) - paid - profitSent);
      var due = Math.max(0, sent - paid);
      owed[loc] = {
        ส่งไปแล้ว:   sent,                              // ของออกจากครัวกลาง = หนี้ทันที
        ค่าไม้เสียบ: biz === 'หม่าล่า' ? ((rep.skewer || {})[loc] || { baht: 0 }).baht : 0,   // รวมอยู่ในส่งไปแล้ว
        ใช้ไป:       u['ใช้ไป'] || 0,
        ของเสีย:     u['ของเสีย'] || 0,
        จ่ายคืนแล้ว: paid,
        ส่งกำไรแล้ว: profitSent,
        // จ่ายครบแล้วของที่เหลือไม่ใช่หนี้ เป็นวัตถุดิบคงเหลือของสาขาเฉย ๆ
        ค้างชำระ:    costBaht_(sent - paid),
        ค่าของที่ใช้ไปแล้ว: costBaht_(Math.max(0, gone - paid)),
        เงินในมือ: cash,
        // มีเงินเท่าไหร่ก็จ่ายเท่านั้น แต่ไม่เกินยอดที่ค้างอยู่
        // ใช้ของไปแค่ 180 แต่มีเงิน 600 ค้างอยู่ 300 ก็เคลียร์ 300 ไปเลย
        // ของที่ยังไม่ได้ใช้ก็ยังอยู่ในสต็อกสาขาเหมือนเดิม แค่จ่ายเงินล่วงหน้าไว้
        จ่ายได้เลย: costBaht_(Math.max(0, Math.min(cash, due))),
        // สิ้นเดือนส่งเงินในมือทั้งหมด — เคลียร์หนี้ค่าของให้หมดก่อน ที่เหลือคือกำไรเข้าครัวกลาง
        สิ้นเดือนส่งทั้งหมด: costBaht_(Math.max(0, cash)),
        กำไรที่ส่งได้: costBaht_(Math.max(0, cash - due)),
        วัตถุดิบคงเหลือ: (stock[loc] || { total: 0 }).total
      };
      return owed[loc];
    }
    Object.keys(rep.sentBiz).forEach(function (l) { if ((rep.sentBiz[l] || {})[biz]) seat(l); });
    Object.keys(used).forEach(function (l) {
      var u = used[l] || {};
      if (l !== central && (u['ใช้ไป'] || u['ของเสีย'] || u['นับเกิน'])) seat(l);
    });
    Object.keys(back).forEach(seat);
    // สาขาที่ขายได้แล้วแต่ยังไม่ได้รับของผ่านระบบ ก็ต้องเห็นเงินในมือ (รอบตัดยอดคืนครัวกลาง)
    Object.keys(income).forEach(function (l) { if (l !== central) seat(l); });
    delete owed[central];

    // งบของแต่ละที่ — สาขามีรายได้ ครัวกลางไม่มี (ส่งต่อที่ต้นทุน)
    var pl = {}, locs = {};
    // ที่ที่ไม่มีของของธุรกิจนี้เลย ไม่ต้องขึ้นการ์ดเปล่า
    Object.keys(stock).forEach(function (l) { if (stock[l].rows.length) locs[l] = true; });
    [owed, income, outgo].forEach(function (o) {
      Object.keys(o).forEach(function (l) { locs[l] = true; });
    });
    Object.keys(used).forEach(function (l) {
      var u = used[l] || {};
      if (u['ใช้ไป'] || u['ของเสีย'] || u['นับเกิน']) locs[l] = true;
    });
    // ครัวกลางต้องมีการ์ดเสมอเมื่อมีสาขา — เงินที่สาขาโอนมา ค่าไม้ อยู่ที่การ์ดนี้ แม้ของในครัวจะหมด
    if (Object.keys(owed).length) locs[central] = true;
    Object.keys(locs).forEach(function (loc) {
      var inc = income[loc] || { หน้าร้าน: 0, เดลิเวอรี่: 0, รวม: 0, ค่าคอม: 0, ตามแอป: {} };
      var u = used[loc] || { ใช้ไป: 0, ของเสีย: 0 };
      var ex = outgo[loc] || { รวม: 0, ตามประเภท: {} };
      var cogs = costBaht_((u['ใช้ไป'] || 0) + (u['ของเสีย'] || 0));
      var fee = inc['ค่าคอม'] || 0;
      pl[loc] = {
        ธุรกิจ: biz,
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
      if (loc === central) {
        // ครัวกลาง: ค่าไม้ที่คิดกับสาขา · เงินที่สาขาโอนเข้ามา · ของที่นับแล้วหายไป (ค่าใช้จ่ายครัวกลาง)
        var sumOf = function (o, k) {
          return costBaht_(Object.keys(o).reduce(function (a, l) { return a + (Number(o[l][k]) || 0); }, 0));
        };
        pl[loc]['ค่าไม้จากสาขา'] = sumOf(owed, 'ค่าไม้เสียบ');
        pl[loc]['รับคืนค่าของ'] = sumOf(owed, 'จ่ายคืนแล้ว');
        pl[loc]['รับกำไรจากสาขา'] = sumOf(owed, 'ส่งกำไรแล้ว');
        var ci = (rep.used[central] || {}).items || {};
        pl[loc]['ใช้ไปในครัว'] = Object.keys(ci).filter(function (n) {
          return costBizOf_(n) === biz && (ci[n]['ใช้ไป'] || ci[n]['ของเสีย']);
        }).map(function (n) {
          return { item: n, qty: ci[n].qty, value: costBaht_((ci[n]['ใช้ไป'] || 0) + (ci[n]['ของเสีย'] || 0)) };
        }).sort(function (a, b) { return b.value - a.value; });
        pl[loc]['เงินหมุนเวียน'] = cashBook();
      }
      if (biz === 'เบเกอรี่') {
        pl[loc]['เงินสด'] = inc['เงินสด'] || 0;
        pl[loc]['เงินโอน'] = inc['เงินโอน'] || 0;
        pl[loc]['ไทยช่วยไทย'] = inc['ไทยช่วยไทย'] || 0;
      }
    });
    return { stock: stock, owed: owed, used: used, pl: pl };
  }

  var mala = part('หม่าล่า'), bakery = part('เบเกอรี่');
  // ตัวบนสุดคือหม่าล่า (เหมือนเดิม) — เบเกอรี่อยู่ใน biz['เบเกอรี่'] · รวมทั้งสองอยู่ใน biz['รวม']
  return { central: central, stock: mala.stock, owed: mala.owed,
           used: mala.used, pl: mala.pl, warn: rep.warn,
           biz: { 'หม่าล่า': mala, 'เบเกอรี่': bakery, 'รวม': costCombine_(mala, bakery) } };
}

/**
 * บัญชีรวม หม่าล่า + เบเกอรี่ — บวกกันตรง ๆ
 * ค่าใช้จ่ายที่ใช้ร่วม (ค่าที่ ค่าแรง) แบ่งไปแล้วฝั่งละครึ่ง รวมกลับก็ได้ยอดเต็มพอดี ไม่นับซ้ำ
 */
function costCombine_(a, b) {
  var num = function (x) { return Number(x) || 0; };
  var sumObj = function (x, y, keys) {
    var o = {};
    keys.forEach(function (k) { o[k] = costBaht_(num((x || {})[k]) + num((y || {})[k])); });
    return o;
  };
  var stock = {};
  [a.stock, b.stock].forEach(function (src) {
    Object.keys(src).forEach(function (loc) {
      var st = stock[loc] || (stock[loc] = { rows: [], total: 0 });
      st.rows = st.rows.concat(src[loc].rows);
      st.total = costBaht_(st.total + src[loc].total);
    });
  });
  Object.keys(stock).forEach(function (loc) {
    stock[loc].rows.sort(function (x, y) { return y.value - x.value; });
  });
  var owedKeys = ['ส่งไปแล้ว', 'ค่าไม้เสียบ', 'ใช้ไป', 'ของเสีย', 'จ่ายคืนแล้ว', 'ส่งกำไรแล้ว', 'ค้างชำระ',
                  'ค่าของที่ใช้ไปแล้ว', 'เงินในมือ', 'จ่ายได้เลย', 'สิ้นเดือนส่งทั้งหมด', 'กำไรที่ส่งได้',
                  'วัตถุดิบคงเหลือ'];
  var owed = {};
  Object.keys(a.owed).concat(Object.keys(b.owed)).forEach(function (loc) {
    if (!owed[loc]) owed[loc] = sumObj(a.owed[loc], b.owed[loc], owedKeys);
  });
  var plKeys = ['รายได้', 'หน้าร้าน', 'เดลิเวอรี่', 'ค่าคอมแอป', 'เงินเข้าจริง', 'ค่าใช้จ่ายวัตถุดิบ',
                'ของเสีย', 'กำไรขั้นต้น', 'ค่าใช้จ่ายอื่น', 'กำไรสุทธิ', 'วัตถุดิบคงเหลือ',
                'ค่าไม้จากสาขา', 'รับคืนค่าของ', 'รับกำไรจากสาขา'];
  var pl = {};
  Object.keys(a.pl).concat(Object.keys(b.pl)).forEach(function (loc) {
    if (pl[loc]) return;
    var x = a.pl[loc] || {}, y = b.pl[loc] || {};
    var p = sumObj(x, y, plKeys);
    p['ธุรกิจ'] = 'รวม';
    // แยกให้เห็นว่ารายได้มาจากไหน
    p['หน้าร้าน'] = num(x['หน้าร้าน']);            // หม่าล่าหน้าร้าน
    p['เดลิเวอรี่'] = num(x['เดลิเวอรี่']);
    p['ขายเบเกอรี่'] = num(y['รายได้']);
    p['กำไรหม่าล่า'] = num(x['กำไรสุทธิ']);
    p['กำไรเบเกอรี่'] = num(y['กำไรสุทธิ']);
    var tp = {};
    [x['ตามประเภท'] || {}, y['ตามประเภท'] || {}].forEach(function (o) {
      Object.keys(o).forEach(function (k) { tp[k] = costBaht_((tp[k] || 0) + num(o[k])); });
    });
    p['ตามประเภท'] = tp;
    if (x['เงินหมุนเวียน'] || y['เงินหมุนเวียน']) {
      var cx = x['เงินหมุนเวียน'] || {}, cy = y['เงินหมุนเวียน'] || {}, cb = { ตั้งแต่: cx['ตั้งแต่'] || cy['ตั้งแต่'] };
      ['เงินทุน', 'ซื้อของ', 'ลองสูตร', 'ค่าใช้จ่าย', 'รับคืนค่าของ', 'รับกำไร', 'คงเหลือ', 'ของในครัวกลาง',
       'สาขาค้างจ่าย', 'ทุนหมุนเวียน', 'ส่งของต่อวัน'].forEach(function (k) { cb[k] = costBaht_(num(cx[k]) + num(cy[k])); });
      p['เงินหมุนเวียน'] = costCycleDays_(cb);
    }
    if (x['ใช้ไปในครัว'] || y['ใช้ไปในครัว']) {
      p['ใช้ไปในครัว'] = (x['ใช้ไปในครัว'] || []).concat(y['ใช้ไปในครัว'] || [])
        .sort(function (m, n) { return n.value - m.value; });
    }
    pl[loc] = p;
  });
  return { stock: stock, owed: owed, pl: pl };
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
  var both = {};
  COST_BIZES.forEach(function (z) {
    var st = s.biz ? s.biz[z].stock : (z === 'หม่าล่า' ? s.stock : {});
    Object.keys(st).forEach(function (loc) { both[z === 'หม่าล่า' ? loc : loc + ' · ' + z] = st[loc]; });
  });
  Object.keys(both).forEach(function (loc) {
    if (!both[loc].rows.length) return;      // ไม่มีของก็ไม่ต้องมีแถวรวม
    both[loc].rows.forEach(function (r) {
      rows.push([loc, r.item, r.text || r.qty, r.unitSub != null ? r.unitSub : r.unit,
                 r.subUnit || r.baseUnit || '', r.value, r.qty, r.baseUnit || '']);
    });
    rows.push([loc, '— รวม —', '', '', '', both[loc].total, '', '']);
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
    rows.push([loc, o['ส่งไปแล้ว'], o['ค่าไม้เสียบ'] || 0, o['ใช้ไป'], o['ของเสีย'], o['จ่ายคืนแล้ว'],
               o['ส่งกำไรแล้ว'] || 0, o['ค้างชำระ'], o['เงินในมือ'], o['จ่ายได้เลย'],
               o['สิ้นเดือนส่งทั้งหมด'] || 0, o['กำไรที่ส่งได้'] || 0, st.total]);
  });
  var c = s.central;
  var uc = s.used[c] || { ใช้ไป: 0, ของเสีย: 0 };
  rows.push([c + ' (คงเหลือในครัว)', '', '', uc['ใช้ไป'], uc['ของเสีย'], '', '', '', '', '', '', '',
             (s.stock[c] || { total: 0 }).total]);
  // เบเกอรี่แยกบัญชี
  var bk = s.biz && s.biz['เบเกอรี่'];
  if (bk) {
    Object.keys(bk.owed).forEach(function (loc) {
      var o = bk.owed[loc], st = bk.stock[loc] || { total: 0 };
      rows.push([loc + ' · เบเกอรี่', o['ส่งไปแล้ว'], 0, o['ใช้ไป'], o['ของเสีย'], o['จ่ายคืนแล้ว'],
                 o['ส่งกำไรแล้ว'] || 0, o['ค้างชำระ'], o['เงินในมือ'], o['จ่ายได้เลย'],
                 o['สิ้นเดือนส่งทั้งหมด'] || 0, o['กำไรที่ส่งได้'] || 0, st.total]);
    });
    var ub = bk.used[c] || { ใช้ไป: 0, ของเสีย: 0 };
    if ((bk.stock[c] || {}).total || ub['ใช้ไป'] || ub['ของเสีย']) {
      rows.push([c + ' · เบเกอรี่ (คงเหลือในครัว)', '', '', ub['ใช้ไป'] || 0, ub['ของเสีย'] || 0, '', '', '', '', '', '', '',
                 (bk.stock[c] || { total: 0 }).total]);
    }
  }

  costWriteSheet_(COST_SHEET_LEDGER,
    ['สถานที่', 'รับของไปแล้ว', 'ในนั้นค่าไม้เสียบ', 'ใช้ไปจริง', 'ของเสีย', 'คืนค่าของแล้ว', 'ส่งกำไรแล้ว',
     'ค้างชำระ', 'เงินในมือ', 'จ่ายได้เลย (วันอาทิตย์)', 'สิ้นเดือนส่งทั้งหมด', 'ในนั้นเป็นกำไร',
     'มูลค่าวัตถุดิบคงเหลือ'], rows,
    'ของออกจากครัวกลางแล้วเป็นหนี้ทันที (ของที่ขายเป็นไม้ +ค่าไม้ไม้ละ 0.09) · วันอาทิตย์จ่ายเท่าที่มี ไม่เกินที่ค้าง · ' +
    'สิ้นเดือนส่งเงินในมือทั้งหมด เกินหนี้ค่าของ = กำไรเข้าครัวกลาง · อัปเดตเมื่อ ' +
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
  if (!ss.getSheetByName(COST_SHEET_CASH)) {
    var cs = ss.insertSheet(COST_SHEET_CASH);
    cs.getRange(1, 1, 1, COST_CASH_COLS.length).setValues([COST_CASH_COLS])
      .setFontWeight('bold').setBackground('#f3f3f4');
    cs.setFrozenRows(1);
    Logger.log('สร้างชีต "' + COST_SHEET_CASH + '" แล้ว — เงินทุนที่ใส่ครัวกลาง (บวก) / ถอนออก (ลบ)');
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
  // ทีละที่ — รวม / หม่าล่า / เบเกอรี่ เรียงติดกัน อ่านเทียบกันได้ในตารางเดียว
  var biz = s.biz || { 'หม่าล่า': { pl: s.pl } };
  var locs = {};
  Object.keys(biz).forEach(function (z) { Object.keys(biz[z].pl).forEach(function (l) { locs[l] = true; }); });
  Object.keys(locs).sort(function (x, y) {
    return x === s.central ? -1 : y === s.central ? 1 : x.localeCompare(y, 'th');
  }).forEach(function (loc) {
    ['รวม', 'หม่าล่า', 'เบเกอรี่'].forEach(function (z) {
      var p = biz[z] && biz[z].pl[loc];
      if (!p) return;
      var bakerySales = z === 'รวม' ? p['ขายเบเกอรี่'] : (z === 'เบเกอรี่' ? p['รายได้'] : 0);
      rows.push([loc, z, z === 'เบเกอรี่' ? 0 : p['หน้าร้าน'], z === 'เบเกอรี่' ? 0 : p['เดลิเวอรี่'],
                 p['ค่าคอมแอป'], bakerySales, p['รายได้'],
                 p['ค่าใช้จ่ายวัตถุดิบ'], p['ของเสีย'], p['กำไรขั้นต้น'],
                 p['ค่าใช้จ่ายอื่น'], p['กำไรสุทธิ'], p['วัตถุดิบคงเหลือ']]);
    });
  });
  costWriteSheet_(COST_SHEET_PL,
    ['สถานที่', 'บัญชี', 'ขายหน้าร้าน (หม่าล่า)', 'เดลิเวอรี่ (ราคาบนแอป)', 'ค่าคอม+VAT', 'ขายเบเกอรี่',
     'รายได้รวม', 'ค่าใช้จ่ายวัตถุดิบ', 'ของเสีย', 'กำไรขั้นต้น',
     'ค่าใช้จ่ายอื่น', 'กำไรสุทธิ', 'วัตถุดิบคงเหลือ'], rows,
    'ตัวเลขสะสมตั้งแต่เริ่มระบบ · แต่ละที่มี 3 แถว รวม / หม่าล่า / เบเกอรี่ · ค่าที่ ค่าแรง แบ่งครึ่ง · ' +
    'ครัวกลางไม่มีรายได้เพราะส่งต่อที่ต้นทุน · อัปเดตเมื่อ ' +
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

/* ═══════════════════ สาขาคืนเงินครัวกลาง → แจ้งไลน์ ═══════════════════ */

/** ช่องในชีตจ่ายคืน — แจ้งกลุ่มไลน์ไปแล้วเมื่อไหร่ (ว่าง = ยังไม่แจ้ง) */
var COST_PAY_NOTIFIED_COL = 'แจ้งไลน์แล้ว';

function costPaySheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(COST_SHEET_PAY);
  if (!sh) {
    sh = ss.insertSheet(COST_SHEET_PAY);
    sh.getRange(1, 1, 1, COST_PAY_COLS.length).setValues([COST_PAY_COLS])
      .setFontWeight('bold').setBackground('#f3f3f4');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** ข้อความแจ้งกลุ่ม — บอกยอดค้างที่เหลือด้วย คนในกลุ่มจะได้ไม่ต้องไปเปิดชีต */
function costPaybackText_(loc, baht, method, note, who, biz, profit) {
  biz = costBizCell_(biz);
  profit = costBaht_(Math.min(Number(profit) || 0, baht));
  var L = ['💸 สาขาโอนเงินเข้าครัวกลาง' + (biz !== 'หม่าล่า' ? ' · ' + biz : ''),
           loc + ' — ' + costBaht_(baht).toLocaleString() + ' บาท' + (method ? ' (' + method + ')' : '')];
  if (profit > 0) {
    L.push('• คืนค่าของ ' + costBaht_(baht - profit).toLocaleString() + ' บาท');
    L.push('• กำไรเข้าครัวกลาง ' + profit.toLocaleString() + ' บาท');
  }
  if (note) L.push('หมายเหตุ: ' + note);
  if (who)  L.push('บันทึกโดย ' + who);
  try {
    cacheClear_();
    var sum = costSummary_();
    var o = (sum.biz ? sum.biz[biz].owed : sum.owed)[loc];
    if (o) {
      L.push('');
      L.push('รับของจากครัวกลางไปแล้ว ' + o['ส่งไปแล้ว'].toLocaleString() + ' บาท');
      L.push('คืนค่าของแล้วรวม ' + o['จ่ายคืนแล้ว'].toLocaleString() + ' บาท');
      if (o['ส่งกำไรแล้ว'] > 0) L.push('ส่งกำไรแล้วรวม ' + o['ส่งกำไรแล้ว'].toLocaleString() + ' บาท');
      L.push(o['ค้างชำระ'] >= 0
        ? 'ค้างชำระเหลือ ' + o['ค้างชำระ'].toLocaleString() + ' บาท'
        : 'จ่ายเกินของที่รับไป ' + (-o['ค้างชำระ']).toLocaleString() + ' บาท (เป็นเงินล่วงหน้า)');
    }
  } catch (e) { Logger.log('costPaybackText_: ' + e.message); }
  return L.join('\n');
}

/**
 * แบ่งเงินที่สาขาโอนมา: ไม่เกินหนี้ค่าของที่ค้าง = คืนค่าของ · ส่วนที่เกิน = กำไรเข้าครัวกลาง
 * counted = แถวนี้ถูกนับเป็นคืนค่าของในบัญชีไปแล้ว (กรอกในชีตก่อนแจ้ง) ต้องบวกกลับก่อนเทียบ
 */
function costPaybackProfit_(loc, baht, biz, counted) {
  try {
    cacheClear_();
    var sum = costSummary_();
    var o = (sum.biz ? sum.biz[costBizCell_(biz)].owed : sum.owed)[loc];
    var due = o ? o['ค้างชำระ'] + (counted ? baht : 0) : 0;
    return costBaht_(Math.max(0, baht - Math.max(0, due)));
  } catch (e) {
    Logger.log('costPaybackProfit_: ' + e.message);
    return 0;
  }
}

/**
 * บันทึกเงินที่สาขาคืนครัวกลาง (จากไลน์) — จดว่าแจ้งแล้ว เพราะคนสั่งได้ข้อความตอบกลับในกลุ่มไปแล้ว
 * คืนข้อความไว้ตอบกลับ
 */
function recordPayback_(loc, baht, method, note, who, biz) {
  var sh = costPaySheet_();
  var map = ensureCols_(sh, COST_PAY_COLS.concat([COST_PAY_NOTIFIED_COL]));
  var profit = costPaybackProfit_(loc, baht, biz, false);
  var now = new Date(), r = {};
  r['วันที่'] = now; r['สาขา'] = loc; r['จำนวนเงิน'] = costBaht_(baht);
  r['ธุรกิจ'] = costBizCell_(biz); r['ส่งกำไร'] = profit;
  r['วิธีจ่าย'] = method || ''; r['หมายเหตุ'] = [note, who ? 'ลงทางไลน์โดย ' + who : ''].filter(String).join(' · ');
  r[COST_PAY_NOTIFIED_COL] = Utilities.formatDate(now, costTz_(), 'd/M/yyyy HH:mm');
  appendRows_(sh, map, [r]);
  SpreadsheetApp.flush();
  return costPaybackText_(loc, baht, method, note, who, biz, profit);
}

/**
 * แถวที่กรอกเองในชีตจ่ายคืน ยังไม่ได้แจ้ง → แจ้งกลุ่มไลน์ครัวกลาง แล้วจดว่าแจ้งแล้ว
 * เรียกจาก trigger เช็คของเข้าทุก 5 นาที (checkNewIncoming) ไม่ต้องตั้ง trigger เพิ่ม
 * ครั้งแรกที่เจอชีต จดแถวเก่าทั้งหมดว่าแจ้งแล้วเฉย ๆ ไม่ย้อนส่งของเก่า
 */
function checkNewPaybacks() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COST_SHEET_PAY);
  if (!sh || sh.getLastRow() < 1) return 0;
  var head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var first = head.indexOf(COST_PAY_NOTIFIED_COL) === -1;
  var map = ensureColsRaw_(sh, COST_PAY_COLS.concat([COST_PAY_NOTIFIED_COL]));
  if (sh.getLastRow() < 2) return 0;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var col = map[COST_PAY_NOTIFIED_COL] + 1, sent = 0;
  var stamp = Utilities.formatDate(new Date(), costTz_(), 'd/M/yyyy HH:mm');
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][map[COST_PAY_NOTIFIED_COL]] || '').trim()) continue;
    var loc = String(v[i][map['สาขา']] || '').trim();
    var baht = Number(String(v[i][map['จำนวนเงิน']]).replace(/,/g, '')) || 0;
    if (!loc || !baht) continue;                          // ยังกรอกไม่ครบ รอรอบหน้า
    if (first) { sh.getRange(i + 2, col).setValue('มีก่อนเริ่มแจ้ง'); continue; }
    // กรอกเองในชีต ไม่ได้บอกว่ากำไรเท่าไหร่ — แบ่งให้ตามหนี้ที่ค้าง ณ ตอนนี้
    var profit = Number(v[i][map['ส่งกำไร']]) || 0;
    if (String(v[i][map['ส่งกำไร']]) === '') {
      profit = costPaybackProfit_(loc, baht, v[i][map['ธุรกิจ']], true);
      sh.getRange(i + 2, map['ส่งกำไร'] + 1).setValue(profit);
    }
    var text = costPaybackText_(loc, baht, String(v[i][map['วิธีจ่าย']] || '').trim(),
                                String(v[i][map['หมายเหตุ']] || '').trim(), '', v[i][map['ธุรกิจ']], profit);
    var r = (typeof stockNotify_ === 'function') ? stockNotify_(costCentral_(), text) : { sent: false };
    if (!r.sent) { Logger.log('แจ้งคืนเงินไม่ได้: ' + (r.message || '')); continue; }   // ส่งไม่ได้ ลองรอบหน้า
    sh.getRange(i + 2, col).setValue(stamp);
    sent++;
  }
  return sent;
}

/**
 * รอบตัดยอดคืนครัวกลาง — ทุกวันอาทิตย์ และวันสุดท้ายของเดือน (ตรงกันวันเดียวกันส่งครั้งเดียว)
 * หลัง PAYBACK_REMIND_HOUR (ค่าเริ่มต้น 22 น. หลังปิดร้าน) ส่งยอดที่ควรคืนเข้ากลุ่มไลน์ครัวกลาง
 * อาศัย trigger เช็คของเข้าทุก 5 นาที ส่งวันละครั้ง จำวันที่ส่งไว้ใน PAYBACK_REMIND_LAST
 */
function paybackDueToday_(d) {
  var tz = costTz_();
  var dow = Number(Utilities.formatDate(d, tz, 'u'));             // 7 = อาทิตย์
  var tomorrow = Utilities.formatDate(new Date(d.getTime() + 24 * 3600000), tz, 'd');
  return { sunday: dow === 7, monthEnd: tomorrow === '1' };
}

function paybackReminderText_(d, due) {
  var s = costSummary_(), central = costCentral_();
  var tag = [due.sunday ? 'วันอาทิตย์' : '', due.monthEnd ? 'สิ้นเดือน' : ''].filter(String).join(' + ');
  var L = ['📅 ถึงรอบตัดยอดคืนครัวกลาง (' + tag + ') ' +
           Utilities.formatDate(d, costTz_(), 'd/M/yyyy')];
  var locs = Object.keys(s.owed);
  try {
    Object.keys(stockLineGroups_() || {}).forEach(function (l) { if (locs.indexOf(l) === -1) locs.push(l); });
  } catch (e) {}
  locs = locs.filter(function (l) { return l !== central; }).sort();
  if (!locs.length) return '';
  var bko = (s.biz && s.biz['เบเกอรี่'].owed) || {};
  // สิ้นเดือน = ส่งเงินในมือทั้งหมด (เคลียร์หนี้ค่าของ + กำไร) · วันอาทิตย์ = คืนเท่าที่มี ไม่เกินที่ค้าง
  function block(o, cashLabel) {
    L.push('• รับของจากครัวกลางไปแล้ว ' + o['ส่งไปแล้ว'].toLocaleString() + ' บาท' +
           (o['ค่าไม้เสียบ'] > 0 ? ' (ค่าไม้เสียบ ' + o['ค่าไม้เสียบ'].toLocaleString() + ')' : ''));
    L.push('• คืนค่าของแล้วรวม ' + o['จ่ายคืนแล้ว'].toLocaleString() + ' บาท');
    L.push('• ค้างชำระ ' + Math.max(0, o['ค้างชำระ']).toLocaleString() + ' บาท');
    L.push('• ' + cashLabel + ' ' + o['เงินในมือ'].toLocaleString() + ' บาท');
    if (!due.monthEnd) { L.push('👉 คืนได้รอบนี้ ' + o['จ่ายได้เลย'].toLocaleString() + ' บาท'); return; }
    var all = o['สิ้นเดือนส่งทั้งหมด'] || 0, profit = o['กำไรที่ส่งได้'] || 0;
    L.push('👉 สิ้นเดือน ส่งเข้าครัวกลางทั้งหมด ' + all.toLocaleString() + ' บาท');
    if (profit > 0 && all - profit > 0.005) {
      L.push('   = คืนค่าของ ' + costBaht_(all - profit).toLocaleString() + ' + กำไร ' + profit.toLocaleString());
    } else if (profit > 0) {
      L.push('   = กำไรทั้งหมด (ไม่มีหนี้ค่าของค้าง)');
    } else if (all > 0) {
      L.push('   = คืนค่าของทั้งหมด (ยังไม่มีกำไรให้ส่ง)');
    }
  }
  locs.forEach(function (loc) {
    var o = s.owed[loc];
    L.push('', '🏪 ' + loc + (bko[loc] ? ' · หม่าล่า' : ''));
    if (!o) { L.push('• ยังไม่มีของที่รับไปหรือยอดขายในระบบ'); return; }
    block(o, 'เงินในมือสาขา');
    if (bko[loc]) {
      L.push('', '🍡 ' + loc + ' · เบเกอรี่');
      block(bko[loc], 'เงินในมือเบเกอรี่');
    }
  });
  L.push('', 'โอนแล้วพิมพ์ในกลุ่มนี้ เช่น  คืนเงิน 500  ·  คืนเงิน เบเกอรี่ 300');
  if (due.monthEnd) {
    L.push('ส่วนที่เกินหนี้ค่าของ ระบบลงเป็นกำไรเข้าครัวกลางให้เอง');
    var cash = centralCashText_(s);
    if (cash) L.push('', cash);
  }
  return L.join('\n');
}

function checkPaybackReminder(now) {
  var d = now || new Date();
  var hour = Number(Utilities.formatDate(d, costTz_(), 'HH'));
  var props = PropertiesService.getScriptProperties();
  var at = Number(props.getProperty('PAYBACK_REMIND_HOUR')) || 22;
  if (hour < at) return false;
  var due = paybackDueToday_(d);
  if (!due.sunday && !due.monthEnd) return false;
  var key = Utilities.formatDate(d, costTz_(), 'yyyy-MM-dd');
  if (props.getProperty('PAYBACK_REMIND_LAST') === key) return false;
  cacheClear_();
  var text = paybackReminderText_(d, due);
  if (!text) { props.setProperty('PAYBACK_REMIND_LAST', key); return false; }
  var r = (typeof stockNotify_ === 'function') ? stockNotify_(costCentral_(), text) : { sent: false };
  if (!r.sent) { Logger.log('แจ้งรอบคืนเงินไม่ได้: ' + (r.message || '')); return false; }
  props.setProperty('PAYBACK_REMIND_LAST', key);
  return true;
}

/* ═══════════════════ เงินหมุนเวียนครัวกลาง ═══════════════════ */

/** สรุปเงินหมุนเวียนครัวกลางเป็นข้อความ — ตอบในไลน์ / ต่อท้ายแจ้งเตือนสิ้นเดือน */
function centralCashText_(sum) {
  var s = sum || costSummary_();
  var b = s.biz && s.biz['รวม'] ? s.biz['รวม'] : { pl: s.pl };
  var c = (b.pl[s.central] || {})['เงินหมุนเวียน'];
  if (!c) return '';
  var f = function (n) { return costBaht_(n).toLocaleString(); };
  var L = ['💵 เงินหมุนเวียนครัวกลาง (ตั้งแต่ ' + c['ตั้งแต่'] + ')'];
  if (c['เงินทุน']) L.push('+ เงินทุน ' + f(c['เงินทุน']));
  L.push('+ สาขาคืนค่าของ ' + f(c['รับคืนค่าของ']) + (c['รับกำไร'] ? ' · ส่งกำไร ' + f(c['รับกำไร']) : ''));
  L.push('− ซื้อของ ' + f(c['ซื้อของ'] + c['ลองสูตร']) + (c['ค่าใช้จ่าย'] ? ' · ค่าใช้จ่าย ' + f(c['ค่าใช้จ่าย']) : ''));
  L.push('= เงินคงเหลือ ' + f(c['คงเหลือ']) + ' บาท');
  L.push('จมอยู่ในของครัวกลาง ' + f(c['ของในครัวกลาง']) + ' · สาขายังค้าง ' + f(c['สาขาค้างจ่าย']));
  if (c['รอบเงิน'] != null) L.push('เงินกลับมาครบรอบใน ~' + c['รอบเงิน'] + ' วัน');
  return L.join('\n');
}

/**
 * เจ้าของใส่ทุน / ถอนเงินออกจากครัวกลาง (จากไลน์) — ถอนลงเป็นเลขติดลบ
 * คืนข้อความไว้ตอบกลับ
 */
function recordCentralCash_(baht, what, biz, note, who) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(COST_SHEET_CASH);
  if (!sh) {
    sh = ss.insertSheet(COST_SHEET_CASH);
    sh.getRange(1, 1, 1, COST_CASH_COLS.length).setValues([COST_CASH_COLS])
      .setFontWeight('bold').setBackground('#f3f3f4');
    sh.setFrozenRows(1);
  }
  var map = ensureCols_(sh, COST_CASH_COLS);
  var out = what === 'ถอนเงิน';
  var r = {};
  r['วันที่'] = new Date(); r['รายการ'] = what;
  r['จำนวนเงิน'] = costBaht_(out ? -Math.abs(baht) : Math.abs(baht));
  r['ธุรกิจ'] = costBizCell_(biz);
  r['หมายเหตุ'] = [note, who ? 'ลงทางไลน์โดย ' + who : ''].filter(String).join(' · ');
  appendRows_(sh, map, [r]);
  SpreadsheetApp.flush();
  cacheClear_();
  return (out ? '🏧 ถอนเงินออกจากครัวกลาง ' : '💰 ใส่ทุนเข้าครัวกลาง ') + costBaht_(baht).toLocaleString() + ' บาท' +
         (r['ธุรกิจ'] !== 'หม่าล่า' ? ' · ' + r['ธุรกิจ'] : '') + '\n\n' + centralCashText_();
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

  return centralStockSummary_(now.getTime(), chargeTo, rows.length, 'ตั้งยอดครัวกลางแล้ว');
}

/** สรุปว่าตัดอะไรไปเป็นค่าวัตถุดิบสาขาเท่าไหร่ ในรอบตั้งยอดเวลา t */
function centralStockSummary_(t, chargeTo, n, title) {
  var central = costCentral_();
  var rep = costReplay_(), sum = 0, lines = [];
  rep.log.forEach(function (l) {
    if (l.loc !== chargeTo || l.kind !== 'ใช้ไป' || Math.abs(costTime_(l.t) - t) > 60000) return;
    var it = findStockItem_(l.item);
    lines.push('  • ' + l.item + ' ' + (it ? fmtPack_(l.qty, it) : l.qty) + ' = ' + costBaht_(l.value) + ' บาท');
    sum += l.value;
  });
  var st = costSummary_().stock[central] || { total: 0, rows: [] };
  var text = '✅ ' + title + ' ' + n + ' รายการ\n' +
    'มูลค่าของในครัวกลางตอนนี้ ' + costBaht_(st.total).toLocaleString() + ' บาท\n\n' +
    'ส่วนที่หายไป → ค่าวัตถุดิบของ ' + chargeTo + ' ' + costBaht_(sum).toLocaleString() + ' บาท\n' +
    (lines.join('\n') || '  (ไม่มี)');
  Logger.log(text);
  if (typeof refreshCostingSheets === 'function') refreshCostingSheets();
  return { rows: n, charged: costBaht_(sum), central: st.total, text: text };
}

/**
 * แก้รอบตั้งยอดครัวกลางที่ลงไปแล้ว — แก้แถวเดิม (เวลาเดิม) ไม่ลงรอบใหม่
 * ลงรอบใหม่จะผิด: ของที่ตัดเป็นค่าวัตถุดิบสาขาไปแล้วตอนรอบแรก จะไม่ถูกคืน
 * รายการที่ยังไม่มีแถวในรอบนั้น เพิ่มแถวใหม่ที่เวลาเดียวกัน
 */
function fixCentralStockBatch_(list, chargeTo) {
  var central = costCentral_();
  var sh = sheet_(SHEET_COUNT);
  var map = ensureCols_(sh, MOVE_COLS.concat([COUNT_COST_COL, COUNT_CHARGE_COL]));
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var batch = 0;
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][map['สาขา']]).trim() !== central) continue;
    if (String(v[i][map['หมายเหตุ']]).indexOf('ตั้งยอดครัวกลาง') !== 0) continue;
    batch = Math.max(batch, costTime_(v[i][map['วันที่เวลา']]));
  }
  if (!batch) return null;
  var at = {};
  for (var j = 1; j < v.length; j++) {
    if (String(v[j][map['สาขา']]).trim() !== central) continue;
    if (String(v[j][map['หมายเหตุ']]).indexOf('ตั้งยอดครัวกลาง') !== 0) continue;
    if (Math.abs(costTime_(v[j][map['วันที่เวลา']]) - batch) > 60000) continue;
    at[String(v[j][map['รายการ']]).trim()] = j + 1;
  }
  var add = [], changed = 0;
  list.forEach(function (x) {
    var it = findStockItem_(x[0]);
    if (!it) return;
    var sp = splitUnits_(x[1], it), vals = {};
    vals['จำนวน'] = costQty_(x[1]); vals['แพ็ค'] = sp.packs; vals['เศษ'] = sp.sticks; vals['เศษ(ชิ้น)'] = sp.pieces;
    vals['หมายเหตุ'] = 'ตั้งยอดครัวกลาง' + (x[3] ? ' · ' + x[3] : '');
    vals[COUNT_COST_COL] = x[2] || ''; vals[COUNT_CHARGE_COL] = chargeTo || '';
    var r = at[it.name];
    if (r) {
      var row = v[r - 1];
      if (Number(row[map['จำนวน']]) === vals['จำนวน'] && Number(row[map[COUNT_COST_COL]]) === Number(vals[COUNT_COST_COL])) return;
      Object.keys(vals).forEach(function (k) { if (map[k] !== undefined) sh.getRange(r, map[k] + 1).setValue(vals[k]); });
      changed++;
    } else {
      vals['วันที่เวลา'] = new Date(batch); vals['สาขา'] = central; vals['ผู้ตรวจ'] = 'เจ้าของร้าน';
      vals['รายการ'] = it.name; vals['หน่วย'] = baseUnitOf_(it); vals['ประเภท'] = 'เช็คสต็อก';
      vals['ไม้ต่อแพ็ค'] = it.perPack; vals['ชิ้นต่อไม้'] = perStickOf_(it);
      add.push(vals);
    }
  });
  if (add.length) appendRows_(sh, map, add);
  SpreadsheetApp.flush();
  cacheClear_();
  return centralStockSummary_(batch, chargeTo, changed + add.length, 'แก้รอบตั้งยอดครัวกลางแล้ว');
}

/**
 * ของในครัวกลางที่นับจริง 8/10/2026 (เจ้าของร้านส่งมาในแชต)
 * ราคาเป็นต่อหน่วยเล็กสุดในระบบ — กล่อง/ห่อ/โล แปลงแล้ว
 */
var CENTRAL_STOCK_20261008 = [
  ['กะหล่ำ (ดิบ)',                  3.125, 27.25,       '3.125 โล โลละ 27.25'],
  // ในระบบมี 0.1 โล (85 บาท) อยู่แล้ว ที่เกินมา 1.417 โล คิดโลละ 266
  ['สาหร่าย (ดิบ)',                 1.517, 266,         '1.417 โล โลละ 266 + 0.1 โล 85 บาท'],
  // กล่องละ 21.44 กล่องละ 12 ชิ้น (ชิ้นละ 1.79)
  ['ฟองเต้าหู้ม้วน (ดิบ)',           216,   21.44 / 12,  '18 กล่อง × 12 ชิ้น กล่องละ 21.44'],
  ['ช้อน',                         500,   11.54 / 100, '5 แพ็ค × 100 อัน แพ็คละ 11.54'],
  ['มันเทศ (ดิบ)',                  6,     10.92,       'เส้นมันเทศ 6 ถุง (ถุงละ 200 กรัม) ถุงละ 10.92'],
  ['ผงหม่าล่า',                     2900,  10.49 / 100, 'พริกผงจีน 29 ห่อ × 100 กรัม ห่อละ 10.49'],
  ['เบสหม่าล่า',                    1000,  160 / 1000,  '1000 มล 160 บาท'],
  ['นมผง (ดิบ)',                   200,   110 / 1000,  '200 กรัม โลละ 110'],
  ['น้ำจิ้มงา (ดิบ)',                4,     89.6,        '4 ถุง ถุงละ 89.6'],
  ['น้ำดำ',                         8,     75.3,        '8 ถุง ถุงละ 75.3'],
  ['พริกป่น',                       170,   125 / 1000,  'พริกป่นไทย 170 กรัม โลละ 125'],
  ['เต้าหู้หลอด (ดิบ)',              12,    54 / 12,     '12 หลอด (1 ถุง) 54 บาท'],
  ['ข้าวโพดฝัก (ดิบ)',               3,     25 / 3,      '3 ฝัก 25 บาท'],
  ['ถ้วย 2 ออน',                    50,    25 / 50,     '1 แพ็ค 25 บาท'],
  ['ไม้เสียบเบอร์ 8',                1,     18,          '1 แพ็ค 18 บาท'],
  ['เห็ดออเร็นจิ (ดิบ)',             0.749, 60,          '0.749 โล โลละ 60'],
  ['แมงกะพรุน (ดิบ)',               0.378, 70,          '0.378 โล โลละ 70'],
  ['หัวไหล่หมูติดหนังสไลซ์ (ดิบ)',    1.357, 122,         '1.357 โล โลละ 122'],
  ['ไก่ (ดิบ)',                     0.896, 84,          'อกไก่ 0.896 โล โลละ 84'],
  ['วุ้นเส้นเกาหลี (ดิบ)',            0.5,   62,          '0.5 โล 31 บาท'],
  ['เห็ดเข็ม (ดิบ)',                 0.4,   50,          'เห็ดเข็มทอง 0.4 โล โลละ 50']
];

/** กด ▶ ในหน้า Apps Script — ผลดูที่บันทึกการดำเนินการ · กดซ้ำ = แก้รอบเดิมตามรายการล่าสุด ไม่ลงซ้ำ */
function setCentralStock20261008() {
  var props = PropertiesService.getScriptProperties();
  // รายการสินค้าในชีตยังเป็นหน่วยเก่า (ข้าวโพดเป็นโล เต้าหู้หลอดเป็นถุง) — อัปเดตก่อน ไม่งั้นจำนวนผิดหน่วย
  // นมผงที่ซื้อมาย้ายไปชื่อ "นมผง (ดิบ)" (9/10) — กดซ้ำหลังอัปเดตโค้ดก็ต้องเปลี่ยนชื่อก่อนแก้รอบเดิม
  var corn = findStockItem_('ข้าวโพดฝัก (ดิบ)'), tube = findStockItem_('เต้าหู้หลอด (ดิบ)');
  if (!findStockItem_('ไม้เสียบเบอร์ 8') || !corn || corn.subUnit !== 'ฝัก' || !tube || tube.subUnit !== 'หลอด' ||
      !findStockItem_('นมผง (ดิบ)')) {
    if (typeof fixItemList === 'function') fixItemList();
    cacheClear_();
  }
  // กดไปแล้ว = แก้แถวเดิมตามรายการล่าสุด (เพิ่มรายการตกหล่นได้ กดซ้ำได้ ไม่ลงซ้ำ)
  if (props.getProperty('CENTRAL_STOCK_20261008')) {
    fixCentralStockBatch_(CENTRAL_STOCK_20261008, 'ตลาดทรัพย์พัฒนา');
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
