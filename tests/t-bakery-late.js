process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('เบเกอรี่ — ลืมนับหลังขายเมื่อวาน ลงย้อนหลัง');

const NOW = Date.now(), H = 3600000;
const at = h => new Date(NOW - h * H);
const FL = ['ไดฟุกุ ครีมนม', 'ไดฟุกุ ช็อกโกแลต', 'ไดฟุกุ ชาเขียว', 'ไดฟุกุ โอริโอ้', 'บราวนี่ นูเทลล่า', 'บราวนี่ โอริโอ้', 'ไดฟุกุ สตอเบอร์รี่'];
const rowsOf = qs => FL.map((n, i) => ({ item: n, qty: qs[i] === undefined ? 0 : qs[i] }));
const staff = { role: 'staff', branch: SHOP, branches: [SHOP], name: 'ลลิตา' };

function setup() {
  const g = fresh();
  g.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
  g.CASH_DAY_CUT_HOURS = (new Date(NOW).getHours() + 16) % 24;   // วันนี้เริ่ม 8 ชม.ก่อน · เมื่อวาน = 8–32 ชม.ก่อน
  g.BAKERY_START_DATE = '2000-01-01';
  g.checkToken_ = () => staff;
  // เมื่อวาน 20 ชม.ก่อน นับก่อนขาย (แบบข้อมูลจริง 11/10) · 19 ชม.ก่อน ส่งบราวนี่นูเทลล่าเพิ่ม 10
  FL.forEach((n, i) => push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(20), 'สาขา': SHOP, 'รายการ': n,
    'จำนวน': [27, 58, 26, 22, 14, 15][i], 'ประเภท': g.KIND_BAKERY_COUNT, 'หมายเหตุ': 'ก่อนขาย · ยอดระบบ 0' }));
  push(g, g.SHEET_INCOMING, { 'วันที่เวลา': at(19), 'สาขา': SHOP, 'รายการ': 'บราวนี่ นูเทลล่า', 'จำนวน': 10, 'ประเภท': 'ของเข้าร้าน' });
  return g;
}
const money = g => g.__env.SHEETS[g.SHEET_BAKERY].rows;
const col = (g, h) => g.__env.SHEETS[g.SHEET_BAKERY].headers.indexOf(h);

section('วันนี้ยังไม่ได้นับ → นับตอนนี้ (ก่อนเริ่มขาย) + เงินของเมื่อวาน');
let g = setup();
const yday = g.cashBizDay_(NOW - 24 * H);
const cBefore = g.__env.SHEETS[g.SHEET_COUNT].rows.length;
// ขายไป 7+18+6+7+14+10 = 62 ชิ้น = 620
let r = g.handleBakeryCount_({ token: 't', round: 'หลังขาย', forDay: yday, rows: rowsOf([20, 40, 20, 15, 10, 5]),
  money: { cash: 200, transfer: 120, thai: 300 }, id: 'L1' });
eq('บันทึกได้', r.success, true);
eq('บอกว่าเป็นก่อนขายวันนี้ด้วย', /ก่อนขายของวันนี้ด้วย/.test(r.message), true);
let row = money(g).slice(-1)[0];
eq('เงินลงเป็นวันเมื่อวาน 23:59:59', [row[col(g, 'วันที่')], row[col(g, 'เวลา')]], [yday, '23:59:59']);
eq('ขาย 62 ชิ้น ควรได้ 620 ตรง', [row[col(g, 'ขาย(ชิ้น)')], row[col(g, 'ควรได้')], row[col(g, 'ผลเทียบ')]], [62, 620, 'ตรง']);
eq('รายละเอียดบอกว่าลงย้อนหลัง', /ลงย้อนหลัง/.test(row[col(g, 'รายละเอียด')]), true);
const cs = g.__env.SHEETS[g.SHEET_COUNT];
eq('ลงยอดนับครบทุกรส เป็นก่อนขายของวันนี้', cs.rows.slice(cBefore).map(x => x[cs.headers.indexOf('หมายเหตุ')].split(' · ')[0]),
   new Array(FL.length).fill('ก่อนขาย'));
eq('แจ้งไลน์บอกลงย้อนหลัง', /ลงย้อนหลัง ของวันที่/.test(g.__env.SENT.map(x => x.messages[0].text).join('\n')), true);

// คืนนี้นับหลังขายตามปกติ — ตั้งต้นจากยอดเช้านี้ (ที่ลงย้อนหลังไว้) ขาย 5+10+2+5+2+3 = 27
g.cacheClear_();
r = g.handleBakeryCount_({ token: 't', round: 'หลังขาย', rows: rowsOf([15, 30, 18, 10, 8, 2]),
  money: { cash: 270, transfer: 0, thai: 0 }, id: 'N1' });
row = money(g).slice(-1)[0];
eq('หลังขายวันนี้ ขาย 27 ตรง', [row[col(g, 'ขาย(ชิ้น)')], row[col(g, 'ผลเทียบ')]], [27, 'ตรง']);
g.cacheClear_();
eq('รายได้เบเกอรี่ครบทั้งสองวัน 620 + 270', g.bakeryIncome_()[SHOP]['รวม'], 890);

section('เช้านี้นับก่อนขายไปแล้ว → ไม่ต้องนับ กรอกแค่เงิน');
g = setup();
FL.forEach((n, i) => push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(2), 'สาขา': SHOP, 'รายการ': n,
  'จำนวน': [20, 40, 20, 15, 10, 5][i], 'ประเภท': g.KIND_BAKERY_COUNT, 'หมายเหตุ': 'ก่อนขาย · ยอดระบบ 0' }));
const n0 = g.__env.SHEETS[g.SHEET_COUNT].rows.length;
r = g.handleBakeryCount_({ token: 't', round: 'หลังขาย', forDay: yday, rows: [],
  money: { cash: 600, transfer: 0, thai: 0 }, id: 'L2' });
row = money(g).slice(-1)[0];
eq('ใช้ยอดก่อนขายเช้านี้ ขาย 62 · ขาด 20', [r.success, row[col(g, 'ขาย(ชิ้น)')], row[col(g, 'ต่าง')], row[col(g, 'ผลเทียบ')]], [true, 62, -20, 'ขาด']);
eq('ไม่ลงยอดนับซ้ำ', g.__env.SHEETS[g.SHEET_COUNT].rows.length, n0);

section('กันลงผิด');
g = setup();
eq('วันนี้ไม่ใช่ย้อนหลัง', /วันก่อนหน้า/.test(g.handleBakeryCount_({ token: 't', round: 'หลังขาย', forDay: g.cashBizDay_(NOW),
  rows: rowsOf([1, 1, 1, 1, 1, 1]), money: { cash: 0, transfer: 0, thai: 0 } }).message), true);
eq('วันที่ไม่ได้นับก่อนขาย ลงไม่ได้', /ไม่ได้นับก่อนขาย/.test(g.handleBakeryCount_({ token: 't', round: 'หลังขาย',
  forDay: g.cashBizDay_(NOW - 48 * H), rows: rowsOf([1, 1, 1, 1, 1, 1]), money: { cash: 0, transfer: 0, thai: 0 } }).message), true);
eq('วันนี้ยังไม่นับ แล้วปล่อยว่าง = ต้องนับก่อน', /วันนี้ยังไม่ได้นับ/.test(g.handleBakeryCount_({ token: 't', round: 'หลังขาย',
  forDay: yday, rows: [], money: { cash: 0, transfer: 0, thai: 0 } }).message), true);
eq('หลังขายปกติยังต้องนับครบ', /ต้องนับให้ครบ/.test(g.handleBakeryCount_({ token: 't', round: 'หลังขาย',
  rows: [], money: { cash: 0, transfer: 0, thai: 0 } }).message), true);

process.exit(done().fail ? 1 : 0);
