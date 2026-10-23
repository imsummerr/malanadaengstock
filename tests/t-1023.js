process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('23/10 — สาหร่ายเปล่าเสียบไม้');

section('แคตตาล็อก · แพ็ค · ไลน์ยังลงของดิบ');
{
  const g = fresh();
  const it = g.findStockItem_('สาหร่าย');
  eq('ขายเป็นไม้ แพ็คละ 10 ราคา 10 · ตัดจากสาหร่าย (ดิบ)', [it.subUnit, it.perPack, it.price, it.raws], ['ไม้', 10, 10, ['สาหร่าย (ดิบ)']]);
  eq('ของดิบยังเป็นโล อยู่ครัวกลาง', [g.findStockItem_('สาหร่าย (ดิบ)').subUnit, g.findStockItem_('สาหร่าย (ดิบ)').scope], ['กก.', g.SCOPE_CENTRAL]);
  const ctx = { location: 'ครัวกลาง', who: 'S.', msgId: 's1', isGroup: true };
  g.intakeSaveAndSummarize_(g.intakeParseText_('สาหร่าย 0.1 โล 85 บาท'), ctx, 'ข้อความ', 's1', []);
  g.cacheClear_();
  const bal = () => { g.cacheClear_(); return g.stockBalances_()[g.CENTRAL]; };
  eq('ไลน์ "สาหร่าย 0.1 โล" เข้าของดิบ ไม่ใช่ไม้', [bal()['สาหร่าย (ดิบ)'], bal()['สาหร่าย'] || 0], [0.1, 0]);
  const r = g.handleStockPack_({ token: 't', item: 'สาหร่าย', packs: 1, rem: 2, raws: [{ name: 'สาหร่าย (ดิบ)', qty: 0.03 }], reqId: 'p1' });
  eq('แพ็คสาหร่ายเสียบไม้ 12 ไม้ ตัดดิบ 0.03', [r.success, bal()['สาหร่าย'], bal()['สาหร่าย (ดิบ)']], [true, 12, 0.07]);
  eq('ส่งร้านได้', g.handleStockToShop_({ token: 't', item: 'สาหร่าย', location: SHOP, packs: 1, rem: 0 }).success, true);
  eq('หมูพันสาหร่ายยังใช้สาหร่าย (ดิบ) ตัวเดียวกัน', g.findStockItem_('หมูพันสาหร่าย').raws, ['@เนื้อหมู', 'สาหร่าย (ดิบ)']);
}

process.exit(done().fail ? 1 : 0);
