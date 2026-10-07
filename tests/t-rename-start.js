process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, itemNames, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('6/10 — เปลี่ยนชื่อ · เอามาม่า 35 ออก · ฐาน = ยอดนับล่าสุด');

const at = (d, h, m) => new Date(2026, 9, d, h, m || 0, 0);

section('ชื่อใหม่');
let g = fresh();
const names = itemNames(g);
eq('มีเห็ดหูหนูขาว', names.includes('เห็ดหูหนูขาว'), true);
eq('ไม่มีเห็ดหูหนู', names.includes('เห็ดหูหนู'), false);
eq('มีเต้าหู้ปลาสี่เหลี่ยม', names.includes('เต้าหู้ปลาสี่เหลี่ยม'), true);
eq('ไม่มีเต้าหู้ปลา', names.includes('เต้าหู้ปลา'), false);
eq('เต้าหู้ปลาแผ่นยังอยู่', names.includes('เต้าหู้ปลาแผ่น'), true);
eq('เต้าหู้ปลาสี่เหลี่ยม 4 ชิ้น/ไม้', g.perStickOf_(g.findStockItem_('เต้าหู้ปลาสี่เหลี่ยม')), 4);
eq('ของดิบเปลี่ยนตาม', names.includes('เห็ดหูหนูขาว (ดิบ)'), true);

section('ประวัติชื่อเก่าย้ายมาชื่อใหม่ ยอดไม่หาย');
push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(5, 22, 38), 'สาขา': SHOP, 'รายการ': 'เห็ดหูหนู', 'จำนวน': 4, 'ประเภท': 'เช็คสต็อก' });
push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(5, 22, 38), 'สาขา': SHOP, 'รายการ': 'เต้าหู้ปลา', 'จำนวน': 12, 'ประเภท': 'เช็คสต็อก' });
push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(5, 22, 38), 'สาขา': SHOP, 'รายการ': 'เต้าหู้ปลาแผ่น', 'จำนวน': 0, 'ประเภท': 'เช็คสต็อก' });
push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(5, 22, 38), 'สาขา': SHOP, 'รายการ': 'มาม่า 35 ชมพู', 'จำนวน': 4, 'ประเภท': 'เช็คสต็อก' });
g.fixItemList(); g.cacheClear_();
let b = g.stockBalances_()[SHOP];
eq('เห็ดหูหนูขาว 4', b['เห็ดหูหนูขาว'], 4);
eq('เต้าหู้ปลาสี่เหลี่ยม 12', b['เต้าหู้ปลาสี่เหลี่ยม'], 12);
eq('เต้าหู้ปลาแผ่นไม่ถูกเปลี่ยนชื่อ', b['เต้าหู้ปลาแผ่น'], 0);

section('มาม่า 35 ที่เลิกขาย ยอดค้างถูกตั้งเป็น 0');
eq('มาม่า 35 ชมพู = 0', b['มาม่า 35 ชมพู'], 0);
eq('ไม่อยู่ในรายการสินค้า', itemNames(g).includes('มาม่า 35 ชมพู'), false);

section('ไลน์พิมพ์ชื่อเก่าก็เข้าชื่อใหม่');
eq('หูหนู → เห็ดหูหนูขาว', g.INTAKE_ALIAS['หูหนู'], 'เห็ดหูหนูขาว');
eq('เต้าหู้ปลา → สี่เหลี่ยม', g.INTAKE_ALIAS['เต้าหู้ปลา'], 'เต้าหู้ปลาสี่เหลี่ยม');

section('ใช้ยอดนับล่าสุด (5/10 22:38) เป็นฐาน ยอดขายเริ่ม 6/10');
g = fresh();
const cnt = (d, h, m, item, q) => push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(d, h, m), 'สาขา': SHOP,
  'รายการ': item, 'จำนวน': q, 'ประเภท': 'เช็คสต็อก' });
cnt(5, 16, 33, 'ดอลลี่', 30);
cnt(5, 22, 38, 'ดอลลี่', 12);
push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(5, 22, 39), 'สาขา': SHOP, 'รายการ': 'น้ำดำ', 'จำนวน': '',
  'ประเภท': g.KIND_LEVEL_COUNT, 'หมายเหตุ': 'มาก ไม่ต้องเติม' });
const r = g.startFromLatestCount_(SHOP);
eq('ขีดเส้นที่ยอดนับล่าสุด (ไม่นับเช็คระดับ)', r.start, '2026-10-05 22:38');
g.cacheClear_();
eq('นับ 16:33 อยู่ก่อนเส้น', g.costBefore_(at(5, 16, 33), SHOP), true);
eq('นับ 22:38 ไม่อยู่ก่อนเส้น', g.costBefore_(new Date(2026, 9, 5, 22, 38, 32), SHOP), false);
eq('บิลวันที่ 5/10 ไม่นับ', g.costBefore_('2026-10-05', SHOP), true);
eq('บิลวันที่ 6/10 นับ', g.costBefore_('2026-10-06', SHOP), false);
eq('ครัวกลางไม่โดน', g.costBefore_(at(5, 16, 33), g.CENTRAL), false);
eq('ยอดตอนนี้ = 22:38', g.stockBalances_()[SHOP]['ดอลลี่'], 12);
eq('ปิดร้านรอบหน้าเทียบกับ 22:38', g.cashCountTimes_(SHOP).length, 1);
eq('ตั้งแบบใส่วันอย่างเดียวยังได้', g.costYmdTime_('2026-10-06'), new Date(2026, 9, 6).getTime());

section('รันจากหน้า Apps Script (ไม่มีกล่องถาม) ก็ตั้งได้');
g = fresh();
push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(5, 22, 38), 'สาขา': SHOP, 'รายการ': 'ดอลลี่', 'จำนวน': 12, 'ประเภท': 'เช็คสต็อก' });
g.promptStartFromLatestCount();
eq('ตั้งเส้นที่ 22:38', JSON.parse(g.__env.PROPS.ACC_START_BY_LOC)[SHOP], '2026-10-05 22:38');
eq('บอกผลใน log', g.__env.LOG.some(l => /✅ ตลาดทรัพย์พัฒนา — ยอดตั้งต้น = ที่นับเมื่อ 5\/10\/2026 22:38/.test(l)), true);

section('เส้นเริ่มนับกลางวัน (17:23) — บิลหลังเส้นวันเดียวกันยังนับ บิลก่อนเส้นไม่นับ');
{
  const g7 = fresh();
  g7.__env.SHEETS[g7.SHEET_EXPENSE] = { headers: g7.EXPENSE_HEADERS.slice(), rows: [] };
  g7.setLocationStart(SHOP, '2026-10-07 17:23');
  const bill = (t, net) => push(g7, g7.SHEET_ORDERS, { 'วันที่': '2026-10-07', 'เวลา': t, 'สาขา': SHOP,
    'ยอดรวม': net, 'ยอดสุทธิ': net, 'วิธีชำระเงิน': 'เงินสด' });
  bill('16:17:14', 95); bill('17:05:37', 95); bill('18:30:00', 120); bill('21:10:00', 60);
  push(g7, g7.SHEET_EXPENSE, { 'วันที่': '2026-10-07', 'เวลา': '15:00:00', 'สาขา': SHOP, 'ประเภท': 'ค่าที่', 'จำนวนเงิน': 120 });
  push(g7, g7.SHEET_EXPENSE, { 'วันที่': '2026-10-07', 'เวลา': '19:00:00', 'สาขา': SHOP, 'ประเภท': 'ค่าน้ำแข็ง', 'จำนวนเงิน': 10 });
  const pl = g7.costSummary_().pl[SHOP];
  eq('รายได้เฉพาะหลัง 17:23 = 180', pl['รายได้'], 180);
  eq('ค่าใช้จ่ายเฉพาะหลัง 17:23 = 10', pl['ค่าใช้จ่ายอื่น'], 10);
  const rp = g7.monthlyReport('2026-10', SHOP);
  eq('รายงานเดือนก็นับเหมือนกัน', rp.sales, 180);
  // เส้นแบบวันอย่างเดียวยังทำงานเหมือนเดิม
  g7.setLocationStart(SHOP, '2026-10-07');
  eq('เส้นทั้งวัน = นับทุกบิลของวันนั้น', g7.costSummary_().pl[SHOP]['รายได้'], 370);
}

module.exports = done();
