process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('เงินหมุนเวียนครัวกลาง (cash cycle)');

const DAY = 86400000, now = Date.now();
const ago = d => new Date(now - d * DAY);
const ymd = d => ago(d).toISOString().slice(0, 10);
const g = fresh();
g.__env.PROPS.CENTRAL_CASH_FROM = ymd(20);           // เริ่มนับเงิน 20 วันก่อน
g.__env.SHEETS[g.SHEET_EXPENSE] = { headers: g.EXPENSE_HEADERS.slice(), rows: [] };

// ซื้อเข้าครัวกลาง 2 ครั้ง: ก่อนเริ่มนับเงิน (ไม่นับ) กับหลัง
const buy = (d, item, qty, baht, msg) => {
  push(g, g.INTAKE_SHEET, { 'รายการ': item, 'จำนวนเงิน': baht, 'messageId': msg });
  push(g, g.SHEET_INCOMING, { 'วันที่เวลา': ago(d), 'สาขา': g.CENTRAL, 'รายการ': item, 'จำนวน': qty,
    'ประเภท': 'ของเข้าครัวกลาง', 'messageId': msg });
};
buy(25, 'หม่าล่า(ผสมแล้ว)', 5, 500, 'old');
buy(10, 'หม่าล่า(ผสมแล้ว)', 30, 3000, 'b1');
// ส่งสาขา 20 ถุง (2000 + ของเก่า 5 ถุง 500 ส่งไปก่อน) = หนี้ 2500
push(g, g.SHEET_INCOMING, { 'วันที่เวลา': ago(8), 'สาขา': SHOP, 'รายการ': 'หม่าล่า(ผสมแล้ว)', 'จำนวน': 25, 'ประเภท': 'ของเข้าร้าน' });
// ค่าใช้จ่ายครัวกลาง 300 · ของลองสูตร 120
push(g, g.SHEET_EXPENSE, { 'วันที่': ymd(5), 'เวลา': '10:00:00', 'สาขา': g.CENTRAL, 'ประเภท': 'ค่าแก๊ส', 'จำนวนเงิน': 300 });
push(g, g.INTAKE_SHEET, { 'วันที่': ymd(4), 'สถานที่': g.CENTRAL, 'รายการ': 'ซอสลองสูตร', 'จำนวนเงิน': 120, 'ประเภทซื้อ': 'พัฒนาสูตร' });
// ขายได้ 4000 → สาขาโอนเข้าครัวกลาง 3000 = คืนค่าของ 2500 + กำไร 500
push(g, g.SHEET_ORDERS, { 'วันที่': ymd(3), 'เวลา': '12:00:00', 'สาขา': SHOP, 'ยอดรวม': 4000, 'ส่วนลด': 0, 'ยอดสุทธิ': 4000, 'วิธีชำระเงิน': 'เงินสด' });
g.recordPayback_(SHOP, 3000, 'โอน', '', 'เจ้าของ');

section('เงินเข้า − เงินออก');
const t = g.recordCentralCash_(1000, 'ใส่ทุน', 'หม่าล่า', '', 'เจ้าของ');
g.cacheClear_();
let c = g.costSummary_().pl[g.CENTRAL]['เงินหมุนเวียน'];
eq('ซื้อของหลังวันเริ่มนับเท่านั้น', c['ซื้อของ'], 3000);
eq('ลองสูตร 120 · ค่าใช้จ่าย 300', [c['ลองสูตร'], c['ค่าใช้จ่าย']], [120, 300]);
eq('รับคืนค่าของ 2500 · กำไร 500', [c['รับคืนค่าของ'], c['รับกำไร']], [2500, 500]);
eq('เงินทุน 1000', c['เงินทุน'], 1000);
eq('คงเหลือ = 1000 + 2500 + 500 − 3000 − 120 − 300 = 580', c['คงเหลือ'], 580);
eq('ของในครัวกลาง 10 ถุง 1000', c['ของในครัวกลาง'], 1000);
eq('ทุนหมุนเวียน = เงิน + ของ + สาขาค้าง', c['ทุนหมุนเวียน'], 1580);
eq('ใส่ทุนตอบยอดใหม่', /💰 ใส่ทุนเข้าครัวกลาง 1,000 บาท[\s\S]*= เงินคงเหลือ 580 บาท/.test(t), true);

section('รอบเงิน');
// ส่งของ 2500 ตั้งแต่เที่ยงคืนวันเริ่มนับ (~20 วัน) ≈ 120/วัน · ของในครัว 1000 ≈ 8 วัน · สาขาค้าง 0
const days = (now - g.costYmdTime_(ymd(20))) / DAY, rate = Math.round(2500 / days * 100) / 100;
eq('ส่งของวันละ ≈ 2500 ÷ จำนวนวัน', c['ส่งของต่อวัน'], rate);
const dio = Math.round(1000 / rate * 10) / 10;
eq('ของอยู่ครัวกลาง ≈ 1000 ÷ ส่งต่อวัน · รอสาขา 0', [c['วันของอยู่ครัวกลาง'], c['วันรอสาขาจ่าย'], c['รอบเงิน']], [dio, 0, dio]);

section('ถอนเงิน / ดูยอดทางไลน์');
const ctxC = { location: g.CENTRAL, who: 'เจ้าของ', isGroup: true, msgId: 'x' };
eq('อ่าน ถอนเงิน', g.intakeCentralCashOf_('ถอนเงิน 200').what, 'ถอนเงิน');
eq('ข้อความทั่วไปไม่ใช่', g.intakeCentralCashOf_('ค่าแก๊ส 450'), null);
const t2 = g.intakeCentralCash_(g.intakeCentralCashOf_('ถอนเงิน 200'), ctxC);
eq('ถอน 200 → เหลือ 380', /🏧 ถอนเงินออกจากครัวกลาง 200 บาท[\s\S]*= เงินคงเหลือ 380 บาท/.test(t2), true);
eq('ลงชีตเป็นเลขลบ', g.__env.SHEETS[g.COST_SHEET_CASH].rows.slice(-1)[0][2], -200);
eq('ดูยอด', /= เงินคงเหลือ 380 บาท[\s\S]*เงินกลับมาครบรอบใน ~[\d.]+ วัน/.test(g.intakeCentralCash_(g.intakeCentralCashOf_('เงินครัวกลาง'), ctxC)), true);
eq('กลุ่มสาขาลงไม่ได้', /กลุ่มครัวกลาง/.test(g.intakeCentralCash_(g.intakeCentralCashOf_('ใส่ทุน 500'),
   { location: SHOP, who: 'พนง', isGroup: true })), true);
eq('บัญชีรวมมีเงินหมุนเวียนด้วย', g.costSummary_().biz['รวม'].pl[g.CENTRAL]['เงินหมุนเวียน']['คงเหลือ'], 380);

process.exit(done().fail ? 1 : 0);
