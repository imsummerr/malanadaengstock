process.env.TZ = 'Asia/Bangkok';
const { makeCheck, formatDate } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('23/10 — เช็คสต็อกหม่าล่ากรอกเดลิเวอรี่ได้ (วันที่ไม่ได้ใช้ POS)');

const NOW = Date.now(), H = 3600000;
const at = h => new Date(NOW - h * H);
const ymd = d => formatDate(d, '', 'yyyy-MM-dd');
const hms = d => formatDate(d, '', 'HH:mm:ss');

function setup(opts) {
  opts = opts || {};
  const g = fresh();
  g.CASH_DAY_CUT_HOURS = (new Date(NOW).getHours() + 16) % 24;   // วันนี้เริ่ม 8 ชม.ก่อน · เมื่อวาน = 8–32 ชม.ก่อน
  g.BAKERY_START_DATE = '2999-01-01';
  g.__env.SHEETS[g.SHEET_EXPENSE] = { headers: g.EXPENSE_HEADERS.slice(), rows: [] };
  g.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
  g.checkToken_ = () => ({ role: 'staff', branch: SHOP, branches: [SHOP], name: 'ลลิตา' });
  if (opts.late) {
    // นับฐานเมื่อวานก่อนขาย · เมื่อวานกด POS บิลเดียวแล้วเลิกใช้ ไม่ได้นับปิดร้าน · วันนี้ขายบิลแรกไปแล้ว
    push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(30), 'สาขา': SHOP, 'รายการ': 'ดอลลี่', 'จำนวน': 50, 'ประเภท': 'เช็คสต็อก' });
    [16, 1].forEach(h => push(g, g.SHEET_ORDERS, { 'วันที่': ymd(at(h)), 'เวลา': hms(at(h)), 'สาขา': SHOP,
      'ยอดรวม': 100, 'ส่วนลด': 0, 'ยอดสุทธิ': 100, 'รวมไม้': 10, 'วิธีชำระเงิน': 'เงินสด' }));
    g.expDoneMark_(SHOP, g.cashBizDay_(NOW - 24 * H), 'S.', 0, 0, 'x');
  } else {
    push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(6), 'สาขา': SHOP, 'รายการ': 'ดอลลี่', 'จำนวน': 50, 'ประเภท': 'เช็คสต็อก' });
    g.expDoneMark_(SHOP, g.cashBizDay_(NOW), 'S.', 0, 0, 'x');
  }
  return g;
}
const rows = g => g.countItemsAt_(SHOP).map(it => it.level ? { item: it.name, level: g.LEVELS[0] } : { item: it.name, packs: '', rem: 0, pieces: '' });
const said = (g, n) => g.__env.SENT.slice(n).map(x => x.messages.map(m => m.text).join('\n')).join('\n');
const D = g => g.__env.SHEETS[g.SHEET_DELIVERY];
const col = (g, h) => D(g).headers.indexOf(h);
const ORDER = { platform: 'Grab', amount: '150', items: [{ name: 'หม่าล่าหน้าแดง', qty: 1 }, { name: 'อุด้ง', qty: '2' }], addonCount: 1 };

section('ไม่ได้ใช้ POS — กรอกเงิน + เดลิเวอรี่ตอนนับ ลงชีตเดลิเวอรี่แบบเดียวกับ POS');
let g = setup();
let n0 = g.__env.SENT.length;
let r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), money: { cash: 500, transfer: 0, thai: 0 },
  delivery: [ORDER, { platform: 'ไม่มีแอปนี้', amount: '', items: [{ name: 'หม่าล่ารวม', qty: 1 }], addonCount: 0 },
             { platform: 'Grab', amount: '', items: [{ name: 'อุด้ง', qty: 0 }], addonCount: 0 }] });
eq('บันทึกได้ · นับครบทุกรายการ (เดลิเวอรี่ไม่ทับรายการนับ)', [r.success, r.counted], [true, rows(g).length]);
eq('ลง 2 ออเดอร์ (ออเดอร์ว่างข้ามไป)', D(g).rows.length, 2);
let x = D(g).rows[0];
eq('สาขา · คนลง · แอป · ยอดเงิน · รวมจำนวน · ของเพิ่ม',
   [x[col(g, 'สาขา')], x[col(g, 'พนักงาน')], x[col(g, 'แพลตฟอร์ม')], x[col(g, 'ยอดเงิน')], x[col(g, 'รวมจำนวน')], x[col(g, 'ของเพิ่ม')]],
   [SHOP, 'ลลิตา', 'Grab', 150, 3, 1]);
eq('รายการ/ข้อมูลเหมือนที่ POS ลง', [x[col(g, 'รายการ')], JSON.parse(x[col(g, 'ข้อมูล')])],
   ['หม่าล่าหน้าแดง x1 · อุด้ง x2 · ของเพิ่ม x1', [{ name: 'หม่าล่าหน้าแดง', qty: 1 }, { name: 'อุด้ง', qty: 2 }]]);
eq('ลงวันนี้ เวลาตอนนับ · เลขออเดอร์ D', [x[col(g, 'วันที่')], /^D/.test(x[col(g, 'เลขที่ออเดอร์')])], [ymd(new Date()), true]);
eq('แอปที่ไม่รู้จัก = อื่น ๆ · ไม่ใส่ยอดเงิน = ว่าง', [D(g).rows[1][col(g, 'แพลตฟอร์ม')], D(g).rows[1][col(g, 'ยอดเงิน')]], ['อื่น ๆ', '']);
let t = said(g, n0);
eq('ข้อความนับบอกว่าลงเดลิเวอรี่', /🛵 ลงเดลิเวอรี่ 2 ออเดอร์/.test(t), true);
eq('สรุปยอดบอกจำนวนออเดอร์เดลิเวอรี่ (ไม่รวมในเงินหน้าร้าน)', /เดลิเวอรี่ 2 ออเดอร์ — ไม่รวมในยอดนี้/.test(t), true);
g.cacheClear_();
const inc = g.costIncome_()[SHOP];
eq('รายได้: หน้าร้าน 500 · เดลิเวอรี่ 150 + หม่าล่ารวมตามราคาเมนู', [inc['หน้าร้าน'], inc['เดลิเวอรี่'] >= 150], [500, true]);

section('ลงย้อนหลังของเมื่อวาน — เดลิเวอรี่ลงเป็นของเมื่อวาน');
g = setup({ late: true });
const yday = g.cashBizDay_(NOW - 24 * H);
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), forDay: yday, money: { cash: 350, transfer: 0, thai: 0 }, delivery: [ORDER] });
eq('บันทึกได้', [r.success, r.message], [true, undefined]);
x = D(g).rows[0];
const when = new Date(x[col(g, 'วันที่')] + 'T' + x[col(g, 'เวลา')] + '+07:00').getTime();
eq('เวลาในแถว = ท้ายวันเมื่อวาน (ไม่ใช่ตอนนี้)', [g.cashBizDay_(when), when < at(7.9).getTime()], [yday, true]);
g.cacheClear_();
eq('เมื่อวานนับว่ามีเดลิเวอรี่ 1 ออเดอร์', /เดลิเวอรี่ 1 ออเดอร์/.test(g.daySummaryText_(SHOP, yday)), true);

section('กันผิด');
g = setup();
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), delivery: [{ platform: 'Grab', amount: 120, items: [], addonCount: 0 }] });
eq('ใส่ยอดเงินแต่ไม่ใส่จำนวน = ไม่รับ · ไม่ลงอะไรเลย',
   [r.success, /ออเดอร์ที่ 1 ยังไม่ได้ใส่จำนวน/.test(r.message), D(g).rows.length, g.__env.SHEETS[g.SHEET_COUNT].rows.length], [false, true, 0, 1]);
g.checkToken_ = () => ({ role: 'owner', branch: '', branches: [], name: 'เจ้าของ' });
r = g.handleStockCount_({ token: 't', location: g.CENTRAL, rows: g.countItemsAt_(g.CENTRAL).map(it => g.levelAt_(it, g.CENTRAL) ? { item: it.name, level: g.LEVELS[0] } : { item: it.name, packs: '', rem: 0, pieces: '' }),
  delivery: [ORDER] });
eq('ครัวกลาง นับได้แต่ไม่ลงเดลิเวอรี่', [r.success, D(g).rows.length], [true, 0]);
g = setup();
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g) });
eq('ไม่กรอก = ไม่มีแถวเดลิเวอรี่', [r.success, D(g).rows.length], [true, 0]);

process.exit(done().fail ? 1 : 0);
