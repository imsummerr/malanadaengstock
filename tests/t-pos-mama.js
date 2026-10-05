process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('มาม่า — สต็อกเหลือตัวเดียว · หน้าร้าน 15/20/25/35/45');

const g = fresh();
const names = g.__env.SHEETS[g.SHEET_ITEMS].rows.map(r => r[0]);

section('สต็อก');
eq('มาม่าในรายการสินค้าเหลือแค่มาม่าเปล่า', names.filter(n => /มาม่า/.test(n)).sort(),
   ['มาม่าเปล่า', 'มาม่าเปล่า (ดิบ)']);
eq('ชื่อเก่า มาม่า แมปมาที่มาม่าเปล่า', g.ITEM_RENAME['มาม่า'], 'มาม่าเปล่า');

section('ชีตบิลจริงยังเป็นหัวตารางเก่า (ไม่มีคอลัมน์ 25฿)');
const oldHeaders = g.ORDER_HEADERS.filter(h => h !== 'มาม่า 25฿');
g.__env.SHEETS[g.SHEET_ORDERS] = { headers: oldHeaders.slice(), rows: [] };
// บิลเก่าที่ขายมาม่า 10฿
const old = new Array(oldHeaders.length).fill('');
const today = g.Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
old[oldHeaders.indexOf('วันที่')] = today; old[oldHeaders.indexOf('สาขา')] = SHOP;
old[oldHeaders.indexOf('เลขที่ออเดอร์')] = 'OLD'; old[oldHeaders.indexOf('มาม่า 10฿')] = 1;
g.__env.SHEETS[g.SHEET_ORDERS].rows.push(old);

g.checkToken_ = () => ({ role: 'staff', branch: SHOP, branches: [SHOP], name: 'พนง.' });
const r = g.handleOrder_({ token: 't', order: { orderId: 'x1', branch: SHOP,
  mama: [{ price: 15, qty: 1 }, { price: 25, qty: 2 }, { price: 45, qty: 1 }],
  mamaCount: 4, mamaAmount: 110, subtotal: 110, total: 110, method: 'เงินสด' } });
eq('บันทึกบิลได้', r.success, true);
const sh = g.__env.SHEETS[g.SHEET_ORDERS];
const last = sh.rows[sh.rows.length - 1];
const col = h => last[sh.headers.indexOf(h)];
eq('เพิ่มคอลัมน์ มาม่า 25฿ ไว้ท้ายสุด', sh.headers[sh.headers.length - 1], 'มาม่า 25฿');
eq('คอลัมน์เดิมไม่เลื่อน', sh.headers.slice(0, oldHeaders.length), oldHeaders);
eq('15฿ ลงช่อง 15฿', col('มาม่า 15฿'), 1);
eq('25฿ ลงช่อง 25฿', col('มาม่า 25฿'), 2);
eq('45฿ ลงช่อง 45฿', col('มาม่า 45฿'), 1);
eq('ช่อง 10฿ ว่าง', col('มาม่า 10฿'), 0);
eq('รวมมาม่า 4 ห่อ', col('รวมมาม่า'), 4);
eq('ยอดสุทธิไม่เลื่อน', col('ยอดสุทธิ'), 110);

section('อ่านบิลย้อนหลัง');
const b = (g.handleBills_({ token: 't', date: today }).data || {}).bills || [];
const nb = b.find(x => x.orderNo !== 'OLD');
eq('บิลใหม่อ่านมาม่า 25฿ ได้', (nb.mama || []).map(m => m.price + 'x' + m.qty).sort(), ['15x1', '25x2', '45x1']);
const ob = b.find(x => x.orderNo === 'OLD');
eq('บิลเก่ามาม่า 10฿ ยังอ่านได้', (ob.mama || []).map(m => m.price + 'x' + m.qty), ['10x1']);

process.exit(done().fail ? 1 : 0);
