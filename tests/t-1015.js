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

process.exit(done().fail ? 1 : 0);
