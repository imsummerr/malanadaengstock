process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, D, SHOP } = require('./fixture');
const { buy, pack, ship, count, val } = require('./t-cost');
const { eq, section, done } = makeCheck('เริ่มนับใหม่ 1/10 เฉพาะสาขา');

const OCT = 9;   // เดือนใน Date() นับจาก 0
function sale(g, ymd, net) { push(g, g.SHEET_ORDERS, { 'วันที่': ymd, 'สาขา': SHOP, 'ยอดสุทธิ': net }); }

const g = fresh();
// ── กันยายน: ของเก่าที่ต้องไม่ถูกนำมาคิดที่สาขา ──
buy(g, 1, 'ดอลลี่ (ดิบ)', 20, 1520, 's1');           // 76 บาท/กก.
pack(g, 2, 'ดอลลี่', 400, [['ดอลลี่ (ดิบ)', 20]]);    // 3.8 บาท/ไม้
ship(g, 3, 'ดอลลี่', 100);                           // ก.ย. ส่งไป 380
sale(g, '2026-09-20', 9999);                          // ยอดขาย ก.ย.
count(g, 25, SHOP, 'ดอลลี่', 12);                      // นับ ก.ย.

section('ก่อนตั้ง — เห็นของเดือนกันยาปนอยู่');
let s = g.costSummary_();
eq('รายได้สาขามีของ ก.ย.', s.pl[SHOP]['รายได้'], 9999);
eq('ค้างชำระมีของ ก.ย.', s.owed[SHOP]['ค้างชำระ'], 380);

g.setLocationStart(SHOP, '2026-10-01');
g.cacheClear_();

section('หลังตั้ง 1/10 — สาขาเริ่มใหม่ ครัวกลางเดินต่อ');
s = g.costSummary_();
eq('รายได้ ก.ย. ไม่ถูกนำมาคิด', (s.pl[SHOP] || { รายได้: 0 })['รายได้'], 0);
eq('หนี้ ก.ย. ไม่ถูกนำมาคิด', (s.owed[SHOP] || { ค้างชำระ: 0 })['ค้างชำระ'], 0);
eq('ครัวกลางยังโดนตัดของที่ส่งไปใน ก.ย.', val(g, g.CENTRAL, 'ดอลลี่'), 1140);
eq('ของดิบครัวกลางไม่หาย (แพ็คไปหมดแล้ว)', val(g, g.CENTRAL, 'ดอลลี่ (ดิบ)'), 0);
eq('สาขายังไม่มีของ รอนับวันแรก', val(g, SHOP, 'ดอลลี่'), 0);
eq('การนับ ก.ย. ไม่โชว์เป็นนับล่าสุด', g.lastCountInfo_()[SHOP], undefined);

section('1/10 เช้า — นับยอดตั้งต้น');
count(g, 1, SHOP, 'ดอลลี่', 30, OCT, 8);
s = g.costSummary_();
eq('ยอดตั้งต้น 30 ไม้ มีมูลค่าตามต้นทุนล่าสุด 3.8', val(g, SHOP, 'ดอลลี่'), 114);
eq('ยอดตั้งต้นไม่ใช่ค่าใช้จ่ายวัตถุดิบ', s.pl[SHOP]['ค่าใช้จ่ายวัตถุดิบ'], 0);
eq('ยอดตั้งต้นไม่ใช่หนี้', (s.owed[SHOP] || { ค้างชำระ: 0 })['ค้างชำระ'], 0);
eq('ไม่มีคำเตือนเรื่องราคา 0', s.warn.filter(w => /ราคาทุน/.test(w.msg)).length, 0);

section('1/10 ระหว่างวัน — ส่งเพิ่ม 20 ไม้ ขายได้ 500');
ship(g, 1, 'ดอลลี่', 20, OCT, 11);
sale(g, '2026-10-01', 500);
s = g.costSummary_();
eq('หนี้เฉพาะของที่ส่งวันนี้ 76', s.owed[SHOP]['ค้างชำระ'], 76);
eq('รายได้เฉพาะวันนี้ 500', s.pl[SHOP]['รายได้'], 500);

section('1/10 ปิดร้าน — นับรอบสอง เหลือ 35');
count(g, 1, SHOP, 'ดอลลี่', 35, OCT, 21);
s = g.costSummary_();
// 30 + 20 − 35 = ใช้ไป 15 ไม้ × 3.8
eq('ใช้ไป 15 ไม้ = 57 บาท', s.pl[SHOP]['ค่าใช้จ่ายวัตถุดิบ'], 57);
eq('กำไรขั้นต้น 500 − 57', s.pl[SHOP]['กำไรขั้นต้น'], 443);
eq('เหลือ 35 ไม้ มูลค่า 133', val(g, SHOP, 'ดอลลี่'), 133);
eq('นับล่าสุดคือรอบปิดร้าน', g.lastCountInfo_()[SHOP].n, 1);

section('รายงานเดือนตุลา');
const rp = g.monthlyReport('2026-10', SHOP);
eq('ยอดขายตุลา 500', rp.sales, 500);

section('ครัวกลางไม่โดนเส้นของสาขา');
g.clearLocationStart(SHOP); g.cacheClear_();
eq('ยกเลิกเส้นแล้วรายได้ ก.ย. กลับมา', g.costSummary_().pl[SHOP]['รายได้'], 10499);

section('มีเส้นทั้งระบบเก่าค้างอยู่ ยอดตั้งต้นก็ยังต้องมีราคา');
const g2 = fresh();
buy(g2, 1, 'ดอลลี่ (ดิบ)', 20, 1520, 'x1');
pack(g2, 2, 'ดอลลี่', 400, [['ดอลลี่ (ดิบ)', 20]]);
g2.setStartDate('2026-09-26');                 // เส้นเก่าจากตอนล้างระบบ
g2.setLocationStart(SHOP, '2026-10-01');
count(g2, 1, SHOP, 'ดอลลี่', 30, OCT, 8);
eq('ราคามาจากประวัติก่อนเส้น 3.8 × 30', val(g2, SHOP, 'ดอลลี่'), 114);
eq('ไม่มีคำเตือนราคา 0', g2.costSummary_().warn.filter(w => /ราคาทุน/.test(w.msg)).length, 0);

section('ของที่ไม่เคยมีราคาเลย ต้องเตือน ไม่ใช่เงียบ');
const g3 = fresh();
g3.setLocationStart(SHOP, '2026-10-01');
count(g3, 1, SHOP, 'ไส้กรอกแดง', 20, OCT, 8);
eq('เตือนว่าไม่รู้ราคา', g3.costSummary_().warn.some(w => w.item === 'ไส้กรอกแดง'), true);

process.exit(done().fail ? 1 : 0);
