process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('มาม่า — สต็อกเหลือตัวเดียว · หน้าร้าน 15/20/25/35/45');

const g = fresh();
const names = g.__env.SHEETS[g.SHEET_ITEMS].rows.map(r => r[0]);

section('สต็อก');
const mamaNames = names.filter(n => /มาม่า/.test(n) && !/\(ดิบ\)/.test(n)).sort();
eq('มาม่าเหลือ มาม่าเปล่า + 15/20/25/35/45', mamaNames,
   ['มาม่า 15', 'มาม่า 20', 'มาม่า 25', 'มาม่า 35', 'มาม่า 45', 'มาม่าเปล่า'].sort());
eq('ราคาขายตรงกับชื่อ', [15, 20, 25, 35, 45].map(p => g.findStockItem_('มาม่า ' + p).price), [15, 20, 25, 35, 45]);
eq('นับเป็นห่อ ไม่มีชั้นแพ็ค', [g.findStockItem_('มาม่า 25').subUnit, g.findStockItem_('มาม่า 25').perPack], ['ห่อ', 1]);
eq('ราคาในสต็อกตรงกับปุ่มหน้าร้าน', g.MAMA_PRICES, [15, 20, 25, 35, 45]);
eq('มาม่า 35 ส้ม/ชมพู เดิม รวมเข้ามาม่า 35', [g.ITEM_RENAME['มาม่า 35 ส้ม'], g.ITEM_RENAME['มาม่า 35 ชมพู']], ['มาม่า 35', 'มาม่า 35']);

const { send, bal } = require('./t-intake');
const gi = fresh();
const out = send(gi, ['มาม่า25 4 ห่อ 60 บาท', 'มาม่า 45 2 ห่อ 70', 'มาม่าเปล่า 1 แพ็ค 50'].join('\n'), 'mm');
eq('มาม่า25 4 ห่อ เข้าถูกตัว', bal(gi)['มาม่า 25 (ดิบ)'], 4);
eq('มาม่า 45 2 ห่อ ไม่เอา 45 ไปเป็นจำนวน', bal(gi)['มาม่า 45 (ดิบ)'], 2);
eq('มาม่าเปล่าเข้าตัวเปล่า', bal(gi)['มาม่าเปล่า (ดิบ)'], 1);
eq('ไม่มีคำเตือน', /ยังไม่ได้ลงสต็อก/.test(out), false);
const out2 = send(gi, ['มาม่า 15 ห่อ 150', 'มาม่า35 ชมพู 2 ห่อ 70', 'ถ้วย 2 ออน 100 ใบ 200'].join('\n'), 'mm2');
eq('"มาม่า 15 ห่อ" = มาม่าเปล่า 15 ห่อ (เลขตามด้วยหน่วยคือจำนวน)', bal(gi)['มาม่าเปล่า (ดิบ)'], 1 + 15);
eq('มาม่า35 ชมพู (ชื่อเก่า) เข้ามาม่า 35', bal(gi)['มาม่า 35 (ดิบ)'], 2);
eq('ถ้วย 2 ออน 100 ใบ ไม่เอา 2 ไปเป็นจำนวน', bal(gi)['ถ้วย 2 ออน'], 100);
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
