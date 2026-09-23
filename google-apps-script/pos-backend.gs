/**
 * ══════════════════════════════════════════════════════════════
 *  POS หม่าล่าหน้าแดง — Backend (Google Apps Script)
 *  ใช้คู่กับ pos.html (หน้าคิดเงิน) และ pos-dashboard.html (หน้าสรุปยอด)
 *
 *  วิธีติดตั้งดูที่ google-apps-script/POS-README.md
 *  สรุปสั้น ๆ: สร้าง Google Sheets ใหม่ → ส่วนขยาย → Apps Script →
 *  วางโค้ดนี้ → รันฟังก์ชัน setupPos ครั้งเดียว → Deploy เป็น Web app
 *  (Execute as: Me / Who has access: Anyone) → เอา URL ไปใส่ในเว็บ
 * ══════════════════════════════════════════════════════════════
 */

var TZ = 'Asia/Bangkok';

var SHEET_ORDERS   = 'POS_Orders';   // ข้อมูลการขายรายบิล
var SHEET_USERS    = 'ผู้ใช้งาน';     // username / password / ชื่อ / สาขา
var SHEET_SESSIONS = 'Sessions';     // token ที่ยัง login อยู่
var SHEET_DELIVERY = 'POS_Delivery'; // ออเดอร์เดลิเวอรี่ (แพลตฟอร์มเก็บเงินให้แล้ว)
var SHEET_EXPENSE  = 'POS_Expenses'; // เงินสดที่จ่ายออกจากร้าน เช่น ค่าที่ ค่าไม้เสียบ

// รุ่นของโค้ดหลังบ้าน — เปิด <url>/exec?action=version ในเบราว์เซอร์เพื่อดูว่า
// ที่ Deploy อยู่ตอนนี้เป็นรุ่นไหน ไม่ต้องเดาว่าวางโค้ดใหม่ไปแล้วหรือยัง
var BACKEND_VERSION = '2026-09-23 · เต้าหู้ปลาแผ่น + ฟักทองเป็นถุง';

var SESSION_HOURS = 26;              // token หมดอายุกี่ชั่วโมง
                                     // หน้าเว็บให้ล็อกอินวันละครั้ง (หมดอายุตี 4 ของวันถัดไป)
                                     // ช่วงห่างที่ยาวที่สุดคือเกือบ 24 ชม. ตั้ง 26 ไว้เผื่อ
                                     // ไม่ให้ฝั่ง Server หมดอายุก่อนจนเด้งออกกลางวันขาย
var MAMA_PRICES   = [10, 15, 20, 35, 45];
var STICK_PRICES  = [10, 15];

// สินค้าอื่นที่ขายเป็นชิ้น ไม่ใช่ไม้และไม่ใช่มาม่า
// เพิ่มรายการใหม่ได้ที่นี่ ต้องตรงกับ EXTRAS ใน pos.html
var EXTRAS = [
  { name: 'สาหร่ายแผ่น', price: 20 }
];

var DELIVERY_HEADERS = [
  'วันที่', 'เวลา', 'เลขที่ออเดอร์', 'สาขา', 'พนักงาน', 'รายการ', 'รวมจำนวน',
  'ของเพิ่ม', 'ข้อมูล', 'order_id'
];

// 'วิธีจ่าย' ต่อท้ายไว้ ไม่แทรกกลาง แถวเก่าที่ยังว่างถือเป็นเงินสด
var EXPENSE_HEADERS = [
  'วันที่', 'เวลา', 'เลขที่', 'สาขา', 'พนักงาน', 'ประเภท', 'รายละเอียด', 'จำนวนเงิน', 'order_id',
  'วิธีจ่าย'
];

// ประเภทค่าใช้จ่ายที่เลือกได้ ต้องตรงกับ EXPENSE_TYPES ใน pos.html
var EXPENSE_TYPES = ['ค่าที่', 'ค่าไม้เสียบ', 'ค่าแก๊ส', 'ค่าน้ำแข็ง', 'ค่าของสด', 'ค่าแรง', 'อื่น ๆ'];

var ORDER_HEADERS = [
  'วันที่', 'เวลา', 'เลขที่ออเดอร์', 'สาขา', 'พนักงาน',
  'ไม้ 10฿', 'ไม้ 15฿', 'รวมไม้', 'ยอดไม้',
  'มาม่า 10฿', 'มาม่า 15฿', 'มาม่า 20฿', 'มาม่า 35฿', 'มาม่า 45฿', 'รวมมาม่า', 'ยอดมาม่า',
  'ยอดรวม', 'ส่วนลด', 'ยอดสุทธิ',
  'น้ำซุป', 'ความเผ็ด', 'น้ำจิ้ม', 'จำนวนน้ำจิ้ม',
  'วิธีชำระเงิน', 'order_id',
  // ต่อท้ายไว้ ไม่แทรกกลาง เพื่อไม่ให้คอลัมน์ของข้อมูลเก่าเลื่อนความหมาย
  'ของอื่น', 'รวมของอื่น', 'ยอดของอื่น',
  'ใช้แต้ม (ไม้)', 'ส่วนลดแต้ม'
];

/**
 * เติมหัวตารางที่ยังไม่มีให้ชีตที่สร้างไว้ก่อนหน้า
 * เวลามีเมนูใหม่แล้วคอลัมน์เพิ่ม ชีตเก่าจะได้ใช้ต่อได้โดยไม่ต้องสร้างใหม่
 */
function ensureHeaders_(sheet, headers) {
  if (!sheet) return;
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  if (sheet.getLastRow() === 0) return;
  var head = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var missing = [];
  for (var i = 0; i < headers.length; i++) {
    if (String(head[i] || '').trim() !== headers[i]) missing.push(i);
  }
  if (!missing.length) return;
  // เขียนเฉพาะช่องที่ยังว่าง จะได้ไม่ไปทับชื่อคอลัมน์เดิมที่มีข้อมูลอยู่
  missing.forEach(function (i) {
    if (String(head[i] || '').trim() === '') {
      sheet.getRange(1, i + 1).setValue(headers[i])
        .setFontWeight('bold').setBackground('#fee2e2').setFontColor('#991b1b');
    }
  });
}

/** ความกว้างที่อ่านได้จริง — ชีตเก่าที่ยังไม่ถูกเติมคอลัมน์จะแคบกว่า headers */
function readWidth_(sheet, headers) {
  return Math.min(headers.length, sheet.getMaxColumns());
}

// ══════════════════════════════════════════════════════════════
//  ติดตั้งครั้งแรก — รันฟังก์ชันนี้ 1 ครั้ง
// ══════════════════════════════════════════════════════════════
function setupPos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var orders = getOrCreateSheet_(ss, SHEET_ORDERS);
  ensureHeaders_(orders, ORDER_HEADERS);
  if (orders.getLastRow() === 0) {
    orders.appendRow(ORDER_HEADERS);
    orders.getRange(1, 1, 1, ORDER_HEADERS.length)
      .setFontWeight('bold').setBackground('#fee2e2').setFontColor('#991b1b');
    orders.setFrozenRows(1);
  }

  var delivery = getOrCreateSheet_(ss, SHEET_DELIVERY);
  if (delivery.getLastRow() === 0) {
    delivery.appendRow(DELIVERY_HEADERS);
    delivery.getRange(1, 1, 1, DELIVERY_HEADERS.length)
      .setFontWeight('bold').setBackground('#fee2e2').setFontColor('#991b1b');
    delivery.setFrozenRows(1);
  }

  var expense = getOrCreateSheet_(ss, SHEET_EXPENSE);
  ensureHeaders_(expense, EXPENSE_HEADERS);
  if (expense.getLastRow() === 0) {
    expense.appendRow(EXPENSE_HEADERS);
    expense.getRange(1, 1, 1, EXPENSE_HEADERS.length)
      .setFontWeight('bold').setBackground('#fee2e2').setFontColor('#991b1b');
    expense.setFrozenRows(1);
  }

  var users = getOrCreateSheet_(ss, SHEET_USERS);
  if (users.getLastRow() === 0) {
    users.appendRow(['username', 'password', 'ชื่อ', 'สาขา', 'ใช้งาน', 'สิทธิ์']);
    users.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#fee2e2').setFontColor('#991b1b');
    users.setFrozenRows(1);
    users.appendRow(['owner', '1234', 'เจ้าของร้าน', 'ตลาดทรัพย์พัฒนา', 'ใช่', 'เจ้าของ']);
    users.appendRow(['staff1', '1234', 'พนักงานตลาดทรัพย์ฯ', 'ตลาดทรัพย์พัฒนา', 'ใช่', 'พนักงาน']);
    users.appendRow(['staff2', '1234', 'พนักงานแบริ่ง', 'แบริ่ง', 'ใช่', 'พนักงาน']);
  }

  var sessions = getOrCreateSheet_(ss, SHEET_SESSIONS);
  if (sessions.getLastRow() === 0) {
    sessions.appendRow(['token', 'username', 'ชื่อ', 'สาขา', 'เวลา login', 'ใช้งานล่าสุด', 'สิทธิ์']);
    sessions.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#e5e7eb');
    sessions.setFrozenRows(1);
  }

  SpreadsheetApp.getUi && Logger.log('ติดตั้งเรียบร้อย — อย่าลืม Deploy เป็น Web app');
  return 'ok';
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// ══════════════════════════════════════════════════════════════
//  Web app entry points
// ══════════════════════════════════════════════════════════════
function doPost(e) {
  cacheClear_();                 // เริ่มคำขอใหม่ ของที่จำไว้รอบก่อนใช้ไม่ได้
  try {
    var body = JSON.parse(e.postData.contents);

    // ถ้าโปรเจกต์นี้มีสคริปต์ LINE อยู่ด้วย ให้ส่งต่อ webhook ของ LINE ไปให้มัน
    // (Apps Script มี doPost ได้ตัวเดียวต่อโปรเจกต์ ตัวนี้จึงทำหน้าที่เป็นตัวแยกทาง)
    if (body.destination || body.events) {
      // line-expiry-alert.gs — จด Group ID ของกลุ่มที่มีคนพิมพ์ ไว้ใช้ตอนตั้งค่า
      if (typeof handleLineWebhook_ === 'function') {
        try { handleLineWebhook_(body); } catch (e) { Logger.log('handleLineWebhook_: ' + e.message); }
      }
      // line-intake.gs — อ่านข้อความ/รูปที่ส่งมา แล้วบันทึกลงชีต
      if (typeof handleLineIntake_ === 'function') return handleLineIntake_(body);

      // ไม่มี handleLineIntake_ = เวอร์ชันที่ deploy อยู่ถูกถ่ายไว้ตอนที่ยังไม่มี
      // line-intake.gs ในโปรเจกต์ ตรงนี้เคยตอบ 200 OK เปล่า ๆ แล้วจบ
      // LINE เห็นว่าส่งสำเร็จ ขึ้น "อ่านแล้ว" แต่ไม่มีอะไรเกิดขึ้น ไม่มี error ให้ดูด้วย
      // หาสาเหตุกันนานมาก จึงให้มันฟ้องกลับเข้าไลน์เลย จะได้รู้ตัวทันที
      try { lineIntakeMissing_(body); } catch (err) { Logger.log('lineIntakeMissing_: ' + err.message); }
      return ContentService.createTextOutput('OK');
    }

    switch (body.action) {
      case 'login':    return json_(handleLogin_(body));
      case 'logout':   return json_(handleLogout_(body));
      case 'posOrder':    return json_(handleOrder_(body));
      case 'posDelivery': return json_(handleDelivery_(body));
      case 'posBills':    return json_(handleBills_(body));
      case 'posExpense':  return json_(handleExpense_(body));
      case 'stockIn':     return json_(handleStockIn_(body));
      case 'stockToShop': return json_(handleStockToShop_(body));
      case 'stockWaste':  return json_(handleStockWaste_(body));
      case 'stockCount':  return json_(handleStockCount_(body));
      case 'stockPack':   return json_(handleStockPack_(body));
      default:         return json_({ success: false, message: 'ไม่รู้จัก action: ' + body.action });
    }
  } catch (err) {
    return json_({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
}

function doGet(e) {
  cacheClear_();
  try {
    var p = e.parameter || {};
    // ping เป็นชื่อพ้องของ version — เอกสารกับข้อความในไลน์อ้างถึงทั้งสองชื่อ
    if (p.action === 'version' || p.action === 'ping') return json_(handleVersion_());
    if (p.action === 'posStats') return json_(handleStats_(p));
    if (p.action === 'posBills') return json_(handleBills_(p));
    if (p.action === 'history')  return json_(handleHistory_(p));
    if (p.action === 'stockBootstrap') return json_(handleStockBootstrap_(p));
    return json_({ success: false, message: 'ไม่รู้จัก action: ' + p.action });
  } catch (err) {
    return json_({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
}

/**
 * บอกว่าโค้ดหลังบ้านที่ Deploy อยู่เป็นรุ่นไหน และมีชีตอะไรแล้วบ้าง
 * เปิดในเบราว์เซอร์ได้เลยไม่ต้อง login — ไม่คืนข้อมูลการขายหรือรหัสผ่านใด ๆ
 * ใช้เช็คหลัง Deploy ว่าวางโค้ดใหม่ครบแล้วจริง
 */
function handleVersion_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = {};
  [SHEET_ORDERS, SHEET_DELIVERY, SHEET_EXPENSE, SHEET_USERS, SHEET_SESSIONS]
    .forEach(function (n) { sheets[n] = !!ss.getSheetByName(n); });
  return {
    success: true,
    version: BACKEND_VERSION,
    actions: ['login', 'logout', 'posOrder', 'posDelivery', 'posBills', 'posExpense',
              'posStats', 'history', 'stockIn', 'stockToShop', 'stockWaste', 'stockCount',
              'stockPack', 'stockBootstrap'],
    expenseTypes: EXPENSE_TYPES,
    extras: EXTRAS.map(function (x) { return x.name + ' ' + x.price + '฿'; }),
    sheets: sheets,
    // ไฟล์ .gs อยู่โปรเจกต์เดียวกันหมด แต่ deployment เก่าอาจถ่ายไว้ตอนยังไม่มีบางไฟล์
    // ดูตรงนี้จะรู้ทันทีว่า "เวอร์ชันที่ deploy อยู่จริง" มีอะไรครบบ้าง
    // เคยเสียเวลาหาสาเหตุนานมากตอนที่ LINE ยิงเข้า deployment ที่ยังไม่มี line-intake.gs
    // แล้วมันตอบ 200 OK เปล่า ๆ บอทเลยเงียบโดยไม่มี error ให้ดู
    'ระบบที่เวอร์ชันนี้มี': {
      'POS · pos-backend.gs':            typeof handleOrder_        === 'function',
      'รับไลน์ · line-intake.gs':        typeof handleLineIntake_   === 'function',
      'บัญชี · accounting.gs':           typeof accMonthSummary_    === 'function',
      'แจ้งเตือน · line-expiry-alert.gs': typeof notifyExpiringItems === 'function',
      'เตือนนับสต็อก · stock-audit.gs':   typeof remindStockCount    === 'function'
    }
  };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * LINE ยิงมาถึงแล้ว แต่เวอร์ชันที่ deploy อยู่ไม่มี line-intake.gs
 * ตอบกลับเข้าไลน์ให้รู้ตัว ไม่งั้นจะเห็นแค่ "อ่านแล้ว" แล้วเงียบ ซึ่งหาสาเหตุยากมาก
 * เพราะทุกอย่างในหน้าแก้ไขดูถูกหมด แต่ URL ที่ LINE ใช้เสิร์ฟโค้ดเก่าอยู่
 *
 * ส่งครั้งเดียวต่อ 10 นาที ต่อให้พิมพ์รัว ๆ ก็ไม่สแปมกลุ่ม
 */
function lineIntakeMissing_(body) {
  var ev = (body && body.events || [])[0];
  if (!ev || !ev.replyToken) return;

  var token = PropertiesService.getScriptProperties()
                .getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) return;

  var cache = CacheService.getScriptCache();
  if (cache.get('intake_missing_warned')) return;
  cache.put('intake_missing_warned', '1', 600);

  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({
      replyToken: ev.replyToken,
      messages: [{ type: 'text', text:
        '⚠️ ข้อความมาถึงแล้ว แต่เวอร์ชันที่ deploy อยู่ยังไม่มีตัวอ่านข้อความ\n\n' +
        'URL ที่ LINE ใช้ ชี้ไปที่ deployment เก่าที่ถ่ายไว้ตอนยังไม่มี line-intake.gs\n\n' +
        'แก้แบบนี้\n' +
        '1. Apps Script → วาง line-intake.gs ให้ครบ แล้วกด Ctrl+S\n' +
        '2. ทำให้ใช้งานได้ → จัดการการทำให้ใช้งานได้ → ✏️\n' +
        '   เวอร์ชัน: "ใหม่" (ห้ามเลือกเลขเวอร์ชันเก่า) → ทำให้ใช้งานได้\n' +
        '3. เช็คด้วย <URL>?action=ping ต้องเห็น\n' +
        '   "รับไลน์ · line-intake.gs": true' }]
    }),
    muteHttpExceptions: true
  });
}

// ══════════════════════════════════════════════════════════════
//  Login / Session
// ══════════════════════════════════════════════════════════════
function handleLogin_(body) {
  var username = String(body.username || '').trim();
  var password = String(body.password || '');
  if (!username || !password) return { success: false, message: 'กรุณากรอก Username และ Password' };

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  if (!sheet) return { success: false, message: 'ยังไม่ได้ติดตั้งระบบ — รันฟังก์ชัน setupPos ก่อน' };

  var rows = sheet.getDataRange().getValues();

  // คนเดียวอาจมีหลายแถว เพราะทำทั้งสาขาและครัวกลาง เขียนแยกแถวไว้ในชีต
  // เก็บทุกแถวของ username นี้ แล้วรวมสาขาเข้าด้วยกัน
  var mine = [];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === username.toLowerCase()) mine.push(rows[i]);
  }
  if (!mine.length) return { success: false, message: 'Username หรือ Password ไม่ถูกต้อง' };

  var live = mine.filter(function (r) { return isActiveUser_(r[4]); });
  if (!live.length) return { success: false, message: 'บัญชีนี้ถูกปิดการใช้งาน' };

  // รหัสผ่านตรงกับแถวไหนก็ได้ในบรรดาแถวของตัวเอง (ปกติใส่รหัสเดียวกันทุกแถว)
  var row = null;
  for (var j = 0; j < live.length; j++) {
    if (passwordMatches_(password, String(live[j][1]))) { row = live[j]; break; }
  }
  if (!row) return { success: false, message: 'Username หรือ Password ไม่ถูกต้อง' };

  // สาขาที่ทำได้ = รวมจากทุกแถวที่เปิดใช้งาน ช่องเดียวใส่หลายชื่อคั่นด้วย , / | ก็ได้
  var locs = [];
  live.forEach(function (r) {
    splitLocs_(r[3]).forEach(function (l) { if (locs.indexOf(l) === -1) locs.push(l); });
  });
  // แถวไหนเป็นเจ้าของ ก็ถือว่าเป็นเจ้าของ
  var role = 'staff';
  live.forEach(function (r) { if (roleOf_(r[5]) === 'owner') role = 'owner'; });

  var token = Utilities.getUuid();
  var now = new Date();
  var joined = locs.join(', ');
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SESSIONS)
    .appendRow([token, row[0], row[2], joined, now, now, role]);
  cleanOldSessions_();
  return {
    success: true, token: token,
    name: String(row[2] || row[0]),
    branch: locs[0] || '',       // สาขาหลัก — โค้ดเดิมที่รู้จักช่องเดียวยังใช้ได้
    branches: locs,
    role: role
  };
}

/** ช่อง "ใช้งาน" ในชีตผู้ใช้งาน — เว้นว่างถือว่าใช้งานอยู่ */
function isActiveUser_(value) {
  var v = String(value === '' || value == null ? 'ใช่' : value).trim().toLowerCase();
  return !(v === 'ไม่' || v === 'no' || v === 'false');
}

/**
 * ช่อง "สาขา" → รายชื่อสถานที่
 * รองรับทั้งเขียนแยกแถว และเขียนรวมช่องเดียวคั่นด้วย , / | หรือขึ้นบรรทัดใหม่
 */
function splitLocs_(value) {
  return String(value == null ? '' : value)
    .split(/[,/|\n]+/)
    .map(function (x) { return x.trim(); })
    .filter(function (x) { return x; });
}

/**
 * สิทธิ์การใช้งาน — ใส่ในชีตผู้ใช้งานคอลัมน์ "สิทธิ์"
 * "เจ้าของ" (หรือ owner/admin/แอดมิน) = เห็นปุ่มตั้งค่าและหน้าสรุปยอด
 * ค่าอื่น ๆ หรือเว้นว่าง = พนักงาน คิดเงินได้อย่างเดียว
 */
function roleOf_(value) {
  var v = String(value || '').trim().toLowerCase();
  var owners = ['เจ้าของ', 'เจ้าของร้าน', 'owner', 'admin', 'แอดมิน', 'ผู้จัดการ', 'manager'];
  return owners.indexOf(v) >= 0 ? 'owner' : 'staff';
}

/** รองรับทั้งรหัสผ่านธรรมดา และแบบเข้ารหัส (ใส่ในชีตเป็น sha256:<hex>) */
function passwordMatches_(input, stored) {
  stored = String(stored);
  if (stored.indexOf('sha256:') === 0) return sha256_(input) === stored.substring(7).toLowerCase();
  return input === stored;
}

function sha256_(text) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/** เอาไว้สร้างค่า sha256:... สำหรับใส่ในชีต — รันแล้วดูใน Log */
function makeHashedPassword() {
  Logger.log('sha256:' + sha256_('1234'));
}

function handleLogout_(body) {
  var token = String(body.token || '');
  if (!token) return { success: true };
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SESSIONS);
  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === token) { sheet.deleteRow(i + 1); break; }
  }
  return { success: true };
}

/** คืนข้อมูล session ถ้า token ยังใช้ได้ ไม่งั้นคืน null */
function checkToken_(token) {
  if (!token) return null;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SESSIONS);
  if (!sheet) return null;
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(token)) continue;
    var created = new Date(rows[i][4]);
    if ((new Date() - created) > SESSION_HOURS * 3600 * 1000) { sheet.deleteRow(i + 1); return null; }
    // อัปเดต "ใช้งานล่าสุด" แค่ทุก 5 นาทีพอ — การเขียนชีตทุกครั้งที่เรียก API
    // ทำให้ทุกคำขอช้าขึ้นโดยไม่จำเป็น (ค่านี้ใช้ดูเฉย ๆ ไม่ได้ใช้ตัดสิน session)
    var seen = rows[i][5] ? new Date(rows[i][5]) : null;
    if (!seen || isNaN(seen.getTime()) || (new Date() - seen) > 5 * 60 * 1000) {
      sheet.getRange(i + 1, 6).setValue(new Date());
    }
    var locs = splitLocs_(rows[i][3]);
    return {
      username: rows[i][1], name: rows[i][2],
      branch: locs[0] || '', branches: locs,
      role: rows[i][6] === 'owner' ? 'owner' : 'staff'
    };
  }
  return null;
}

function cleanOldSessions_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SESSIONS);
  var rows = sheet.getDataRange().getValues();
  var limit = SESSION_HOURS * 3600 * 1000;
  for (var i = rows.length - 1; i >= 1; i--) {
    if ((new Date() - new Date(rows[i][4])) > limit) sheet.deleteRow(i + 1);
  }
}

// ══════════════════════════════════════════════════════════════
//  บันทึกการขาย
// ══════════════════════════════════════════════════════════════
function handleOrder_(body) {
  var session = checkToken_(body.token);
  if (!session) return { success: false, code: 401, message: 'Session หมดอายุ กรุณา Login ใหม่' };

  var o = body.order || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ORDERS);
    if (!sheet) return { success: false, message: 'ไม่พบชีต ' + SHEET_ORDERS + ' — รัน setupPos ก่อน' };

    // กันบันทึกซ้ำ: ออเดอร์ที่ค้างในเครื่อง (เน็ตหลุด) อาจถูกส่งซ้ำ
    var existing = findOrderRow_(sheet, o.orderId);
    if (existing) return { success: true, orderNo: existing, duplicated: true };

    var now = new Date();
    var stickQty = {}; STICK_PRICES.forEach(function (p) { stickQty[p] = 0; });
    (o.sticks || []).forEach(function (s) { stickQty[s.price] = Number(s.qty) || 0; });

    var mamaQty = {}; MAMA_PRICES.forEach(function (p) { mamaQty[p] = 0; });
    (o.mama || []).forEach(function (m) { mamaQty[m.price] = Number(m.qty) || 0; });

    // ของอื่น เก็บเป็นข้อความสรุปช่องเดียว เพิ่มเมนูใหม่แล้วไม่ต้องเพิ่มคอลัมน์อีก
    var extraText = [], extraCount = 0, extraAmount = 0;
    (o.extras || []).forEach(function (x) {
      var q = Number(x.qty) || 0;
      if (q <= 0) return;
      extraText.push(x.name + ' x' + q);
      extraCount += q;
      extraAmount += q * (Number(x.price) || 0);
    });
    if (o.extraCount !== undefined) extraCount = Number(o.extraCount) || 0;
    if (o.extraAmount !== undefined) extraAmount = Number(o.extraAmount) || 0;

    ensureHeaders_(sheet, ORDER_HEADERS);


    var row = [
      Utilities.formatDate(now, TZ, 'yyyy-MM-dd'),
      Utilities.formatDate(now, TZ, 'HH:mm:ss'),
      '',                                   // เลขที่ออเดอร์ — เติมด้านล่าง
      o.branch || session.branch || '',
      o.staff || session.name || ''
    ];
    STICK_PRICES.forEach(function (p) { row.push(stickQty[p]); });
    row.push(Number(o.stickCount) || 0, Number(o.stickAmount) || 0);
    MAMA_PRICES.forEach(function (p) { row.push(mamaQty[p]); });
    row.push(Number(o.mamaCount) || 0, Number(o.mamaAmount) || 0);
    row.push(Number(o.subtotal) || 0, Number(o.discount) || 0, Number(o.total) || 0);
    row.push(o.soup || '', o.spice || '', o.sauce || '', Number(o.sauceCount) || 0,
             o.method || '', o.orderId || '');
    row.push(extraText.join(', '), extraCount, extraAmount);
    // ลูกค้าเอาแต้มมาแลกไม้ฟรี — เก็บทั้งจำนวนไม้และเงินที่หักไป
    row.push(Number(o.redeemSticks) || 0, Number(o.redeemAmount) || 0);

    var orderNo = nextOrderNo_(sheet, row[0]);
    row[2] = orderNo;
    sheet.appendRow(row);
    return { success: true, orderNo: orderNo };
  } finally {
    lock.releaseLock();
  }
}

/**
 * บันทึกออเดอร์เดลิเวอรี่ — ไม่มีการคิดเงินหน้าร้าน
 * (เงินเข้าทางแพลตฟอร์ม จึงเก็บแยกชีตไม่ให้ปนกับยอดขายหน้าร้าน)
 */
function handleDelivery_(body) {
  var session = checkToken_(body.token);
  if (!session) return { success: false, code: 401, message: 'Session หมดอายุ กรุณา Login ใหม่' };

  var o = body.order || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DELIVERY);
    if (!sheet) return { success: false, message: 'ไม่พบชีต ' + SHEET_DELIVERY + ' — รัน setupPos ก่อน' };

    var existing = findRowByOrderId_(sheet, o.orderId, DELIVERY_HEADERS);
    if (existing) return { success: true, orderNo: existing, duplicated: true };

    var now = new Date();
    var dateStr = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
    var orderNo = nextOrderNo_(sheet, dateStr, 'D');

    sheet.appendRow([
      dateStr,
      Utilities.formatDate(now, TZ, 'HH:mm:ss'),
      orderNo,
      o.branch || session.branch || '',
      o.staff || session.name || '',
      o.summary || '',
      Number(o.itemCount) || 0,
      Number(o.addonCount) || 0,
      JSON.stringify(o.items || []),
      o.orderId || ''
    ]);
    return { success: true, orderNo: orderNo };
  } finally {
    lock.releaseLock();
  }
}

/**
 * บันทึกเงินสดที่จ่ายออกจากร้าน เช่น ค่าที่ ค่าไม้เสียบ
 * เก็บแยกชีต ไม่ปนกับยอดขาย แล้วค่อยเอาไปหักตอนสรุปเงินสดปลายวัน
 */
function handleExpense_(body) {
  var session = checkToken_(body.token);
  if (!session) return { success: false, code: 401, message: 'Session หมดอายุ กรุณา Login ใหม่' };

  var e = body.expense || {};
  var amount = num_(e.amount);
  if (!(amount > 0)) return { success: false, message: 'จำนวนเงินต้องมากกว่า 0' };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // สร้างชีตให้เองถ้ายังไม่มี — ไม่งั้นเงินที่จ่ายไปแล้วจะค้างอยู่ในเครื่อง
    // รอส่งไปเรื่อย ๆ โดยไม่มีวันสำเร็จ เพราะปลายทางไม่มีที่ให้ลง
    var sheet = getOrCreateSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEET_EXPENSE);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(EXPENSE_HEADERS);
      sheet.getRange(1, 1, 1, EXPENSE_HEADERS.length)
        .setFontWeight('bold').setBackground('#fee2e2').setFontColor('#991b1b');
      sheet.setFrozenRows(1);
    }
    ensureHeaders_(sheet, EXPENSE_HEADERS);

    var existing = findRowByOrderId_(sheet, e.expenseId, EXPENSE_HEADERS);
    if (existing) return { success: true, orderNo: existing, duplicated: true };

    var now = new Date();
    var dateStr = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
    var no = nextOrderNo_(sheet, dateStr, 'E');

    sheet.appendRow([
      dateStr,
      Utilities.formatDate(now, TZ, 'HH:mm:ss'),
      no,
      e.branch || session.branch || '',
      e.staff || session.name || '',
      e.type || 'อื่น ๆ',
      e.note || '',
      amount,
      e.expenseId || '',
      e.method || 'เงินสด'
    ]);
    return { success: true, orderNo: no };
  } finally {
    lock.releaseLock();
  }
}

/** เลขที่ออเดอร์ = วันที่ + ลำดับของวันนั้น เช่น 20260823-014 */
function nextOrderNo_(sheet, dateStr, prefix) {
  var last = sheet.getLastRow();
  var count = 0;
  if (last > 1) {
    var dates = sheet.getRange(2, 1, last - 1, 1).getDisplayValues();
    for (var i = 0; i < dates.length; i++) if (dates[i][0] === dateStr) count++;
  }
  return (prefix || '') + dateStr.replace(/-/g, '') + '-' + ('00' + (count + 1)).slice(-3);
}

/** หาแถวที่เคยบันทึก order_id นี้ไว้แล้ว (กันบันทึกซ้ำตอนส่งของค้างขึ้นไป) */
function findRowByOrderId_(sheet, orderId, headers) {
  if (!orderId) return null;
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var col = headers.indexOf('order_id') + 1;
  var ids = sheet.getRange(2, col, last - 1, 1).getDisplayValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (ids[i][0] === String(orderId)) return sheet.getRange(i + 2, 3).getDisplayValue();
  }
  return null;
}

function findOrderRow_(sheet, orderId) { return findRowByOrderId_(sheet, orderId, ORDER_HEADERS); }

// ══════════════════════════════════════════════════════════════
//  สรุปยอดสำหรับหน้า Dashboard
// ══════════════════════════════════════════════════════════════
function handleStats_(p) {
  var session = checkToken_(p.token);
  if (!session) return { success: false, code: 401, message: 'Session หมดอายุ กรุณา Login ใหม่' };
  if (session.role !== 'owner') {
    return { success: false, code: 403, message: 'หน้าสรุปยอดสำหรับเจ้าของร้านเท่านั้น' };
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ORDERS);
  if (!sheet || sheet.getLastRow() < 2) {
    var only = emptyStats_();
    addDeliveryStats_(only, p.from || '0000-01-01', p.to || '9999-12-31', p.branch || '');
    addExpenseStats_(only, p.from || '0000-01-01', p.to || '9999-12-31', p.branch || '');
    return { success: true, data: only };
  }

  var values = sheet.getRange(1, 1, sheet.getLastRow(), readWidth_(sheet, ORDER_HEADERS)).getDisplayValues();
  var head = values[0];
  var idx = {};
  head.forEach(function (h, i) { idx[h] = i; });

  var from   = p.from || '0000-01-01';
  var to     = p.to   || '9999-12-31';
  var branch = p.branch || '';

  var stats = emptyStats_();
  var byDate = {};

  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    var date = normDate_(r[idx['วันที่']]);
    if (!date || date < from || date > to) continue;
    if (branch && !sameBranch_(r[idx['สาขา']], branch)) continue;

    var total    = num_(r[idx['ยอดสุทธิ']]);
    var discount = num_(r[idx['ส่วนลด']]);

    var hr = hourOf_(r[idx['เวลา']]);
    if (hr >= 0) { stats.byHour[hr].orders++; stats.byHour[hr].revenue += total; }

    stats.orders++;
    stats.revenue  += total;
    stats.discount += discount;
    stats.sticks   += num_(r[idx['รวมไม้']]);
    stats.redeemSticks += num_(r[idx['ใช้แต้ม (ไม้)']]);
    stats.redeemAmount += num_(r[idx['ส่วนลดแต้ม']]);
    stats.mama     += num_(r[idx['รวมมาม่า']]);

    bump_(stats.soup,   r[idx['น้ำซุป']]);
    bump_(stats.spice,  r[idx['ความเผ็ด']]);
    bump_(stats.method, r[idx['วิธีชำระเงิน']]);
    bump_(stats.sauce,  r[idx['น้ำจิ้ม']]);
    stats.sauceCups += num_(r[idx['จำนวนน้ำจิ้ม']]);   // รวมว่าให้น้ำจิ้มไปกี่ถ้วย
    bump_(stats.branch, r[idx['สาขา']]);
    addTo_(stats.methodRevenue, r[idx['วิธีชำระเงิน']], total);

    if (!byDate[date]) byDate[date] = { date: date, orders: 0, revenue: 0, sticks: 0 };
    byDate[date].orders++;
    byDate[date].revenue += total;
    byDate[date].sticks  += num_(r[idx['รวมไม้']]);
  }

  addDeliveryStats_(stats, from, to, branch);
  addExpenseStats_(stats, from, to, branch);

  stats.avgTicket = stats.orders ? Math.round(stats.revenue / stats.orders * 100) / 100 : 0;
  stats.byDate = Object.keys(byDate).sort().map(function (d) { return byDate[d]; });
  stats.branches = listBranches_(values, idx);
  return { success: true, data: stats };
}

/** สรุปออเดอร์เดลิเวอรี่ (เก็บแยกชีต ไม่รวมกับยอดขายหน้าร้าน) */
function addDeliveryStats_(stats, from, to, branch) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DELIVERY);
  if (!sheet || sheet.getLastRow() < 2) return;

  var values = sheet.getRange(1, 1, sheet.getLastRow(), DELIVERY_HEADERS.length).getDisplayValues();
  var idx = {};
  values[0].forEach(function (h, i) { idx[h] = i; });

  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    var date = normDate_(r[idx['วันที่']]);
    if (!date || date < from || date > to) continue;
    if (branch && !sameBranch_(r[idx['สาขา']], branch)) continue;

    var dhr = hourOf_(r[idx['เวลา']]);
    if (dhr >= 0 && stats.byHour && stats.byHour[dhr]) stats.byHour[dhr].delivery++;

    stats.deliveryOrders++;
    stats.deliveryItemCount += num_(r[idx['รวมจำนวน']]);
    stats.deliveryAddons += num_(r[idx['ของเพิ่ม']]);
    try {
      JSON.parse(r[idx['ข้อมูล']] || '[]').forEach(function (it) {
        addTo_(stats.deliveryItems, it.name, Number(it.qty) || 0);
      });
    } catch (e) {}
  }
}

/**
 * จ่ายด้วยเงินสดหน้าร้านไหม — คือหยิบเงินออกจากลิ้นชักจริง ๆ
 * ช่องว่าง = แถวเก่าก่อนมีคอลัมน์ "วิธีจ่าย" สมัยนั้นลงแต่เงินสด จึงถือเป็นเงินสด
 */
function isCashExpense_(method) {
  var m = String(method || '').trim();
  return m === '' || m === 'เงินสด';
}

/**
 * สรุปเงินที่จ่ายออกจากร้าน (ค่าที่ ค่าไม้เสียบ ฯลฯ)
 *
 * แยกเงินสดออกจากโอน/บัตร เพราะสองอย่างนี้คนละความหมายกัน
 *   เงินสด  = พนักงานหยิบเงินจากลิ้นชักไปจ่าย ตอนปิดร้านเงินในลิ้นชักจะหายไปเท่านั้น
 *   โอน/บัตร = จ่ายจากบัญชีหรือบัตร เงินในลิ้นชักไม่ได้ลดลงเลย
 * ถ้าเอามารวมกันแล้วหักออกจากยอดขายหมด ยอด "เงินสดคงเหลือ" จะต่ำกว่าความจริง
 * แล้วตอนปิดร้านจะนับเงินไม่ตรงกับที่ระบบบอก
 */
function addExpenseStats_(stats, from, to, branch) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_EXPENSE);
  if (!sheet || sheet.getLastRow() < 2) { stats.netCash = stats.revenue || 0; return; }

  var values = sheet.getRange(1, 1, sheet.getLastRow(), readWidth_(sheet, EXPENSE_HEADERS)).getDisplayValues();
  var idx = {};
  values[0].forEach(function (h, i) { idx[h] = i; });

  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    var date = normDate_(r[idx['วันที่']]);
    if (!date || date < from || date > to) continue;
    if (branch && !sameBranch_(r[idx['สาขา']], branch)) continue;

    var amt = num_(r[idx['จำนวนเงิน']]);
    var pay = (idx['วิธีจ่าย'] === undefined) ? '' : r[idx['วิธีจ่าย']];

    stats.expenseTotal += amt;
    stats.expenseCount++;
    if (isCashExpense_(pay)) stats.expenseCash += amt;
    else                     stats.expenseOther += amt;
    addTo_(stats.expenseByType, r[idx['ประเภท']] || 'อื่น ๆ', amt);
    addTo_(stats.expenseByPay, String(pay || 'เงินสด').trim() || 'เงินสด', amt);
  }
  // เงินสดคงเหลือ = ยอดขายหน้าร้าน ลบเฉพาะที่จ่ายด้วยเงินสด
  stats.netCash = (stats.revenue || 0) - stats.expenseCash;
}

/**
 * รายการบิลที่ขายไปแล้ว — ของสาขาที่ login อยู่เท่านั้น
 * ค่าเริ่มต้นคือของวันนี้ · ส่ง date มาเพื่อดูวันอื่น
 */

/**
 * ทำวันที่ให้เป็นรูปแบบเดียวกัน (yyyy-MM-dd)
 * Google Sheets ชอบแปลงข้อความ "2026-08-26" เป็นวันที่จริง แล้วแสดงเป็น "26/8/2026"
 * ถ้าเทียบตรง ๆ จะหาไม่เจอ — ฟังก์ชันนี้รับได้ทั้งสองแบบ (รวมทั้งปี พ.ศ.)
 */
function normDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  var str = String(v == null ? '' : v).trim();
  if (!str) return '';

  var iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    var y = parseInt(iso[1], 10);
    if (y > 2400) y -= 543;
    return pad4_(y) + '-' + pad2_(iso[2]) + '-' + pad2_(iso[3]);
  }
  // d/M/yyyy (รูปแบบที่ Sheets ภาษาไทยแสดง)
  var dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) {
    var yy = parseInt(dmy[3], 10);
    if (yy > 2400) yy -= 543;
    return pad4_(yy) + '-' + pad2_(dmy[2]) + '-' + pad2_(dmy[1]);
  }
  return str;
}
function pad2_(n) { return ('0' + parseInt(n, 10)).slice(-2); }
function pad4_(n) { return ('000' + n).slice(-4); }

/** ชื่อสาขาบางทีมีเว้นวรรคติดมา เทียบแบบตัดช่องว่างหัวท้าย */
function sameBranch_(a, b) {
  return String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim();
}

/**
 * ดึงเฉพาะแถวของวันที่ที่ต้องการ แทนที่จะลากทั้งชีตมาทั้งก้อน
 * อ่านคอลัมน์ "วันที่" ก่อน (คอลัมน์เดียว เบามาก) หาว่าแถวไหนตรงบ้าง
 * แล้วค่อยดึงเฉพาะช่วงแถวนั้นมาเต็มความกว้าง
 * ชีตโตขึ้นเท่าไหร่ ค่าใช้จ่ายก็ยังคงที่ เพราะบิลของวันหนึ่งมีไม่กี่สิบแถว
 * คืน { idx: {ชื่อคอลัมน์ -> ลำดับ}, rows: [แถวที่วันที่ตรงแล้ว] }
 */
function rowsOfDate_(sheet, width, date) {
  var out = { idx: {}, rows: [] };
  if (!sheet || sheet.getLastRow() < 1) return out;

  var head = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  head.forEach(function (h, i) { out.idx[h] = i; });

  var last = sheet.getLastRow();
  if (last < 2) return out;

  var dateCol = out.idx['วันที่'];
  if (dateCol === undefined) return out;

  var dates = sheet.getRange(2, dateCol + 1, last - 1, 1).getDisplayValues();
  var first = -1, lastHit = -1;
  for (var i = 0; i < dates.length; i++) {
    if (normDate_(dates[i][0]) !== date) continue;
    if (first < 0) first = i;
    lastHit = i;
  }
  if (first < 0) return out;

  // บิลถูกเพิ่มต่อท้ายเรียงตามเวลา แถวของวันเดียวกันจึงติดกันเป็นช่วง
  // แต่ยังกรองซ้ำอีกรอบ เผื่อมีคนไปแทรกแถวเองในชีต
  var block = sheet.getRange(first + 2, 1, lastHit - first + 1, width).getDisplayValues();
  for (var k = 0; k < block.length; k++) {
    if (normDate_(block[k][dateCol]) === date) out.rows.push(block[k]);
  }
  return out;
}

function handleBills_(p) {
  var session = checkToken_(p.token);
  if (!session) return { success: false, code: 401, message: 'Session หมดอายุ กรุณา Login ใหม่' };

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ORDERS);
  if (!sheet) return { success: false, message: 'ไม่พบชีต ' + SHEET_ORDERS + ' — รัน setupPos ก่อน' };

  var date = normDate_(p.date) || Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var branch = session.branch || '';

  // วันที่ยังไม่มีบิลหน้าร้านเลย ก็ยังต้องไปอ่านเดลิเวอรี่ต่อ — อย่ารีบ return
  var pos = rowsOfDate_(sheet, readWidth_(sheet, ORDER_HEADERS), date);
  var idx = pos.idx;

  var bills = [];
  for (var i = 0; i < pos.rows.length; i++) {
    var r = pos.rows[i];
    if (branch && !sameBranch_(r[idx['สาขา']], branch)) continue;

    var sticks = [], mama = [];
    STICK_PRICES.forEach(function (price) {
      var q = num_(r[idx['ไม้ ' + price + '฿']]);
      if (q > 0) sticks.push({ price: price, qty: q });
    });
    MAMA_PRICES.forEach(function (price) {
      var q = num_(r[idx['มาม่า ' + price + '฿']]);
      if (q > 0) mama.push({ price: price, qty: q });
    });

    bills.push({
      orderNo:    r[idx['เลขที่ออเดอร์']],
      time:       r[idx['เวลา']],
      staff:      r[idx['พนักงาน']],
      sticks:     sticks,
      stickCount: num_(r[idx['รวมไม้']]),
      stickAmount:num_(r[idx['ยอดไม้']]),
      mama:       mama,
      mamaCount:  num_(r[idx['รวมมาม่า']]),
      mamaAmount: num_(r[idx['ยอดมาม่า']]),
      subtotal:   num_(r[idx['ยอดรวม']]),
      discount:   num_(r[idx['ส่วนลด']]),
      total:      num_(r[idx['ยอดสุทธิ']]),
      redeemSticks: num_(r[idx['ใช้แต้ม (ไม้)']]),
      redeemAmount: num_(r[idx['ส่วนลดแต้ม']]),
      extras:     r[idx['ของอื่น']] || '',
      extraCount: num_(r[idx['รวมของอื่น']]),
      extraAmount:num_(r[idx['ยอดของอื่น']]),
      soup:       r[idx['น้ำซุป']],
      spice:      r[idx['ความเผ็ด']],
      sauce:      r[idx['น้ำจิ้ม']],
      method:     r[idx['วิธีชำระเงิน']]
    });
  }
  var sum = 0;
  bills.forEach(function (b) { sum += b.total; });
  var posCount = bills.length;

  // ── ออเดอร์เดลิเวอรี่ของวันเดียวกัน — เอามาแสดงรวมในรายการบิลด้วย ──
  // (ไม่นับเข้ายอดขายหน้าร้าน เพราะเงินเข้าทางแพลตฟอร์ม)
  var dlvSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DELIVERY);
  var dlvCount = 0, dlvItems = 0;
  if (dlvSheet) {
    var dlv = rowsOfDate_(dlvSheet, DELIVERY_HEADERS.length, date);
    var di = dlv.idx;
    for (var k = 0; k < dlv.rows.length; k++) {
      var d = dlv.rows[k];
      if (branch && !sameBranch_(d[di['สาขา']], branch)) continue;
      var items = [];
      try { items = JSON.parse(d[di['ข้อมูล']] || '[]'); } catch (e) {}
      dlvCount++;
      dlvItems += num_(d[di['รวมจำนวน']]);
      bills.push({
        kind: 'delivery',
        orderNo:    d[di['เลขที่ออเดอร์']],
        time:       d[di['เวลา']],
        staff:      d[di['พนักงาน']],
        items:      items,
        itemCount:  num_(d[di['รวมจำนวน']]),
        addonCount: num_(d[di['ของเพิ่ม']]),
        summary:    d[di['รายการ']],
        total: 0
      });
    }
  }

  // ── เงินที่จ่ายออกจากร้านวันเดียวกัน ──
  // แยกเงินสดออกจากโอน/บัตร เพราะตอนนับเงินปลายวันหักได้เฉพาะเงินสด
  var expSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_EXPENSE);
  var expenses = [], expenseTotal = 0, expenseCash = 0;
  if (expSheet) {
    var ex = rowsOfDate_(expSheet, readWidth_(expSheet, EXPENSE_HEADERS), date);
    var xi = ex.idx;
    for (var m = 0; m < ex.rows.length; m++) {
      var x = ex.rows[m];
      if (branch && !sameBranch_(x[xi['สาขา']], branch)) continue;
      var amt = num_(x[xi['จำนวนเงิน']]);
      var pay = (xi['วิธีจ่าย'] === undefined) ? '' : x[xi['วิธีจ่าย']];
      expenseTotal += amt;
      if (isCashExpense_(pay)) expenseCash += amt;
      expenses.push({
        no:     x[xi['เลขที่']],
        time:   x[xi['เวลา']],
        staff:  x[xi['พนักงาน']],
        type:   x[xi['ประเภท']],
        note:   x[xi['รายละเอียด']],
        amount: amt,
        pay:    String(pay || 'เงินสด').trim() || 'เงินสด'
      });
    }
    expenses.sort(function (a, b) { return String(b.time).localeCompare(String(a.time)); });
  }

  // เรียงตามเวลา บิลล่าสุดอยู่บนสุด (คละบิลหน้าร้านกับเดลิเวอรี่)
  // เวลาชนกันได้ถ้าขายติด ๆ กันในวินาทีเดียว จึงตัดสินด้วยเลขที่ออเดอร์ต่อ
  bills.sort(function (a, b) {
    var t = String(b.time).localeCompare(String(a.time));
    if (t !== 0) return t;
    return String(b.orderNo).localeCompare(String(a.orderNo));
  });

  return { success: true, data: {
    date: date, branch: branch,
    count: posCount, revenue: sum,
    deliveryCount: dlvCount, deliveryItems: dlvItems,
    expenses: expenses, expenseTotal: expenseTotal, expenseCash: expenseCash,
    netCash: sum - expenseCash,
    bills: bills
  } };
}

function emptyStats_() {
  return {
    orders: 0, revenue: 0, discount: 0, sticks: 0, mama: 0, sauceCups: 0, avgTicket: 0,
    deliveryOrders: 0, deliveryItemCount: 0, deliveryAddons: 0, deliveryItems: {},
    expenseTotal: 0, expenseCount: 0, expenseByType: {}, netCash: 0,
    redeemSticks: 0, redeemAmount: 0,
    expenseCash: 0, expenseOther: 0, expenseByPay: {},
    byHour: emptyHours_(),
    soup: {}, spice: {}, sauce: {}, method: {}, methodRevenue: {}, branch: {},
    byDate: [], branches: []
  };
}

function listBranches_(values, idx) {
  var seen = {}, out = [];
  for (var i = 1; i < values.length; i++) {
    var b = values[i][idx['สาขา']];
    if (b && !seen[b]) { seen[b] = true; out.push(b); }
  }
  return out.sort();
}

/**
 * อ่านชั่วโมง (0-23) จากช่อง "เวลา"
 * Google Sheets อาจแสดงเป็น "19:30:00" หรือ "7:30:00 PM" แล้วแต่รูปแบบที่ตั้งไว้
 * รับได้ทั้งสองแบบ ถ้าอ่านไม่ออกคืน -1
 */
function hourOf_(v) {
  var str = String(v == null ? '' : v).trim();
  var m = str.match(/(\d{1,2}):(\d{2})/);
  if (!m) return -1;
  var h = parseInt(m[1], 10);
  if (isNaN(h)) return -1;
  if (/PM|pm|หลังเที่ยง/.test(str) && h < 12) h += 12;
  if (/AM|am|ก่อนเที่ยง/.test(str) && h === 12) h = 0;
  return (h >= 0 && h <= 23) ? h : -1;
}

/** ช่องเก็บยอดราย 24 ชั่วโมง */
function emptyHours_() {
  var out = [];
  for (var h = 0; h < 24; h++) out.push({ hour: h, orders: 0, revenue: 0, delivery: 0 });
  return out;
}

function bump_(obj, key)        { if (!key) return; obj[key] = (obj[key] || 0) + 1; }
function addTo_(obj, key, val)  { if (!key) return; obj[key] = (obj[key] || 0) + val; }
function num_(v) {
  var n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

// ══════════════════════════════════════════════════════════════
//  ทดสอบ — รันใน Apps Script แล้วดูผลใน Log
// ══════════════════════════════════════════════════════════════
function testPosFlow() {
  var login = handleLogin_({ action: 'login', username: 'admin', password: '1234' });
  Logger.log('login: ' + JSON.stringify(login));
  if (!login.success) return;

  var res = handleOrder_({
    token: login.token,
    order: {
      orderId: 'TEST' + new Date().getTime(),
      branch: login.branch, staff: login.name,
      sticks: [{ price: 10, qty: 10 }, { price: 15, qty: 0 }],
      stickCount: 10, stickAmount: 100,
      mama: [{ price: 10, qty: 1 }],
      mamaCount: 1, mamaAmount: 10,
      subtotal: 110, discount: 5, total: 105,
      soup: 'กระดูกหมูหม่าล่า', spice: 'เผ็ดกลาง', sauce: 'งา', method: 'เงินสด'
    }
  });
  Logger.log('order: ' + JSON.stringify(res));
  Logger.log('stats: ' + JSON.stringify(handleStats_({ token: login.token })));
}


// ════════════════════════════════════════════════════════════
//  ข้อมูลดิบสำหรับหน้า คำนวณของหาย (loss-calculator.html)
//  เจ้าของร้านเท่านั้น — เป็นข้อมูลเงิน
// ════════════════════════════════════════════════════════════

/** ชีตที่หน้าคำนวณของหายอ่าน — type ที่หน้าเว็บส่งมา → ชื่อชีตจริง */
var HISTORY_SHEETS = {
  incoming: 'จำนวนของเข้า',
  weekly:   'เช็คสต็อกรายสัปดาห์',
  waste:    'ของเสีย',
  sales:    'ยอดขาย',
  delivery: SHEET_DELIVERY,  // ออเดอร์เดลิเวอรี่ที่ POS บันทึกไว้ — ใช้หักตอนคำนวณของหาย
  expense:  SHEET_EXPENSE    // เงินสดที่จ่ายออกจากร้าน
};

/**
 * GET ?action=history&type=incoming|weekly|waste|sales&token=...
 * คืนทุกแถวของชีตนั้นเป็น object โดยใช้หัวคอลัมน์เป็น key บวก _sheet
 * เจ้าของร้านเท่านั้น — พนักงานได้ 403
 */
function handleHistory_(p) {
  var session = checkToken_(p.token);
  if (!session) return { success: false, code: 401, message: 'Session หมดอายุ กรุณา Login ใหม่' };
  if (session.role !== 'owner') {
    return { success: false, code: 403, message: 'หน้าคำนวณของหายสำหรับเจ้าของร้านเท่านั้น' };
  }

  var name = HISTORY_SHEETS[String(p.type || '').trim()];
  if (!name) return { success: false, message: 'ไม่รู้จัก type: ' + p.type };

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) {
    return { success: false, message: 'ไม่พบชีต "' + name + '" ในไฟล์ Google Sheet นี้' };
  }
  if (sheet.getLastRow() < 2) return { success: true, data: [] };

  var values  = sheet.getDataRange().getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row.join('') === '') continue;
    var obj = { _sheet: name };
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      var v = row[c];
      obj[headers[c]] = (v instanceof Date) ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss') : v;
    }
    out.push(obj);
  }
  return { success: true, data: out };
}


// ══════════════════════════════════════════════════════════════
//  ระบบสต็อก — ของเข้าครัวกลาง / ของเข้าร้าน / เช็คสต็อก / ของเสีย
//  ──────────────────────────────────────────────────────────────
//  หน่วยนับ 2 ระดับ: หน่วยย่อย (ไม้/กรัม/ชิ้น) → หน่วยแพ็ค (แพ็ค/ถุง)
//    ไส้กรอกหนังกรอบ 7 ไม้ = 1 แพ็ค → 26 ไม้ = "3 แพ็ค 5 ไม้"
//  เก็บยอดจริงเป็น "หน่วยย่อย" เสมอ แปลงกลับเป็นแพ็คตอนแสดงผล
//  → บวกลบข้ามแพ็คไม่เพี้ยน และหน้าคำนวณของหายได้ตัวเลขเป็นไม้ตรง ๆ
//
//  ใช้ชีตเดิมทั้งหมด ไม่สร้างชีตซ้ำ:
//    จำนวนของเข้า · เช็คสต็อกรายสัปดาห์ · ของเสีย   (หน้าคำนวณของหายอ่านอยู่แล้ว)
//    รายการสินค้า                                    (ชีตใหม่ — ตั้งค่าหน่วยและราคา)
//  คอลัมน์ใหม่ "แพ็ค / เศษ / ไม้ต่อแพ็ค" ต่อท้ายของเดิม ไม่สลับลำดับ
//  → line-expiry-alert.gs และ loss-calculator.html หาคอลัมน์จากชื่อหัวตาราง จึงไม่พัง
// ══════════════════════════════════════════════════════════════

var SHEET_ITEMS    = 'รายการสินค้า';
var SHEET_INCOMING = 'จำนวนของเข้า';
var SHEET_COUNT    = 'เช็คสต็อกรายสัปดาห์';
var SHEET_WASTE    = 'ของเสีย';
var SHEET_PACK     = 'แพ็คของ';      // ครัวกลางเอาวัตถุดิบมาแพ็ค — ตัดของดิบ เพิ่มของแพ็ค

var CENTRAL = 'ครัวกลาง';

// "เตือนสาขาเมื่อเหลือ(แพ็ค)" เว้นว่างได้ — เว้นแล้วสาขาใช้จุดเตือนเดียวกับครัวกลาง
// (สาขาเก็บของน้อยกว่าครัวกลางมาก ปกติควรตั้งให้ต่ำกว่า)
var ITEM_COLS = ['สินค้า', 'หน่วยย่อย', 'หน่วยแพ็ค', 'หน่วยย่อยต่อแพ็ค',
                 'ราคาขาย/หน่วยย่อย', 'เตือนเมื่อเหลือ(แพ็ค)',
                 'เตือนสาขาเมื่อเหลือ(แพ็ค)', 'ใช้ที่', 'ชนิด', 'วัตถุดิบ',
                 'ชิ้นต่อไม้', 'หมายเหตุ'];

// ค่าที่ใส่ได้ในคอลัมน์ "ชนิด"
//   วัตถุดิบ = ซื้อมาเป็นโล ยังแพ็คไม่ได้ มีเฉพาะครัวกลาง
//   ของแพ็ค = แพ็คเสร็จแล้ว นับเป็นแพ็ค ส่งร้านได้
//   ของใช้   = ช้อน ถุง ผงปรุง ไม่ได้ขายเป็นชิ้น
var KIND_RAW    = 'วัตถุดิบ';
var KIND_PACKED = 'ของแพ็ค';
var KIND_SUPPLY = 'ของใช้';

// ค่าที่ใส่ได้ในคอลัมน์ "ใช้ที่" — เว้นว่าง = ใช้ทุกที่
//   ครัวกลาง = ของที่มีเฉพาะครัวกลาง เช่น วัตถุดิบดิบ ผงปรุง ของใช้
//   ร้าน     = ของที่มีเฉพาะหน้าร้าน เช่น น้ำซุปที่ผสมเสร็จแล้ว
var SCOPE_CENTRAL = 'ครัวกลาง';
var SCOPE_SHOP    = 'ร้าน';

// คอลัมน์ที่ทุกชีตประวัติต้องมี — ของเดิม 7 ตัวแรก ที่เพิ่มคือ 4 ตัวหลัง
var MOVE_COLS = ['วันที่เวลา', 'สาขา', 'ผู้ตรวจ', 'รายการ', 'จำนวน', 'หน่วย', 'หมายเหตุ',
                 'แพ็ค', 'เศษ', 'ไม้ต่อแพ็ค', 'ประเภท', 'เศษ(ชิ้น)', 'ชิ้นต่อไม้'];

// ชีต "แพ็คของ" — 1 แถวกระทบ 2 รายการพร้อมกัน จึงมีช่องวัตถุดิบเพิ่มมา
//   ตัดวัตถุดิบออกเท่า "จำนวนวัตถุดิบ" แล้วเพิ่มของแพ็คเข้าเท่า "จำนวน"
// แยกชีตไว้ต่างหาก ไม่ปนกับ "จำนวนของเข้า" เพราะบอทแจ้งของเข้า/วันหมดอายุ
// อ่านชีตนั้นอยู่ ถ้าเอาแถวติดลบไปใส่ มันจะไปแจ้งว่า "ของเข้าใหม่ -0.9 กก."
var PACK_COLS = ['วันที่เวลา', 'สาขา', 'ผู้ตรวจ',
                 'วัตถุดิบ', 'จำนวนวัตถุดิบ', 'หน่วยวัตถุดิบ',
                 'วัตถุดิบ2', 'จำนวนวัตถุดิบ2', 'หน่วยวัตถุดิบ2',
                 'วัตถุดิบ3', 'จำนวนวัตถุดิบ3', 'หน่วยวัตถุดิบ3',
                 'รายการ', 'จำนวน', 'หน่วย', 'แพ็ค', 'เศษ', 'ไม้ต่อแพ็ค',
                 'หมายเหตุ', 'ประเภท', 'เศษ(ชิ้น)', 'ชิ้นต่อไม้'];

/** ของที่พันใช้วัตถุดิบหลายอย่าง เผื่อช่องไว้ 3 — พอสำหรับหมู + ไส้ + เผื่ออีกตัว */
var PACK_RAW_SLOTS = 3;
function packRawCols_(i) {
  var n = i === 0 ? '' : String(i + 1);
  return { name: 'วัตถุดิบ' + n, qty: 'จำนวนวัตถุดิบ' + n, unit: 'หน่วยวัตถุดิบ' + n };
}

/**
 * หาคอลัมน์ตามชื่อหัวตาราง ถ้าไม่มีก็ต่อท้ายให้ — ไม่แตะคอลัมน์เดิม ไม่สลับลำดับ
 * คืน map ชื่อคอลัมน์ → index (เริ่มที่ 0)
 */
function ensureCols_(sheet, names) {
  var key = 'cols:' + sheet.getName() + ':' + names.join('|');
  if (key in _cache) return _cache[key];
  var map = ensureColsRaw_(sheet, names);
  _cache[key] = map;
  return map;
}

function ensureColsRaw_(sheet, names) {
  var width = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getLastRow() > 0
    ? sheet.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); })
    : [];
  var added = false;
  names.forEach(function (n) {
    if (headers.indexOf(n) === -1) { headers.push(n); added = true; }
  });
  if (added) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#fee2e2').setFontColor('#991b1b');
    sheet.setFrozenRows(1);
  }
  var map = {};
  headers.forEach(function (h, i) { if (h) map[h] = i; });
  return map;
}

/* ───────────── แคชระหว่างการทำงานหนึ่งครั้ง ─────────────
   Apps Script ช้าที่ "จำนวนครั้งที่คุยกับชีต" ไม่ใช่ที่ตัวโค้ด
   บันทึกเช็คสต็อกรอบเดียวเคยอ่านชีตประวัติ 6 รอบ (คิดยอดคงเหลือ 3
   + เช็คของใกล้หมดอีก 3) ทั้งที่ข้อมูลชุดเดียวกัน
   เก็บผลไว้ต่อการเรียก 1 ครั้ง แล้วล้างทิ้งทันทีที่มีการเขียน */
var _cache = {};
function cacheClear_() { _cache = {}; }
function cached_(key, fn) {
  if (!(key in _cache)) _cache[key] = fn();
  return _cache[key];
}

/** หาชีตตามชื่อ — จำไว้ ไม่ต้องถามซ้ำทุกครั้ง */
function sheet_(name) {
  return cached_('sh:' + name, function () {
    return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  });
}

/** เขียนหนึ่งแถวโดยอ้างชื่อคอลัมน์ ไม่อ้างตำแหน่ง */
function appendByCols_(sheet, map, values) {
  appendRows_(sheet, map, [values]);
}

/**
 * เขียนหลายแถวรวดเดียว — คุยกับชีตครั้งเดียว ไม่ใช่แถวละครั้ง
 * เช็คสต็อก 70 รายการเคยเป็น 70 รอบ ตอนนี้เหลือรอบเดียว
 */
function appendRows_(sheet, map, list) {
  if (!list || !list.length) return;
  var width = sheet.getLastColumn();
  var rows = list.map(function (values) {
    var row = new Array(width).fill('');
    Object.keys(values).forEach(function (k) {
      if (map[k] !== undefined) row[map[k]] = values[k];
    });
    return row;
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, width).setValues(rows);
  cacheClear_();          // ข้อมูลเปลี่ยนแล้ว ของที่จำไว้ใช้ไม่ได้
}

/* ───────────────────────── แปลงหน่วย 2 ระดับ ───────────────────────── */

/* ───────────── หน่วย 3 ชั้น: แพ็ค → ไม้ → ชิ้น ─────────────
   ลูกชิ้นเสียบไม้ละหลายชิ้น เศษเลยมี 2 แบบ
     1) ครบไม้ แต่ไม่ครบ 10 ไม้   → นับเป็นไม้
     2) ไม่ครบไม้ เหลือเป็นลูก ๆ  → นับเป็นชิ้น
   ของที่ไม่ได้เสียบหลายชิ้น (ชิ้นต่อไม้ = 1) ก็เหลือ 2 ชั้นเหมือนเดิม

   ยอดคงเหลือเก็บเป็น "หน่วยเล็กสุด" เสมอ — ชิ้น ถ้าเสียบหลายชิ้น
   ไม่งั้นต้องเก็บไม้เป็นทศนิยม (ครึ่งไม้) ซึ่งนับของจริงไม่ได้ */

/** ชิ้นต่อไม้ — ไม่ได้ตั้งไว้ถือว่า 1 (ไม้ละชิ้น) */
function perStickOf_(item) {
  var n = Number(item && item.perStick) || 1;
  return n > 0 ? n : 1;
}

/** หน่วยเล็กสุดที่ใช้เก็บยอด */
function baseUnitOf_(item) {
  return perStickOf_(item) > 1 ? 'ชิ้น' : (item ? item.subUnit : 'ไม้');
}

/** แพ็ค + ไม้ + ชิ้น → หน่วยเล็กสุดรวม */
function toBase_(packs, sticks, pieces, item) {
  var perStick = perStickOf_(item);
  var perPack  = Number(item && item.perPack) > 0 ? Number(item.perPack) : 1;
  return round_((Number(packs) || 0) * perPack * perStick +
                (Number(sticks) || 0) * perStick +
                (Number(pieces) || 0));
}

/** หน่วยเล็กสุดรวม → แพ็ค + ไม้ + ชิ้น */
function splitUnits_(base, item) {
  base = Number(base) || 0;
  var perStick = perStickOf_(item);
  var perPack  = Number(item && item.perPack) > 0 ? Number(item.perPack) : 1;
  var neg = base < 0, a = Math.abs(base);

  var perPackBase = perPack * perStick;
  var packs  = perPackBase > 1 ? Math.floor(a / perPackBase) : 0;
  var left   = round_(a - packs * perPackBase);
  var sticks = perStick > 1 ? Math.floor(left / perStick) : left;
  var pieces = perStick > 1 ? round_(left - sticks * perStick) : 0;

  var sign = neg ? -1 : 1;
  return { packs: sign * packs, sticks: sign * sticks, pieces: sign * pieces };
}

/** ข้อความอ่านง่าย เช่น "3 แพ็ค 5 ไม้ 1 ชิ้น" */
function fmtPack_(base, item) {
  var perStick = perStickOf_(item);
  var perPack  = Number(item && item.perPack) > 0 ? Number(item.perPack) : 1;
  if (perPack <= 1 && perStick <= 1) return round_(base) + ' ' + item.subUnit;

  var s = splitUnits_(base, item);
  var out = [];
  if (s.packs)  out.push(s.packs + ' ' + item.packUnit);
  if (s.sticks) out.push(s.sticks + ' ' + item.subUnit);
  if (s.pieces) out.push(s.pieces + ' ชิ้น');
  return out.length ? out.join(' ') : '0 ' + item.packUnit;
}

/** ปัดเศษทศนิยมลอย ๆ ทิ้ง (0.1+0.2 = 0.30000000000000004) */
function round_(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }

/* ───────────────────────── รายการสินค้า ───────────────────────── */

/** อ่านชีตรายการสินค้า — คืน array ของ { name, subUnit, packUnit, perPack, price, lowPacks } */
function getStockItems_() {
  return cached_('items', getStockItemsRaw_);
}

function getStockItemsRaw_() {
  var sh = sheet_(SHEET_ITEMS);
  if (!sh || sh.getLastRow() < 2) return [];
  var map = ensureCols_(sh, ITEM_COLS);
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var out = [];
  for (var i = 0; i < v.length; i++) {
    var name = String(v[i][map['สินค้า']] || '').trim();
    if (!name) continue;
    var per = Number(v[i][map['หน่วยย่อยต่อแพ็ค']]) || 1;
    out.push({
      name:     name,
      subUnit:  String(v[i][map['หน่วยย่อย']] || 'ไม้').trim(),
      packUnit: String(v[i][map['หน่วยแพ็ค']] || 'แพ็ค').trim(),
      perPack:  per > 0 ? per : 1,
      perStick: Number(v[i][map['ชิ้นต่อไม้']]) > 0 ? Number(v[i][map['ชิ้นต่อไม้']]) : 1,
      price:    Number(v[i][map['ราคาขาย/หน่วยย่อย']]) || 0,
      lowPacks: Number(v[i][map['เตือนเมื่อเหลือ(แพ็ค)']]) || 0,
      kind:     String(v[i][map['ชนิด']] || '').trim(),
      raws:     splitLocs_(v[i][map['วัตถุดิบ']]),
      lowPacksBranch: Number(v[i][map['เตือนสาขาเมื่อเหลือ(แพ็ค)']]) || 0,
      scope:    String(v[i][map['ใช้ที่']] || '').trim()
    });
  }
  return out;
}

/** จุดเตือนของแต่ละที่ (หน่วยแพ็ค) — สาขาเว้นว่างไว้ก็ใช้ตัวเดียวกับครัวกลาง */
function lowPacksFor_(item, loc) {
  if (String(loc || '').trim() === CENTRAL) return item.lowPacks || 0;
  return item.lowPacksBranch > 0 ? item.lowPacksBranch : (item.lowPacks || 0);
}

function findStockItem_(name) {
  var items = getStockItems_();
  for (var i = 0; i < items.length; i++) if (items[i].name === name) return items[i];
  return null;
}

/* ───────────────────────── ยอดคงเหลือ ───────────────────────── */

/** อ่านชีตประวัติเป็น array ของ object ตามชื่อหัวคอลัมน์ */
function readMoves_(sheetName) {
  return cached_('moves:' + sheetName, function () { return readMovesRaw_(sheetName); });
}

function readMovesRaw_(sheetName) {
  var sh = sheet_(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  var map = ensureCols_(sh, MOVE_COLS);
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var out = [];
  for (var i = 0; i < v.length; i++) {
    var name = String(v[i][map['รายการ']] || '').trim();
    if (!name) continue;
    out.push({
      when: v[i][map['วันที่เวลา']],
      loc:  String(v[i][map['สาขา']] || '').trim(),
      item: name,
      qty:  Number(v[i][map['จำนวน']]) || 0,
      kind: String(v[i][map['ประเภท']] || '').trim()
    });
  }
  return out;
}

/** อ่านชีตแพ็คของ */
function readPacks_() {
  return cached_('packs', readPacksRaw_);
}

function readPacksRaw_() {
  var sh = sheet_(SHEET_PACK);
  if (!sh || sh.getLastRow() < 2) return [];
  var map = ensureCols_(sh, PACK_COLS);
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var out = [];
  for (var i = 0; i < v.length; i++) {
    var item = String(v[i][map['รายการ']] || '').trim();
    var raws = [];
    for (var k = 0; k < PACK_RAW_SLOTS; k++) {
      var c = packRawCols_(k);
      if (map[c.name] === undefined) continue;
      var rn = String(v[i][map[c.name]] || '').trim();
      if (!rn) continue;
      raws.push({ name: rn, qty: Number(v[i][map[c.qty]]) || 0 });
    }
    if (!item && !raws.length) continue;
    out.push({
      when: v[i][map['วันที่เวลา']],
      loc:  String(v[i][map['สาขา']] || '').trim(),
      item: item,
      qty:  Number(v[i][map['จำนวน']]) || 0,
      raws: raws
    });
  }
  return out;
}

function timeOf_(v) {
  if (!v) return 0;
  var d = (v instanceof Date) ? v : new Date(v);
  var t = d.getTime();
  return isNaN(t) ? 0 : t;
}

/**
 * ยอดคงเหลือทุกสถานที่ เป็น "หน่วยย่อย"
 *   เริ่มจากยอดนับครั้งล่าสุดของแต่ละ สถานที่+สินค้า
 *   แล้วบวก/ลบเฉพาะรายการที่เกิด "หลัง" การนับครั้งนั้น
 * ของเข้าร้าน 1 แถว = บวกให้สาขา และหักออกจากครัวกลางพร้อมกัน (ไม่ต้องเขียน 2 แถว)
 */
function stockBalances_() {
  return cached_('bal', stockBalancesRaw_);
}

function stockBalancesRaw_() {
  var bal = {};
  function add(loc, item, n) {
    if (!loc || !item) return;
    if (!bal[loc]) bal[loc] = {};
    bal[loc][item] = round_((bal[loc][item] || 0) + n);
  }

  // 1) ยอดนับล่าสุดของแต่ละ สถานที่+สินค้า เป็นจุดตั้งต้น
  //    เก็บเป็น lastCount[สถานที่][สินค้า] เพื่อไม่ต้องต่อ/ตัด string
  //    (ชื่อสินค้ามีเว้นวรรคได้ ถ้าต่อ string แล้ว split จะเพี้ยน)
  var lastCount = {};
  readMoves_(SHEET_COUNT).forEach(function (m) {
    if (!lastCount[m.loc]) lastCount[m.loc] = {};
    var t = timeOf_(m.when);
    var cur = lastCount[m.loc][m.item];
    if (!cur || t >= cur.t) lastCount[m.loc][m.item] = { t: t, qty: m.qty };
  });
  Object.keys(lastCount).forEach(function (loc) {
    Object.keys(lastCount[loc]).forEach(function (item) {
      add(loc, item, lastCount[loc][item].qty);
    });
  });

  /**
   * รายการนี้เกิดหลังการนับครั้งล่าสุดของ "สถานที่นั้น" หรือยัง
   * ต้องดูทีละสถานที่ เพราะของเข้าร้าน 1 แถวกระทบ 2 ที่ (บวกสาขา หักครัวกลาง)
   * ถ้าเอาวันนับของสาขามาตัดสินฝั่งครัวกลางด้วย พอสาขานับสต็อก
   * ของที่เคยส่งออกไปแล้วจะเด้งกลับเข้าครัวกลาง ยอดครัวกลางจะเกินความจริง
   */
  function after(loc, item, when) {
    var c = lastCount[loc] && lastCount[loc][item];
    if (!c) return true;                     // ไม่เคยนับ → นับรายการเคลื่อนไหวทั้งหมด
    return timeOf_(when) > c.t;
  }

  // 2) ของเข้า
  readMoves_(SHEET_INCOMING).forEach(function (m) {
    if (after(m.loc, m.item, m.when)) add(m.loc, m.item, m.qty);
    // ออกจากครัวกลาง — ตัดสินด้วยวันนับของครัวกลางเอง ไม่ใช่ของสาขาปลายทาง
    if (m.kind === 'ของเข้าร้าน' && m.loc !== CENTRAL &&
        after(CENTRAL, m.item, m.when)) add(CENTRAL, m.item, -m.qty);
  });

  // 3) ของเสีย / แถมฟรี
  readMoves_(SHEET_WASTE).forEach(function (m) {
    if (after(m.loc, m.item, m.when)) add(m.loc, m.item, -m.qty);
  });

  // 4) แพ็คของ — 1 แถวตัดวัตถุดิบ แล้วเพิ่มของแพ็คที่ครัวกลาง
  //    สองรายการคนละตัว จึงต้องเช็ควันนับของแต่ละตัวแยกกัน
  readPacks_().forEach(function (m) {
    m.raws.forEach(function (r) {
      if (r.name && after(m.loc, r.name, m.when)) add(m.loc, r.name, -r.qty);
    });
    if (m.item && after(m.loc, m.item, m.when)) add(m.loc, m.item, m.qty);
  });

  return bal;
}

/* ───────────────────────── แจ้ง LINE ───────────────────────── */

// ── กลุ่ม LINE ของแต่ละสถานที่ ──
// ทุกไฟล์อยู่โปรเจกต์เดียวกันแล้ว LINE_GROUPS ตั้งที่เดียว ใช้ร่วมกันหมด
// เว้นว่าง = ส่งไปปลายทางกลาง (LINE_TARGET_ID) แทน · ไม่มีทั้งคู่ = ไม่ส่ง (ห้าม broadcast)
//
// ตั้งค่าใน โปรเจกต์ > การตั้งค่าสคริปต์ > คุณสมบัติสคริปต์ (ไม่ใช่ในโค้ด — repo นี้ public)
//   LINE_CHANNEL_ACCESS_TOKEN = token ของบอท
//   LINE_GROUPS = {"ครัวกลาง":"Cxxxx","ตลาดทรัพย์พัฒนา":"Cyyyy"}
// ห้ามใส่ในชีต — ไม่มีโค้ดไหนอ่าน Group ID จากชีตเลย
//
//   กลุ่มครัวกลาง ← ของหาย · ของครัวกลางใกล้หมด · ของเสียครัวกลาง · เตือนนับสต็อก
//   กลุ่มสาขา    ← ของหาย · ของสาขาใกล้หมด · เช็คสต็อกรายสัปดาห์ · ของเสียสาขา
// (ของเข้าไม่ได้แจ้งจากตรงนี้ checkNewIncoming ใน line-expiry-alert.gs แจ้งให้)
//
// LINE_GROUPS เป็นทะเบียนสาขาไปในตัว — ช่องเลือกสถานที่ในเว็บสต็อก
// กับรายชื่อที่ระบบเตือนนับสต็อก มาจาก ครัวกลาง + key ทั้งหมดในนี้
// สาขาที่ยังไม่เปิด (เช่น แบริ่ง) ไม่ต้องใส่ ระบบจะข้ามไปเอง
//
// ดูค่าปัจจุบัน: showLineGroups()   เพิ่มทีละกลุ่ม: setLineGroup('ชื่อ', 'Cxxxx')
var STOCK_BRANCH_GROUPS = {};   // สำรอง — ปกติใช้ Script Property LINE_GROUPS แทน

function stockLineGroups_() {
  var raw = PropertiesService.getScriptProperties().getProperty('LINE_GROUPS');
  if (!raw) return STOCK_BRANCH_GROUPS;
  try {
    var o = JSON.parse(raw);
    return (o && typeof o === 'object') ? o : STOCK_BRANCH_GROUPS;
  } catch (e) {
    return STOCK_BRANCH_GROUPS;
  }
}

/**
 * ส่งข้อความเข้ากลุ่ม LINE ของสถานที่นั้น
 * ส่งไม่สำเร็จก็ไม่ทำให้การบันทึกล้มเหลว — ของลงชีตแล้วถือว่าบันทึกสำเร็จ
 * คืน { sent, message } ให้ผู้เรียกเอาไปบอกต่อว่าทำไมไม่ได้ส่ง
 */
function stockNotify_(location, text) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) {
    return { sent: false, message: 'ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN ในโปรเจกต์นี้ — บันทึกแล้วแต่ไม่ได้แจ้งกลุ่ม' };
  }
  var to = String(stockLineGroups_()[String(location || '').trim()] || '').trim() ||
           props.getProperty('LINE_TARGET_ID') || '';
  // ไม่รู้ปลายทาง = ข้ามไป ห้าม broadcast เด็ดขาด
  // broadcast ส่งหาเพื่อนของ OA ทุกคน ลูกค้าจะได้ข้อความสต็อกภายในร้านไปด้วย
  // (สาขาที่ยังไม่เปิดใช้ เช่น แบริ่ง จะตกมาทางนี้)
  if (!to) {
    return { sent: false, message: 'ยังไม่ได้ตั้ง Group ID ของ "' + location + '" — บันทึกแล้วแต่ไม่ได้แจ้งกลุ่ม' };
  }

  var url  = 'https://api.line.me/v2/bot/message/push';
  var body = { to: to, messages: [{ type: 'text', text: text }] };
  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify(body), muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code !== 200) return { sent: false, message: 'LINE ตอบ ' + code + ': ' + res.getContentText() };
    return { sent: true, message: '' };
  } catch (err) {
    return { sent: false, message: 'แจ้งกลุ่มไม่สำเร็จ: ' + err.message };
  }
}

/**
 * เตือนเมื่อของเหลือน้อย — แจ้งเข้ากลุ่มไลน์ของที่นั้นเอง
 * ครัวกลางใช้ช่อง "เตือนเมื่อเหลือ(แพ็ค)" สาขาใช้ "เตือนสาขาเมื่อเหลือ(แพ็ค)"
 *
 * แจ้ง "ตอนตกลงมาต่ำกว่าจุดเตือน" ครั้งเดียว แล้วจำสถานะไว้
 * ไม่ใช่เตือนทุกครั้งที่ส่งของออก ไม่งั้นไลน์จะเด้งรัว
 * พอเติมของจนเกินจุดเตือนแล้ว ล้างสถานะ รอบหน้าถึงเตือนใหม่
 * สถานะจำแยกตามสถานที่ — ครัวกลางใกล้หมดไม่ได้แปลว่าสาขาใกล้หมดด้วย
 */
function checkLowStock_(itemNames, location) {
  var loc = String(location || CENTRAL).trim();
  var items = {};
  getStockItems_().forEach(function (i) { items[i.name] = i; });
  var bal = stockBalances_()[loc] || {};
  var props = PropertiesService.getScriptProperties();
  var hits = [];

  (itemNames || []).forEach(function (name) {
    var it = items[name];
    if (!it) return;
    var lowPacks = lowPacksFor_(it, loc);
    if (!(lowPacks > 0)) return;
    var limit = lowPacks * it.perPack * perStickOf_(it);
    var have  = Number(bal[name]) || 0;
    var key   = 'LOWSTOCK_' + loc + '_' + name;
    var wasLow = props.getProperty(key) === '1';

    // คีย์เดิมสมัยที่เตือนแต่ครัวกลาง ไม่มีชื่อสถานที่คั่น — ย้ายมาคีย์ใหม่
    // ถ้าไม่ย้าย ของที่ต่ำอยู่แล้วจะถูกแจ้งซ้ำอีกรอบตอนอัปเดตโค้ด
    if (!wasLow && loc === CENTRAL && props.getProperty('LOWSTOCK_' + name) === '1') {
      wasLow = true;
      props.setProperty(key, '1');
      props.deleteProperty('LOWSTOCK_' + name);
    }

    var isLow = have <= limit;
    if (isLow && !wasLow) {
      hits.push('• ' + name + ' เหลือ ' + fmtPack_(have, it) +
                '  (จุดเตือน ' + lowPacks + ' ' + it.packUnit + ')');
      props.setProperty(key, '1');
    } else if (!isLow && wasLow) {
      props.deleteProperty(key);
    }
  });

  if (!hits.length) return;
  stockNotify_(loc, '⚠️ ของ' + loc + 'ใกล้หมด\n\n' + hits.join('\n') + '\n\n' +
    (loc === CENTRAL ? 'สั่งของเพิ่มด้วยครับ' : 'แจ้งครัวกลางเบิกของเพิ่มด้วยครับ'));
}

/* ───────────────────────── บันทึกความเคลื่อนไหว ───────────────────────── */

/** แปลง error จาก stockPrepare_ เป็นคำตอบที่หน้าเว็บเข้าใจ */
function stockErr_(e) {
  if (e.message === '401') return { success: false, code: 401, message: 'Session หมดอายุ กรุณา Login ใหม่' };
  if (e.message === '403') return { success: false, code: 403, message: 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้' };
  return { success: false, message: e.message };
}

/**
 * สิทธิ์ในระบบสต็อก แบ่งจากช่อง "สาขา" ในชีตผู้ใช้งาน
 *   owner   = เจ้าของร้าน ทำได้ทุกอย่างทุกสถานที่
 *   central = สาขาเป็น "ครัวกลาง"  → สต็อกคงเหลือ / ของเข้าครัวกลาง / เช็คสต็อก / ของเสีย
 *   branch  = สาขาเป็นชื่อสาขา     → ของเข้าร้าน / เช็คสต็อก / ของเสีย เฉพาะสาขาตัวเอง
 * เช็คสต็อกทำได้ทั้งคู่ แต่ลงได้เฉพาะสถานที่ของตัวเอง (stockCanUseLoc_)
 */
function stockRoleOf_(session) {
  if (session.role === 'owner') return 'owner';
  var locs = sessionLocs_(session);
  var central = locs.indexOf(CENTRAL) !== -1;
  var shop = locs.some(function (l) { return l !== CENTRAL; });
  if (central && shop) return 'both';       // ทำทั้งครัวกลางและหน้าร้าน
  return central ? 'central' : 'branch';
}

/** สถานที่ทั้งหมดของคนนี้ — รองรับคนที่ทำทั้งสาขาและครัวกลาง */
function sessionLocs_(session) {
  if (session.branches && session.branches.length) {
    return session.branches.map(function (l) { return String(l).trim(); })
                           .filter(function (l) { return l; });
  }
  return splitLocs_(session.branch);
}

/** ยอดคงเหลือและตัวเลขเทียบตอนนับสต็อก ให้เฉพาะเจ้าของร้าน */
function isStockOwner_(session) { return stockRoleOf_(session) === 'owner'; }

/** เจ้าของผ่านหมด นอกนั้นต้องตรงกับที่กำหนด */
function stockAllow_(session, need) {
  var r = stockRoleOf_(session);
  return r === 'owner' || r === 'both' || r === need;
}

/** สถานที่ที่คนนี้ลงรายการได้ — กันไม่ให้สาขาหนึ่งไปลงของอีกสาขา */
function stockCanUseLoc_(session, loc) {
  if (stockRoleOf_(session) === 'owner') return true;
  return sessionLocs_(session).indexOf(String(loc || '').trim()) !== -1;
}

/**
 * แพ็คของ — ครัวกลางเอาวัตถุดิบมาแพ็คเป็นไม้/ถุง
 *
 * 1 แถวทำ 2 อย่างพร้อมกัน ตัดวัตถุดิบออก แล้วเพิ่มของแพ็คเข้า
 * ที่เหลือของวัตถุดิบไม่ต้องคำนวณ ระบบหักให้เอง เช่น ซื้อมา 1 โล
 * แพ็คไป 0.9 โล ยอดคงเหลือของดิบจะเหลือ 0.1 โล ให้เห็นเลย
 */
function handleStockPack_(body) {
  var session = checkToken_(body.token);
  if (!session) return { success: false, code: 401, message: 'Session หมดอายุ กรุณา Login ใหม่' };
  if (!stockAllow_(session, 'central')) {
    return { success: false, code: 403, message: 'แพ็คของได้เฉพาะครัวกลาง' };
  }

  var out = findStockItem_(String(body.item || '').trim());
  if (!out) return { success: false, message: 'ไม่พบสินค้า "' + body.item + '" ในชีตรายการสินค้า' };
  var made = toBase_(body.packs, body.rem, body.pieces, out);
  if (!(made > 0)) return { success: false, message: 'กรุณากรอกจำนวนที่แพ็คได้' };

  // วัตถุดิบมาจากหน้าเว็บเป็น list — ของที่พันมีหลายตัว ของที่แค่เสียบมีตัวเดียว
  var want = body.raws;
  if (!want && body.raw) want = [{ name: body.raw, qty: body.rawQty }];   // รูปแบบเดิม
  want = want || [];

  var used = [], seen = {};
  for (var i = 0; i < want.length; i++) {
    var nm = String(want[i] && want[i].name || '').trim();
    if (!nm) continue;
    if (seen[nm]) return { success: false, message: 'ใส่ "' + nm + '" มาซ้ำสองครั้ง' };
    seen[nm] = true;

    var it = findStockItem_(nm);
    if (!it) return { success: false, message: 'ไม่พบวัตถุดิบ "' + nm + '" ในชีตรายการสินค้า' };
    var q = Number(want[i].qty) || 0;
    if (!(q > 0)) return { success: false, message: 'กรอกว่าใช้ "' + nm + '" ไปเท่าไหร่' };
    used.push({ item: it, qty: q });
  }
  if (used.length > PACK_RAW_SLOTS) {
    return { success: false, message: 'ใส่วัตถุดิบได้ไม่เกิน ' + PACK_RAW_SLOTS + ' อย่างต่อครั้ง' };
  }

  var sh = sheet_(SHEET_PACK);
  if (!sh) return { success: false, message: 'ไม่พบชีต "' + SHEET_PACK + '" — รัน setupStock ก่อน' };
  var map = ensureCols_(sh, PACK_COLS);

  var now = new Date();
  var row = {
    'วันที่เวลา': now, 'สาขา': CENTRAL, 'ผู้ตรวจ': session.name,
    'รายการ': out.name, 'จำนวน': made, 'หน่วย': baseUnitOf_(out),
    'แพ็ค': Number(body.packs) || 0, 'เศษ': Number(body.rem) || 0,
    'เศษ(ชิ้น)': Number(body.pieces) || 0, 'ชิ้นต่อไม้': perStickOf_(out),
    'ไม้ต่อแพ็ค': out.perPack, 'ประเภท': 'แพ็คของ',
    'หมายเหตุ': String(body.note || '')
  };
  used.forEach(function (u, k) {
    var c = packRawCols_(k);
    row[c.name] = u.item.name;
    row[c.qty]  = u.qty;
    row[c.unit] = u.item.subUnit;
  });
  appendByCols_(sh, map, row);

  var msg = '📦 แพ็คของ — ' + CENTRAL + '\n\n' +
            (used.length
              ? 'ใช้ ' + used.map(function (u) {
                  return u.item.name + ' ' + u.qty + ' ' + u.item.subUnit;
                }).join('\n    ') + '\n'
              : '') +
            'ได้ ' + out.name + ' ' + fmtPack_(made, out) + '\n' +
            'โดย ' + session.name + ' · ' + Utilities.formatDate(now, TZ, 'd/M/yyyy HH:mm');
  var line = stockNotify_(CENTRAL, msg);

  checkLowStock_([out.name]);
  return { success: true, text: fmtPack_(made, out),
           lineSent: line.sent, lineMsg: line.message };
}

/** ตรวจ token + สิทธิ์ + แปลงจำนวนแพ็ค/เศษ เป็นหน่วยย่อย — ใช้ร่วมกันทุก action */
function stockPrepare_(body, need) {
  var session = checkToken_(body.token);
  if (!session) throw new Error('401');
  if (need && !stockAllow_(session, need)) throw new Error('403');

  var name = String(body.item || '').trim();
  var it = findStockItem_(name);
  if (!it) throw new Error('ไม่พบสินค้า "' + name + '" ในชีตรายการสินค้า');

  var total = toBase_(body.packs, body.rem, body.pieces, it);
  if (!(total > 0)) throw new Error('กรุณากรอกจำนวน');

  return { session: session, item: it, total: total };
}

/** ของเข้าครัวกลาง — เสียบและแพ็คเสร็จแล้วลงยอด */
function handleStockIn_(body) {
  var p;
  try { p = stockPrepare_(body, 'central'); }
  catch (e) { return stockErr_(e); }

  if (p.item.scope === SCOPE_SHOP) {
    return { success: false, message: '"' + p.item.name + '" เป็นของหน้าร้าน ไม่ได้ลงที่ครัวกลาง' };
  }

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INCOMING);
  if (!sh) return { success: false, message: 'ไม่พบชีต "' + SHEET_INCOMING + '"' };
  var map = ensureCols_(sh, MOVE_COLS);

  var now = new Date();
  appendByCols_(sh, map, {
    'วันที่เวลา': now, 'สาขา': CENTRAL, 'ผู้ตรวจ': p.session.name,
    'รายการ': p.item.name, 'จำนวน': p.total, 'หน่วย': baseUnitOf_(p.item),
    'แพ็ค': Number(body.packs) || 0, 'เศษ': Number(body.rem) || 0,
    'เศษ(ชิ้น)': Number(body.pieces) || 0, 'ชิ้นต่อไม้': perStickOf_(p.item),
    'ไม้ต่อแพ็ค': p.item.perPack, 'ประเภท': 'ของเข้าครัวกลาง',
    'หมายเหตุ': String(body.note || '')
  });

  // ไม่แจ้ง LINE ตรงนี้ — checkNewIncoming ใน line-expiry-alert.gs เห็นแถวใหม่
  // ในชีตนี้ทุก 5 นาที แล้วแจ้งให้เอง พร้อมจำนวนแพ็คและวันหมดอายุ
  // ถ้าแจ้งทั้งสองที่ กลุ่มจะได้ข้อความซ้ำ 2 รอบ
  return { success: true, text: fmtPack_(p.total, p.item), lineSent: false,
           lineMsg: 'บอทของเข้าจะแจ้งกลุ่มให้ภายใน 5 นาที' };
}

/** ของเข้าร้าน — ส่งจากครัวกลางไปสาขา หักครัวกลางอัตโนมัติตอนคิดยอดคงเหลือ */
function handleStockToShop_(body) {
  var p;
  try { p = stockPrepare_(body, 'branch'); }
  catch (e) { return stockErr_(e); }

  var branch = String(body.location || '').trim();
  if (!branch || branch === CENTRAL) return { success: false, message: 'กรุณาเลือกสาขา' };
  if (!stockCanUseLoc_(p.session, branch)) {
    return { success: false, code: 403, message: 'ลงของเข้าได้เฉพาะสาขาของตัวเอง' };
  }
  if (p.item.scope === SCOPE_CENTRAL) {
    return { success: false, message: '"' + p.item.name + '" เป็นของครัวกลาง ไม่ได้ส่งเข้าร้าน' };
  }

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INCOMING);
  if (!sh) return { success: false, message: 'ไม่พบชีต "' + SHEET_INCOMING + '"' };
  var map = ensureCols_(sh, MOVE_COLS);

  var now = new Date();
  appendByCols_(sh, map, {
    'วันที่เวลา': now, 'สาขา': branch, 'ผู้ตรวจ': p.session.name,
    'รายการ': p.item.name, 'จำนวน': p.total, 'หน่วย': baseUnitOf_(p.item),
    'แพ็ค': Number(body.packs) || 0, 'เศษ': Number(body.rem) || 0,
    'เศษ(ชิ้น)': Number(body.pieces) || 0, 'ชิ้นต่อไม้': perStickOf_(p.item),
    'ไม้ต่อแพ็ค': p.item.perPack, 'ประเภท': 'ของเข้าร้าน',
    'หมายเหตุ': String(body.note || '')
  });

  // ไม่แจ้ง LINE ตรงนี้ — checkNewIncoming ใน line-expiry-alert.gs แจ้งให้เอง
  // พร้อมจำนวนแพ็ค วงเล็บบอกว่า 1 แพ็คมีกี่ไม้ และวันหมดอายุ
  // (อายุเก็บอยู่ในไฟล์นั้นที่เดียว จะได้ไม่ต้องเก็บตารางอายุซ้ำสองที่)
  checkLowStock_([p.item.name], CENTRAL);         // ส่งออกแล้วครัวกลางอาจตกต่ำกว่าจุดเตือน
                                                  // สาขาได้ของเพิ่ม ไม่ต้องเช็ค มีแต่จะขึ้น

  return { success: true, text: fmtPack_(p.total, p.item), lineSent: false,
           lineMsg: 'บอทของเข้าจะแจ้งกลุ่ม ' + branch + ' ให้ภายใน 5 นาที' };
}

/** ของเสีย / แถมฟรี — ตัดออกจากสต็อก */
function handleStockWaste_(body) {
  var p;
  try { p = stockPrepare_(body); }
  catch (e) { return stockErr_(e); }

  var loc = String(body.location || '').trim();
  if (!loc) return { success: false, message: 'กรุณาเลือกสถานที่' };
  if (!stockCanUseLoc_(p.session, loc)) {
    return { success: false, code: 403, message: 'บันทึกของเสียได้เฉพาะสถานที่ของตัวเอง' };
  }

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_WASTE);
  if (!sh) return { success: false, message: 'ไม่พบชีต "' + SHEET_WASTE + '"' };
  var map = ensureCols_(sh, MOVE_COLS);

  var reason = String(body.reason || 'ของเสีย').trim();
  var now = new Date();
  appendByCols_(sh, map, {
    'วันที่เวลา': now, 'สาขา': loc, 'ผู้ตรวจ': p.session.name,
    'รายการ': p.item.name, 'จำนวน': p.total, 'หน่วย': baseUnitOf_(p.item),
    'แพ็ค': Number(body.packs) || 0, 'เศษ': Number(body.rem) || 0,
    'เศษ(ชิ้น)': Number(body.pieces) || 0, 'ชิ้นต่อไม้': perStickOf_(p.item),
    'ไม้ต่อแพ็ค': p.item.perPack, 'ประเภท': reason,
    'หมายเหตุ': String(body.note || '')
  });

  var text = fmtPack_(p.total, p.item);
  var line = stockNotify_(loc,
    '🗑️ ตัดของออกจากสต็อก — ' + loc + '\n\n' +
    p.item.name + '  ' + text + '\nสาเหตุ ' + reason +
    '\nผู้บันทึก ' + p.session.name);

  checkLowStock_([p.item.name], loc);   // ตัดของออกแล้วที่นั้นอาจตกต่ำกว่าจุดเตือน
  return { success: true, text: text, lineSent: line.sent, lineMsg: line.message };
}

/**
 * เช็คสต็อกรายสัปดาห์ — ต้องนับให้ครบทุกรายการ ไม่ให้ข้าม
 * ยอดที่นับได้กลายเป็นยอดตั้งต้นใหม่เสมอ (ไม่มีตัวเลือกไม่ปรับ)
 * เพราะยอดขายไม่ได้ถูกหักออกจากสต็อกทีละบิล การนับจริงจึงเป็นอย่างเดียวที่ทำให้ยอดกลับมาตรง
 */
function handleStockCount_(body) {
  var session = checkToken_(body.token);
  if (!session) return { success: false, code: 401, message: 'Session หมดอายุ กรุณา Login ใหม่' };
  var loc = String(body.location || '').trim();
  if (!loc) return { success: false, message: 'กรุณาเลือกสถานที่' };
  if (!stockCanUseLoc_(session, loc)) {
    return { success: false, code: 403, message: 'นับสต็อกได้เฉพาะสาขาของตัวเอง' };
  }

  var rows = body.rows || [];
  var items = getStockItems_();
  if (!items.length) return { success: false, message: 'ยังไม่มีรายการสินค้าในชีต "' + SHEET_ITEMS + '"' };

  var got = {};
  rows.forEach(function (r) { got[String(r.item || '').trim()] = r; });
  var missing = items.filter(function (it) {
    var r = got[it.name];
    if (!r) return true;
    var blank = function (v) { return v === '' || v == null; };
    return blank(r.packs) && blank(r.rem) && blank(r.pieces);
  }).map(function (it) { return it.name; });
  if (missing.length) {
    return { success: false, message: 'ต้องนับให้ครบทุกรายการ ยังขาด ' + missing.length + ' รายการ: ' +
                                      missing.slice(0, 5).join(', ') + (missing.length > 5 ? ' …' : '') };
  }

  var sh = sheet_(SHEET_COUNT);
  if (!sh) return { success: false, message: 'ไม่พบชีต "' + SHEET_COUNT + '"' };
  var map = ensureCols_(sh, MOVE_COLS);

  var before = stockBalances_()[loc] || {};
  var now = new Date();
  var diffs = [], out = [];
  var counts = [];   // ส่งต่อให้ stock-audit.gs เทียบของหายกับเงิน

  items.forEach(function (it) {
    var r = got[it.name];
    var counted = toBase_(r.packs, r.rem, r.pieces, it);
    var sys = Number(before[it.name]) || 0;
    var diff = round_(counted - sys);
    counts.push({ item: it, counted: counted, sys: sys, diff: diff });
    out.push({
      'วันที่เวลา': now, 'สาขา': loc, 'ผู้ตรวจ': session.name,
      'รายการ': it.name, 'จำนวน': counted, 'หน่วย': baseUnitOf_(it),
      'แพ็ค': Number(r.packs) || 0, 'เศษ': Number(r.rem) || 0,
      'เศษ(ชิ้น)': Number(r.pieces) || 0, 'ชิ้นต่อไม้': perStickOf_(it),
      'ไม้ต่อแพ็ค': it.perPack, 'ประเภท': 'เช็คสต็อก',
      'หมายเหตุ': 'ยอดระบบ ' + sys + ' ' + baseUnitOf_(it) + ' ต่าง ' + (diff > 0 ? '+' : '') + diff
    });
    if (diff !== 0) diffs.push('• ' + it.name + '  นับได้ ' + fmtPack_(counted, it) +
                               '  (ระบบ ' + fmtPack_(sys, it) + ' ต่าง ' + (diff > 0 ? '+' : '') + diff + ' ' + baseUnitOf_(it) + ')');
  });
  appendRows_(sh, map, out);          // เขียนทีเดียว ไม่ใช่แถวละครั้ง

  var msg = '📋 เช็คสต็อกรายสัปดาห์ — ' + loc + '\n\n' +
            'นับครบ ' + items.length + ' รายการ โดย ' + session.name + '\n' +
            Utilities.formatDate(now, TZ, 'd/M/yyyy HH:mm') + '\n\n' +
            (diffs.length ? 'ที่ไม่ตรงกับระบบ ' + diffs.length + ' รายการ\n' + diffs.join('\n')
                          : 'ตรงกับระบบทุกรายการ 🎉');
  var line = stockNotify_(loc, msg);

  // เทียบมูลค่าของที่หายกับเงินที่ได้มา แล้วแจ้งกลุ่มถ้าไม่ตรง (stock-audit.gs)
  // ส่งไม่สำเร็จหรือไม่มีไฟล์นั้น ก็ไม่ทำให้การนับล้มเหลว — ของลงชีตแล้ว
  var shrink = null;
  if (typeof auditAfterCount_ === 'function') {
    try { shrink = auditAfterCount_(loc, counts, now); }
    catch (e) { Logger.log('auditAfterCount_: ' + e.message); }
  }

  checkLowStock_(items.map(function (it) { return it.name; }), loc);
  return { success: true, counted: items.length, diffs: diffs.length,
           lineSent: line.sent, lineMsg: line.message,
           shrink: shrink };
}

/** ข้อมูลตั้งต้นของหน้าสต็อก — รายการสินค้า สถานที่ และยอดคงเหลือ */
function handleStockBootstrap_(p) {
  var session = checkToken_(p.token);
  if (!session) return { success: false, code: 401, message: 'Session หมดอายุ กรุณา Login ใหม่' };

  var items = getStockItems_();
  // ยอดคงเหลือส่งให้เจ้าของร้านคนเดียว พนักงานไม่ต้องคิดให้ ประหยัดการอ่านชีต
  // 3 รอบต่อการเปิดหน้าหนึ่งครั้ง ซึ่งเป็นงานหนักที่สุดของ request นี้
  var owner = isStockOwner_(session);
  var bal = owner ? stockBalances_() : {};

  // สถานที่ = ครัวกลาง + สาขาที่ตั้งกลุ่ม LINE ไว้ใน Script Property LINE_GROUPS
  var locations = [CENTRAL];
  Object.keys(stockLineGroups_()).forEach(function (b) {
    if (locations.indexOf(b) === -1) locations.push(b);
  });
  Object.keys(bal).forEach(function (l) { if (locations.indexOf(l) === -1) locations.push(l); });
  if (!owner) {
    sessionLocs_(session).forEach(function (l) {
      if (locations.indexOf(l) === -1) locations.push(l);
    });
  }

  // ยอดคงเหลือเป็นข้อมูลของเจ้าของร้าน ไม่ส่งให้พนักงานเลย
  // ซ่อนแค่ฝั่งหน้าเว็บไม่พอ เปิด Network ในเบราว์เซอร์ก็อ่านคำตอบได้
  var stock = !owner ? [] : locations.filter(function (loc) {
    return stockCanUseLoc_(session, loc);
  }).map(function (loc) {
    var m = bal[loc] || {};
    return {
      name: loc,
      rows: items.filter(function (it) { return m[it.name]; }).map(function (it) {
        var have = Number(m[it.name]) || 0;
        var lowPacks = lowPacksFor_(it, loc);
        var limit = lowPacks > 0 ? lowPacks * it.perPack * perStickOf_(it) : 0;
        return { item: it.name, base: have, text: fmtPack_(have, it),
                 low: limit > 0 && have <= limit };
      })
    };
  });

  return { success: true, data: {
    // ส่งรุ่นของหลังบ้านไปด้วย หน้าเว็บจะได้โชว์ให้เห็นว่ากำลังคุยกับตัวไหนอยู่
    // เวลาเจอ "ทำไมไม่ขึ้น" จะได้แยกออกว่าเป็นเพราะยิงไป deployment เก่า
    version: BACKEND_VERSION,
    role: session.role, stockRole: stockRoleOf_(session),
    name: session.name, branch: session.branch, branches: sessionLocs_(session),
    central: CENTRAL, locations: locations, items: items, stock: stock
  } };
}

/* ───────────────────────── ติดตั้งชีตรายการสินค้า ───────────────────────── */

/**
 * สร้างชีตที่ระบบสต็อกต้องใช้ แล้วเขียนแคตตาล็อกลงไป
 * รายชื่อสินค้าอยู่ที่ itemCatalogue_() ที่เดียว ไม่มีลิสต์ตั้งต้นซ้ำอีกชุด
 * รันซ้ำได้ ไม่ลบข้อมูลเดิม
 */
function setupStock() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss.getSheetByName(SHEET_ITEMS)) ss.insertSheet(SHEET_ITEMS);
  cacheClear_();
  ensureCols_(sheet_(SHEET_ITEMS), ITEM_COLS);

  // เติมคอลัมน์ แพ็ค / เศษ / ไม้ต่อแพ็ค / ประเภท ให้ชีตประวัติ (ต่อท้าย ไม่แตะของเดิม)
  [SHEET_INCOMING, SHEET_COUNT, SHEET_WASTE].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    ensureCols_(sh, MOVE_COLS);
  });
  if (!ss.getSheetByName(SHEET_PACK)) ss.insertSheet(SHEET_PACK);
  cacheClear_();
  ensureCols_(sheet_(SHEET_PACK), PACK_COLS);

  // ปลดกฎที่ล็อกหน่วยไว้แค่ ไม้/กรัม/ชิ้น — ตอนนี้มี ถุง มัด ใบ ขวด กก. ด้วย
  clearStockValidation_();

  Logger.log('ติดตั้งเรียบร้อย — สร้างชีตครบแล้ว\n' +
             'รัน fixItemList ต่อ จะเขียนรายการสินค้า หน่วย ราคา และ 1 แพ็ค = 10 ให้เอง\n' +
             'เหลือที่ต้องกรอกเองในชีต "' + SHEET_ITEMS + '":\n' +
             '  • เตือนเมื่อเหลือ(แพ็ค) = ครัวกลางเหลือกี่แพ็คให้เตือนไลน์ (เว้นว่าง = ไม่เตือน)\n' +
             '  • เตือนสาขาเมื่อเหลือ(แพ็ค) = จุดเตือนของสาขา (เว้นว่าง = ใช้ตัวเดียวกับครัวกลาง)\n' +
             'เสร็จแล้วอย่าลืม Deploy เวอร์ชันใหม่');
}

/* ───────────────────── ย้ายข้อมูลจากชีตของระบบเก่า ───────────────────── */

/**
 * ระบบเก่า (repo check-) แยกเป็น 2 ชีต "ของเข้าครัวกลาง" กับ "ของเข้าร้าน"
 * ระบบนี้ใช้ "จำนวนของเข้า" ชีตเดียว แยกด้วยคอลัมน์ ประเภท
 * เพราะบอทแจ้งวันหมดอายุกับแท็บคำนวณของหายอ่านชีตนั้นอยู่แล้ว
 *
 * ฟังก์ชันนี้ย้ายแถวจาก 2 ชีตเก่ามารวมไว้ที่ "จำนวนของเข้า"
 * รันซ้ำได้ ไม่ย้ายซ้ำ (จำว่าย้ายถึงแถวไหนแล้ว) และไม่ลบชีตเก่าให้
 * ดูผลว่าถูกต้องแล้วค่อยลบชีตเก่าเองทีหลัง
 *
 * ⚠️ ย้ายเสร็จแล้ว "ต้องไปรัน setupTriggers ในโปรเจกต์ line-expiry-alert ด้วย"
 *    ไม่งั้นบอทจะเห็นแถวที่เพิ่งย้ายมาเป็นของเข้าใหม่ แล้วยิงไลน์ย้อนหลังทั้งกอง
 */
function migrateOldStockSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dest = ss.getSheetByName(SHEET_INCOMING);
  if (!dest) { Logger.log('ไม่พบชีต "' + SHEET_INCOMING + '" — รัน setupStock ก่อน'); return; }
  var dmap = ensureCols_(dest, MOVE_COLS);

  var perPackOf = {}, subUnitOf = {};
  getStockItems_().forEach(function (i) { perPackOf[i.name] = i.perPack; subUnitOf[i.name] = i.subUnit; });

  var props = PropertiesService.getScriptProperties();
  var total = 0;

  [['ของเข้าครัวกลาง', 'ของเข้าครัวกลาง'], ['ของเข้าร้าน', 'ของเข้าร้าน']].forEach(function (pair) {
    var srcName = pair[0], kind = pair[1];
    var src = ss.getSheetByName(srcName);
    if (!src || src.getLastRow() < 2) { Logger.log('ข้าม "' + srcName + '" — ไม่มีข้อมูล'); return; }

    var values  = src.getDataRange().getValues();
    var headers = values[0].map(function (h) { return String(h).trim(); });
    function col() {
      for (var a = 0; a < arguments.length; a++) {
        var i = headers.indexOf(arguments[a]);
        if (i !== -1) return i;
      }
      return -1;
    }
    var cDate = col('วันที่', 'วันที่เวลา'),
        cItem = col('สินค้า', 'รายการ'),
        cLoc  = col('สาขา', 'สถานที่'),
        cPack = col('แพ็ค'),
        cRem  = col('เศษ'),
        cTot  = col('รวม(หน่วยย่อย)', 'จำนวน'),
        cBy   = col('ผู้บันทึก', 'ผู้ตรวจ'),
        cNote = col('หมายเหตุ');
    if (cItem === -1) { Logger.log('ข้าม "' + srcName + '" — ไม่เจอคอลัมน์สินค้า'); return; }

    var key  = 'MIGRATED_ROWS_' + srcName;
    var from = parseInt(props.getProperty(key) || '1', 10);   // 1 = ข้ามหัวตาราง
    var moved = 0;

    for (var r = from; r < values.length; r++) {
      var row  = values[r];
      var name = String(row[cItem] || '').trim();
      if (!name) continue;

      var packs = cPack !== -1 ? Number(row[cPack]) || 0 : 0;
      var rem   = cRem  !== -1 ? Number(row[cRem])  || 0 : 0;
      var per   = perPackOf[name] || 0;
      var tot   = cTot !== -1 ? Number(row[cTot]) || 0 : 0;
      // ไม่มียอดรวมมาให้ ก็คำนวณจากแพ็ค+เศษ
      if (!tot && per > 0) tot = toBase_(packs, rem, 0, { perPack: per, perStick: 1 });
      // ไม่รู้ว่ากี่ไม้ต่อแพ็ค ก็ถอดกลับจากยอดรวมที่มี
      if (!per && packs > 0 && tot > rem) per = Math.round((tot - rem) / packs);

      var out = {};
      out['วันที่เวลา'] = cDate !== -1 && row[cDate] ? row[cDate] : new Date();
      out['สาขา']      = kind === 'ของเข้าครัวกลาง' ? CENTRAL
                       : (cLoc !== -1 ? String(row[cLoc] || '').trim() : '');
      out['ผู้ตรวจ']    = cBy !== -1 ? String(row[cBy] || '') : '';
      out['รายการ']    = name;
      out['จำนวน']     = tot;
      out['หน่วย']     = subUnitOf[name] || 'ไม้';
      out['แพ็ค']      = packs;
      out['เศษ']       = rem;
      out['ไม้ต่อแพ็ค'] = per;
      out['ประเภท']    = kind;
      out['หมายเหตุ']  = (cNote !== -1 ? String(row[cNote] || '') : '');
      appendByCols_(dest, dmap, out);
      moved++;
    }

    props.setProperty(key, String(values.length));
    total += moved;
    Logger.log('ย้ายจาก "' + srcName + '" ' + moved + ' แถว');
  });

  Logger.log('─────────────────────────────\n' +
             'ย้ายมาที่ "' + SHEET_INCOMING + '" รวม ' + total + ' แถว\n\n' +
             'ต่อไป:\n' +
             '1) เปิดชีต "' + SHEET_INCOMING + '" ดูว่าข้อมูลถูกต้อง\n' +
             '2) ไปรัน setupTriggers ในโปรเจกต์ line-expiry-alert\n' +
             '   (สำคัญ ไม่งั้นบอทจะแจ้งไลน์ย้อนหลังทั้งกอง)\n' +
             '3) ถูกต้องแล้วค่อยลบชีต "ของเข้าครัวกลาง" กับ "ของเข้าร้าน" ทิ้ง');
}

/* ───────────────── ล้างข้อมูลเก่าออกจากชีตประวัติ ───────────────── */

/**
 * ย้ายข้อมูลเดิมไปเก็บในชีตสำรอง แล้วล้างชีตต้นทางให้เหลือแต่หัวตาราง
 * ไม่ได้ลบทิ้ง — ข้อมูลเดิมยังอยู่ในชีตสำรอง เปิดดูหรือย้ายกลับได้
 *
 * คืนจำนวนแถวที่ย้าย
 */
function archiveSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { Logger.log('ข้าม "' + name + '" — ไม่มีชีตนี้'); return 0; }

  var rows = sh.getLastRow() - 1;          // ไม่นับหัวตาราง
  if (rows < 1) { Logger.log('ข้าม "' + name + '" — ไม่มีข้อมูลอยู่แล้ว'); return 0; }

  // ตั้งชื่อชีตสำรองไม่ให้ซ้ำ เผื่อล้างหลายรอบ
  var stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var base  = name + ' (เก่า ' + stamp + ')';
  var backup = base, n = 2;
  while (ss.getSheetByName(backup)) { backup = base + ' #' + n; n++; }

  sh.copyTo(ss).setName(backup);
  sh.getRange(2, 1, rows, sh.getLastColumn()).clearContent();

  Logger.log('"' + name + '" ย้าย ' + rows + ' แถวไปที่ "' + backup + '" แล้วล้างให้เหลือหัวตาราง');
  return rows;
}

/**
 * ล้างประวัติเช็คสต็อกทิ้ง เริ่มนับใหม่จากศูนย์
 * ของเดิมย้ายไปชีตสำรอง ไม่ได้หายไปไหน
 *
 * ใช้เมื่อ: ชีตมีข้อมูลจากระบบเก่าปนอยู่ และยังไม่เคยนับด้วยระบบใหม่เลย
 */
function resetCountSheet() {
  var moved = archiveSheet_(SHEET_COUNT);
  Logger.log('─────────────────────────────\n' +
             'ล้างประวัติเช็คสต็อกแล้ว (' + moved + ' แถว)\n\n' +
             'ต่อไป: เข้าหน้าสต็อก แท็บ "เช็คสต็อก" นับให้ครบทุกรายการ 1 รอบ\n' +
             'ยอดที่นับได้จะกลายเป็นยอดตั้งต้นของทุกสถานที่');
}

/**
 * ล้างประวัติของเสียทิ้ง
 */
function resetWasteSheet() {
  var moved = archiveSheet_(SHEET_WASTE);
  Logger.log('ล้างประวัติของเสียแล้ว (' + moved + ' แถว)');
}

/**
 * ล้างประวัติของเข้าทิ้ง — คิดให้ดีก่อนใช้
 *
 * ชีตนี้ไม่ได้ใช้แค่เรื่องสต็อก ยังเป็นฐานของอีก 2 อย่าง:
 *   • บอทแจ้งวันหมดอายุ อ่านชีตนี้หาว่าของชิ้นไหนต้องทิ้งวันไหน
 *   • แท็บคำนวณของหาย ใช้เป็นยอด "ของเข้า" ในสูตร
 * ล้างแล้วสองอย่างนี้จะมองไม่เห็นของที่เข้ามาก่อนหน้านี้
 *
 * ล้างเสร็จต้องไปรัน setupTriggers ในโปรเจกต์ line-expiry-alert ด้วย
 * ไม่งั้นบอทจะนับแถวเพี้ยนแล้วแจ้งซ้ำ
 */
function resetIncomingSheet() {
  var moved = archiveSheet_(SHEET_INCOMING);
  Logger.log('ล้างประวัติของเข้าแล้ว (' + moved + ' แถว)\n\n' +
             '⚠️ ต้องไปรัน setupTriggers ในโปรเจกต์ line-expiry-alert ต่อ\n' +
             '   ไม่งั้นบอทแจ้งของเข้าจะนับแถวเพี้ยน');
}

/* ═══════════════════════════════════════════════════════════════
   แคตตาล็อกสินค้า — ของไหลผ่าน 3 ชั้น

     1) วัตถุดิบ   ซื้อมาเป็นโล เข้าครัวกลาง        (หน่วย กก.)
     2) ของแพ็ค    ครัวกลางเอาวัตถุดิบมาแพ็ค        (1 แพ็ค = 10 ไม้/ถุง)
     3) ส่งร้าน     ส่งเฉพาะของที่แพ็คแล้ว           (นับเป็นแพ็ค)

   ชีต "รายการสินค้า" เป็นที่เก็บจริง ตารางข้างล่างคือค่าตั้งต้น
   รัน fixItemList() แล้วมันจะเขียนลงชีตให้ รันซ้ำได้
   ═══════════════════════════════════════════════════════════════ */

/** 1 แพ็ค = กี่ไม้ / กี่ถุง */
var PACK_SIZE = 10;

/** ของที่แพ็คไม่เท่า 10 ไม้ — ใส่เฉพาะตัวที่ต่าง */
var PACK_SIZE_EXCEPTION = {
  'อกไก่': 20,
  // มาม่าซื้อมาเป็นแพ็คของโรงงาน ไม่ได้แบ่งเอง — แพ็คละ 4 ห่อทั้งสองสี
  'มาม่า 35 ชมพู': 4,
  'มาม่า 35 ส้ม': 4
};

/**
 * ลูกชิ้นที่เสียบไม้ละหลายชิ้น — ใส่เฉพาะตัวที่ไม่ใช่ไม้ละชิ้น
 * ของพวกนี้เศษมี 2 แบบ ครบไม้แต่ไม่ครบแพ็ค (นับเป็นไม้)
 * กับไม่ครบไม้ (นับเป็นชิ้น) ยอดคงเหลือเลยเก็บเป็นชิ้น
 * ตัวไหนยังไม่รู้ว่าไม้ละกี่ชิ้น เว้นไว้ก่อน แล้วกรอกในชีตทีหลังได้
 */
var PIECES_PER_STICK = {
  'เต้าชีส': 2,
  'เต้าหู้หมู': 4
};

/** ราคาขายต่อไม้/ต่อถุง ถ้าไม่ได้ระบุไว้ในตาราง */
var PRICE_DEFAULT = 10;

/** ของดิบใช้ชื่อเดียวกับของแพ็ค เลยต่อท้ายให้ต่างกัน */
var RAW_SUFFIX = ' (ดิบ)';
function rawName_(base) { return String(base || '').trim() + RAW_SUFFIX; }

/**
 * ของดิบที่ซื้อมาชั่งเป็นโล — ที่เหลือซื้อมาเป็นถุง/แพ็ค
 * หน่วยนี้คือ "หน่วยที่ซื้อ" ไม่ใช่หน่วยที่ขาย แก้ในชีตได้ถ้าเจ้าประจำเปลี่ยน
 */
var RAW_KG = [
  'หมูสามชั้น', 'สันคอ', 'สันนอก', 'หัวไหล่หมู', 'อกไก่',
  'ผักกาดขาว', 'ผักบุ้ง', 'กวางตุ้ง', 'มันฝรั่ง', 'ฟักทอง', 'รากบัว',
  'กระเจี๊ยบ', 'ข้าวโพดฝัก',
  // มันเทศเป็นเส้นมัด ๆ ซื้อเป็นอัน ไม่ได้ชั่ง เลยไม่อยู่ในนี้
  'เห็ดเข็ม', 'เห็ดออเร็นจิ', 'เห็ดหูหนู', 'เห็ดหอม',
  'ดอลลี่', 'แมงกะพรุน', 'ปลาหมึกกรอบ'
  // เห็ดชิเมจิ กับ สาหร่าย ซื้อเป็นห่อ ไม่ได้ชั่ง เลยไม่อยู่ในนี้
];
var RAW_BAG = { 'เห็ดชิเมจิ': 'ห่อ', 'สาหร่าย': 'ห่อ', 'มันเทศ': 'อัน' };

/**
 * ของดิบที่ซื้อได้ทั้งแบบชั่งโลและแบบยกถุง — บอกว่าถุงละกี่ กก.
 * ยอดคงเหลือเก็บเป็น กก. อย่างเดียว ซื้อมาเป็นถุงระบบคูณให้เอง
 * ไม่ใส่ไว้ = พิมพ์ "2 ถุง" มาแล้วระบบไม่รู้ว่ากี่โล จะเตือนแทนการเดา
 */
var RAW_BAG_KG = {
  // 'ดอลลี่': 1,   ← ใส่น้ำหนักจริงต่อถุงแล้วปลดคอมเมนต์
};
function rawBagKg_(base) {
  var n = Number(RAW_BAG_KG[String(base || '').trim()]);
  return n > 0 ? n : 0;
}
function rawUnitOf_(base) {
  if (RAW_KG.indexOf(base) !== -1) return 'กก.';
  return RAW_BAG[base] || 'ถุง';
}

/**
 * ของที่ส่งร้านได้ — [ชื่อ, วัตถุดิบ, หมายเหตุ]
 *
 * วัตถุดิบ
 *   ''        ของที่แค่เอามาเสียบไม้/จัดใส่ถุง ตัดจากของดิบชื่อเดียวกันเอง
 *             (เต้าหู้ชีส 1 ถุงดิบ → เต้าหู้ชีส 1 แพ็ค เศษ 3 ไม้)
 *   [a, b]    ของที่พัน ต้องใช้หลายอย่าง ตัดออกทุกตัวตอนแพ็ค
 *             (หมูพันเห็ดชิเมจิ ตัดทั้งหมูสามชั้นและเห็ดชิเมจิ)
 *
 * ราคาเว้นไว้ = PRICE_DEFAULT (แก้ในชีตได้)
 */

// ── แบบเสียบไม้ · 1 แพ็คส่งร้าน = 10 ไม้ ──
var STICK_ITEMS = [
  ['หมูพันเห็ดเข็มทอง',   ['หมูสามชั้น', 'เห็ดเข็ม'],    ''],
  ['หมูพันสาหร่าย',       ['หมูสามชั้น', 'สาหร่าย'],     ''],
  ['หมูพันเห็ดชิเมจิ',     ['หมูสามชั้น', 'เห็ดชิเมจิ'],   ''],
  ['พันผักกาดขาว',        ['หมูสามชั้น', 'ผักกาดขาว'],   ''],
  ['สันนอกสไลด์',         ['สันนอก'],    ''],
  ['หัวไหล่หมูสไลด์ (ไม้)', ['หัวไหล่หมู'], 'ของเดียวกับแบบถุง แต่คนละวิธีแพ็ค นับแยกกัน'],
  ['อกไก่',               ['อกไก่'],      ''],
  ['ดอลลี่',              '',            ''],
  ['แมงกะพรุน',           '',            ''],
  ['ปลาหมึกกรอบ',         '',            ''],
  ['เต้าชีส',             '',            ''],
  ['หลายสี',              '',            ''],
  ['เบคอนพันไส้กรอก',     '',            'ซื้อมาพันเสร็จแล้ว แค่เสียบไม้'],
  ['ฟองเต้าหู้สามเหลี่ยม', '',            ''],
  ['ข้าวโพดฝัก',          '',            ''],
  ['เห็ดออเร็นจิ',         '',            ''],
  ['เห็ดหูหนู',           '',            ''],
  ['ปูอัดยาว',            '',            ''],
  ['ไส้กรอกชีส',          '',            ''],
  ['เต้าหู้หลอด',         '',            ''],
  ['ไส้กรอกอันเล็ก',      '',            ''],
  ['เต้าหู้หมู',          '',            ''],
  ['เต้าหู้ปลา',          '',            'ทรงสี่เหลี่ยม'],
  ['เต้าหู้ปลาแผ่น',      '',            ''],
  ['มันฝรั่ง',            '',            ''],
  // เจ้าของยืนยันว่ายังขายอยู่ ถึงไม่ได้อยู่ในลิสต์ที่ส่งมารอบล่าสุด
  ['กระเจี๊ยบ',           '',            ''],
  ['เห็ดหอม',             '',            '']
];

// ── แบบใส่ถุง · 1 แพ็คส่งร้าน = 10 ถุง ──
var BAG_ITEMS = [
  ['สันคอสไลด์',           ['สันคอ'],      ''],
  ['หัวไหล่หมูสไลด์ (ถุง)', ['หัวไหล่หมู'], 'ของเดียวกับแบบไม้ แต่คนละวิธีแพ็ค นับแยกกัน'],
  ['ผักกาดขาว',            '',             ''],
  ['ผักบุ้ง',               '',             ''],
  ['กวางตุ้ง',              '',             ''],
  ['เห็ดเข็ม',              '',             ''],
  ['ราเมง',                '',             ''],
  ['มาม่า',                '',             ''],
  ['มาม่า 35 ส้ม',         '',             ''],
  ['มาม่า 35 ชมพู',        '',             ''],
  ['ฟองเต้าหู้ม้วน',        '',             ''],
  ['อุด้ง',                '',             ''],
  ['ต็อกแท่งเล็ก',          '',             ''],
  ['มันเทศ',               '',             ''],
  ['วุ้นเส้นหม่าล่า',        '',             ''],
  ['ชีส',                  '',             ''],
  ['ฟักทอง',                '',             ''],
  ['รากบัว',               '',             'เสียบไม้ไม่ได้ แพ็คใส่ถุง'],
  ['วุ้นเส้นเกาหลี',         '',             '']
];

/** ของในกลุ่ม "ใส่ถุง" ที่จริง ๆ ตักใส่ถ้วย ไม่ได้ใส่ถุง */
var BAG_UNIT = {
  'มาม่า 35 ส้ม': 'ห่อ', 'มาม่า 35 ชมพู': 'ห่อ',
  'ชีส': 'ถ้วย',
  'ต็อกแท่งเล็ก': 'ถ้วย'
};

/** ราคาที่ไม่ใช่ 10 บาท — ใส่เฉพาะตัวที่ต่าง */
var PRICE_EXCEPTION = {
  'มาม่า 35 ส้ม': 35,
  'มาม่า 35 ชมพู': 35
};

/**
 * แคตตาล็อกทั้งหมด — ของแพ็ค + ของดิบที่มันใช้
 * ของดิบไม่ได้พิมพ์เป็นลิสต์แยก แต่งอกจากช่องวัตถุดิบของของแพ็ค
 * จะได้ไม่มีของดิบลอย ๆ ที่ไม่มีใครใช้ค้างอยู่ในชีต
 */
function itemCatalogue_() {
  var out = [], rawSeen = {};

  function addPacked(row, subUnit) {
    var name = row[0], spec = row[1], note = row[2];
    var per = PACK_SIZE_EXCEPTION[name] || PACK_SIZE;
    // ตัวที่แพ็คไม่เท่าชาวบ้าน เขียนบอกไว้ในชีตเลย จะได้ไม่ต้องจำ
    if (!note && per !== PACK_SIZE) note = 'แพ็คละ ' + per + ' ' + subUnit;

    // ไม่ได้ระบุวัตถุดิบ = ของที่ซื้อมาแล้วเอามาเสียบ/จัดใส่ถุงเอง
    // ตัดจากของดิบชื่อเดียวกัน ฟอร์มแพ็คไม่ต้องถามว่าใช้อะไร
    var bases = (spec && spec.length) ? spec : [name];
    bases.forEach(function (b) { rawSeen[b] = true; });

    out.push({
      name: name, kind: KIND_PACKED,
      subUnit: subUnit, packUnit: 'แพ็ค', perPack: per,
      perStick: PIECES_PER_STICK[name] || 1,
      price: PRICE_EXCEPTION[name] || PRICE_DEFAULT,
      scope: '', raws: bases.map(rawName_), note: note
    });
  }

  STICK_ITEMS.forEach(function (r) { addPacked(r, 'ไม้'); });
  BAG_ITEMS.forEach(function (r) { addPacked(r, BAG_UNIT[r[0]] || 'ถุง'); });

  // ของดิบ — อยู่แค่ครัวกลาง ไม่มีราคาขาย เพราะยังขายไม่ได้
  // ถ้าใส่ราคา มันจะไปโผล่เป็นยอด "ควรได้" ในแท็บคำนวณของหาย ทั้งที่ยังไม่ได้ขาย
  Object.keys(rawSeen).forEach(function (base) {
    var u = rawUnitOf_(base);
    out.push({
      name: rawName_(base), kind: KIND_RAW,
      subUnit: u, packUnit: u, perPack: 1, perStick: 1,
      price: 0, scope: SCOPE_CENTRAL, raws: [],
      note: 'ซื้อเป็น' + u + ' เข้าครัวกลาง แพ็คแล้วระบบตัดออกให้เอง' +
            (rawBagKg_(base) ? ' · ยกถุงได้ ถุงละ ' + rawBagKg_(base) + ' กก.' : '')
    });
  });

  return out;
}

/**
 * เขียนแคตตาล็อกลงชีตรายการสินค้า
 *   • ยังไม่มี  → เพิ่มแถวใหม่
 *   • มีอยู่แล้ว → เขียนทับหน่วย ราคา ชนิด วัตถุดิบ (ช่องเตือนไม่แตะ เจ้าของตั้งเอง)
 * รันซ้ำได้ รอบสองไม่มีอะไรเปลี่ยน
 */
function applyItemCatalogue() {
  var sh = sheet_(SHEET_ITEMS);
  if (!sh) { Logger.log('ไม่พบชีต "' + SHEET_ITEMS + '" — รัน setupStock ก่อน'); return; }
  clearStockValidation_();
  var map = ensureCols_(sh, ITEM_COLS);

  var rowOf = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, map['สินค้า'] + 1, sh.getLastRow() - 1, 1).getValues()
      .forEach(function (r, i) {
        var n = String(r[0] || '').trim();
        if (n && !rowOf[n]) rowOf[n] = i + 2;
      });
  }

  var added = [], updated = [], news = [];
  itemCatalogue_().forEach(function (it) {
    var vals = {};
    vals['สินค้า'] = it.name;
    vals['หน่วยย่อย'] = it.subUnit;
    vals['หน่วยแพ็ค'] = it.packUnit;
    vals['หน่วยย่อยต่อแพ็ค'] = it.perPack;
    // ชิ้นต่อไม้เขียนเฉพาะตัวที่รู้ค่าแล้ว ที่เหลือปล่อยว่างให้เจ้าของกรอกเอง
    // ถ้าเขียนทับด้วยค่าว่างทุกรอบ ที่กรอกไว้จะหายทุกครั้งที่รัน fixItemList
    if (it.perStick && it.perStick > 1) vals['ชิ้นต่อไม้'] = it.perStick;
    vals['ราคาขาย/หน่วยย่อย'] = it.price || '';
    vals['ใช้ที่'] = it.scope;
    vals['ชนิด'] = it.kind;
    vals['วัตถุดิบ'] = (it.raws || []).join(', ');

    var row = rowOf[it.name];
    if (!row) {
      vals['หมายเหตุ'] = it.note;
      news.push(vals);
      added.push(it.name);
      return;
    }
    Object.keys(vals).forEach(function (k) {
      if (k === 'สินค้า') return;
      sh.getRange(row, map[k] + 1).setValue(vals[k]);
    });
    if (it.note) {
      sh.getRange(row, map['หมายเหตุ'] + 1).setValue(it.note);
    } else if (isSystemNote_(sh.getRange(row, map['หมายเหตุ'] + 1).getValue())) {
      // ข้อความที่ระบบเคยเขียนเองแล้วเลิกใช้ ลบทิ้งได้ — ที่เจ้าของพิมพ์เองไม่แตะ
      sh.getRange(row, map['หมายเหตุ'] + 1).clearContent();
    }
    updated.push(it.name);
  });
  appendRows_(sh, map, news);

  Logger.log('เพิ่มใหม่ ' + added.length + ' รายการ' + (added.length ? ':\n  ' + added.join('\n  ') : ''));
  Logger.log('อัปเดตของเดิม ' + updated.length + ' รายการ');
  Logger.log('\nเหลือที่ต้องกรอกเองในชีต: เตือนเมื่อเหลือ(แพ็ค) — เหลือกี่แพ็คให้เตือนไลน์');
}

/** ข้อความหมายเหตุที่ระบบเคยเขียนเอง — เจอแล้วลบได้ ไม่ใช่ของที่เจ้าของพิมพ์ */
var SYSTEM_NOTES = [
  'ของแพง', 'ของแพง คนกินเยอะ',
  'ของใช้/วัตถุดิบ ไม่ได้ขายเป็นชิ้น'
];
function isSystemNote_(v) {
  var n = String(v == null ? '' : v).trim();
  return !!n && SYSTEM_NOTES.indexOf(n) !== -1;
}

/**
 * ลบของที่ไม่อยู่ในแคตตาล็อกแล้ว
 * ไม่แตะชีตประวัติ ของเก่าที่เคยลงไว้ยังอยู่ครบ ไว้ดูย้อนหลังได้
 */
function removeDiscontinuedItems() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = sheet_(SHEET_ITEMS);
  if (!sh) { Logger.log('ไม่พบชีต "' + SHEET_ITEMS + '"'); return; }
  var map = ensureCols_(sh, ITEM_COLS);
  var last = sh.getLastRow();
  if (last < 2) return;

  // ของที่ต้องเหลือไว้ = แคตตาล็อก + ของใช้/บรรจุภัณฑ์
  var keep = {};
  itemCatalogue_().forEach(function (it) { keep[it.name] = true; });
  SUPPLY_ITEMS.forEach(function (it) { keep[it[0]] = true; });

  var vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var drop = [], names = [];
  vals.forEach(function (r, i) {
    var n = String(r[map['สินค้า']] || '').trim();
    if (n && !keep[n]) { drop.push(i + 2); names.push(n); }
  });
  drop.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
  cacheClear_();

  // เตือนถ้าของที่ลบยังมียอดค้างอยู่ — ต้องล้างยอดก่อน ไม่งั้นค้างในระบบตลอดไป
  var bal = stockBalances_(), stuck = [];
  Object.keys(bal).forEach(function (loc) {
    Object.keys(bal[loc]).forEach(function (item) {
      if (!keep[item] && Number(bal[loc][item])) stuck.push(loc + ' · ' + item + ' = ' + bal[loc][item]);
    });
  });

  Logger.log('ลบของที่ไม่ได้ใช้แล้ว ' + names.length + ' รายการ' +
             (names.length ? ':\n  ' + names.join('\n  ') : ''));
  if (stuck.length) {
    Logger.log('\n⚠️ ของที่ลบไปยังมียอดค้างอยู่ ' + stuck.length + ' รายการ:\n  ' + stuck.join('\n  ') +
               '\n  รัน zeroOutAllStock() ถ้าจะล้างให้เป็น 0');
  }
}

/* ───────────── รวมชื่อสินค้าที่เรียกไม่ตรงกันให้เป็นชื่อเดียว ───────────── */

/**
 * ชื่อเดิมในชีต → ชื่อที่จะใช้จริง
 * ของเดียวกันแต่เรียกคนละชื่อ ถ้าปล่อยไว้ยอดคงเหลือจะแตกเป็นสองแถว
 */
var ITEM_RENAME = {
  'ปลาดอลลี่':           'ดอลลี่',
  'เห็ดออรินจิ':          'เห็ดออเร็นจิ',
  'สาหร่าย':             'สาหร่ายกระปุก',
  'ไส้กรอกพันเบคอน':     'เบคอนพันไส้กรอก',
  'ฟองเต้าหู้':           'ฟองเต้าหู้ม้วน',
  // ── ปรับตามรายการที่ส่งร้านจริง ──
  'สามชั้นพันเห็ดเข็ม':    'หมูพันเห็ดเข็มทอง',
  // ชื่อที่เขียนกันในใบส่งของ — ของเดียวกับที่มีอยู่แล้ว คนละชื่อเรียก
  'สามชั้นไม้':          'หัวไหล่หมูสไลด์ (ไม้)',
  'หมูไม้':              'สันนอกสไลด์',
  'หัวไหล่หมูเสียบไม้':   'หัวไหล่หมูสไลด์ (ไม้)',
  'สันนอกเสียบไม้':      'สันนอกสไลด์',
  'สามชั้นพันเห็ดชิเมจิ':  'หมูพันเห็ดชิเมจิ',
  'พันชิเมจิ':            'หมูพันเห็ดชิเมจิ',
  'สามชั้นพันผักกาดขาว':  'พันผักกาดขาว',
  'แผ่นยาว':             'เต้าหู้ปลาแผ่น',
  'สามชั้นพันเห็ดเข็มทอง': 'หมูพันเห็ดเข็มทอง',
  'สามชั้นพันสาหร่าย':    'หมูพันสาหร่าย',
  'สามชั้นสไลด์':         'หมูพันเห็ดเข็มทอง',
  'เต้าหู้ชีส':           'เต้าชีส',
  'ชีสหลายสี':           'หลายสี',
  'เห็ดหูหนูขาว':         'เห็ดหูหนู',
  'เห็ดเข็มทอง':          'เห็ดเข็ม',
  'เส้นมันเทศ':          'มันเทศ',
  'เส้นอุด้ง':            'อุด้ง',
  'วุ้นเส้น':             'วุ้นเส้นหม่าล่า',
  'มาม่า(เส้นเปล่า)':      'มาม่า',
  'มาม่า35 ส้ม':          'มาม่า 35 ส้ม',
  'มาม่า35ส้ม':           'มาม่า 35 ส้ม',
  'มาม่า35 ชมพู':         'มาม่า 35 ชมพู',
  'มาม่า35ชมพู':          'มาม่า 35 ชมพู',
  'เต้าหู้ปลาสี่เหลี่ยม':    'เต้าหู้ปลา',
  'สันนอก':              'สันนอกสไลด์',
  'ข้าวโพด':             'ข้าวโพดฝัก',
  'ข้าวโพดฝักใหญ่':       'ข้าวโพดฝัก',
  'มันญี่ปุ่น':            'มันฝรั่ง',
  // รุ่นก่อนตั้งชื่อของดิบว่า "(โล)" แต่ของดิบบางอย่างซื้อเป็นถุง ไม่ใช่โล
  'สันคอ (โล)':          'สันคอ (ดิบ)',
  'สันนอก (โล)':         'สันนอก (ดิบ)',
  'หัวไหล่หมู (โล)':      'หัวไหล่หมู (ดิบ)',
  'หมูสามชั้น (โล)':      'หมูสามชั้น (ดิบ)',
  'อกไก่ (โล)':          'อกไก่ (ดิบ)',
  'ผักกาดขาว (โล)':      'ผักกาดขาว (ดิบ)',
  'ผักบุ้ง (โล)':         'ผักบุ้ง (ดิบ)',
  'กวางตุ้ง (โล)':        'กวางตุ้ง (ดิบ)',
  'เห็ดเข็ม (โล)':        'เห็ดเข็ม (ดิบ)',
  'ต็อก (แป้งต็อก)':       'ต็อกแท่งเล็ก'
  // หมายเหตุ: "หัวไหล่หมูสไลด์" เดิม ไม่ได้แมปอัตโนมัติ
  // เพราะตอนนี้แยกเป็น (ไม้) กับ (ถุง) ระบบเดาแทนไม่ได้ว่าของเก่าเป็นแบบไหน
  // removeDiscontinuedItems จะเตือนถ้ายังมียอดค้างอยู่
};

/** ชีตที่เก็บชื่อสินค้าไว้ในคอลัมน์ "รายการ" */
function historySheets_() { return [SHEET_INCOMING, SHEET_COUNT, SHEET_WASTE, SHEET_PACK]; }

/**
 * เปลี่ยนชื่อสินค้าตาม ITEM_RENAME ทั้งในชีตรายการสินค้าและชีตประวัติ
 *   • ถ้าชื่อใหม่ยังไม่มีในชีตสินค้า → เปลี่ยนชื่อแถวเดิมเลย
 *   • ถ้ามีทั้งสองชื่อ → ยกค่าที่แถวใหม่ยังว่างจากแถวเดิมมาเติม แล้วลบแถวเดิมทิ้ง
 *     (แถวเดิมมักมีหน่วย/หมายเหตุครบกว่า แถวใหม่มักมีแค่ชื่อกับราคา)
 * รันซ้ำได้ รอบสองจะไม่เจออะไรให้เปลี่ยน
 */
function mergeItemNames() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_ITEMS);
  if (!sh) { Logger.log('ไม่พบชีต "' + SHEET_ITEMS + '"'); return; }
  var map = ensureCols_(sh, ITEM_COLS);
  var cName = map['สินค้า'];

  var width = sh.getLastColumn();
  var last  = sh.getLastRow();
  if (last < 2) { Logger.log('ยังไม่มีสินค้าในชีต'); return; }

  var vals = sh.getRange(2, 1, last - 1, width).getValues();
  var rowOf = {};
  vals.forEach(function (r, i) {
    var n = String(r[cName] || '').trim();
    if (n && !rowOf[n]) rowOf[n] = i + 2;      // เจอชื่อซ้ำ เอาแถวแรก
  });

  var renamed = [], merged = [], dropRows = [];

  Object.keys(ITEM_RENAME).forEach(function (oldName) {
    var newName = ITEM_RENAME[oldName];
    var oldRow = rowOf[oldName], newRow = rowOf[newName];
    if (!oldRow) return;                        // ไม่มีชื่อเดิมอยู่แล้ว

    if (!newRow) {
      sh.getRange(oldRow, cName + 1).setValue(newName);
      renamed.push(oldName + ' → ' + newName);
      return;
    }
    // มีทั้งสองชื่อ — เติมช่องที่แถวใหม่ยังว่าง จากแถวเดิม
    var oldVals = vals[oldRow - 2], newVals = vals[newRow - 2];
    for (var c = 0; c < width; c++) {
      if (c === cName) continue;
      var isBlank = newVals[c] === '' || newVals[c] === null;
      if (isBlank && oldVals[c] !== '' && oldVals[c] !== null) {
        sh.getRange(newRow, c + 1).setValue(oldVals[c]);
      }
    }
    dropRows.push(oldRow);
    merged.push(oldName + ' → ' + newName);
  });

  // ลบจากล่างขึ้นบน เลขแถวข้างบนจะได้ไม่ขยับ
  dropRows.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });

  // เปลี่ยนชื่อในชีตประวัติด้วย ไม่งั้นยอดคงเหลือจะแตกเป็นสองชื่อ
  var histCount = 0;
  historySheets_().forEach(function (name) {
    var h = ss.getSheetByName(name);
    if (!h || h.getLastRow() < 2) return;
    var hmap = ensureCols_(h, MOVE_COLS);
    var col = hmap['รายการ'];
    var rng = h.getRange(2, col + 1, h.getLastRow() - 1, 1);
    var v = rng.getValues();
    var hit = 0;
    for (var i = 0; i < v.length; i++) {
      var n = String(v[i][0] || '').trim();
      if (ITEM_RENAME[n]) { v[i][0] = ITEM_RENAME[n]; hit++; }
    }
    if (hit) { rng.setValues(v); histCount += hit; }
    Logger.log('  "' + name + '" เปลี่ยนชื่อ ' + hit + ' แถว');
  });

  Logger.log('─────────────────────────────');
  Logger.log('เปลี่ยนชื่อ ' + renamed.length + ' รายการ' + (renamed.length ? ':\n  ' + renamed.join('\n  ') : ''));
  Logger.log('รวมแถวซ้ำ ' + merged.length + ' รายการ' + (merged.length ? ':\n  ' + merged.join('\n  ') : ''));
  Logger.log('แก้ชื่อในชีตประวัติรวม ' + histCount + ' แถว');
}

/**
 * ล้างกฎ "ตรวจสอบข้อมูล" (dropdown) ที่ติดมากับชีตของระบบเก่า
 *
 * ชีตรายการสินค้าเดิมล็อกช่อง "หน่วยย่อย" ไว้ให้ใส่ได้แค่ ไม้ / กรัม / ชิ้น
 * พอตั้งหน่วยจริงเป็น ถุง มัด ที่ อัน ใบ กระป๋อง ขวด กก. ชีตจะไม่ยอมรับ
 * แล้วโยน error "ข้อมูลที่ป้อนลงในเซลล์ B7 ละเมิดกฎการตรวจสอบข้อมูล"
 *
 * ล้างเฉพาะ "กฎ" ไม่ได้ลบข้อมูลในช่อง รันซ้ำได้ ถ้าไม่มีกฎอยู่ก็ไม่เกิดอะไร
 * ล้างชีตประวัติด้วย เพราะหน้าเว็บก็เขียนหน่วยพวกนี้ลงไปเหมือนกัน
 */
function clearStockValidation_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  [SHEET_ITEMS, SHEET_INCOMING, SHEET_COUNT, SHEET_WASTE, SHEET_PACK].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    sh.getRange(1, 1, Math.max(sh.getMaxRows(), 1), Math.max(sh.getMaxColumns(), 1))
      .clearDataValidations();
  });
}

/** เรียกเองจากเมนูรันได้ ถ้าเจอ error เรื่องกฎตรวจสอบข้อมูลอีก */
function clearStockValidation() {
  clearStockValidation_();
  Logger.log('ล้างกฎตรวจสอบข้อมูลของชีตสต็อกแล้ว — ใส่หน่วยอะไรก็ได้แล้ว\n' +
             'ข้อมูลเดิมไม่ถูกลบ ลบแค่กฎที่บังคับให้เลือกจากรายการ');
}

/** รันทีเดียวจบ: รวมชื่อ → แยกมาม่า → ใส่ราคา */
/** รันทีเดียวจบ: รวมชื่อเก่า → เขียนแคตตาล็อก → ของใช้ → ลบของที่เลิกใช้ */
function fixItemList() {
  clearStockValidation_();     // ปลดล็อกช่องหน่วยก่อน ไม่งั้นเขียน กก./ถุง/ใบ ไม่ได้
  mergeItemNames();            // ชื่อเก่าที่เรียกไม่ตรงกัน รวมเป็นชื่อเดียว
  applyItemCatalogue();        // ของแพ็ค + วัตถุดิบ พร้อมหน่วยและราคา
  addSupplyItems();            // ช้อน ถุง ผงปรุง
  removeDiscontinuedItems();   // ที่เหลือคือของที่เลิกใช้ ลบทิ้ง
}

/* ───────────── ล้างยอดคงเหลือให้เป็นศูนย์ ───────────── */

/**
 * สถานที่ที่จะล้างยอด — เว้นว่างไว้ = ล้างทุกสถานที่
 * แก้ตรงนี้แล้วรัน zeroOutStock()
 */
var ZERO_LOCATION = '';

/** ทุกสถานที่ที่มีชื่อโผล่ในระบบ — ครัวกลาง + กลุ่ม LINE + ที่พบในชีตประวัติ */
function allStockLocations_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = [CENTRAL];
  function put(l) { l = String(l || '').trim(); if (l && out.indexOf(l) === -1) out.push(l); }
  Object.keys(stockLineGroups_()).forEach(put);
  [SHEET_INCOMING, SHEET_COUNT, SHEET_WASTE, SHEET_PACK].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    var map = ensureCols_(sh, name === SHEET_PACK ? PACK_COLS : MOVE_COLS);
    sh.getRange(2, map['สาขา'] + 1, sh.getLastRow() - 1, 1).getValues()
      .forEach(function (r) { put(r[0]); });
  });
  return out;
}

/**
 * บันทึกผลนับ = 0 ให้ของที่ยังมียอดค้างอยู่
 *
 * ใช้เมื่อ: ระบบขึ้นว่ามีของ แต่ของจริงไม่มี เพราะมีแถวของเข้าเก่าค้างอยู่
 * ไม่ได้ลบข้อมูลเก่าทิ้ง แค่บันทึกว่า "วันนี้นับได้ 0" ซึ่งกลายเป็นยอดตั้งต้นใหม่
 * ระบบจะข้ามทุกอย่างที่เกิดก่อนหน้านี้ไปเอง และมีหลักฐานว่าใครตั้งเมื่อไหร่
 *
 * เขียนเฉพาะของที่ยอดไม่เป็นศูนย์ ของที่ยอดเป็น 0 อยู่แล้วไม่ต้องเขียน
 * ไม่งั้นจะได้แถวเปล่า ๆ เป็นร้อยแถวโดยไม่ได้อะไรเพิ่ม
 *
 * ครอบคลุมของที่ลบออกจากรายการสินค้าแล้วแต่ยังมีประวัติค้างด้วย
 * ไม่งั้นของพวกนั้นจะค้างอยู่ในยอดคงเหลือตลอดไป
 *
 * ไม่แจ้ง LINE เพราะเป็นการตั้งค่าระบบ ไม่ใช่การนับจริง
 */
function zeroOutStock() {
  var want = String(ZERO_LOCATION || '').trim();
  zeroStockAt_(want ? [want] : allStockLocations_());
}

/** ล้างทุกสถานที่ ไม่ต้องแก้ ZERO_LOCATION */
function zeroOutAllStock() { zeroStockAt_(allStockLocations_()); }

function zeroStockAt_(locs) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_COUNT);
  if (!sh) { Logger.log('ไม่พบชีต "' + SHEET_COUNT + '"'); return; }
  var map = ensureCols_(sh, MOVE_COLS);

  var bal = stockBalances_();

  // หน่วยของแต่ละสินค้า — เอาจากรายการสินค้าก่อน ถ้าไม่มีค่อยดูจากประวัติ
  var unitOf = {};
  getStockItems_().forEach(function (i) { unitOf[i.name] = i.subUnit; });
  [SHEET_INCOMING, SHEET_COUNT, SHEET_WASTE, SHEET_PACK].forEach(function (name) {
    var h = ss.getSheetByName(name);
    if (!h || h.getLastRow() < 2) return;
    var hmap = ensureCols_(h, name === SHEET_PACK ? PACK_COLS : MOVE_COLS);
    h.getRange(2, 1, h.getLastRow() - 1, h.getLastColumn()).getValues().forEach(function (r) {
      var n = String(r[hmap['รายการ']] || '').trim();
      if (n && unitOf[n] === undefined) unitOf[n] = String(r[hmap['หน่วย']] || 'ไม้').trim();
      for (var k = 0; k < PACK_RAW_SLOTS; k++) {
        var pc = packRawCols_(k);
        if (hmap[pc.name] === undefined) continue;
        var rn = String(r[hmap[pc.name]] || '').trim();
        if (rn && unitOf[rn] === undefined) unitOf[rn] = String(r[hmap[pc.unit]] || 'กก.').trim();
      }
    });
  });

  var now = new Date(), done = [], out = [];
  locs.forEach(function (loc) {
    var m = bal[loc] || {};
    Object.keys(m).forEach(function (item) {
      if (!Number(m[item])) return;          // ยอดเป็น 0 อยู่แล้ว ไม่ต้องเขียน
      out.push({
        'วันที่เวลา': now, 'สาขา': loc, 'ผู้ตรวจ': 'ระบบ',
        'รายการ': item, 'จำนวน': 0, 'หน่วย': unitOf[item] || 'ไม้',
        'แพ็ค': 0, 'เศษ': 0, 'ไม้ต่อแพ็ค': '',
        'ประเภท': 'เช็คสต็อก',
        'หมายเหตุ': 'ตั้งยอดเริ่มต้นเป็น 0 — ล้างของเก่าที่ค้างในระบบ'
      });
      done.push(loc + ' · ' + item + ' (เดิม ' + m[item] + ')');
    });
  });
  appendRows_(sh, map, out);

  Logger.log('ล้างยอดที่: ' + locs.join(', '));
  if (!done.length) {
    Logger.log('ไม่มีของค้างอยู่แล้ว ไม่ได้เขียนอะไรเพิ่ม');
    return;
  }
  Logger.log('ตั้งยอดเป็น 0 ให้ ' + done.length + ' รายการ:\n  ' + done.join('\n  '));
  Logger.log('\nเปิดแท็บสต็อกคงเหลือดูได้เลย ควรไม่เหลืออะไรแล้ว\n' +
             'ของที่เข้ามาหลังจากนี้จะนับปกติ ส่วนของเก่าก่อนหน้านี้ระบบข้ามให้เอง');
}

/**
 * ยอดคงเหลือตอนนี้มาจากแถวไหนบ้าง — ใช้ตอบคำถามว่า "ทำไมขึ้นว่ามีของ"
 * ไม่แก้อะไรทั้งนั้น แค่อ่านแล้วรายงาน
 */
function showStockSource() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var bal = stockBalances_();

  var want = {};
  Object.keys(bal).forEach(function (loc) {
    Object.keys(bal[loc]).forEach(function (item) {
      if (Number(bal[loc][item])) want[loc + '\u0000' + item] = bal[loc][item];
    });
  });
  var keys = Object.keys(want);
  if (!keys.length) { Logger.log('ไม่มีของค้างในระบบเลย'); return; }

  Logger.log('ของที่ยังมียอดค้าง ' + keys.length + ' รายการ:');
  keys.forEach(function (k) {
    var part = k.split('\u0000');
    Logger.log('  • ' + part[0] + ' · ' + part[1] + ' = ' + want[k]);
  });

  Logger.log('\n───── แถวที่ทำให้เกิดยอดพวกนี้ ─────');
  [SHEET_COUNT, SHEET_INCOMING, SHEET_WASTE, SHEET_PACK].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    var map = ensureCols_(sh, name === SHEET_PACK ? PACK_COLS : MOVE_COLS);
    var hit = [];
    sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues().forEach(function (r, i) {
      var item = String(r[map['รายการ']] || '').trim();
      var loc  = String(r[map['สาขา']] || '').trim();
      if (!item) return;
      // ของเข้าร้าน 1 แถวกระทบครัวกลางด้วย เลยต้องเช็คทั้งสองฝั่ง
      var kind = String(r[map['ประเภท']] || '').trim();
      // แถวเดียวกระทบได้หลายที่ ของเข้าร้านตัดครัวกลางด้วย แพ็คของก็ตัดวัตถุดิบด้วย
      var raws = [];
      for (var k = 0; k < PACK_RAW_SLOTS; k++) {
        var pc = packRawCols_(k);
        if (map[pc.name] === undefined) continue;
        var rn = String(r[map[pc.name]] || '').trim();
        if (rn) raws.push(rn);
      }
      var touches = (want[loc + '\u0000' + item] !== undefined) ||
                    raws.some(function (rn) { return want[loc + '\u0000' + rn] !== undefined; }) ||
                    (kind === 'ของเข้าร้าน' && want[CENTRAL + '\u0000' + item] !== undefined);
      if (!touches) return;
      hit.push('    แถว ' + (i + 2) + ' · ' + loc + ' · ' + item + ' · ' +
               r[map['จำนวน']] + ' ' + r[map['หน่วย']] + ' · ' + kind +
               ' · ' + r[map['วันที่เวลา']] + ' · ' + r[map['ผู้ตรวจ']]);
    });
    Logger.log('  "' + name + '" ' + hit.length + ' แถว' + (hit.length ? ':\n' + hit.join('\n') : ''));
  });

  Logger.log('\nถ้าของพวกนี้ไม่มีจริง รัน zeroOutAllStock() เพื่อล้างให้เป็น 0');
}

/* ───────────── ของใช้ / วัตถุดิบ ที่ไม่ได้ขายเป็นไม้ ───────────── */

/**
 * ของที่ต้องนับสต็อกแต่ไม่ได้ขายตรง ๆ — ผงปรุง ของใช้ บรรจุภัณฑ์
 * ไม่ใส่ราคา เพราะไม่ได้ขายเป็นชิ้น ถ้าใส่ราคาจะไปโผล่ในยอด "ควรได้"
 * ของแท็บคำนวณของหาย ทั้งที่ไม่ได้ขาย
 *
 * scope  ครัวกลาง = มีเฉพาะครัวกลาง / ร้าน = มีเฉพาะหน้าร้าน / '' = ทั้งสองที่
 */
/**
 * ของใช้ / วัตถุดิบปรุง — [ชื่อ, หน่วยย่อย, ใช้ที่, ต่อแพ็ค, ชื่อแพ็ค, หมายเหตุ]
 *
 * ต่อแพ็ค = 1 แพ็คที่ซื้อมามีกี่หน่วยย่อย (ช้อน 1 แพ็ค = 100 คัน)
 * เว้นว่าง/1 = ซื้อมาเป็นชิ้น ๆ ไม่ได้มัดเป็นแพ็ค
 */
var SUPPLY_ITEMS = [
  // ── เฉพาะครัวกลาง ──
  ['เบสหม่าล่า',    'ถุง',  SCOPE_CENTRAL, 1,  'ลัง',  'ถุงละ 1000 มล'],
  ['ผงหม่าล่า',     'ถุง',  SCOPE_CENTRAL, 1,  'ลัง',  'ถุงละ 100 กรัม'],
  ['พริกป่น',       'ถุง',  SCOPE_CENTRAL, 1,  'ลัง',  ''],
  ['ถ้วย 2 ออน',    'ใบ',   SCOPE_CENTRAL, 50, 'แพ็ค', ''],

  // ── เฉพาะหน้าร้าน ──
  ['หม่าล่า(ผสมแล้ว)', 'ถุง', SCOPE_SHOP,  1,  'ลัง',  ''],

  // ── ใช้ทั้งครัวกลางและหน้าร้าน ──
  ['นมข้นจืด',      'กระป๋อง', '',  1,   'ลัง',  ''],
  ['น้ำจิ้มงา',      'ถุง',    '',  1,   'ลัง',  ''],
  ['น้ำจิ้มสุกี้',    'ถุง',    '',  1,   'ลัง',  ''],
  ['ช้อน',          'คัน',    '',  100, 'แพ็ค', 'แพ็คละ 100 คัน'],
  ['ตะเกียบ',       'อัน',    '',  100, 'แพ็ค', ''],
  ['ถ้วย 750',      'ใบ',     '',  50,  'แพ็ค', 'แพ็คละ 50 ใบ'],
  ['ถ้วย1000 มล',   'ใบ',     '',  50,  'แพ็ค', ''],
  ['ถ้วย1500 มล',   'ใบ',     '',  50,  'แพ็ค', ''],
  ['กระดูกหมู',      'กก.',   '',  1,   'ลัง',  ''],
  ['น้ำดำ',         'ขวด',    '',  1,   'ลัง',  ''],
  ['ถุงหูหิ้ว',      'ใบ',     '',  100, 'แพ็ค', ''],
  ['ถุงร้อนใหญ่',    'ใบ',     '',  100, 'แพ็ค', ''],
  ['ถุงร้อนเล็ก',    'ใบ',     '',  100, 'แพ็ค', '']
];

/**
 * เพิ่มของใช้/วัตถุดิบ พร้อมตั้งว่าใช้ที่ไหน
 * ของที่มีอยู่แล้วอัปเดตเฉพาะช่อง "ใช้ที่" ไม่แตะช่องอื่น
 * รันซ้ำได้
 */
function addSupplyItems() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ITEMS);
  if (!sh) { Logger.log('ไม่พบชีต "' + SHEET_ITEMS + '" — รัน setupStock ก่อน'); return; }
  clearStockValidation_();          // หน่วยของใช้เป็น ใบ/ขวด/กก. ซึ่งกฎเดิมไม่ยอมรับ
  var map = ensureCols_(sh, ITEM_COLS);

  var rowOf = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, map['สินค้า'] + 1, sh.getLastRow() - 1, 1).getValues()
      .forEach(function (r, i) {
        var n = String(r[0] || '').trim();
        if (n && !rowOf[n]) rowOf[n] = i + 2;
      });
  }

  var added = [], updated = [], news = [];
  SUPPLY_ITEMS.forEach(function (it) {
    var name = it[0], unit = it[1], scope = it[2];
    var per = Number(it[3]) > 0 ? Number(it[3]) : 1;
    var packUnit = it[4] || 'ลัง';
    var note = it[5] || '';

    var vals = {};
    vals['หน่วยย่อย'] = unit;
    vals['หน่วยแพ็ค'] = packUnit;
    vals['หน่วยย่อยต่อแพ็ค'] = per;
    vals['ใช้ที่'] = scope;
    vals['ชนิด'] = KIND_SUPPLY;

    if (rowOf[name]) {
      // เขียนทับเฉพาะช่องที่ระบบดูแล ช่องที่เจ้าของกรอกเอง (จุดเตือน) ไม่แตะ
      Object.keys(vals).forEach(function (k) {
        sh.getRange(rowOf[name], map[k] + 1).setValue(vals[k]);
      });
      if (note) sh.getRange(rowOf[name], map['หมายเหตุ'] + 1).setValue(note);
      updated.push(name);
      return;
    }
    vals['สินค้า'] = name;
    vals['หมายเหตุ'] = note || 'ของใช้/วัตถุดิบ ไม่ได้ขายเป็นชิ้น';
    news.push(vals);                      // ไม่ใส่ราคา
    added.push(name);
  });
  appendRows_(sh, map, news);

  Logger.log('เพิ่มของใช้ ' + added.length + ' รายการ' + (added.length ? ':\n  ' + added.join('\n  ') : ''));
  if (updated.length) Logger.log('อัปเดต "ใช้ที่" ให้ของเดิม ' + updated.length + ' รายการ: ' + updated.join(', '));
  Logger.log('\nของพวกนี้ไม่ได้ใส่ราคา เพราะไม่ได้ขายเป็นชิ้น\n' +
             'ถ้าใส่ราคาจะไปโผล่เป็นยอด "ควรได้" ในแท็บคำนวณของหาย ทั้งที่ไม่ได้ขาย');
}
