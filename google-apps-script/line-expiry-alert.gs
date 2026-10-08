/************************************************************
 * 🔔 แจ้งเตือน LINE: ของเข้าใหม่ และของที่ต้องทิ้ง
 *
 *  1) ของเข้าใหม่ — เช็คชีต "จำนวนของเข้า" ทุก 5 นาที
 *     แจ้ง LINE ทันทีว่าเข้าอะไร พร้อมวันที่ขายได้ถึง / วันที่ต้องทิ้ง
 *  2) ของที่ต้องทิ้ง — แจ้งทันทีหลังพนักงานเช็คสต็อกสาขาเสร็จ (expiryAfterCount_)
 *     แจ้งเฉพาะของที่ "ยังเหลืออยู่จริง" และขายได้ถึงวันนี้เป็นวันสุดท้าย
 *     ขายหมดก่อนครบกำหนด = ไม่แจ้ง
 *
 * อายุของแต่ละรายการดู branchShelfDays_ ด้านล่าง
 * ไม่นับวันที่ของเข้า เช่น เข้า 10/10 อยู่ได้ 3 วัน → ขายได้ถึง 13/10 · ทิ้ง 14/10 ก่อนขาย
 *
 * วิธีติดตั้ง: อ่านไฟล์ README.md ในโฟลเดอร์เดียวกัน
 ************************************************************/

// ── อายุของที่หน้าร้าน (ตั้ง 8/10/2026) ──
// นับจากวันที่ของถึงสาขา (ไม่นับวันที่เข้า) ขายได้ถึง "วันเข้า + N" แล้วทิ้งเช้าวันถัดไปก่อนขาย
//   หมูพันเห็ดเข็มทอง เข้า 10/10 อยู่ได้ 3 วัน → ขายได้ถึง 13/10 · ทิ้ง 14/10 ก่อนขาย
// เฉพาะของขาย (ราคาขาย > 0) — หม่าล่า นมผง น้ำจิ้ม ของแถม ของใช้ ไม่นับวันหมดอายุ
// ครัวกลางไม่นับ อายุเริ่มตอนของถึงหน้าร้าน
//
//   (แก้ 8/10 รอบสอง — ตารางเต็มดู BRANCH_SHELF_DAYS ข้างล่าง)
//   ของพัน (ครัวกลางพันเอง เช่น หมูพัน...)  3 วัน
//   หมูสด · ไก่ · ดอลลี่ · ผัก/เห็ด           5 วัน
//   หมึกกรอบ · แมงกะพรุน · มันเทศ · อุด้ง     7 วัน
//   มาม่าเปล่า · ต็อก · ชีส · รากบัว         15 วัน
//   วุ้นเส้นหม่าล่า · ฟองเต้าหู้ม้วน           30 วัน
//   ลูกชิ้น และที่เหลือทั้งหมด                 7 วัน
//   เบเกอรี่ คิดแยก (bakeryLots_) — สาขา 7 วัน และไม่เกินอายุจากครัวกลาง
var BRANCH_SHELF_DEFAULT = 7;
// ผัก/เห็ด 5 วัน — กะหล่ำเป็นของแถม ไม่นับ
var BRANCH_VEG = ['ผักกาดขาว', 'กวางตุ้ง', 'เห็ดเข็ม', 'ข้าวโพดฝัก', 'กระเจี๊ยบ', 'มันฝรั่ง', 'ฟักทอง',
                  'เห็ดหูหนูขาว', 'เห็ดหูหนูดำ', 'เห็ดหอม', 'เห็ดออเร็นจิ'];
// ตัวที่ระบุชื่อตรง ๆ — มาก่อนกฎอื่น แก้/เพิ่มตรงนี้ได้
var BRANCH_SHELF_DAYS = {
  'ดอลลี่': 5, 'ไก่': 5,
  'ปลาหมึกกรอบ': 7, 'แมงกะพรุน': 7, 'มันเทศ': 7, 'อุด้ง': 7,
  'มาม่าเปล่า': 15, 'ต็อกแท่งเล็ก': 15, 'ชีส': 15, 'รากบัว': 15,
  'วุ้นเส้นหม่าล่า': 30, 'ฟองเต้าหู้ม้วน': 30
};
function branchShelfDays_(item) {
  if (!item) return 0;
  if (typeof KIND_PACKED === 'string' && item.kind && item.kind !== KIND_PACKED) return 0;
  if (!(Number(item.price) > 0)) return 0;                    // ไม่ได้ขาย ไม่นับวันหมดอายุ
  var n = String(item.name || '').trim();
  if (BRANCH_SHELF_DAYS.hasOwnProperty(n)) return BRANCH_SHELF_DAYS[n];
  if (BRANCH_VEG.indexOf(n) !== -1) return 5;
  // ของพัน — วัตถุดิบเป็นกลุ่มเนื้อหมู (@เนื้อหมู) หรือชื่อหมูพัน...
  var wrapped = /^หมูพัน/.test(n) || (item.raws || []).some(function (r) { return String(r).charAt(0) === '@'; });
  if (wrapped) return 3;
  if (/^หมู/.test(n)) return 5;
  return BRANCH_SHELF_DEFAULT;
}

/** ตารางอายุทุกรายการของขาย — รัน listShelfLife ดูใน Logs */
function listShelfLife() {
  var by = {};
  getStockItems_().forEach(function (it) {
    var d = branchShelfDays_(it);
    if (it.bakery) d = 'เบเกอรี่';
    if (!d) return;
    (by[d] = by[d] || []).push(it.name);
  });
  var out = Object.keys(by).map(function (d) { return (isNaN(d) ? d : d + ' วัน') + ': ' + by[d].join(', '); });
  Logger.log(out.join('\n'));
  return by;
}
function branchShelfOf_(name) {
  var it = (typeof findStockItem_ === 'function') ? findStockItem_(String(name || '').trim()) : null;
  return branchShelfDays_(it);
}

var INCOMING_SHEET_NAME = 'จำนวนของเข้า';   // ชื่อชีตที่เก็บข้อมูลของเข้า

// ── ครัวกลางไม่นับวันหมดอายุ ──
// ของที่เข้าครัวกลางยังไม่ได้เตรียมเสิร์ฟ อายุเริ่มนับตอนส่งถึงหน้าร้าน
// (แถว "ของเข้าร้าน") ไม่ใช่ตอนรับเข้าครัว ถ้านับจากวันเข้าครัวด้วย
// ครัวกลางจะโดนแจ้งให้ทิ้งของที่ส่งออกไปขายเรียบร้อยแล้ว
var CENTRAL_NAME = 'ครัวกลาง';
function isCentral_(branch) { return String(branch || '').trim() === CENTRAL_NAME; }

// ── ID ของ Google Sheet ──
// ถ้าสคริปต์นี้อยู่ "คนละโปรเจกต์" กับชีต (สร้างจาก script.google.com
// ไม่ใช่จาก ส่วนขยาย → Apps Script ในตัวชีต) getActiveSpreadsheet() จะได้ null
// ต้องใส่ ID ตรงนี้ ไม่งั้นสคริปต์จะหาชีตไม่เจอและไม่แจ้งเตือนอะไรเลย
//
// ID เอามาจาก URL ของชีต ท่อนกลางระหว่าง /d/ กับ /edit
//   https://docs.google.com/spreadsheets/d/[ตรงนี้คือ ID]/edit
var SPREADSHEET_ID = '';   // ← ใส่ ID ตรงนี้ (ถ้าอยู่โปรเจกต์เดียวกับชีต เว้นว่างไว้ได้)

/** หาไฟล์ Google Sheet — รองรับทั้งอยู่โปรเจกต์เดียวกับชีตและอยู่คนละโปรเจกต์ */
function ss_() {
  var ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('หาไฟล์ Google Sheet ไม่เจอ — สคริปต์นี้อยู่คนละโปรเจกต์กับชีต ' +
                    'ต้องใส่ SPREADSHEET_ID ที่ด้านบนของไฟล์นี้ก่อน');
  }
  return ss;
}

// ── กลุ่ม LINE ของแต่ละสาขา ──
// ใส่ Group ID (ขึ้นต้น C...) ของกลุ่มแต่ละสาขา — วิธีหาดู README หัวข้อ webhook.site
// แจ้งเตือนของสาขาไหน จะส่งเข้ากลุ่มสาขานั้นเท่านั้น
// สาขาที่ยังไม่ใส่ (เว้น '' ไว้) จะส่งไปปลายทางกลาง (LINE_TARGET_ID หรือ broadcast) แทน
// ┌────────────────────────────────────────────────────────────┐
// │ กลุ่มครัวกลาง  ← ของเข้าครัวกลาง · ของครัวกลางใกล้หมด · ของเสียครัวกลาง │
// │ กลุ่มสาขา     ← ของเข้าสาขา · ของหมดอายุ 1 ทุ่ม · เช็คสต็อก · ของเสียสาขา │
// │ ครัวกลางไม่มีแจ้งวันหมดอายุ อายุเริ่มนับตอนของถึงหน้าร้าน            │
// └────────────────────────────────────────────────────────────┘
// ถ้า 2 สาขาใช้กลุ่มเดียวกัน ใส่ Group ID เดียวกันทั้งคู่ได้เลย
// ใช้ LINE channel access token "อันเดียว" ได้ทั้งหมด — token ผูกกับบอท (OA)
// ไม่ได้ผูกกับกลุ่ม บอทตัวเดียวส่งเข้ากี่กลุ่มก็ได้ แยกด้วย Group ID ตอนส่ง
// ขอแค่บอทตัวนั้นถูกเชิญเข้าทุกกลุ่มที่จะแจ้ง
//
// วิธีตั้งค่า — ไปที่ โปรเจกต์ > การตั้งค่าสคริปต์ > คุณสมบัติสคริปต์
//   LINE_CHANNEL_ACCESS_TOKEN = token ของบอท
//   LINE_GROUPS = {"ครัวกลาง":"Cxxxx","ตลาดทรัพย์พัฒนา":"Cyyyy"}
// เก็บใน Script Properties ไม่ใช่ในโค้ด เพราะ repo นี้เป็น public
// สาขาที่ยังไม่เปิดใช้ (เช่น แบริ่ง) ไม่ต้องใส่ ระบบจะข้ามการแจ้งไปเฉย ๆ
var BRANCH_LINE_GROUPS = {};   // สำรอง — ปกติใช้ Script Property LINE_GROUPS แทน

function lineGroups_() {
  var raw = PropertiesService.getScriptProperties().getProperty('LINE_GROUPS');
  if (!raw) return BRANCH_LINE_GROUPS;
  try {
    var o = JSON.parse(raw);
    return (o && typeof o === 'object') ? o : BRANCH_LINE_GROUPS;
  } catch (e) {
    Logger.log('LINE_GROUPS ไม่ใช่ JSON ที่ถูกต้อง: ' + e.message);
    return BRANCH_LINE_GROUPS;
  }
}

function getBranchTarget_(branch) {
  return String(lineGroups_()[String(branch || '').trim()] || '').trim();
}
var TZ = 'Asia/Bangkok';
var NOTIFY_HOUR = 19;                      // แจ้งของครบกำหนดทิ้งตอนกี่โมง (19 = 1 ทุ่ม)
var INCOMING_POLL_MINUTES = 5;             // เช็คของเข้าใหม่ทุกกี่นาที (ใช้ได้: 1, 5, 10, 15, 30)
var PROP_LAST_ROW = 'LAST_NOTIFIED_INCOMING_ROW'; // ตำแหน่งแถวล่าสุดที่แจ้งไปแล้ว

// ============================================================
// 1) แจ้งเตือนของเข้าใหม่ (Trigger ทุก 5 นาทีเรียก checkNewIncoming)
// ============================================================

/**
 * เช็คว่ามีของเข้าใหม่ในชีตหรือไม่ ถ้ามี → แจ้ง LINE ทันที
 * ว่าเข้าอะไรบ้าง พร้อมวันที่ควรทิ้งของแต่ละรายการ
 */
function checkNewIncoming() {
  // สาขาคืนเงินครัวกลาง (กรอกในชีตเอง) — แจ้งกลุ่มไลน์ครัวกลาง อาศัย trigger ตัวนี้ ไม่ต้องตั้งเพิ่ม
  try { if (typeof checkNewPaybacks === 'function') checkNewPaybacks(); }
  catch (e) { Logger.log('checkNewPaybacks: ' + e.message); }
  // ทุกวันอาทิตย์ + สิ้นเดือน หลัง 4 ทุ่ม — บอกยอดที่สาขาควรคืนครัวกลาง
  try { if (typeof checkPaybackReminder === 'function') checkPaybackReminder(); }
  catch (e) { Logger.log('checkPaybackReminder: ' + e.message); }
  // เบเกอรี่ในครัวกลางหมดอายุ — วันละครั้ง
  try { checkBakeryExpiryDaily(); } catch (e) { Logger.log('checkBakeryExpiryDaily: ' + e.message); }
  var ss = ss_();
  var sheet = ss.getSheetByName(INCOMING_SHEET_NAME);
  if (!sheet) return;

  var props = PropertiesService.getScriptProperties();
  var lastRow = sheet.getLastRow();
  var lastNotified = parseInt(props.getProperty(PROP_LAST_ROW) || '0', 10);

  // รันครั้งแรก: จำตำแหน่งแถวปัจจุบันไว้ ไม่ย้อนแจ้งข้อมูลเก่า
  if (!lastNotified) {
    props.setProperty(PROP_LAST_ROW, String(lastRow));
    return;
  }
  // แถวหายไป = มีคนลบแถวทิ้งในชีต (ลบของที่ลงผิด) เลขที่จำไว้เลยเกินจริง
  // ปล่อยไว้จะเงียบยาว เพราะของเข้าใหม่ไปแทนที่แถวเดิมที่ "แจ้งไปแล้ว"
  // ขยับหมุดลงมาให้เท่าของจริง แล้วเริ่มนับใหม่จากตรงนั้น
  if (lastRow < lastNotified) {
    props.setProperty(PROP_LAST_ROW, String(lastRow));
    return;
  }
  if (lastRow <= lastNotified) return; // ไม่มีแถวใหม่

  var values = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
  var headers = values[0].map(function(h) { return String(h).trim(); });
  var colDate    = findCol_(headers, ['วันที่เวลา', 'วันที่', 'timestamp']);
  var colBranch  = findCol_(headers, ['สาขา', 'branch']);
  var colChecker = findCol_(headers, ['ผู้ตรวจ', 'checker']);
  var colName    = findCol_(headers, ['รายการ', 'ชื่อรายการ', 'ชื่อ', 'name']);
  var colQty     = findCol_(headers, ['จำนวน', 'qty']);
  var colUnit    = findCol_(headers, ['หน่วย', 'unit']);
  var colPacks   = findCol_(headers, ['แพ็ค', 'packs']);
  var colRem     = findCol_(headers, ['เศษ', 'rem']);
  var colPerPack = findCol_(headers, ['ไม้ต่อแพ็ค', 'หน่วยย่อยต่อแพ็ค', 'perPack']);
  var colPieces  = findCol_(headers, ['เศษ(ชิ้น)', 'เศษชิ้น', 'pieces']);
  var colPerStick= findCol_(headers, ['ชิ้นต่อไม้', 'perStick']);
  var colKind    = findCol_(headers, ['ประเภท', 'kind']);
  if (colName === -1) return;

  var items = [];
  for (var r = lastNotified; r < lastRow; r++) { // index ใน values = เลขแถว - 1
    var row = values[r];
    var name = String(row[colName] || '').trim();
    if (!name) continue;
    // ของแห้ง/มาม่า ไม่มีวันหมดอายุ แต่ก็ยังต้องแจ้งว่าเข้ามา แค่ไม่บอกวันทิ้ง
    var inDate = (colDate !== -1 ? parseThaiDate_(row[colDate]) : null) || new Date();
    var branch = colBranch !== -1 ? String(row[colBranch] || '') : '';
    // ครัวกลางไม่ต้องบอกวันทิ้ง — ยังไม่เริ่มนับอายุ · ของไม่ได้ขายก็ไม่บอก
    var days = isCentral_(branch) ? 0 : branchShelfOf_(name);
    var expireStr = '';
    // เบเกอรี่ — อายุเริ่มที่ครัวกลาง (ไดฟุกุนับจากวันเข้าที่กรอก) ถึงสาขาได้ 7 วันแต่ไม่เกินอายุเดิม
    if (typeof bakeryOriginDays_ === 'function' && bakeryOriginDays_(name)) {
      try {
        var lt = (bakeryLots_(name, inDate.getTime())[String(branch).trim()] || []);
        var lastKey = lt.length ? lt[lt.length - 1].last : '';
        if (lastKey) expireStr = 'หมดอายุ ' + expiryDM_(lastKey) + ' (ทิ้ง ' + expiryDM_(expiryAddDays_(lastKey, 1)) + ')';
      } catch (e) { Logger.log('bakery expiry text: ' + e.message); }
    } else if (days) {
      var lastSell = new Date(inDate.getTime());
      lastSell.setDate(lastSell.getDate() + days);
      var toss = new Date(lastSell.getTime());
      toss.setDate(toss.getDate() + 1);
      expireStr = 'ขายได้ถึง ' + thaiDMY_(lastSell) + ' · ทิ้ง ' + thaiDMY_(toss) + ' ก่อนขาย';
    }
    items.push({
      name:       name,
      qty:        colQty     !== -1 ? row[colQty] : '',
      unit:       colUnit    !== -1 ? String(row[colUnit] || '')    : '',
      branch:     branch,
      checker:    colChecker !== -1 ? String(row[colChecker] || '') : '',
      packs:      colPacks   !== -1 ? Number(row[colPacks])   || 0 : 0,
      rem:        colRem     !== -1 ? Number(row[colRem])     || 0 : 0,
      perPack:    colPerPack !== -1 ? Number(row[colPerPack]) || 0 : 0,
      pieces:     colPieces  !== -1 ? Number(row[colPieces])  || 0 : 0,
      perStick:   colPerStick!== -1 ? Number(row[colPerStick])|| 0 : 0,
      kind:       colKind    !== -1 ? String(row[colKind] || '')    : '',
      expireStr:  expireStr
    });
  }

  // จำตำแหน่งใหม่ก่อนส่ง กันแจ้งซ้ำถ้าส่งสำเร็จแต่สคริปต์สะดุดทีหลัง
  props.setProperty(PROP_LAST_ROW, String(lastRow));
  if (!items.length) return;

  // แยกส่งตามสาขา — ของสาขาไหนเข้ากลุ่มสาขานั้น
  var byBranch = {};
  items.forEach(function(it) {
    var b = String(it.branch || '').trim();
    (byBranch[b] = byBranch[b] || []).push(it);
  });
  Object.keys(byBranch).forEach(function(b) {
    sendLine_(buildIncomingMessage_(byBranch[b]), getBranchTarget_(b));
  });
  Logger.log('แจ้งของเข้าใหม่ ' + items.length + ' รายการ (' + Object.keys(byBranch).length + ' สาขา)');
}

/**
 * ข้อความจำนวน — หน่วยต้องตรงกับช่องที่กรอกมา
 *   กรอกช่องแพ็ค   → "2 แพ็ค"
 *   กรอกช่องเศษไม้ → "6 ไม้"
 *   กรอกช่องเศษชิ้น → "1 ชิ้น"
 *
 * คอลัมน์ "หน่วย" ในชีตเก็บหน่วยเล็กสุด ซึ่งของลูกชิ้นคือ "ชิ้น" ไม่ใช่ "ไม้"
 * เอามาใช้ตรง ๆ ไม่ได้ ไม่งั้น 6 ไม้ จะกลายเป็น 6 ชิ้น
 */
function qtyText_(it) {
  // ไฟล์นี้อยู่โปรเจกต์เดียวกับ pos-backend แล้ว ใช้ตัวจัดรูปแบบตัวเดียวกันเลย
  // จะได้ไม่มีสองสูตรที่เพี้ยนจากกันเวลาแก้ข้างใดข้างหนึ่ง
  if (typeof fmtPack_ === 'function' && typeof findStockItem_ === 'function') {
    try {
      var item = findStockItem_(it.name);
      if (item && Number(it.qty) > 0) return ' ' + fmtPack_(Number(it.qty), item);
    } catch (e) { /* ไม่มีชีตรายการสินค้าก็ตกไปใช้ทางล่าง */ }
  }

  var unit  = it.unit || '';
  var stick = it.perStick > 1 ? 'ไม้' : unit;    // ลูกชิ้น: หน่วยกลางคือไม้ เล็กสุดคือชิ้น
  if (it.perPack > 1 && (it.packs || it.rem || it.pieces)) {
    var parts = [];
    if (it.packs)  parts.push(it.packs + ' แพ็ค');
    if (it.rem)    parts.push(it.rem + ' ' + stick);
    if (it.pieces) parts.push(it.pieces + ' ชิ้น');
    return ' ' + parts.join(' ') + ' (1 แพ็ค = ' + it.perPack + ' ' + stick +
           (it.perStick > 1 ? ' · 1 ' + stick + ' = ' + it.perStick + ' ชิ้น' : '') + ')';
  }
  if (it.qty !== '' && it.qty != null) return ' ' + it.qty + ' ' + unit;
  return '';
}

function buildIncomingMessage_(items) {
  var now = new Date();
  var lines = ['📦 ของเข้าใหม่ (' + thaiDMY_(now) + ' ' + Utilities.formatDate(now, TZ, 'HH:mm') + ' น.)'];
  var byBranch = {};
  items.forEach(function(it) {
    var key = '📍 ' + (it.branch || 'ไม่ระบุสาขา') + (it.checker ? ' — ผู้ตรวจ: ' + it.checker : '');
    (byBranch[key] = byBranch[key] || []).push(it);
  });
  Object.keys(byBranch).forEach(function(b) {
    lines.push('');
    lines.push(b);
    byBranch[b].forEach(function(it) {
      lines.push('• ' + it.name + qtyText_(it) +
        (it.expireStr ? ' → ' + it.expireStr : ''));
    });
  });
  return lines.join('\n');
}

// ============================================================
// 2) แจ้งเตือนของครบกำหนดทิ้ง (Trigger ทุกวัน 1 ทุ่ม เรียก notifyExpiringItems)
// ============================================================

/**
 * ฟังก์ชันหลัก — Trigger รายวันจะเรียกตัวนี้
 */
function notifyExpiringItems() {
  // เลิกแจ้งตอน 1 ทุ่มจากวันที่ของเข้าแล้ว (8/10) — ของขายหมดไปแล้วก็ยังโดนแจ้งให้ทิ้ง
  // ย้ายไปแจ้งหลังพนักงานเช็คสต็อกสาขาแทน (expiryAfterCount_) แจ้งเฉพาะของที่ยังเหลืออยู่จริง
  Logger.log('แจ้งของหมดอายุย้ายไปแจ้งหลังเช็คสต็อกสาขาแล้ว — trigger ตัวนี้ไม่ส่งอะไร');
}

// ============================================================
// 3) หลังเช็คสต็อกสาขา — ของที่เหลือแล้วถึงกำหนดทิ้ง
// ============================================================

/** วันทำการ — ตี 4 ยังเป็นวันก่อน (ตรงกับปิดร้าน) */
function expiryDay_(ms) {
  if (typeof cashBizDay_ === 'function') return cashBizDay_(ms);
  return Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM-dd');
}
function expiryAddDays_(key, n) {
  var d = new Date(key + 'T12:00:00+07:00');
  return Utilities.formatDate(new Date(d.getTime() + n * 86400000), TZ, 'yyyy-MM-dd');
}
function expiryDM_(key) {
  var p = String(key).split('-');
  return Number(p[2]) + '/' + Number(p[1]) + '/' + p[0];
}

/**
 * ของที่สาขาแต่ละชุด เข้ามาเมื่อไหร่ เหลือเท่าไหร่ — ไล่ตามเวลาแบบเข้าก่อนออกก่อน
 *   ของเข้าร้าน     = ชุดใหม่ วันที่ของเข้า
 *   ของเสีย / ขาย   = ตัดชุดเก่าสุดก่อน (นับได้น้อยกว่าที่มี = ขายไป)
 *   นับได้มากกว่า   = ของเข้าที่ไม่ได้ลง → ถือว่าเข้าวันที่นับเจอ (ไม่ให้ของใหม่โดนสั่งทิ้ง)
 * เริ่มจากวันเริ่มนับของสาขา (ยอดฐาน) — ก่อนนั้นไม่เอามาคิด
 */
function branchLots_(loc, itemName, uptoMs) {
  var start = (typeof costStartDate_ === 'function') ? costStartDate_(loc) : 0;
  var ev = [];
  function add(sheet, type, step) {
    readMoves_(sheet).forEach(function (m) {
      if (m.loc !== loc || m.item !== itemName) return;
      if (type === 'count' && typeof KIND_LEVEL_COUNT === 'string' && m.kind === KIND_LEVEL_COUNT) return;
      if (type === 'in' && m.kind && m.kind !== 'ของเข้าร้าน') return;
      var t = timeOf_(m.when);
      if (!t || (start && t < start) || t > uptoMs + 60000) return;
      ev.push({ t: t, type: type, step: step, qty: Number(m.qty) || 0 });
    });
  }
  add(SHEET_INCOMING, 'in', 1);
  add(SHEET_WASTE, 'waste', 2);
  add(SHEET_COUNT, 'count', 3);
  ev.sort(function (a, b) { return (a.t - b.t) || (a.step - b.step); });

  var lots = [];
  var total = function () { return lots.reduce(function (s, l) { return s + l.qty; }, 0); };
  var takeOld = function (q) {
    while (q > 0.0001 && lots.length) {
      var n = Math.min(lots[0].qty, q);
      lots[0].qty -= n; q -= n;
      if (lots[0].qty <= 0.0001) lots.shift();
    }
  };
  ev.forEach(function (e) {
    if (e.type === 'in') { if (e.qty > 0) lots.push({ t: e.t, qty: e.qty }); }
    else if (e.type === 'waste') takeOld(e.qty);
    else {
      var have = total();
      if (e.qty < have - 0.0001) takeOld(have - e.qty);
      else if (e.qty > have + 0.0001) lots.push({ t: e.t, qty: e.qty - have, found: true });
    }
  });
  return lots;
}

/**
 * นับสต็อกสาขาเสร็จ → ของที่ยังเหลือ และวันนี้เป็นวันสุดท้ายที่ขายได้ (หรือเลยมาแล้ว)
 * counts = [{ item, counted }] จาก handleStockCount_ · คืน [{ item, qty, toss, last, arrived, days }]
 */
function expiryAfterCount_(loc, counts, now) {
  var central = (typeof CENTRAL === 'string' && CENTRAL) ? CENTRAL : CENTRAL_NAME;
  if (!loc || loc === central) return [];
  var ms = (now || new Date()).getTime(), today = expiryDay_(ms), out = [];
  (counts || []).forEach(function (c) {
    var it = c.item, days = branchShelfDays_(it);
    if (!days || !(c.counted > 0)) return;
    var due = 0, last = '', arrived = '';
    branchLots_(loc, it.name, ms).forEach(function (l) {
      var a = expiryDay_(l.t), lastSell = expiryAddDays_(a, days);
      if (lastSell > today) return;
      due += l.qty;
      if (!last || lastSell < last) { last = lastSell; arrived = a; }
    });
    due = Math.min(Math.round(due * 1000) / 1000, c.counted);
    if (due > 0) out.push({ item: it, qty: due, last: last, toss: expiryAddDays_(last, 1),
                            arrived: arrived, days: days });
  });
  return out;
}

/** ข้อความแจ้งพนักงาน (หน้าเว็บ + กลุ่มไลน์สาขา) */
function expiryText_(loc, list, now) {
  var today = expiryDay_((now || new Date()).getTime());
  var L = ['🗑️ ของที่ต้องทิ้งก่อนขาย — ' + loc];
  list.forEach(function (x) {
    var q = (typeof fmtPack_ === 'function') ? fmtPack_(x.qty, x.item) : x.qty + ' ' + x.item.subUnit;
    var when = x.toss > today ? 'ทิ้งวันที่ ' + expiryDM_(x.toss) + ' ก่อนขาย'
                              : 'ทิ้งเลยก่อนขาย (ครบกำหนดทิ้ง ' + expiryDM_(x.toss) + ')';
    L.push('• ' + x.item.name + ' ' + q + ' — ' + when +
           ' (เข้า ' + expiryDM_(x.arrived) + ' อยู่ได้ ' + x.days + ' วัน)');
  });
  L.push('', 'ทิ้งแล้วลง "ของเสีย" ในหน้าสต็อกด้วย');
  return L.join('\n');
}

// ============================================================
// 4) เบเกอรี่ — อายุตามชุด ข้ามจากครัวกลางไปสาขา
// ============================================================
//   บราวนี่  14 วัน นับจากวันที่เข้าครัวกลาง
//   ไดฟุกุ   30 วัน นับจาก "วันเข้า" ที่กรอกตอนรับเข้า
//   ถึงสาขาแล้ว 7 วัน แต่ไม่เกินอายุเดิม (ส่งไปตอนใกล้หมดอายุ ก็หมดตามเดิม)
//   ขายหมดก่อน = ไม่แจ้ง

/** วันที่ในช่องวันเริ่มนับอายุ → 'yyyy-MM-dd' */
function bakeryStartKey_(v) {
  if (!v) return '';
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  var t = String(v).trim(), m;
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) {
    var y = Number(m[3]); if (y > 2400) y -= 543;
    return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  }
  return '';
}

/**
 * ชุดเบเกอรี่ที่ยังเหลือแต่ละที่ { loc: [{ qty, last, from }] } — last = วันสุดท้ายที่ขายได้
 * รับเข้าครัวกลาง → ชุดใหม่ · ส่งร้าน → ยกชุดเก่าสุดของครัวกลางไป อายุ = min(เดิม, ถึงร้าน + 7)
 * ของเสีย / ขาย (นับได้น้อยลง) → ตัดชุดเก่าสุด · นับได้เกิน → ชุดใหม่นับจากวันที่นับเจอ
 */
function bakeryLots_(itemName, uptoMs) {
  var central = (typeof CENTRAL === 'string' && CENTRAL) ? CENTRAL : CENTRAL_NAME;
  var origin = bakeryOriginDays_(itemName), ev = [];
  readMoves_(SHEET_INCOMING).forEach(function (m) {
    if (m.item !== itemName) return;
    var t = timeOf_(m.when);
    if (!t || t > uptoMs + 60000 || !(m.qty > 0)) return;
    if (m.kind === 'ของเข้าร้าน' && m.loc !== central) ev.push({ t: t, step: 2, type: 'send', loc: m.loc, qty: m.qty });
    else ev.push({ t: t, step: 1, type: 'in', loc: m.loc, qty: m.qty, start: bakeryStartKey_(m.start) });
  });
  readMoves_(SHEET_WASTE).forEach(function (m) {
    var t = timeOf_(m.when);
    if (m.item === itemName && t && t <= uptoMs + 60000) ev.push({ t: t, step: 3, type: 'waste', loc: m.loc, qty: m.qty });
  });
  readMoves_(SHEET_COUNT).forEach(function (m) {
    var t = timeOf_(m.when);
    if (m.item !== itemName || !t || t > uptoMs + 60000) return;
    if (typeof KIND_LEVEL_COUNT === 'string' && m.kind === KIND_LEVEL_COUNT) return;
    ev.push({ t: t, step: 4, type: 'count', loc: m.loc, qty: m.qty });
  });
  ev.sort(function (a, b) { return (a.t - b.t) || (a.step - b.step); });

  var lots = {};
  var box = function (loc) { return lots[loc] || (lots[loc] = []); };
  var total = function (loc) { return box(loc).reduce(function (s, l) { return s + l.qty; }, 0); };
  var take = function (loc, q) {
    var a = box(loc), parts = [];
    while (q > 0.0001 && a.length) {
      var n = Math.min(a[0].qty, q);
      parts.push({ qty: n, last: a[0].last, from: a[0].from });
      a[0].qty -= n; q -= n;
      if (a[0].qty <= 0.0001) a.shift();
    }
    return { parts: parts, short: q > 0.0001 ? q : 0 };
  };
  var life = function (loc, day) {
    return expiryAddDays_(day, loc === central ? origin : BAKERY_BRANCH_DAYS);
  };
  ev.forEach(function (e) {
    var day = expiryDay_(e.t);
    if (e.type === 'in') {
      var st = e.start || day;
      box(e.loc).push({ qty: e.qty, last: expiryAddDays_(st, origin), from: st });
    } else if (e.type === 'send') {
      var cap = expiryAddDays_(day, BAKERY_BRANCH_DAYS);
      var tk = take(central, e.qty);
      tk.parts.forEach(function (pt) {
        box(e.loc).push({ qty: pt.qty, last: pt.last < cap ? pt.last : cap, from: pt.from });
      });
      if (tk.short) box(e.loc).push({ qty: tk.short, last: cap, from: day });
    } else if (e.type === 'waste') {
      take(e.loc, e.qty);
    } else {
      var have = total(e.loc);
      if (e.qty < have - 0.0001) take(e.loc, have - e.qty);
      else if (e.qty > have + 0.0001) box(e.loc).push({ qty: e.qty - have, last: life(e.loc, day), from: day, found: true });
    }
  });
  return lots;
}

/** เบเกอรี่ที่ยังเหลือที่นี่ และวันนี้ขายได้เป็นวันสุดท้าย (หรือเลยมาแล้ว) */
function bakeryExpiryAt_(loc, nowMs) {
  if (typeof BAKERY_ITEMS === 'undefined') return [];
  var today = expiryDay_(nowMs), out = [];
  BAKERY_ITEMS.forEach(function (b) {
    var due = 0, last = '';
    (bakeryLots_(b[0], nowMs)[loc] || []).forEach(function (l) {
      if (l.last > today || !(l.qty > 0)) return;
      due += l.qty;
      if (!last || l.last < last) last = l.last;
    });
    due = Math.round(due * 1000) / 1000;
    if (due > 0) out.push({ name: b[0], qty: due, last: last, toss: expiryAddDays_(last, 1) });
  });
  return out;
}

function bakeryExpiryText_(loc, list, nowMs) {
  var today = expiryDay_(nowMs);
  var L = ['🗑️ เบเกอรี่หมดอายุ — ' + loc];
  list.forEach(function (x) {
    L.push('• ' + x.name + ' ' + x.qty + ' ชิ้น — ' +
           (x.toss > today ? 'ทิ้งวันที่ ' + expiryDM_(x.toss) + ' ก่อนขาย'
                           : 'ทิ้งเลย (หมดอายุ ' + expiryDM_(x.last) + ')'));
  });
  L.push('', 'ทิ้งแล้วลง "ของเสีย" ในหน้าสต็อกด้วย');
  return L.join('\n');
}

/** ครัวกลาง — เช็ควันละครั้ง (หลัง 8 โมง) อาศัย trigger เช็คของเข้าทุก 5 นาที */
function checkBakeryExpiryDaily(now) {
  if (typeof BAKERY_ITEMS === 'undefined') return false;
  var d = now || new Date();
  if (Number(Utilities.formatDate(d, TZ, 'HH')) < 8) return false;
  var props = PropertiesService.getScriptProperties();
  var key = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  if (props.getProperty('BAKERY_EXPIRY_LAST') === key) return false;
  props.setProperty('BAKERY_EXPIRY_LAST', key);
  var central = (typeof CENTRAL === 'string' && CENTRAL) ? CENTRAL : CENTRAL_NAME;
  // เช็คทุกวัน แต่แจ้งเฉพาะชุดที่ยังไม่เคยแจ้ง — ไม่มีของต้องทิ้ง / ส่งร้านหมดแล้ว = เงียบ
  // ชุดเดิมที่แจ้งไปแล้ว (รายการ|วันหมดอายุ) ไม่แจ้งซ้ำทุกวัน
  var sent = {};
  try { sent = JSON.parse(props.getProperty('BAKERY_EXPIRY_SENT') || '{}') || {}; } catch (e) {}
  var list = bakeryExpiryAt_(central, d.getTime()).filter(function (x) { return !sent[x.name + '|' + x.last]; });
  if (!list.length) return false;
  if (typeof stockNotify_ === 'function') stockNotify_(central, bakeryExpiryText_(central, list, d.getTime()));
  list.forEach(function (x) { sent[x.name + '|' + x.last] = key; });
  // เก็บแค่ 60 วันล่าสุด
  var old = expiryAddDays_(key, -60);
  Object.keys(sent).forEach(function (k) { if (sent[k] < old) delete sent[k]; });
  props.setProperty('BAKERY_EXPIRY_SENT', JSON.stringify(sent));
  return true;
}

/** ลองดูจากยอดนับล่าสุดของสาขา โดยไม่ส่งไลน์ (ผลอยู่ใน Logs) */
function previewDiscard() {
  var groups = (typeof stockLineGroups_ === 'function') ? stockLineGroups_() : lineGroups_();
  Object.keys(groups).forEach(function (loc) {
    if (isCentral_(loc)) return;
    var last = 0, qty = {};
    readMoves_(SHEET_COUNT).forEach(function (m) {
      if (m.loc !== loc || m.kind === KIND_LEVEL_COUNT) return;
      var t = timeOf_(m.when);
      if (t > last + 60000) { last = t; qty = {}; }
      if (Math.abs(t - last) <= 60000) qty[m.item] = Number(m.qty) || 0;
    });
    if (!last) return;
    var counts = Object.keys(qty).map(function (n) { return { item: findStockItem_(n), counted: qty[n] }; })
      .filter(function (c) { return c.item; });
    var list = expiryAfterCount_(loc, counts, new Date(last));
    Logger.log(list.length ? expiryText_(loc, list, new Date(last)) : loc + ' — ยอดนับล่าสุดไม่มีของต้องทิ้ง');
  });
}

/**
 * ส่งข้อความผ่าน LINE Messaging API
 * ต้องตั้ง Script Properties: LINE_CHANNEL_ACCESS_TOKEN
 *
 * ลำดับการเลือกปลายทาง:
 *  1. targetId ที่ส่งเข้ามา (เช่น Group ID ของกลุ่มสาขา จาก BRANCH_LINE_GROUPS)
 *  2. ถ้าไม่มี → ใช้ LINE_TARGET_ID จาก Script Properties
 *  3. ถ้าไม่มีอีก → broadcast: ส่งหา "ทุกคนที่แอดบอทเป็นเพื่อน"
 */
function sendLine_(text, targetId) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  var to    = targetId || props.getProperty('LINE_TARGET_ID');
  if (!token) {
    throw new Error('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN ใน Script Properties (ดู README.md)');
  }

  // ไม่รู้ปลายทาง = ข้ามไป ห้าม broadcast เด็ดขาด
  // broadcast ส่งหาเพื่อนของ OA ทุกคน ลูกค้าจะได้ข้อความสต็อกภายในร้านไปด้วย
  if (!to) {
    Logger.log('ข้ามการแจ้ง — ยังไม่ได้ตั้ง Group ID ปลายทาง\n' + text);
    return;
  }
  var url  = 'https://api.line.me/v2/bot/message/push';
  var body = { to: to, messages: [{ type: 'text', text: text }] };

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('ส่ง LINE ไม่สำเร็จ (' + res.getResponseCode() + '): ' + res.getContentText());
  }
}

// ============================================================
// เครื่องมือช่วยติดตั้ง / ทดสอบ  (รันจากเมนู Run ใน Apps Script)
// ============================================================

/**
 * รันครั้งเดียวเพื่อตั้ง Trigger ทั้ง 2 ตัว:
 *  - เช็คของเข้าใหม่ทุก INCOMING_POLL_MINUTES นาที → แจ้ง LINE ทันทีที่มีของเข้า
 *  - แจ้งของครบกำหนดทิ้งทุกวันตอนประมาณ NOTIFY_HOUR น. (19 = 1 ทุ่ม)
 * (ถ้าแก้เวลา ให้รันฟังก์ชันนี้ซ้ำอีกครั้ง)
 */
function setupTriggers() {
  // ลบ trigger เก่าของสคริปต์นี้ก่อน กันซ้ำ
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var f = t.getHandlerFunction();
    if (f === 'notifyExpiringItems' || f === 'checkNewIncoming') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('notifyExpiringItems')
    .timeBased()
    .everyDays(1)
    .atHour(NOTIFY_HOUR)
    .create();
  ScriptApp.newTrigger('checkNewIncoming')
    .timeBased()
    .everyMinutes(INCOMING_POLL_MINUTES)
    .create();
  // จำตำแหน่งแถวปัจจุบันของชีตของเข้า จะได้ไม่ย้อนแจ้งข้อมูลเก่า
  var sheet = ss_().getSheetByName(INCOMING_SHEET_NAME);
  if (sheet) {
    PropertiesService.getScriptProperties().setProperty(PROP_LAST_ROW, String(sheet.getLastRow()));
  }
  Logger.log('ตั้ง Trigger เรียบร้อย: เช็คของเข้าใหม่ทุก ' + INCOMING_POLL_MINUTES +
             ' นาที + แจ้งของครบกำหนดทุกวันประมาณ ' + NOTIFY_HOUR + ':00 น.');
}

// ชื่อเดิม เผื่อเคยตั้งไว้แล้ว — เรียกตัวใหม่ให้เลย
function setupDailyTrigger() { setupTriggers(); }

/**
 * ทดสอบส่งข้อความเข้า LINE (เช็คว่า token ถูกต้อง — ส่งไปปลายทางกลาง)
 */
function testLineConnection() {
  var props  = PropertiesService.getScriptProperties();
  var token  = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  var groups = lineGroups_();
  var names  = Object.keys(groups).filter(function (b) { return String(groups[b] || '').trim(); });

  Logger.log('Token: ' + (token ? 'ตั้งค่าแล้ว' : '❌ ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN'));
  Logger.log('ชีต: ' + (function () {
    try { return ss_().getName(); } catch (e) { return '❌ ' + e.message; }
  })());

  if (!names.length) {
    Logger.log('❌ ยังไม่ได้ตั้ง LINE_GROUPS — ไปที่ โปรเจกต์ > การตั้งค่าสคริปต์ > คุณสมบัติสคริปต์\n' +
               '   ใส่ LINE_GROUPS = {"ครัวกลาง":"Cxxxx","ตลาดทรัพย์พัฒนา":"Cyyyy"}');
    return;
  }
  names.forEach(function (b) {
    sendLine_('✅ ทดสอบ: กลุ่มนี้จะได้รับแจ้งเตือนสต็อกของ "' + b + '"', groups[b]);
    Logger.log('ส่งทดสอบเข้ากลุ่ม "' + b + '" แล้ว');
  });
  Logger.log('เช็คใน LINE ได้เลย — ส่งไป ' + names.length + ' กลุ่ม');
}

/** ดูว่าตอนนี้ตั้ง Group ID ไว้กี่กลุ่ม โดยไม่ส่งข้อความจริง */
function showLineGroups() {
  var groups = lineGroups_();
  var keys = Object.keys(groups);
  if (!keys.length) { Logger.log('ยังไม่ได้ตั้ง LINE_GROUPS'); return; }
  keys.forEach(function (b) {
    var id = String(groups[b] || '').trim();
    Logger.log((id ? '✅ ' : '⚠️ ') + b + ' → ' + (id ? id : 'ยังไม่ได้ใส่ Group ID (จะข้ามการแจ้ง)'));
  });
}

/**
 * ทดสอบรันแจ้งเตือนจริงทันที (ไม่ต้องรอ Trigger)
 */
function testNotifyNow() {
  previewDiscard();
}

/** ชื่อเดิม — ตอนนี้ดูของที่ต้องทิ้งจากยอดนับล่าสุดแทน */
function previewItems() {
  previewDiscard();
}

// ============================================================
// Date helpers — รองรับทั้ง Date object และข้อความวันที่แบบไทย
// เช่น "1/7/2569 13:45:00" (พ.ศ.) หรือ "1/7/2026, 13:45:00" (ค.ศ.)
// ============================================================

function parseThaiDate_(value) {
  if (value instanceof Date && !isNaN(value)) return value;
  var s = String(value || '').trim();
  if (!s) return null;
  var m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  var day = parseInt(m[1], 10), month = parseInt(m[2], 10), year = parseInt(m[3], 10);
  if (year > 2400) year -= 543; // แปลง พ.ศ. → ค.ศ.
  var d = new Date(year, month - 1, day);
  return isNaN(d) ? null : d;
}

function dateKey_(d)  { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }
function todayKey_()  { return dateKey_(new Date()); }
function keyToDate_(key) {
  var p = key.split('-');
  return new Date(parseInt(p[0],10), parseInt(p[1],10) - 1, parseInt(p[2],10));
}
function thaiDMY_(d) {
  return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
}

function findCol_(headers, candidates) {
  for (var i = 0; i < headers.length; i++) {
    for (var j = 0; j < candidates.length; j++) {
      if (headers[i].indexOf(candidates[j]) !== -1) return i;
    }
  }
  return -1;
}

// ============================================================
// เครื่องมือหา Group ID  (ใช้ชั่วคราวตอนตั้งค่ากลุ่มใหม่)
// ============================================================
//
// วิธีใช้ — ทำครั้งเดียวตอนจะเพิ่มกลุ่มใหม่
//   1) เชิญบอท (LINE OA) เข้ากลุ่มที่ต้องการก่อน
//   2) Deploy โปรเจกต์นี้เป็นเว็บแอป  (ทำให้ใช้งานได้ > ทำให้ใช้งานได้ใหม่
//      > ประเภท: เว็บแอป > ใครเข้าถึงได้: ทุกคน) แล้วคัดลอก URL
//   3) เอา URL ไปใส่เป็น Webhook URL ใน LINE Developers > Messaging API
//      แล้วเปิด "Use webhook"
//      ⚠️ ถ้าเดิมมี Webhook URL อยู่แล้ว จดของเดิมไว้ก่อน เสร็จแล้วใส่กลับ
//   4) พิมพ์ชื่อกลุ่มลงในกลุ่มนั้น เช่นพิมพ์คำว่า  ครัวกลาง
//   5) กลับมารันฟังก์ชัน showFoundGroups() แล้วดูใน บันทึกการดำเนินการ
//      จะเห็น Group ID คู่กับข้อความที่พิมพ์ไป
//   6) รัน setLineGroup('ครัวกลาง', 'Cxxxx...') เพื่อบันทึกลง LINE_GROUPS
//   7) เสร็จแล้ว ปิด Use webhook หรือใส่ Webhook URL เดิมกลับ
//      แล้วรัน clearFoundGroups() ล้างข้อมูลชั่วคราวทิ้ง
//
// 📥 ถ้าติดตั้ง line-intake.gs (ส่งไลน์แล้วบันทึกลงชีต) ไว้ด้วย ข้ามข้อ 7 ไป
//    อันนั้นต้องเปิด Use webhook ค้างไว้ตลอด และ Webhook URL ต้องชี้มาที่เว็บแอป
//    ของโปรเจกต์นี้อยู่แล้ว — ฟังก์ชันหา Group ID ด้านล่างทำงานคู่กันไปได้เลย

var PROP_FOUND = 'LINE_GROUPS_FOUND';

/**
 * รับ event จาก LINE แล้วจำ Group ID ของกลุ่มที่มีคนพิมพ์ข้อความ
 * ทำหน้าที่แค่จดบันทึก ไม่ตอบกลับ ไม่ส่งอะไรเข้ากลุ่ม
 */
// เดิมชื่อ doPost — เปลี่ยนชื่อเพื่อไม่ให้ชนกับ doPost ของ pos-backend.gs
// เวลาอยู่โปรเจกต์เดียวกัน doPost ใน pos-backend.gs จะเรียกฟังก์ชันนี้ให้เอง
function handleLineWebhook_(body) {
  try {
    var props = PropertiesService.getScriptProperties();
    var found = {};
    try { found = JSON.parse(props.getProperty(PROP_FOUND) || '{}'); } catch (err) {}

    (body.events || []).forEach(function (ev) {
      var src = ev.source || {};
      if (src.type !== 'group' || !src.groupId) return;
      found[src.groupId] = {
        at:   Utilities.formatDate(new Date(), TZ, 'd/M/yyyy HH:mm'),
        text: (ev.message && ev.message.text) ? String(ev.message.text).slice(0, 40) : ''
      };
    });
    props.setProperty(PROP_FOUND, JSON.stringify(found));
  } catch (err) {
    Logger.log('handleLineWebhook_: ' + err.message);
  }
  return ContentService.createTextOutput('OK');
}

/** ดู Group ID ที่จับได้ พร้อมข้อความที่พิมพ์ไว้ในกลุ่มนั้น */
function showFoundGroups() {
  var raw = PropertiesService.getScriptProperties().getProperty(PROP_FOUND);
  var found = {};
  try { found = JSON.parse(raw || '{}'); } catch (e) {}
  var ids = Object.keys(found);
  if (!ids.length) {
    Logger.log('ยังไม่เจอกลุ่มไหนเลย — เช็คว่า:\n' +
               '  • เชิญบอทเข้ากลุ่มแล้วหรือยัง\n' +
               '  • ตั้ง Webhook URL เป็น URL ของโปรเจกต์นี้ และเปิด Use webhook แล้วหรือยัง\n' +
               '  • พิมพ์ข้อความในกลุ่มหลังจากตั้ง webhook แล้วหรือยัง');
    return;
  }
  Logger.log('เจอ ' + ids.length + ' กลุ่ม:');
  ids.forEach(function (id) {
    var f = found[id];
    Logger.log('  ' + id + (f.text ? '   ← พิมพ์ว่า "' + f.text + '"' : '') + '   (' + f.at + ')');
  });
  Logger.log('\nบันทึกด้วย:  setLineGroup(\'ครัวกลาง\', \'' + ids[ids.length - 1] + '\')');
}

/** บันทึก Group ID ลง LINE_GROUPS โดยไม่ทับกลุ่มอื่นที่ตั้งไว้แล้ว */
function setLineGroup(name, groupId) {
  name = String(name || '').trim();
  groupId = String(groupId || '').trim();
  if (!name || !groupId) { Logger.log('ใส่ให้ครบ: setLineGroup(\'ครัวกลาง\', \'Cxxxx\')'); return; }

  var props  = PropertiesService.getScriptProperties();
  var groups = lineGroups_();
  var next   = {};
  Object.keys(groups).forEach(function (k) { next[k] = groups[k]; });
  next[name] = groupId;
  props.setProperty('LINE_GROUPS', JSON.stringify(next));

  Logger.log('บันทึกแล้ว LINE_GROUPS = ' + JSON.stringify(next));
  Logger.log('ทุกไฟล์อยู่โปรเจกต์เดียวกันแล้ว ตั้งที่นี่ที่เดียวพอ');
  Logger.log('เช็คว่าส่งได้จริงด้วย testRemindNow');
}

/** ล้างข้อมูลชั่วคราวทิ้งเมื่อตั้งค่าเสร็จแล้ว */
function clearFoundGroups() {
  PropertiesService.getScriptProperties().deleteProperty(PROP_FOUND);
  Logger.log('ล้างแล้ว — ปิด Use webhook หรือใส่ Webhook URL เดิมกลับได้เลย');
}
