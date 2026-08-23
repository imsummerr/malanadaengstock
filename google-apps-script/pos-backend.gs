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

var SESSION_HOURS = 16;              // token หมดอายุกี่ชั่วโมง
var MAMA_PRICES   = [10, 15, 20, 35, 45];
var STICK_PRICES  = [10, 15];

var ORDER_HEADERS = [
  'วันที่', 'เวลา', 'เลขที่ออเดอร์', 'สาขา', 'พนักงาน',
  'ไม้ 10฿', 'ไม้ 15฿', 'รวมไม้', 'ยอดไม้',
  'มาม่า 10฿', 'มาม่า 15฿', 'มาม่า 20฿', 'มาม่า 35฿', 'มาม่า 45฿', 'รวมมาม่า', 'ยอดมาม่า',
  'ยอดรวม', 'ส่วนลด', 'ยอดสุทธิ',
  'น้ำซุป', 'ความเผ็ด', 'น้ำจิ้ม', 'วิธีชำระเงิน', 'order_id'
];

// ══════════════════════════════════════════════════════════════
//  ติดตั้งครั้งแรก — รันฟังก์ชันนี้ 1 ครั้ง
// ══════════════════════════════════════════════════════════════
function setupPos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var orders = getOrCreateSheet_(ss, SHEET_ORDERS);
  if (orders.getLastRow() === 0) {
    orders.appendRow(ORDER_HEADERS);
    orders.getRange(1, 1, 1, ORDER_HEADERS.length)
      .setFontWeight('bold').setBackground('#fee2e2').setFontColor('#991b1b');
    orders.setFrozenRows(1);
  }

  var users = getOrCreateSheet_(ss, SHEET_USERS);
  if (users.getLastRow() === 0) {
    users.appendRow(['username', 'password', 'ชื่อ', 'สาขา', 'ใช้งาน']);
    users.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#fee2e2').setFontColor('#991b1b');
    users.setFrozenRows(1);
    users.appendRow(['admin', '1234', 'ผู้จัดการ', 'ตลาดทรัพย์พัฒนา', 'ใช่']);
    users.appendRow(['baring', '1234', 'พนักงานแบริ่ง', 'แบริ่ง', 'ใช่']);
  }

  var sessions = getOrCreateSheet_(ss, SHEET_SESSIONS);
  if (sessions.getLastRow() === 0) {
    sessions.appendRow(['token', 'username', 'ชื่อ', 'สาขา', 'เวลา login', 'ใช้งานล่าสุด']);
    sessions.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#e5e7eb');
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
    switch (body.action) {
      case 'login':    return json_(handleLogin_(body));
      case 'logout':   return json_(handleLogout_(body));
      case 'posOrder': return json_(handleOrder_(body));
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
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SESSIONS)
      .appendRow([token, r[0], r[2], r[3], now, now]);
    cleanOldSessions_();
    return { success: true, token: token, name: String(r[2] || r[0]), branch: String(r[3] || '') };
  }
  return { success: false, message: 'Username หรือ Password ไม่ถูกต้อง' };
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
    sheet.getRange(i + 1, 6).setValue(new Date());
    return { username: rows[i][1], name: rows[i][2], branch: rows[i][3] };
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
    row.push(o.soup || '', o.spice || '', o.sauce || '', o.method || '', o.orderId || '');

    var orderNo = nextOrderNo_(sheet, row[0]);
    row[2] = orderNo;
    sheet.appendRow(row);
    return { success: true, orderNo: orderNo };
  } finally {
    lock.releaseLock();
  }
}

/** เลขที่ออเดอร์ = วันที่ + ลำดับของวันนั้น เช่น 20260823-014 */
function nextOrderNo_(sheet, dateStr) {
  var last = sheet.getLastRow();
  var count = 0;
  if (last > 1) {
    var dates = sheet.getRange(2, 1, last - 1, 1).getDisplayValues();
    for (var i = 0; i < dates.length; i++) if (dates[i][0] === dateStr) count++;
  }
  return dateStr.replace(/-/g, '') + '-' + ('00' + (count + 1)).slice(-3);
}

function findOrderRow_(sheet, orderId) {
  if (!orderId) return null;
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var col = ORDER_HEADERS.indexOf('order_id') + 1;
  var ids = sheet.getRange(2, col, last - 1, 1).getDisplayValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (ids[i][0] === String(orderId)) return sheet.getRange(i + 2, 3).getDisplayValue();
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
//  สรุปยอดสำหรับหน้า Dashboard
// ══════════════════════════════════════════════════════════════
function handleStats_(p) {
  var session = checkToken_(p.token);
  if (!session) return { success: false, code: 401, message: 'Session หมดอายุ กรุณา Login ใหม่' };

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ORDERS);
  if (!sheet || sheet.getLastRow() < 2) return { success: true, data: emptyStats_() };

  var values = sheet.getRange(1, 1, sheet.getLastRow(), ORDER_HEADERS.length).getDisplayValues();
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
    var date = r[idx['วันที่']];
    if (!date || date < from || date > to) continue;
    if (branch && r[idx['สาขา']] !== branch) continue;

    var total    = num_(r[idx['ยอดสุทธิ']]);
    var discount = num_(r[idx['ส่วนลด']]);

    stats.orders++;
    stats.revenue  += total;
    stats.discount += discount;
    stats.sticks   += num_(r[idx['รวมไม้']]);
    stats.mama     += num_(r[idx['รวมมาม่า']]);

    bump_(stats.soup,   r[idx['น้ำซุป']]);
    bump_(stats.spice,  r[idx['ความเผ็ด']]);
    bump_(stats.sauce,  r[idx['น้ำจิ้ม']]);
    bump_(stats.method, r[idx['วิธีชำระเงิน']]);
    bump_(stats.branch, r[idx['สาขา']]);
    addTo_(stats.methodRevenue, r[idx['วิธีชำระเงิน']], total);

    if (!byDate[date]) byDate[date] = { date: date, orders: 0, revenue: 0, sticks: 0 };
    byDate[date].orders++;
    byDate[date].revenue += total;
    byDate[date].sticks  += num_(r[idx['รวมไม้']]);
  }

  stats.avgTicket = stats.orders ? Math.round(stats.revenue / stats.orders * 100) / 100 : 0;
  stats.byDate = Object.keys(byDate).sort().map(function (d) { return byDate[d]; });
  stats.branches = listBranches_(values, idx);
  return { success: true, data: stats };
}

function emptyStats_() {
  return {
    orders: 0, revenue: 0, discount: 0, sticks: 0, mama: 0, avgTicket: 0,
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
