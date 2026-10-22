process.env.TZ = 'Asia/Bangkok';
const { makeCheck, formatDate } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('22/10 — ลืมเช็คสต็อกปิดร้าน วันนี้ขายไปแล้ว ก็ลงย้อนหลังได้ (เลือกวันเหมือนเบเกอรี่)');

const NOW = Date.now(), H = 3600000;
const at = h => new Date(NOW - h * H);
const ymd = d => formatDate(d, '', 'yyyy-MM-dd');
const hms = d => formatDate(d, '', 'HH:mm:ss');
const bill = (g, d) => push(g, g.SHEET_ORDERS, { 'วันที่': ymd(d), 'เวลา': hms(d), 'สาขา': SHOP,
  'ยอดรวม': 100, 'ส่วนลด': 0, 'ยอดสุทธิ': 100, 'รวมไม้': 10, 'วิธีชำระเงิน': 'เงินสด' });

function setup() {
  const g = fresh();
  g.CASH_DAY_CUT_HOURS = (new Date(NOW).getHours() + 16) % 24;   // วันนี้เริ่ม 8 ชม.ก่อน · เมื่อวาน = 8–32 ชม.ก่อน
  g.BAKERY_START_DATE = '2999-01-01';                              // เรื่องนี้ไม่เกี่ยวเบเกอรี่
  g.__env.SHEETS[g.SHEET_EXPENSE] = { headers: g.EXPENSE_HEADERS.slice(), rows: [] };
  g.checkToken_ = () => ({ role: 'staff', branch: SHOP, branches: [SHOP], name: 'ลลิตา' });
  // นับฐานเมื่อวานก่อนขาย · ขายเมื่อวาน 2 บิล · ไม่ได้นับปิดร้าน · วันนี้ขายบิลแรกไปแล้ว (1 ชม.ก่อน)
  push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(30), 'สาขา': SHOP, 'รายการ': 'ดอลลี่', 'จำนวน': 20, 'ประเภท': 'เช็คสต็อก' });
  bill(g, at(16)); bill(g, at(14)); bill(g, at(1));
  return g;
}
const rowsAll = g => g.countItemsAt_(SHOP).map(it => it.level ? { item: it.name, level: g.LEVELS[0] }
  : { item: it.name, packs: '', rem: it.name === 'ดอลลี่' ? 12 : 0, pieces: '' });
const st = g => { g.cacheClear_(); return g.lateStatus_(SHOP, NOW); };

section('วันนี้ขายไปแล้ว ยังเตือนเช็คสต็อกย้อนหลังของเมื่อวาน');
let g = setup();
const yday = g.cashBizDay_(NOW - 24 * H), today = g.cashBizDay_(NOW);
let s = st(g);
eq('เตือนของเมื่อวาน · บอกว่าวันนี้ขายแล้ว (ต้องเลือก)', s.mala && [s.mala.day, s.mala.count, s.mala.afterBill], [yday, true, true]);

section('เลือก "ปิดร้านของเมื่อวาน" → รอบนี้เป็นปิดร้านของเมื่อวาน');
let r = g.handleStockCount_({ token: 't', location: SHOP, rows: rowsAll(g), forDay: yday });
eq('บันทึกได้', r.success, true);
const C = g.__env.SHEETS[g.SHEET_COUNT], note = C.headers.indexOf('หมายเหตุ'), kind = C.headers.indexOf('ประเภท');
const mine = C.rows.slice(-rowsAll(g).length).filter(x => x[kind] === 'เช็คสต็อก');
const p = yday.split('-');
eq('แถวนับจดว่าเป็นปิดร้านของเมื่อวาน', mine.every(x => String(x[note]).indexOf('ปิดร้าน ' + Number(p[2]) + '/' + Number(p[1]) + '/' + p[0] + ' (ลงย้อนหลัง) · ') === 0), true);
g.cacheClear_();
const cy = g.cashCloseCount_(SHOP, yday);
eq('เมื่อวานมีรอบปิดร้านแล้ว (รอบที่เลือก)', [!!cy.countMs, cy.tagged, cy.prevMs], [true, true, at(30).getTime()]);
eq('วันนี้ยังไม่มีรอบปิดร้าน (ไม่เอารอบของเมื่อวานมาใช้)', g.cashCloseCount_(SHOP, today).countMs, 0);
eq('รอบนี้ปิดยอดของเมื่อวาน', g.closeDayOfCount_(SHOP, cy.countMs), yday);
eq('ไม่เตือนแล้ว', st(g).mala, null);
eq('สรุปยอดเมื่อวานไม่รอเช็คสต็อกแล้ว', g.dayStatus_(SHOP, yday).need.indexOf('เช็คสต็อกปิดร้านหม่าล่า'), -1);
// คืนนี้ขายต่อแล้วนับปิดร้านของวันนี้ — เทียบต่อจากรอบที่ลงย้อนหลัง
const later = new Date(cy.countMs + 2 * H);
bill(g, new Date(cy.countMs + 1 * H));
push(g, g.SHEET_COUNT, { 'วันที่เวลา': later, 'สาขา': SHOP, 'รายการ': 'ดอลลี่', 'จำนวน': 8, 'ประเภท': 'เช็คสต็อก' });
g.cacheClear_();
const ct = g.cashCloseCount_(SHOP, today);
eq('ปิดร้านวันนี้ = รอบคืนนี้ · เทียบต่อจากรอบที่ลงย้อนหลัง', [ct.countMs, ct.prevMs], [later.getTime(), cy.countMs]);

section('เลือก "ของวันนี้" → เมื่อวานรวมไปเทียบกับรอบนี้ ไม่ค้างรอ');
g = setup();
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rowsAll(g) });
eq('บันทึกได้ (ไม่จดเป็นของเมื่อวาน)', [r.success, C.rows.length > 0], [true, true]);
g.cacheClear_();
const m = g.cashCloseCount_(SHOP, yday);
eq('เมื่อวานไม่มีรอบปิดร้าน แต่รวมไปกับรอบนี้แล้ว', [m.countMs, !!m.mergedMs], [0, true]);
eq('ไม่เตือนแล้ว', st(g).mala, null);
eq('สรุปยอดเมื่อวานไม่ค้างรอเช็คสต็อก', g.dayStatus_(SHOP, yday).need.indexOf('เช็คสต็อกปิดร้านหม่าล่า'), -1);
eq('สรุปบอกว่ารวมไปเทียบกับรอบถัดไป', /รวมไปเทียบกับรอบนับ/.test(g.daySummaryText_(SHOP, yday)), true);

section('กันลงผิด');
g = setup();
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rowsAll(g), forDay: g.cashBizDay_(NOW - 48 * H) });
eq('วันที่ไม่ใช่วันที่ลืม ลงไม่ได้', [r.success, /ลงเป็นปิดร้านของวันที่เลือกไม่ได้/.test(r.message)], [false, true]);
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rowsAll(g), forDay: yday });
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rowsAll(g), forDay: yday });
eq('ลงย้อนหลังไปแล้ว ลงซ้ำไม่ได้', r.success, false);

process.exit(done().fail ? 1 : 0);
