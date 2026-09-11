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
  'จำนวน', 'หน่วย', 'ที่มา', 'ข้อความต้นฉบับ', 'messageId', 'วิธีจ่าย',
  // ต่อท้ายเสมอ ห้ามแทรกกลาง ไม่งั้นคอลัมน์ของแถวเก่าจะเลื่อนความหมาย
  'ประเภทซื้อ'   // วัตถุดิบ = เข้าสต็อก เป็นต้นทุนขาย · พัฒนาสูตร = ไม่เข้าทั้งคู่
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
 * วิธีจ่าย — ที่เขียนในไลน์มีแค่ 2 อย่าง ไม่เขียนว่าบัตร = โอน
 *
 * เงินสดไม่มีทางนี้เลย เงินสดคือเงินหน้าร้านที่พนักงานสาขาหยิบจากลิ้นชักไปจ่าย
 * ซึ่งลงในหน้า POS อยู่แล้ว ถ้ารับ "เงินสด" ทางไลน์ด้วย ยอดจะถูกหักสองรอบ
 * แต่ยังต้องจับคำไว้ เพื่อตัดออกจากชื่อรายการ ไม่ให้กลายเป็น "ปลาดอลลี่ เงินสด"
 * แล้วเตือนคนพิมพ์ว่าให้ไปลงหน้า POS แทน
 *
 * เรียงตามลำดับที่ตรวจ เจอตัวไหนก่อนใช้ตัวนั้น
 * ไม่ใส่คำว่า "สด" เดี่ยว ๆ เพราะไปชนกับ "ค่าของสด"
 */
var INTAKE_PAY_PATTERNS = [
  { re: /บัตรเครดิต|เครดิต|บัตร|credit\s*card|credit/gi, name: 'บัตรเครดิต' },
  { re: /โอนจ่าย|จ่ายโอน|โอน|พร้อมเพย์|promptpay|transfer/gi, name: 'โอน' },
  { re: /เงินสด|cash/gi, name: 'เงินสด', reject: true }
];

/** ไม่ได้เขียนว่าบัตร = โอน — ทั้งซื้อของและค่าใช้จ่าย */
var INTAKE_DEFAULT_PAY = 'โอน';

/**
 * ของที่ซื้อมาลองสูตร ไม่ใช่วัตถุดิบขาย
 *
 * ต้องแยกออกจากวัตถุดิบ 2 เหตุผล
 *   1) ไม่เข้าสต็อกครัวกลาง เพราะไม่ได้เอาไปขาย ถ้าเข้า ยอดคงเหลือจะเกินจริง
 *      แล้วตอนเช็คสต็อกจะกลายเป็น "ของหาย" ทั้งที่เอาไปลองสูตรหมดแล้ว
 *   2) ไม่ใช่ต้นทุนขาย ถ้าเอาไปรวม กำไรขั้นต้นจะดูแย่กว่าความจริง
 *      เดือนไหนลองสูตรเยอะจะเห็นเป็นขาดทุนทั้งที่ขายได้ปกติ
 */
var INTAKE_RND_RE = /ลองสูตร|พัฒนาสูตร|สูตรใหม่|ทดสอบสูตร|คิดสูตร|ทดลอง|r\s*&\s*d|rnd/gi;

var INTAKE_KIND_STOCK = 'วัตถุดิบ';
var INTAKE_KIND_RND   = 'พัฒนาสูตร';

/**
 * คำนำหน้า — ใส่แล้วบอทจะรับแน่นอน ไม่ว่าจะพิมพ์อะไรตามมา
 * ปกติในกลุ่มไม่ต้องใส่ก็ได้ (ดู INTAKE_GROUP_MODE) แต่ถ้าบอทไม่ยอมรับบรรทัดไหน
 * ให้เติมคำนำหน้าเข้าไปแล้วมันจะรับทันที
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
  // จดไว้ก่อนทำอะไรทั้งสิ้นว่า "LINE ยิงมาถึงโค้ดนี้แล้ว"
  // เป็นหลักฐานชิ้นเดียวที่แยก "ปัญหาฝั่ง LINE" ออกจาก "ปัญหาในโค้ด" ได้เด็ดขาด
  // ไม่มีตัวนี้ เวลาบอทเงียบจะเดาไม่ออกว่า webhook มาไม่ถึง หรือมาถึงแล้วโดนกรองทิ้ง
  try {
    intakeProps_().setProperty('INTAKE_LAST_HIT',
      Utilities.formatDate(new Date(), intakeTz_(), 'd/M/yyyy HH:mm:ss'));
  } catch (e) {}

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
  intakeRememberSender_(srcId);   // จดทุกต้นทางเสมอ แม้ตัวที่ไม่รับ ไว้ให้ showIntakeSenders ดู
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
    case 'loss':  intakeReply_(ctx, intakeAccounting_('loss'));  return;
    case 'raw':   intakeReply_(ctx, intakeLastRaw_());           return;
  }

  var stripped = intakeStripPrefix_(raw);
  var called   = stripped !== null;   // พิมพ์คำนำหน้ามา = ตั้งใจสั่งบอทแน่ ๆ
  var mode     = String(intakeProp_('INTAKE_GROUP_MODE', 'smart')).toLowerCase();

  // โหมด prefix — ในกลุ่มต้องมีคำนำหน้าเสมอ ไม่มีก็ไม่สนใจ
  if (ctx.isGroup && !called && mode === 'prefix') {
    Logger.log('ข้ามข้อความในกลุ่ม (โหมด prefix ต้องขึ้นต้นด้วย ' +
               INTAKE_PREFIXES.join('/') + '): ' + raw.slice(0, 40));
    return;
  }

  var items = intakeParseText_(called ? stripped : raw);

  // อยู่ในกลุ่มและไม่ได้เรียกบอทตรง ๆ — คนอาจแค่คุยกันอยู่
  // จึงเอาเฉพาะบรรทัดที่มั่นใจ และถ้าไม่เข้าเกณฑ์ก็เงียบไว้ ไม่ต้องบ่นให้รกกลุ่ม
  var quiet = ctx.isGroup && !called;
  if (quiet && mode !== 'all') {
    var names = intakeItemNames_();
    items = items.filter(function (it) { return intakeConfident_(it, names); });
  }

  if (!items.length) {
    if (quiet) { Logger.log('ข้ามข้อความในกลุ่ม (ไม่ใช่รายการของ): ' + raw.slice(0, 40)); return; }
    intakeReply_(ctx, 'อ่านไม่ออกว่าซื้ออะไรครับ 🤔\n\nพิมพ์แบบนี้ได้เลย\n' +
                      '  ปลาดอลลี่ 68 บาท 800 กรัม\n  ค่าที่ 200\n\nหรือพิมพ์ "ช่วย" ดูวิธีใช้');
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
    var msg = (err && err.message ? err.message : String(err));
    // ข้อความสิทธิ์ Drive มาเป็นภาษาของบัญชี (บางทีเป็นญี่ปุ่น) อ่านไม่ออกว่าต้องทำอะไร
    // จับจากชื่อ API แทนตัวข้อความ แล้วบอกวิธีแก้เป็นภาษาไทยให้เลย
    var noPerm = /drive\.files\.(create|insert)|PERMISSION_DENIED|authorization/i.test(msg);
    intakeReply_(ctx, '📷 อ่านรูปไม่สำเร็จครับ' +
      (noPerm
        ? '\n\nสคริปต์ยังไม่ได้รับสิทธิ์ใช้ Google Drive\n' +
          'เปิด Apps Script แล้วทำ 2 ขั้นนี้\n' +
          '1. รันฟังก์ชัน authorizeDriveOcr → กดอนุญาต\n' +
          '2. Deploy ใหม่ (เวอร์ชัน: ใหม่) ← ข้ามข้อนี้ไม่ได้'
        : ': ' + msg) +
      '\n\nระหว่างนี้พิมพ์เป็นข้อความมาแทนได้เลย');
    return;
  }

  // เก็บข้อความดิบไว้ให้พิมพ์ "ดิบ" ดูย้อนหลังได้ — เวลาลงผิดจะได้แยกออกว่า
  // OCR อ่านตัวหนังสือมั่ว หรืออ่านถูกแต่ตัวแยกข้อความจับผิด คนละปัญหา คนละวิธีแก้
  try {
    intakeProps_().setProperty('INTAKE_LAST_RAW', String(read.raw || '').slice(0, 4000));
  } catch (e) {}

  if (!read.items.length) {
    // โชว์ข้อความดิบที่ OCR อ่านได้ด้วย ไม่งั้นแยกไม่ออกว่า OCR อ่านมั่ว
    // หรือ OCR อ่านถูกแต่ตัวแยกข้อความทิ้งของดี — คนละปัญหา คนละวิธีแก้
    var peek = String(read.raw || '').replace(/\s*\n\s*/g, ' / ').trim();
    intakeReply_(ctx, '📷 เปิดรูปได้ แต่ไม่เจอรายการของที่ซื้อครับ' +
      (read.note ? '\n(' + read.note + ')' : '') +
      (peek ? '\n\nOCR อ่านได้ว่า:\n' + peek.slice(0, 400) +
              (peek.length > 400 ? '…' : '') : '') +
      '\n\nถ้าข้อความข้างบนมั่ว = OCR ฟรีไปไม่ถึง' +
      '\nตั้ง ANTHROPIC_API_KEY ให้ Claude อ่านแทนจะแม่นกว่ามาก (~1 บาท/รูป)' +
      '\n\nระหว่างนี้พิมพ์เป็นข้อความมาได้เลย');
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
  if (!allow) return true;
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
  if (/^(ของหาย|ของขาด|เช็คของหาย|ตรวจของหาย)$/.test(t))       return 'loss';
  if (/^(ดิบ|ข้อความดิบ|อ่านได้ว่า|raw|ocr)$/.test(t))          return 'raw';
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
         '   (ไม่พิมพ์อะไร = โอน · ทางไลน์มีแค่ 2 อย่างนี้)\n' +
         '   จ่ายเงินสดหน้าร้าน ลงในหน้า POS ไม่ใช่ทางนี้\n\n' +
         '📦 ของเข้าครัวกลาง — บอกจำนวนไม้ต่อท้าย\n' +
         '   ไส้กรอกหนังกรอบ 1 แพ็ค 90 บาท ได้ 26 ไม้\n' +
         '   (ยอดสต็อกขยับให้ + แจ้งวันหมดอายุให้เอง)\n\n' +
         'หลายรายการ พิมพ์บรรทัดละอย่าง หรือคั่นด้วยจุลภาค\n' +
         'ถ่ายรูปบิลส่งมาก็ได้ บอทอ่านให้เอง\n\n' +
         'พิมพ์ในกลุ่มนี้ได้เลย ไม่ต้องมีคำนำหน้า\n' +
         'บอทจะเก็บเฉพาะบรรทัดที่เป็นรายการของจริง ๆ\n' +
         'คุยกันปกติไม่โดนเก็บ ถ้าบรรทัดไหนบอทไม่รับ\n' +
         'ให้เติมคำว่า "ซื้อ" ข้างหน้า เช่น  ซื้อ ปลากะพง 500\n\n' +
         'คำสั่งอื่น\n' +
         '   ลบ          ลบรายการล่าสุด\n' +
         '   ยอดวันนี้    ดูยอดซื้อวันนี้\n' +
         '   งบ          สรุปรายรับรายจ่ายเดือนนี้\n' +
         '   บัตร        ยอดบัตรเครดิตที่ต้องจ่าย\n' +
         '   ดิบ         ข้อความที่ OCR อ่านได้จากรูปล่าสุด';
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
 * cash = true คือเขียน "เงินสด" มา ซึ่งทางไลน์ไม่รับ — ตัดคำออกแล้วให้เป็นโอน
 */
function intakePayOf_(text) {
  var t = String(text || '');
  for (var i = 0; i < INTAKE_PAY_PATTERNS.length; i++) {
    var p = INTAKE_PAY_PATTERNS[i];
    var next = t.replace(p.re, ' ');
    if (next === t) continue;
    return p.reject ? { method: '', text: next, cash: true }
                    : { method: p.name, text: next };
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

  // ไม่ได้บอกมา = โอน ทั้งซื้อของและค่าใช้จ่าย
  // ที่จ่ายด้วยเงินสดหน้าร้าน พนักงานลงในหน้า POS อยู่แล้ว
  // ที่มาลงทางไลน์คือพวกที่โอนหรือรูดบัตร ไม่ได้หยิบเงินจากลิ้นชัก
  // อยากได้บัตรก็พิมพ์ "บัตร" กำกับ
  var pay = intakeProp_('INTAKE_DEFAULT_PAY', INTAKE_DEFAULT_PAY);
  for (i = 0; i < out.length; i++) {
    out[i].pay = out[i].pay || told || pay;
  }

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

  // เช่นเดียวกับ "ทดลอง" / "ลองสูตร" — ตัดออกไม่งั้นชื่อจะเป็น "ทดลอง ปลาดอลลี่"
  var rnd = INTAKE_RND_RE.test(text);
  INTAKE_RND_RE.lastIndex = 0;               // regex มี /g ต้องรีเซ็ตเอง ไม่งั้นครั้งถัดไปเพี้ยน
  if (rnd) {
    text = text.replace(INTAKE_RND_RE, ' ').trim();
    INTAKE_RND_RE.lastIndex = 0;
    if (!text) return null;
  }

  var bag = intakeBag_();
  var re = intakeUnitRe_(), m;

  while ((m = re.exec(text)) !== null) {
    if (m[0] === '') { re.lastIndex++; continue; }   // กันวนไม่รู้จบ
    intakeApplyUnit_(bag, intakeNum_(m[1]), m[2]);
  }

  // เลขเปล่า ๆ เติมช่องที่ยังว่าง: ราคาก่อน แล้วค่อยจำนวน
  for (var i = 0; i < bag.bare.length; i++) {
    if (!bag.baht)     bag.baht = bag.bare[i];
    else if (!bag.qty) bag.qty  = bag.bare[i];
  }

  // คำเชื่อมที่คนพิมพ์คั่นระหว่างจำนวน ("1 แพ็ค ได้ 26 ไม้") ไม่ใช่ส่วนหนึ่งของชื่อของ
  var name = text.replace(intakeUnitRe_(), ' ')
                 .replace(/แบ่งได้|ตัดได้|ทำได้|รวมเป็น|ทั้งหมด|ได้|รวม|เป็น/g, ' ')
                 .replace(/[\s:：\-–—=+/()]+/g, ' ').trim();
  if (!name) return null;

  // ไม่มีตัวเลขเลย = เป็นประโยคคุยกันเฉย ๆ ไม่ใช่รายการของ
  if (!bag.baht && !bag.gram && !bag.qty) return null;

  return {
    raw: name, baht: bag.baht, gram: bag.gram, qty: bag.qty, unit: bag.unit,
    counts: bag.counts,
    pay: pay.method, expense: intakeIsExpense_(name),
    cash: !!pay.cash,                                 // เขียน "เงินสด" มา ซึ่งทางไลน์ไม่รับ
    rnd: rnd,                                         // ซื้อมาลองสูตร ไม่เข้าสต็อก ไม่ใช่ต้นทุนขาย
    saidMoney: bag.saidMoney, saidUnit: bag.saidUnit
  };
}

/** ถุงเปล่าไว้ใส่ตัวเลขที่จับได้จากบรรทัดหนึ่ง */
function intakeBag_() {
  return { baht: 0, gram: 0, qty: 0, unit: '', counts: [], bare: [],
           saidMoney: false, saidUnit: false };
}

/**
 * ใส่ "ตัวเลข + หน่วย" ที่จับได้ลงในถุง — ใช้ร่วมกันทั้งทางพิมพ์และทางอ่านบิล
 * แยกออกมาเพื่อให้สองทางแปลหน่วยเหมือนกันเป๊ะ ต่างกันแค่ตัวจับหน่วย
 */
function intakeApplyUnit_(bag, val, unit) {
  switch (intakeUnitKind_(unit)) {
    case 'money': if (!bag.baht) bag.baht = val;        bag.saidMoney = true; return;
    case 'kg':    if (!bag.gram) bag.gram = val * 1000; bag.saidUnit  = true; return;
    case 'g':     if (!bag.gram) bag.gram = val;        bag.saidUnit  = true; return;
    case 'khit':  if (!bag.gram) bag.gram = val * 100;  bag.saidUnit  = true; return;
    case 'count':
      // เก็บไว้ทุกตัว ไม่ใช่แค่ตัวแรก — "1 แพ็ค ได้ 26 ไม้" มีสองหน่วยในบรรทัดเดียว
      // แพ็คคือที่ซื้อมา ไม้คือที่เสียบได้จริง ซึ่งเป็นตัวที่ชีตสต็อกต้องการ
      bag.counts.push({ n: val, unit: String(unit).trim() });
      if (!bag.qty) { bag.qty = val; bag.unit = String(unit).trim(); }
      bag.saidUnit = true;
      return;
    default: bag.bare.push(val);
  }
}

/**
 * คำที่โผล่ในบทสนทนา แต่ไม่มีทางเป็นชื่อของ
 * ใช้กรองตอนอยู่ในกลุ่ม เพื่อไม่ให้ "แพงจัง 200 บาทเลยเหรอ" กลายเป็นรายการของ
 */
var INTAKE_CHAT_WORDS = /ไหม|มั้ย|เหรอ|หรอ|หรือ|ทำไม|เท่าไหร่|เท่าไร|กี่โมง|ครับ|ค่ะ|คะ|จ้า|น้า|นะ|จัง|เลยเหรอ|ขอบคุณ|สวัสดี|โอเค|ok/i;

/**
 * บรรทัดนี้ "มั่นใจพอ" ว่าเป็นรายการของจริงไหม — ใช้เฉพาะตอนอยู่ในกลุ่ม
 * ในกลุ่มมีคนคุยกันปนอยู่ ถ้ารับหมดทุกอย่างที่มีตัวเลข ชีตจะเต็มไปด้วยขยะ
 * รับเมื่อเข้าข้อใดข้อหนึ่ง:
 *   • ขึ้นต้นด้วย "ค่า"                      → ค่าใช้จ่าย ชัดเจน
 *   • ชื่อตรงกับชีตรายการสินค้า              → ของที่ร้านซื้อประจำ
 *   • บอกหน่วยเงินมาชัด ๆ เช่น 500 บาท / ฿  → ตั้งใจบอกราคา
 */
function intakeConfident_(it, names) {
  if (INTAKE_CHAT_WORDS.test(it.raw)) return false;
  if (it.expense) return true;
  // พิมพ์ "ทดลอง" มาเอง = ตั้งใจสั่งบอทแน่ ๆ และของลองสูตรมักเป็นของใหม่
  // ที่ยังไม่มีในชีตรายการสินค้า ถ้าไม่รับตรงนี้จะโดนกรองทิ้งเกือบทุกครั้ง
  if (it.rnd) return true;
  if (intakeMatchItem_(it.raw, names).matched) return true;
  if (it.saidMoney) return true;
  return false;
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

/** รายการสินค้าเต็ม ๆ จากชีต — ชื่อ หน่วยย่อย หน่วยแพ็ค จำนวนต่อแพ็ค */
function intakeStockItems_() {
  try {
    if (typeof getStockItems_ !== 'function') return [];
    return getStockItems_() || [];
  } catch (err) {
    return [];
  }
}

/** ชื่อสินค้าทั้งหมดในชีต — ไม่มีชีตก็ยังทำงานต่อได้ แค่จับชื่อไม่ได้ */
function intakeItemNames_() {
  return intakeStockItems_().map(function (it) { return it.name; });
}

/**
 * แปลงจำนวนที่พิมพ์มาให้เป็น "หน่วยย่อย" ที่ชีตสต็อกใช้ (เช่น ไม้)
 *
 * คืน null ถ้าเดาไม่ได้ — ยอมไม่ลงดีกว่าลงตัวเลขมั่ว เพราะชีตนี้เอาไปคิด
 * ยอดคงเหลือ ลงผิดทีเดียวยอดเพี้ยนยาวจนกว่าจะนับสต็อกใหม่
 */
function intakeStockQty_(item, counts) {
  if (!item || !counts || !counts.length) return null;

  var sub = intakeNorm_(item.subUnit), pack = intakeNorm_(item.packUnit);
  var base = 0, packs = 0, i, u;

  for (i = 0; i < counts.length; i++) {
    u = intakeNorm_(counts[i].unit);
    if (u === sub  && !base)  base  = counts[i].n;
    if (u === pack && !packs) packs = counts[i].n;
  }

  // บอกจำนวนหน่วยย่อยมาตรง ๆ ("ได้ 26 ไม้") — แม่นที่สุด ใช้เลย
  if (base > 0) {
    return { base: base, packs: packs,
             per: packs > 0 ? Math.round(base / packs * 100) / 100 : item.perPack };
  }
  // บอกมาแค่แพ็ค — คูณจากชีตได้ ถ้าชีตตั้งจำนวนต่อแพ็คไว้จริง (ไม่ใช่ 1)
  if (packs > 0 && item.perPack > 1) {
    return { base: Math.round(packs * item.perPack * 1000) / 1000, packs: packs, per: item.perPack };
  }
  return null;
}

/**
 * ลงชีต "จำนวนของเข้า" — คืนเลขแถวที่เขียน หรือ 0 ถ้าลงไม่ได้
 * พอมีแถวใหม่ บอทของเข้าใน line-expiry-alert.gs จะเห็นภายใน 5 นาที
 * แล้วแจ้งกลุ่มเองว่าของเข้าอะไร วันไหน และต้องทิ้งวันไหน
 */
function intakeAddStockIn_(item, qty, ctx) {
  if (typeof ensureCols_ !== 'function' || typeof appendByCols_ !== 'function') return 0;

  var sheetName = (typeof SHEET_INCOMING === 'string') ? SHEET_INCOMING : 'จำนวนของเข้า';
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sh) return 0;   // ยังไม่ได้ตั้งระบบสต็อก — ไม่สร้างชีตให้เอง เดี๋ยวคอลัมน์ไม่ตรง

  var cols = (typeof MOVE_COLS !== 'undefined' ? MOVE_COLS : []).concat(['messageId']);
  var map  = ensureCols_(sh, cols);

  appendByCols_(sh, map, {
    'วันที่เวลา': new Date(),
    'สาขา':      ctx.location,
    'ผู้ตรวจ':    ctx.who || 'ไลน์',
    'รายการ':     item.name,
    'จำนวน':      qty.base,
    'หน่วย':      item.subUnit,
    'แพ็ค':       qty.packs || 0,
    'เศษ':        0,
    'ไม้ต่อแพ็ค':  qty.per,
    // ต้องเป็น "ของเข้าครัวกลาง" เสมอ ห้ามใช้ "ของเข้าร้าน"
    // เพราะของเข้าร้านแปลว่าย้ายมาจากครัวกลาง ระบบจะหักยอดครัวกลางออกให้ด้วย
    // ของที่เพิ่งซื้อเข้ามาไม่ได้มาจากครัวกลาง ถ้าใส่ผิดยอดครัวกลางจะติดลบ
    'ประเภท':     'ของเข้าครัวกลาง',
    'หมายเหตุ':   'บันทึกจากไลน์',
    'messageId':  ctx.msgId
  });
  return sh.getLastRow();
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
  '|สงวนสิทธิ|เปลี่ยน\\s*/?\\s*คืน|สมาชิก|แต้ม|พนักงาน|แคชเชียร์' +
  '|total|subtotal|cash|change|discount|vat|vatable|net|tel|invoice|receipt|thank' +
  '|tax\\s*id|pos\\s*id|user\\s*#|rcpt|qr\\s*payment|payment|member|point|store|branch', 'i');

/**
 * หัวบิล/ท้ายบิลที่เป็นชื่อร้านหรือรหัสล้วน ๆ — ไม่มีตัวหนังสือไทยเลย
 * เช่น "BCM VILLAGGIO SAP PATTANA" หรือ "E05110003A1246"
 * ปล่อยไว้จะกลายเป็นรายการของราคาหลักแสน เพราะเลขรหัสถูกอ่านเป็นราคา
 */
function intakeOcrJunkLine_(t) {
  if (/[ก-๙]/.test(t)) return false;               // มีไทย = น่าจะเป็นชื่อของ
  return /^[A-Za-z0-9#*\/.\-_ ()]+$/.test(t);      // อังกฤษ/ตัวเลข/สัญลักษณ์ล้วน
}

/**
 * ตัวเลข+หน่วยที่ "ยืนเดี่ยว" จริง ๆ — ต้องมีช่องว่างคั่นหน้า และไม่มีตัวหนังสือต่อท้าย
 *   "หมูสามชั้น 2 กก."   → 2 กก. คือน้ำหนักที่ซื้อจริง
 *   "นิสชินไก่เผ็ด60ก"   → "60ก" คือขนาดซองที่ติดมากับชื่อสินค้า ไม่ใช่จำนวนที่ซื้อ
 *
 * ในบิลชื่อสินค้าเต็มไปด้วยตัวเลข (60ก / 75 / P1) ถ้าใช้ตัวจับหน่วยแบบหลวมเหมือน
 * ทางพิมพ์ ชื่อจะถูกแทะจนเหลือ "นิสชินไก่เผ็ด ก" แล้ว 60 จะกลายเป็นจำนวนที่ซื้อ
 */
function intakeOcrUnitRe_() {
  return new RegExp('(?:^|\\s)(\\d+(?:[.,]\\d+)?)\\s*(' +
                    INTAKE_UNIT_RE + ')(?![ก-๙A-Za-z0-9])', 'gi');
}

/**
 * บรรทัดหนึ่งในบิล → หนึ่งแถว
 *   null                    ไม่ใช่แถวของบิล
 *   { discount: true }      แถวส่วนลด — ไม่เอาเข้าชีต แต่ต้องนับไว้ให้ราคาเรียงตรงคอลัมน์
 *   { item: {...} }         ได้ชื่อของพร้อมราคาครบในบรรทัดเดียว
 *   { item: {...}, wait:1 } ได้ชื่อของ แต่ราคาอยู่คนละบรรทัด (รอคอลัมน์ราคา)
 *
 * บิลที่ร้านค้าพิมพ์มาเขียนคนละแบบกับที่คนพิมพ์เข้าไลน์เอง
 *   "1P นิสชินบะหมี่        10.00"
 * คือขึ้นต้นด้วยจำนวน+รหัสหมวด (1P / 1A / 2P) และ "ราคาอยู่ท้ายบรรทัด"
 *
 * โยนเข้าตัวแยกข้อความของทางพิมพ์ตรง ๆ จะพลาดสองอย่าง
 *   1) หยิบ "1" จาก "1P" มาเป็นราคา ทิ้ง 10.00 ที่เป็นราคาจริง
 *      → ของ 10 บาทกลายเป็น 1 บาททุกบรรทัด
 *   2) แทะตัวเลขที่ติดมากับชื่อ "นิสชินไก่เผ็ด60ก" เหลือ "นิสชินไก่เผ็ด ก"
 *      แล้ว 60 กลายเป็นจำนวนที่ซื้อ
 *
 * และราคาต้องเป็น "คำแยก" เท่านั้น — เลขที่ติดกับตัวหนังสือคือขนาดซอง
 * ไม่ใช่ราคา ("ผัดฉ่า75" = ขนาด 75 กรัม ราคา 10 บาทอยู่คนละบรรทัด)
 */
function intakeOcrRow_(line) {
  var t = String(line || '').trim();
  if (!t) return null;

  // จำนวน+รหัสหมวดหน้าบรรทัด "1P " / "1A " / "12P "
  // ต้องเป็นตัวพิมพ์ใหญ่ตัวเดียว ไม่งั้น "3 kg หมู" จะโดนตัดจนน้ำหนักหาย
  // และเป็นละตินเท่านั้น ไม่งั้น "3 ถุง" จะโดนตัดด้วย
  var qty  = 0;
  var coded = false;                 // บิลเขียนรหัสหมวดไว้ = แถวนี้เป็นรายการของแน่ ๆ
  var head = t.match(/^(\d{1,3})\s*[A-Z](?![A-Za-z])\s*/);
  if (head) {
    qty   = intakeNum_(head[1]);
    t     = t.slice(head[0].length);
    coded = true;
  } else {
    // บิลบางเจ้าไล่เลขไว้หน้าบรรทัดเฉย ๆ "1 หมูสามชั้น 285.00"
    // เลขแบบนี้ไม่รู้ว่าเลขบรรทัดหรือจำนวน จึงตัดออกจากชื่อแต่ไม่เอาไปลงเป็นจำนวน
    // ("2 กก. หมู 450" ห้ามตัด ไม่งั้นน้ำหนักหาย — เช็คว่าคำถัดไปเป็นหน่วยหรือเปล่า)
    var num = t.match(/^(\d{1,3})\s+/);
    if (num && !new RegExp('^(' + INTAKE_UNIT_RE + ')(?![ก-๙A-Za-z0-9])', 'i')
                    .test(t.slice(num[0].length))) {
      t = t.slice(num[0].length);
    }
  }

  // ราคาต้องเป็นคำแยก — "ปลาดอลลี่ 68" ใช่ · "ผัดฉ่า75" ไม่ใช่ (75 คือขนาดซอง)
  var m = t.match(/(?:^|(\s+))(-?\d[\d,]*(?:\.\d{1,2})?)\s*$/);

  // บิลห้างที่เขียนรหัสหมวดมา ราคาในคอลัมน์ขวาพิมพ์ทศนิยมสองตำแหน่งเสมอ (10.00)
  // เลขจำนวนเต็มโดด ๆ ท้ายชื่อจึงเป็นเศษของชื่อที่ OCR แยกคำพลาด
  // ("มาม่าOKคาโบเผ็ด1" อ่านได้เป็น "มาม่า 0 K คาโบเผ็ด 1" — 1 ไม่ใช่ราคา)
  // ปล่อยให้ไปรอราคาจากคอลัมน์แทน เว้นแต่เว้นวรรคห่างชัดว่าเป็นคนละคอลัมน์
  if (m && coded && m[2].indexOf('.') === -1 && String(m[1] || '').length < 2) m = null;

  // บรรทัดส่วนลดของบิล — "1Pลด ย่าย่าSD ผัดฉ่า  -1.00"
  // ตัดจำนวนไปแล้วจะเหลือขึ้นต้นด้วย "ลด" ไม่ใช่ของที่ซื้อเข้า แต่ยังต้องคืนแถวไป
  // ให้ตัวเรียงคอลัมน์รู้ว่ามีแถวนี้อยู่ ไม่งั้นราคา -1.00 จะไปตกใส่ของชิ้นถัดไป
  if (/^ลด/.test(t)) return { discount: true, wait: !m };

  // เขียนหน่วยเงินมาชัด ๆ ("ปลาดอลลี่ 68 บาท 800 กรัม") = โน้ตที่คนเขียนเอง
  // ไม่ใช่บิลพิมพ์ แบบนี้ตัวแยกข้อความปกติอ่านได้ดีกว่า เพราะคนเขียนคั่นหน่วยไว้ครบ
  if (/(บาท|฿|บ\.|thb|baht)/i.test(t)) {
    var typed = intakeParseLine_(t);
    return typed ? { item: typed } : null;
  }

  var baht = m ? intakeNum_(m[2]) : 0;
  if (m && baht <= 0) return { discount: true };      // ติดลบ = ส่วนลด/คืนของ

  // น้ำหนัก/จำนวนที่เขียนแยกเป็นคำ ๆ ("หมูสามชั้น 2 กก. 450") ดึงออกมาจากชื่อ
  var bag  = intakeBag_();
  var name = m ? t.slice(0, m.index) : t;
  var re   = intakeOcrUnitRe_(), u;
  while ((u = re.exec(name)) !== null) {
    if (u[0] === '') { re.lastIndex++; continue; }   // กันวนไม่รู้จบ
    intakeApplyUnit_(bag, intakeNum_(u[1]), u[2]);
  }

  name = name.replace(intakeOcrUnitRe_(), ' ');

  // "นมสด 2 x 15.00   30.00" — บิลเขียนจำนวน × ราคาต่อหน่วย ยอดรวมอยู่ท้ายสุด
  var mult = name.match(/(\d+(?:[.,]\d+)?)\s*[xX×]\s*\d+(?:[.,]\d+)?/);
  if (mult) {
    if (!bag.qty) bag.qty = intakeNum_(mult[1]);
    name = name.replace(mult[0], ' ');
  }

  name = name.replace(/\s{2,}/g, ' ')
             .replace(/^[\s*.·:;\-]+/, '').replace(/[\s*.·:;\-]+$/, '').trim();
  if (name.replace(/[^ก-๙a-z]/gi, '').length < 2) return null;   // ไม่เหลือชื่อของจริง ๆ

  // ไม่มีราคาในบรรทัด และบิลก็ไม่ได้เขียนรหัสหมวดไว้ = ไม่รู้ว่าเป็นแถวของหรือข้อความเฉย ๆ
  // ปล่อยผ่านไปจะไปแย่งราคาจากคอลัมน์ขวาของชิ้นที่ใช่
  if (!m && !coded) return null;

  var item = {
    raw: name, baht: baht, gram: bag.gram,
    // จำนวนจากหน่วยในชื่อมาก่อน ไม่มีก็ใช้เลขหน้ารหัสหมวด
    // "1P" ไม่ต้องบอก มันคือค่าปกติของทุกบรรทัด บอกไปก็รกเปล่า ๆ
    qty: bag.qty || (qty > 1 ? qty : 0), unit: bag.unit, counts: bag.counts,
    pay: '', expense: intakeIsExpense_(name), cash: false, rnd: false,
    saidMoney: true, saidUnit: bag.saidUnit
  };
  return m ? { item: item } : { item: item, wait: true };
}

/**
 * เอาตัวเลขจากคอลัมน์ราคาไปใส่แถวที่รออยู่ตัวแรก (เรียงตามลำดับในบิล)
 * ไม่มีแถวไหนรอแล้ว = เก็บไว้ใน spare เผื่อบิลเรียงคอลัมน์ราคาไว้ก่อนชื่อ
 */
function intakeOcrFill_(rows, spare, n) {
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i].wait) continue;
    rows[i].wait = false;
    if (rows[i].item && n > 0) rows[i].item.baht = n;   // ติดลบ = ส่วนลด ไม่ใช่ราคาของ
    return;
  }
  spare.push(n);
}

/**
 * บิลบอกวิธีจ่ายไว้ในตัวเอง — เห็น VISA/MASTER/บัตรเครดิต = รูดบัตร
 * ที่เหลือ (QR / พร้อมเพย์ / เงินสด) ลงเป็นโอนตามที่ตกลงกันไว้
 * ถ้ารูดบัตรแล้วลงเป็นโอน ยอดที่ต้องจ่ายรอบบัตรจะขาดไป
 */
function intakeOcrPay_(text) {
  var t = String(text || '');
  if (/บัตรเครดิต|บัตรเดบิต|รูดบัตร|visa|master\s*card|jcb|unionpay|amex|credit|debit/i.test(t)) {
    return 'บัตรเครดิต';
  }
  return intakeProp_('INTAKE_DEFAULT_PAY', INTAKE_DEFAULT_PAY);
}

/**
 * บิลบอกว่าจ่ายเงินสดมา — ทางไลน์ไม่รับเงินสด (ลงในหน้า POS อยู่แล้ว)
 * ไม่บอกจะกลายเป็นบันทึกซ้ำสองทาง เงินสดในลิ้นชักกับยอดโอนจะเพี้ยนทั้งคู่
 * "เงินทอน" เป็นตัวชี้ที่แน่นอนกว่า เพราะมีเฉพาะตอนจ่ายสดจริง ๆ
 */
function intakeOcrCash_(text) {
  var t = String(text || '');
  if (/บัตรเครดิต|บัตรเดบิต|visa|master\s*card|jcb|unionpay|amex|credit|debit/i.test(t)) return false;
  if (/qr|พร้อมเพย์|promptpay|โอน|transfer/i.test(t)) return false;
  return /เงินทอน|เงินสด|\bcash\b|\bchange\b/i.test(t);
}

/**
 * อ่านรูปฟรีด้วย OCR ของ Google Drive
 * อัปโหลดรูปเข้า Drive แบบสั่งให้แปลงเป็น Google Docs — Google จะ OCR ให้ตอนแปลง
 * อ่านข้อความออกมาแล้วลบไฟล์ทิ้งทันที ไม่เสียเงิน ใช้โควต้า Drive ของบัญชีที่รันสคริปต์
 *
 * ต้องเปิดบริการ Drive API ในโปรเจกต์ก่อน (บริการ → Drive API) ไม่งั้น Drive จะ undefined
 */
/**
 * 🔑 รันครั้งเดียว — บังคับให้ Apps Script ขอสิทธิ์เข้าถึง Drive
 *
 * "เปิดบริการ Drive API" กับ "อนุญาตให้สคริปต์ใช้ Drive" เป็นคนละเรื่อง
 * เปิดบริการแล้วแต่ยังไม่เคยมีโค้ดเรียก Drive จริง Apps Script จะไม่เคยขออนุญาต
 * พอ LINE ส่งรูปมาถึงค่อยพัง ขึ้นว่า "ไม่มีสิทธิ์เรียก drive.files.create"
 *
 * ฟังก์ชันนี้สร้างไฟล์จิ๋วแล้วลบทิ้งทันที เพื่อให้หน้าต่างขออนุญาตเด้งขึ้นมา
 * กดอนุญาตแล้ว **ต้อง Deploy ใหม่ด้วย** เพราะเว็บแอปยึดสิทธิ์ตอนที่ deploy ไว้
 */
function authorizeDriveOcr() {
  if (typeof Drive === 'undefined' || !Drive.Files) {
    Logger.log('❌ ยังไม่ได้เปิดบริการ Drive API');
    Logger.log('   แถบซ้าย → บริการ (Services) → ➕ → Drive API → เพิ่ม');
    Logger.log('   แล้วรันฟังก์ชันนี้ใหม่');
    return;
  }

  var blob  = Utilities.newBlob('ทดสอบสิทธิ์ OCR', 'text/plain', 'intake-auth-check.txt');
  var name  = 'line-intake-auth-' + new Date().getTime();
  var docId = '';
  try {
    // เรียก API ตัวเดียวกับที่ intakeOcrImage_ ใช้ จะได้ขอสิทธิ์ตรงกันเป๊ะ
    var resource = { mimeType: 'application/vnd.google-apps.document' };
    if (typeof Drive.Files.create === 'function') {
      resource.name = name;
      docId = Drive.Files.create(resource, blob, { ocrLanguage: 'th' }).id;
    } else {
      resource.title = name;
      docId = Drive.Files.insert(resource, blob, { ocr: true, ocrLanguage: 'th' }).id;
    }
    Logger.log('✅ ใช้ Drive ได้แล้ว — อ่านรูปบิลได้');
    Logger.log('');
    Logger.log('⚠️ เหลืออีกขั้น: ต้อง Deploy ใหม่ด้วย');
    Logger.log('   เว็บแอปยึดสิทธิ์ตอนที่ deploy ไว้ ไม่ได้ยึดตามที่เพิ่งกดอนุญาต');
    Logger.log('   ไม่ deploy = ส่งรูปมาก็ยังขึ้นว่าไม่มีสิทธิ์เหมือนเดิม');
    Logger.log('   ทำให้ใช้งานได้ → จัดการการทำให้ใช้งานได้ → ✏️ → เวอร์ชัน: ใหม่');
  } catch (e) {
    Logger.log('❌ ยังใช้ Drive ไม่ได้: ' + e.message);
    Logger.log('   ถ้าเพิ่งมีหน้าต่างขออนุญาตเด้งขึ้นมา ให้กดอนุญาตแล้วรันซ้ำ');
  } finally {
    if (docId) { try { DriveApp.getFileById(docId).setTrashed(true); } catch (e) {} }
  }
}

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
    raw: String(text || ''),          // ส่งข้อความดิบกลับไปด้วย ไว้โชว์ตอนอ่านไม่ออก
    note: items.length
      ? 'อ่านด้วย OCR ฟรี ตัวเลขอาจเพี้ยนได้ ตรวจสอบอีกทีนะครับ' + intakeOcrCheckSum_(text, items)
      : (String(text).trim() ? 'อ่านตัวหนังสือได้ แต่ไม่เจอบรรทัดที่มีทั้งชื่อของและราคา'
                             : 'OCR อ่านตัวหนังสือในรูปไม่ออกเลย')
  };
}

/**
 * ข้อความดิบจาก OCR ของรูปล่าสุด — พิมพ์ "ดิบ" ในไลน์เพื่อดู
 * มีไว้ตอบคำถามเดียว: ที่ลงผิดเป็นเพราะ OCR อ่านตัวหนังสือมั่ว
 * หรือ OCR อ่านถูกแล้วแต่ตัวแยกข้อความจับผิด — คนละปัญหา คนละวิธีแก้
 */
function intakeLastRaw_() {
  var raw = String(intakeProp_('INTAKE_LAST_RAW', '') || '').trim();
  if (!raw) return '📷 ยังไม่มีรูปที่เพิ่งอ่านครับ\nส่งรูปบิลมาก่อน แล้วพิมพ์ "ดิบ" อีกที';
  var show = raw.slice(0, 1500);
  return '📄 ข้อความที่ OCR อ่านได้จากรูปล่าสุด\n\n' + show +
         (raw.length > show.length ? '\n…(ยาวกว่านี้)' : '');
}

/** บรรทัดยอดรวมของบิล (ถ้ามี) — "Total (10ชิ้น)*****93.00" */
function intakeOcrTotalLine_(text) {
  var lines = String(text || '').split(/[\n\r]+/);
  var re = /(total|รวมทั้งสิ้น|ยอดรวม|รวมเงิน|ยอดสุทธิ|รวมสุทธิ|จำนวนเงินรวม)/i;
  for (var i = 0; i < lines.length; i++) if (re.test(lines[i])) return lines[i];
  return '';
}

/** ยอดรวมที่บิลเขียนไว้เอง — ไม่เจอคืน 0 */
function intakeOcrTotal_(text) {
  var m = intakeOcrTotalLine_(text).match(/(\d[\d,]*(?:\.\d{1,2})?)\s*$/);
  return m ? intakeNum_(m[1]) : 0;
}

/**
 * จำนวนชิ้นที่บิลเขียนไว้เอง — "Total (10ชิ้น)" · "รวม 12 รายการ"
 * เป็นตัวทานที่ตรงกว่ายอดเงิน เพราะส่วนลดไม่ทำให้จำนวนชิ้นเพี้ยน
 */
function intakeOcrCount_(text) {
  var m = intakeOcrTotalLine_(text).match(/(\d{1,3})\s*(ชิ้น|รายการ|items?|pcs?)/i);
  return m ? intakeNum_(m[1]) : 0;
}

/**
 * ทานยอด: เอาที่แยกได้ไปเทียบกับยอดรวมที่บิลเขียนไว้
 * ต่างกันได้สองสาเหตุ — บิลมีส่วนลด (ที่ข้ามไปเพราะไม่ใช่ของที่ซื้อ)
 * หรือ OCR อ่านตกไปบางบรรทัด ทั้งสองอย่างเจ้าของร้านควรรู้ก่อนปิดยอด
 * ไม่แก้ตัวเลขให้เอง เพราะแก้แล้วจะทานกับบิลจริงไม่ได้อีก
 */
function intakeOcrCheckSum_(text, items) {
  var total = intakeOcrTotal_(text);
  var count = intakeOcrCount_(text);
  if (!total && !count) return '';

  var sum = 0;
  for (var i = 0; i < items.length; i++) sum += Number(items[i].baht) || 0;
  var diff  = total ? Math.round((sum - total) * 100) / 100 : 0;
  var short = count ? count - items.length : 0;   // บิลบอกกี่ชิ้น แยกได้กี่ชิ้น
  if (Math.abs(diff) < 1 && !short) return '';

  var out = '';
  // จำนวนชิ้นทานตรงกว่ายอดเงิน เพราะส่วนลดไม่ทำให้จำนวนชิ้นเพี้ยน
  if (short > 0) {
    out += '\n⚠️ บิลบอกว่ามี ' + count + ' ชิ้น แต่แยกได้ ' + items.length +
           ' — อ่านตกไป ' + short + ' รายการ';
  } else if (short < 0) {
    out += '\n⚠️ บิลบอกว่ามี ' + count + ' ชิ้น แต่แยกได้ ' + items.length +
           ' — น่าจะมีบรรทัดที่ไม่ใช่ของปนมา';
  }
  if (Math.abs(diff) >= 1) {
    out += (out ? '\n' : '\n⚠️ ') + 'รวมรายการได้ ' + intakeMoney_(sum) +
           ' บาท แต่บิลเขียนยอด ' + intakeMoney_(total) +
           ' บาท (ต่าง ' + intakeMoney_(Math.abs(diff)) + ')';
    if (!short) {
      out += diff > 0
        ? '\nน่าจะเป็นเพราะบิลมีส่วนลด — ส่วนลดไม่ใช่ของที่ซื้อ เลยไม่ได้บันทึก'
        : '\nน่าจะอ่านตกไปบางบรรทัด';
    }
  }
  return out + '\nอยากรู้ว่า OCR อ่านอะไรได้บ้าง พิมพ์ "ดิบ" · จะพิมพ์เองก็พิมพ์ "ลบ" ก่อน';
}

/**
 * ข้อความดิบจาก OCR → รายการของ
 *
 * บิลที่ช่องราคาห่างจากชื่อมาก ๆ (บิลห้างส่วนใหญ่) OCR จะแยกราคาไปไว้คนละบรรทัด
 * ได้ออกมาเป็นชื่อของเรียงกันเป็นพืด แล้วตามด้วยราคาเรียงกันอีกพืด
 * ถ้าอ่านทีละบรรทัดแบบตรง ๆ จะไม่เจอราคาสักตัว
 *
 * ตรงนี้จึงเก็บ "แถว" ไว้ตามลำดับในบิล แล้วค่อยเอาตัวเลขจากคอลัมน์ราคา
 * มาเติมให้แถวที่รออยู่ตัวแรกไปเรื่อย ๆ — บิลจะเรียงแบบไหนก็ตรงกัน
 * แถวส่วนลดต้องนับด้วย ไม่งั้น -1.00 จะไปตกใส่ของชิ้นถัดไป
 */
function intakeOcrItems_(text) {
  var lines = String(text || '').split(/[\n\r]+/);
  var rows  = [], spare = [], i, j;

  for (i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    if (!t) continue;
    if (INTAKE_OCR_SKIP.test(t)) continue;
    if (/^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}/.test(t)) continue;   // วันที่
    if (/^\d{1,2}:\d{2}/.test(t)) continue;                       // เวลา

    // บรรทัดที่มีแต่ตัวเลขล้วน = คอลัมน์ราคาที่ OCR แยกออกมาไว้ต่างหาก
    if (/^[-\d.,\s]+$/.test(t)) {
      var nums = t.match(/-?\d[\d,]*(?:\.\d{1,2})?/g) || [];
      for (j = 0; j < nums.length; j++) intakeOcrFill_(rows, spare, intakeNum_(nums[j]));
      continue;
    }

    if (!/[ก-๙a-z]/i.test(t)) continue;                           // ไม่มีตัวหนังสือเลย
    if (intakeOcrJunkLine_(t)) continue;                          // ชื่อร้าน/รหัสล้วน ๆ

    var row = intakeOcrRow_(t);
    if (row) rows.push(row);
  }

  // ยังมีแถวที่รอราคา และมีตัวเลขเหลือ = บิลใบนี้ OCR อ่านคอลัมน์ราคาขึ้นมาก่อนชื่อ
  for (i = 0; i < rows.length && spare.length; i++) {
    if (rows[i].wait) intakeOcrFill_([rows[i]], [], spare.shift());
  }

  // วิธีจ่ายอ่านจากบิลทั้งใบ ไม่ใช่รายบรรทัด — บิลเขียนไว้ท้ายใบใบเดียวสำหรับทุกรายการ
  var pay  = intakeOcrPay_(text);
  var cash = intakeOcrCash_(text);
  var out  = [];

  for (i = 0; i < rows.length && out.length < INTAKE_MAX_ITEMS; i++) {
    var it = rows[i].discount ? null : rows[i].item;
    if (!it || !(it.baht > 0)) continue;             // ไม่มีราคา = ไม่รู้ว่าจ่ายไปเท่าไหร่
    if (String(it.raw).length < 2) continue;         // เศษตัวอักษรเดี่ยว ๆ ไม่ใช่ชื่อของ
    it.pay  = it.pay || pay;
    it.cash = it.cash || cash;
    out.push(it);
  }

  return out;
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
    return sh;
  }

  // ชีตที่มีอยู่ก่อนแล้ว — เติมหัวคอลัมน์ที่เพิ่มมาทีหลังให้ครบ
  // ต่อท้ายอย่างเดียว ไม่แตะของเดิม แถวเก่าจึงยังอ่านถูกทุกช่อง
  var width = Math.max(sh.getLastColumn(), 1);
  var head  = sh.getRange(1, 1, 1, width).getValues()[0]
                .map(function (h) { return String(h).trim(); });
  var add = INTAKE_HEADERS.filter(function (h) { return head.indexOf(h) === -1; });
  if (add.length) {
    if (sh.getMaxColumns() < width + add.length) {
      sh.insertColumnsAfter(sh.getMaxColumns(), width + add.length - sh.getMaxColumns());
    }
    sh.getRange(1, width + 1, 1, add.length).setValues([add])
      .setFontWeight('bold').setBackground('#fee2e2').setFontColor('#991b1b');
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
  var stockItems = intakeStockItems_();
  var names = stockItems.map(function (x) { return x.name; });
  var byName = {};
  stockItems.forEach(function (x) { byName[x.name] = x; });

  var buyLines = [], expLines = [], stockLines = [], rndLines = [];
  var buyTotal = 0, expTotal = 0, cardTotal = 0, rndTotal = 0;
  var unmatched = false, saidCash = false;
  var saved = { p: [], e: [], s: [], msgId: ctx.msgId };

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
      if (it.cash) saidCash = true;

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
        var kind  = it.rnd ? INTAKE_KIND_RND : INTAKE_KIND_STOCK;
        buyRows.push([
          date, time, 'L' + stamp + '-' + ('00' + buySeq).slice(-3),
          ctx.location, ctx.who,
          hit.name, it.raw, it.baht || '', it.gram || '', perKg,
          it.qty || '', it.unit, source, rawText, ctx.msgId, it.pay, kind
        ]);

        if (it.rnd) {
          // ของลองสูตร — ไม่เข้าสต็อก ไม่งั้นยอดคงเหลือเกินจริง
          // แล้วตอนเช็คสต็อกจะกลายเป็นของหาย ทั้งที่เอาไปลองสูตรหมดแล้ว
          rndTotal += it.baht || 0;
          rndLines.push('• ' + it.raw + ' — ' + intakeAmountText_(it) + intakePayTag_(it.pay));
          continue;
        }

        buyTotal += it.baht || 0;
        if (!hit.matched) unmatched = true;
        buyLines.push('• ' + hit.name + (hit.matched ? '' : ' *') + ' — ' +
                      intakeAmountText_(it) + intakePayTag_(it.pay));

        // บอกจำนวนหน่วยย่อยมาด้วย ("ได้ 26 ไม้") → ลงของเข้าครัวกลางให้เลย
        // ยอดสต็อกคงเหลือจะขยับตาม และบอทของเข้าจะแจ้งวันหมดอายุให้เอง
        var q = hit.matched ? intakeStockQty_(byName[hit.name], it.counts) : null;
        if (q && q.base > 0) {
          var srow = intakeAddStockIn_(byName[hit.name], q, ctx);
          if (srow) {
            saved.s.push(srow);
            stockLines.push('• ' + hit.name + ' ' + q.base + ' ' + byName[hit.name].subUnit +
                            (q.packs ? '  (' + q.packs + ' ' + byName[hit.name].packUnit + ')' : ''));
          }
        }
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
  if (buyLines.length)   blocks.push('🛒 ซื้อของ\n' + buyLines.join('\n'));
  if (expLines.length)   blocks.push('🧾 ค่าใช้จ่าย\n' + expLines.join('\n'));
  if (rndLines.length)   blocks.push('🧪 ลองสูตร (ไม่เข้าสต็อก)\n' + rndLines.join('\n'));
  if (stockLines.length) blocks.push('📦 เข้าครัวกลางแล้ว\n' + stockLines.join('\n'));

  var msg = '✅ บันทึกแล้ว ' +
            (buyLines.length + expLines.length + rndLines.length) +
            ' รายการ\n\n' + blocks.join('\n\n');

  var sums = [];
  if (buyTotal) sums.push('ซื้อของ ' + intakeMoney_(buyTotal));
  if (expTotal) sums.push('ค่าใช้จ่าย ' + intakeMoney_(expTotal));
  if (rndTotal) sums.push('ลองสูตร ' + intakeMoney_(rndTotal));
  if (sums.length) msg += '\n\nรวม ' + sums.join(' · ') + ' บาท';
  if (cardTotal) msg += '\n💳 รูดบัตร ' + intakeMoney_(cardTotal) + ' บาท (ไปรวมในรอบบัตร)';
  if (stockLines.length) msg += '\n\nยอดสต็อกขยับแล้ว · เดี๋ยวบอทของเข้าจะแจ้งวันหมดอายุให้';
  if (unmatched) msg += '\n\n* ไม่มีชื่อนี้ในชีตรายการสินค้า — บันทึกตามที่ส่งมา';
  // เงินสดหน้าร้านลงในหน้า POS อยู่แล้ว รับทางไลน์ด้วยยอดจะถูกหักสองรอบ
  if (saidCash) {
    msg += '\n\n⚠️ ทางไลน์รับแค่ "โอน" กับ "บัตร" — บันทึกให้เป็นโอนไปก่อน' +
           '\nถ้าจ่ายด้วยเงินสดหน้าร้านจริง พิมพ์ "ลบ" แล้วไปลงในหน้า POS แทน';
  }
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

  var buys  = last.p || last.rows || [];   // last.rows = รูปแบบเก่าก่อนมีชีตค่าใช้จ่าย
  var exps  = last.e || [];
  var stock = last.s || [];
  if (!buys.length && !exps.length && !stock.length) return 'ไม่มีรายการล่าสุดให้ลบครับ';

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var gone = 0, stockGone = 0;
    gone += intakeDeleteRows_(intakeSheet_(), buys,
              INTAKE_HEADERS.indexOf('messageId') + 1, last.msgId, false);
    gone += intakeDeleteRows_(intakeExpenseSheet_(), exps,
              INTAKE_EXPENSE_HEADERS.indexOf('order_id') + 1, last.msgId, true);

    // ต้องลบแถวในชีตของเข้าด้วย ไม่งั้นยอดสต็อกคงเหลือจะค้างเกินความจริง
    if (stock.length) {
      var sheetName = (typeof SHEET_INCOMING === 'string') ? SHEET_INCOMING : 'จำนวนของเข้า';
      var ssh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
      if (ssh) {
        var head = ssh.getRange(1, 1, 1, ssh.getLastColumn()).getValues()[0];
        var col = 0;
        head.forEach(function (h, i) { if (String(h).trim() === 'messageId') col = i + 1; });
        if (col) stockGone = intakeDeleteRows_(ssh, stock, col, last.msgId, false);
      }
    }

    intakeProps_().deleteProperty(key);
    if (!gone && !stockGone) return 'หาแถวที่จะลบไม่เจอ (อาจถูกลบไปแล้ว)';
    return '🗑️ ลบออกให้แล้ว ' + gone + ' รายการ' +
           (stockGone ? '\n📦 ถอนของเข้าครัวกลางออกด้วย ' + stockGone + ' รายการ' : '');
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
    // ของหายมีหน้าเฉพาะอยู่แล้วในหน้าสรุปยอดขาย และคิดละเอียดกว่า
    // (หักเดลิเวอรี่ ส่วนลด น้ำจิ้มแถม แล้วเทียบกับยอดขายจริง)
    // ไม่คิดซ้ำในนี้ เพราะถ้าสองที่ให้เลขไม่ตรงกัน จะไม่รู้ว่าควรเชื่ออันไหน
    if (what === 'loss') {
      return '🔎 ดูของหายได้ที่หน้าสรุปยอดขายครับ\n\n' +
             'เปิด "สรุปยอดขาย" → แท็บ 🔎 คำนวณของหาย\n\n' +
             'มันเทียบให้ว่าของที่ใช้ไปกับเงินที่ได้มาตรงกันไหม\n' +
             'หักเดลิเวอรี่ ส่วนลด และน้ำจิ้มแถมให้แล้ว\n\n' +
             '(ต้องเช็คสต็อกอย่างน้อย 2 ครั้งถึงจะเทียบได้)';
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
/**
 * บอกว่าต้องเอา URL ไหนไปใส่ใน LINE
 *
 * ⚠️ ScriptApp.getService().getUrl() คืน URL ลงท้าย /dev ตอนรันจากหน้าแก้ไข
 *    /dev ต้อง login ด้วยบัญชี Google ก่อนถึงเข้าได้ LINE จึงใช้ไม่ได้เลย
 *    ยิงไปแล้วเจอหน้า login ไม่ถึงโค้ด บอทเลยเงียบสนิทแบบไม่มี error
 *    และแปลง /dev เป็น /exec เองไม่ได้ เพราะคนละ deployment id
 *    เคยพิมพ์ URL นี้ออกมาแล้วบอกว่า "เอาไปใส่ใน LINE" ซึ่งผิด แก้แล้ว
 */
function intakeWebhookHint_() {
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) {}

  if (/\/exec$/.test(url)) {
    return '✅ Webhook URL ที่ต้องเอาไปใส่ใน LINE Developers Console:\n  ' + url;
  }

  var head = /\/dev$/.test(url)
    ? '⚠️ ตัวนี้เป็น URL ทดสอบ (/dev) — เอาไปใส่ใน LINE ไม่ได้\n' +
      '   ' + url + '\n' +
      '   /dev ต้อง login ด้วยบัญชี Google ก่อน LINE เข้าไม่ถึง บอทจะเงียบสนิท\n\n'
    : '⚠️ ยังไม่ได้ Deploy เป็นเว็บแอป — LINE ยิงเข้ามาไม่ได้\n\n';

  return head +
    'เอา URL ที่ลงท้าย /exec มาจากตรงนี้แทน:\n' +
    '  ทำให้ใช้งานได้ (ขวาบน) → จัดการการทำให้ใช้งานได้ → ก๊อป URL เว็บแอป\n\n' +
    'ครั้งต่อ ๆ ไปที่แก้โค้ด ให้กด ✏️ ที่ตัวเดิม → เวอร์ชัน: ใหม่\n' +
    'อย่ากด "ทำให้ใช้งานได้ใหม่" เพราะจะได้ URL ใหม่ แล้วต้องไล่แก้ทั้ง LINE และหน้าเว็บ';
}

function intakeReply_(ctx, text) {
  var token = intakeProp_('LINE_CHANNEL_ACCESS_TOKEN', '');
  if (!token) {
    // เคยเงียบไปเฉย ๆ ตรงนี้ หาสาเหตุกันนาน — บันทึกลงชีตสำเร็จแต่ตอบกลับไม่ได้
    Logger.log('⛔ ตอบกลับไม่ได้ — ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN ในโปรเจกต์นี้');
    return;
  }
  if (!text) return;

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

/**
 * เช็คว่าไฟล์นี้อยู่ถูกโปรเจกต์หรือเปล่า — คืนรายการปัญหาที่เจอ
 * ผิดโปรเจกต์แล้วอาการจะงง ๆ (บอทเงียบ ชีตไม่ขึ้น) เลยต้องบอกให้ชัดตั้งแต่ตอนติดตั้ง
 */
function intakeCheckProject_() {
  var out = [];
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}

  if (!ss) {
    out.push('โปรเจกต์นี้ไม่ได้ผูกกับ Google Sheets — หาชีตไม่เจอเลย บันทึกอะไรไม่ได้สักอย่าง\n' +
             '     (ต้องเปิดจาก ชีตของร้าน → ส่วนขยาย → Apps Script\n' +
             '      ไม่ใช่สร้างโปรเจกต์ใหม่จาก script.google.com)');
  }
  if (typeof doPost !== 'function') {
    out.push('ไม่เจอ pos-backend.gs ในโปรเจกต์นี้\n' +
             '     • LINE ยิง webhook เข้ามาจะไม่มีใครรับ (doPost อยู่ในไฟล์นั้น)\n' +
             '     • จับชื่อสินค้าให้ตรงชีตรายการสินค้าไม่ได้\n' +
             '     • ลงชีตค่าใช้จ่ายให้ตรงกับหน้า POS ไม่ได้');
  }
  return out;
}

/** รันครั้งเดียว — สร้างชีตปลายทางและบอก URL ที่ต้องเอาไปใส่ใน LINE */
function setupLineIntake() {
  var problems = intakeCheckProject_();
  if (problems.length) {
    Logger.log('⛔ ไฟล์นี้อยู่ผิดโปรเจกต์ — แก้ตรงนี้ก่อน ไม่งั้นใช้ไม่ได้เลย\n');
    Logger.log('  • ' + problems.join('\n  • '));
    Logger.log('\n───────────────────────────────────────');
    Logger.log('วิธีแก้: line-intake.gs + accounting.gs + pos-backend.gs');
    Logger.log('ต้องอยู่ "โปรเจกต์เดียวกัน" คือโปรเจกต์ที่ผูกกับชีตของร้าน');
    Logger.log('  1) เปิด Google Sheets ของร้าน');
    Logger.log('  2) ส่วนขยาย (Extensions) → Apps Script');
    Logger.log('  3) กด + ข้าง "ไฟล์" → สคริปต์ → วางโค้ดลงไป');
    Logger.log('โปรเจกต์ที่สร้างแยกไว้ ลบทิ้งได้เลย และอย่าเอา URL ของมันไปใส่ใน LINE');
    return;
  }

  var sh = intakeSheet_();
  Logger.log('สร้าง/พบชีต "' + INTAKE_SHEET + '" แล้ว (' + sh.getLastRow() + ' แถว)');

  Logger.log('\n' + intakeWebhookHint_());

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

  // โชว์ข้อความดิบก่อนเสมอ — ถ้าตรงนี้มั่ว จะปรับตัวแยกข้อความยังไงก็ไม่ช่วย
  Logger.log('───── ข้อความดิบที่ OCR อ่านได้ ─────');
  Logger.log(String(read.raw || '(ว่าง — อ่านตัวหนังสือไม่ออกเลย)'));
  Logger.log('─────────────────────────────────\n');

  Logger.log('แยกได้ ' + read.items.length + ' รายการ  (' + read.note + ')');
  var names = intakeItemNames_();
  read.items.forEach(function (it) {
    var hit = intakeMatchItem_(it.raw, names);
    Logger.log('  • ' + hit.name + (hit.matched ? '' : ' (ไม่ตรงชีต)') + '  |  ' + intakeAmountText_(it));
  });

  if (!read.items.length) {
    Logger.log('\nอ่านข้อความดิบข้างบนแล้วเทียบดู');
    Logger.log('  ตัวหนังสือมั่ว/ว่าง = OCR ฟรีไปไม่ถึง → ตั้ง ANTHROPIC_API_KEY ให้ Claude อ่าน');
    Logger.log('  ตัวหนังสืออ่านออกแต่ไม่ถูกแยก = บอกผมได้ ผมปรับตัวแยกข้อความให้');
  }
}

/**
 * 🔍 ตรวจทุกอย่างรวดเดียว — บอทเงียบเมื่อไหร่ให้รันตัวนี้ก่อน
 * ไล่ทีละข้อจากต้นทางไปปลายทาง แล้วบอกว่าติดตรงไหน
 */
function diagnoseLineIntake() {
  var ok = '  ✅ ', bad = '  ❌ ', warn = '  ⚠️ ', info = '  ℹ️  ';
  Logger.log('🔍 ตรวจระบบ "ส่งไลน์ → บันทึกลงชีต"\n');

  // 1) อยู่ถูกโปรเจกต์ไหม — ข้อนี้ไม่ผ่าน อย่างอื่นไม่ต้องดู
  var problems = intakeCheckProject_();
  if (problems.length) {
    Logger.log(bad + problems.join('\n' + bad));
    Logger.log('\n⛔ แก้ข้อนี้ก่อน — เอาไฟล์ไปวางในโปรเจกต์ที่เปิดจาก');
    Logger.log('   ชีตของร้าน → ส่วนขยาย → Apps Script');
    return;
  }
  Logger.log(ok + 'อยู่ในโปรเจกต์ที่ผูกกับชีต และเจอ pos-backend แล้ว');

  // 2) ส่วนบัญชี
  Logger.log(typeof accMonthSummary_ === 'function'
    ? ok + 'เจอ accounting.gs — คำสั่ง "งบ" กับ "บัตร" ใช้ได้'
    : warn + 'ไม่เจอ accounting.gs — คำสั่ง "งบ"/"บัตร" ยังใช้ไม่ได้ (อย่างอื่นปกติ)');

  // 3) token — สาเหตุอันดับหนึ่งที่บอทเงียบทั้งที่บันทึกลงชีตแล้ว
  var token = intakeProp_('LINE_CHANNEL_ACCESS_TOKEN', '');
  if (!token) {
    Logger.log(bad + 'ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN ในโปรเจกต์นี้');
    Logger.log('       ← ถ้าบอทเงียบ ข้อนี้น่าจะเป็นสาเหตุ');
    Logger.log('       บันทึกลงชีตได้ แต่ส่งข้อความตอบกลับไม่ได้');
    Logger.log('       ตั้งที่ ⚙️ การตั้งค่าโปรเจกต์ → คุณสมบัติสคริปต์');
  } else {
    try {
      var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/info', {
        headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
      });
      if (res.getResponseCode() === 200) {
        Logger.log(ok + 'token ใช้ได้ — บอทชื่อ "' +
                   (JSON.parse(res.getContentText()).displayName || '') + '"');
      } else {
        Logger.log(bad + 'token ใช้ไม่ได้ (LINE ตอบ ' + res.getResponseCode() + ')' +
                   ' — ก๊อปมาไม่ครบ หรือเป็นของ Channel อื่น');
      }
    } catch (e) {
      Logger.log(bad + 'ต่อ LINE ไม่ได้: ' + e.message);
    }
  }

  // 4) URL ที่ต้องเอาไปใส่ใน LINE
  Logger.log(intakeWebhookHint_());

  // 5) ล็อกต้นทางไว้หรือเปล่า
  var allow = intakeProp_('INTAKE_ALLOW', '');
  Logger.log(allow
    ? warn + 'ล็อกให้รับเฉพาะ: ' + allow + '\n       ทักจากที่อื่นบอทจะเงียบ — ล้างด้วย clearIntakeAllow()'
    : ok + 'ยังไม่ได้ล็อกต้นทาง (รับจากทุกที่)');

  // 6) เรื่องที่คนสับสนบ่อยที่สุด
  var gm = String(intakeProp_('INTAKE_GROUP_MODE', 'smart')).toLowerCase();
  Logger.log(info + 'โหมดในกลุ่ม: "' + gm + '"');
  if (gm === 'prefix') {
    Logger.log('       ต้องขึ้นต้นด้วย "' + INTAKE_PREFIXES.slice(0, 3).join('" / "') + '" เสมอ');
    Logger.log('       อยากพิมพ์ในกลุ่มได้เลย → ตั้ง INTAKE_GROUP_MODE = smart');
  } else if (gm === 'all') {
    Logger.log('       เก็บทุกบรรทัดที่อ่านออก — ระวังบทสนทนาปนลงชีต');
  } else {
    Logger.log('       พิมพ์ในกลุ่มได้เลย ไม่ต้องมีคำนำหน้า');
    Logger.log('       บอทเก็บเฉพาะบรรทัดที่ขึ้นต้นด้วย "ค่า" / ชื่อตรงชีตสินค้า / บอกหน่วยเงินชัด');
  }
  Logger.log(info + 'อ่านรูป: โหมด "' + intakeImageMode_() + '"');

  Logger.log('\n─────────────────────────────────');
  Logger.log('ถ้าทุกข้อผ่านแล้วบอทยังเงียบ:');
  Logger.log('  1) เปิดเมนู "การดำเนินการ (Executions)" ทางแถบซ้าย');
  Logger.log('  2) ทักบอทอีกครั้ง แล้วรีเฟรชหน้านั้น');
  Logger.log('  3) ไม่มีแถวใหม่โผล่ = LINE ยิงมาไม่ถึงสคริปต์');
  Logger.log('     → Webhook URL ผิด หรือยังไม่เปิด Use webhook');
  Logger.log('     → หรือ Deploy แล้วแต่ยังไม่ได้กด New version');
  Logger.log('  4) มีแถวใหม่ = สคริปต์ทำงานแล้ว กดเข้าไปอ่านว่ามันบอกอะไร');
}

/**
 * ยิงเข้า URL ที่ deploy ไว้จริง แล้วดูว่ามันเสิร์ฟโค้ดเวอร์ชันไหน
 *
 * ปุ่ม ▶ ในหน้าแก้ไขรันโค้ดล่าสุดที่เซฟ แต่ LINE ยิงเข้า URL ซึ่งเสิร์ฟ
 * "เวอร์ชันที่กด Deploy ไว้" สองอันนี้ต่างกันได้ และเป็นต้นเหตุที่หาสาเหตุยากที่สุด
 * เพราะทุกอย่างในหน้าแก้ไขดูถูกหมด แต่ของจริงข้างนอกเป็นโค้ดเก่า
 *
 * UrlFetchApp ยิงแบบไม่มี session ของเบราว์เซอร์ จึงเห็นแบบเดียวกับที่ LINE เห็น
 * ได้ผลพลอยได้คือเช็คเรื่องสิทธิ์เข้าถึงไปในตัว
 *
 * ต้องตั้ง Script Property ชื่อ INTAKE_WEBHOOK_URL เป็น URL ที่ลงท้าย /exec ก่อน
 * (ตัวเดียวกับที่ใส่ใน LINE) — หาไม่เจอก็ข้ามไป ไม่ขวางการตรวจอย่างอื่น
 */
function intakeCheckDeployed_() {
  var url = String(intakeProp_('INTAKE_WEBHOOK_URL', '')).trim();
  if (!url) {
    Logger.log('ℹ️  ข้ามการเช็คเวอร์ชันที่ deploy — ยังไม่ได้ตั้ง INTAKE_WEBHOOK_URL');
    Logger.log('   ตั้งไว้แล้วจะเช็คให้อัตโนมัติว่า deploy ติดหรือยัง ไม่ต้องเปิดเบราว์เซอร์เอง');
    Logger.log('   ⚙️ การตั้งค่าโปรเจกต์ → คุณสมบัติสคริปต์ → ใส่ URL ที่ลงท้าย /exec\n');
    return true;
  }

  if (!/\/exec$/.test(url)) {
    Logger.log('❌ INTAKE_WEBHOOK_URL ต้องลงท้าย /exec — ตอนนี้เป็น\n   ' + url);
    Logger.log('   /dev ใช้กับ LINE ไม่ได้ เอา /exec มาจาก จัดการการทำให้ใช้งานได้');
    return false;
  }

  var res;
  try {
    res = UrlFetchApp.fetch(url + '?action=ping', { muteHttpExceptions: true,
                                                    followRedirects: true });
  } catch (e) {
    Logger.log('❌ ต่อ URL ที่ deploy ไว้ไม่ได้: ' + e.message);
    return false;
  }

  var code = res.getResponseCode();
  var text = res.getContentText();

  if (code !== 200) {
    Logger.log('❌ URL ที่ deploy ไว้ตอบ ' + code + ' — LINE ก็จะเจอแบบเดียวกัน');
    Logger.log('   401/403 = "ผู้ที่มีสิทธิ์เข้าถึง" ยังไม่ได้ตั้งเป็น ทุกคน');
    Logger.log('   404 = URL ผิด หรือ deployment ถูกลบไปแล้ว');
    return false;
  }
  if (/<html/i.test(text)) {
    Logger.log('❌ URL ที่ deploy ไว้ตอบเป็นหน้าเว็บ ไม่ใช่ข้อมูล — น่าจะเป็นหน้าให้ล็อกอิน');
    Logger.log('   ตั้ง "ผู้ที่มีสิทธิ์เข้าถึง" เป็น ทุกคน แล้ว deploy ใหม่');
    return false;
  }

  var got = {};
  try { got = JSON.parse(text); } catch (e) {}
  var mods = got['ระบบที่เวอร์ชันนี้มี'];

  if (!mods) {
    Logger.log('❌ เวอร์ชันที่ deploy อยู่เป็นโค้ดเก่า — ยังไม่รู้จัก ping ด้วยซ้ำ');
    Logger.log('   มันตอบว่า: ' + text.slice(0, 120));
    Logger.log('\n   แปลว่าที่แก้โค้ดไปยังไม่ถึง LINE เลย ทำ 3 ข้อนี้');
    Logger.log('   1) วางโค้ดใหม่ให้ครบ แล้วกด Ctrl+S บันทึก');
    Logger.log('   2) ทำให้ใช้งานได้ → จัดการการทำให้ใช้งานได้ → ✏️');
    Logger.log('      ⭐ ช่อง "เวอร์ชัน" ต้องเลือก "ใหม่" ไม่ใช่เลขเวอร์ชันเก่า');
    Logger.log('   3) รันฟังก์ชันนี้ใหม่');
    return false;
  }

  var missing = Object.keys(mods).filter(function (k) { return !mods[k]; });
  if (missing.length) {
    Logger.log('❌ เวอร์ชันที่ deploy อยู่ยังขาดไฟล์: ' + missing.join(', '));
    Logger.log('   วางไฟล์ที่ขาดลงโปรเจกต์ แล้ว deploy โดยเลือก เวอร์ชัน: ใหม่');
    return false;
  }

  Logger.log('✅ เวอร์ชันที่ deploy อยู่มีครบทุกไฟล์ และเปิดจากข้างนอกได้');
  Logger.log('   ' + url + '\n');
  return true;
}

/**
 * 🧪 แยกให้ชัดว่าติด "ขาเข้า" หรือ "ขาออก"
 *   ขาเข้า  = LINE ส่ง webhook มาถึงสคริปต์ไหม
 *   ขาออก  = สคริปต์ส่งข้อความกลับไปหา LINE ได้ไหม
 * รันหลังจากพิมพ์อะไรสักอย่างในกลุ่มแล้ว
 */
function testIntakeSend() {
  var props = intakeProps_();
  var seen = {};
  try { seen = JSON.parse(props.getProperty('INTAKE_SENDERS') || '{}'); } catch (e) {}
  var ids = Object.keys(seen);
  var lastHit = props.getProperty('INTAKE_LAST_HIT') || '';

  // ── เช็คก่อนว่า "เวอร์ชันที่ deploy อยู่" เป็นโค้ดใหม่จริงไหม ──
  // ตัวจับ INTAKE_LAST_HIT อยู่ในโค้ดใหม่ ถ้า deploy ยังไม่ติด มันจะขึ้น ❌ อยู่ดี
  // ไม่ว่า LINE จะยิงมาหรือไม่ อ่านผลผิดแล้วไล่หาผิดทางทั้งกระบวน
  if (!intakeCheckDeployed_()) return;

  // ── ขาเข้า ──
  // INTAKE_LAST_HIT ถูกจดทันทีที่ webhook มาถึง ก่อนกรองอะไรทั้งสิ้น
  // จึงเป็นหลักฐานว่า LINE ยิงถึงโค้ดจริง แยกออกจาก "มาถึงแล้วโดนกรองทิ้ง"
  if (!lastHit) {
    Logger.log('❌ ขาเข้า: ยังไม่เคยมีข้อความจากไลน์มาถึงสคริปต์นี้เลย\n');
    Logger.log('   ปัญหาอยู่ฝั่ง LINE หรือ URL ไม่ใช่ในโค้ด — ไล่ 5 ข้อนี้\n');

    Logger.log('   0) ⭐ เปิด <URL>/exec ใน "หน้าต่างส่วนตัว/ไม่ระบุตัวตน" ของเบราว์เซอร์');
    Logger.log('      ถ้ามันขอให้ล็อกอิน Google = เจอต้นเหตุแล้ว');
    Logger.log('      ตอน Deploy ช่อง "ผู้ที่มีสิทธิ์เข้าถึง" ต้องเป็น ทุกคน (Anyone)');
    Logger.log('      ค่าเริ่มต้นคือ "เฉพาะตัวฉัน" ซึ่ง LINE เข้าไม่ได้');
    Logger.log('      หลอกง่ายมาก เพราะเปิดในเบราว์เซอร์ตัวเองได้ปกติ (ล็อกอินอยู่แล้ว)');
    Logger.log('      แก้ที่ จัดการการทำให้ใช้งานได้ → ✏️ → ผู้ที่มีสิทธิ์เข้าถึง = ทุกคน\n');

    Logger.log('   1) Webhook URL ต้องลงท้าย /exec ไม่ใช่ /dev');
    Logger.log('      เอามาจาก ทำให้ใช้งานได้ → จัดการการทำให้ใช้งานได้');
    Logger.log('   2) URL ต้องเป็นของ deployment ล่าสุด — เปิด <URL>?action=ping');
    Logger.log('      ต้องเห็น "รับไลน์ · line-intake.gs": true');
    Logger.log('      ⚠️ วางโค้ดใหม่แล้วต้อง Deploy ด้วย ไม่งั้นตัวจับนี้ก็ไม่ทำงาน');
    Logger.log('   3) developers.line.biz → Messaging API → เปิด Use webhook');
    Logger.log('   4) manager.line.biz → การตั้งค่า → การตอบกลับ → เปิด Webhook');
    Logger.log('      ข้อ 4 คนลืมบ่อยที่สุด ปิดอยู่ = LINE ไม่ส่งมาเลย');
    Logger.log('\n   แก้แล้วพิมพ์อะไรก็ได้ในกลุ่ม จากนั้นรันฟังก์ชันนี้ใหม่');
    return;
  }
  Logger.log('✅ ขาเข้า: LINE ยิงมาถึงโค้ดแล้ว ล่าสุด ' + lastHit);

  if (!ids.length) {
    Logger.log('   (แต่ยังไม่มีต้นทางถูกจด — เป็น event ที่ไม่ใช่ข้อความ เช่น เข้า/ออกกลุ่ม)');
  } else {
    var allow = intakeProp_('INTAKE_ALLOW', '');
    ids.forEach(function (id) {
      var okSrc = !allow || allow.split(',').some(function (a) { return a.trim() === id; });
      Logger.log('     ' + (okSrc ? '✅' : '⛔') + ' ' + id + '   (ล่าสุด ' + seen[id] + ')' +
                 (okSrc ? '' : '  ← ไม่อยู่ใน INTAKE_ALLOW จึงถูกทิ้ง'));
    });
    if (allow) {
      Logger.log('   INTAKE_ALLOW = ' + allow);
      Logger.log('   ถ้ามี ⛔ ให้รัน clearIntakeAllow() หรือ allowIntakeSenders(\'' +
                 ids.join("', '") + '\')');
    }
  }

  // ── ขาออก ──
  var token = intakeProp_('LINE_CHANNEL_ACCESS_TOKEN', '');
  if (!token) {
    Logger.log('\n❌ ขาออก: ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN ในโปรเจกต์นี้');
    Logger.log('   นี่คือสาเหตุที่บอทเงียบ — อ่านได้ บันทึกลงชีตได้ แต่ตอบกลับไม่ได้');
    Logger.log('   ตั้งที่ ⚙️ การตั้งค่าโปรเจกต์ → คุณสมบัติสคริปต์');
    return;
  }

  var to = ids[ids.length - 1];
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({
      to: to,
      messages: [{ type: 'text', text: '🧪 ทดสอบจากสคริปต์ — เห็นข้อความนี้แปลว่าบอทส่งได้ปกติ' }]
    }),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() === 200) {
    Logger.log('\n✅ ขาออก: ส่งข้อความทดสอบไปที่ ' + to + ' แล้ว — ไปดูในไลน์');
    Logger.log('\nถ้าเห็นข้อความทดสอบในไลน์ แปลว่าทั้งสองขาใช้ได้');
    Logger.log('ที่บอทไม่ตอบตอนพิมพ์ อาจเป็นเพราะบรรทัดนั้นไม่เข้าเกณฑ์ในกลุ่ม');
    Logger.log('ลองพิมพ์ว่า  ซื้อ ค่าที่ 200  (มีคำว่า "ซื้อ" นำหน้า บังคับให้รับ)');
  } else {
    Logger.log('\n❌ ขาออก: ส่งไม่สำเร็จ (' + res.getResponseCode() + ')');
    Logger.log('   ' + res.getContentText());
    Logger.log('   401/403 = token ผิดหรือเป็นของ Channel อื่น');
  }
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
