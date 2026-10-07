process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('ตั้งยอดครัวกลางตามของจริง');

const NOW = Date.now();
const at = min => new Date(NOW - min * 60000);

const g = fresh();
const S = g.__env.SHEETS;
const C = g.CENTRAL;
S[g.SHEET_COUNT].headers.push(g.COUNT_COST_COL, g.COUNT_CHARGE_COL);
S[g.SHEET_COUNT].rows.forEach(r => r.push('', ''));
// ระบบมีที่ครัวกลาง: กะหล่ำ 4 โล โลละ 27.25 · ดอลลี่ 10 ไม้ ไม้ละ 6.2 (ส่งไปสาขาแล้วไม่ได้ลง)
const cnt = (min, loc, item, qty, cost) => push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(min), 'สาขา': loc,
  'รายการ': item, 'จำนวน': qty, 'ประเภท': 'เช็คสต็อก', [g.COUNT_COST_COL]: cost || '' });
cnt(120, C, 'กะหล่ำ (ดิบ)', 4, 27.25);
cnt(120, C, 'ดอลลี่', 10, 6.2);
// สาขานับฐานไว้แล้ว
cnt(100, SHOP, 'ดอลลี่', 25);
g.__env.PROPS.ACC_START_BY_LOC = JSON.stringify({ [SHOP]: g.Utilities.formatDate(at(101), '', 'yyyy-MM-dd HH:mm') });
g.cacheClear_();

section('ก่อนตั้งยอด');
let s = g.costSummary_();
eq('ครัวกลาง 109 + 62 = 171', s.stock[C].total, 171);
eq('สาขายังไม่มีค่าวัตถุดิบ', (s.pl[SHOP] || {})['ค่าใช้จ่ายวัตถุดิบ'] || 0, 0);

section('ตั้งยอด: กะหล่ำเหลือ 3 โล · ช้อน 5 แพ็คที่ไม่เคยลง · ดอลลี่ไม่มีแล้ว');
const r = g.setCentralStock_([['กะหล่ำ (ดิบ)', 3, 27.25, 'เหลือ 3 โล'], ['ช้อน', 500, 0.1154, '5 แพ็ค']], SHOP, 'เจ้าของร้าน');
eq('ส่วนที่หาย = กะหล่ำ 1 โล 27.25 + ดอลลี่ 62 = 89.25', r.charged, 89.25);
g.cacheClear_();
s = g.costSummary_();
eq('ครัวกลาง = 81.75 + 57.7 = 139.45', s.stock[C].total, 139.45);
eq('ช้อนคิดตามราคาที่บอก', s.stock[C].rows.find(x => x.item === 'ช้อน').value, 57.7);
eq('เป็นค่าวัตถุดิบของสาขา', s.pl[SHOP]['ค่าใช้จ่ายวัตถุดิบ'], 89.25);
eq('ไม่ใช่ค่าวัตถุดิบครัวกลาง', (s.used[C] || {})['ใช้ไป'] || 0, 0);
eq('ไม่ไปเป็นยอดที่ต้องจ่ายคืน', s.owed[SHOP]['ค่าของที่ใช้ไปแล้ว'], 0);
const b = g.stockBalances_();
eq('สต็อกครัวกลางกะหล่ำ 3', b[C]['กะหล่ำ (ดิบ)'], 3);
eq('สต็อกครัวกลางดอลลี่ 0', b[C]['ดอลลี่'], 0);
eq('สต็อกสาขาไม่ถูกแตะ', b[SHOP]['ดอลลี่'], 25);
eq('บอกรายการที่ตัดไปสาขา', /ดอลลี่ 1 แพ็ค = 62 บาท/.test(r.text), true);

done();
