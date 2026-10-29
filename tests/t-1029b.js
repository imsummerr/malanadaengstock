process.env.TZ = 'Asia/Bangkok';
const { makeCheck, formatDate } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('29/10 — แถมน้ำจิ้มทุกออเดอร์ · ขายเพิ่มกระปุกละ 10 รวมในควรได้ · เช็คสต็อกกรอกแถมได้');

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

section('ไม่ได้ใช้ POS — กรอกเงิน + แถมน้ำจิ้ม (ใช้ไปเท่าที่แถม)');
let g = setup();
let n0 = g.__env.SENT.length;
let r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), money: { cash: 500, sauceSesame: '6', sauceSuki: '' } });
eq('บันทึกได้', r.success, true);
const M = g.__env.SHEETS[g.SHEET_MALA_MONEY], hd = M.headers;
const last = M.rows.slice(-1)[0];
eq('ชีตเงินขายมีช่องแถมน้ำจิ้ม · 6 / (ว่าง)', [last[hd.indexOf('แถมน้ำจิ้มงา')], last[hd.indexOf('แถมน้ำจิ้มสุกี้')]], [6, '']);
let t = said(g, n0);
eq('ควรได้ 500 (น้ำจิ้มแถมหมด ไม่ได้ขายเพิ่ม) · ตรง', /ควรได้ \(ตามของที่ขายออกไป\) 500[\s\S]*→ ตรงกัน/.test(t), true);
eq('บรรทัดน้ำจิ้ม', /🥣 น้ำจิ้ม ใช้ไป 6 กระปุก · แถมหน้าร้าน 6 \(กรอก 6\) · ไม่ได้ขายเพิ่ม/.test(t), true);

section('แถม 4 · ใช้ไป 6 → ขายเพิ่ม 2 กระปุก = 20 บาท รวมในควรได้');
g = setup();
n0 = g.__env.SENT.length;
g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), money: { cash: 520, sauceSesame: 4 } });
t = said(g, n0);
eq('ควรได้ 520 = ไม้ 500 + น้ำจิ้ม 20 · ได้ 520 ตรง', [/ควรได้ \(ตามของที่ขายออกไป\) 520/.test(t), /→ ตรงกัน/.test(t)], [true, true]);
eq('บรรทัดน้ำจิ้มบอกขายเพิ่ม', /ใช้ไป 6 กระปุก · แถมหน้าร้าน 4 \(กรอก 4\) · ขายเพิ่ม 2 กระปุก = 20 บาท \(รวมในควรได้แล้ว\)/.test(t), true);

section('ไม่ได้ใช้ POS ไม่กรอกแถม → นับเป็นขายหมด (เงินจะดูขาด) — ต้องกรอกแถมทุกครั้ง');
g = setup();
n0 = g.__env.SENT.length;
g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), money: { cash: 500 } });
t = said(g, n0);
eq('ควรได้ 560 · ขาด 60', [/ควรได้ \(ตามของที่ขายออกไป\) 560/.test(t), /🔻 ขาด 60/.test(t)], [true, true]);
g = setup();
n0 = g.__env.SENT.length;
g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), money: { cash: 500, sauceSesame: 0 } });
eq('กรอก 0 = ไม่ได้แถมเลย (ขายหมด 6 = 60)', /ขายเพิ่ม 6 กระปุก = 60 บาท/.test(said(g, n0)), true);

section('ใช้ POS บางบิล + กรอกเงิน แต่ไม่กรอกแถม → ใช้จำนวนแถมจากบิล');
g = setup({ bill: true });
n0 = g.__env.SENT.length;
g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), money: { cash: 520 } });
t = said(g, n0);
eq('แถม 4 จากบิล · ขายเพิ่ม 2 = 20 · ควรได้ 520 ตรง', [/แถมหน้าร้าน 4 · ขายเพิ่ม 2 กระปุก = 20 บาท/.test(t), /→ ตรงกัน/.test(t)], [true, true]);

section('ใช้ POS — แถมตามบิล (เลือกน้ำจิ้มบิลละ 1)');
g = setup({ bill: true });
n0 = g.__env.SENT.length;
g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g) });
t = said(g, n0);
eq('POS แถม 4 · ใช้ 6 → ขายเพิ่ม 2 = 20 (ไม่ได้กดใน POS = ของออกมากกว่าที่กด)',
   [/🥣 น้ำจิ้ม ใช้ไป 6 กระปุก · แถมหน้าร้าน 4 · ขายเพิ่ม 2 กระปุก = 20 บาท/.test(t), /ควรได้ \(ตามของที่ขายออกไป\) 520/.test(t)], [true, true]);

section('ตัวอย่างเจ้าของ: น้ำจิ้มงาเข้า 6 · เช็คสต็อกเหลือ 0 · แถม 5 → ขาย 1 = ต้องได้ 10 บาท');
{
  const g2 = setup();
  // ฐานเช้านี้น้ำจิ้มงา 0 (ตั้งใหม่) แล้วส่งเข้าร้าน 6 กระปุก
  push(g2, g2.SHEET_COUNT, { 'วันที่เวลา': at(5.9), 'สาขา': SHOP, 'รายการ': 'น้ำจิ้มงา (กระปุก)', 'จำนวน': 0, 'ประเภท': 'เช็คสต็อก' });
  push(g2, g2.SHEET_INCOMING, { 'วันที่เวลา': at(5), 'สาขา': SHOP, 'รายการ': 'น้ำจิ้มงา (กระปุก)', 'จำนวน': 6, 'ประเภท': 'ของเข้าร้าน' });
  const rows0 = g2.countItemsAt_(SHOP).map(it => it.level ? { item: it.name, level: g2.LEVELS[0] } : { item: it.name, packs: '', rem: 0, pieces: '' });
  const n1 = g2.__env.SENT.length;
  g2.handleStockCount_({ token: 't', location: SHOP, rows: rows0, money: { cash: 510, sauceSesame: 5 } });
  const t2 = said(g2, n1);
  eq('ใช้ไป 6 · แถม 5 · ขายเพิ่ม 1 = 10 บาท', /🥣 น้ำจิ้ม ใช้ไป 6 กระปุก · แถมหน้าร้าน 5 \(กรอก 5\) · ขายเพิ่ม 1 กระปุก = 10 บาท/.test(t2), true);
  eq('ควรได้ = ไม้ 500 + น้ำจิ้ม 10 = 510 · ได้ 510 ตรง', [/ควรได้ \(ตามของที่ขายออกไป\) 510/.test(t2), /→ ตรงกัน/.test(t2)], [true, true]);
}

section('ไม่ได้ใช้ POS + เดลิเวอรี่ 1 ออเดอร์ — กรอกแถมหน้าร้าน 4 · ระบบนับเดลิเวอรี่ให้เอง');
{
  const g3 = setup();
  const n3 = g3.__env.SENT.length;
  g3.handleStockCount_({ token: 't', location: SHOP, rows: rows(g3), money: { cash: 510, sauceSesame: 4 },
    delivery: [{ platform: 'Grab', amount: 100, items: [{ name: 'หม่าล่าหน้าแดง', qty: 1 }] }] });
  const t3 = said(g3, n3);
  eq('ใช้ 6 = แถมหน้าร้าน 4 + เดลิเวอรี่ 1 + ขายเพิ่ม 1 (10 บาท)',
     /ใช้ไป 6 กระปุก · แถมหน้าร้าน 4 \(กรอก 4\) · ไปกับเดลิเวอรี่ 1 · ขายเพิ่ม 1 กระปุก = 10 บาท/.test(t3), true);
}

section('กันผิด');
g = setup();
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), money: { sauceSesame: 3 } });
eq('กรอกแถมน้ำจิ้มอย่างเดียว ไม่กรอกเงิน = ไม่รับ', [r.success, /กรอกเงินที่ได้ด้วย/.test(r.message)], [false, true]);
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), money: { cash: 500, sauceSesame: -1 } });
eq('ติดลบไม่รับ', r.success, false);

process.exit(done().fail ? 1 : 0);
