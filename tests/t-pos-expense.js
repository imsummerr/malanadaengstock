process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('หน้า POS — ค่าใช้จ่ายเฉพาะหม่าล่า');
const { send } = require('./t-intake');

// ข้อความจริง 9/10 — ค่าที่หม่าล่า 180 · ค่าที่เบเกอรี่ 60 (โอน)
const g = fresh();
send(g, ['หม่าล่า ทรัพย์พัฒนา', 'ค่าที่ 180', 'เบเกอรี่ ทรัพย์พัฒนา', 'ค่าที่ 60'].join('\n'), 'pe1');
// จ่ายเงินสดหน้าร้านจาก POS ด้วย 1 รายการ
g.checkToken_ = () => ({ role: 'staff', branch: SHOP, branches: [SHOP], name: 'พนง.' });
g.handleExpense_({ token: 't', expense: { expenseId: 'E1', branch: SHOP, type: 'ค่าน้ำแข็ง', amount: 40, method: 'เงินสด' } });

const ex = g.__env.SHEETS[g.SHEET_EXPENSE];
const c = h => ex.headers.indexOf(h);
eq('ชีตยังเก็บครบ 3 แถว (บัญชีเบเกอรี่ใช้)', ex.rows.map(r => [r[c('ประเภท')], r[c('จำนวนเงิน')], r[c('ธุรกิจ')] || '']),
   [['ค่าที่', 180, 'หม่าล่า'], ['ค่าที่', 60, 'เบเกอรี่'], ['ค่าน้ำแข็ง', 40, '']]);

section('ที่บันทึกไว้วันนี้ (หน้า POS)');
const today = g.Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
const d = g.handleBills_({ token: 't', date: today }).data;
eq('ไม่มีค่าที่เบเกอรี่ 60', d.expenses.map(x => x.type + ' ' + x.amount).sort(), ['ค่าที่ 180', 'ค่าน้ำแข็ง 40']);
eq('รวมค่าใช้จ่าย 220', d.expenseTotal, 220);
eq('หักจากเงินสดแค่ 40', d.expenseCash, 40);

section('สรุปยอด / ปิดร้าน');
const st = g.emptyStats_();
g.addExpenseStats_(st, today, today, SHOP);
eq('สรุปยอดไม่รวมเบเกอรี่', [st.expenseTotal, st.expenseCount], [220, 2]);
const a = g.auditSales_(SHOP, 0, Date.now() + 60000);
eq('ปิดร้านหักเงินสด 40 · โอน 180', [a.expCash, a.expOther], [40, 180]);

section('ไลน์: ค่าพนักงานไม่บอกสาขา = หักสาขา ไม่ใช่ครัวกลาง (9/10)');
{
  const gw = fresh();
  const rows = () => { const e = gw.__env.SHEETS[gw.SHEET_EXPENSE], k = h => e.headers.indexOf(h);
    return e.rows.map(r => [r[k('ประเภท')], r[k('สาขา')], r[k('จำนวนเงิน')], r[k('ธุรกิจ')] || '']); };
  const out = send(gw, 'ค่าพนักงาน 300', 'w1');
  eq('ค่าพนักงาน 300 → ค่าแรง ของสาขา ไม่บอกธุรกิจ (= หม่าล่า)', rows()[0], ['ค่าแรง', SHOP, 300, '']);
  eq('ตอบกลับบอกว่าลงสาขา', /ค่าใช้จ่าย ตลาดทรัพย์พัฒนา\n• ค่าพนักงาน — 300 บาท/.test(out), true);
  send(gw, 'ครัวกลาง\nค่าพนักงาน 250', 'w2');
  send(gw, 'ค่าแรง ครัวกลาง 200', 'w3');
  send(gw, 'ค่าแก๊ส 450', 'w4');
  eq('เขียนครัวกลางมาเอง = ครัวกลาง', rows().slice(1, 3).map(r => r[1]), [gw.CENTRAL, gw.CENTRAL]);
  eq('ค่าใช้จ่ายอื่นไม่บอกสาขา ยังเป็นครัวกลาง', rows()[3][1], gw.CENTRAL);
}

section('ไลน์: "หม่าล่า ทรัพย์" (ชื่อเล่นสาขา) — 12/10 เคยไปลงครัวกลาง');
{
  const gn = fresh();
  const ex = () => { const e = gn.__env.SHEETS[gn.SHEET_EXPENSE], k = h => e.headers.indexOf(h);
    return e.rows.map(r => [r[k('ประเภท')], r[k('สาขา')], r[k('จำนวนเงิน')], r[k('ธุรกิจ')] || '']); };
  let o = send(gn, 'หม่าล่า ทรัพย์\nค่าน้ำแข็ง 10', 'n1');
  o += '\n' + send(gn, 'หม่าล่า ทรัพย์\nค่าถุงร้อน 45', 'n2');
  eq('ลงสาขา หม่าล่า', ex(), [['ค่าน้ำแข็ง', SHOP, 10, 'หม่าล่า'], ['อื่น ๆ', SHOP, 45, 'หม่าล่า']]);
  eq('ตอบกลับบอกสาขา', /🧾 ค่าใช้จ่าย ตลาดทรัพย์พัฒนา\n• ค่าน้ำแข็ง/.test(o), true);
  // ส่งข้อความต้นฉบับไปด้วยเหมือนตอนรับจากไลน์จริง (intakeOnText_)
  const raw = 'หม่าล่า ทรัพยพัฒ\nค่าน้ำแข็ง 10';
  const o2 = gn.intakeSaveAndSummarize_(gn.intakeParseText_(raw),
    { location: gn.CENTRAL, who: 'เจ้าของ', msgId: 'n3', isGroup: true }, 'ข้อความ', raw, []);
  eq('ชื่อสาขาไม่ตรง → ลงครัวกลาง แต่เตือน', [ex()[2][1], /⚠️ ไม่รู้จักชื่อสาขาในบรรทัด "หม่าล่า ทรัพยพัฒ"/.test(o2),
     /🧾 ค่าใช้จ่าย ครัวกลาง/.test(o2)], [gn.CENTRAL, true, true]);
  eq('ไม่ได้เขียนหัว ไม่เตือน', /⚠️ ไม่รู้จัก/.test(send(gn, 'ค่าแก๊ส 450', 'n4')), false);
}

process.exit(done().fail ? 1 : 0);
