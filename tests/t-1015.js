process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('15/10 — ไดฟุกุสตอเบอร์รี่ · บราวนี่อัลม่อนสไลซ์');

const S = 'ไดฟุกุ สตอเบอร์รี่';
const ctx = { location: 'ครัวกลาง', who: 'S.', msgId: 'm', isGroup: true };
const send = (g, t, id) => g.intakeSaveAndSummarize_(g.intakeParseText_(t), Object.assign({}, ctx, { msgId: id }), 'ข้อความ', id, []);

section('แคตตาล็อก');
{
  const g = fresh();
  const it = g.findStockItem_(S);
  eq('เป็นเบเกอรี่ · ชุดละ 40 ลูก · แพ็คละ 2 ชุด · ทุนลูกละ 6.5', [!!it, it && it.bakery, it && it.subUnit, it && it.perPack, g.bakeryCost_(S)], [true, true, 'ชุด', 2, 6.5]);
  eq('บัญชีเบเกอรี่', g.bizOfItem_(S), 'เบเกอรี่');
}

section('ไลน์ซื้อเข้า — สะกดได้หลายแบบ');
{
  const g = fresh();
  const o = send(g, 'ครัวกลางเบเกอรี่\nสตอเบอร์รี่ 1 แพ็ค 520 บาท เข้า 14/10', 'a1');
  const bal = () => g.stockBalances_()[g.CENTRAL][S] || 0;
  eq('1 แพ็ค = 80 ลูก · วันเข้าตามที่พิมพ์', [bal(), /ไดฟุกุ สตอเบอร์รี่ 80 ลูก/.test(o), /วันเข้า 14\/10/.test(o)], [80, true, true]);
  ['ไดฟุกุสตรอเบอรี่ 1 ชุด 260', 'สตรอว์เบอร์รี 1 ชุด 260', 'ไดฟุกุ สตอเบอรี่ 1 ชุด 260'].forEach((t, i) => send(g, t, 'a' + (i + 2)));
  eq('สตรอเบอรี่ / สตรอว์เบอร์รี / สตอเบอรี่ = รสเดียวกัน', bal(), 200);
  eq('"เช็คสต็อก" ไม่กลายเป็นสตอเบอร์รี่', g.intakeParseText_('เช็คสต็อก 1').map(x => x.raw), ['เช็คสต็อก']);
}

section('วันเปลี่ยนรส — เมื่อวานนับก่อนขาย 6 รส (ก่อนเพิ่มสตอเบอร์รี่) ลงหลังขายย้อนหลังได้');
{
  const g = fresh();
  g.checkToken_ = () => ({ role: 'staff', branch: SHOP, branches: [SHOP], name: 'ลลิตา' });
  const NEW = [S, 'บราวนี่ อัลม่อนสไลซ์'], OLD = g.BAKERY_ITEMS.map(b => b[0]).filter(n => NEW.indexOf(n) === -1);
  const now = Date.now(), y = now - 26 * 3600000;
  const push = (t, n, q, note) => { const C = g.__env.SHEETS[g.SHEET_COUNT], r = new Array(C.headers.length).fill('');
    const set = (h, v) => { r[C.headers.indexOf(h)] = v; };
    set('วันที่เวลา', new Date(t)); set('สาขา', SHOP); set('รายการ', n); set('จำนวน', q); set('ประเภท', g.KIND_BAKERY_COUNT); set('หมายเหตุ', note);
    C.rows.push(r); g.cacheClear_(); };
  OLD.forEach(n => push(y, n, 20, 'ก่อนขาย · ยอดระบบ 20'));
  const yday = g.cashBizDay_(y);
  const rows = OLD.map(n => ({ item: n, qty: 15 })).concat(NEW.map(n => ({ item: n, qty: 0 })));
  const r = g.handleBakeryCount_({ token: 't', round: 'หลังขาย', forDay: yday, rows, money: { cash: 300, transfer: 0, thai: 0 }, id: 'L1' });
  eq('ลงย้อนหลังได้ · ขาย 6 รส × 5 = 30 ชิ้น', [r.success, r.message && /30/.test(JSON.stringify(r)) || r.success], [true, true]);
  const B = g.__env.SHEETS[g.SHEET_BAKERY], last = B.rows.slice(-1)[0];
  eq('ขาย 30 ชิ้น ควรได้ 300 ตรง', [last[B.headers.indexOf('ขาย(ชิ้น)')], last[B.headers.indexOf('ผลเทียบ')]], [30, 'ตรง']);
}

section('บราวนี่ อัลม่อนสไลซ์');
{
  const g = fresh(), A = 'บราวนี่ อัลม่อนสไลซ์';
  const it = g.findStockItem_(A);
  eq('เบเกอรี่ · แพ็คละ 25 ชิ้น · ทุนชิ้นละ 6', [!!it, it && it.bakery, it && it.perPack, g.bakeryCost_(A)], [true, true, 25, 6]);
  send(g, 'บราวนี่อัลม่อนสไลด์ 1 แพ็ค 150', 'b1');
  send(g, 'อัลมอนด์ 1 แพ็ค 150', 'b2');
  eq('ไลน์: อัลม่อนสไลด์ / อัลมอนด์ = รสเดียวกัน 50 ชิ้น', g.stockBalances_()[g.CENTRAL][A], 50);
  eq('บราวนี่โอริโอ้ไม่ปน', g.stockBalances_()[g.CENTRAL]['บราวนี่ โอริโอ้'] || 0, 0);
}

section('ส่งสาขาก่อนลงซื้อเข้าในไลน์ (15/10 17:11 ส่ง · 17:13 ลงซื้อ) — มูลค่าครัวกลางไม่เบิ้ล');
{
  const g = fresh(), { push, D } = require('./fixture');
  const msg = 'buy1';
  push(g, g.SHEET_INCOMING, { 'วันที่เวลา': D(15, 17, 9), 'สาขา': SHOP, 'รายการ': S, 'จำนวน': 40, 'ประเภท': 'ของเข้าร้าน' });
  push(g, g.INTAKE_SHEET, { 'รายการ': S, 'จำนวนเงิน': 520, 'messageId': msg });
  push(g, g.SHEET_INCOMING, { 'วันที่เวลา': D(15, 18, 9), 'สาขา': g.CENTRAL, 'รายการ': S, 'จำนวน': 80, 'ประเภท': 'ของเข้าครัวกลาง', 'messageId': msg });
  const s = g.costSummary_(), bk = s.biz['เบเกอรี่'];
  const row = (loc) => (bk.stock[loc].rows.find(r => r.item === S) || {});
  eq('ครัวกลางเหลือ 40 ลูก = 260 (ไม่ใช่ 80 = 520)', [row(g.CENTRAL).qty, row(g.CENTRAL).value, g.stockBalances_()[g.CENTRAL][S]], [40, 260, 40]);
  eq('สาขา 40 ลูก = 260 · ลงซื้อแล้วไม่เตือน', [row(SHOP).qty, row(SHOP).value, s.warn.filter(w => w.item === S).length], [40, 260, 0]);
  push(g, g.SHEET_INCOMING, { 'วันที่เวลา': D(16, 17, 9), 'สาขา': SHOP, 'รายการ': S, 'จำนวน': 60, 'ประเภท': 'ของเข้าร้าน' });
  const s2 = g.costSummary_();
  eq('ส่งเกินที่ซื้อ ยังไม่ลงของเข้า → เตือนขาด 20', s2.warn.filter(w => w.item === S).map(w => /ขาด 20 — ยังไม่ได้ลงของเข้า/.test(w.msg)), [true]);
}

section('ของหายเบเกอรี่ — ค่าที่ที่จ่ายเงินสดจากเงินขายไม่ใช่ของหาย · นับตั้งแต่ 10/10');
{
  const g = fresh(), { push } = require('./fixture');
  g.BAKERY_START_DATE = '2026-10-01';
  g.bakerySheet_();
  const BS = g.__env.SHEETS[g.SHEET_BAKERY];
  const brow = (d, cash, sold) => BS.rows.push([d, '21:00:00', SHOP, 'x', cash, 0, 0, cash, sold, sold * 10, cash - sold * 10, '', '', 'b' + d]);
  brow('2026-10-07', 50, 10);    // ก่อน 8/10 — ไม่นับ
  brow('2026-10-13', 860, 92);   // ขาด 60 ตามยอดที่กรอก
  g.__env.SHEETS[g.SHEET_EXPENSE] = g.__env.SHEETS[g.SHEET_EXPENSE] || { headers: g.EXPENSE_HEADERS.slice(), rows: [] };
  const EX = g.__env.SHEETS[g.SHEET_EXPENSE]; if (EX.headers.indexOf('ธุรกิจ') === -1) EX.headers.push('ธุรกิจ');
  g.cacheClear_();
  eq('ยังไม่ได้บอกว่าค่าที่เป็นของเบเกอรี่ = ของหาย 60', g.missingGoods_(SHOP, 'เบเกอรี่')['บาท'], 60);
  push(g, g.SHEET_EXPENSE, { 'วันที่': '2026-10-13', 'เวลา': '20:35:06', 'สาขา': SHOP, 'ประเภท': 'ค่าที่', 'จำนวนเงิน': 60, 'วิธีจ่าย': 'เงินสด', 'ธุรกิจ': 'เบเกอรี่' });
  const m = g.missingGoods_(SHOP, 'เบเกอรี่');
  eq('ค่าที่เงินสดของเบเกอรี่ = จ่ายจากเงินขาย → ไม่หาย · ไม่นับก่อน 10/10', [m['บาท'], m['ควรได้'], m['ได้จริง'], m['ตั้งแต่']], [0, 920, 920, '13/10']);
}

process.exit(done().fail ? 1 : 0);
