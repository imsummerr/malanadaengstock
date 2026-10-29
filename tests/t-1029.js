process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('29/10 — "กล่องใส่ขนม" ในไลน์ = ค่าใช้จ่ายเบเกอรี่ของสาขา');

const ctx = { location: 'ครัวกลาง', who: 'เจ้าของ', msgId: 'm', isGroup: true };
function send(g, text, id) {
  return g.intakeSaveAndSummarize_(g.intakeParseText_(text), Object.assign({}, ctx, { msgId: id }), 'ข้อความ', id, []);
}
const exps = g => {
  const s = g.__env.SHEETS[g.INTAKE_EXPENSE_SHEET] || { headers: [], rows: [] };
  return s.rows.map(r => { const o = {}; s.headers.forEach((h, i) => { o[h] = r[i]; }); return o; });
};
const buys = g => (g.__env.SHEETS[g.INTAKE_SHEET] || { rows: [] }).rows.length;

section('พิมพ์แค่ "กล่องใส่ขนม 120"');
let g = fresh();
g.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
let out = send(g, 'กล่องใส่ขนม 120', 'b1');
let e = exps(g);
eq('ลงค่าใช้จ่าย 1 แถว ไม่ลงซื้อของ', [e.length, buys(g)], [1, 0]);
eq('ประเภท ค่ากล่องใส่ขนม · เบเกอรี่ · สาขา (ขนมขายที่สาขา) · 120',
   [e[0]['ประเภท'], e[0]['ธุรกิจ'], e[0]['สาขา'], e[0]['จำนวนเงิน']], ['ค่ากล่องใส่ขนม', 'เบเกอรี่', SHOP, 120]);
eq('ตอบกลับเป็นค่าใช้จ่ายเบเกอรี่ของสาขา', new RegExp('ค่าใช้จ่าย[^\\n]*' + SHOP + '[^\\n]*เบเกอรี่').test(out), true);

section('บอกจำนวน / เงินสด / ค่ากล่องขนม / ครัวกลาง');
g = fresh();
send(g, ['กล่องใส่ขนม 2 แพ็ค 150 เงินสด', 'ค่ากล่องขนม 80', 'กล่อง ใส่ ขนม 50'].join('\n'), 'b2');
e = exps(g);
eq('ลงค่าใช้จ่ายทั้ง 3 บรรทัด (บอกจำนวนก็ไม่ลงสต็อก)', [e.length, buys(g)], [3, 0]);
eq('ทุกบรรทัด ค่ากล่องใส่ขนม · เบเกอรี่', e.map(x => [x['ประเภท'], x['ธุรกิจ']]),
   [['ค่ากล่องใส่ขนม', 'เบเกอรี่'], ['ค่ากล่องใส่ขนม', 'เบเกอรี่'], ['ค่ากล่องใส่ขนม', 'เบเกอรี่']]);
eq('เงินสดจำได้', e[0]['วิธีจ่าย'], 'เงินสด');
g = fresh();
send(g, 'กล่องใส่ขนม 100 ครัวกลาง', 'b3');
eq('เขียน "ครัวกลาง" กำกับ = ลงครัวกลาง', exps(g)[0]['สาขา'], g.CENTRAL);

section('เข้าบัญชีเบเกอรี่ ไม่เข้าหม่าล่า');
g = fresh();
send(g, 'กล่องใส่ขนม 120', 'b4');
g.cacheClear_();
const bk = g.costOutgo_('เบเกอรี่')[SHOP], ml = g.costOutgo_('หม่าล่า')[SHOP];
eq('เบเกอรี่ 120 · หม่าล่าไม่มี', [bk && bk['ตามประเภท']['ค่ากล่องใส่ขนม'], ml ? ml['รวม'] : 0], [120, 0]);

section('ของเดิมไม่เปลี่ยน');
g = fresh();
send(g, ['ค่าที่ 200', 'ถุงช้อปปิ้ง 9 บาท'].join('\n'), 'b5');
eq('ค่าที่ / ถุงช้อปปิ้ง ยังเป็นหม่าล่า (ไม่ได้เขียนธุรกิจ)', exps(g).map(x => [x['ประเภท'], x['ธุรกิจ']]), [['ค่าที่', ''], ['อื่น ๆ', '']]);

section('ข้อความจริง 29/10 14:32 — ถ้วย 1000 มล · ไส้กรอกแดง ไม่ใช่ไก่');
g = fresh();
g.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
const bal = () => { g.cacheClear_(); return g.stockBalances_()[g.CENTRAL] || {}; };
const cup0 = bal()['ถ้วย1000 มล'] || 0, chick0 = bal()['ไก่ (ดิบ)'] || 0;
out = send(g, ['29/10/2026', 'ถ้วย 1000 มล 3 แพ็ค แพ็คละ 25 ใบ 195 บาท', 'ไส้กรอกแดง 1 แพ็ค 30 บาท', 'ลูกชิ้นหมู 1 แพ็ค 60 บาท'].join('\n'), 'b6');
eq('ถ้วย1000 มล +75 ใบ (3 แพ็ค × 25 ตามที่บอก ไม่ใช่ 50)', (bal()['ถ้วย1000 มล'] || 0) - cup0, 75);
eq('ไส้กรอกแดงไม่ไปลงไก่', [(bal()['ไก่ (ดิบ)'] || 0) - chick0, /• ไก่/.test(out)], [0, false]);
// 29/10 เจ้าของให้ขายเป็นไม้ — เข้าของดิบ (ซื้อเป็นแพ็ค) แล้ว
eq('ไส้กรอกแดง / ลูกชิ้นหมู เข้าของดิบ 1 แพ็ค', [bal()['ไส้กรอกแดง (ดิบ)'], bal()['ลูกชิ้นหมู (ดิบ)'], /ไม่มีในรายการสินค้า/.test(out)], [1, 1, false]);
const names = g.getStockItems_().map(i => i.name);
eq('อกไก่ / อก 2 โล ยังเป็นไก่', [g.intakeMatchItem_('อกไก่', names).name, g.intakeMatchItem_('อก', names).name], ['ไก่ (ดิบ)', 'ไก่ (ดิบ)']);
eq('สะกดผิดตัวเดียวยังเดาได้ (ไส้กรอกชีด → ไส้กรอกชีส)', /^ไส้กรอกชีส/.test(g.intakeMatchItem_('ไส้กรอกชีด', names).name), true);
eq('ถ้วย1000 มล เขียนติดกันแบบเดิมยังได้', g.intakeParseText_('ถ้วย1000 มล 1 แพ็ค 120 บาท')[0].raw, 'ถ้วย1000 มล');

section('เต้าหู้หลอด "1 แพ็ค 10 อัน" = 10 หลอด (ไม่ใช่ 12 ตามชีต)');
g = fresh();
g.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
const tube = () => { g.cacheClear_(); return (g.stockBalances_()[g.CENTRAL] || {})['เต้าหู้หลอด'] || 0; };
let t0 = tube();
send(g, 'เต้าหู้หลอด 1 แพ็ค 10 อัน 65 บาท', 'c1');
eq('1 แพ็ค 10 อัน → +10', tube() - t0, 10);
t0 = tube(); send(g, 'เต้าหู้หลอด 1 ถุง ถุงละ 10 65 บาท', 'c2');
eq('ถุงละ 10 ก่อนราคา → +10', tube() - t0, 10);
t0 = tube(); send(g, 'เต้าหู้หลอด 1 แพ็ค 65 บาท', 'c3');
eq('ไม่บอก = 12 ตามชีต', tube() - t0, 12);

process.exit(done().fail ? 1 : 0);
