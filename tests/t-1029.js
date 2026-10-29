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

process.exit(done().fail ? 1 : 0);
