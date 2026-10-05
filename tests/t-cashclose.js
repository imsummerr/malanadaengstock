process.env.TZ = 'Asia/Bangkok';
const { makeCheck, formatDate } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('ปิดร้าน — เทียบเงินสด');

const NOW = Date.now();
const at = min => new Date(NOW - min * 60000);
const ymd = d => formatDate(d, '', 'yyyy-MM-dd');
const hms = d => formatDate(d, '', 'HH:mm:ss');

function setup(withCount) {
  const g = fresh();
  const S = g.__env.SHEETS;
  S[g.SHEET_EXPENSE] = { headers: g.EXPENSE_HEADERS.slice(), rows: [] };
  const cnt = (min, item, qty) => push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(min), 'สาขา': SHOP,
    'รายการ': item, 'จำนวน': qty, 'ประเภท': 'เช็คสต็อก' });
  // ยอดฐาน 5 ชม.ก่อน
  cnt(300, 'ดอลลี่', 20); cnt(300, 'เต้าชีส', 30); cnt(300, 'มันเทศ', 6);
  push(g, g.SHEET_INCOMING, { 'วันที่เวลา': at(240), 'สาขา': SHOP, 'รายการ': 'ดอลลี่',
    'จำนวน': 10, 'ประเภท': 'ของเข้าร้าน' });
  push(g, g.SHEET_WASTE, { 'วันที่เวลา': at(180), 'สาขา': SHOP, 'รายการ': 'มันเทศ', 'จำนวน': 2 });
  // บิล: เงินสด 200 ลด 10 / โอน 100
  const ord = (min, gross, disc, how) => push(g, g.SHEET_ORDERS, { 'วันที่': ymd(at(min)),
    'เวลา': hms(at(min)), 'สาขา': SHOP, 'ยอดรวม': gross, 'ส่วนลด': disc,
    'ยอดสุทธิ': gross - disc, 'รวมไม้': gross / 10, 'วิธีชำระเงิน': how });
  ord(120, 200, 10, 'เงินสด');
  ord(90, 60, 0, 'สแกน/โอนผ่านธนาคาร');
  ord(80, 40, 0, 'ไทยช่วยไทย');
  const exp = (min, amt, how) => push(g, g.SHEET_EXPENSE, { 'วันที่': ymd(at(min)),
    'เวลา': hms(at(min)), 'สาขา': SHOP, 'ประเภท': 'ค่าน้ำแข็ง', 'จำนวนเงิน': amt, 'วิธีจ่าย': how });
  exp(100, 50, 'เงินสด');
  exp(100, 30, 'โอน');
  if (withCount) closeCount(g);
  return g;
}
// นับปิด: ดอลลี่ใช้ 18 ไม้ · เต้าชีสใช้ 20 ชิ้น = 10 ไม้ · มันเทศใช้ 3 ถุง → 31 × 10 = 310
function closeCount(g) {
  [['ดอลลี่', 12], ['เต้าชีส', 10], ['มันเทศ', 1]].forEach(([i, q]) =>
    push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(2), 'สาขา': SHOP, 'รายการ': i, 'จำนวน': q,
                              'ประเภท': 'เช็คสต็อก' }));
}

section('ราคาสินค้า');
let g = setup(true);
eq('ดอลลี่ 10 บาท/ไม้', g.findStockItem_('ดอลลี่').price, 10);
eq('เต้าชีส 2 ชิ้น/ไม้', g.perStickOf_(g.findStockItem_('เต้าชีส')), 2);

section('ของที่ขายไปตามสต็อก — แปลงชิ้นเป็นไม้ก่อนคูณราคา');
const u = g.cashUsage_(SHOP, at(2).getTime());
eq('รวม 31 ไม้', u.sticks, 31);
eq('มูลค่า 310 บาท', u.value, 310);
eq('เต้าชีส 10 ไม้ ไม่ใช่ 20', u.items.find(x => x.name === 'เต้าชีส').qty, 10);

section('นับสต็อกแล้ว กรอกเงินตรง');
let r = g.handleCashClose_({ token: 't', close: { branch: SHOP, cash: 150, closeId: 'C1' } });
eq('บันทึกได้', r.success, true);
eq('เทียบแล้ว', r.checked, true);
eq('ควรมี 310 − ลด 10 − โอน 60 − ไทยช่วยไทย 40 − ค่าใช้จ่ายเงินสด 50 = 150', r.expected, 150);
eq('ต่าง 0', r.diff, 0);
let txt = g.__env.SENT.map(x => x.messages[0].text).join('\n');
eq('ไลน์บอกว่าเงินตรง', /✅ ปิดร้าน .* เงินตรง/.test(txt), true);
eq('ค่าใช้จ่ายที่โอนจ่ายไม่ถูกหัก', /ค่าใช้จ่ายเงินสด   50/.test(txt), true);
eq('แยกโอนกับไทยช่วยไทย', /ลูกค้าโอน   60[\s\S]*ไทยช่วยไทย   40/.test(txt), true);
const cs = g.__env.SHEETS[g.SHEET_CASH];
eq('จดยอดที่ควรมีลงชีต', cs.rows[0][cs.headers.indexOf('ควรมี')], 150);
eq('จดผล', cs.rows[0][cs.headers.indexOf('ผลเทียบ')], 'ตรง');

section('ส่งซ้ำ (id เดิม) ไม่ลงซ้ำ');
r = g.handleCashClose_({ token: 't', close: { branch: SHOP, cash: 150, closeId: 'C1' } });
eq('ไม่ลงซ้ำ', r.duplicated, true);
eq('ยังมีแถวเดียว', cs.rows.length, 1);

section('กรอกใหม่ เงินขาด → แจ้งไลน์');
g.__env.SENT.length = 0;
r = g.handleCashClose_({ token: 't', close: { branch: SHOP, cash: 120, closeId: 'C2' } });
eq('ต่าง −30', r.diff, -30);
txt = g.__env.SENT.map(x => x.messages[0].text).join('\n');
eq('ไลน์บอกขาด 30', /⚠️ ปิดร้าน[\s\S]*🔻 ขาด 30 บาท/.test(txt), true);
eq('บอกว่าของออกมากกว่า POS 10 บาท', /ของออกมากกว่าที่กด POS 10 บาท/.test(txt), true);
eq('แถวใหม่ขึ้นว่าขาด', cs.rows[1][cs.headers.indexOf('ผลเทียบ')], 'ขาด');

section('พนักงานไม่เห็นยอดที่ควรมี');
g.checkToken_ = () => ({ role: 'staff', branch: SHOP, branches: [SHOP], name: 'ลลิตา' });
r = g.handleCashClose_({ token: 't', close: { cash: 150, closeId: 'C3' } });
eq('บันทึกได้ (ใช้สาขาของพนักงาน)', r.success, true);
eq('ไม่ส่งยอดที่ควรมีกลับไป', r.expected, undefined);
eq('ไม่ส่งยอดต่างกลับไป', r.diff, undefined);

section('กรอกเงินก่อน แล้วค่อยนับสต็อก');
g = setup(false);
g.__env.SHEETS[g.SHEET_COUNT].rows = [];
[['ดอลลี่', 20], ['เต้าชีส', 30], ['มันเทศ', 6]].forEach(([i, q]) =>
  push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(26 * 60), 'สาขา': SHOP, 'รายการ': i, 'จำนวน': q,
                            'ประเภท': 'เช็คสต็อก' }));
g.__env.SHEETS[g.SHEET_INCOMING].rows = [];
g.__env.SHEETS[g.SHEET_WASTE].rows = [];
r = g.handleCashClose_({ token: 't', close: { branch: SHOP, cash: 0, closeId: 'X' } });
eq('กรอก 0 ได้', r.success, true);
eq('ยังไม่นับปิด → รอ', r.waiting, true);
eq('ยังไม่ส่งไลน์', g.__env.SENT.length, 0);
closeCount(g);
const c = g.cashCheckAfterCount_(SHOP, new Date());
// ดอลลี่ 8 + เต้าชีส 10 + มันเทศ 5 = 23 ไม้ = 230 − 10 − 100 − 50 = 70
eq('นับเสร็จแล้วเทียบให้เลย', c.expected, 70);
eq('ต่าง −70 (กรอก 0)', c.diff, -70);
eq('ส่งไลน์', g.__env.SENT.length, 1);

section('ไม่มีการกรอกเงิน — นับสต็อกอย่างเดียวเงียบ');
g = setup(true);
eq('ไม่มีผล', g.cashCheckAfterCount_(SHOP, new Date()), null);
eq('ดูจากเมนูได้ (ไม่ส่งไลน์)', g.cashCheck_(SHOP, g.cashBizDay_(Date.now()), { silent: true }).expected, 150);
eq('ไม่ส่งไลน์', g.__env.SENT.length, 0);

section('ตรวจของหาย (นับเสร็จ) ใช้หน่วยไม้');
const gg = g.auditUsage_([{ item: g.findStockItem_('เต้าชีส'), counted: 10, sys: 30, diff: -20 }]);
eq('เต้าชีส 20 ชิ้น = 10 ไม้', gg.piece.used, 10);
eq('มูลค่า 100', gg.piece.value, 100);

section('ล้างยอดติดลบ ไม่แตะของที่เป็นบวก');
g = fresh();
push(g, g.SHEET_INCOMING, { 'วันที่เวลา': at(60), 'สาขา': SHOP, 'รายการ': 'น้ำจิ้มงา (กระปุก)',
  'จำนวน': 7, 'ประเภท': 'ของเข้าร้าน' });
push(g, g.SHEET_INCOMING, { 'วันที่เวลา': at(60), 'สาขา': g.CENTRAL, 'รายการ': 'ดอลลี่',
  'จำนวน': 5, 'ประเภท': 'ของเข้าครัวกลาง' });
eq('ครัวกลางน้ำจิ้มงาติดลบ 7', g.stockBalances_()[g.CENTRAL]['น้ำจิ้มงา (กระปุก)'], -7);
g.SpreadsheetApp.getUi = () => ({ prompt: () => ({ getSelectedButton: () => 'OK', getResponseText: () => '' }),
  alert: () => 'OK', Button: { OK: 'OK' }, ButtonSet: { OK_CANCEL: 1 } });
g.zeroNegativeStock();
g.cacheClear_();
const b = g.stockBalances_()[g.CENTRAL];
eq('น้ำจิ้มงาเป็น 0', b['น้ำจิ้มงา (กระปุก)'], 0);
eq('ดอลลี่ยังอยู่ 5', b['ดอลลี่'], 5);
eq('สาขายังมีน้ำจิ้ม 7', g.stockBalances_()[SHOP]['น้ำจิ้มงา (กระปุก)'], 7);

section('สาหร่ายแผ่น (ไม่มีในสต็อก) บวกเพิ่ม · ไม้แลกแต้มหักออก');
g = setup(true);
push(g, g.SHEET_ORDERS, { 'วันที่': ymd(at(70)), 'เวลา': hms(at(70)), 'สาขา': SHOP,
  'ยอดรวม': 30, 'ส่วนลด': 0, 'ยอดสุทธิ': 20, 'รวมไม้': 1, 'ยอดไม้': 10,
  'รวมของอื่น': 1, 'ยอดของอื่น': 20, 'ใช้แต้ม (ไม้)': 1, 'ส่วนลดแต้ม': 10, 'วิธีชำระเงิน': 'เงินสด' });
r = g.cashCheck_(SHOP, g.cashBizDay_(Date.now()), { silent: true });
eq('150 + สาหร่าย 20 − แลกแต้ม 10 = 160', r.expected, 160);
eq('บอกบรรทัดแลกแต้ม', /− แลกแต้ม   10/.test(r.text), true);
eq('บอกบรรทัดของที่ไม่ได้นับสต็อก', /\+ มาม่า\/ของอื่นที่ไม่ได้นับสต็อก   20/.test(r.text), true);

section('ชีสขาย 15 บาท ตัวเดียว');
g = fresh();
eq('ชีส 15', g.findStockItem_('ชีส').price, 15);
eq('ต็อก 10', g.findStockItem_('ต็อกแท่งเล็ก').price, 10);
eq('ฟองเต้าหู้ม้วน 10', g.findStockItem_('ฟองเต้าหู้ม้วน').price, 10);
{
  const S0 = g.__env.SHEETS[g.SHEET_ITEMS];
  const p0 = S0.headers.indexOf('ราคาขาย/หน่วยย่อย');
  S0.rows.find(r => r[0] === 'ชีส')[p0] = 10;     // ชีตจริงตอนนี้ยังเป็น 10
  g.cacheClear_(); g.applyItemCatalogue(); g.cacheClear_();
  eq('fixItemList แก้ชีส 10 ในชีตเป็น 15', g.findStockItem_('ชีส').price, 15);
}

section('ราคา 15 บาทที่กรอกเองในชีต ไม่ถูก fixItemList เขียนทับ');
g = fresh();
const S = g.__env.SHEETS[g.SHEET_ITEMS];
const pi = S.headers.indexOf('ราคาขาย/หน่วยย่อย');
S.rows.find(r => r[0] === 'เห็ดเข็ม')[pi] = 15;
g.cacheClear_();
g.applyItemCatalogue();
g.cacheClear_();
eq('เห็ดเข็มที่กรอก 15 เองยังเป็น 15', g.findStockItem_('เห็ดเข็ม').price, 15);
eq('ตัวอื่นยังเป็น 10', g.findStockItem_('ดอลลี่').price, 10);
S.rows.find(r => r[0] === 'ดอลลี่')[pi] = '';
g.cacheClear_(); g.applyItemCatalogue(); g.cacheClear_();
eq('ช่องว่างเติมราคาเริ่มต้นให้', g.findStockItem_('ดอลลี่').price, 10);

module.exports = done();
