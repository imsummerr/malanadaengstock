process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('เบเกอรี่ — นับก่อน/หลังขาย · เงิน · บัญชีแยก');

const NOW = Date.now();
const at = min => new Date(NOW - min * 60000);
const FL = ['ไดฟุกุ นมสด', 'ไดฟุกุ ช็อกโกแลต', 'ไดฟุกุ ชาเขียว', 'ไดฟุกุ โอริโอ้', 'บราวนี่ นูเทลล่า', 'บราวนี่ โอริโอ้'];
const rowsOf = qs => FL.map((n, i) => ({ item: n, qty: qs[i] }));
const staff = { role: 'staff', branch: SHOP, branches: [SHOP], name: 'ลลิตา' };

function setup() {
  const g = fresh();
  g.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
  g.CASH_DAY_CUT_HOURS = (new Date(NOW).getHours() + 16) % 24;   // วันทำการเริ่ม 8 ชม.ก่อน
  return g;
}

section('รายการสินค้า');
let g = setup();
const dk = g.findStockItem_('ไดฟุกุ นมสด'), br = g.findStockItem_('บราวนี่ โอริโอ้');
eq('ไดฟุกุ ชิ้นละ 10 เป็นเบเกอรี่', [dk.price, dk.kind, dk.subUnit, dk.bakery], [10, 'เบเกอรี่', 'ชิ้น', true]);
eq('มีทั้งครัวกลางและสาขา', dk.scope, '');
eq('ต้นทุน ไดฟุกุ 6.5 · บราวนี่ 6', [g.bakeryCost_('ไดฟุกุ ชาเขียว'), g.bakeryCost_('บราวนี่ นูเทลล่า')], [6.5, 6]);
eq('ครบ 6 รส', FL.every(n => g.findStockItem_(n)), true);
eq('เช็คสต็อกปิดร้านสาขาไม่ต้องนับเบเกอรี่', g.countItemsAt_(SHOP).some(i => i.bakery), false);
eq('ครัวกลางนับเบเกอรี่ด้วย', g.countItemsAt_(g.CENTRAL).filter(i => i.bakery).length, 6);

section('ครัวกลางรับเข้า → ส่งสาขา');
push(g, g.SHEET_INCOMING, { 'วันที่เวลา': at(600), 'สาขา': g.CENTRAL, 'รายการ': 'ไดฟุกุ นมสด', 'จำนวน': 20, 'ประเภท': 'ของเข้าครัวกลาง' });
push(g, g.SHEET_INCOMING, { 'วันที่เวลา': at(600), 'สาขา': g.CENTRAL, 'รายการ': 'บราวนี่ โอริโอ้', 'จำนวน': 10, 'ประเภท': 'ของเข้าครัวกลาง' });
push(g, g.SHEET_INCOMING, { 'วันที่เวลา': at(400), 'สาขา': SHOP, 'รายการ': 'ไดฟุกุ นมสด', 'จำนวน': 12, 'ประเภท': 'ของเข้าร้าน' });
push(g, g.SHEET_INCOMING, { 'วันที่เวลา': at(400), 'สาขา': SHOP, 'รายการ': 'บราวนี่ โอริโอ้', 'จำนวน': 6, 'ประเภท': 'ของเข้าร้าน' });
g.cacheClear_();
let s = g.costSummary_();
const cRow = n => (s.biz['เบเกอรี่'].stock[g.CENTRAL].rows.find(r => r.item === n) || {});
eq('ครัวกลางเหลือไดฟุกุ 8 × 6.5 = 52', cRow('ไดฟุกุ นมสด').value, 52);
eq('ครัวกลางเหลือบราวนี่ 4 × 6 = 24', cRow('บราวนี่ โอริโอ้').value, 24);
eq('ไม่ไปอยู่ในสต็อกหม่าล่า', (s.stock[g.CENTRAL] || { rows: [] }).rows.some(r => r.item === 'ไดฟุกุ นมสด'), false);

section('ก่อนขาย');
g.checkToken_ = () => staff;
let r = g.handleBakeryCount_({ token: 't', round: 'ก่อนขาย', rows: rowsOf([12, 0, 0, 0, 0, 6]) });
eq('บันทึกได้', r.success, true);
eq('ไม่บอกยอดเงินกับพนักงาน', r.expected, undefined);
let txt = g.__env.SENT.map(x => x.messages.map(m => m.text).join('\n')).join('\n');
eq('แจ้งกลุ่มสาขา', /🍡 เบเกอรี่ก่อนขาย — ตลาดทรัพย์พัฒนา[\s\S]*มีทั้งหมด 18 ชิ้น/.test(txt), true);
eq('ไม่ถูกนับเป็นรอบปิดร้านหม่าล่า', g.cashCountTimes_(SHOP).length, 0);

section('นับไม่ครบ / ไม่กรอกเงิน');
eq('ขาดรส', g.handleBakeryCount_({ token: 't', round: 'หลังขาย', rows: rowsOf([1, 0, 0, 0, 0]), money: { cash: 0, transfer: 0, thai: 0 } }).success, false);
eq('ไม่กรอกเงิน', g.handleBakeryCount_({ token: 't', round: 'หลังขาย', rows: rowsOf([1, 0, 0, 0, 0, 0]), money: { cash: 50 } }).success, false);

section('หลังขาย — ขาย 11 + 5 = 16 ชิ้น = 160 · ได้ 150 → ขาด 10');
g.__env.SENT.length = 0;
r = g.handleBakeryCount_({ token: 't', round: 'หลังขาย', rows: rowsOf([1, 0, 0, 0, 0, 1]),
  money: { cash: 100, transfer: 30, thai: 20 }, id: 'B1' });
eq('บันทึกได้', r.success, true);
eq('พนักงานไม่เห็นยอดที่ควรได้', r.expected, undefined);
txt = g.__env.SENT.map(x => x.messages.map(m => m.text).join('\n')).join('\n');
eq('ควรได้ 160', /ขายไป 16 ชิ้น × 10 = ควรได้ 160 บาท/.test(txt), true);
eq('ได้จริงแยกช่องทาง', /ได้จริง 150 บาท\n  เงินสด 100 · เงินโอน 30 · ไทยช่วยไทย 20/.test(txt), true);
eq('ขาด 10', /🔻 ขาด 10 บาท/.test(txt), true);
const bs = g.__env.SHEETS[g.SHEET_BAKERY];
eq('ลงชีตเบเกอรี่', bs.rows.length, 1);
eq('ผลเทียบ', bs.rows[0][bs.headers.indexOf('ผลเทียบ')], 'ขาด');
eq('ส่งซ้ำ id เดิม ไม่ลงซ้ำ', g.handleBakeryCount_({ token: 't', round: 'หลังขาย', rows: rowsOf([1, 0, 0, 0, 0, 1]),
  money: { cash: 100, transfer: 30, thai: 20 }, id: 'B1' }).duplicated, true);

section('กรอกหลังขายใหม่ (แก้ตัวเลข) — คิดจากก่อนขายเดิม รายได้ไม่นับซ้ำ');
g.__env.SENT.length = 0;
r = g.handleBakeryCount_({ token: 't', round: 'หลังขาย', rows: rowsOf([1, 0, 0, 0, 0, 1]),
  money: { cash: 110, transfer: 30, thai: 20 }, id: 'B2' });
txt = g.__env.SENT.map(x => x.messages.map(m => m.text).join('\n')).join('\n');
eq('ยังขาย 16 ชิ้น', /ขายไป 16 ชิ้น/.test(txt), true);
eq('ตรงแล้ว', /✅ เบเกอรี่ปิดร้าน/.test(txt), true);
eq('รายได้วันนี้ 160 (แถวล่าสุด)', g.bakeryIncome_()[SHOP]['รวม'], 160);

section('บัญชี — ต้นทุนเบเกอรี่ = 11 × 6.5 + 5 × 6 = 101.5');
g.cacheClear_();
s = g.costSummary_();
eq('สต็อกสาขาเหลือ 1 + 1', g.stockBalances_()[SHOP]['ไดฟุกุ นมสด'] + g.stockBalances_()[SHOP]['บราวนี่ โอริโอ้'], 2);
const bk = s.biz['เบเกอรี่'];
eq('ต้นทุนเบเกอรี่ที่ขายไป', bk.pl[SHOP]['ค่าใช้จ่ายวัตถุดิบ'], 101.5);
eq('รายได้เบเกอรี่ 160', bk.pl[SHOP]['รายได้'], 160);
eq('แยกช่องทางเงิน', [bk.pl[SHOP]['เงินสด'], bk.pl[SHOP]['เงินโอน'], bk.pl[SHOP]['ไทยช่วยไทย']], [110, 30, 20]);
eq('กำไรขั้นต้น 58.5', bk.pl[SHOP]['กำไรขั้นต้น'], 58.5);
eq('หม่าล่าไม่มีต้นทุนเบเกอรี่ปน', (s.pl[SHOP] || {})['ค่าใช้จ่ายวัตถุดิบ'] || 0, 0);
eq('หม่าล่าไม่มีรายได้เบเกอรี่ปน', (s.pl[SHOP] || {})['รายได้'] || 0, 0);

section('ค่าใช้จ่ายเบเกอรี่จากไลน์ หักในบัญชีเบเกอรี่เท่านั้น');
g.__env.SHEETS[g.SHEET_EXPENSE] = g.__env.SHEETS[g.SHEET_EXPENSE] || { headers: g.EXPENSE_HEADERS.slice(), rows: [] };
const EX = g.__env.SHEETS[g.SHEET_EXPENSE];
if (EX.headers.indexOf('ธุรกิจ') === -1) { EX.headers.push('ธุรกิจ'); EX.rows.forEach(r => r.push('')); }
const today = g.Utilities.formatDate(new Date(NOW), '', 'yyyy-MM-dd'), hm = g.Utilities.formatDate(new Date(NOW), '', 'HH:mm:ss');
push(g, g.SHEET_EXPENSE, { 'วันที่': today, 'เวลา': hm, 'สาขา': SHOP, 'ประเภท': 'อื่น ๆ', 'รายละเอียด': 'ค่ารถ', 'จำนวนเงิน': 50, 'ธุรกิจ': 'เบเกอรี่' });
push(g, g.SHEET_EXPENSE, { 'วันที่': today, 'เวลา': hm, 'สาขา': SHOP, 'ประเภท': 'ค่าแก๊ส', 'จำนวนเงิน': 450, 'ธุรกิจ': '' });
g.cacheClear_();
s = g.costSummary_();
eq('เบเกอรี่ ค่าใช้จ่ายอื่น 50 · กำไรสุทธิ 8.5', [s.biz['เบเกอรี่'].pl[SHOP]['ค่าใช้จ่ายอื่น'], s.biz['เบเกอรี่'].pl[SHOP]['กำไรสุทธิ']], [50, 8.5]);
eq('หม่าล่าได้ค่าแก๊ส 450 (ช่องว่าง = หม่าล่า)', s.pl[SHOP]['ค่าใช้จ่ายอื่น'], 450);

done();
