process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh } = require('./fixture');
const { eq, section, done } = makeCheck('รับของทางไลน์');

const ctx = { location: 'ครัวกลาง', who: 'เจ้าของ', msgId: 'm', isGroup: true };
function send(g, text, id) {
  return g.intakeSaveAndSummarize_(g.intakeParseText_(text), Object.assign({}, ctx, { msgId: id }),
                                   'ข้อความ', id, []);
}
const bal = g => g.stockBalances_()[g.CENTRAL] || {};

section('ข้อความจริง 25/9 — ไม่พัง ลงครบ');
let g = fresh();
let out = send(g, [
  'น้ำจิ้มงา 7 ถุง 627.2 บาท', 'น้ำดำ 9 ถุง 677.7 บาท', 'สาหร่าย 100 กรัม 86 บาท',
  'แมงกะพรุน 1 กก 85 บาท', 'วุ้นเส้นเกาหลี 0.5 โล 31 บาท', 'ถุงช้อปปิ้ง 9 บาท'
].join('\n'), 'r1');
eq('ตอบกลับได้', /บันทึกแล้ว/.test(out), true);
eq('ถุงช้อปปิ้งเป็นค่าใช้จ่าย', /🧾 ค่าใช้จ่าย\n• ถุงช้อปปิ้ง/.test(out), true);
eq('น้ำจิ้มงา 7 ถุง', bal(g)['น้ำจิ้มงา (ดิบ)'], 7);
eq('สาหร่าย 0.1 กก.', bal(g)['สาหร่าย (ดิบ)'], 0.1);
eq('วุ้นเส้นเกาหลี 0.5 กก.', bal(g)['วุ้นเส้นเกาหลี (ดิบ)'], 0.5);

section('สะกด "แพ้ค" กับของดิบที่ซื้อยกแพ็ค');
g = fresh();
out = send(g, ['ฟองเต้าหู้ 22 แพ้ค 471.68 บาท', 'ช้อน 5 แพ้ค 57.7บาท',
               'มาม่า35 ชมพู 2 แพ้ค 218 บาท'].join('\n'), 'r2');
eq('ฟองเต้าหู้ 22 แพ็ค = 264 อัน', bal(g)['ฟองเต้าหู้ม้วน (ดิบ)'], 264);
eq('ช้อน 5 แพ็ค = 500 อัน', bal(g)['ช้อน'], 500);
eq('มาม่าชมพู 2 แพ็ค = 8 ห่อ', bal(g)['มาม่า 35 ชมพู (ดิบ)'], 8);
eq('ไม่หยิบเลข 35 จากชื่อ', /35 หน่วย/.test(out), false);

section('ของที่ต้องทำเอง ไม่เข้าครัวกลาง');
g = fresh();
out = send(g, 'พันเห็ดเข็ม 8 ไม้', 'r3');
eq('ไม่ลงสต็อก', bal(g)['หมูพันเห็ดเข็มทอง'] || 0, 0);
eq('บอกให้ไปแท็บแพ็คของ', /แพ็คของ/.test(out), true);

module.exports = { send, bal, ctx };
if (require.main === module) process.exit(done().fail ? 1 : 0);
