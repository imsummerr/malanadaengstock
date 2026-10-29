process.env.TZ = 'Asia/Bangkok';
const { makeCheck, formatDate } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('29/10 — เช็คสต็อกกรอกแถมน้ำจิ้มได้ (วันที่ไม่ได้ใช้ POS) · สรุปบอกน้ำจิ้มใช้ไป/แถมไป');

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
  // นับฐานเช้านี้: ดอลลี่ 50 ไม้ · น้ำจิ้มงา 10 กระปุก
  push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(6), 'สาขา': SHOP, 'รายการ': 'ดอลลี่', 'จำนวน': 50, 'ประเภท': 'เช็คสต็อก' });
  push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(6), 'สาขา': SHOP, 'รายการ': 'น้ำจิ้มงา (กระปุก)', 'จำนวน': 10, 'ประเภท': 'เช็คสต็อก' });
  if (opts.bill) push(g, g.SHEET_ORDERS, { 'วันที่': ymd(at(3)), 'เวลา': hms(at(3)), 'สาขา': SHOP,
    'ยอดรวม': 500, 'ส่วนลด': 0, 'ยอดสุทธิ': 500, 'รวมไม้': 50, 'วิธีชำระเงิน': 'เงินสด', 'น้ำจิ้ม': 'น้ำจิ้มงา', 'จำนวนน้ำจิ้ม': 4 });
  g.expDoneMark_(SHOP, g.cashBizDay_(NOW), 'S.', 0, 0, 'x');
  return g;
}
// ปิดร้าน: ดอลลี่เหลือ 0 (ขาย 50 ไม้ = 500) · น้ำจิ้มงาเหลือ 4 (ใช้ไป 6)
const rows = g => g.countItemsAt_(SHOP).map(it => it.level ? { item: it.name, level: g.LEVELS[0] }
  : { item: it.name, packs: '', rem: it.name === 'น้ำจิ้มงา (กระปุก)' ? 4 : 0, pieces: '' });
const said = (g, n) => g.__env.SENT.slice(n).map(x => x.messages.map(m => m.text).join('\n')).join('\n');

section('ไม่ได้ใช้ POS — กรอกเงิน + แถมน้ำจิ้ม');
let g = setup();
let n0 = g.__env.SENT.length;
let r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), money: { cash: 500, sauceSesame: '6', sauceSuki: '' } });
eq('บันทึกได้', r.success, true);
const M = g.__env.SHEETS[g.SHEET_MALA_MONEY], hd = M.headers;
const last = M.rows.slice(-1)[0];
eq('ชีตเงินขายมีช่องแถมน้ำจิ้ม · 6 / 0', [last[hd.indexOf('แถมน้ำจิ้มงา')], last[hd.indexOf('แถมน้ำจิ้มสุกี้')]], [6, 0]);
let t = said(g, n0);
eq('เงินตรง (น้ำจิ้มไม่คิดเงิน)', /ได้จริง \(กรอกตอนเช็คสต็อก\) 500[\s\S]*→ ตรงกัน/.test(t), true);
eq('สรุปบอกน้ำจิ้ม ใช้ไป 6 · แถมไป 6 (กรอก 6) → ตรง', /🥣 น้ำจิ้ม ใช้ไป 6 กระปุก · แถมไป 6 \(POS 0 · กรอก 6\) → ตรง/.test(t), true);

section('ไม่กรอกแถม → บอกว่าหาย (แต่ไม่คิดเป็นเงิน)');
g = setup();
n0 = g.__env.SENT.length;
g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), money: { cash: 500 } });
t = said(g, n0);
eq('เงินยังตรง · น้ำจิ้มหาย 6', [/→ ตรงกัน/.test(t), /🥣 น้ำจิ้ม ใช้ไป 6 กระปุก · แถมไป 0 → หาย 6 กระปุก \(ไม่คิดเป็นเงิน\)/.test(t)], [true, true]);

section('ใช้ POS — แถมตามบิล');
g = setup({ bill: true });
n0 = g.__env.SENT.length;
g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g) });
t = said(g, n0);
eq('POS แถม 4 · ใช้ 6 → หาย 2', /🥣 น้ำจิ้ม ใช้ไป 6 กระปุก · แถมไป 4 → หาย 2 กระปุก/.test(t), true);

section('กันผิด');
g = setup();
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), money: { sauceSesame: 3 } });
eq('กรอกแถมน้ำจิ้มอย่างเดียว ไม่กรอกเงิน = ไม่รับ', [r.success, /กรอกเงินที่ได้ด้วย/.test(r.message)], [false, true]);
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), money: { cash: 500, sauceSesame: -1 } });
eq('ติดลบไม่รับ', r.success, false);

process.exit(done().fail ? 1 : 0);
