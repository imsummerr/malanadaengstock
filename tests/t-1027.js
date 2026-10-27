process.env.TZ = 'Asia/Bangkok';
const { makeCheck, formatDate } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('27/10 — วันที่ไม่ได้ใช้ POS เบเกอรี่ก็ลงย้อนหลังได้ (กรอกเงินอย่างเดียว รวมไปเทียบกับรอบนับถัดไป)');

// วันนี้เริ่ม 8 ชม.ก่อน · D1 (เมื่อวาน) = 8–32 · D2 = 32–56 · D3 = 56–80 · D4 = 80–104 ชม.ก่อน
const NOW = Date.now(), H = 3600000;
const at = h => new Date(NOW - h * H);
const ymd = d => formatDate(d, '', 'yyyy-MM-dd');
const hms = d => formatDate(d, '', 'HH:mm:ss');
const staff = { role: 'staff', branch: SHOP, branches: [SHOP], name: 'ลลิตา' };

// เหมือนข้อมูลจริง 23–27/10: D4 ขาย นับหม่าล่า + นับเบเกอรี่หลังขาย (ครีมนมเหลือ 30) · D3 D2 D1 ไม่มีบิล ไม่ได้นับ · วันนี้ยังไม่ขาย
function setup() {
  const g = fresh();
  g.CASH_DAY_CUT_HOURS = (new Date(NOW).getHours() + 16) % 24;
  g.BAKERY_START_DATE = '2000-01-01';
  g.MALA_LATE_FROM = '2000-01-01';
  g.__env.SHEETS[g.SHEET_EXPENSE] = { headers: g.EXPENSE_HEADERS.slice(), rows: [] };
  g.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
  g.checkToken_ = () => staff;
  push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(100), 'สาขา': SHOP, 'รายการ': 'ดอลลี่', 'จำนวน': 60, 'ประเภท': 'เช็คสต็อก' });
  push(g, g.SHEET_ORDERS, { 'วันที่': ymd(at(90)), 'เวลา': hms(at(90)), 'สาขา': SHOP,
    'ยอดรวม': 100, 'ส่วนลด': 0, 'ยอดสุทธิ': 100, 'รวมไม้': 10, 'วิธีชำระเงิน': 'เงินสด' });
  push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(82), 'สาขา': SHOP, 'รายการ': 'ดอลลี่', 'จำนวน': 50, 'ประเภท': 'เช็คสต็อก' });
  g.BAKERY_ITEMS.forEach(b => push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(82), 'สาขา': SHOP, 'รายการ': b[0],
    'จำนวน': b[0] === 'ไดฟุกุ ครีมนม' ? 30 : 0, 'ประเภท': g.KIND_BAKERY_COUNT, 'หมายเหตุ': 'หลังขาย · ยอดระบบ 0' }));
  g.bakerySheet_().appendRow([ymd(at(82)), hms(at(82)), SHOP, 'ลลิตา', 100, 0, 0, 100, 10, 100, 0, 'ตรง', 'x', 'BK0', '']);
  [3, 2, 1].forEach(k => g.expDoneMark_(SHOP, day(g, 24 * k - 4), 'S.', 0, 0, 'x'));
  return g;
}
const day = (g, h) => g.cashBizDay_(NOW - h * H);
const dm = d => Number(d.slice(8, 10)) + '/' + Number(d.slice(5, 7));
const late = g => { g.cacheClear_(); return g.lateStatus_(SHOP, NOW); };
const bview = g => (late(g).bakeryDays || []).map(b => dm(b.day) + (b.into ? ' → ' + dm(b.into) : ' ลงได้'));
const said = (g, n) => g.__env.SENT.slice(n).map(x => x.messages.map(m => m.text).join('\n')).join('\n');
const bkRows = g => g.__env.SHEETS[g.SHEET_BAKERY].rows;
const bcol = (g, h) => g.__env.SHEETS[g.SHEET_BAKERY].headers.indexOf(h);
// หลังขายของ D1 (นับตอนนี้ ก่อนขายวันนี้): ครีมนมเหลือ 3 → ขายไป 27 ลูก = 270
const after = (g, cash) => g.handleBakeryCount_({ token: 't', round: 'หลังขาย', forDay: day(g, 20),
  rows: g.BAKERY_ITEMS.map(b => ({ item: b[0], qty: b[0] === 'ไดฟุกุ ครีมนม' ? 3 : 0 })),
  money: { cash, transfer: 0, thai: 0 }, id: 'B' + cash });

section('วันที่ไม่มีบิล — เบเกอรี่ขึ้นด้วย');
let g = setup();
const d3 = day(g, 68), d2 = day(g, 44), d1 = day(g, 20);
eq('หม่าล่าถาม D3 D2 D1', (late(g).malaDays || []).map(x => dm(x.day) + (x.sold ? '' : ' ไม่มีบิล')), [dm(d3) + ' ไม่มีบิล', dm(d2) + ' ไม่มีบิล', dm(d1) + ' ไม่มีบิล']);
eq('เบเกอรี่: D3 D2 รวมไปที่ D1 (บอกวันสุดท้ายเลย) · D1 ลงได้', bview(g), [dm(d3) + ' → ' + dm(d1), dm(d2) + ' → ' + dm(d1), dm(d1) + ' ลงได้']);
g.handleShopClosed_({ token: 't', location: SHOP, day: d2 });
eq('กดหยุดร้าน D2 → เบเกอรี่ไม่ถาม D2', bview(g), [dm(d3) + ' → ' + dm(d1), dm(d1) + ' ลงได้']);

section('ขาย — กรอกเงิน (หม่าล่า + เบเกอรี่) ของวันที่นับไม่ได้แล้ว');
g = setup();
let n0 = g.__env.SENT.length;
let r = g.handleMalaLateMoney_({ token: 't', location: SHOP, day: d3, money: { cash: 200 }, bakery: { cash: 100, transfer: 50 } });
eq('บันทึกได้', r.success, true);
let x = bkRows(g).slice(-1)[0];
eq('แถวเบเกอรี่ของ D3 "รอนับ" ไม่มีจำนวนขาย', [x[0], x[4], x[5], x[7], x[bcol(g, 'ขาย(ชิ้น)')], x[bcol(g, 'ผลเทียบ')]], [d3, 100, 50, 150, '', 'รอนับ']);
eq('แจ้งกลุ่มว่าลงทั้งหม่าล่าและเบเกอรี่', /ลงเงินขายย้อนหลัง[\s\S]*🌶️ หม่าล่า · 🍡 เบเกอรี่/.test(said(g, n0)), true);
eq('เบเกอรี่ไม่ถาม D3 แล้ว', bview(g), [dm(d2) + ' → ' + dm(d1), dm(d1) + ' ลงได้']);
r = g.handleMalaLateMoney_({ token: 't', location: SHOP, day: d2, bakery: { cash: 80 } });
eq('เบเกอรี่อย่างเดียวก็ได้ (หม่าล่า D2 ยังถามอยู่)', [r.success, (late(g).malaDays || []).some(m => m.day === d2 && !m.sold)], [true, true]);
eq('ลงซ้ำไม่ได้', g.handleMalaLateMoney_({ token: 't', location: SHOP, day: d2, bakery: { cash: 1 } }).success, false);
eq('วันที่นับแล้ว (D4) ลงไม่ได้', g.handleMalaLateMoney_({ token: 't', location: SHOP, day: day(g, 92), bakery: { cash: 1 } }).success, false);
eq('สรุป D3 บอกว่าเบเกอรี่ลงเงินไว้ รวมไปเทียบรอบถัดไป',
   new RegExp('เบเกอรี่ — ไม่ได้นับหลังขายวันที่ ' + dm(d3) + ' · ลงเงินไว้ 150').test(g.daySummaryText_(SHOP, d3)), true);

section('นับหลังขายของ D1 — เงินของ D3 D2 ที่ลงไว้รวมมาเทียบ');
n0 = g.__env.SENT.length;
r = after(g, 40);
eq('บันทึกได้', r.success, true);
x = bkRows(g).slice(-1)[0];
eq('แถว D1: ขาย 27 ควรได้ 270 · เงิน 40 + ลงไว้ 230 = ตรง', [x[0], x[bcol(g, 'ขาย(ชิ้น)')], x[bcol(g, 'ควรได้')], x[bcol(g, 'ต่าง')], x[bcol(g, 'ผลเทียบ')]],
   [d1, 27, 270, 0, 'ตรง']);
let t = said(g, n0);
eq('ไลน์บอกว่ารวมวันที่ลงเงินไว้', new RegExp('รวมของวันที่ ' + dm(d3) + ', ' + dm(d2) + ' ที่ลงเงินไว้แต่ไม่ได้นับ').test(t), true);
eq('สรุป D1: ได้จริง 270 แยกรายวัน → ตรงกัน',
   [/ได้จริง 270 บาท/.test(t), new RegExp('• ' + dm(d3) + ' \\(ลงไว้ ไม่ได้นับ\\) 150').test(t), new RegExp('• ' + dm(d1) + ' 40').test(t), /🍡 เบเกอรี่ ✅/.test(t)],
   [true, true, true, true]);
eq('เบเกอรี่ไม่ค้างแล้ว', bview(g), []);

section('นับหลังขายไปก่อน แล้วค่อยลงเงินวันก่อนหน้า — สรุปรอบนั้นใหม่');
g = setup();
after(g, 40);
eq('ยังขาด (ยังไม่ได้ลงเงิน D3 D2)', bkRows(g).slice(-1)[0][bcol(g, 'ผลเทียบ')], 'ขาด');
eq('D3 D2 รวมไปที่ D1 · ลงเงินแยกได้', bview(g), [dm(d3) + ' → ' + dm(d1), dm(d2) + ' → ' + dm(d1)]);
g.handleMalaLateMoney_({ token: 't', location: SHOP, day: d3, bakery: { cash: 150 } });
n0 = g.__env.SENT.length;
r = g.handleMalaLateMoney_({ token: 't', location: SHOP, day: d2, bakery: { cash: 80 } });
t = said(g, n0);
eq('ส่งสรุป D1 ใหม่ — ตรงแล้ว', [r.success, new RegExp('🔄 อัปเดต — 📊 สรุปยอด ' + SHOP + ' วันที่ ' + dm(d1)).test(t), /🍡 เบเกอรี่ ✅/.test(t)], [true, true, true]);
eq('เบเกอรี่ไม่ค้างแล้ว', bview(g), []);

process.exit(done().fail ? 1 : 0);
