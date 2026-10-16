process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh } = require('./fixture');
const { eq, section, done } = makeCheck('16/10 — หมูพันเลือกหมูสามชั้นสไลซ์ได้');

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

process.exit(done().fail ? 1 : 0);
