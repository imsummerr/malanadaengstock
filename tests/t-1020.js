process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('20/10 — เบเกอรี่ไม่ได้นับทั้งวัน (นับแค่หลังขาย) ก็เตือนให้ลงย้อนหลัง');

const NOW = Date.now(), H = 3600000;
const at = h => new Date(NOW - h * H);
const FL = ['ไดฟุกุ ครีมนม', 'ไดฟุกุ ช็อกโกแลต', 'ไดฟุกุ ชาเขียว', 'ไดฟุกุ โอริโอ้', 'บราวนี่ นูเทลล่า', 'บราวนี่ โอริโอ้', 'ไดฟุกุ สตอเบอร์รี่', 'บราวนี่ อัลม่อนสไลซ์'];
const rowsOf = qs => FL.map((n, i) => ({ item: n, qty: qs[i] === undefined ? 0 : qs[i] }));
const staff = { role: 'staff', branch: SHOP, branches: [SHOP], name: 'ลลิตา' };
const fmt = (g, d, f) => g.Utilities.formatDate(d, 'Asia/Bangkok', f);

function setup(opts) {
  const g = fresh();
  g.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
  g.CASH_DAY_CUT_HOURS = (new Date(NOW).getHours() + 16) % 24;   // วันนี้เริ่ม 8 ชม.ก่อน · เมื่อวาน = 8–32 ชม.ก่อน
  g.BAKERY_START_DATE = '2000-01-01';
  g.checkToken_ = () => staff;
  // เมื่อวานซืน (40 ชม.ก่อน) นับหลังขายตามปกติ — เมื่อวานไม่ได้นับเบเกอรี่เลย
  const q0 = (opts && opts.empty) ? [0, 0, 0, 0, 0, 0, 0, 0] : [10, 20, 10, 10, 8, 8, 6, 6];
  FL.forEach((n, i) => push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(40), 'สาขา': SHOP, 'รายการ': n,
    'จำนวน': q0[i], 'ประเภท': g.KIND_BAKERY_COUNT, 'หมายเหตุ': 'หลังขาย · ยอดระบบ 0' }));
  // เมื่อวาน 25 ชม.ก่อน ส่งไดฟุกุครีมนมเพิ่ม 10 · ร้านเปิดขายหม่าล่า (มีบิล) 20 ชม.ก่อน
  if (!(opts && opts.empty)) push(g, g.SHEET_INCOMING, { 'วันที่เวลา': at(25), 'สาขา': SHOP, 'รายการ': 'ไดฟุกุ ครีมนม', 'จำนวน': 10, 'ประเภท': 'ของเข้าร้าน' });
  if (!(opts && opts.closed)) push(g, g.SHEET_ORDERS, { 'วันที่': fmt(g, at(20), 'yyyy-MM-dd'), 'เวลา': fmt(g, at(20), 'HH:mm:ss'), 'สาขา': SHOP,
    'ยอดรวม': 50, 'ส่วนลด': 0, 'ยอดสุทธิ': 50, 'วิธีชำระเงิน': 'เงินสด' });
  return g;
}

section('ร้านเปิด + มีเบเกอรี่ที่สาขา แต่ไม่ได้นับเลย → เตือน');
let g = setup();
const yday = g.cashBizDay_(NOW - 24 * H);
let L = g.lateStatus_(SHOP, NOW);
eq('ขึ้นเตือนนับหลังขายเบเกอรี่ของเมื่อวาน', L.bakery && L.bakery.day, yday);
eq('วันนี้ยังไม่ได้นับ → ต้องนับตอนนี้', L.bakery && L.bakery.counted, false);
eq('สรุปยอดเมื่อวานรอนับเบเกอรี่ด้วย', g.dayStatus_(SHOP, yday).need.indexOf('นับเบเกอรี่หลังขาย') !== -1, true);

section('ลงย้อนหลังได้ — เริ่มจากยอดในระบบตอนเริ่มวัน (นับล่าสุด + ของเข้า)');
// ยอดเริ่มเมื่อวาน 10+10, 20, 10, 10, 8, 8, 6, 6 = 88 · นับตอนนี้เหลือ 15, 15, 8, 8, 6, 6, 5, 5 = 68 → ขาย 20 = 200
let r = g.handleBakeryCount_({ token: 't', round: 'หลังขาย', forDay: yday, rows: rowsOf([15, 15, 8, 8, 6, 6, 5, 5]),
  money: { cash: 100, transfer: 100, thai: 0 }, id: 'Y1' });
eq('บันทึกได้', [r.success, r.message && /ไม่ได้นับก่อนขาย/.test(r.message)], [true, false]);
const bs = g.__env.SHEETS[g.SHEET_BAKERY], row = bs.rows.slice(-1)[0], c = h => row[bs.headers.indexOf(h)];
eq('เงินลงเป็นของเมื่อวาน · ขาย 20 ควรได้ 200 ตรง', [c('วันที่'), c('ขาย(ชิ้น)'), c('ควรได้'), c('ผลเทียบ')], [yday, 20, 200, 'ตรง']);
g.cacheClear_();
eq('ลงแล้วไม่เตือนอีก', g.lateStatus_(SHOP, NOW).bakery, null);
eq('สรุปยอดเมื่อวานไม่รอเบเกอรี่แล้ว', g.dayStatus_(SHOP, yday).need.indexOf('นับเบเกอรี่หลังขาย'), -1);

section('ไม่เตือนเกิน');
g = setup({ closed: true });
eq('ร้านไม่ได้เปิด (ไม่มีบิล) → ไม่เตือน', g.lateStatus_(SHOP, NOW).bakery, null);
g = setup({ empty: true });
eq('ไม่มีเบเกอรี่อยู่ที่สาขา → ไม่เตือน', g.lateStatus_(SHOP, NOW).bakery, null);
eq('สรุปยอดไม่รอเบเกอรี่', g.dayStatus_(SHOP, g.cashBizDay_(NOW - 24 * H)).need.indexOf('นับเบเกอรี่หลังขาย'), -1);
g = setup();
g.BAKERY_START_DATE = '2999-01-01';
eq('ก่อนวันเริ่มขายเบเกอรี่ → ไม่เตือน', g.lateStatus_(SHOP, NOW).bakery, null);

process.exit(done().fail ? 1 : 0);
