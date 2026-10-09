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

process.exit(done().fail ? 1 : 0);
