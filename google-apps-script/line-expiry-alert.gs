/************************************************************
 * 🔔 แจ้งเตือน LINE: ของรายการไหนต้องทิ้งวันนี้
 *
 * มี 2 การแจ้งเตือน:
 *  1) ของเข้าใหม่ — เช็คชีต "จำนวนของเข้า" ทุก 5 นาที
 *     ถ้ามีของเข้าใหม่ จะแจ้ง LINE ทันทีว่าเข้าอะไรบ้าง
 *     พร้อมวันที่ควรทิ้งของแต่ละรายการ
 *  2) ของครบกำหนดทิ้ง — ทุกวันตอน 1 ทุ่ม (19:00 น.)
 *     แจ้งว่าวันนี้ของรายการไหนต้องเอาออก/ทิ้งแล้ว
 *
 * อายุของแต่ละรายการดู ITEM_EXPIRY_DAYS ด้านล่าง
 * นับรวมวันที่ของเข้า เช่น เข้า 1/7 อยู่ได้ 5 วัน → ต้องทิ้ง 5/7
 *
 * วิธีติดตั้ง: อ่านไฟล์ README.md ในโฟลเดอร์เดียวกัน
 ************************************************************/

// ── ตั้งค่า ──
// อายุของแต่ละรายการ (วัน นับรวมวันที่ของเข้า) — รายการที่ไม่อยู่ในตารางใช้ค่า DEFAULT
var EXPIRY_DAYS_DEFAULT = 7;
var ITEM_EXPIRY_DAYS = {
  // ไม่เกิน 5 วัน
  'สันคอสไลด์': 5, 'สามชั้นสไลด์': 5, 'เนื้อแดง': 5, 'กุ้ง': 5,
  // ไม่เกิน 10 วัน
  'หมึก': 10, 'ปลาดอลลี่': 10, 'ปลาหมึกกรอบ': 10, 'แมงกะพรุน': 10,
  // ไม่เกิน 1 เดือน (30 วัน)
  'รากบัว': 30, 'ต็อก': 30, 'แป้งต็อก': 30,
  // ไม่เกิน 14 วัน
  'ปูอัด': 14, 'เต้าหู้ชีส': 14, 'ชีสหลายสี': 14, 'กุ้งพันสาหร่าย': 14,
  'ไส้กรอกพันเบคอน': 14, 'ฟองเต้าหู้สามเหลี่ยม': 14, 'ไส้กรอกหนังกรอบ': 14, 'ไส้กรอกชมพู': 14
};
function getItemExpiryDays_(name) { return ITEM_EXPIRY_DAYS[name] || EXPIRY_DAYS_DEFAULT; }

var INCOMING_SHEET_NAME = 'จำนวนของเข้า';   // ชื่อชีตที่เก็บข้อมูลของเข้า
var TZ = 'Asia/Bangkok';
var OVERDUE_LOOKBACK_DAYS = 7;             // แจ้งของที่เลยกำหนดย้อนหลังไม่เกินกี่วัน
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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
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
  if (lastRow <= lastNotified) return; // ไม่มีแถวใหม่

  var values = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
  var headers = values[0].map(function(h) { return String(h).trim(); });
  var colDate    = findCol_(headers, ['วันที่เวลา', 'วันที่', 'timestamp']);
  var colBranch  = findCol_(headers, ['สาขา', 'branch']);
  var colChecker = findCol_(headers, ['ผู้ตรวจ', 'checker']);
  var colName    = findCol_(headers, ['รายการ', 'ชื่อรายการ', 'ชื่อ', 'name']);
  var colQty     = findCol_(headers, ['จำนวน', 'qty']);
  var colUnit    = findCol_(headers, ['หน่วย', 'unit']);
  if (colName === -1) return;

  var items = [];
  for (var r = lastNotified; r < lastRow; r++) { // index ใน values = เลขแถว - 1
    var row = values[r];
    var name = String(row[colName] || '').trim();
    if (!name) continue;
    var inDate = (colDate !== -1 ? parseThaiDate_(row[colDate]) : null) || new Date();
    var days = getItemExpiryDays_(name);
    var expire = new Date(inDate.getTime());
    expire.setDate(expire.getDate() + days - 1);
    items.push({
      name:       name,
      qty:        colQty     !== -1 ? row[colQty] : '',
      unit:       colUnit    !== -1 ? String(row[colUnit] || '')    : '',
      branch:     colBranch  !== -1 ? String(row[colBranch] || '')  : '',
      checker:    colChecker !== -1 ? String(row[colChecker] || '') : '',
      expiryDays: days,
      expireStr:  thaiDMY_(expire)
    });
  }

  // จำตำแหน่งใหม่ก่อนส่ง กันแจ้งซ้ำถ้าส่งสำเร็จแต่สคริปต์สะดุดทีหลัง
  props.setProperty(PROP_LAST_ROW, String(lastRow));
  if (!items.length) return;

  sendLinePush_(buildIncomingMessage_(items));
  Logger.log('แจ้งของเข้าใหม่ ' + items.length + ' รายการ');
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
      lines.push('• ' + it.name +
        (it.qty !== '' && it.qty != null ? ' ' + it.qty + ' ' + it.unit : '') +
        ' → ทิ้ง ' + it.expireStr + ' (อยู่ได้ ' + it.expiryDays + ' วัน)');
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
  var result = getItemsToDiscard_();
  if (result.today.length === 0 && result.overdue.length === 0) {
    Logger.log('วันนี้ไม่มีของต้องทิ้ง — ไม่ส่งแจ้งเตือน');
    return;
  }
  var msg = buildMessage_(result);
  sendLinePush_(msg);
  Logger.log('ส่งแจ้งเตือน LINE แล้ว:\n' + msg);
}

/**
 * อ่านชีต "จำนวนของเข้า" แล้วหาของที่ครบกำหนดทิ้งวันนี้ / เลยกำหนดแล้ว
 */
function getItemsToDiscard_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(INCOMING_SHEET_NAME);
  if (!sheet) throw new Error('ไม่พบชีตชื่อ "' + INCOMING_SHEET_NAME + '"');

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return { today: [], overdue: [], todayKey: todayKey_() };

  var headers = values[0].map(function(h) { return String(h).trim(); });
  var colDate   = findCol_(headers, ['วันที่เวลา', 'วันที่', 'timestamp']);
  var colBranch = findCol_(headers, ['สาขา', 'branch']);
  var colName   = findCol_(headers, ['รายการ', 'ชื่อรายการ', 'ชื่อ', 'name']);
  var colQty    = findCol_(headers, ['จำนวน', 'qty']);
  var colUnit   = findCol_(headers, ['หน่วย', 'unit']);
  if (colDate === -1 || colName === -1) {
    throw new Error('หาคอลัมน์ วันที่เวลา/รายการ ในชีตไม่เจอ — หัวตารางปัจจุบัน: ' + headers.join(', '));
  }

  var tKey = todayKey_();
  var today = [], overdue = [];

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var inDate = parseThaiDate_(row[colDate]);
    if (!inDate) continue;

    var name = String(row[colName] || '').trim();
    if (!name) continue;

    // อยู่ได้ N วัน นับรวมวันของเข้า → วันที่ต้องทิ้ง = วันเข้า + (N-1)
    var expiryDays = getItemExpiryDays_(name);
    var expire = new Date(inDate.getTime());
    expire.setDate(expire.getDate() + expiryDays - 1);
    var expireKey = dateKey_(expire);

    var item = {
      name:       name,
      qty:        colQty    !== -1 ? row[colQty]    : '',
      unit:       colUnit   !== -1 ? String(row[colUnit] || '')   : '',
      branch:     colBranch !== -1 ? String(row[colBranch] || '') : '',
      inDate:     thaiDMY_(inDate),
      expiryDays: expiryDays,
      expireKey:  expireKey
    };

    if (expireKey === tKey) {
      today.push(item);
    } else if (expireKey < tKey) {
      // เลยกำหนดแล้ว — แจ้งเฉพาะที่เลยมาไม่นาน (กัน spam ข้อมูลเก่า)
      var daysOver = Math.round((keyToDate_(tKey) - keyToDate_(expireKey)) / 86400000);
      if (daysOver <= OVERDUE_LOOKBACK_DAYS) {
        item.daysOver = daysOver;
        overdue.push(item);
      }
    }
  }
  return { today: today, overdue: overdue, todayKey: tKey };
}

/**
 * สร้างข้อความแจ้งเตือน จัดกลุ่มตามสาขา
 */
function buildMessage_(result) {
  var lines = ['🔔 แจ้งเตือนของหมดอายุ (' + thaiDMY_(keyToDate_(result.todayKey)) + ')'];

  if (result.today.length) {
    lines.push('');
    lines.push('🗑️ ของที่ต้องทิ้ง "วันนี้":');
    lines = lines.concat(groupByBranch_(result.today, function(it) {
      return '• ' + it.name + (it.qty !== '' && it.qty != null ? ' ' + it.qty + ' ' + it.unit : '') + ' (เข้า ' + it.inDate + ')';
    }));
  }

  if (result.overdue.length) {
    lines.push('');
    lines.push('⚠️ เลยกำหนดทิ้งแล้ว:');
    lines = lines.concat(groupByBranch_(result.overdue, function(it) {
      return '• ' + it.name + (it.qty !== '' && it.qty != null ? ' ' + it.qty + ' ' + it.unit : '') + ' (เลยมา ' + it.daysOver + ' วัน)';
    }));
  }

  return lines.join('\n');
}

function groupByBranch_(items, formatFn) {
  var byBranch = {};
  items.forEach(function(it) {
    var b = it.branch || 'ไม่ระบุสาขา';
    if (!byBranch[b]) byBranch[b] = [];
    byBranch[b].push(formatFn(it));
  });
  var out = [];
  Object.keys(byBranch).forEach(function(b) {
    out.push('📍 ' + b);
    out = out.concat(byBranch[b]);
  });
  return out;
}

/**
 * ส่งข้อความผ่าน LINE Messaging API (push message)
 * ต้องตั้ง Script Properties: LINE_CHANNEL_ACCESS_TOKEN และ LINE_TARGET_ID
 */
function sendLinePush_(text) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  var to    = props.getProperty('LINE_TARGET_ID');
  if (!token || !to) {
    throw new Error('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN / LINE_TARGET_ID ใน Script Properties (ดู README.md)');
  }

  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: text }] }),
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
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(INCOMING_SHEET_NAME);
  if (sheet) {
    PropertiesService.getScriptProperties().setProperty(PROP_LAST_ROW, String(sheet.getLastRow()));
  }
  Logger.log('ตั้ง Trigger เรียบร้อย: เช็คของเข้าใหม่ทุก ' + INCOMING_POLL_MINUTES +
             ' นาที + แจ้งของครบกำหนดทุกวันประมาณ ' + NOTIFY_HOUR + ':00 น.');
}

// ชื่อเดิม เผื่อเคยตั้งไว้แล้ว — เรียกตัวใหม่ให้เลย
function setupDailyTrigger() { setupTriggers(); }

/**
 * ทดสอบส่งข้อความเข้า LINE (เช็คว่า token/target ถูกต้อง)
 */
function testLineConnection() {
  sendLinePush_('✅ ทดสอบระบบแจ้งเตือนของหมดอายุ — เชื่อมต่อ LINE สำเร็จ!');
  Logger.log('ส่งข้อความทดสอบแล้ว เช็คใน LINE ได้เลย');
}

/**
 * ทดสอบรันแจ้งเตือนจริงทันที (ไม่ต้องรอ Trigger)
 */
function testNotifyNow() {
  notifyExpiringItems();
}

/**
 * ดูรายการที่จะถูกแจ้งเตือน โดยไม่ส่ง LINE (ดูผลใน Logs)
 */
function previewItems() {
  var result = getItemsToDiscard_();
  Logger.log('ต้องทิ้งวันนี้: ' + JSON.stringify(result.today, null, 2));
  Logger.log('เลยกำหนด: ' + JSON.stringify(result.overdue, null, 2));
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
