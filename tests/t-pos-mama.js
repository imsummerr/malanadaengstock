process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('มาม่า — สต็อกเหลือตัวเดียว · หน้าร้าน 15/20/25/35/45');

const g = fresh();
const names = g.__env.SHEETS[g.SHEET_ITEMS].rows.map(r => r[0]);

section('สต็อก');
eq('มาม่าในสต็อกเหลือแค่มาม่าเปล่า', names.filter(n => /มาม่า/.test(n)).sort(),
   ['มาม่าเปล่า', 'มาม่าเปล่า (ดิบ)']);
eq('มาม่าเปล่าราคา 10', g.findStockItem_('มาม่าเปล่า').price, 10);
eq('หน้าร้านขาย 15/20/25/35/45', g.MAMA_PRICES, [15, 20, 25, 35, 45]);
const { send, bal } = require('./t-intake');
const gi = fresh();
send(gi, ['มาม่า 2 ถุง 100', 'ถ้วย 2 ออน 100 ใบ 200'].join('\n'), 'mm');
eq('มาม่า 2 ถุง = มาม่าเปล่า 42 อัน', bal(gi)['มาม่าเปล่า (ดิบ)'], 42);
eq('ถ้วย 2 ออน 100 ใบ ไม่เอา 2 ไปเป็นจำนวน', bal(gi)['ถ้วย 2 ออน'], 100);

section('ชีตบิลจริงยังเป็นหัวตารางเก่า (ไม่มีคอลัมน์ 25฿)');
const oldHeaders = g.ORDER_HEADERS.filter(h => h !== 'มาม่า 25฿' && h !== 'รวมบิล');
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
eq('เพิ่มคอลัมน์ มาม่า 25฿ กับ รวมบิล ไว้ท้ายสุด', sh.headers.slice(-2), ['มาม่า 25฿', 'รวมบิล']);
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

section('รวมบิล — 2 ถ้วยจ่ายโอนทีเดียว ลงถ้วยละแถว');
const base = { branch: SHOP, method: 'สแกน/โอนผ่านธนาคาร', subtotal: 0, total: 0 };
g.handleOrder_({ token: 't', order: Object.assign({}, base, { orderId: 'POS9-1', total: 50, subtotal: 50,
  sticks: [{ price: 10, qty: 5 }], stickCount: 5, stickAmount: 50, soup: 'น้ำใส', group: 'B9 ถ้วย 1/2' }) });
g.handleOrder_({ token: 't', order: Object.assign({}, base, { orderId: 'POS9-2', total: 60, subtotal: 60,
  sticks: [{ price: 10, qty: 6 }], stickCount: 6, stickAmount: 60, soup: 'น้ำดำ', group: 'B9 ถ้วย 2/2' }) });
const gr = sh.rows.slice(-2).map(r => r[sh.headers.indexOf('รวมบิล')]);
eq('ช่องรวมบิล', gr, ['B9 ถ้วย 1/2', 'B9 ถ้วย 2/2']);
eq('วิธีจ่ายเดียวกัน', sh.rows.slice(-2).map(r => r[sh.headers.indexOf('วิธีชำระเงิน')]),
   ['สแกน/โอนผ่านธนาคาร', 'สแกน/โอนผ่านธนาคาร']);
const b2 = (g.handleBills_({ token: 't', date: today }).data || {}).bills || [];
eq('บิลย้อนหลังบอกรวมบิล', b2.filter(x => x.group).map(x => x.group + ' ' + x.total).sort(), ['B9 ถ้วย 1/2 50', 'B9 ถ้วย 2/2 60']);
eq('บิลปกติไม่มีรวมบิล', b2.find(x => x.orderNo === 'OLD').group, '');

process.exit(done().fail ? 1 : 0);
