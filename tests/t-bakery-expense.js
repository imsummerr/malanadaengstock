process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('เบเกอรี่ — ค่าใช้จ่ายที่จ่ายเงินสดจากเงินขาย (13/10)');

const NOW = Date.now(), H = 3600000;
const at = h => new Date(NOW - h * H);
const FL = ['ไดฟุกุ ครีมนม', 'ไดฟุกุ ช็อกโกแลต', 'ไดฟุกุ ชาเขียว', 'ไดฟุกุ โอริโอ้', 'บราวนี่ นูเทลล่า', 'บราวนี่ โอริโอ้', 'ไดฟุกุ สตอเบอร์รี่', 'บราวนี่ อัลม่อนสไลซ์'];
const rowsOf = qs => FL.map((n, i) => ({ item: n, qty: qs[i] === undefined ? 0 : qs[i] }));
const staff = { role: 'staff', branch: SHOP, branches: [SHOP], name: 'ลลิตา' };

function setup(beforeH) {
  const g = fresh();
  g.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
  g.CASH_DAY_CUT_HOURS = (new Date(NOW).getHours() + 16) % 24;   // วันนี้เริ่ม 8 ชม.ก่อน
  g.BAKERY_START_DATE = '2000-01-01';
  g.checkToken_ = () => staff;
  FL.forEach((n, i) => push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(beforeH || 3), 'สาขา': SHOP, 'รายการ': n,
    'จำนวน': [20, 40, 20, 15, 10, 5][i], 'ประเภท': g.KIND_BAKERY_COUNT, 'หมายเหตุ': 'ก่อนขาย · ยอดระบบ 0' }));
  return g;
}
const S = (g, n) => g.__env.SHEETS[n];
const rec = (g, n, r) => { const h = S(g, n).headers, o = {}; h.forEach((k, i) => { o[k] = r[i]; }); return o; };
const lastMoney = g => rec(g, g.SHEET_BAKERY, S(g, g.SHEET_BAKERY).rows.slice(-1)[0]);
const exps = g => (S(g, g.SHEET_EXPENSE) || { rows: [] }).rows.map(r => rec(g, g.SHEET_EXPENSE, r));
// ขาย 5+10+2+5+2+3 = 27 ชิ้น = ควรได้ 270
const AFTER = [15, 30, 18, 10, 8, 2];

section('จ่ายค่าที่ 60 + ค่าน้ำแข็ง 10 จากเงินสด — เงินที่เหลือ 200');
let g = setup();
let r = g.handleBakeryCount_({ token: 't', round: 'หลังขาย', rows: rowsOf(AFTER),
  money: { cash: 130, transfer: 70, thai: 0 }, id: 'E1',
  expenses: [{ text: 'ค่าที่', baht: 60 }, { text: 'ค่าน้ำแข็ง', baht: 10 }, { text: '', baht: '' }] });
eq('บันทึกได้', r.success, true);
let m = lastMoney(g);
eq('รวมเงิน = 130 + 70 + จ่ายไป 70 = 270 ตรงกับที่ควรได้', [m['รวมเงิน'], m['จ่ายค่าใช้จ่าย'], m['ควรได้'], m['ผลเทียบ']], [270, 70, 270, 'ตรง']);
let ex = exps(g);
eq('ลงค่าใช้จ่าย 2 แถว ประเภทถูก', ex.map(x => [x['ประเภท'], x['จำนวนเงิน']]), [['ค่าที่', 60], ['ค่าน้ำแข็ง', 10]]);
eq('เป็นเบเกอรี่ เงินสด ที่สาขา ชื่อพนักงาน', ex.map(x => [x['ธุรกิจ'], x['วิธีจ่าย'], x['สาขา'], x['พนักงาน']]),
   [['เบเกอรี่', 'เงินสด', SHOP, 'ลลิตา'], ['เบเกอรี่', 'เงินสด', SHOP, 'ลลิตา']]);
// 13/10: หน้าเว็บไม่มีช่องนี้แล้ว (แจ้งในไลน์) — หลังบ้านยังรับแถวจากหน้าเว็บรุ่นเก่า · สรุปตอนแจ้งค่าใช้จ่ายครบ
g.expDoneMark_(SHOP, g.cashBizDay_(NOW), 'เจ้าของ', 2, 70, 'm0');
g.daySummaryAfter_(SHOP, g.cashBizDay_(NOW));
eq('สรุปบวกเงินสดที่จ่ายจากเงินขายกลับ (ตรง)', /🍡 เบเกอรี่ ✅[\s\S]*\+ จ่ายค่าใช้จ่ายเงินสดจากเงินขาย 70 บาท\n→ ตรงกัน/.test(g.__env.SENT.map(x => x.messages.map(m => m.text).join('\n')).join('\n')), true);
eq('พนักงานไม่เห็นยอดที่ควรได้', r.expected, undefined);

g.cacheClear_();
const inc = g.bakeryIncome_()[SHOP];
eq('รายได้เบเกอรี่ = ยอดขายเต็ม 270', [inc['รวม'], inc['จ่ายค่าใช้จ่าย']], [270, 70]);
const s = g.costSummary_(), p = s.biz['เบเกอรี่'].pl[SHOP], o = s.biz['เบเกอรี่'].owed[SHOP];
eq('บัญชีเบเกอรี่: ค่าใช้จ่ายอื่น 70 · จ่ายจากเงินขาย 70', [p['ค่าใช้จ่ายอื่น'], p['จ่ายจากเงินขาย']], [70, 70]);
eq('เงินในมือ = 200 (ไม่หักซ้ำ)', o['เงินในมือ'], 200);
eq('ไม่ไปลงบัญชีหม่าล่า', (s.biz['หม่าล่า'].pl[SHOP] || {})['ค่าใช้จ่ายอื่น'] || 0, 0);

section('กดซ้ำ (เน็ตหลุด) ไม่ลงค่าใช้จ่ายซ้ำ');
r = g.handleBakeryCount_({ token: 't', round: 'หลังขาย', rows: rowsOf(AFTER),
  money: { cash: 130, transfer: 70, thai: 0 }, id: 'E1', expenses: [{ text: 'ค่าที่', baht: 60 }, { text: 'ค่าน้ำแข็ง', baht: 10 }] });
eq('ตอบว่าส่งไปแล้ว ค่าใช้จ่ายยัง 2 แถว', [r.duplicated, exps(g).length], [true, 2]);

section('ไม่มีค่าใช้จ่าย — เหมือนเดิม');
g = setup();
g.handleBakeryCount_({ token: 't', round: 'หลังขาย', rows: rowsOf(AFTER), money: { cash: 270, transfer: 0, thai: 0 }, id: 'E2' });
m = lastMoney(g);
eq('รวมเงิน 270 ช่องจ่ายค่าใช้จ่ายว่าง ไม่มีแถวค่าใช้จ่าย', [m['รวมเงิน'], m['จ่ายค่าใช้จ่าย'], exps(g).length], [270, '', 0]);

section('กรอกไม่ครบ');
g = setup();
r = g.handleBakeryCount_({ token: 't', round: 'หลังขาย', rows: rowsOf(AFTER), money: { cash: 200, transfer: 0, thai: 0 }, id: 'E3',
  expenses: [{ text: 'ค่าที่', baht: '' }] });
eq('มีชื่อไม่มีเงิน = ไม่บันทึก', [r.success, /ยังไม่ได้ใส่จำนวนเงิน/.test(r.message), S(g, g.SHEET_BAKERY) ? S(g, g.SHEET_BAKERY).rows.length : 0], [false, true, 0]);
r = g.handleBakeryCount_({ token: 't', round: 'หลังขาย', rows: rowsOf(AFTER), money: { cash: 200, transfer: 0, thai: 0 }, id: 'E3',
  expenses: [{ text: '', baht: 70 }] });
eq('มีเงินไม่บอกค่าอะไร = ไม่บันทึก', [r.success, /จ่ายค่าอะไร/.test(r.message)], [false, true]);

section('ค่าพนักงาน / ของที่ไม่ใช่ประเภทหลัก');
g = setup();
g.handleBakeryCount_({ token: 't', round: 'หลังขาย', rows: rowsOf(AFTER), money: { cash: 100, transfer: 0, thai: 0 }, id: 'E4',
  expenses: [{ text: 'ค่าพนักงาน', baht: 150 }, { text: 'ค่าถุง', baht: 20 }] });
eq('ค่าพนักงาน → ค่าแรง · ค่าถุง → อื่น ๆ เก็บชื่อไว้', exps(g).map(x => [x['ประเภท'], x['รายละเอียด']]), [['ค่าแรง', 'ค่าพนักงาน'], ['อื่น ๆ', 'ค่าถุง']]);

section('ลงย้อนหลัง — ค่าใช้จ่ายเป็นของวันนั้น');
g = setup(20);
const yday = g.cashBizDay_(NOW - 24 * H);
r = g.handleBakeryCount_({ token: 't', round: 'หลังขาย', forDay: yday, rows: rowsOf(AFTER),
  money: { cash: 210, transfer: 0, thai: 0 }, id: 'E5', expenses: [{ text: 'ค่าที่', baht: 60 }] });
ex = exps(g);
eq('ค่าใช้จ่ายลงวันเมื่อวาน 23:59:59 เหมือนแถวเงิน', [r.success, ex[0]['วันที่'], ex[0]['เวลา']], [true, yday, '23:59:59']);
eq('เงินเมื่อวานตรง (210 + 60 = 270)', lastMoney(g)['ผลเทียบ'], 'ตรง');

process.exit(done().fail ? 1 : 0);
