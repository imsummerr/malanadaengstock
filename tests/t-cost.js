process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, D, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('ต้นทุน FIFO');

function buy(g, day, item, qty, baht, msg, month) {
  push(g, g.INTAKE_SHEET, { 'รายการ': item, 'จำนวนเงิน': baht, 'messageId': msg });
  push(g, g.SHEET_INCOMING, { 'วันที่เวลา': D(day, 9, month), 'สาขา': g.CENTRAL, 'รายการ': item,
    'จำนวน': qty, 'ประเภท': 'ของเข้าครัวกลาง', 'messageId': msg });
}
function pack(g, day, out, qty, raws, month) {
  const o = { 'วันที่เวลา': D(day, 10, month), 'สาขา': g.CENTRAL, 'รายการ': out, 'จำนวน': qty };
  raws.forEach((x, k) => { const c = g.packRawCols_(k); o[c.name] = x[0]; o[c.qty] = x[1]; });
  push(g, g.SHEET_PACK, o);
}
function ship(g, day, item, qty, month, hour) {
  push(g, g.SHEET_INCOMING, { 'วันที่เวลา': D(day, hour || 11, month), 'สาขา': SHOP, 'รายการ': item,
    'จำนวน': qty, 'ประเภท': 'ของเข้าร้าน' });
}
function count(g, day, loc, item, qty, month, hour) {
  push(g, g.SHEET_COUNT, { 'วันที่เวลา': D(day, hour === undefined ? 21 : hour, month), 'สาขา': loc,
    'รายการ': item, 'จำนวน': qty, 'ประเภท': 'เช็คสต็อก' });
}
function waste(g, day, loc, item, qty, month) {
  push(g, g.SHEET_WASTE, { 'วันที่เวลา': D(day, 12, month), 'สาขา': loc, 'รายการ': item,
    'จำนวน': qty, 'ประเภท': 'ของเสีย' });
}
const val = (g, loc, item) => { const s = g.costSummary_().stock[loc];
  const r = s && s.rows.find(x => x.item === item); return r ? r.value : 0; };

section('ซื้อสองราคา ใช้ของถูกก่อน');
let g = fresh();
buy(g, 1, 'ดอลลี่ (ดิบ)', 10, 600, 'm1');
buy(g, 2, 'ดอลลี่ (ดิบ)', 10, 800, 'm2');
eq('มูลค่ารวม 1400', val(g, g.CENTRAL, 'ดอลลี่ (ดิบ)'), 1400);
pack(g, 3, 'ดอลลี่', 200, [['ดอลลี่ (ดิบ)', 12]]);
eq('กินล็อตแรกก่อน เหลือ 640', val(g, g.CENTRAL, 'ดอลลี่ (ดิบ)'), 640);
eq('ของที่แพ็คได้ 760', val(g, g.CENTRAL, 'ดอลลี่'), 760);

section('ส่งเข้าร้าน = หนี้ที่ต้นทุนจริง');
ship(g, 4, 'ดอลลี่', 100);
let s = g.costSummary_();
eq('สาขาได้ไปที่ต้นทุนเดิม', val(g, SHOP, 'ดอลลี่'), 380);
eq('ค้างชำระ 380', s.owed[SHOP]['ค้างชำระ'], 380);
count(g, 5, SHOP, 'ดอลลี่', 40);
s = g.costSummary_();
eq('นับเหลือ 40 → ใช้ไป 60 ไม้ = 228', s.used[SHOP]['ใช้ไป'], 228);

section('ของเสียที่ครัวกลาง ครัวกลางรับเอง');
g = fresh();
buy(g, 1, 'แมงกะพรุน (ดิบ)', 10, 2000, 'w1');
waste(g, 2, g.CENTRAL, 'แมงกะพรุน (ดิบ)', 2);
s = g.costSummary_();
eq('ตัดจากสต็อกครัวกลาง', val(g, g.CENTRAL, 'แมงกะพรุน (ดิบ)'), 1600);
eq('ของเสียครัวกลาง 400', s.used[g.CENTRAL]['ของเสีย'], 400);
eq('ไม่มีใครต้องจ่ายคืน', s.owed[g.CENTRAL], undefined);

section('ข้อความเดียวซื้อของชื่อเดียวกันสองบรรทัด — แบ่งราคาตามจำนวน ไม่เบิ้ล');
{
  const g9 = fresh();
  buy(g9, 7, 'หัวไหล่หมูติดหนังสไลซ์ (ดิบ)', 0.5, 62, 'dup', 9);
  // บรรทัดที่สองในข้อความเดียวกัน — ชีตซื้อของมีสองแถว ของเข้ามีสองแถว
  push(g9, g9.INTAKE_SHEET, { 'รายการ': 'หัวไหล่หมูติดหนังสไลซ์ (ดิบ)', 'จำนวนเงิน': 188.5, 'messageId': 'dup' });
  push(g9, g9.SHEET_INCOMING, { 'วันที่เวลา': D(7, 9, 9), 'สาขา': g9.CENTRAL, 'รายการ': 'หัวไหล่หมูติดหนังสไลซ์ (ดิบ)',
    'จำนวน': 1.546, 'ประเภท': 'ของเข้าครัวกลาง', 'messageId': 'dup' });
  eq('มูลค่ารวม = 62 + 188.5 = 250.5 ไม่ใช่ 501', val(g9, g9.CENTRAL, 'หัวไหล่หมูติดหนังสไลซ์ (ดิบ)'), 250.5);
}

module.exports = { buy, pack, ship, count, waste, val };
if (require.main === module) process.exit(done().fail ? 1 : 0);
