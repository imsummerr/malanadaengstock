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

var ORDER_HEADERS = [
  'วันที่', 'เวลา', 'เลขที่ออเดอร์', 'สาขา', 'พนักงาน',
  'ไม้ 10฿', 'ไม้ 15฿', 'รวมไม้', 'ยอดไม้',
  'มาม่า 10฿', 'มาม่า 15฿', 'มาม่า 20฿', 'มาม่า 35฿', 'มาม่า 45฿', 'รวมมาม่า', 'ยอดมาม่า',
  'ยอดรวม', 'ส่วนลด', 'ยอดสุทธิ',
  'น้ำซุป', 'ความเผ็ด', 'น้ำจิ้ม', 'จำนวนน้ำจิ้ม',
  'วิธีชำระเงิน', 'order_id',
  // ต่อท้ายไว้ ไม่แทรกกลาง เพื่อไม่ให้คอลัมน์ของข้อมูลเก่าเลื่อนความหมาย
  'ของอื่น', 'รวมของอื่น', 'ยอดของอื่น'
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
  try {
    var body = JSON.parse(e.postData.contents);

    // ถ้าโปรเจกต์นี้มีสคริปต์แจ้งเตือน LINE อยู่ด้วย ให้ส่งต่อ webhook ของ LINE ไปให้มัน
    // (Apps Script มี doPost ได้ตัวเดียวต่อโปรเจกต์ ตัวนี้จึงทำหน้าที่เป็นตัวแยกทาง)
    if (body.destination || body.events) {
      if (typeof handleLineWebhook_ === 'function') return handleLineWebhook_(body);
      return ContentService.createTextOutput('OK');
    }

    switch (body.action) {
      case 'login':    return json_(handleLogin_(body));
      case 'logout':   return json_(handleLogout_(body));
      case 'posOrder':    return json_(handleOrder_(body));
      case 'posDelivery': return json_(handleDelivery_(body));
      case 'posBills':    return json_(handleBills_(body));
      case 'stockIn':     return json_(handleStockIn_(body));
      case 'stockToShop': return json_(handleStockToShop_(body));
      case 'stockWaste':  return json_(handleStockWaste_(body));
      case 'stockCount':  return json_(handleStockCount_(body));
      default:         return json_({ success: false, message: 'ไม่รู้จัก action: ' + body.action });
    }
  } catch (err) {
    return json_({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
}

function doGet(e) {
  try {
    var p = e.parameter || {};
    if (p.action === 'posStats') return json_(handleStats_(p));
    if (p.action === 'posBills') return json_(handleBills_(p));
    if (p.action === 'history')  return json_(handleHistory_(p));
    if (p.action === 'stockBootstrap') return json_(handleStockBootstrap_(p));
    return json_({ success: false, message: 'ไม่รู้จัก action: ' + p.action });
  } catch (err) {
    return json_({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
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
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (String(r[0]).trim().toLowerCase() !== username.toLowerCase()) continue;

    var active = String(r[4] || 'ใช่').trim();
    if (active === 'ไม่' || active.toLowerCase() === 'no' || active.toLowerCase() === 'false') {
      return { success: false, message: 'บัญชีนี้ถูกปิดการใช้งาน' };
    }
    if (!passwordMatches_(password, String(r[1]))) {
      return { success: false, message: 'Username หรือ Password ไม่ถูกต้อง' };
    }

    var token = Utilities.getUuid();
    var now = new Date();
    var role = roleOf_(r[5]);
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SESSIONS)
      .appendRow([token, r[0], r[2], r[3], now, now, role]);
    cleanOldSessions_();
    return {
      success: true, token: token,
      name: String(r[2] || r[0]), branch: String(r[3] || ''), role: role
    };
  }
  return { success: false, message: 'Username หรือ Password ไม่ถูกต้อง' };
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
    return {
      username: rows[i][1], name: rows[i][2], branch: rows[i][3],
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

    stats.orders++;
    stats.revenue  += total;
    stats.discount += discount;
    stats.sticks   += num_(r[idx['รวมไม้']]);
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
    bills: bills
  } };
}

function emptyStats_() {
  return {
    orders: 0, revenue: 0, discount: 0, sticks: 0, mama: 0, sauceCups: 0, avgTicket: 0,
    deliveryOrders: 0, deliveryItemCount: 0, deliveryAddons: 0, deliveryItems: {},
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
  delivery: SHEET_DELIVERY   // ออเดอร์เดลิเวอรี่ที่ POS บันทึกไว้ — ใช้หักตอนคำนวณของหาย
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

var CENTRAL = 'ครัวกลาง';

var ITEM_COLS = ['สินค้า', 'หน่วยย่อย', 'หน่วยแพ็ค', 'หน่วยย่อยต่อแพ็ค',
                 'ราคาขาย/หน่วยย่อย', 'เตือนเมื่อเหลือ(แพ็ค)', 'หมายเหตุ'];

// คอลัมน์ที่ทุกชีตประวัติต้องมี — ของเดิม 7 ตัวแรก ที่เพิ่มคือ 4 ตัวหลัง
var MOVE_COLS = ['วันที่เวลา', 'สาขา', 'ผู้ตรวจ', 'รายการ', 'จำนวน', 'หน่วย', 'หมายเหตุ',
                 'แพ็ค', 'เศษ', 'ไม้ต่อแพ็ค', 'ประเภท'];

/**
 * หาคอลัมน์ตามชื่อหัวตาราง ถ้าไม่มีก็ต่อท้ายให้ — ไม่แตะคอลัมน์เดิม ไม่สลับลำดับ
 * คืน map ชื่อคอลัมน์ → index (เริ่มที่ 0)
 */
function ensureCols_(sheet, names) {
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

/** เขียนหนึ่งแถวโดยอ้างชื่อคอลัมน์ ไม่อ้างตำแหน่ง */
function appendByCols_(sheet, map, values) {
  var width = sheet.getLastColumn();
  var row = new Array(width).fill('');
  Object.keys(values).forEach(function (k) {
    if (map[k] !== undefined) row[map[k]] = values[k];
  });
  sheet.appendRow(row);
}

/* ───────────────────────── แปลงหน่วย 2 ระดับ ───────────────────────── */

/** แพ็ค + เศษ → หน่วยย่อยรวม  (3 แพ็ค 5 ไม้ ที่ 7 ไม้/แพ็ค = 26 ไม้) */
function toBase_(packs, rem, perPack) {
  packs = Number(packs) || 0;
  rem   = Number(rem) || 0;
  perPack = Number(perPack) > 0 ? Number(perPack) : 1;
  return round_(packs * perPack + rem);
}

/** หน่วยย่อยรวม → แพ็ค + เศษ  (26 ไม้ ที่ 7 ไม้/แพ็ค = 3 แพ็ค เศษ 5) */
function splitPack_(base, perPack) {
  base = Number(base) || 0;
  perPack = Number(perPack) || 0;
  if (perPack <= 0) return { packs: 0, rem: base };
  var neg = base < 0, a = Math.abs(base);
  var p = Math.floor(a / perPack), r = round_(a - p * perPack);
  return { packs: neg ? -p : p, rem: neg ? -r : r };
}

/** ข้อความอ่านง่าย เช่น "3 แพ็ค 5 ไม้" */
function fmtPack_(base, item) {
  var s = splitPack_(base, item.perPack);
  if (item.perPack <= 1) return round_(base) + ' ' + item.subUnit;
  var out = [];
  if (s.packs) out.push(s.packs + ' ' + item.packUnit);
  if (s.rem)   out.push(s.rem + ' ' + item.subUnit);
  return out.length ? out.join(' ') : '0 ' + item.packUnit;
}

/** ปัดเศษทศนิยมลอย ๆ ทิ้ง (0.1+0.2 = 0.30000000000000004) */
function round_(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }

/* ───────────────────────── รายการสินค้า ───────────────────────── */

/** อ่านชีตรายการสินค้า — คืน array ของ { name, subUnit, packUnit, perPack, price, lowPacks } */
function getStockItems_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ITEMS);
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
      price:    Number(v[i][map['ราคาขาย/หน่วยย่อย']]) || 0,
      lowPacks: Number(v[i][map['เตือนเมื่อเหลือ(แพ็ค)']]) || 0
    });
  }
  return out;
}

function findStockItem_(name) {
  var items = getStockItems_();
  for (var i = 0; i < items.length; i++) if (items[i].name === name) return items[i];
  return null;
}

/* ───────────────────────── ยอดคงเหลือ ───────────────────────── */

/** อ่านชีตประวัติเป็น array ของ object ตามชื่อหัวคอลัมน์ */
function readMoves_(sheetName) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
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

  return bal;
}

/* ───────────────────────── แจ้ง LINE ───────────────────────── */

// ── กลุ่ม LINE ของแต่ละสถานที่ ──
// line-expiry-alert.gs อยู่คนละโปรเจกต์ เรียกข้ามกันไม่ได้ จึงต้องตั้งค่าที่นี่ด้วย
// ใส่ Group ID (ขึ้นต้น C...) ให้ตรงกับที่ตั้งไว้ใน BRANCH_LINE_GROUPS ของอีกไฟล์
// เว้นว่าง = ส่งไปปลายทางกลาง (LINE_TARGET_ID) แทน
// ตั้งค่าใน โปรเจกต์ > การตั้งค่าสคริปต์ > คุณสมบัติสคริปต์ (ไม่ใช่ในโค้ด — repo นี้ public)
//   LINE_CHANNEL_ACCESS_TOKEN = token ของบอท (ตัวเดียวกับโปรเจกต์ line-expiry-alert)
//   LINE_GROUPS = {"ครัวกลาง":"Cxxxx","ตลาดทรัพย์พัฒนา":"Cyyyy"}
// Script Properties ไม่แชร์ข้ามโปรเจกต์ ต้องใส่ทั้งสองโปรเจกต์ ค่าเดียวกัน
//   กลุ่มครัวกลาง ← ของครัวกลางใกล้หมด · ของเสียครัวกลาง
//   กลุ่มสาขา    ← เช็คสต็อกรายสัปดาห์ · ของเสียสาขา
// (ของเข้าไม่ได้แจ้งจากไฟล์นี้ line-expiry-alert.gs แจ้งให้)
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
 * ใช้ Script Property ชื่อเดียวกับอีกโปรเจกต์ (LINE_CHANNEL_ACCESS_TOKEN)
 * แต่ต้องตั้งค่าแยกในโปรเจกต์นี้ด้วย เพราะ Script Properties ไม่แชร์ข้ามโปรเจกต์
 * ส่งไม่สำเร็จก็ไม่ทำให้การบันทึกล้มเหลว — ของลงชีตแล้วถือว่าบันทึกสำเร็จ
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
 * เตือนเมื่อของครัวกลางเหลือน้อย
 * แจ้ง "ตอนตกลงมาต่ำกว่าจุดเตือน" ครั้งเดียว แล้วจำสถานะไว้
 * ไม่ใช่เตือนทุกครั้งที่ส่งของออก ไม่งั้นไลน์จะเด้งรัว
 * พอเติมของจนเกินจุดเตือนแล้ว ล้างสถานะ รอบหน้าถึงเตือนใหม่
 */
function checkLowStock_(itemNames) {
  var items = {};
  getStockItems_().forEach(function (i) { items[i.name] = i; });
  var bal = stockBalances_()[CENTRAL] || {};
  var props = PropertiesService.getScriptProperties();
  var hits = [];

  (itemNames || []).forEach(function (name) {
    var it = items[name];
    if (!it || !(it.lowPacks > 0)) return;
    var limit = it.lowPacks * it.perPack;
    var have  = Number(bal[name]) || 0;
    var key   = 'LOWSTOCK_' + name;
    var wasLow = props.getProperty(key) === '1';
    var isLow  = have <= limit;
    if (isLow && !wasLow) {
      hits.push('• ' + name + ' เหลือ ' + fmtPack_(have, it) +
                '  (จุดเตือน ' + it.lowPacks + ' ' + it.packUnit + ')');
      props.setProperty(key, '1');
    } else if (!isLow && wasLow) {
      props.deleteProperty(key);
    }
  });

  if (!hits.length) return;
  stockNotify_(CENTRAL, '⚠️ ของครัวกลางใกล้หมด\n\n' + hits.join('\n') + '\n\nสั่งของเพิ่มด้วยครับ');
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
  return String(session.branch || '').trim() === CENTRAL ? 'central' : 'branch';
}

/** ยอดคงเหลือและตัวเลขเทียบตอนนับสต็อก ให้เฉพาะเจ้าของร้าน */
function isStockOwner_(session) { return stockRoleOf_(session) === 'owner'; }

/** เจ้าของผ่านหมด นอกนั้นต้องตรงกับที่กำหนด */
function stockAllow_(session, need) {
  var r = stockRoleOf_(session);
  return r === 'owner' || r === need;
}

/** สถานที่ที่คนนี้ลงรายการได้ — กันไม่ให้สาขาหนึ่งไปลงของอีกสาขา */
function stockCanUseLoc_(session, loc) {
  var r = stockRoleOf_(session);
  if (r === 'owner') return true;
  if (r === 'central') return String(loc || '').trim() === CENTRAL;
  return String(loc || '').trim() === String(session.branch || '').trim();
}

/** ตรวจ token + สิทธิ์ + แปลงจำนวนแพ็ค/เศษ เป็นหน่วยย่อย — ใช้ร่วมกันทุก action */
function stockPrepare_(body, need) {
  var session = checkToken_(body.token);
  if (!session) throw new Error('401');
  if (need && !stockAllow_(session, need)) throw new Error('403');

  var name = String(body.item || '').trim();
  var it = findStockItem_(name);
  if (!it) throw new Error('ไม่พบสินค้า "' + name + '" ในชีตรายการสินค้า');

  var total = toBase_(body.packs, body.rem, it.perPack);
  if (!(total > 0)) throw new Error('กรุณากรอกจำนวน');

  return { session: session, item: it, total: total };
}

/** ของเข้าครัวกลาง — เสียบและแพ็คเสร็จแล้วลงยอด */
function handleStockIn_(body) {
  var p;
  try { p = stockPrepare_(body, 'central'); }
  catch (e) { return stockErr_(e); }

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INCOMING);
  if (!sh) return { success: false, message: 'ไม่พบชีต "' + SHEET_INCOMING + '"' };
  var map = ensureCols_(sh, MOVE_COLS);

  var now = new Date();
  appendByCols_(sh, map, {
    'วันที่เวลา': now, 'สาขา': CENTRAL, 'ผู้ตรวจ': p.session.name,
    'รายการ': p.item.name, 'จำนวน': p.total, 'หน่วย': p.item.subUnit,
    'แพ็ค': Number(body.packs) || 0, 'เศษ': Number(body.rem) || 0,
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

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INCOMING);
  if (!sh) return { success: false, message: 'ไม่พบชีต "' + SHEET_INCOMING + '"' };
  var map = ensureCols_(sh, MOVE_COLS);

  var now = new Date();
  appendByCols_(sh, map, {
    'วันที่เวลา': now, 'สาขา': branch, 'ผู้ตรวจ': p.session.name,
    'รายการ': p.item.name, 'จำนวน': p.total, 'หน่วย': p.item.subUnit,
    'แพ็ค': Number(body.packs) || 0, 'เศษ': Number(body.rem) || 0,
    'ไม้ต่อแพ็ค': p.item.perPack, 'ประเภท': 'ของเข้าร้าน',
    'หมายเหตุ': String(body.note || '')
  });

  // ไม่แจ้ง LINE ตรงนี้ — checkNewIncoming ใน line-expiry-alert.gs แจ้งให้เอง
  // พร้อมจำนวนแพ็ค วงเล็บบอกว่า 1 แพ็คมีกี่ไม้ และวันหมดอายุ
  // (อายุเก็บอยู่ในไฟล์นั้นที่เดียว จะได้ไม่ต้องเก็บตารางอายุซ้ำสองที่)
  checkLowStock_([p.item.name]);                  // ส่งออกแล้วครัวกลางอาจตกต่ำกว่าจุดเตือน

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
    'รายการ': p.item.name, 'จำนวน': p.total, 'หน่วย': p.item.subUnit,
    'แพ็ค': Number(body.packs) || 0, 'เศษ': Number(body.rem) || 0,
    'ไม้ต่อแพ็ค': p.item.perPack, 'ประเภท': reason,
    'หมายเหตุ': String(body.note || '')
  });

  var text = fmtPack_(p.total, p.item);
  var line = stockNotify_(loc,
    '🗑️ ตัดของออกจากสต็อก — ' + loc + '\n\n' +
    p.item.name + '  ' + text + '\nสาเหตุ ' + reason +
    '\nผู้บันทึก ' + p.session.name);

  if (loc === CENTRAL) checkLowStock_([p.item.name]);
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
    return !r || (r.packs === '' && r.rem === '') || (r.packs == null && r.rem == null);
  }).map(function (it) { return it.name; });
  if (missing.length) {
    return { success: false, message: 'ต้องนับให้ครบทุกรายการ ยังขาด ' + missing.length + ' รายการ: ' +
                                      missing.slice(0, 5).join(', ') + (missing.length > 5 ? ' …' : '') };
  }

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_COUNT);
  if (!sh) return { success: false, message: 'ไม่พบชีต "' + SHEET_COUNT + '"' };
  var map = ensureCols_(sh, MOVE_COLS);

  var before = stockBalances_()[loc] || {};
  var now = new Date();
  var diffs = [];

  items.forEach(function (it) {
    var r = got[it.name];
    var counted = toBase_(r.packs, r.rem, it.perPack);
    var sys = Number(before[it.name]) || 0;
    var diff = round_(counted - sys);
    appendByCols_(sh, map, {
      'วันที่เวลา': now, 'สาขา': loc, 'ผู้ตรวจ': session.name,
      'รายการ': it.name, 'จำนวน': counted, 'หน่วย': it.subUnit,
      'แพ็ค': Number(r.packs) || 0, 'เศษ': Number(r.rem) || 0,
      'ไม้ต่อแพ็ค': it.perPack, 'ประเภท': 'เช็คสต็อก',
      'หมายเหตุ': 'ยอดระบบ ' + sys + ' ' + it.subUnit + ' ต่าง ' + (diff > 0 ? '+' : '') + diff
    });
    if (diff !== 0) diffs.push('• ' + it.name + '  นับได้ ' + fmtPack_(counted, it) +
                               '  (ระบบ ' + fmtPack_(sys, it) + ' ต่าง ' + (diff > 0 ? '+' : '') + diff + ' ' + it.subUnit + ')');
  });

  var msg = '📋 เช็คสต็อกรายสัปดาห์ — ' + loc + '\n\n' +
            'นับครบ ' + items.length + ' รายการ โดย ' + session.name + '\n' +
            Utilities.formatDate(now, TZ, 'd/M/yyyy HH:mm') + '\n\n' +
            (diffs.length ? 'ที่ไม่ตรงกับระบบ ' + diffs.length + ' รายการ\n' + diffs.join('\n')
                          : 'ตรงกับระบบทุกรายการ 🎉');
  var line = stockNotify_(loc, msg);

  checkLowStock_(items.map(function (it) { return it.name; }));
  return { success: true, counted: items.length, diffs: diffs.length,
           lineSent: line.sent, lineMsg: line.message };
}

/** ข้อมูลตั้งต้นของหน้าสต็อก — รายการสินค้า สถานที่ และยอดคงเหลือ */
function handleStockBootstrap_(p) {
  var session = checkToken_(p.token);
  if (!session) return { success: false, code: 401, message: 'Session หมดอายุ กรุณา Login ใหม่' };

  var items = getStockItems_();
  var bal = stockBalances_();

  // สถานที่ = ครัวกลาง + สาขาที่ตั้งกลุ่ม LINE ไว้ใน Script Property LINE_GROUPS
  var locations = [CENTRAL];
  Object.keys(stockLineGroups_()).forEach(function (b) {
    if (locations.indexOf(b) === -1) locations.push(b);
  });
  Object.keys(bal).forEach(function (l) { if (locations.indexOf(l) === -1) locations.push(l); });

  // ยอดคงเหลือเป็นข้อมูลของเจ้าของร้าน ไม่ส่งให้พนักงานเลย
  // ซ่อนแค่ฝั่งหน้าเว็บไม่พอ เปิด Network ในเบราว์เซอร์ก็อ่านคำตอบได้
  var stock = !isStockOwner_(session) ? [] : locations.filter(function (loc) {
    return stockCanUseLoc_(session, loc);
  }).map(function (loc) {
    var m = bal[loc] || {};
    return {
      name: loc,
      rows: items.filter(function (it) { return m[it.name]; }).map(function (it) {
        var have = Number(m[it.name]) || 0;
        var limit = it.lowPacks > 0 ? it.lowPacks * it.perPack : 0;
        return { item: it.name, base: have, text: fmtPack_(have, it),
                 low: limit > 0 && have <= limit };
      })
    };
  });

  return { success: true, data: {
    role: session.role, stockRole: stockRoleOf_(session),
    name: session.name, branch: session.branch,
    central: CENTRAL, locations: locations, items: items, stock: stock
  } };
}

/* ───────────────────────── ติดตั้งชีตรายการสินค้า ───────────────────────── */

/**
 * รายชื่อสินค้าตั้งต้น + หน่วยย่อย
 * ตัวเลขที่เจ้าของร้านให้ไว้ (กรัมต่อไม้ / ชิ้นต่อไม้) ใส่ไว้ในช่องหมายเหตุ
 * ไม่ได้เอาไปใส่ช่อง "หน่วยย่อยต่อแพ็ค" เพราะคนละค่ากัน:
 *   หน่วยย่อยต่อแพ็ค = 1 แพ็คมีกี่ไม้   (เช่น ไส้กรอกหนังกรอบ แพ็คละ 7 ไม้)
 *   ตัวเลขในหมายเหตุ  = 1 ไม้ใช้ของเท่าไหร่ (เช่น สันคอ 30 กรัมต่อไม้)
 * → ช่อง "หน่วยย่อยต่อแพ็ค" กับ "ราคาขาย" เว้นว่างไว้ ต้องกรอกเองก่อนใช้งานจริง
 */
var STOCK_ITEM_SEED = [
  ['สันคอสไลด์', 'ไม้', '30 กรัมต่อไม้'],
  ['สามชั้นสไลด์', 'ไม้', '30 กรัมต่อไม้'],
  ['เนื้อแดง', 'ไม้', '30 กรัมต่อไม้'],
  ['หมึก', 'ไม้', '35 กรัมต่อไม้'],
  ['ปลาดอลลี่', 'ไม้', '35 กรัมต่อไม้'],
  ['ปลาหมึกกรอบ', 'ไม้', '35 กรัมต่อไม้'],
  ['แมงกะพรุน', 'ไม้', '35 กรัมต่อไม้'],
  ['รากบัว', 'ไม้', '50 กรัมต่อไม้'],
  ['ปูอัด', 'ไม้', '2 อันต่อไม้'],
  ['ต็อก', 'ไม้', '5 อันต่อไม้'],
  ['เต้าหู้หลอด', 'ไม้', '1 อันต่อไม้'],
  ['ปูอัดชีส', 'ไม้', '1 อันต่อไม้'],
  ['ปูอัดยาว', 'ไม้', '1 อันต่อไม้'],
  ['เต้าหู้ปลาแผ่น', 'ไม้', '1 อันต่อไม้'],
  ['เต้าหู้ชีส', 'ไม้', '2 อันต่อไม้'],
  ['ชีสหลายสี', 'ไม้', '2 อันต่อไม้'],
  ['เต้าหู้หมู', 'ไม้', '3 อันต่อไม้'],
  ['ไส้กรอกพันเบคอน', 'ไม้', '3 อันต่อไม้'],
  ['ฟองเต้าหู้สามเหลี่ยม', 'ไม้', '3 อันต่อไม้'],
  ['ไส้กรอกหนังกรอบ', 'ไม้', '1 อันต่อไม้'],
  ['ไส้กรอกชมพู', 'ไม้', '1 อันต่อไม้'],
  ['วุ้นเส้นหม่าล่า', 'ไม้', '1 อันต่อไม้'],
  ['ฟองเต้าหู้', 'ไม้', '1 อันต่อไม้'],
  ['ควิซ', 'ไม้', '1 อันต่อไม้'],
  ['มาม่า', 'ไม้', '1 อันต่อไม้'],
  ['เห็ดออรินจิ', 'ไม้', '1 ไม้'],
  ['เส้นมันเทศ', 'กรัม', '55 กรัม'],
  ['เส้นอุด้ง', 'กรัม', '50 กรัม'],
  ['สาหร่าย', 'กรัม', '5 กรัม'],
  ['ผักกาดขาว', 'กรัม', '100 กรัม'],
  ['เห็ดเข็ม', 'กรัม', '50 กรัม'],
  ['เห็ดชิเมจิ', 'กรัม', '50 กรัม'],
  ['กวางตุ้ง', 'กรัม', '50 กรัม'],
  ['ผักบุ้ง', 'กรัม', '100 กรัม'],
  ['ข้าวโพด', 'กรัม', '25 กรัม'],
  ['กะหล่ำ', 'กรัม', '100 กรัม']
];

/**
 * รันครั้งเดียวเพื่อสร้างชีต "รายการสินค้า" และเติมคอลัมน์ใหม่ให้ชีตประวัติ
 * รันซ้ำได้ ไม่ลบข้อมูลเดิม — สินค้าที่มีอยู่แล้วจะข้ามไป
 */
function setupStock() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var items = ss.getSheetByName(SHEET_ITEMS);
  if (!items) items = ss.insertSheet(SHEET_ITEMS);
  var map = ensureCols_(items, ITEM_COLS);

  var have = {};
  if (items.getLastRow() > 1) {
    items.getRange(2, map['สินค้า'] + 1, items.getLastRow() - 1, 1).getValues()
      .forEach(function (r) { have[String(r[0]).trim()] = true; });
  }
  var added = 0;
  STOCK_ITEM_SEED.forEach(function (s) {
    if (have[s[0]]) return;
    var row = {};
    row['สินค้า'] = s[0];
    row['หน่วยย่อย'] = s[1];
    row['หน่วยแพ็ค'] = 'แพ็ค';
    row['หมายเหตุ'] = s[2];
    appendByCols_(items, map, row);   // หน่วยย่อยต่อแพ็ค / ราคา เว้นว่าง ให้กรอกเอง
    added++;
  });

  // เติมคอลัมน์ แพ็ค / เศษ / ไม้ต่อแพ็ค / ประเภท ให้ชีตประวัติ (ต่อท้าย ไม่แตะของเดิม)
  [SHEET_INCOMING, SHEET_COUNT, SHEET_WASTE].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    ensureCols_(sh, MOVE_COLS);
  });

  Logger.log('ติดตั้งเรียบร้อย — เพิ่มสินค้าใหม่ ' + added + ' รายการ\n' +
             'ยังต้องกรอกเองในชีต "' + SHEET_ITEMS + '":\n' +
             '  • หน่วยย่อยต่อแพ็ค = 1 แพ็คมีกี่ไม้\n' +
             '  • ราคาขาย/หน่วยย่อย = ขายไม้ละกี่บาท (ไม่ใส่ หน้าคำนวณของหายจะได้ 0 บาท)\n' +
             '  • เตือนเมื่อเหลือ(แพ็ค) = เหลือกี่แพ็คให้เตือนไลน์ (เว้นว่าง = ไม่เตือน)\n' +
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
      if (!tot && per > 0) tot = toBase_(packs, rem, per);
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

/* ───────────────── ใส่ราคาขายลงชีตรายการสินค้า ───────────────── */

/**
 * ราคาขายต่อไม้/ต่อที่ ตามที่เจ้าของร้านให้มา
 * ส่วนใหญ่ 10 บาท ยกเว้นที่ระบุไว้
 * รายการที่ราคายังไม่นิ่ง (มาม่า) เว้นเป็น 0 ไว้ ให้ไปกรอกเองในชีต
 */
var PRICE_DEFAULT = 10;
var PRICE_LIST = {
  'สันคอสไลด์': 10,
  'สามชั้นสไลด์': 10,
  'หัวไหล่สไลด์': 10,
  'หมูห่อชีส': 15,
  'ชีสใส่แก้ว': 15,
  'ดอลลี่': 10,
  'ปลาหมึกกรอบ': 10,
  'แมงกะพรุน': 10,
  'สามชั้นพันเห็ดเข็มทอง': 10,
  'สามชั้นพันสาหร่าย': 10,
  'ผักกาดขาว': 10,
  'ผักบุ้ง': 10,
  'กวางตุ้ง': 10,
  'เห็ดเข็มทอง': 10,
  'เห็ดออเร็นจิ': 10,
  'ข้าวโพดฝักใหญ่': 10,
  'ข้าวโพดเล็ก': 10,
  'กระเจี๊ยบ': 10,
  'สาหร่ายกระปุก': 10,
  'สาหร่ายแผ่น': 20,
  'เส้นมันเทศ': 10,
  'เส้นอุด้ง': 10,
  'วุ้นเส้น': 10,
  'วุ้นเส้นเกาหลี': 10,
  // 'มาม่า' ไม่อยู่ในนี้ — แยกเป็น มาม่า 10/15/20/35/45 ที่ splitMamaItems แทน
  'เต้าหู้ชีส': 10,
  'ชีสหลายสี': 10,
  'ฟองเต้าหู้สามเหลี่ยม': 10,
  'เบคอนพันไส้กรอก': 10,
  'กุ้งพันสาหร่าย': 10,
  'เต้าหู้หลอด': 10,
  'ปูอัด': 10,
  'ปูอัดยาว': 10,
  'ปูอัดชีส': 10,
  'เต้าหู้หมู': 10,
  'เต้าหู้ปลาสี่เหลี่ยม': 10,
  'เต้าหู้ปลาแผ่น': 10,
  'ไส้กรอกหนังกรอบ': 10,
  'ไส้กรอกชีส': 10,
  'ไส้กรอกชมพู': 10,
  'ปลาหมึกหลอด': 10,
  'ไส้กรอกอันเล็ก': 10,
  'ต็อก': 10,
  'ข้าวโพดเม็ดใส่แก้ว': 10
};

/**
 * ใส่ราคาลงชีตรายการสินค้าตาม PRICE_LIST
 *   • สินค้าที่มีอยู่แล้ว → อัปเดตราคา (ไม่แตะช่องอื่น)
 *   • สินค้าที่ยังไม่มี   → เพิ่มแถวใหม่ หน่วยย่อย "ไม้" ไว้ก่อน
 *   • สินค้าในชีตที่ไม่มีในรายการราคา → แค่รายงาน ไม่ลบให้
 * รันซ้ำได้
 */
function applyPriceList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_ITEMS);
  if (!sh) { Logger.log('ไม่พบชีต "' + SHEET_ITEMS + '" — รัน setupStock ก่อน'); return; }
  var map = ensureCols_(sh, ITEM_COLS);

  var cName  = map['สินค้า'];
  var cPrice = map['ราคาขาย/หน่วยย่อย'];
  var last   = sh.getLastRow();

  var rowOf = {};
  if (last > 1) {
    sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues().forEach(function (r, i) {
      var n = String(r[cName] || '').trim();
      if (n) rowOf[n] = i + 2;
    });
  }

  var updated = [], added = [], blank = [];
  Object.keys(PRICE_LIST).forEach(function (name) {
    var price = PRICE_LIST[name];
    if (!price) blank.push(name);

    if (rowOf[name]) {
      sh.getRange(rowOf[name], cPrice + 1).setValue(price || '');
      updated.push(name);
    } else {
      var row = {};
      row['สินค้า'] = name;
      row['หน่วยย่อย'] = 'ไม้';
      row['หน่วยแพ็ค'] = 'แพ็ค';
      row['ราคาขาย/หน่วยย่อย'] = price || '';
      appendByCols_(sh, map, row);
      added.push(name);
    }
  });

  // สินค้าในชีตที่ไม่มีในรายการราคา — อาจเลิกขายแล้ว หรือชื่อไม่ตรงกัน
  var extra = Object.keys(rowOf).filter(function (n) { return !(n in PRICE_LIST); });

  Logger.log('อัปเดตราคา ' + updated.length + ' รายการ');
  Logger.log('เพิ่มใหม่ ' + added.length + ' รายการ' + (added.length ? ':\n  ' + added.join('\n  ') : ''));
  if (blank.length) {
    Logger.log('⚠️ ยังไม่ได้ใส่ราคา ' + blank.length + ' รายการ (ราคาไม่นิ่ง ต้องกรอกเองในชีต):\n  ' + blank.join('\n  '));
  }
  if (extra.length) {
    Logger.log('⚠️ อยู่ในชีตแต่ไม่มีในรายการราคา ' + extra.length + ' รายการ\n' +
               '   อาจเลิกขายแล้ว หรือชื่อสะกดไม่ตรงกัน — ไม่ได้ลบให้ ตรวจเองก่อน:\n  ' + extra.join('\n  '));
  }
  Logger.log('\n⚠️ อย่าลืมเช็คช่อง "หน่วยย่อยต่อแพ็ค" ด้วย ราคาอย่างเดียวยังคำนวณของหายไม่ได้');
}

/* ───────────── รวมชื่อสินค้าที่เรียกไม่ตรงกันให้เป็นชื่อเดียว ───────────── */

/**
 * ชื่อเดิมในชีต → ชื่อที่จะใช้จริง
 * ของเดียวกันแต่เรียกคนละชื่อ ถ้าปล่อยไว้ยอดคงเหลือจะแตกเป็นสองแถว
 */
var ITEM_RENAME = {
  'ปลาดอลลี่':        'ดอลลี่',
  'เห็ดเข็ม':          'เห็ดเข็มทอง',
  'เห็ดออรินจิ':       'เห็ดออเร็นจิ',
  'สาหร่าย':          'สาหร่ายกระปุก',
  'วุ้นเส้นหม่าล่า':    'วุ้นเส้น',
  'ไส้กรอกพันเบคอน':  'เบคอนพันไส้กรอก',
  'ข้าวโพด':          'ข้าวโพดฝักใหญ่'
};

/** มาม่ามีหลายแบบ ราคาต่างกัน ต้องแยกเป็นคนละรายการถึงจะคิดของหายได้ */
var MAMA_PRICES = [10, 15, 20, 35, 45];

/** ชีตที่เก็บชื่อสินค้าไว้ในคอลัมน์ "รายการ" */
function historySheets_() { return [SHEET_INCOMING, SHEET_COUNT, SHEET_WASTE]; }

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
 * แยกมาม่าเป็นรายการย่อยตามราคา — มาม่า 10 / 15 / 20 / 35 / 45
 * ของเดิมชื่อ "มาม่า" เฉย ๆ ไม่ได้แตะ เพราะไม่มีทางรู้ว่าแถวเก่าเป็นแบบไหน
 * ตรวจในชีตแล้วค่อยลบหรือแก้เอง
 */
function splitMamaItems() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_ITEMS);
  if (!sh) { Logger.log('ไม่พบชีต "' + SHEET_ITEMS + '"'); return; }
  var map = ensureCols_(sh, ITEM_COLS);

  var have = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, map['สินค้า'] + 1, sh.getLastRow() - 1, 1).getValues()
      .forEach(function (r) { have[String(r[0]).trim()] = true; });
  }

  var added = [];
  MAMA_PRICES.forEach(function (p) {
    var name = 'มาม่า ' + p;
    if (have[name]) return;
    var row = {};
    row['สินค้า'] = name;
    row['หน่วยย่อย'] = 'ห่อ';
    row['หน่วยแพ็ค'] = 'แพ็ค';
    row['ราคาขาย/หน่วยย่อย'] = p;
    row['หมายเหตุ'] = 'แยกจาก "มาม่า" ตามราคา';
    appendByCols_(sh, map, row);
    added.push(name);
  });

  Logger.log('เพิ่มมาม่าแยกราคา ' + added.length + ' รายการ' + (added.length ? ': ' + added.join(', ') : ''));
  if (have['มาม่า']) {
    Logger.log('\n⚠️ ยังมีแถวชื่อ "มาม่า" เฉย ๆ อยู่ในชีต\n' +
               '   ระบบไม่รู้ว่าของเก่าที่ลงไว้เป็นมาม่าแบบไหน จึงไม่แตะให้\n' +
               '   ถ้าไม่ได้ใช้แล้วลบแถวนั้นทิ้งได้เลย');
  }
}

/** รันทีเดียวจบ: รวมชื่อ → แยกมาม่า → ใส่ราคา */
function fixItemList() {
  mergeItemNames();
  splitMamaItems();
  applyPriceList();
}
