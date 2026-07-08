/************************************************************
 * 🔔 แจ้งเตือน LINE: ของรายการไหนต้องทิ้งวันนี้
 *
 * วิธีทำงาน:
 *  - อ่านชีต "จำนวนของเข้า" ทุกเช้า (ตั้ง Trigger รายวัน)
 *  - ของเข้าวันที่ 1/7 → ครบกำหนดทิ้งวันที่ 7/7 (บวก EXPIRY_DAYS วัน)
 *  - ถ้าวันนี้มีของครบกำหนด (หรือเลยกำหนดแล้ว) จะส่งข้อความเข้า LINE
 *
 * วิธีติดตั้ง: อ่านไฟล์ README.md ในโฟลเดอร์เดียวกัน
 ************************************************************/

// ── ตั้งค่า ──
var EXPIRY_DAYS = 6;                       // ของเข้า 1/7 → ทิ้ง 7/7
var INCOMING_SHEET_NAME = 'จำนวนของเข้า';   // ชื่อชีตที่เก็บข้อมูลของเข้า
var TZ = 'Asia/Bangkok';
var OVERDUE_LOOKBACK_DAYS = 7;             // แจ้งของที่เลยกำหนดย้อนหลังไม่เกินกี่วัน
var NOTIFY_HOUR = 9;                       // ส่งแจ้งเตือนตอนกี่โมง (9 = 09:00 น.)

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

    var expire = new Date(inDate.getTime());
    expire.setDate(expire.getDate() + EXPIRY_DAYS);
    var expireKey = dateKey_(expire);

    var item = {
      name:      String(row[colName] || '').trim(),
      qty:       colQty    !== -1 ? row[colQty]    : '',
      unit:      colUnit   !== -1 ? String(row[colUnit] || '')   : '',
      branch:    colBranch !== -1 ? String(row[colBranch] || '') : '',
      inDate:    thaiDMY_(inDate),
      expireKey: expireKey
    };
    if (!item.name) continue;

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
 * รันครั้งเดียวเพื่อตั้ง Trigger ส่งแจ้งเตือนทุกวันตอน NOTIFY_HOUR น.
 */
function setupDailyTrigger() {
  // ลบ trigger เก่าของฟังก์ชันนี้ก่อน กันซ้ำ
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'notifyExpiringItems') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('notifyExpiringItems')
    .timeBased()
    .everyDays(1)
    .atHour(NOTIFY_HOUR)
    .create();
  Logger.log('ตั้ง Trigger รายวันเวลาประมาณ ' + NOTIFY_HOUR + ':00 น. เรียบร้อย');
}

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
