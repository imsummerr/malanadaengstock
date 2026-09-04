/************************************************************
 * 📥 ส่งไลน์ → บันทึกลงชีตให้เลย
 *
 * พิมพ์ในไลน์ว่า  "สลีปดอลลี่ 68 บาท 800 กรัม"  หรือถ่ายรูปบิล/ป้ายราคาส่งมา
 * บอทจะอ่าน แล้วลงชีต "ซื้อของเข้า" ให้ทันที พร้อมตอบกลับว่าบันทึกอะไรไป
 *
 * ── ทำอะไรได้บ้าง ──
 *   ข้อความ  ฟรี                อ่านด้วยตัวแยกคำในไฟล์นี้
 *   รูป      ฟรี (ค่าเริ่มต้น)   OCR ของ Google Drive — แค่เปิดบริการ Drive API ในโปรเจกต์
 *            แม่นกว่าแต่เสียเงิน ตั้ง ANTHROPIC_API_KEY ให้ Claude อ่าน (~1 บาท/รูป)
 *            เลือกทางได้ที่ Script Property ชื่อ INTAKE_IMAGE_MODE
 *
 * ── คำสั่งที่พิมพ์ในไลน์ได้ ──
 *   ลบ / ยกเลิก      ลบรายการล่าสุดที่ตัวเองเพิ่งบันทึก
 *   ยอดวันนี้ / สรุป  ดูยอดซื้อของวันนี้
 *   ช่วย / วิธีใช้     ดูวิธีพิมพ์
 *
 * ⚠️ ไฟล์นี้ต้องอยู่ "โปรเจกต์เดียวกับ pos-backend.gs" เพราะ Apps Script
 *    มี doPost ได้ตัวเดียวต่อโปรเจกต์ — doPost ใน pos-backend.gs จะเรียก
 *    handleLineIntake_ ในไฟล์นี้ให้เอง
 *
 * วิธีติดตั้ง: อ่าน LINE-INTAKE-README.md ในโฟลเดอร์เดียวกัน
 ************************************************************/

// ══════════════════════════════════════════════════════════════
//  ตั้งค่า
// ══════════════════════════════════════════════════════════════

/**
 * ชีตปลายทาง — แยกจาก "จำนวนของเข้า" โดยตั้งใจ
 * ชีตนั้นเก็บ "จำนวนไม้" ไว้คิดยอดคงเหลือ ถ้าเอาน้ำหนัก/ราคามาปนกัน
 * ยอดสต็อกคงเหลือจะเพี้ยนทันที
 */
var INTAKE_SHEET = 'ซื้อของเข้า';

var INTAKE_HEADERS = [
  'วันที่', 'เวลา', 'เลขที่', 'สถานที่', 'ผู้บันทึก',
  'รายการ', 'ชื่อที่พิมพ์มา', 'จำนวนเงิน', 'น้ำหนัก(กรัม)', 'บาท/กก.',
  'จำนวน', 'หน่วย', 'ที่มา', 'ข้อความต้นฉบับ', 'messageId', 'วิธีจ่าย'
];

/* ── ค่าใช้จ่ายรายวัน (ค่าที่ ค่าแก๊ส ฯลฯ) ────────────────────────
   ลงชีตเดียวกับที่หน้า POS ใช้ ข้อมูลจะได้อยู่ที่เดียว
   หน้าสรุปยอดขายและระบบบัญชีเห็นทันทีโดยไม่ต้องแก้อะไรเพิ่ม           */
var INTAKE_EXPENSE_SHEET = 'POS_Expenses';

var INTAKE_EXPENSE_HEADERS = [
  'วันที่', 'เวลา', 'เลขที่', 'สาขา', 'พนักงาน', 'ประเภท', 'รายละเอียด', 'จำนวนเงิน', 'order_id',
  'วิธีจ่าย'
];

/** ต้องตรงกับ EXPENSE_TYPES ใน pos-backend.gs */
var INTAKE_EXPENSE_TYPES = ['ค่าที่', 'ค่าไม้เสียบ', 'ค่าแก๊ส', 'ค่าน้ำแข็ง', 'ค่าของสด', 'ค่าแรง', 'อื่น ๆ'];

/** คำที่คนเรียกกันเอง → ประเภทค่าใช้จ่ายในระบบ */
var INTAKE_EXPENSE_ALIAS = {
  'ค่าเช่า': 'ค่าที่', 'ค่าเช่าที่': 'ค่าที่', 'ค่าแผง': 'ค่าที่', 'ค่าล็อค': 'ค่าที่', 'ค่าล็อก': 'ค่าที่',
  'ค่าไม้': 'ค่าไม้เสียบ', 'ค่าแก้ส': 'ค่าแก๊ส', 'ค่าน้ำแข็งเปล่า': 'ค่าน้ำแข็ง',
  'ค่าจ้าง': 'ค่าแรง', 'ค่าลูกจ้าง': 'ค่าแรง', 'ค่าแรงงาน': 'ค่าแรง'
};

/**
 * วิธีจ่าย — เรียงตามลำดับที่ตรวจ เจอตัวไหนก่อนใช้ตัวนั้น
 * ไม่ใส่คำว่า "สด" เดี่ยว ๆ เพราะไปชนกับ "ค่าของสด"
 */
var INTAKE_PAY_PATTERNS = [
  { re: /บัตรเครดิต|เครดิต|บัตร|credit\s*card|credit/gi, name: 'บัตรเครดิต' },
  { re: /โอนจ่าย|จ่ายโอน|โอน|พร้อมเพย์|promptpay|transfer/gi, name: 'โอน' },
  { re: /เงินสด|cash/gi, name: 'เงินสด' }
];

/**
 * คำนำหน้าเวลาพิมพ์ "ในกลุ่ม" — กันบอทเก็บบทสนทนาทั่วไปของกลุ่มลงชีต
 * แชทส่วนตัวกับบอทไม่ต้องใส่คำนำหน้า พิมพ์ของได้เลย
 */
var INTAKE_PREFIXES = ['ซื้อ', 'บันทึก', 'ลงของ', 'เพิ่ม', '#'];

/** รุ่นที่ใช้อ่านรูป — เปลี่ยนได้ที่ Script Property ชื่อ INTAKE_MODEL */
var INTAKE_MODEL_DEFAULT = 'claude-opus-5';

/** กันข้อความเดียวยิงยาว — ตัดที่ 30 รายการต่อ 1 ข้อความ */
var INTAKE_MAX_ITEMS = 30;

/** รูปใหญ่เกินนี้ (ไบต์) ให้ดึงรูปย่อจาก LINE แทน — Anthropic รับรูปไม่เกิน 5MB */
var INTAKE_MAX_IMAGE_BYTES = 3500000;

function intakeTz_()    { return (typeof TZ === 'string' && TZ) ? TZ : 'Asia/Bangkok'; }
function intakeProps_() { return PropertiesService.getScriptProperties(); }
function intakeProp_(key, fallback) {
  var v = intakeProps_().getProperty(key);
  return (v === null || v === undefined || v === '') ? fallback : String(v).trim();
}

// ══════════════════════════════════════════════════════════════
//  ทางเข้า — doPost ใน pos-backend.gs เรียกฟังก์ชันนี้
// ══════════════════════════════════════════════════════════════

/**
 * รับ webhook จาก LINE แล้วจัดการทีละ event
 * ต้องตอบ 200 ให้ LINE เสมอ ไม่ว่าข้างในจะพังตรงไหน — ถ้าตอบ error
 * LINE จะยิงซ้ำเรื่อย ๆ และสุดท้ายปิด webhook ให้เอง
 */
function handleLineIntake_(body) {
  try {
    var events = (body && body.events) || [];
    for (var i = 0; i < events.length; i++) {
      try {
        intakeHandleEvent_(events[i]);
      } catch (err) {
        Logger.log('line-intake event error: ' + (err && err.message ? err.message : err));
      }
    }
  } catch (err) {
    Logger.log('handleLineIntake_: ' + (err && err.message ? err.message : err));
  }
  return ContentService.createTextOutput('OK');
}

/** จัดการ 1 event: ดูว่าเป็นข้อความหรือรูป แล้วส่งต่อให้ตัวอ่าน */
function intakeHandleEvent_(ev) {
  if (!ev || !ev.type) return;

  var srcId = intakeSourceId_(ev);
  if (!intakeAllowed_(srcId)) {
    Logger.log('line-intake: ไม่รับจาก ' + srcId + ' (ไม่อยู่ใน INTAKE_ALLOW)');
    return;
  }

  // เพิ่งแอดบอทเป็นเพื่อน หรือเพิ่งเชิญเข้ากลุ่ม — บอกวิธีใช้ให้เลย
  if (ev.type === 'follow' || ev.type === 'join') {
    intakeReply_({ srcId: srcId, token: ev.replyToken }, intakeHelpText_());
    return;
  }

  if (ev.type !== 'message' || !ev.message) return;

  var kind = ev.message.type;
  if (kind !== 'text' && kind !== 'image') return;

  // LINE ยิง webhook ซ้ำได้ถ้าฝั่งเราตอบช้า — กันบันทึกซ้ำด้วย messageId
  if (intakeSeen_(ev.message.id)) return;

  var ctx = {
    srcId:    srcId,
    isGroup:  (ev.source || {}).type !== 'user',
    who:      intakeProfileName_(ev),
    location: intakeLocationOf_(srcId),
    token:    ev.replyToken,
    msgId:    String(ev.message.id || '')
  };

  if (kind === 'text') intakeOnText_(ev, ctx);
  else                 intakeOnImage_(ev, ctx);
}

/** ข้อความ — เช็คคำสั่งก่อน ถ้าไม่ใช่คำสั่งค่อยอ่านเป็นรายการของ */
function intakeOnText_(ev, ctx) {
  var raw = String(ev.message.text || '').trim();
  if (!raw) return;

  switch (intakeCommandOf_(raw)) {
    case 'help':  intakeReply_(ctx, intakeHelpText_());        return;
    case 'undo':  intakeReply_(ctx, intakeUndo_(ctx));         return;
    case 'today': intakeReply_(ctx, intakeTodaySummary_());    return;
    case 'pl':    intakeReply_(ctx, intakeAccounting_('month')); return;
    case 'card':  intakeReply_(ctx, intakeAccounting_('card'));  return;
  }

  var stripped = intakeStripPrefix_(raw);

  // ในกลุ่มต้องมีคำนำหน้า ไม่งั้นบอทจะเก็บทุกประโยคที่คนคุยกันลงชีต
  if (ctx.isGroup && stripped === null && intakeProp_('INTAKE_GROUP_MODE', 'prefix') !== 'all') return;

  var items = intakeParseText_(stripped === null ? raw : stripped);
  if (!items.length) {
    intakeReply_(ctx, 'อ่านไม่ออกว่าซื้ออะไรครับ 🤔\n\nพิมพ์แบบนี้ได้เลย\n' +
                      '  ปลาดอลลี่ 68 บาท 800 กรัม\n\nหรือพิมพ์ "ช่วย" ดูวิธีใช้');
    return;
  }

  intakeReply_(ctx, intakeSaveAndSummarize_(items, ctx, 'ข้อความ', raw));
}

/**
 * เลือกทางอ่านรูป ตาม Script Property ชื่อ INTAKE_IMAGE_MODE
 *   auto (ค่าเริ่มต้น)  มี ANTHROPIC_API_KEY ใช้ Claude / ไม่มีก็ใช้ OCR ฟรีของ Google
 *   ocr                 ใช้ OCR ฟรีอย่างเดียว ไม่เสียเงิน
 *   claude              ใช้ Claude อย่างเดียว
 *   off                 ไม่อ่านรูปเลย
 */
function intakeImageMode_() {
  var m = String(intakeProp_('INTAKE_IMAGE_MODE', 'auto')).toLowerCase();
  if (m === 'ocr' || m === 'claude' || m === 'off') return m;
  return intakeProp_('ANTHROPIC_API_KEY', '') ? 'claude' : 'ocr';
}

/** รูป — โหลดรูปจาก LINE แล้วอ่านออกมาเป็นรายการ */
function intakeOnImage_(ev, ctx) {
  var mode = intakeImageMode_();
  if (mode === 'off') {
    intakeReply_(ctx, '📷 ได้รับรูปแล้ว แต่ระบบปิดการอ่านรูปไว้ครับ\n' +
                      'พิมพ์เป็นข้อความมาได้เลย เช่น "ปลาดอลลี่ 68 บาท 800 กรัม"');
    return;
  }

  var read;
  try {
    var blob = intakeFetchImage_(ctx.msgId);
    read = (mode === 'claude')
      ? intakeReadImage_(blob, intakeProp_('ANTHROPIC_API_KEY', ''))
      : intakeOcrImage_(blob);
  } catch (err) {
    intakeReply_(ctx, '📷 อ่านรูปไม่สำเร็จครับ: ' + (err && err.message ? err.message : err) +
                      '\n\nพิมพ์เป็นข้อความมาแทนได้เลย');
    return;
  }

  if (!read.items.length) {
    intakeReply_(ctx, '📷 เปิดรูปได้ แต่ไม่เจอรายการของที่ซื้อครับ' +
                      (read.note ? '\n(' + read.note + ')' : '') +
                      '\n\nลองถ่ายให้ชัดขึ้น หรือพิมพ์เป็นข้อความมาแทน');
    return;
  }

  var summary = intakeSaveAndSummarize_(read.items, ctx, 'รูป', '');
  intakeReply_(ctx, summary + (read.note ? '\n\n📝 ' + read.note : ''));
}

// ══════════════════════════════════════════════════════════════
//  ที่มาของข้อความ — ใครส่ง ส่งจากไหน รับไหม
// ══════════════════════════════════════════════════════════════

/** id ของต้นทาง: กลุ่ม/ห้องใช้ id ของกลุ่ม แชทเดี่ยวใช้ userId */
function intakeSourceId_(ev) {
  var s = ev.source || {};
  return String(s.groupId || s.roomId || s.userId || '');
}

/**
 * รับข้อความจากต้นทางนี้ไหม
 * Apps Script อ่าน header ของ request ไม่ได้ จึงตรวจลายเซ็น X-Line-Signature ไม่ได้
 * ใครรู้ URL ก็ยิง payload ปลอมเข้ามาได้ — ตั้ง INTAKE_ALLOW เป็นรายชื่อ id
 * ที่อนุญาต (คั่นด้วย comma) เพื่อล็อกไว้ ปล่อยว่าง = รับหมด
 */
function intakeAllowed_(srcId) {
  var allow = intakeProp_('INTAKE_ALLOW', '');
  if (!allow) {
    intakeRememberSender_(srcId);   // จดไว้ให้เอาไปใส่ INTAKE_ALLOW ทีหลัง
    return true;
  }
  var list = allow.split(',');
  for (var i = 0; i < list.length; i++) {
    if (String(list[i]).trim() === srcId) return true;
  }
  return false;
}

/** จดต้นทางที่เคยส่งเข้ามา ไว้ให้ showIntakeSenders() แสดง (วันละครั้งพอ) */
function intakeRememberSender_(srcId) {
  if (!srcId) return;
  var today = Utilities.formatDate(new Date(), intakeTz_(), 'd/M/yyyy');
  var cache = CacheService.getScriptCache();
  var mark  = 'intake_src_' + intakeKeyOf_(srcId) + '_' + today;
  if (cache.get(mark)) return;

  try {
    var props = intakeProps_();
    var seen  = {};
    try { seen = JSON.parse(props.getProperty('INTAKE_SENDERS') || '{}'); } catch (e) {}
    seen[srcId] = today;
    props.setProperty('INTAKE_SENDERS', JSON.stringify(seen));
    cache.put(mark, '1', 21600);
  } catch (err) {
    Logger.log('intakeRememberSender_: ' + err.message);
  }
}

/** ข้อความนี้เคยประมวลผลไปแล้วหรือยัง (กัน LINE ยิงซ้ำ) */
function intakeSeen_(messageId) {
  if (!messageId) return false;
  var cache = CacheService.getScriptCache();
  var key   = 'intake_msg_' + messageId;
  if (cache.get(key)) return true;
  cache.put(key, '1', 21600);   // 6 ชั่วโมง — LINE ยิงซ้ำภายในไม่กี่นาที
  return false;
}

/** สถานที่ของกลุ่มนี้ — ถอดกลับจาก LINE_GROUPS ที่ตั้งไว้แล้วสำหรับแจ้งเตือน */
function intakeLocationOf_(srcId) {
  var groups = {};
  try {
    if (typeof stockLineGroups_ === 'function')      groups = stockLineGroups_() || {};
    else if (typeof lineGroups_ === 'function')      groups = lineGroups_() || {};
  } catch (e) {}

  var names = Object.keys(groups);
  for (var i = 0; i < names.length; i++) {
    if (String(groups[names[i]]).trim() === srcId) return names[i];
  }
  return intakeProp_('INTAKE_DEFAULT_LOCATION', 'ครัวกลาง');
}

/** ชื่อคนส่ง — ถามจาก LINE แล้วจำไว้ 6 ชม. จะได้ไม่ยิง API ทุกข้อความ */
function intakeProfileName_(ev) {
  var s = ev.source || {};
  var userId = String(s.userId || '');
  if (!userId) return '';

  var cache = CacheService.getScriptCache();
  var key   = 'intake_name_' + userId;
  var hit   = cache.get(key);
  if (hit) return hit;

  var token = intakeProp_('LINE_CHANNEL_ACCESS_TOKEN', '');
  if (!token) return '';

  var url = s.groupId ? 'https://api.line.me/v2/bot/group/' + s.groupId + '/member/' + userId
          : s.roomId  ? 'https://api.line.me/v2/bot/room/'  + s.roomId  + '/member/' + userId
                      : 'https://api.line.me/v2/bot/profile/' + userId;
  try {
    var res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return '';
    var name = String(JSON.parse(res.getContentText()).displayName || '');
    if (name) cache.put(key, name, 21600);
    return name;
  } catch (err) {
    return '';
  }
}

// ══════════════════════════════════════════════════════════════
//  คำสั่ง / คำนำหน้า
// ══════════════════════════════════════════════════════════════

function intakeCommandOf_(text) {
  var t = String(text).trim().toLowerCase().replace(/[?？!。.]+$/, '');
  if (/^(ลบ|ลบล่าสุด|ยกเลิก|undo)$/.test(t))                   return 'undo';
  if (/^(ยอดวันนี้|สรุป|สรุปวันนี้|วันนี้ซื้ออะไร)$/.test(t))  return 'today';
  if (/^(งบ|งบเดือนนี้|บัญชี|กำไร|กำไรเดือนนี้)$/.test(t))     return 'pl';
  if (/^(บัตร|บัตรเครดิต|รอบบัตร|ยอดบัตร)$/.test(t))           return 'card';
  if (/^(ช่วย|ช่วยด้วย|วิธีใช้|help|\?)$/.test(t))             return 'help';
  return '';
}

/**
 * ตัดคำนำหน้าออก
 * คืน null ถ้าไม่มีคำนำหน้า (ใช้ตัดสินว่าข้อความในกลุ่มนี้ตั้งใจสั่งบอทหรือเปล่า)
 */
function intakeStripPrefix_(text) {
  var t = String(text).trim();
  for (var i = 0; i < INTAKE_PREFIXES.length; i++) {
    var p = INTAKE_PREFIXES[i];
    if (t.indexOf(p) === 0) return t.slice(p.length).replace(/^[\s:：,\-]+/, '');
  }
  return null;
}

function intakeHelpText_() {
  return '📥 วิธีบันทึกผ่านไลน์\n\n' +
         '🛒 ซื้อของ — พิมพ์ชื่อของ ตามด้วยราคาและน้ำหนัก\n' +
         '   ปลาดอลลี่ 68 บาท 800 กรัม\n' +
         '   หมูสันคอ 2 กก. 350\n' +
         '   ผักกาดขาว 3 ถุง 60 บาท\n\n' +
         '🧾 ค่าใช้จ่าย — ขึ้นต้นด้วยคำว่า "ค่า"\n' +
         '   ค่าที่ 200\n' +
         '   ค่าแก๊ส 450\n' +
         '   ค่าไม้เสียบ 300\n\n' +
         '💳 รูดบัตร — เติมคำว่า "บัตร" ต่อท้าย\n' +
         '   ค่าแก๊ส 450 บัตร\n' +
         '   ปลาดอลลี่ 68 บาท 800 กรัม บัตร\n' +
         '   (โอนก็พิมพ์ "โอน" · ไม่พิมพ์อะไร = เงินสด)\n\n' +
         'หลายรายการ พิมพ์บรรทัดละอย่าง หรือคั่นด้วยจุลภาค\n' +
         'ถ่ายรูปบิลส่งมาก็ได้ บอทอ่านให้เอง\n\n' +
         'ในกลุ่มต้องขึ้นต้นด้วย "ซื้อ" ก่อน เช่น\n' +
         '   ซื้อ ค่าที่ 200\n\n' +
         'คำสั่งอื่น\n' +
         '   ลบ          ลบรายการล่าสุด\n' +
         '   ยอดวันนี้    ดูยอดซื้อวันนี้\n' +
         '   งบ          สรุปรายรับรายจ่ายเดือนนี้\n' +
         '   บัตร        ยอดบัตรเครดิตที่ต้องจ่าย';
}

// ══════════════════════════════════════════════════════════════
//  แยกข้อความเป็นรายการของ
// ══════════════════════════════════════════════════════════════

/** หน่วยที่รู้จัก เรียงยาวก่อนสั้น เพราะ regex เลือกตัวแรกที่ตรง */
var INTAKE_UNIT_RE =
  'กิโลกรัม|กิโล|กรัม|ขีด|กก\\.?|โล|ก\\.|kgs?|kg|grams?|gram|g' +
  '|บาท|฿|บ\\.|thb|baht' +
  '|ถุง|แพ็ค|แพ็ก|แพค|ชิ้น|อัน|ไม้|กล่อง|ลัง|มัด|กระปุก|ฝัก|ห่อ|แผ่น|ตัว|ใบ|ฟอง|ขวด|กระป๋อง|ที่';

function intakeUnitRe_() {
  return new RegExp('(\\d+(?:[.,]\\d+)?)\\s*(' + INTAKE_UNIT_RE + ')?', 'gi');
}

function intakeUnitKind_(unit) {
  var u = String(unit || '').trim().toLowerCase();
  if (!u) return '';
  if (/^(กิโลกรัม|กิโล|กก\.?|โล|kgs?|kg)$/.test(u))   return 'kg';
  if (/^(กรัม|ก\.|grams?|gram|g)$/.test(u))            return 'g';
  if (/^ขีด$/.test(u))                                 return 'khit';
  if (/^(บาท|฿|บ\.|thb|baht)$/.test(u))                return 'money';
  return 'count';
}

/** "1,250.5" → 1250.5 */
function intakeNum_(s) {
  var n = parseFloat(String(s).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

/**
 * ตัดคำบอกวิธีจ่ายออกจากข้อความ แล้วบอกว่าเจอวิธีไหน
 * คืน method = '' ถ้าไม่ได้บอกมา (ให้ตัวเรียกตัดสินใจเอง)
 */
function intakePayOf_(text) {
  var t = String(text || '');
  for (var i = 0; i < INTAKE_PAY_PATTERNS.length; i++) {
    var p = INTAKE_PAY_PATTERNS[i];
    var next = t.replace(p.re, ' ');
    if (next !== t) return { method: p.name, text: next };
  }
  return { method: '', text: t };
}

/** ขึ้นต้นด้วย "ค่า" = ค่าใช้จ่ายรายวัน ไม่ใช่ของที่ซื้อเข้าสต็อก */
function intakeIsExpense_(name) { return /^ค่า/.test(String(name || '').trim()); }

/** "ค่าเช่าแผง" → ประเภท "ค่าที่" · ไม่เข้าพวกไหนเลย → "อื่น ๆ" */
function intakeExpenseType_(name) {
  var n = intakeNorm_(name);
  var keys = Object.keys(INTAKE_EXPENSE_ALIAS), i;
  for (i = 0; i < keys.length; i++) {
    if (n.indexOf(intakeNorm_(keys[i])) !== -1) return INTAKE_EXPENSE_ALIAS[keys[i]];
  }
  for (i = 0; i < INTAKE_EXPENSE_TYPES.length; i++) {
    var t = INTAKE_EXPENSE_TYPES[i];
    if (t !== 'อื่น ๆ' && n.indexOf(intakeNorm_(t)) !== -1) return t;
  }
  return 'อื่น ๆ';
}

/**
 * ข้อความทั้งก้อน → รายการของ
 * แยกทีละบรรทัด/ทีละจุลภาค เพราะคนพิมพ์หลายรายการรวดเดียวบ่อย
 * ต้องเอาจุลภาคคั่นหลักพันออกก่อน ไม่งั้น "1,200 บาท" จะโดนตัดเป็นสองรายการ
 * แล้วราคาเหลือ 1 บาท
 */
function intakeParseText_(text) {
  var clean = String(text || '').replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  var parts = clean.split(/[\n\r,;]+/);
  var out = [];
  for (var i = 0; i < parts.length && out.length < INTAKE_MAX_ITEMS; i++) {
    var one = intakeParseLine_(parts[i]);
    if (one) out.push(one);
  }

  // บอกวิธีจ่ายไว้บรรทัดเดียว = หมายถึงทั้งข้อความ
  // ("ปลาดอลลี่ 68, ปูอัด 120 บัตร" คือรูดบัตรทั้งคู่ ไม่ใช่เฉพาะปูอัด)
  var told = '';
  for (i = 0; i < out.length; i++) if (out[i].pay) { told = out[i].pay; break; }
  for (i = 0; i < out.length; i++) out[i].pay = out[i].pay || told || 'เงินสด';

  return out;
}

/**
 * หนึ่งบรรทัด → หนึ่งรายการ
 * วิธีคิด: ดึง "ตัวเลข + หน่วย" ออกให้หมดก่อน ที่เหลือคือชื่อของ
 * เลขที่ไม่มีหน่วยติดมา ถือเป็นราคาก่อน (คนพิมพ์ "หมูสันคอ 350" = 350 บาท)
 */
function intakeParseLine_(line) {
  var text = String(line || '').trim();
  if (!text) return null;

  var stripped = intakeStripPrefix_(text);
  if (stripped !== null) text = stripped;
  if (!text) return null;

  // ตัดคำว่า "บัตร" / "โอน" ออกก่อน ไม่งั้นมันจะไปติดอยู่ในชื่อของ
  var pay = intakePayOf_(text);
  text = pay.text.trim();
  if (!text) return null;

  var baht = 0, gram = 0, qty = 0, unit = '', bare = [];
  var re = intakeUnitRe_(), m;

  while ((m = re.exec(text)) !== null) {
    if (m[0] === '') { re.lastIndex++; continue; }   // กันวนไม่รู้จบ
    var val = intakeNum_(m[1]);
    switch (intakeUnitKind_(m[2])) {
      case 'money': if (!baht) baht = val;        break;
      case 'kg':    if (!gram) gram = val * 1000; break;
      case 'g':     if (!gram) gram = val;        break;
      case 'khit':  if (!gram) gram = val * 100;  break;
      case 'count': if (!qty) { qty = val; unit = String(m[2]).trim(); } break;
      default:      bare.push(val);
    }
  }

  // เลขเปล่า ๆ เติมช่องที่ยังว่าง: ราคาก่อน แล้วค่อยจำนวน
  for (var i = 0; i < bare.length; i++) {
    if (!baht)     baht = bare[i];
    else if (!qty) qty  = bare[i];
  }

  var name = text.replace(intakeUnitRe_(), ' ').replace(/[\s:：\-–—=+/()]+/g, ' ').trim();
  if (!name) return null;

  // ไม่มีตัวเลขเลย = เป็นประโยคคุยกันเฉย ๆ ไม่ใช่รายการของ
  if (!baht && !gram && !qty) return null;

  return {
    raw: name, baht: baht, gram: gram, qty: qty, unit: unit,
    pay: pay.method, expense: intakeIsExpense_(name)
  };
}

// ══════════════════════════════════════════════════════════════
//  จับชื่อของให้ตรงกับชีตรายการสินค้า
// ══════════════════════════════════════════════════════════════

/** ชื่อที่คนเรียกกันเอง → ชื่อจริงในชีตรายการสินค้า */
var INTAKE_ALIAS = {
  'ดอลลี่': 'ปลาดอลลี่', 'สลีปดอลลี่': 'ปลาดอลลี่', 'สไลด์ดอลลี่': 'ปลาดอลลี่',
  'สไลซ์ดอลลี่': 'ปลาดอลลี่', 'ปลาสไลด์': 'ปลาดอลลี่',
  'สันคอ': 'สันคอสไลด์', 'หมูสันคอ': 'สันคอสไลด์', 'คอหมู': 'สันคอสไลด์',
  'สามชั้น': 'สามชั้นสไลด์', 'หมูสามชั้น': 'สามชั้นสไลด์',
  'หมึกกรอบ': 'ปลาหมึกกรอบ',
  'ปูชีส': 'ปูอัดชีส',
  'เข็มทอง': 'เห็ดเข็มทอง', 'เห็ดเข็ม': 'เห็ดเข็มทอง',
  'ออรินจิ': 'เห็ดออรินจิ', 'ชิเมจิ': 'เห็ดชิเมจิ',
  'ผักกาด': 'ผักกาดขาว',
  'มันเทศ': 'เส้นมันเทศ', 'อุด้ง': 'เส้นอุด้ง',
  'แป้งต็อก': 'ต็อก',
  'ไส้กรอกเบคอน': 'ไส้กรอกพันเบคอน'
};

/**
 * ตัดช่องว่างและวรรณยุกต์ออก ให้เทียบชื่อที่สะกดเพี้ยนกันได้
 * เช่น "ต๊อก" กับ "ต็อก" เหลือ "ตอก" เท่ากัน
 */
function intakeNorm_(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s​ ๆฯ]/g, '')   // ช่องว่าง ZWSP nbsp ๆ ฯ
    .replace(/[็-๎]/g, '')                // ็ ่ ้ ๊ ๋ ์ ํ ๎
    .trim();
}

/** ระยะแก้คำ (Levenshtein) — ใช้วัดว่าสองชื่อใกล้กันแค่ไหน */
function intakeLev_(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  var prev = [], cur = [], i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;

  for (i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (j = 1; j <= b.length; j++) {
      var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/** ชื่อสินค้าทั้งหมดในชีต — ไม่มีชีตก็ยังทำงานต่อได้ แค่จับชื่อไม่ได้ */
function intakeItemNames_() {
  try {
    if (typeof getStockItems_ !== 'function') return [];
    return getStockItems_().map(function (it) { return it.name; });
  } catch (err) {
    return [];
  }
}

/**
 * ชื่อที่พิมพ์มา → ชื่อในชีตรายการสินค้า
 * ไล่จากแม่นไปหลวม แล้วหยุดที่ชั้นแรกที่เจอ:
 *   1 ตรงเป๊ะ  2 ชื่อเล่นตรงเป๊ะ  3 ชื่อเล่นอยู่ในคำที่พิมพ์  4 ชื่อสินค้าอยู่ในคำที่พิมพ์
 *   5 คำที่พิมพ์อยู่ในชื่อสินค้า  6 สะกดใกล้เคียงเกิน 65%
 * จับไม่ได้ก็ยังบันทึก แค่ติดธงไว้ — ของที่ซื้อมาแล้วต้องไม่หายไปไหน
 */
function intakeMatchItem_(rawName, names) {
  var raw  = String(rawName || '').trim();
  var norm = intakeNorm_(raw);
  if (!norm) return { name: raw, matched: false };

  var aliasKeys = Object.keys(INTAKE_ALIAS);
  var i, n;

  for (i = 0; i < names.length; i++) {
    if (intakeNorm_(names[i]) === norm) return { name: names[i], matched: true };
  }
  for (i = 0; i < aliasKeys.length; i++) {
    if (intakeNorm_(aliasKeys[i]) === norm) return { name: INTAKE_ALIAS[aliasKeys[i]], matched: true };
  }

  // ชื่อเล่นโผล่อยู่ในคำที่พิมพ์ เช่น "สลีปดอลลี่" มีคำว่า "ดอลลี่" — ยาวสุดชนะ
  var pick = '', pickLen = 0;
  for (i = 0; i < aliasKeys.length; i++) {
    n = intakeNorm_(aliasKeys[i]);
    if (n && norm.indexOf(n) !== -1 && n.length > pickLen) {
      pick = INTAKE_ALIAS[aliasKeys[i]]; pickLen = n.length;
    }
  }
  for (i = 0; i < names.length; i++) {
    n = intakeNorm_(names[i]);
    if (n && norm.indexOf(n) !== -1 && n.length > pickLen) {
      pick = names[i]; pickLen = n.length;
    }
  }
  if (pick) return { name: pick, matched: true };

  // คำที่พิมพ์เป็นส่วนหนึ่งของชื่อสินค้า เช่น "ปู" → เอาชื่อ "สั้นสุด" ที่ครอบคลุม
  if (norm.length >= 2) {
    var shortest = '', shortLen = 0;
    for (i = 0; i < names.length; i++) {
      n = intakeNorm_(names[i]);
      if (n && n.indexOf(norm) !== -1 && (!shortLen || n.length < shortLen)) {
        shortest = names[i]; shortLen = n.length;
      }
    }
    if (shortest) return { name: shortest, matched: true };
  }

  // สะกดเพี้ยน — ยอมรับเมื่อเหมือนกันเกิน 65%
  var best = '', bestScore = 0;
  for (i = 0; i < names.length; i++) {
    n = intakeNorm_(names[i]);
    if (!n) continue;
    var score = 1 - intakeLev_(norm, n) / Math.max(norm.length, n.length);
    if (score > bestScore) { bestScore = score; best = names[i]; }
  }
  if (bestScore >= 0.65) return { name: best, matched: true };

  return { name: raw, matched: false };
}

// ══════════════════════════════════════════════════════════════
//  อ่านรูป
// ══════════════════════════════════════════════════════════════

/** โหลดไฟล์รูปที่คนส่งมาจาก LINE — ใหญ่เกินก็เอารูปย่อแทน */
function intakeFetchImage_(messageId) {
  var token = intakeProp_('LINE_CHANNEL_ACCESS_TOKEN', '');
  if (!token) throw new Error('ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN');

  var base = 'https://api-data.line.me/v2/bot/message/' + messageId + '/content';
  var opt  = { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true };

  var res = UrlFetchApp.fetch(base, opt);
  if (res.getResponseCode() !== 200) {
    throw new Error('โหลดรูปจาก LINE ไม่ได้ (' + res.getResponseCode() + ')');
  }

  var blob = res.getBlob();
  if (blob.getBytes().length > INTAKE_MAX_IMAGE_BYTES) {
    var small = UrlFetchApp.fetch(base + '/preview', opt);
    if (small.getResponseCode() === 200) blob = small.getBlob();
  }
  return blob;
}

/* ──────────────── ทางฟรี: OCR ของ Google Drive ──────────────── */

/**
 * บรรทัดในบิลที่ไม่ใช่รายการของ — ยอดรวม ภาษี เงินทอน หัวบิล ท้ายบิล
 * ถ้าไม่กรองทิ้ง "รวมทั้งสิ้น 348" จะถูกบันทึกเป็นของชื่อ "รวมทั้งสิ้น"
 */
var INTAKE_OCR_SKIP = new RegExp(
  'รวม|ทั้งสิ้น|สุทธิ|ยอด|เงินสด|เงินทอน|ทอน|ส่วนลด|ภาษี|มูลค่าเพิ่ม|จำนวนเงิน' +
  '|ใบเสร็จ|ใบกำกับ|ใบส่งของ|ใบเสนอ|เลขที่|วันที่|เวลา|โทร|สาขา|ผู้รับ|ผู้ขาย|ลูกค้า|ขอบคุณ' +
  '|total|subtotal|cash|change|discount|vat|net|tel|invoice|receipt|thank', 'i');

/**
 * อ่านรูปฟรีด้วย OCR ของ Google Drive
 * อัปโหลดรูปเข้า Drive แบบสั่งให้แปลงเป็น Google Docs — Google จะ OCR ให้ตอนแปลง
 * อ่านข้อความออกมาแล้วลบไฟล์ทิ้งทันที ไม่เสียเงิน ใช้โควต้า Drive ของบัญชีที่รันสคริปต์
 *
 * ต้องเปิดบริการ Drive API ในโปรเจกต์ก่อน (บริการ → Drive API) ไม่งั้น Drive จะ undefined
 */
function intakeOcrImage_(blob) {
  if (typeof Drive === 'undefined' || !Drive.Files) {
    throw new Error('ยังไม่ได้เปิดบริการ Drive API ในโปรเจกต์ (ดูวิธีใน LINE-INTAKE-README.md)');
  }

  var name  = 'line-intake-ocr-' + new Date().getTime();
  var docId = '';
  var text  = '';
  try {
    var resource = { mimeType: 'application/vnd.google-apps.document' };
    if (typeof Drive.Files.create === 'function') {          // Drive API v3
      resource.name = name;
      docId = Drive.Files.create(resource, blob, { ocrLanguage: 'th' }).id;
    } else {                                                  // Drive API v2
      resource.title = name;
      docId = Drive.Files.insert(resource, blob, { ocr: true, ocrLanguage: 'th' }).id;
    }
    text = DocumentApp.openById(docId).getBody().getText();
  } finally {
    // ลบไฟล์ชั่วคราวเสมอ ไม่งั้น Drive จะรกขึ้นเรื่อย ๆ ทุกรูปที่ส่งมา
    if (docId) { try { DriveApp.getFileById(docId).setTrashed(true); } catch (e) {} }
  }

  var items = intakeOcrItems_(text);
  return {
    items: items,
    note: items.length
      ? 'อ่านด้วย OCR ฟรี ตัวเลขอาจเพี้ยนได้ ตรวจสอบอีกทีนะครับ'
      : (String(text).trim() ? 'อ่านตัวหนังสือได้ แต่ไม่เจอบรรทัดที่มีทั้งชื่อของและราคา'
                             : 'OCR อ่านตัวหนังสือในรูปไม่ออกเลย')
  };
}

/** ข้อความดิบจาก OCR → รายการของ (กรองบรรทัดขยะของบิลออกก่อน) */
function intakeOcrItems_(text) {
  var lines = String(text || '').split(/[\n\r]+/);
  var keep  = [];

  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    if (!t) continue;
    if (INTAKE_OCR_SKIP.test(t)) continue;
    if (/^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}/.test(t)) continue;   // วันที่
    if (/^\d{1,2}:\d{2}/.test(t)) continue;                       // เวลา
    if (!/[ก-๙a-z]/i.test(t)) continue;                           // ไม่มีตัวหนังสือเลย
    keep.push(t);
  }

  return intakeParseText_(keep.join('\n')).filter(function (it) {
    return String(it.raw).length >= 2;   // เศษตัวอักษรเดี่ยว ๆ จาก OCR ไม่ใช่ชื่อของ
  });
}

/* ──────────────── ทางเสียเงิน: อ่านด้วย Claude ──────────────── */

/** รูปแบบคำตอบที่บังคับให้ Claude ตอบกลับมา */
var INTAKE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'ชื่อของตามที่เห็นในรูป' },
          baht: { type: 'number', description: 'ราคาที่จ่ายของรายการนี้ เป็นบาท ไม่เห็นให้ใส่ 0' },
          gram: { type: 'number', description: 'น้ำหนักเป็นกรัม แปลงจาก กก./ขีด แล้ว ไม่เห็นให้ใส่ 0' },
          qty:  { type: 'number', description: 'จำนวนที่นับได้ เช่น 3 ถุง ไม่เห็นให้ใส่ 0' },
          unit: { type: 'string', description: 'หน่วยของ qty เช่น ถุง แพ็ค ชิ้น ไม่มีให้ใส่ค่าว่าง' }
        },
        required: ['name', 'baht', 'gram', 'qty', 'unit'],
        additionalProperties: false
      }
    },
    note: { type: 'string', description: 'สิ่งที่อ่านไม่ชัดหรือไม่แน่ใจ อ่านครบชัดเจนให้ใส่ค่าว่าง' }
  },
  required: ['items', 'note'],
  additionalProperties: false
};

function intakeImagePrompt_(names) {
  var hint = names.length
    ? '\n\nชื่อของที่ร้านนี้ใช้ (เทียบให้ตรงถ้าเป็นของอย่างเดียวกัน ถ้าไม่ตรงกับอันไหนเลยให้ใช้ชื่อตามที่เห็นในรูป):\n' +
      names.slice(0, 80).join(', ')
    : '';

  return 'รูปนี้คือบิล ใบเสร็จ ป้ายราคา หรือกระดาษจดของที่ร้านหม่าล่าซื้อเข้ามา\n' +
         'อ่านแล้วดึงออกมาว่าซื้ออะไรบ้าง อย่างละเท่าไหร่\n\n' +
         'กติกา\n' +
         '• หนึ่งรายการของ = หนึ่ง item\n' +
         '• ยอดรวมท้ายบิล ส่วนลด ภาษี เงินทอน ไม่ใช่รายการของ อย่าใส่มา\n' +
         '• น้ำหนักแปลงเป็นกรัมให้หมด (1 กก. = 1000 กรัม, 1 ขีด = 100 กรัม)\n' +
         '• ช่องไหนไม่เห็นในรูป ใส่ 0 หรือค่าว่าง อย่าเดา\n' +
         '• อ่านไม่ออกทั้งรูป ให้ items เป็นลิสต์ว่าง แล้วบอกเหตุผลสั้น ๆ ใน note' + hint;
}

/**
 * ส่งรูปให้ Claude อ่าน แล้วคืนรายการของ
 * เรียก REST ตรง ๆ เพราะ Apps Script ลง SDK ของ Anthropic ไม่ได้
 */
function intakeReadImage_(blob, apiKey) {
  var type = String(blob.getContentType() || '').toLowerCase();
  if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].indexOf(type) === -1) type = 'image/jpeg';

  var payload = {
    model: intakeProp_('INTAKE_MODEL', INTAKE_MODEL_DEFAULT),
    max_tokens: 4000,
    // effort ต่ำก็พอสำหรับงานอ่านบิล และตอบไวทันก่อน LINE ตัดการเชื่อมต่อ
    output_config: { effort: 'low', format: { type: 'json_schema', schema: INTAKE_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: type, data: Utilities.base64Encode(blob.getBytes()) } },
        { type: 'text',  text: intakeImagePrompt_(intakeItemNames_()) }
      ]
    }]
  };

  var data = intakeCallClaude_(payload, apiKey);
  if (!data) {
    // รุ่นที่ไม่รับ output_config — ลองใหม่แบบขอ JSON ในข้อความแทน
    delete payload.output_config;
    payload.system = 'ตอบกลับเป็น JSON อย่างเดียว รูปแบบ ' +
                     '{"items":[{"name":"","baht":0,"gram":0,"qty":0,"unit":""}],"note":""} ' +
                     'ห้ามมีข้อความอื่นนอก JSON';
    data = intakeCallClaude_(payload, apiKey);
  }
  if (!data) throw new Error('เรียก Claude ไม่สำเร็จ (ดูรายละเอียดใน บันทึกการดำเนินการ)');
  if (data.stop_reason === 'refusal') throw new Error('Claude ไม่อ่านรูปนี้ให้');

  var text = '';
  var blocks = data.content || [];
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i].type === 'text' && blocks[i].text) text += blocks[i].text;
  }

  var parsed = intakeParseJson_(text);
  if (!parsed) throw new Error('อ่านคำตอบจาก Claude ไม่ออก');

  var out = [];
  var items = parsed.items || [];
  for (var j = 0; j < items.length && out.length < INTAKE_MAX_ITEMS; j++) {
    var it = items[j] || {};
    var name = String(it.name || '').trim();
    if (!name) continue;
    out.push({
      raw:  name,
      baht: Number(it.baht) || 0,
      gram: Number(it.gram) || 0,
      qty:  Number(it.qty)  || 0,
      unit: String(it.unit || '').trim()
    });
  }
  return { items: out, note: String(parsed.note || '').trim() };
}

/** ยิง Messages API — คืน null ถ้าคำขอไม่ผ่าน (ให้ตัวเรียกลองท่าสำรอง) */
function intakeCallClaude_(payload, apiKey) {
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code === 200) return JSON.parse(body);

  Logger.log('Claude ตอบ ' + code + ': ' + body.slice(0, 500));
  if (code === 400) return null;                     // คำขอผิดรูป — ให้ลองท่าสำรอง
  if (code === 401) throw new Error('ANTHROPIC_API_KEY ไม่ถูกต้อง');
  if (code === 429) throw new Error('เรียกถี่เกินไป รอสักครู่แล้วส่งรูปใหม่');
  throw new Error('Claude ตอบ ' + code);
}

/** ดึง JSON ออกจากข้อความ เผื่อคำตอบถูกห่อไว้ใน ``` */
function intakeParseJson_(text) {
  var t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch (e) {}

  var start = t.indexOf('{'), end = t.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch (e) { return null; }
}

// ══════════════════════════════════════════════════════════════
//  บันทึกลงชีต
// ══════════════════════════════════════════════════════════════

/** ชีตปลายทาง — สร้างให้ถ้ายังไม่มี และเติมหัวตารางถ้าชีตยังว่าง */
function intakeSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(INTAKE_SHEET) || ss.insertSheet(INTAKE_SHEET);

  if (sh.getLastRow() === 0) {
    sh.appendRow(INTAKE_HEADERS);
    sh.getRange(1, 1, 1, INTAKE_HEADERS.length)
      .setFontWeight('bold').setBackground('#fee2e2').setFontColor('#991b1b');
    sh.setFrozenRows(1);
    sh.setColumnWidth(INTAKE_HEADERS.indexOf('รายการ') + 1, 160);
    sh.setColumnWidth(INTAKE_HEADERS.indexOf('ข้อความต้นฉบับ') + 1, 240);
  }
  return sh;
}

/** ค่าในช่องวันที่ (เป็นข้อความหรือ Date ก็ได้) → 'yyyy-MM-dd' */
function intakeDateKey_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, intakeTz_(), 'yyyy-MM-dd');
  var s = String(v || '').trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);        // 31/8/2026
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return s;
}

function intakeTodayKey_() {
  return Utilities.formatDate(new Date(), intakeTz_(), 'yyyy-MM-dd');
}

/** อ่านคอลัมน์วันที่ทั้งชีตเป็น key 'yyyy-MM-dd' */
function intakeDateKeys_(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, 1).getValues().map(function (r) {
    return intakeDateKey_(r[0]);
  });
}

/**
 * ชีตค่าใช้จ่าย — ตัวเดียวกับที่หน้า POS ใช้
 * ชีตเดิมยังไม่มีคอลัมน์ "วิธีจ่าย" ก็ต่อท้ายให้ ไม่แตะคอลัมน์เดิม
 */
function intakeExpenseSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(INTAKE_EXPENSE_SHEET) || ss.insertSheet(INTAKE_EXPENSE_SHEET);

  if (sh.getLastRow() === 0) {
    sh.appendRow(INTAKE_EXPENSE_HEADERS);
    sh.getRange(1, 1, 1, INTAKE_EXPENSE_HEADERS.length)
      .setFontWeight('bold').setBackground('#fee2e2').setFontColor('#991b1b');
    sh.setFrozenRows(1);
  } else if (typeof ensureHeaders_ === 'function') {
    ensureHeaders_(sh, INTAKE_EXPENSE_HEADERS);
  }
  return sh;
}

/** เขียนหลายแถวรวดเดียวโดยไม่ให้ล้นขอบชีต — คืนเลขแถวแรกที่เขียน */
function intakeAppendRows_(sh, rows, width) {
  var firstRow = sh.getLastRow() + 1;

  // setValues เขียนเลยขอบชีตไม่ได้ (ต่างจาก appendRow ที่ต่อแถวให้เอง)
  var short = firstRow + rows.length - 1 - sh.getMaxRows();
  if (short > 0) sh.insertRowsAfter(sh.getMaxRows(), short);

  // วันที่/เวลาต้องเป็น "ข้อความ" ไม่ให้ Sheets แปลงเป็นวันที่แล้วแสดงตามภาษาเครื่อง
  // ถ้าปล่อยให้กลายเป็นวันที่ การเทียบ "วันนี้" จะพลาดเงียบ ๆ
  sh.getRange(firstRow, 1, rows.length, 2).setNumberFormat('@');
  sh.getRange(firstRow, 1, rows.length, width).setValues(rows);
  return firstRow;
}

/** มีของวันนี้อยู่ในชีตนั้นกี่แถวแล้ว — ใช้ไล่เลขที่เอกสาร */
function intakeSeqOf_(sh, date) {
  var keys = intakeDateKeys_(sh);
  var seq = 0;
  for (var i = 0; i < keys.length; i++) if (keys[i] === date) seq++;
  return seq;
}

function intakePayTag_(pay) {
  if (pay === 'บัตรเครดิต') return ' 💳';
  if (pay === 'โอน')        return ' 🏦';
  return '';
}

/**
 * บันทึกทุกรายการรวดเดียว แล้วคืนข้อความสรุปที่จะตอบกลับไลน์
 * แยกสองทางตามที่แยกไว้ตอนอ่านข้อความ:
 *   ของที่ซื้อเข้าร้าน  → ชีต "ซื้อของเข้า"
 *   ค่าใช้จ่ายรายวัน    → ชีต POS_Expenses ชีตเดียวกับที่หน้า POS ลง
 */
function intakeSaveAndSummarize_(items, ctx, source, rawText) {
  var names = intakeItemNames_();
  var buyLines = [], expLines = [];
  var buyTotal = 0, expTotal = 0, cardTotal = 0;
  var unmatched = false;
  var saved = { p: [], e: [], msgId: ctx.msgId };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var now  = new Date();
    var date = intakeTodayKey_();
    var time = Utilities.formatDate(now, intakeTz_(), 'HH:mm:ss');
    var stamp = date.replace(/-/g, '');

    var buySheet = null, expSheet = null, buySeq = 0, expSeq = 0;
    var buyRows = [], expRows = [], i, it;

    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (it.baht > 0 && it.pay === 'บัตรเครดิต') cardTotal += it.baht;

      if (it.expense) {
        if (!expSheet) { expSheet = intakeExpenseSheet_(); expSeq = intakeSeqOf_(expSheet, date); }
        expSeq++;
        var type = intakeExpenseType_(it.raw);
        expRows.push([
          date, time, 'E' + stamp + '-' + ('00' + expSeq).slice(-3),
          ctx.location, ctx.who, type,
          intakeNorm_(it.raw) === intakeNorm_(type) ? '' : it.raw,
          it.baht || 0, ctx.msgId + '-' + i, it.pay
        ]);
        expTotal += it.baht || 0;
        expLines.push('• ' + it.raw + ' — ' + intakeMoney_(it.baht) + ' บาท' + intakePayTag_(it.pay));

      } else {
        if (!buySheet) { buySheet = intakeSheet_(); buySeq = intakeSeqOf_(buySheet, date); }
        buySeq++;
        var hit   = intakeMatchItem_(it.raw, names);
        var perKg = (it.gram > 0 && it.baht > 0) ? Math.round(it.baht / it.gram * 100000) / 100 : '';
        buyRows.push([
          date, time, 'L' + stamp + '-' + ('00' + buySeq).slice(-3),
          ctx.location, ctx.who,
          hit.name, it.raw, it.baht || '', it.gram || '', perKg,
          it.qty || '', it.unit, source, rawText, ctx.msgId, it.pay
        ]);
        buyTotal += it.baht || 0;
        if (!hit.matched) unmatched = true;
        buyLines.push('• ' + hit.name + (hit.matched ? '' : ' *') + ' — ' +
                      intakeAmountText_(it) + intakePayTag_(it.pay));
      }
    }

    if (buyRows.length) {
      var r1 = intakeAppendRows_(buySheet, buyRows, INTAKE_HEADERS.length);
      for (i = 0; i < buyRows.length; i++) saved.p.push(r1 + i);
    }
    if (expRows.length) {
      var r2 = intakeAppendRows_(expSheet, expRows, INTAKE_EXPENSE_HEADERS.length);
      for (i = 0; i < expRows.length; i++) saved.e.push(r2 + i);
    }
    intakeRememberSaved_(ctx, saved);
  } finally {
    lock.releaseLock();
  }

  var blocks = [];
  if (buyLines.length) blocks.push('🛒 ซื้อของ\n' + buyLines.join('\n'));
  if (expLines.length) blocks.push('🧾 ค่าใช้จ่าย\n' + expLines.join('\n'));

  var msg = '✅ บันทึกแล้ว ' + (buyLines.length + expLines.length) + ' รายการ\n\n' + blocks.join('\n\n');

  var sums = [];
  if (buyTotal) sums.push('ซื้อของ ' + intakeMoney_(buyTotal));
  if (expTotal) sums.push('ค่าใช้จ่าย ' + intakeMoney_(expTotal));
  if (sums.length) msg += '\n\nรวม ' + sums.join(' · ') + ' บาท';
  if (cardTotal) msg += '\n💳 รูดบัตร ' + intakeMoney_(cardTotal) + ' บาท (ไปรวมในรอบบัตร)';
  if (unmatched) msg += '\n\n* ไม่มีชื่อนี้ในชีตรายการสินค้า — บันทึกตามที่ส่งมา';
  msg += '\n\nผิดตรงไหนพิมพ์ "ลบ" ได้เลย';
  return msg;
}

/** "68 บาท / 800 กรัม (85 บาท/กก.)" */
function intakeAmountText_(it) {
  var bits = [];
  if (it.baht) bits.push(intakeMoney_(it.baht) + ' บาท');
  if (it.gram) bits.push(it.gram >= 1000 ? (Math.round(it.gram / 10) / 100) + ' กก.' : it.gram + ' กรัม');
  if (it.qty)  bits.push(it.qty + ' ' + (it.unit || 'หน่วย'));

  var out = bits.join(' / ');
  if (it.baht && it.gram) out += ' (' + intakeMoney_(it.baht / it.gram * 1000) + ' บาท/กก.)';
  return out || '—';
}

function intakeMoney_(n) {
  var v = Math.round((Number(n) || 0) * 100) / 100;
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** id ของ LINE ยาวและใช้เป็นชื่อ property ตรง ๆ ไม่ได้ — ย่อเป็นเลขฐาน 16 */
function intakeKeyOf_(srcId) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(srcId || ''));
  var hex = '';
  for (var i = 0; i < 8; i++) hex += ('0' + (bytes[i] & 0xff).toString(16)).slice(-2);
  return hex;
}

/** จำแถวที่เพิ่งเขียน (ทั้งสองชีต) ไว้ให้คำสั่ง "ลบ" ใช้ */
function intakeRememberSaved_(ctx, saved) {
  if (!saved || (!saved.p.length && !saved.e.length)) return;
  try {
    intakeProps_().setProperty('INTAKE_LAST_' + intakeKeyOf_(ctx.srcId), JSON.stringify(saved));
  } catch (err) {
    Logger.log('intakeRememberSaved_: ' + err.message);
  }
}

/**
 * ลบแถวตามเลขที่จำไว้ — ลบจากล่างขึ้นบน ไม่งั้นเลขแถวที่เหลือจะเลื่อน
 * เช็ค id ทุกแถวก่อนลบ กันไปลบทับของคนอื่นที่มาเขียนคั่นระหว่างนั้น
 */
function intakeDeleteRows_(sh, rows, col, msgId, byPrefix) {
  if (!sh || !rows || !rows.length) return 0;

  var gone = 0;
  var sorted = rows.slice().sort(function (a, b) { return b - a; });
  for (var i = 0; i < sorted.length; i++) {
    var r = sorted[i];
    if (r < 2 || r > sh.getLastRow()) continue;
    var v = String(sh.getRange(r, col).getDisplayValue());
    if (byPrefix ? v.indexOf(msgId + '-') !== 0 : v !== String(msgId)) continue;
    sh.deleteRow(r);
    gone++;
  }
  return gone;
}

/** ลบรายการล่าสุดที่ต้นทางนี้เพิ่งบันทึก */
function intakeUndo_(ctx) {
  var key = 'INTAKE_LAST_' + intakeKeyOf_(ctx.srcId);
  var raw = intakeProps_().getProperty(key);
  if (!raw) return 'ไม่มีรายการล่าสุดให้ลบครับ';

  var last;
  try { last = JSON.parse(raw); } catch (e) { return 'ไม่มีรายการล่าสุดให้ลบครับ'; }
  if (!last) return 'ไม่มีรายการล่าสุดให้ลบครับ';

  var buys = last.p || last.rows || [];   // last.rows = รูปแบบเก่าก่อนมีชีตค่าใช้จ่าย
  var exps = last.e || [];
  if (!buys.length && !exps.length) return 'ไม่มีรายการล่าสุดให้ลบครับ';

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var gone = 0;
    gone += intakeDeleteRows_(intakeSheet_(), buys,
              INTAKE_HEADERS.indexOf('messageId') + 1, last.msgId, false);
    gone += intakeDeleteRows_(intakeExpenseSheet_(), exps,
              INTAKE_EXPENSE_HEADERS.indexOf('order_id') + 1, last.msgId, true);

    intakeProps_().deleteProperty(key);
    return gone ? '🗑️ ลบออกให้แล้ว ' + gone + ' รายการ' : 'หาแถวที่จะลบไม่เจอ (อาจถูกลบไปแล้ว)';
  } finally {
    lock.releaseLock();
  }
}

/** ยอดซื้อรวมของวันนี้ */
function intakeTodayTotal_() {
  var sh = intakeSheet_();
  var keys = intakeDateKeys_(sh);
  if (!keys.length) return 0;

  var today = intakeTodayKey_();
  var col   = INTAKE_HEADERS.indexOf('จำนวนเงิน') + 1;
  var money = sh.getRange(2, col, keys.length, 1).getValues();

  var sum = 0;
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] === today) sum += Number(money[i][0]) || 0;
  }
  return sum;
}

/** รายการที่ซื้อวันนี้ทั้งหมด */
function intakeTodaySummary_() {
  var sh = intakeSheet_();
  var keys = intakeDateKeys_(sh);
  if (!keys.length) return 'วันนี้ยังไม่มีรายการซื้อครับ';

  var today  = intakeTodayKey_();
  var v      = sh.getRange(2, 1, keys.length, INTAKE_HEADERS.length).getValues();
  var iItem  = INTAKE_HEADERS.indexOf('รายการ');
  var iMoney = INTAKE_HEADERS.indexOf('จำนวนเงิน');
  var iGram  = INTAKE_HEADERS.indexOf('น้ำหนัก(กรัม)');

  var lines = [], sum = 0;
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] !== today) continue;
    var baht = Number(v[i][iMoney]) || 0;
    var gram = Number(v[i][iGram]) || 0;
    sum += baht;
    lines.push('• ' + v[i][iItem] + ' — ' + intakeAmountText_({ baht: baht, gram: gram, qty: 0, unit: '' }));
  }
  if (!lines.length) return 'วันนี้ยังไม่มีรายการซื้อครับ';
  if (lines.length > 20) lines = ['… (แสดง 20 รายการล่าสุด)'].concat(lines.slice(-20));

  return '📊 ยอดซื้อวันนี้ (' + Utilities.formatDate(new Date(), intakeTz_(), 'd/M/yyyy') + ')\n\n' +
         lines.join('\n') + '\n\nรวม ' + intakeMoney_(sum) + ' บาท';
}

/** สรุปเดือนนี้ / รอบบัตรเครดิต — ต้องมี accounting.gs อยู่ในโปรเจกต์ด้วย */
function intakeAccounting_(what) {
  var missing = 'ยังไม่ได้ติดตั้งส่วนบัญชีครับ\n' +
                'เอาไฟล์ accounting.gs เข้าโปรเจกต์นี้ก่อน (ดู ACCOUNTING-README.md)';
  try {
    if (what === 'card') {
      if (typeof accCardSummary_ !== 'function') return missing;
      return accCardSummary_();
    }
    if (typeof accMonthSummary_ !== 'function') return missing;
    return accMonthSummary_(Utilities.formatDate(new Date(), intakeTz_(), 'yyyy-MM'));
  } catch (err) {
    return 'คิดยอดไม่สำเร็จครับ: ' + (err && err.message ? err.message : err);
  }
}

// ══════════════════════════════════════════════════════════════
//  ตอบกลับไลน์
// ══════════════════════════════════════════════════════════════

/**
 * ตอบด้วย reply token ก่อน (ไม่กินโควต้าข้อความฟรี)
 * token หมดอายุแล้วค่อย push ตามไป จะได้ไม่เงียบหายไปเฉย ๆ
 */
function intakeReply_(ctx, text) {
  var token = intakeProp_('LINE_CHANNEL_ACCESS_TOKEN', '');
  if (!token || !text) return;

  var msg = { type: 'text', text: String(text).slice(0, 4900) };

  if (ctx.token) {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ replyToken: ctx.token, messages: [msg] }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) return;
    Logger.log('reply ไม่สำเร็จ (' + res.getResponseCode() + '): ' + res.getContentText());
  }

  if (!ctx.srcId) return;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: ctx.srcId, messages: [msg] }),
    muteHttpExceptions: true
  });
}

// ══════════════════════════════════════════════════════════════
//  เครื่องมือติดตั้ง / ทดสอบ (รันจากเมนู Run ใน Apps Script)
// ══════════════════════════════════════════════════════════════

/** รันครั้งเดียว — สร้างชีตปลายทางและบอก URL ที่ต้องเอาไปใส่ใน LINE */
function setupLineIntake() {
  var sh = intakeSheet_();
  Logger.log('สร้าง/พบชีต "' + INTAKE_SHEET + '" แล้ว (' + sh.getLastRow() + ' แถว)');

  var url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) {}
  Logger.log('\nWebhook URL ที่ต้องเอาไปใส่ใน LINE Developers Console:\n  ' +
             (url || '(ยังไม่ได้ Deploy — กด Deploy → New deployment → Web app ก่อน)'));

  Logger.log(intakeProp_('LINE_CHANNEL_ACCESS_TOKEN', '')
    ? '\nLINE_CHANNEL_ACCESS_TOKEN ✅'
    : '\n⚠️ ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN — บอทจะตอบกลับไม่ได้');

  var mode = intakeImageMode_();
  Logger.log('\nการอ่านรูป: โหมด "' + mode + '"');
  if (mode === 'ocr') {
    Logger.log(typeof Drive !== 'undefined' && Drive.Files
      ? '  ใช้ OCR ของ Google Drive — ฟรี ✅'
      : '  ⚠️ ยังเปิดบริการ Drive API ไม่ครบ — ไปที่ "บริการ (Services)" ทางซ้าย\n' +
        '     กด + แล้วเลือก Drive API → เพิ่ม แล้วรันฟังก์ชันนี้ใหม่');
  } else if (mode === 'claude') {
    Logger.log('  ใช้ Claude รุ่น ' + intakeProp_('INTAKE_MODEL', INTAKE_MODEL_DEFAULT) +
               ' — คิดเงินตามจริง ราว ๆ 1 บาท/รูป');
  } else {
    Logger.log('  ปิดการอ่านรูปไว้ (INTAKE_IMAGE_MODE = off)');
  }
}

/** ลอง OCR ฟรีกับรูปในไดรฟ์ 1 ไฟล์ — ใส่ File ID ของรูปบิลที่อัปโหลดไว้ */
function testIntakeOcr(fileId) {
  if (!fileId) { Logger.log('ใส่ File ID ของรูปด้วย เช่น testIntakeOcr(\'1AbC...\')'); return; }
  var read = intakeOcrImage_(DriveApp.getFileById(fileId).getBlob());
  Logger.log('อ่านได้ ' + read.items.length + ' รายการ  (' + read.note + ')');
  var names = intakeItemNames_();
  read.items.forEach(function (it) {
    var hit = intakeMatchItem_(it.raw, names);
    Logger.log('  • ' + hit.name + (hit.matched ? '' : ' (ไม่ตรงชีต)') + '  |  ' + intakeAmountText_(it));
  });
}

/** ลองแยกข้อความโดยไม่ต้องส่งไลน์จริง — ดูผลใน บันทึกการดำเนินการ */
function testIntakeParse() {
  var samples = [
    'สลีปดอลลี่ 68 บาท 800 กรัม',
    'ปลาดอลลี่ 800 กรัม 68 บาท',
    'หมูสันคอ 2 กก. 350',
    'ผักกาดขาว 3 ถุง 60 บาท',
    'ซื้อ ต๊อก 1 แพ็ค 45',
    'ปูอัด 250',
    'เห็ดเข็ม 5 ขีด 40 บาท',
    'ปลาดอลลี่ 68 บาท 800 กรัม, ปูอัด 120 บาท',
    'พรุ่งนี้ไปตลาดกี่โมง'
  ];
  var names = intakeItemNames_();
  Logger.log('ชื่อสินค้าในชีต: ' + (names.length ? names.length + ' รายการ' : 'ยังไม่มี (จับชื่อไม่ได้)'));

  samples.forEach(function (s) {
    var items = intakeParseText_(s);
    if (!items.length) { Logger.log('"' + s + '"  →  (ไม่ใช่รายการของ)'); return; }
    items.forEach(function (it) {
      var hit = intakeMatchItem_(it.raw, names);
      Logger.log('"' + s + '"  →  ' + hit.name + (hit.matched ? '' : ' (ไม่ตรงชีต)') +
                 '  |  ' + intakeAmountText_(it));
    });
  });
}

/** ดูว่ามีใคร/กลุ่มไหนส่งข้อความเข้ามาบ้าง เอาไปใส่ INTAKE_ALLOW */
function showIntakeSenders() {
  var seen = {};
  try { seen = JSON.parse(intakeProps_().getProperty('INTAKE_SENDERS') || '{}'); } catch (e) {}
  var ids = Object.keys(seen);
  if (!ids.length) {
    Logger.log('ยังไม่มีใครส่งข้อความเข้ามาเลย — ลองทักบอทในไลน์ก่อน แล้วรันฟังก์ชันนี้ใหม่');
    return;
  }
  Logger.log('ต้นทางที่เคยส่งเข้ามา ' + ids.length + ' แห่ง:');
  ids.forEach(function (id) { Logger.log('  ' + id + '   (ล่าสุด ' + seen[id] + ')'); });
  Logger.log('\nล็อกให้รับเฉพาะที่ต้องการ:  allowIntakeSenders(\'' + ids.join("', '") + '\')');
}

/** ตั้ง INTAKE_ALLOW — หลังตั้งแล้วบอทจะรับเฉพาะ id เหล่านี้ */
function allowIntakeSenders() {
  var ids = Array.prototype.slice.call(arguments)
    .map(function (s) { return String(s).trim(); })
    .filter(function (s) { return !!s; });
  if (!ids.length) { Logger.log('ใส่ id ด้วย เช่น allowIntakeSenders(\'Cxxxx\', \'Uxxxx\')'); return; }
  intakeProps_().setProperty('INTAKE_ALLOW', ids.join(','));
  Logger.log('ตั้งแล้ว INTAKE_ALLOW = ' + ids.join(','));
}

/** ยกเลิกการล็อกต้นทาง กลับไปรับจากทุกที่ */
function clearIntakeAllow() {
  intakeProps_().deleteProperty('INTAKE_ALLOW');
  Logger.log('ล้าง INTAKE_ALLOW แล้ว — ตอนนี้รับข้อความจากทุกต้นทาง');
}
