process.env.TZ = 'Asia/Bangkok';
const { makeCheck, formatDate } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('ปิดร้าน — เทียบเงินสด');

const NOW = Date.now();
const at = min => new Date(NOW - min * 60000);
const ymd = d => formatDate(d, '', 'yyyy-MM-dd');
const hms = d => formatDate(d, '', 'HH:mm:ss');

// วันทำการในเทสต์ให้เริ่ม 8 ชม.ก่อนตอนนี้ — ไม่งั้นรันช่วงตี 4–ตี 6 บิลจะตกไปวันก่อน
const CUT = (new Date(NOW).getHours() + 16) % 24;
function setup(withCount) {
  const g = fresh();
  g.CASH_DAY_CUT_HOURS = CUT;
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
eq('ค่าใช้จ่ายที่โอนจ่ายไม่ถูกหัก', /ค่าใช้จ่ายเงินสดวันที่ \d+\/\d+   50/.test(txt), true);
eq('แยกโอนกับไทยช่วยไทย', /ลูกค้าโอน   60[\s\S]*ไทยช่วยไทย   40/.test(txt), true);
eq('ของเสียไม่คิดเป็นเงิน — บอกว่าหักแล้ว', /หักของเสียออกแล้ว 2 ชิ้น 20 บาท: มันเทศ 2 ถุง/.test(txt), true);
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

section('ล้างยอดติดลบจากหน้า Apps Script (ไม่มีกล่องถาม) = ครัวกลาง');
g = fresh();
push(g, g.SHEET_INCOMING, { 'วันที่เวลา': at(60), 'สาขา': SHOP, 'รายการ': 'น้ำจิ้มงา (กระปุก)',
  'จำนวน': 7, 'ประเภท': 'ของเข้าร้าน' });
g.zeroNegativeStock();
g.cacheClear_();
eq('ครัวกลางน้ำจิ้มงาเป็น 0', g.stockBalances_()[g.CENTRAL]['น้ำจิ้มงา (กระปุก)'], 0);
eq('บอกผลใน log', g.__env.LOG.some(l => /✅ ครัวกลาง — ตั้งเป็น 0 แล้ว 1 รายการ/.test(l)), true);

section('กะหล่ำ ของแถม ไม่คิดเงิน');
{
  const gk = fresh();
  const k = gk.findStockItem_('กะหล่ำ');
  eq('ราคา 0', k.price, 0);
  eq('เป็นของแถม', k.free, true);
  eq('สาขานับเป็น กก.', k.subUnit, 'กก.');
  eq('ของดิบชั่งเป็น กก.', gk.findStockItem_('กะหล่ำ (ดิบ)').subUnit, 'กก.');
  const u = gk.auditUsage_([{ item: k, counted: 1, sys: 3, diff: -2 },
                            { item: gk.findStockItem_('ดอลลี่'), counted: 5, sys: 8, diff: -3 }]);
  eq('กะหล่ำไม่นับเป็นชิ้นที่ออกจากชั้น', u.piece.used, 3);
  eq('ไม่ขึ้นว่ายังไม่ตั้งราคา', u.noPrice.indexOf('กะหล่ำ'), -1);
  eq('ไม่ขึ้นว่าหน่วยกิโลต้องแก้', u.rawUnits.indexOf('กะหล่ำ'), -1);
  eq('บอกว่าแถมไป 2 กก.', u.free.used, 2);
}

section('นับกลางวันหลังขายไปแล้ว แล้วกรอกเงินก่อนนับปิด (เหตุการณ์ 7/10)');
{
  const g = fresh();
  g.CASH_DAY_CUT_HOURS = CUT;
  const S = g.__env.SHEETS;
  S[g.SHEET_EXPENSE] = { headers: g.EXPENSE_HEADERS.slice(), rows: [] };
  const cnt = (min, rows, by) => rows.forEach(([i, q]) => push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(min),
    'สาขา': SHOP, 'รายการ': i, 'จำนวน': q, 'ประเภท': 'เช็คสต็อก', 'ผู้ตรวจ': by || 'ลลิตา' }));
  const ord = (min, net, how) => push(g, g.SHEET_ORDERS, { 'วันที่': ymd(at(min)), 'เวลา': hms(at(min)),
    'สาขา': SHOP, 'ยอดรวม': net, 'ส่วนลด': 0, 'ยอดสุทธิ': net, 'รวมไม้': net / 10, 'วิธีชำระเงิน': how || 'เงินสด' });
  const exp = (min, amt) => push(g, g.SHEET_EXPENSE, { 'วันที่': ymd(at(min)), 'เวลา': hms(at(min)),
    'สาขา': SHOP, 'ประเภท': 'ค่าน้ำแข็ง', 'จำนวนเงิน': amt, 'วิธีจ่าย': 'เงินสด' });
  // เมื่อวาน: นับปิด แล้วจ่ายค่าไม้เสียบหลังนับ (ยังเป็นเงินเมื่อวาน)
  cnt(24 * 60, [['ดอลลี่', 5]]);
  exp(24 * 60 - 3, 23);
  // วันนี้: ของมาส่งแต่ไม่ได้ลงของเข้า · ขาย 2 บิลก่อนนับ · เจ้าของนับกลางวัน
  ord(300, 60); ord(290, 40, 'ไทยช่วยไทย');
  cnt(280, [['ดอลลี่', 40]], 'เจ้าของร้าน');
  ord(200, 100); ord(150, 50, 'สแกน/โอนผ่านธนาคาร');
  exp(250, 10);
  // พนักงานกรอกเงิน ยังไม่ได้นับปิด
  g.checkToken_ = () => ({ role: 'staff', branch: SHOP, branches: [SHOP], name: 'ลลิตา' });
  let r = g.handleCashClose_({ token: 't', close: { cash: 150, closeId: 'M1' } });
  eq('ยังไม่นับหลังบิลสุดท้าย → รอ ไม่เอารอบกลางวันมาเทียบ', r.waiting, true);
  eq('ไม่ส่งไลน์ยอดติดลบ', g.__env.SENT.length, 0);
  eq('บอกพนักงานให้นับปิด', /นับสต็อกปิดร้าน/.test(r.message), true);
  // นับปิด: ดอลลี่ 25 → ขายตั้งแต่รอบกลางวัน 15 ไม้ = 150
  cnt(1, [['ดอลลี่', 25]]);
  const c = g.cashCheckAfterCount_(SHOP, new Date());
  // 150 − โอน 50 + เงินสดบิลก่อนนับกลางวัน 60 − ค่าใช้จ่ายวันนี้ 10 = 150 (ค่าไม้เสียบเมื่อวานไม่หัก)
  eq('ควรมี 150', c.expected, 150);
  eq('เงินตรง', c.ok, true);
  const t = g.__env.SENT.map(x => x.messages[0].text).join('\n');
  eq('ช่วงนับเริ่มจากรอบล่าสุดที่ลง (กลางวัน)', /นับสต็อก .* → /.test(t) && /\+ เงินสดบิลก่อนนับรอบ \d\d:\d\d   60/.test(t), true);
  eq('ไม่หักค่าใช้จ่ายเมื่อวาน', /ค่าใช้จ่ายเงินสดวันที่ \d+\/\d+   10\n/.test(t), true);
  eq('POS วันนี้ 4 บิล เงินสด 160', /ขายเงินสดวันที่ \d+\/\d+ 160 บาท \(ทั้งหมด 4 บิล\)/.test(t), true);
}

section('กรอกเงินเมื่อคืน แล้วนับปิดเช้าวันรุ่งขึ้น');
{
  const g = fresh();
  g.CASH_DAY_CUT_HOURS = CUT;
  const S = g.__env.SHEETS;
  S[g.SHEET_EXPENSE] = { headers: g.EXPENSE_HEADERS.slice(), rows: [] };
  push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(30 * 60), 'สาขา': SHOP, 'รายการ': 'ดอลลี่', 'จำนวน': 20, 'ประเภท': 'เช็คสต็อก' });
  push(g, g.SHEET_ORDERS, { 'วันที่': ymd(at(26 * 60)), 'เวลา': hms(at(26 * 60)), 'สาขา': SHOP,
    'ยอดรวม': 50, 'ส่วนลด': 0, 'ยอดสุทธิ': 50, 'รวมไม้': 5, 'วิธีชำระเงิน': 'เงินสด' });
  // ระบบเก่าเทียบผิดไว้แล้ว (เกิน) — นับปิดตอนเช้าต้องเทียบใหม่ทับ
  S[g.SHEET_CASH] = { headers: g.CASH_HEADERS.slice(), rows: [[ymd(at(25 * 60)), hms(at(25 * 60)), SHOP, 'ลลิตา', 50, '', 'Y1', -1921, 2141, 'เกิน']] };
  push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(1), 'สาขา': SHOP, 'รายการ': 'ดอลลี่', 'จำนวน': 15, 'ประเภท': 'เช็คสต็อก' });
  const c = g.cashCheckAfterCount_(SHOP, new Date());
  eq('เทียบเงินของเมื่อวานให้', c && c.expected, 50);
  eq('ตรง', c && c.ok, true);
  const cs = S[g.SHEET_CASH];
  eq('ผลในชีตถูกเขียนทับเป็นตรง', cs.rows[0][cs.headers.indexOf('ผลเทียบ')], 'ตรง');
  eq('นับซ้ำอีกรอบตอนสาย ๆ ไม่เทียบซ้ำ', (push(g, g.SHEET_COUNT, { 'วันที่เวลา': new Date(NOW + 30 * 60000), 'สาขา': SHOP,
    'รายการ': 'ดอลลี่', 'จำนวน': 15, 'ประเภท': 'เช็คสต็อก' }), g.cashCheckAfterCount_(SHOP, new Date(NOW + 30 * 60000))), null);
}

section('ลืมนับและลืมกรอกเงินตอนปิด → เช้าวันถัดไปนับ+กรอก = ยอดของเมื่อวาน');
{
  const g = fresh();
  g.CASH_DAY_CUT_HOURS = CUT;
  const S = g.__env.SHEETS;
  S[g.SHEET_EXPENSE] = { headers: g.EXPENSE_HEADERS.slice(), rows: [] };
  const today = g.cashBizDay_(NOW), t0 = g.cashDayStart_(today);
  const T = h => new Date(t0 + h * 3600000);
  const cnt = (d, q) => push(g, g.SHEET_COUNT, { 'วันที่เวลา': d, 'สาขา': SHOP, 'รายการ': 'ดอลลี่', 'จำนวน': q, 'ประเภท': 'เช็คสต็อก' });
  const ord = (d, net, how) => push(g, g.SHEET_ORDERS, { 'วันที่': ymd(d), 'เวลา': hms(d), 'สาขา': SHOP,
    'ยอดรวม': net, 'ส่วนลด': 0, 'ยอดสุทธิ': net, 'รวมไม้': net / 10, 'วิธีชำระเงิน': how || 'เงินสด' });
  cnt(T(-23), 30);                                   // เมื่อวานก่อนเปิด
  ord(T(-20), 80); ord(T(-19), 40, 'สแกน/โอนผ่านธนาคาร');
  cnt(T(1), 18);                                     // ลืมนับเย็น — มานับเช้านี้ ขายไป 12
  const yday = g.cashBizDay_(T(-20).getTime());
  r = g.handleCashClose_({ token: 't', close: { branch: SHOP, cash: 80, closeId: 'LATE' } });
  eq('เงินที่กรอกเช้านี้นับเป็นของเมื่อวาน', g.cashDayOfRow_(SHOP, { ms: Date.now() }), yday);
  eq('เทียบเลย 120 − โอน 40 = 80', r.expected, 80);
  eq('ตรง', r.diff, 0);
  eq('ไม่นับซ้ำเป็นเงินของวันนี้', g.cashRowsForDay_(SHOP, today).length, 0);
  ord(new Date(NOW + 60000), 50);
  eq('ขายวันนี้แล้ว กรอกใหม่ = เงินของวันนี้', g.cashDayOfRow_(SHOP, { ms: NOW + 120000 }), today);
}

section('ส่งไลน์รวมทีเดียว');
{
  const gb = fresh();
  const r = gb.withLineBatch_(() => { gb.stockNotify_(SHOP, 'ก'); gb.stockNotify_(SHOP, 'ข'); gb.stockNotify_(gb.CENTRAL, 'ค'); return { success: true }; });
  eq('ยิง LINE 2 ครั้ง (แยกกลุ่ม) ไม่ใช่ 3', gb.__env.SENT.length, 2);
  eq('กลุ่มสาขาได้ 2 ข้อความในครั้งเดียว', gb.__env.SENT[0].messages.map(m => m.text), ['ก', 'ข']);
  eq('ผลลัพธ์ผ่านกลับมา', r.success, true);
  gb.__env.SENT.length = 0;
  gb.withLineBatch_(() => { for (let i = 0; i < 7; i++) gb.stockNotify_(SHOP, 'm' + i); return {}; });
  eq('เกิน 5 ข้อความแบ่งส่ง', gb.__env.SENT.map(x => x.messages.length), [5, 2]);
  gb.stockNotify_(SHOP, 'นอกชุด');
  eq('นอกชุดส่งทันทีเหมือนเดิม', gb.__env.SENT.length, 3);
}

module.exports = done();
