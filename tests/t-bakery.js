process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('เบเกอรี่ — นับก่อน/หลังขาย · เงิน · บัญชีแยก');

const NOW = Date.now();
const at = min => new Date(NOW - min * 60000);
const FL = ['ไดฟุกุ ครีมนม', 'ไดฟุกุ ช็อกโกแลต', 'ไดฟุกุ ชาเขียว', 'ไดฟุกุ โอริโอ้', 'บราวนี่ นูเทลล่า', 'บราวนี่ โอริโอ้', 'ไดฟุกุ สตอเบอร์รี่'];
const rowsOf = qs => FL.map((n, i) => ({ item: n, qty: qs[i] === undefined ? 0 : qs[i] }));
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
eq('ครบ 7 รส (สตอเบอร์รี่ 15/10)', FL.every(n => g.findStockItem_(n)), true);
eq('เช็คสต็อกปิดร้านสาขาไม่ต้องนับเบเกอรี่', g.countItemsAt_(SHOP).some(i => i.bakery), false);
eq('ครัวกลางนับเบเกอรี่ด้วย', g.countItemsAt_(g.CENTRAL).filter(i => i.bakery).length, 7);

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
eq('ขาดรส', g.handleBakeryCount_({ token: 't', round: 'หลังขาย', rows: rowsOf([1, 0, 0, 0, 0]).slice(0, 5), money: { cash: 0, transfer: 0, thai: 0 } }).success, false);
eq('ไม่กรอกเงิน', g.handleBakeryCount_({ token: 't', round: 'หลังขาย', rows: rowsOf([1, 0, 0, 0, 0, 0]), money: { cash: 50 } }).success, false);

section('หลังขาย — ขาย 11 + 5 = 16 ชิ้น = 160 · ได้ 150 → ขาด 10');
// 13/10: ยังไม่แจ้งค่าใช้จ่ายของวันนี้ → ไม่สรุป บอกว่ารออะไร
g.__env.SENT.length = 0;
r = g.handleBakeryCount_({ token: 't', round: 'หลังขาย', rows: rowsOf([1, 0, 0, 0, 0, 1]),
  money: { cash: 100, transfer: 30, thai: 20 }, id: 'B1' });
eq('บันทึกได้', r.success, true);
eq('พนักงานไม่เห็นยอดที่ควรได้', r.expected, undefined);
txt = g.__env.SENT.map(x => x.messages.map(m => m.text).join('\n')).join('\n');
eq('ข้อความนับไม่มีตัวเลขเงิน รอค่าใช้จ่าย', [/ควรได้|ขาด/.test(txt), /⏳ ยังไม่สรุปยอดวันที่ [\d/]+ — รอ แจ้งค่าใช้จ่าย/.test(txt), /ขายไป 16 ชิ้น/.test(txt)], [false, true, true]);
// เจ้าของแจ้งค่าใช้จ่ายของวันนี้ในไลน์ (ไม่มีค่าใช้จ่าย) → สรุปเลย
g.__env.SENT.length = 0;
g.expDoneMark_(SHOP, g.cashBizDay_(NOW), 'เจ้าของ', 0, 0, 'm0');
const sum1 = g.daySummaryAfter_(SHOP, g.cashBizDay_(NOW));
txt = g.__env.SENT.map(x => x.messages.map(m => m.text).join('\n')).join('\n');
eq('ส่งสรุปแล้ว', sum1.sent, true);
eq('ควรได้ 160', /ขายไป 16 ชิ้น → ควรได้ 160 บาท/.test(txt), true);
eq('ได้จริงแยกช่องทาง', /ได้จริง 150 บาท \(เงินสด 100 · โอน 30 · ไทยช่วยไทย 20\)/.test(txt), true);
eq('ขาด 10', /🍡 เบเกอรี่ ⚠️[\s\S]*🔻 ขาด 10 บาท/.test(txt), true);
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
eq('ตรงแล้ว (สรุปอัปเดต)', /🔄 อัปเดต[\s\S]*🍡 เบเกอรี่ ✅[\s\S]*→ ตรงกัน/.test(txt), true);
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

section('ไม่หารครึ่งให้ (14/10) — ไม่เขียนธุรกิจ = หม่าล่าทั้งก้อน · เขียนเบเกอรี่กำกับ = เบเกอรี่');
{
  const g2 = setup();
  const EX = g2.__env.SHEETS[g2.SHEET_EXPENSE] || (g2.__env.SHEETS[g2.SHEET_EXPENSE] = { headers: g2.EXPENSE_HEADERS.slice(), rows: [] });
  if (EX.headers.indexOf('ธุรกิจ') === -1) { EX.headers.push('ธุรกิจ'); EX.rows.forEach(r => r.push('')); }
  const d = g2.Utilities.formatDate(new Date(NOW), '', 'yyyy-MM-dd'), t = g2.Utilities.formatDate(new Date(NOW), '', 'HH:mm:ss');
  const ex = (type, amt, biz) => push(g2, g2.SHEET_EXPENSE, { 'วันที่': d, 'เวลา': t, 'สาขา': SHOP, 'ประเภท': type, 'จำนวนเงิน': amt, 'ธุรกิจ': biz || '' });
  ex('ค่าที่', 120); ex('ค่าแรง', 300); ex('ค่าน้ำแข็ง', 10); ex('อื่น ๆ', 40); ex('ค่าที่', 20, 'หม่าล่า');
  ex('ค่าที่', 60, 'เบเกอรี่'); ex('ค่าแรง', 150, 'เบเกอรี่');
  // วันนี้เบเกอรี่ขาย — เดิมจะหารครึ่งค่าที่/ค่าแรงที่ไม่เขียนธุรกิจ ตอนนี้ไม่หารแล้ว
  g2.checkToken_ = () => staff;
  g2.handleBakeryCount_({ token: 't', round: 'ก่อนขาย', rows: rowsOf([10, 0, 0, 0, 0, 0]) });
  g2.handleBakeryCount_({ token: 't', round: 'หลังขาย', rows: rowsOf([5, 0, 0, 0, 0, 0]), money: { cash: 50, transfer: 0, thai: 0 }, id: 'S1' });
  g2.cacheClear_();
  const sm = g2.costSummary_();
  const m = sm.pl[SHOP], b = sm.biz['เบเกอรี่'].pl[SHOP];
  eq('หม่าล่า: ค่าที่ 120+20 · ค่าแรง 300 · น้ำแข็ง 10 · อื่น 40 = 490', m['ค่าใช้จ่ายอื่น'], 490);
  eq('เบเกอรี่: เฉพาะที่เขียนกำกับ ค่าที่ 60 · ค่าแรง 150 = 210', b['ค่าใช้จ่ายอื่น'], 210);
  eq('แยกตามประเภท', [b['ตามประเภท']['ค่าที่'], b['ตามประเภท']['ค่าแรง'], b['ตามประเภท']['ค่าน้ำแข็ง']], [60, 150, undefined]);
  eq('รวม = ยอดในชีตพอดี 700', sm.biz['รวม'].pl[SHOP]['ค่าใช้จ่ายอื่น'], 700);
  eq('บัญชีรวม: แต่ละแถวขึ้นครั้งเดียว ยอดเต็ม', sm.biz['รวม'].pl[SHOP]['รายการค่าใช้จ่าย'].map(e => e['บาท']).sort((x, y) => x - y),
     [10, 20, 40, 60, 120, 150, 300]);
  // ไลน์: ค่าพนักงาน = ค่าแรง ไม่เขียนธุรกิจ = ปล่อยว่าง (หม่าล่า) · ไม่บอกว่าแบ่ง
  const ctx = { location: g2.CENTRAL, who: 'เจ้าของ', msgId: 'm', isGroup: true };
  const o = g2.intakeSaveAndSummarize_(g2.intakeParseText_('สาขาทรัพย์พัฒนา ค่าพนักงาน 300'), ctx, 'ข้อความ', 'x', []);
  const last = EX.rows.slice(-1)[0];
  eq('ไลน์ ค่าพนักงาน → ค่าแรง ธุรกิจว่าง', [last[EX.headers.indexOf('ประเภท')], last[EX.headers.indexOf('ธุรกิจ')]], ['ค่าแรง', '']);
  eq('ตอบไม่พูดถึงแบ่งครึ่งแล้ว', /แบ่ง/.test(o), false);
  // พิมพ์แบ่งเอง: หัวหม่าล่า / หัวเบเกอรี่
  const n0 = EX.rows.length;
  g2.intakeSaveAndSummarize_(g2.intakeParseText_('หม่าล่า ทรัพย์\nค่าที่ 60\nเบเกอรี่ ทรัพย์\nค่าที่ 60'), ctx, 'ข้อความ', 'y', []);
  eq('พิมพ์แยกเอง → หม่าล่า 60 · เบเกอรี่ 60', EX.rows.slice(n0).map(r => [r[EX.headers.indexOf('จำนวนเงิน')], r[EX.headers.indexOf('ธุรกิจ')] || 'หม่าล่า']),
     [[60, 'หม่าล่า'], [60, 'เบเกอรี่']]);
}

section('ก่อนและหลังเบเกอรี่เริ่มขาย 9/10 — ไม่เขียนธุรกิจเป็นหม่าล่าทุกวัน');
{
  const g3 = fresh();
  g3.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
  const EX = g3.__env.SHEETS[g3.SHEET_EXPENSE] || (g3.__env.SHEETS[g3.SHEET_EXPENSE] = { headers: g3.EXPENSE_HEADERS.slice(), rows: [] });
  if (EX.headers.indexOf('ธุรกิจ') === -1) { EX.headers.push('ธุรกิจ'); EX.rows.forEach(r => r.push('')); }
  const ex = (d, type, amt, biz) => push(g3, g3.SHEET_EXPENSE, { 'วันที่': d, 'เวลา': '18:00:00', 'สาขา': SHOP, 'ประเภท': type, 'จำนวนเงิน': amt, 'ธุรกิจ': biz || '' });
  ex('2026-10-07', 'ค่าที่', 120); ex('2026-10-07', 'ค่าแรง', 300);
  ex('2026-10-09', 'ค่าที่', 120); ex('2026-10-09', 'ค่าแรง', 300);
  ex('2026-10-10', 'ค่าที่', 60); ex('2026-10-10', 'ค่าที่', 60, 'เบเกอรี่');
  g3.bakerySheet_();
  const BS = g3.__env.SHEETS[g3.SHEET_BAKERY];
  const brow = (d, money, sold) => BS.rows.push([d, '21:00:00', SHOP, 'ลลิตา', money, 0, 0, money, sold, sold * 10, 0, 'ตรง', '', 'x' + d]);
  brow('2026-10-08', 40, 4);     // กรอกลองระบบก่อนเริ่มขาย — ไม่นับ
  brow('2026-10-09', 200, 20);   // 9/10 ขายเบเกอรี่
  g3.cacheClear_();
  const sm = g3.costSummary_();
  eq('หม่าล่า: 7/10 420 + 9/10 420 + 10/10 60 = 900', sm.pl[SHOP]['ค่าใช้จ่ายอื่น'], 900);
  eq('เบเกอรี่: เฉพาะที่เขียนกำกับ 60', sm.biz['เบเกอรี่'].pl[SHOP]['ค่าใช้จ่ายอื่น'], 60);
  eq('รายได้เบเกอรี่ไม่นับวันลองระบบ 8/10', sm.biz['เบเกอรี่'].pl[SHOP]['รายได้'], 200);
  eq('รวมยังเท่าค่าใช้จ่ายจริง 960', sm.biz['รวม'].pl[SHOP]['ค่าใช้จ่ายอื่น'], 960);
}

done();
