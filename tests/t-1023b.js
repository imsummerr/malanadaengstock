process.env.TZ = 'Asia/Bangkok';
const { makeCheck, formatDate } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('23/10 — ลืมนับหลายวัน ขึ้นครบทุกวัน (หม่าล่า + เบเกอรี่)');

const NOW = Date.now(), H = 3600000;
const at = h => new Date(NOW - h * H);
const ymd = d => formatDate(d, '', 'yyyy-MM-dd');
const hms = d => formatDate(d, '', 'HH:mm:ss');
const FL = ['ไดฟุกุ ครีมนม', 'ไดฟุกุ ช็อกโกแลต', 'ไดฟุกุ ชาเขียว', 'ไดฟุกุ โอริโอ้', 'บราวนี่ นูเทลล่า', 'บราวนี่ โอริโอ้', 'ไดฟุกุ สตอเบอร์รี่', 'บราวนี่ อัลม่อนสไลซ์'];
const bill = (g, d) => push(g, g.SHEET_ORDERS, { 'วันที่': ymd(d), 'เวลา': hms(d), 'สาขา': SHOP,
  'ยอดรวม': 100, 'ส่วนลด': 0, 'ยอดสุทธิ': 100, 'รวมไม้': 10, 'วิธีชำระเงิน': 'เงินสด' });
const bkCount = (g, d, qs, note) => FL.forEach((n, i) => push(g, g.SHEET_COUNT, { 'วันที่เวลา': d, 'สาขา': SHOP, 'รายการ': n,
  'จำนวน': qs[i], 'ประเภท': g.KIND_BAKERY_COUNT, 'หมายเหตุ': note }));

// วันนี้เริ่ม 8 ชม.ก่อน · เมื่อวาน = 8–32 ชม. · เมื่อวานซืน = 32–56 ชม. (ร้านปิด) · 3 วันก่อน = 56–80 ชม.
function setup(withBakeryCountBetween) {
  const g = fresh();
  g.CASH_DAY_CUT_HOURS = (new Date(NOW).getHours() + 16) % 24;
  g.BAKERY_START_DATE = '2000-01-01';
  g.__env.SHEETS[g.SHEET_EXPENSE] = { headers: g.EXPENSE_HEADERS.slice(), rows: [] };
  g.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
  g.checkToken_ = () => ({ role: 'staff', branch: SHOP, branches: [SHOP], name: 'ลลิตา' });
  // นับเบเกอรี่ 82 ชม.ก่อน (คืนก่อนหน้า) · นับฐานหม่าล่า 76 ชม.ก่อน (ก่อนขาย 3 วันก่อน) · ขาย 3 วันก่อน ไม่ได้นับปิดร้าน · ขายเมื่อวาน ไม่ได้นับปิดร้าน
  push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(76), 'สาขา': SHOP, 'รายการ': 'ดอลลี่', 'จำนวน': 20, 'ประเภท': 'เช็คสต็อก' });
  bkCount(g, at(82), [10, 10, 10, 10, 10, 10, 10, 10], 'หลังขาย · ยอดระบบ 0');
  bill(g, at(72)); bill(g, at(70));
  if (withBakeryCountBetween) bkCount(g, at(21), [8, 8, 8, 8, 8, 8, 8, 8], 'ก่อนขาย · ยอดระบบ 10');   // ก่อนขายเมื่อวาน
  bill(g, at(20)); bill(g, at(18));
  return g;
}
const st = g => { g.cacheClear_(); return g.lateStatus_(SHOP, NOW); };

section('หม่าล่า: ลืม 2 วัน — นับตอนนี้ได้แค่วันล่าสุด วันก่อนหน้ารวมไปเทียบกับวันล่าสุด');
let g = setup(false);
g.BAKERY_START_DATE = '2999-01-01';                          // ข้อนี้ดูแค่หม่าล่า (เบเกอรี่ไม่ได้ออกขาย)
const d3 = g.cashBizDay_(NOW - 72 * H), yday = g.cashBizDay_(NOW - 24 * H);
let s = st(g);
eq('นับตอนนี้ = ปิดร้านเมื่อวาน', s.mala && s.mala.day, yday);
eq('3 วันก่อนขึ้นว่ารวมไปกับเมื่อวาน', (s.malaMerged || []).map(m => [m.day, m.into]), [[d3, yday]]);
eq('สรุปยอด 3 วันก่อน ไม่ค้างรอเช็คสต็อกแล้ว', [g.dayStatus_(SHOP, d3).need.indexOf('เช็คสต็อกปิดร้านหม่าล่า'), g.dayStatus_(SHOP, d3).mergedInto], [-1, yday]);
eq('สรุปบอกว่ารวมไปเทียบกับปิดร้านเมื่อวาน', /รวมไปเทียบกับปิดร้านวันที่/.test(g.daySummaryText_(SHOP, d3)), true);
// ปิดร้านเมื่อวาน (นับตอนนี้ ก่อนขายวันนี้) → สรุปของ 3 วันก่อนส่งด้วย
[d3, yday].forEach(d => g.expDoneMark_(SHOP, d, 'S.', 0, 0, 'x'));
const rows = g.countItemsAt_(SHOP).map(it => it.level ? { item: it.name, level: g.LEVELS[0] } : { item: it.name, packs: '', rem: it.name === 'ดอลลี่' ? 5 : 0, pieces: '' });
const sent0 = g.__env.SENT.length;
let r = g.handleStockCount_({ token: 't', location: SHOP, rows });
eq('นับได้', r.success, true);
g.cacheClear_();
eq('ปิดร้านเมื่อวานแล้ว · 3 วันก่อนรวมไปกับรอบนี้', [!!g.cashCloseCount_(SHOP, yday).countMs, !!g.cashCloseCount_(SHOP, d3).mergedMs], [true, true]);
eq('ไม่เตือนหม่าล่าแล้ว', [st(g).mala, st(g).malaMerged], [null, undefined]);
const said = g.__env.SENT.slice(sent0).map(x => x.messages.map(m => m.text).join('\n')).join('\n');
const dm = d => Number(d.slice(8, 10)) + '/' + Number(d.slice(5, 7));
eq('ส่งสรุปเมื่อวาน และสรุป 3 วันก่อน (รวมไปเทียบกับเมื่อวาน) ให้ด้วย',
   [said.indexOf('สรุปยอด ' + SHOP + ' วันที่ ' + dm(yday)) !== -1, said.indexOf('สรุปยอด ' + SHOP + ' วันที่ ' + dm(d3)) !== -1], [true, true]);

section('เบเกอรี่: วันก่อนหน้ามีรอบนับคั่นก่อนวันถัดไปขาย → ลงย้อนหลังได้ (กรอกแค่เงิน)');
g = setup(true);
s = st(g);
eq('ขึ้นทั้ง 2 วัน', (s.bakeryDays || []).map(b => [b.day, !!b.counted, b.into || '']), [[d3, true, ''], [yday, false, '']]);
r = g.handleBakeryCount_({ token: 't', round: 'หลังขาย', forDay: d3, rows: [], money: { cash: 160, transfer: 0, thai: 0 }, id: 'B3' });
const bs = g.__env.SHEETS[g.SHEET_BAKERY], row = bs.rows.slice(-1)[0], c = h => row[bs.headers.indexOf(h)];
eq('3 วันก่อน: ใช้ยอดนับก่อนขายเมื่อวาน ขาย 16 ตรง', [r.success, c('วันที่'), c('ขาย(ชิ้น)'), c('ผลเทียบ')], [true, d3, 16, 'ตรง']);
g.cacheClear_();
eq('เหลือเมื่อวานวันเดียว', (st(g).bakeryDays || []).map(b => b.day), [yday]);

section('เบเกอรี่: ไม่มีรอบนับคั่น → วันก่อนหน้ารวมไปกับวันถัดไป (ลงย้อนหลังไม่ได้)');
g = setup(false);
s = st(g);
eq('3 วันก่อนรวมไปกับเมื่อวาน · เมื่อวานลงได้', (s.bakeryDays || []).map(b => [b.day, b.into || '']), [[d3, yday], [yday, '']]);
eq('ตัวที่หน้าเว็บรุ่นเก่าดู = เมื่อวาน', s.bakery && s.bakery.day, yday);
eq('สรุปยอด 3 วันก่อนไม่รอนับเบเกอรี่', g.dayStatus_(SHOP, d3).need.indexOf('นับเบเกอรี่หลังขาย'), -1);
eq('สรุปบอกว่าเบเกอรี่รวมไปกับเมื่อวาน', /ยอดขายรวมไปกับวันที่/.test(g.daySummaryText_(SHOP, d3)), true);

process.exit(done().fail ? 1 : 0);
