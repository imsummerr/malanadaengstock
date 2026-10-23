process.env.TZ = 'Asia/Bangkok';
const { makeCheck, formatDate } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('23/10 — เช็คสต็อกหม่าล่ากรอกเงินได้ (วันที่ไม่ได้ใช้ POS)');

const NOW = Date.now(), H = 3600000;
const at = h => new Date(NOW - h * H);
const ymd = d => formatDate(d, '', 'yyyy-MM-dd');
const hms = d => formatDate(d, '', 'HH:mm:ss');

function setup(opts) {
  opts = opts || {};
  const g = fresh();
  g.CASH_DAY_CUT_HOURS = (new Date(NOW).getHours() + 16) % 24;   // วันนี้เริ่ม 8 ชม.ก่อน
  g.BAKERY_START_DATE = '2999-01-01';
  g.__env.SHEETS[g.SHEET_EXPENSE] = { headers: g.EXPENSE_HEADERS.slice(), rows: [] };
  g.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
  g.checkToken_ = () => ({ role: 'staff', branch: SHOP, branches: [SHOP], name: 'ลลิตา' });
  // นับฐานเช้านี้ (ดอลลี่ 50 ไม้) · ไม่ได้ใช้ POS ทั้งวัน (หรือใช้บางบิล)
  push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(6), 'สาขา': SHOP, 'รายการ': 'ดอลลี่', 'จำนวน': 50, 'ประเภท': 'เช็คสต็อก' });
  if (opts.bill) push(g, g.SHEET_ORDERS, { 'วันที่': ymd(at(3)), 'เวลา': hms(at(3)), 'สาขา': SHOP,
    'ยอดรวม': 100, 'ส่วนลด': 0, 'ยอดสุทธิ': 100, 'รวมไม้': 10, 'วิธีชำระเงิน': 'เงินสด' });
  if (opts.exp) push(g, g.SHEET_EXPENSE, { 'วันที่': ymd(at(2)), 'เวลา': hms(at(2)), 'สาขา': SHOP, 'ประเภท': 'ค่าน้ำแข็ง',
    'จำนวนเงิน': 20, 'วิธีจ่าย': 'เงินสด', 'ธุรกิจ': 'หม่าล่า' });
  g.expDoneMark_(SHOP, g.cashBizDay_(NOW), 'S.', 0, 0, 'x');
  return g;
}
// ปิดร้าน: ดอลลี่เหลือ 0 → ขายไป 50 ไม้ = 500 บาท
const rows = g => g.countItemsAt_(SHOP).map(it => it.level ? { item: it.name, level: g.LEVELS[0] } : { item: it.name, packs: '', rem: 0, pieces: '' });
const said = (g, n) => g.__env.SENT.slice(n).map(x => x.messages.map(m => m.text).join('\n')).join('\n');

section('ไม่ได้ใช้ POS ทั้งวัน — กรอกเงินตอนนับ ได้สรุปยอดเทียบของที่ออก');
let g = setup();
const today = g.cashBizDay_(NOW);
let n0 = g.__env.SENT.length;
let r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), money: { cash: '300', transfer: '200', thai: '' } });
eq('บันทึกได้', r.success, true);
const M = g.__env.SHEETS[g.SHEET_MALA_MONEY];
eq('ลงชีตเงินขายหม่าล่า วันนี้ 300/200/0 รวม 500', M && M.rows.slice(-1)[0].slice(0, 8).filter((x, i) => [0, 2, 4, 5, 6, 7].includes(i)), [today, SHOP, 300, 200, 0, 500]);
g.cacheClear_();
eq('วันนี้นับว่าหม่าล่าขาย (ไม่มีบิล)', g.dayStatus_(SHOP, today).malaSold, true);
let t = said(g, n0);
eq('ข้อความนับบอกว่ากรอกเงินแล้ว', /กรอกเงินที่ได้ของวันที่/.test(t), true);
eq('สรุปยอด: ควรได้ 500 · ได้จริง (กรอกตอนเช็คสต็อก) 500 · ตรงกัน',
   [/ควรได้ \(ตามของที่ขายออกไป\) 500/.test(t), /ได้จริง \(กรอกตอนเช็คสต็อก\) 500/.test(t), /→ ตรงกัน/.test(t)], [true, true, true]);
eq('รายได้หน้าร้านในบัญชี = 500', g.costIncome_()[SHOP]['หน้าร้าน'], 500);
eq('ของหายหม่าล่า 0 (ได้ครบตามของที่ออก)', g.missingGoods_(SHOP, 'หม่าล่า')['บาท'], 0);

section('ใช้ POS บางบิล + จ่ายค่าน้ำแข็งเงินสด — ใช้ยอดที่กรอกแทน POS · บวกค่าใช้จ่ายกลับ');
g = setup({ bill: true, exp: true });
n0 = g.__env.SENT.length;
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), money: { cash: 280, transfer: 200, thai: 0 } });
g.cacheClear_();
t = said(g, n0);
eq('ได้จริง 480 + ค่าน้ำแข็ง 20 = 500 ตรง · บอกยอด POS ไว้ให้ดู',
   [/ได้จริง \(กรอกตอนเช็คสต็อก\) 500/.test(t), /จ่ายค่าใช้จ่ายเงินสดจากเงินขาย 20/.test(t), /ใน POS กดไว้ 1 บิล 100/.test(t), /→ ตรงกัน/.test(t)],
   [true, true, true, true]);
eq('รายได้ = 500 (ไม่นับบิล POS 100 ซ้ำ)', g.costIncome_()[SHOP]['หน้าร้าน'], 500);

section('ขาด / ไม่กรอก / กันผิด');
g = setup();
n0 = g.__env.SENT.length;
g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), money: { cash: 300, transfer: 100, thai: 0 } });
eq('ได้ 400 ควรได้ 500 → ขาด 100', /🔻 ขาด 100/.test(said(g, n0)), true);
g = setup({ bill: true });
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g) });
g.cacheClear_();
eq('ไม่กรอกเงิน = ใช้ POS ตามเดิม (ไม่มีแถวเงินขาย)', [r.success, (g.__env.SHEETS[g.SHEET_MALA_MONEY] || { rows: [] }).rows.length, g.costIncome_()[SHOP]['หน้าร้าน']], [true, 0, 100]);
g = setup();
eq('ตัวเลขติดลบไม่รับ', g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), money: { cash: -5 } }).success, false);

process.exit(done().fail ? 1 : 0);
