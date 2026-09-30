process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, D, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('เช็คสต็อก');

/** รายการที่หน้าเว็บส่งมาให้นับที่สถานที่นี้ — ตรงกับ itemsFor() ใน stock.html */
function webList(g, loc) {
  const want = loc === g.CENTRAL ? g.SCOPE_CENTRAL : g.SCOPE_SHOP;
  return g.getStockItems_().filter(i => !i.scope || i.scope === want);
}

section('สาขานับครบตามที่หน้าเว็บโชว์ ต้องบันทึกได้');
let g = fresh();
const shopRows = webList(g, SHOP).map(i => ({ item: i.name, packs: '', rem: 0, pieces: '' }));
let r = g.handleStockCount_({ token: 't', location: SHOP, rows: shopRows });
eq('บันทึกได้', r.success, true);
eq('ไม่ถามหาของดิบที่อยู่แค่ครัวกลาง', /ขาด/.test(r.message || ''), false);
eq('นับครบตามรายการของสาขา', r.counted, shopRows.length);

section('ครัวกลางนับครบ ต้องบันทึกได้');
g = fresh();
const cRows = webList(g, g.CENTRAL).map(i => ({ item: i.name, packs: '', rem: 0, pieces: '' }));
r = g.handleStockCount_({ token: 't', location: g.CENTRAL, rows: cRows });
eq('บันทึกได้', r.success, true);

section('ยังนับไม่ครบ ต้องไม่ให้บันทึก');
r = g.handleStockCount_({ token: 't', location: SHOP, rows: shopRows.slice(1) });
eq('ไม่ให้บันทึก', r.success, false);

process.exit(done().fail ? 1 : 0);
