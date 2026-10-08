process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('เบเกอรี่ — นับก่อน/หลังขาย · เงิน · บัญชีแยก');

const NOW = Date.now();
const at = min => new Date(NOW - min * 60000);
const FL = ['ไดฟุกุ ครีมนม', 'ไดฟุกุ ช็อกโกแลต', 'ไดฟุกุ ชาเขียว', 'ไดฟุกุ โอริโอ้', 'บราวนี่ นูเทลล่า', 'บราวนี่ โอริโอ้'];
const rowsOf = qs => FL.map((n, i) => ({ item: n, qty: qs[i] }));
const staff = { role: 'staff', branch: SHOP, branches: [SHOP], name: 'ลลิตา' };

function setup() {
  const g = fresh();
  g.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
  g.CASH_DAY_CUT_HOURS = (new Date(NOW).getHours() + 16) % 24;   // วันทำการเริ่ม 8 ชม.ก่อน
  g.BAKERY_START_DATE = '2000-01-01';                              // เทสต์ใช้เวลาจริง ไม่ผูกกับวันเริ่มขาย
  return g;
}

section('รายการสินค้า');
let g = setup();
const dk = g.findStockItem_('ไดฟุกุ ครีมนม'), br = g.findStockItem_('บราวนี่ โอริโอ้');
eq('ไดฟุกุ: แพ็ค = 2 ชุด · ชุด = 40 ลูก · ชุดละ 400 (ลูกละ 10)', [dk.packUnit, dk.perPack, dk.subUnit, dk.perStick, dk.price, dk.kind, dk.bakery],
   ['แพ็ค', 2, 'ชุด', 40, 400, 'เบเกอรี่', true]);
eq('บราวนี่: แพ็ค = 25 ชิ้น · ชิ้นละ 10', [br.packUnit, br.perPack, br.subUnit, br.perStick, br.price], ['แพ็ค', 25, 'ชิ้น', 1, 10]);
eq('ยอดเก็บเป็นลูก/ชิ้น', [g.baseUnitOf_(dk), g.toBase_(1, 1, 5, dk), g.fmtPack_(125, dk)], ['ชิ้น', 125, '1 แพ็ค 1 ชุด 5 ชิ้น']);
eq('มีทั้งครัวกลางและสาขา', dk.scope, '');
eq('ต้นทุน ไดฟุกุ 6.5 · บราวนี่ 6', [g.bakeryCost_('ไดฟุกุ ชาเขียว'), g.bakeryCost_('บราวนี่ นูเทลล่า')], [6.5, 6]);
eq('ครบ 6 รส', FL.every(n => g.findStockItem_(n)), true);
eq('เช็คสต็อกปิดร้านสาขาไม่ต้องนับเบเกอรี่', g.countItemsAt_(SHOP).some(i => i.bakery), false);
eq('ครัวกลางนับเบเกอรี่ด้วย', g.countItemsAt_(g.CENTRAL).filter(i => i.bakery).length, 6);

section('ครัวกลางรับเข้า → ส่งสาขา');
push(g, g.SHEET_INCOMING, { 'วันที่เวลา': at(600), 'สาขา': g.CENTRAL, 'รายการ': 'ไดฟุกุ ครีมนม', 'จำนวน': 20, 'ประเภท': 'ของเข้าครัวกลาง' });
push(g, g.SHEET_INCOMING, { 'วันที่เวลา': at(600), 'สาขา': g.CENTRAL, 'รายการ': 'บราวนี่ โอริโอ้', 'จำนวน': 10, 'ประเภท': 'ของเข้าครัวกลาง' });
push(g, g.SHEET_INCOMING, { 'วันที่เวลา': at(400), 'สาขา': SHOP, 'รายการ': 'ไดฟุกุ ครีมนม', 'จำนวน': 12, 'ประเภท': 'ของเข้าร้าน' });
push(g, g.SHEET_INCOMING, { 'วันที่เวลา': at(400), 'สาขา': SHOP, 'รายการ': 'บราวนี่ โอริโอ้', 'จำนวน': 6, 'ประเภท': 'ของเข้าร้าน' });
g.cacheClear_();
let s = g.costSummary_();
const cRow = n => (s.biz['เบเกอรี่'].stock[g.CENTRAL].rows.find(r => r.item === n) || {});
eq('ครัวกลางเหลือไดฟุกุ 8 × 6.5 = 52', cRow('ไดฟุกุ ครีมนม').value, 52);
eq('ครัวกลางเหลือบราวนี่ 4 × 6 = 24', cRow('บราวนี่ โอริโอ้').value, 24);
eq('ไม่ไปอยู่ในสต็อกหม่าล่า', (s.stock[g.CENTRAL] || { rows: [] }).rows.some(r => r.item === 'ไดฟุกุ ครีมนม'), false);

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
eq('สต็อกสาขาเหลือ 1 + 1', g.stockBalances_()[SHOP]['ไดฟุกุ ครีมนม'] + g.stockBalances_()[SHOP]['บราวนี่ โอริโอ้'], 2);
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

section('บัญชีรวม = หม่าล่า + เบเกอรี่');
const tot = s.biz['รวม'].pl[SHOP];
eq('รายได้รวม', tot['รายได้'], (s.pl[SHOP]['รายได้'] || 0) + 160);
eq('ขายเบเกอรี่แยกให้เห็น', tot['ขายเบเกอรี่'], 160);
eq('ค่าใช้จ่ายอื่นรวม 500', tot['ค่าใช้จ่ายอื่น'], 500);
eq('กำไรสุทธิรวม = สองฝั่งบวกกัน', tot['กำไรสุทธิ'], Math.round((s.pl[SHOP]['กำไรสุทธิ'] + s.biz['เบเกอรี่'].pl[SHOP]['กำไรสุทธิ']) * 100) / 100);
eq('สต็อกรวมมีเบเกอรี่', s.biz['รวม'].stock[g.CENTRAL].rows.some(r => r.item === 'ไดฟุกุ ครีมนม'), true);
g.buildLocationPL();
const PL = g.__env.SHEETS['บัญชี_กำไรแต่ละที่'];
const plRows = (PL.rows || []).filter(r => r[0] === SHOP).map(r => r[1]);
eq('ชีตบัญชี 3 แถวต่อที่', plRows, ['รวม', 'หม่าล่า', 'เบเกอรี่']);

section('ค่าที่ / ค่าพนักงาน แบ่งครึ่ง · อย่างอื่นหม่าล่า');
{
  const g2 = setup();
  const EX = g2.__env.SHEETS[g2.SHEET_EXPENSE] || (g2.__env.SHEETS[g2.SHEET_EXPENSE] = { headers: g2.EXPENSE_HEADERS.slice(), rows: [] });
  if (EX.headers.indexOf('ธุรกิจ') === -1) { EX.headers.push('ธุรกิจ'); EX.rows.forEach(r => r.push('')); }
  const d = g2.Utilities.formatDate(new Date(NOW), '', 'yyyy-MM-dd'), t = g2.Utilities.formatDate(new Date(NOW), '', 'HH:mm:ss');
  const ex = (type, amt, biz) => push(g2, g2.SHEET_EXPENSE, { 'วันที่': d, 'เวลา': t, 'สาขา': SHOP, 'ประเภท': type, 'จำนวนเงิน': amt, 'ธุรกิจ': biz || '' });
  ex('ค่าที่', 120); ex('ค่าแรง', 300); ex('ค่าน้ำแข็ง', 10); ex('อื่น ๆ', 40); ex('ค่าที่', 20, 'หม่าล่า');
  g2.cacheClear_();
  let sm = g2.costSummary_();
  eq('วันนี้เบเกอรี่ยังไม่ได้ขาย → ค่าที่ ค่าแรง เป็นหม่าล่าทั้งหมด 490', sm.pl[SHOP]['ค่าใช้จ่ายอื่น'], 490);
  eq('เบเกอรี่ไม่โดนหัก', (sm.biz['เบเกอรี่'].pl[SHOP] || {})['ค่าใช้จ่ายอื่น'] || 0, 0);
  // พนักงานกรอกยอดเบเกอรี่วันนี้ (มีขาย) → แบ่งครึ่ง
  g2.checkToken_ = () => staff;
  g2.handleBakeryCount_({ token: 't', round: 'ก่อนขาย', rows: rowsOf([10, 0, 0, 0, 0, 0]) });
  g2.handleBakeryCount_({ token: 't', round: 'หลังขาย', rows: rowsOf([5, 0, 0, 0, 0, 0]), money: { cash: 50, transfer: 0, thai: 0 }, id: 'S1' });
  g2.cacheClear_();
  sm = g2.costSummary_();
  const m = sm.pl[SHOP], b = sm.biz['เบเกอรี่'].pl[SHOP];
  eq('หม่าล่า: ค่าที่ 60+20 · ค่าแรง 150 · น้ำแข็ง 10 · อื่น 40 = 280', m['ค่าใช้จ่ายอื่น'], 280);
  eq('เบเกอรี่: ค่าที่ 60 · ค่าแรง 150 = 210', b['ค่าใช้จ่ายอื่น'], 210);
  eq('แยกตามประเภท', [b['ตามประเภท']['ค่าที่'], b['ตามประเภท']['ค่าแรง'], b['ตามประเภท']['ค่าน้ำแข็ง']], [60, 150, undefined]);
  // ไลน์: ค่าพนักงาน = ค่าแรง ไม่เขียนธุรกิจ = แบ่งครึ่ง
  const ctx = { location: g2.CENTRAL, who: 'เจ้าของ', msgId: 'm', isGroup: true };
  const o = g2.intakeSaveAndSummarize_(g2.intakeParseText_('สาขาทรัพย์พัฒนา ค่าพนักงาน 300'), ctx, 'ข้อความ', 'x', []);
  const last = EX.rows.slice(-1)[0];
  eq('ไลน์ ค่าพนักงาน → ค่าแรง ธุรกิจว่าง', [last[EX.headers.indexOf('ประเภท')], last[EX.headers.indexOf('ธุรกิจ')]], ['ค่าแรง', '']);
  eq('ตอบว่าแบ่งครึ่ง', /แบ่งครึ่ง หม่าล่า\/เบเกอรี่/.test(o), true);
}

section('เบเกอรี่เริ่มขาย 9/10 — ก่อนนั้นค่าที่ค่าแรงเป็นหม่าล่าทั้งหมด · แบ่งเฉพาะวันที่เบเกอรี่ขาย');
{
  const g3 = fresh();
  g3.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
  const EX = g3.__env.SHEETS[g3.SHEET_EXPENSE] || (g3.__env.SHEETS[g3.SHEET_EXPENSE] = { headers: g3.EXPENSE_HEADERS.slice(), rows: [] });
  if (EX.headers.indexOf('ธุรกิจ') === -1) { EX.headers.push('ธุรกิจ'); EX.rows.forEach(r => r.push('')); }
  const ex = (d, type, amt) => push(g3, g3.SHEET_EXPENSE, { 'วันที่': d, 'เวลา': '18:00:00', 'สาขา': SHOP, 'ประเภท': type, 'จำนวนเงิน': amt, 'ธุรกิจ': '' });
  ex('2026-10-07', 'ค่าที่', 120); ex('2026-10-07', 'ค่าแรง', 300);
  ex('2026-10-09', 'ค่าที่', 120); ex('2026-10-09', 'ค่าแรง', 300);
  ex('2026-10-10', 'ค่าที่', 120); ex('2026-10-10', 'ค่าแรง', 300);
  g3.bakerySheet_();
  const BS = g3.__env.SHEETS[g3.SHEET_BAKERY];
  const brow = (d, money, sold) => BS.rows.push([d, '21:00:00', SHOP, 'ลลิตา', money, 0, 0, money, sold, sold * 10, 0, 'ตรง', '', 'x' + d]);
  brow('2026-10-08', 40, 4);     // กรอกลองระบบก่อนเริ่มขาย — ไม่นับ
  brow('2026-10-09', 200, 20);   // 9/10 ขายเบเกอรี่
  brow('2026-10-10', 0, 0);      // 10/10 กรอกแต่ไม่มีขาย
  g3.cacheClear_();
  const sm = g3.costSummary_();
  eq('หม่าล่า: 7/10 เต็ม 420 + 9/10 ครึ่ง 210 + 10/10 เต็ม 420 = 1050', sm.pl[SHOP]['ค่าใช้จ่ายอื่น'], 1050);
  eq('เบเกอรี่: แค่ 9/10 = ค่าที่ 60 + ค่าแรง 150 = 210', sm.biz['เบเกอรี่'].pl[SHOP]['ค่าใช้จ่ายอื่น'], 210);
  eq('รายได้เบเกอรี่ไม่นับวันลองระบบ 8/10', sm.biz['เบเกอรี่'].pl[SHOP]['รายได้'], 200);
  eq('รวมยังเท่าค่าใช้จ่ายจริง 1260', sm.biz['รวม'].pl[SHOP]['ค่าใช้จ่ายอื่น'], 1260);
}

done();
