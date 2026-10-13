process.env.TZ = 'Asia/Bangkok';
const { makeCheck, formatDate } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('ลืมนับ/ลืมกรอกเมื่อวาน → ขึ้นเตือน (หม่าล่า + เบเกอรี่)');

const NOW = Date.now(), H = 3600000;
const at = h => new Date(NOW - h * H);
const ymd = d => formatDate(d, '', 'yyyy-MM-dd');
const hms = d => formatDate(d, '', 'HH:mm:ss');
const FL = ['ไดฟุกุ ครีมนม', 'ไดฟุกุ ช็อกโกแลต', 'ไดฟุกุ ชาเขียว', 'ไดฟุกุ โอริโอ้', 'บราวนี่ นูเทลล่า', 'บราวนี่ โอริโอ้'];

function setup() {
  const g = fresh();
  g.CASH_DAY_CUT_HOURS = (new Date(NOW).getHours() + 16) % 24;   // วันนี้เริ่ม 8 ชม.ก่อน · เมื่อวาน = 8–32 ชม.ก่อน
  g.BAKERY_START_DATE = '2000-01-01';
  const S = g.__env.SHEETS;
  S[g.SHEET_EXPENSE] = { headers: g.EXPENSE_HEADERS.slice(), rows: [] };
  // รอบนับฐานเมื่อวานเช้า · ขายเมื่อวาน 2 บิล (บิลสุดท้าย 14 ชม.ก่อน)
  push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(30), 'สาขา': SHOP, 'รายการ': 'ดอลลี่', 'จำนวน': 20, 'ประเภท': 'เช็คสต็อก' });
  [16, 14].forEach(h => push(g, g.SHEET_ORDERS, { 'วันที่': ymd(at(h)), 'เวลา': hms(at(h)), 'สาขา': SHOP,
    'ยอดรวม': 100, 'ส่วนลด': 0, 'ยอดสุทธิ': 100, 'รวมไม้': 10, 'วิธีชำระเงิน': 'เงินสด' }));
  return g;
}
const st = g => { g.cacheClear_(); return g.lateStatus_(SHOP, NOW); };

section('หม่าล่า: เมื่อวานขายแล้วไม่ได้นับปิดร้าน ไม่ได้กรอกเงิน');
let g = setup();
const yday = g.cashBizDay_(NOW - 24 * H);
let s = st(g);
eq('เตือนทั้งนับและเงิน ของเมื่อวาน', s.mala && [s.mala.day, s.mala.count, s.mala.cash], [yday, true, true]);
// เช้านี้นับสต็อก (ก่อนบิลแรก) = ปิดร้านเมื่อวาน
push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(1), 'สาขา': SHOP, 'รายการ': 'ดอลลี่', 'จำนวน': 2, 'ประเภท': 'เช็คสต็อก' });
s = st(g);
// 13/10: เงินสดคงเหลือแจ้งในไลน์ ไม่ใช่งานพนักงาน — นับแล้วไม่เตือนต่อ
eq('นับแล้ว ไม่เตือน (เงินไม่ต้องกรอกหน้า POS)', s.mala, null);

section('หม่าล่า: ขายบิลแรกของวันนี้แล้ว = สายไป ไม่เตือน');
g = setup();
push(g, g.SHEET_ORDERS, { 'วันที่': ymd(at(1)), 'เวลา': hms(at(1)), 'สาขา': SHOP, 'ยอดรวม': 50, 'ส่วนลด': 0,
  'ยอดสุทธิ': 50, 'รวมไม้': 5, 'วิธีชำระเงิน': 'เงินสด' });
eq('ไม่เตือนหม่าล่า', st(g).mala, null);

section('หม่าล่า: เมื่อวานนับปิดร้าน + กรอกเงินครบ ไม่เตือน');
g = setup();
push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(13), 'สาขา': SHOP, 'รายการ': 'ดอลลี่', 'จำนวน': 2, 'ประเภท': 'เช็คสต็อก' });
g.__env.SHEETS[g.SHEET_CASH] = g.__env.SHEETS[g.SHEET_CASH] || { headers: g.CASH_HEADERS.slice(), rows: [] };
push(g, g.SHEET_CASH, { 'วันที่': ymd(at(13)), 'เวลา': hms(at(13)), 'สาขา': SHOP, 'พนักงาน': 'พนง.', 'เงินสดที่นับได้': 200 });
eq('ไม่เตือน', st(g).mala, null);

section('เบเกอรี่: เมื่อวานนับก่อนขาย ไม่ได้นับหลังขาย');
g = setup();
FL.forEach(n => push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(20), 'สาขา': SHOP, 'รายการ': n, 'จำนวน': 10,
  'ประเภท': g.KIND_BAKERY_COUNT, 'หมายเหตุ': 'ก่อนขาย · ยอดระบบ 10' }));
s = st(g);
eq('เตือนเบเกอรี่ ยังไม่ได้นับวันนี้', s.bakery && [s.bakery.day, s.bakery.counted], [yday, false]);
FL.forEach(n => push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(1), 'สาขา': SHOP, 'รายการ': n, 'จำนวน': 6,
  'ประเภท': g.KIND_BAKERY_COUNT, 'หมายเหตุ': 'ก่อนขาย · ยอดระบบ 10' }));
eq('เช้านี้นับเบเกอรี่แล้ว → counted', st(g).bakery.counted, true);
g.checkToken_ = () => ({ role: 'staff', branch: SHOP, branches: [SHOP], name: 'พนง.' });
g.handleBakeryCount_({ token: 't', round: 'หลังขาย', forDay: yday, rows: [], money: { cash: 240, transfer: 0, thai: 0 }, id: 'B1' });
eq('ลงย้อนหลังแล้ว ไม่เตือน', st(g).bakery, null);

section('หน้าเว็บ/POS ได้รับ');
g = setup();
g.checkToken_ = () => ({ role: 'staff', branch: SHOP, branches: [SHOP], name: 'พนง.' });
eq('POS ถาม lateStatus', g.handleLateStatus_({ token: 't' }).data.mala.cash, true);
const boot = g.handleStockBootstrap_({ token: 't' }).data;
eq('หน้าสต็อกได้ late ของสาขา', boot.late[SHOP].mala.count, true);
eq('ไม่มีตัวเลขเงิน/ยอดขาย', Object.keys(boot.late[SHOP].mala).sort(), ['cash', 'count', 'day', 'dm', 'today']);
eq('เตือนแจ้งค่าใช้จ่ายของวันขายก่อน (ไม่มีตัวเลข)', Object.keys(boot.late[SHOP].exp || {}).sort(), ['day', 'dm']);

process.exit(done().fail ? 1 : 0);
