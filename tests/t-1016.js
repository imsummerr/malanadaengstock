process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('16/10 — หมูพันเลือกหมูสามชั้นสไลซ์ได้ · เต้าหู้หลอดไม่มีของดิบ');

section('หมูพันเห็ดเข็ม / สาหร่าย / ชิเมจิ ใช้หมูสามชั้นสไลซ์พันได้');
{
  const g = fresh();
  const { buy } = require('./t-cost');
  const P3 = 'หมูสามชั้นสไลซ์ (ดิบ)';
  buy(g, 15, P3, 1, 134.25, 'b1', 9); buy(g, 15, 'เห็ดเข็ม (ดิบ)', 1, 50, 'b2', 9);
  buy(g, 15, 'สาหร่าย (ดิบ)', 1, 850, 'b3', 9); buy(g, 15, 'เห็ดชิเมจิ (ดิบ)', 1, 66.67, 'b4', 9);
  const bal = n => Math.round((g.stockBalances_()[g.CENTRAL][n] || 0) * 1000) / 1000;
  const pk = (item, inner, id) => g.handleStockPack_({ token: 't', item, packs: 1, rem: 0,
    raws: [{ name: P3, qty: 0.15 }, { name: inner, qty: 0.05 }], reqId: id });
  eq('หน้าเว็บได้ตัวเลือกสามชั้นด้วย', g.handleStockBootstrap_({ token: 't' }).data.rawGroups['เนื้อหมู'].indexOf(P3) !== -1, true);
  let r = pk('หมูพันเห็ดเข็มทอง', 'เห็ดเข็ม (ดิบ)', 'p1');
  eq('พันเห็ดเข็มด้วยสามชั้น', [r.success, bal(P3)], [true, 0.85]);
  r = pk('หมูพันสาหร่าย', 'สาหร่าย (ดิบ)', 'p2');
  eq('พันสาหร่ายด้วยสามชั้น', [r.success, bal(P3)], [true, 0.7]);
  r = pk('หมูพันเห็ดชิเมจิ', 'เห็ดชิเมจิ (ดิบ)', 'p3');
  eq('พันชิเมจิด้วยสามชั้น', [r.success, bal(P3)], [true, 0.55]);
  const P = g.__env.SHEETS[g.SHEET_PACK], h = P.headers;
  eq('แถวแพ็คจดชื่อหมูที่ใช้จริง', P.rows.slice(-3).map(x => x[h.indexOf('วัตถุดิบ')]), [P3, P3, P3]);
  r = g.handleStockPack_({ token: 't', item: 'หมูพันสาหร่าย', packs: 1, rem: 0,
    raws: [{ name: 'ไก่ (ดิบ)', qty: 0.15 }, { name: 'สาหร่าย (ดิบ)', qty: 0.05 }], reqId: 'p4' });
  eq('หมูนอกกลุ่ม (ไก่) ยังไม่รับเหมือนเดิม', r.success, false);
}

section('เต้าหู้หลอดไม่มีของดิบ — ซื้อเป็นถุง ส่งสาขาได้เลย นับเป็นหลอด');
{
  const g = fresh();
  const T = 'เต้าหู้หลอด';
  const ctx = id => ({ location: 'ครัวกลาง', who: 'S.', msgId: id, isGroup: true });
  const send = (text, id) => g.intakeSaveAndSummarize_(g.intakeParseText_(text), ctx(id), 'ข้อความ', id, []);
  const bal = (loc, n) => { g.cacheClear_(); return g.stockBalances_()[loc][n] || 0; };
  const it = g.findStockItem_(T);
  eq('ของพร้อมส่ง หลอด · ถุงละ 12 · ไม่มีของดิบ · หลอดละ 10 บาท',
     [it.ready, it.subUnit, it.packUnit, it.perPack, it.raws.length, it.price, g.findStockItem_(T + ' (ดิบ)')], [true, 'หลอด', 'ถุง', 12, 0, 10, null]);
  send('เต้าหู้หลอด 2 ถุง 108', 't1');
  eq('ไลน์ "2 ถุง" = 24 หลอด เข้าครัวกลางเป็นเต้าหู้หลอดเลย', bal(g.CENTRAL, T), 24);
  send('เต้าหลอด 1 ถุง ถุงละ 10 หลอด 45', 't2');
  eq('"ถุงละ 10" ได้ 10 หลอด', bal(g.CENTRAL, T), 34);
  const r = g.handleStockToShop_({ token: 't', item: T, location: SHOP, packs: 1, rem: 3 });
  eq('ส่งสาขา 1 ถุง 3 หลอด ได้เลย ไม่ต้องแพ็ค', [r.success, bal(g.CENTRAL, T), bal(SHOP, T)], [true, 19, 15]);
  g.cacheClear_();
  const L = g.costReplay_().layers[SHOP][T];
  eq('ทุนหลอดละ 4.5 (108 ÷ 24)', L.map(x => Math.round(x.cost * 100) / 100)[0], 4.5);
}

section('ของดิบเดิมในประวัติ ("เต้าหู้หลอด (ดิบ)") รวมเข้าเต้าหู้หลอดตอน fixItemList');
{
  const g = fresh();
  push(g, g.SHEET_INCOMING, { 'วันที่เวลา': new Date(Date.now() - 30 * 3600000), 'สาขา': g.CENTRAL, 'รายการ': 'เต้าหู้หลอด (ดิบ)', 'จำนวน': 12, 'ประเภท': 'ของเข้าครัวกลาง' });
  g.fixItemList(); g.cacheClear_();
  const b = g.stockBalances_()[g.CENTRAL];
  eq('12 หลอดย้ายมาเป็นเต้าหู้หลอด', [b['เต้าหู้หลอด'], b['เต้าหู้หลอด (ดิบ)'] || 0], [12, 0]);
}

process.exit(done().fail ? 1 : 0);
