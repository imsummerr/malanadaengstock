process.env.TZ = 'Asia/Bangkok';
const { makeCheck, formatDate } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('23/10e — หม่าล่าลืมเช็คสต็อกขึ้นทุกวัน · หยุดร้าน · ขายไม่ได้ใช้ POS ลงเงินย้อนหลัง');

// วันนี้เริ่ม 8 ชม.ก่อน · D1 (เมื่อวาน) = 8–32 · D2 = 32–56 · D3 = 56–80 · D4 = 80–104 ชม.ก่อน
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
const view = g => (late(g).malaDays || []).map(x => dm(x.day) + (x.sold ? ' ขาย' : ' ไม่มีบิล') + (x.count ? ' นับได้' : ''));
const rows = g => g.countItemsAt_(SHOP).map(it => it.level ? { item: it.name, level: g.LEVELS[0] } : { item: it.name, packs: '', rem: 0, pieces: '' });
const said = (g, n) => g.__env.SENT.slice(n).map(x => x.messages.map(m => m.text).join('\n')).join('\n');

// ตัวอย่างของเจ้าของ: D4 (19/10) นับเย็น · D3 (20/10) ขายลืมนับ · D2 (21/10) ไม่มีบิล · D1 (22/10) ขายลืมนับ · วันนี้ยังไม่ขาย
function owner() {
  const g = base();
  count(g, 100, 60); bill(g, 95); count(g, 84, 50);
  bill(g, 70); bill(g, 65);
  bill(g, 20); bill(g, 15);
  [4, 3, 2, 1].forEach(k => g.expDoneMark_(SHOP, day(g, 24 * k - 12), 'S.', 0, 0, 'x'));
  return g;
}
const D3d = g => day(g, 68), D2d = g => day(g, 44), D1d = g => day(g, 20);

section('ขึ้นทุกวันที่ยังไม่ได้เช็คสต็อก — รวมวันที่ไม่มีบิล');
let g = owner();
const d3 = D3d(g), d2 = D2d(g), d1 = D1d(g);
eq('20 ขาย (นับไม่ได้แล้ว) · 21 ไม่มีบิล · 22 ขาย นับได้', view(g), [dm(d3) + ' ขาย', dm(d2) + ' ไม่มีบิล', dm(d1) + ' ขาย นับได้']);
eq('นับตอนนี้ = ปิดร้านของ 22 (ก่อนบิลแรก)', [late(g).mala.day, late(g).mala.afterBill, late(g).mala.sold], [d1, false, true]);
eq('ไม่มีตัวเลขเงินในรายการวัน', Object.keys(late(g).malaDays[0]).sort(), ['count', 'day', 'dm', 'sold']);

section('กดหยุดร้าน — วันที่ไม่มีบิล');
let n0 = g.__env.SENT.length;
let r = g.handleShopClosed_({ token: 't', location: SHOP, day: d2 });
eq('บันทึกได้ · ส่ง late ใหม่กลับไป', [r.success, (r.late.malaDays || []).length], [true, 2]);
eq('ชีตหยุดร้านมีแถว', g.__env.SHEETS[g.SHEET_SHOP_CLOSED].rows.map(x => [x[0], x[1], x[3]]), [[d2, SHOP, 'ลลิตา']]);
eq('แจ้งกลุ่มไลน์ว่าใครกด', /หยุดร้าน \(ไม่ได้ขาย\)[\s\S]*กดโดย ลลิตา/.test(said(g, n0)), true);
eq('21 ไม่ขึ้นแล้ว', view(g), [dm(d3) + ' ขาย', dm(d1) + ' ขาย นับได้']);
eq('กดซ้ำไม่ได้', g.handleShopClosed_({ token: 't', location: SHOP, day: d2 }).success, false);
r = g.handleShopClosed_({ token: 't', location: SHOP, day: d3 });
eq('วันที่มีบิล กดหยุดร้านไม่ได้', [r.success, /มีขายแล้ว/.test(r.message)], [false, true]);
r = g.handleShopClosed_({ token: 't', location: 'สาขาอื่น', day: d2 });
eq('สาขาอื่นกดไม่ได้', r.success, false);
eq('ไม่มีอะไรต้องสรุปของวันหยุด', g.dayStatus_(SHOP, d2).any, false);

section('นับปิดร้าน 22 → 20 รวมไปเทียบด้วย · ไม่ค้างแล้ว');
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), forDay: d1 });
eq('บันทึกได้', r.success, true);
g.cacheClear_();
const c1 = g.cashCloseCount_(SHOP, d1);
eq('ปิดร้าน 22 เทียบจากเช็คสต็อกล่าสุด (19 เย็น)', [!!c1.countMs, c1.prevMs], [true, at(84).getTime()]);
eq('20 รวมไปกับรอบนี้', g.cashCloseCount_(SHOP, d3).mergedMs, c1.countMs);
eq('ไม่ค้างแล้ว', [late(g).malaDays, late(g).mala], [undefined, null]);

section('19 นับ · 20 หยุด · 21 ขาย — ของหายคิดจากเช็คสต็อก 19');
g = base();
count(g, 79, 60); bill(g, 70); count(g, 60, 50);           // D3 (19) ขาย นับเย็น
bill(g, 20); count(g, 12, 40);                             // D1 (21) ขาย นับเย็น · D2 (20) ไม่มีบิล
eq('20 ไม่มีบิล แต่มีรอบนับหลังจากนั้น — ยังถาม (นับไม่ได้)', view(g), [dm(day(g, 44)) + ' ไม่มีบิล']);
g.handleShopClosed_({ token: 't', location: SHOP, day: day(g, 44) });
g.cacheClear_();
eq('ปิดร้าน 21 เทียบจาก 19', g.cashCloseCount_(SHOP, day(g, 20)).prevMs, at(60).getTime());
eq('ไม่ค้างแล้ว', view(g), []);

section('วันล่าสุดไม่มีบิล — นับเป็นของวันนั้นต้องกรอกเงิน (หยุดร้านกดปุ่มแทน)');
g = base();
count(g, 60, 60); bill(g, 50); count(g, 34, 50);           // D2 ขาย นับเย็น · D1 ไม่มีบิล ไม่ได้นับ
g.expDoneMark_(SHOP, day(g, 20), 'S.', 0, 0, 'x');
const u1 = day(g, 20);
eq('D1 ไม่มีบิล นับได้', [view(g), late(g).mala.sold], [[dm(u1) + ' ไม่มีบิล นับได้'], false]);
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), forDay: u1 });
eq('ไม่กรอกเงิน = ไม่รับ', [r.success, /ไม่มีบิลใน POS/.test(r.message)], [false, true]);
n0 = g.__env.SENT.length;
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g), forDay: u1, money: { cash: 400, transfer: 100 } });
eq('กรอกเงิน = นับเป็นปิดร้านของ D1', [r.success, g.malaMoneyFor_(SHOP, u1).total, g.closeDayOfCount_(SHOP, g.cashCloseCount_(SHOP, u1).countMs)], [true, 500, u1]);
eq('สรุปยอด D1 (ขาย 50 ไม้ = 500 ตรงกับที่กรอก)', /ได้จริง \(กรอกตอนเช็คสต็อก\) 500[\s\S]*→ ตรงกัน/.test(said(g, n0)), true);
eq('ไม่ค้างแล้ว', view(g), []);

section('วันก่อนหน้าไม่มีบิล ขายแต่ไม่ได้ใช้ POS — ลงเงินย้อนหลัง รวมไปเทียบกับรอบนับถัดไป');
g = base();
count(g, 84, 80); bill(g, 75); count(g, 58, 70);           // D3 ขาย นับเย็น (ฐาน 70)
bill(g, 20);                                               // D2 ไม่มีบิล (ขาย 30 ไม้ไม่ได้กด) · D1 ขาย 1 บิล (10 ไม้)
[2, 1].forEach(k => g.expDoneMark_(SHOP, day(g, 24 * k - 4), 'S.', 0, 0, 'x'));
const e2 = day(g, 44), e1 = day(g, 20);
eq('D2 ไม่มีบิล · D1 ขาย นับได้', view(g), [dm(e2) + ' ไม่มีบิล', dm(e1) + ' ขาย นับได้']);
r = g.handleMalaLateMoney_({ token: 't', location: SHOP, day: e2, money: {} });
eq('ไม่กรอกอะไร = ไม่รับ', r.success, false);
n0 = g.__env.SENT.length;
r = g.handleMalaLateMoney_({ token: 't', location: SHOP, day: e2, money: { cash: 240 },
  delivery: [{ platform: 'Grab', amount: 120, items: [{ name: 'อุด้ง', qty: 1 }] }] });
eq('บันทึกได้', r.success, true);
eq('ชีตเงินขาย: ของ D2 ไม่มีรอบนับ · หมายเหตุลงย้อนหลัง', (() => { const x = g.__env.SHEETS[g.SHEET_MALA_MONEY].rows.slice(-1)[0];
  return [x[0], x[4], x[8], x[9]]; })(), [e2, 240, '', 'ลงย้อนหลัง (ไม่ได้นับวันนั้น)']);
eq('เดลิเวอรี่ลงเป็นของ D2', g.cashBizDay_(new Date(g.__env.SHEETS[g.SHEET_DELIVERY].rows[0][0] + 'T' + g.__env.SHEETS[g.SHEET_DELIVERY].rows[0][1] + '+07:00').getTime()), e2);
eq('แจ้งกลุ่ม', /ลงเงินขายย้อนหลัง[\s\S]*🛵 เดลิเวอรี่ 1 ออเดอร์/.test(said(g, n0)), true);
eq('D2 = ขาย (รวมไปกับรอบนับถัดไป) · D1 นับได้', view(g), [dm(e2) + ' ขาย', dm(e1) + ' ขาย นับได้']);
eq('ลงซ้ำไม่ได้', g.handleMalaLateMoney_({ token: 't', location: SHOP, day: e2, money: { cash: 1 } }).success, false);
// นับปิดร้าน D1 เหลือ 30 → ของออก 40 ไม้ = 400 − ไปกับเดลิเวอรี่อุด้ง 1 ที่ (6 ชิ้น = 60) = ควรได้ 340 · D2 กรอก 240 + D1 POS 100 = 340 ตรง
n0 = g.__env.SENT.length;
g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g).map(x => x.item === 'ดอลลี่' ? Object.assign({}, x, { rem: 30 }) : x), forDay: e1 });
g.cacheClear_();
let t = said(g, n0);
eq('D2 รวมไปกับรอบนี้', g.cashCloseCount_(SHOP, e2).mergedMs, g.cashCloseCount_(SHOP, e1).countMs);
eq('สรุปปิดร้าน D1: ได้จริงรวมเงิน D2 + POS D1 = 340 ตรง',
   [/ได้จริง 340/.test(t), new RegExp('• ' + dm(e2) + ' กรอกเอง 240').test(t), /POS วันอื่นในช่วงนี้ 1 บิล 100/.test(t), /→ ตรงกัน/.test(t)],
   [true, true, true, true]);
eq('สรุปของ D2 บอกว่ารวมไปเทียบกับรอบนับ', new RegExp('ไม่ได้นับปิดร้านวันที่ ' + dm(e2) + ' · รวมไปเทียบกับรอบนับ').test(t), true);
eq('ไม่ค้างแล้ว', view(g), []);

section('ลงเงินย้อนหลังหลังจากรอบนับถัดไปนับไปแล้ว — สรุปรอบนั้นใหม่');
g = base();
count(g, 84, 80); bill(g, 75); count(g, 58, 70);           // D3 นับเย็น
bill(g, 20); count(g, 12, 30);                             // D2 ไม่มีบิล · D1 ขาย 1 บิล นับเย็น เหลือ 30
[2, 1].forEach(k => g.expDoneMark_(SHOP, day(g, 24 * k - 4), 'S.', 0, 0, 'x'));
const f2 = day(g, 44), f1 = day(g, 20);
eq('D2 ยังถาม (นับไม่ได้แล้ว)', view(g), [dm(f2) + ' ไม่มีบิล']);
n0 = g.__env.SENT.length;
r = g.handleMalaLateMoney_({ token: 't', location: SHOP, day: f2, money: { cash: 300 } });
t = said(g, n0);
eq('บันทึกได้ · ส่งสรุปปิดร้าน D1 ใหม่ (รวมเงิน D2 แล้ว ตรง)',
   [r.success, new RegExp('สรุปยอด ' + SHOP + ' วันที่ ' + dm(f1)).test(t), /ได้จริง 400/.test(t), /→ ตรงกัน/.test(t)], [true, true, true, true]);
eq('ไม่ค้างแล้ว', view(g), []);

section('วันก่อน MALA_LATE_FROM ที่ไม่มีบิล ไม่ถาม');
g = base();
g.MALA_LATE_FROM = day(g, 20);
count(g, 84, 80); bill(g, 75); count(g, 58, 70);
eq('ถามแค่ตั้งแต่วันที่กำหนด', view(g), [dm(day(g, 20)) + ' ไม่มีบิล นับได้']);

process.exit(done().fail ? 1 : 0);
