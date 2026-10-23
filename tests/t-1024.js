process.env.TZ = 'Asia/Bangkok';
const { makeCheck, formatDate } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('24/10 — วันนี้ที่ยังไม่ได้นับขึ้นด้วย · เลือกนับเป็นของวันนี้ได้ · หยุดร้านวันนี้');

// วันนี้เริ่ม 8 ชม.ก่อน · D1 (เมื่อวาน) = 8–32 · D2 = 32–56 · D3 = 56–80 ชม.ก่อน
const NOW = Date.now(), H = 3600000;
const at = h => new Date(NOW - h * H);
const ymd = d => formatDate(d, '', 'yyyy-MM-dd');
const hms = d => formatDate(d, '', 'HH:mm:ss');
const bill = (g, h) => push(g, g.SHEET_ORDERS, { 'วันที่': ymd(at(h)), 'เวลา': hms(at(h)), 'สาขา': SHOP,
  'ยอดรวม': 100, 'ส่วนลด': 0, 'ยอดสุทธิ': 100, 'รวมไม้': 10, 'วิธีชำระเงิน': 'เงินสด' });
const count = (g, h, qty) => push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(h), 'สาขา': SHOP, 'รายการ': 'ดอลลี่', 'จำนวน': qty, 'ประเภท': 'เช็คสต็อก' });

function base() {
  const g = fresh();
  g.CASH_DAY_CUT_HOURS = (new Date(NOW).getHours() + 16) % 24;
  g.BAKERY_START_DATE = '2999-01-01';
  g.MALA_LATE_FROM = '2000-01-01';
  g.__env.SHEETS[g.SHEET_EXPENSE] = { headers: g.EXPENSE_HEADERS.slice(), rows: [] };
  g.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
  g.checkToken_ = () => ({ role: 'staff', branch: SHOP, branches: [SHOP], name: 'ลลิตา' });
  return g;
}
const day = (g, h) => g.cashBizDay_(NOW - h * H);
const dm = d => Number(d.slice(8, 10)) + '/' + Number(d.slice(5, 7));
const late = g => { g.cacheClear_(); return g.lateStatus_(SHOP, NOW); };
const view = g => (late(g).malaDays || []).map(x => dm(x.day) + (x.sold ? ' ขาย' : ' ไม่มีบิล') + (x.count ? ' นับได้' : '') +
  (x.ifClosed ? ' (ถ้า ' + x.ifClosed.join(',') + ' หยุด)' : ''));
const rows = g => g.countItemsAt_(SHOP).map(it => it.level ? { item: it.name, level: g.LEVELS[0] } : { item: it.name, packs: '', rem: 0, pieces: '' });

// D3 นับเย็น · D2 ขายลืมนับ · D1 ขายลืมนับ · วันนี้ไม่มีบิล ยังไม่ได้นับ (เหมือน 20/22/23 ของจริง)
function setup() {
  const g = base();
  count(g, 79, 60); bill(g, 70); count(g, 60, 50);
  bill(g, 45); bill(g, 20);
  return g;
}

section('วันนี้ยังไม่ได้นับ — ขึ้นด้วย');
let g = setup();
const d2 = day(g, 44), d1 = day(g, 20), today = g.cashBizDay_(NOW);
let s = late(g);
eq('วันค้าง D2 · D1 (นับได้) + วันนี้ไม่มีบิล', [view(g), s.malaToday && [s.malaToday.day, s.malaToday.sold]],
   [[dm(d2) + ' ขาย', dm(d1) + ' ขาย นับได้'], [today, false]]);
eq('ไม่มีตัวเลข', Object.keys(s.malaToday).sort(), ['day', 'dm', 'night', 'sold']);

section('เลือกนับเป็นของวันนี้ (ขายไม่ได้ใช้ POS) — D1 D2 รวมไปเทียบกับรอบนี้');
let r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), forDay: today });
eq('ไม่กรอกเงิน = ไม่รับ', [r.success, /ไม่มีบิลใน POS/.test(r.message)], [false, true]);
const n0 = g.__env.SENT.length;
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), forDay: today, money: { cash: 300 } });
eq('กรอกเงิน = บันทึกได้', r.success, true);
g.cacheClear_();
const ct = g.cashCloseCount_(SHOP, today);
eq('เป็นปิดร้านของวันนี้ (จดวันไว้ ไม่ใช่ลงย้อนหลัง)', [!!ct.countMs, ct.tagged, g.closeDayOfCount_(SHOP, ct.countMs)], [true, true, today]);
const C = g.__env.SHEETS[g.SHEET_COUNT], note = C.headers.indexOf('หมายเหตุ');
eq('หมายเหตุไม่มีคำว่าลงย้อนหลัง', C.rows.slice(-1)[0][note].indexOf('(ลงย้อนหลัง)'), -1);
eq('D1 D2 รวมไปกับรอบนี้', [g.cashCloseCount_(SHOP, d1).mergedMs, g.cashCloseCount_(SHOP, d2).mergedMs], [ct.countMs, ct.countMs]);
eq('ไลน์บอกว่าเป็นปิดร้านของวันนี้', new RegExp('ปิดร้านของวันที่ ' + dm(today)).test(g.__env.SENT.slice(n0).map(x => x.messages.map(m => m.text).join('\n')).join('\n')), true);
s = late(g);
eq('ไม่ค้างแล้ว', [s.malaDays, s.mala, s.malaToday], [undefined, null, undefined]);

section('เลือกปิดร้านของเมื่อวาน + กดหยุดร้านวันนี้');
g = setup();
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), forDay: d1 });
eq('นับเป็นของ D1 ได้', r.success, true);
eq('วันนี้ยังขึ้น (ยังไม่ได้นับ/ไม่ได้หยุด)', !!late(g).malaToday, true);
r = g.handleShopClosed_({ token: 't', location: SHOP, day: today });
eq('กดหยุดร้านวันนี้ได้ (ไม่มีบิล)', [r.success, r.late.malaToday], [true, undefined]);
eq('ไม่ค้างแล้ว', [view(g), late(g).malaToday], [[], undefined]);

section('วันนี้มีบิล — กดหยุดร้านไม่ได้');
g = setup(); bill(g, 2);
s = late(g);
eq('วันนี้ขายแล้ว', [s.malaToday.sold, s.mala.afterBill], [true, true]);
eq('หยุดร้านวันนี้ไม่ได้', g.handleShopClosed_({ token: 't', location: SHOP, day: today }).success, false);

section('วันขายที่ตามด้วยวันไม่มีบิล — บอกว่าถ้าวันนั้นหยุด ยังนับได้');
g = base();
count(g, 79, 60); bill(g, 70); count(g, 60, 50);
bill(g, 45);                                               // D2 ขาย · D1 ไม่มีบิล
eq('D2 (ถ้า D1 หยุด) · D1 นับได้', view(g), [dm(day(g, 44)) + ' ขาย (ถ้า ' + dm(day(g, 20)) + ' หยุด)', dm(day(g, 20)) + ' ไม่มีบิล นับได้']);
g.handleShopClosed_({ token: 't', location: SHOP, day: day(g, 20) });
eq('กด D1 หยุด → D2 นับได้', view(g), [dm(day(g, 44)) + ' ขาย นับได้']);

section('กดหยุดร้านไว้ แต่มีบิลวันนั้น — ถือว่าขาย');
bill(g, 15);
eq('D1 มีบิลแล้ว ขึ้นเป็นวันขาย', view(g), [dm(day(g, 44)) + ' ขาย', dm(day(g, 20)) + ' ขาย นับได้']);

process.exit(done().fail ? 1 : 0);
