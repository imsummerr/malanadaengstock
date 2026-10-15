process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('คืนของเสีย — เจอของที่ลงของเสียไว้ (15/10)');

const R = 'เห็ดออเร็นจิ (ดิบ)', V = 'วุ้นเส้นเกาหลี (ดิบ)';
const at = h => new Date(Date.now() - h * 3600000);
const setup = () => {
  const g = fresh();
  push(g, g.INTAKE_SHEET, { 'รายการ': R, 'จำนวนเงิน': 60, 'messageId': 'b1' });
  push(g, g.SHEET_INCOMING, { 'วันที่เวลา': at(30), 'สาขา': g.CENTRAL, 'รายการ': R, 'จำนวน': 1, 'ประเภท': 'ของเข้าครัวกลาง', 'messageId': 'b1' });
  push(g, g.INTAKE_SHEET, { 'รายการ': V, 'จำนวนเงิน': 64, 'messageId': 'b2' });
  push(g, g.SHEET_INCOMING, { 'วันที่เวลา': at(30), 'สาขา': g.CENTRAL, 'รายการ': V, 'จำนวน': 1, 'ประเภท': 'ของเข้าครัวกลาง', 'messageId': 'b2' });
  g.handleStockWaste_({ token: 't', item: R, location: g.CENTRAL, packs: 0, rem: 0.749, reason: 'หมดอายุ', reqId: 'w1' });
  g.handleStockWaste_({ token: 't', item: V, location: g.CENTRAL, packs: 0, rem: 0.5, reason: 'หมดอายุ', reqId: 'w2' });
  g.cacheClear_();
  return g;
};
const bal = (g, n) => Math.round((g.stockBalances_()[g.CENTRAL][n] || 0) * 1000) / 1000;
const kitchen = g => { const p = g.costSummary_().pl[g.CENTRAL]; return Math.round((p['ของเสีย'] + p['ค่าใช้จ่ายวัตถุดิบ']) * 100) / 100; };

section('ลงของเสียแล้ว — ยอดลด · ค่าใช้จ่ายครัวกลาง');
let g = setup();
eq('เหลือ 0.251 / 0.5', [bal(g, R), bal(g, V)], [0.251, 0.5]);
eq('ของเสียครัวกลาง 0.749×60 + 0.5×64 = 76.94', kitchen(g), 76.94);

section('เจ้าของเห็นรายการ แล้วกดคืน');
let list = g.handleWasteList_({ token: 't', location: g.CENTRAL });
eq('เห็น 2 แถว ล่าสุดก่อน', list.data.map(x => [x.item, x.qty, x.reason]), [[V, 0.5, 'หมดอายุ'], [R, 0.749, 'หมดอายุ']]);
const x = list.data[1];
g.__env.SENT.length = 0;
let r = g.handleWasteUndo_({ token: 't', location: g.CENTRAL, row: x.row, item: x.item, t: x.t });
eq('คืนได้', [r.success, /คืน เห็ดออเร็นจิ \(ดิบ\)/.test(r.message)], [true, true]);
eq('ยอดกลับมา 1 · อีกตัวไม่ขยับ', [bal(g, R), bal(g, V)], [1, 0.5]);
eq('ค่าใช้จ่ายครัวกลางเหลือแค่วุ้นเส้น 32', kitchen(g), 32);
eq('แจ้งกลุ่มไลน์ครัวกลาง', /↩️ คืนเข้าสต็อก — ครัวกลาง[\s\S]*เห็ดออเร็นจิ \(ดิบ\)[\s\S]*เจอแล้ว · โดย/.test(g.__env.SENT.map(m => m.messages[0].text).join('\n')), true);
const W = g.__env.SHEETS[g.SHEET_WASTE];
eq('แถวยังอยู่ จดว่าเจอคืน', [W.rows.length, /^เจอคืน .* · เจ้าของ$/.test(W.rows[0][W.headers.indexOf('ยกเลิก')])], [2, true]);
eq('รายการเหลือแถวเดียว', g.handleWasteList_({ token: 't', location: g.CENTRAL }).data.map(y => y.item), [V]);
r = g.handleWasteUndo_({ token: 't', location: g.CENTRAL, row: x.row, item: x.item, t: x.t });
eq('กดซ้ำ ไม่คืนซ้ำ', [r.success, bal(g, R)], [false, 1]);

section('กันพลาด');
r = g.handleWasteUndo_({ token: 't', location: g.CENTRAL, row: list.data[0].row, item: R, t: list.data[0].t });
eq('ชื่อไม่ตรงแถว ไม่คืน', [r.success, bal(g, V)], [false, 0.5]);
g.checkToken_ = () => ({ role: 'staff', branch: SHOP, branches: [SHOP], name: 'ลลิตา' });
eq('พนักงานดู/คืนไม่ได้', [g.handleWasteList_({ token: 't', location: g.CENTRAL }).code,
   g.handleWasteUndo_({ token: 't', location: g.CENTRAL, row: list.data[0].row, item: V, t: list.data[0].t }).code], [403, 403]);

process.exit(done().fail ? 1 : 0);
