process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('13/10 หมูสามชั้นสไลซ์กลับมา · เห็ดนางรมหลวง = เห็ดออเร็นจิ');

const ctx = id => ({ location: 'ครัวกลาง', who: 'S.', msgId: id, isGroup: true });
const send = (g, text, id) => g.intakeSaveAndSummarize_(g.intakeParseText_(text), ctx(id), 'ข้อความ', id, []);

section('แคตตาล็อก');
{
  const g = fresh();
  const p = g.findStockItem_('หมูสามชั้นสไลซ์'), r = g.findStockItem_('หมูสามชั้นสไลซ์ (ดิบ)');
  eq('ของแพ็คเป็นไม้ แพ็คละ 10 ทำจากของดิบชื่อเดียวกัน', [p.kind, p.subUnit, p.perPack, p.raws], [g.KIND_PACKED, 'ไม้', 10, ['หมูสามชั้นสไลซ์ (ดิบ)']]);
  eq('ของดิบชั่งเป็นโล อยู่ครัวกลาง', [r.kind, r.subUnit, r.scope], [g.KIND_RAW, 'กก.', 'ครัวกลาง']);
  eq('อยู่ในแพ็คของได้ (ไม่ใช่ของพร้อมส่ง)', !!p.ready, false);
  eq('อายุที่สาขา 5 วันเหมือนหมูตัวอื่น', g.branchShelfDays_(p), 5);
}

section('มันเทศ: ดิบเป็นถุง แพ็คแล้วเป็นอัน');
{
  const g = fresh();
  eq('ดิบ = ถุง', [g.findStockItem_('มันเทศ (ดิบ)').subUnit, g.findStockItem_('มันเทศ (ดิบ)').packUnit], ['ถุง', 'ถุง']);
  eq('แพ็คแล้ว = อัน แพ็คละ 10', [g.findStockItem_('มันเทศ').subUnit, g.findStockItem_('มันเทศ').perPack], ['อัน', 10]);
  send(g, 'มันเทศ 2 ถุง 21.84', 'u1');
  eq('ไลน์ "2 ถุง" เข้าดิบ 2 ถุง', g.stockBalances_()[g.CENTRAL]['มันเทศ (ดิบ)'], 2);
}

section('ข้อความไลน์ 13/10 ส่งใหม่');
{
  const g = fresh();
  const out = send(g, ['มันเทศ 1 โล 137 บาท', 'สามชั้นสไลด์ 1.13 โล 134.25 บาท', 'เห็ดนางรมหลวง 1 โล 35 บาท',
                       'วุ้นเส้นเกาหลี 1 โล 64 บาท'].join('\n'), 'm1');
  const bal = g.stockBalances_()[g.CENTRAL];
  eq('สามชั้นสไลด์ → หมูสามชั้นสไลซ์ (ดิบ) 1.13 กก.', bal['หมูสามชั้นสไลซ์ (ดิบ)'], 1.13);
  eq('เห็ดนางรมหลวง → เห็ดออเร็นจิ (ดิบ) 1 กก.', bal['เห็ดออเร็นจิ (ดิบ)'], 1);
  eq('ไม่มีชื่อที่ไม่รู้จักแล้ว', /ไม่มีในรายการสินค้า/.test(out), false);
  eq('มันเทศเป็นโลยังเตือนเรื่องหน่วย (ชีตนับเป็นถุง)', /มันเทศ \(ดิบ\) — พิมพ์มาเป็น "กก\.\/กรัม"/.test(out), true);
  send(g, 'มันเทศ 5 ถุง', 'm2');
  eq('ส่งเพิ่มเป็นถุง (ไม่ใส่ราคา) เข้าสต็อก', g.stockBalances_()[g.CENTRAL]['มันเทศ (ดิบ)'], 5);
  eq('"เห็ดนางรมหลวงใหญ่" ก็เข้าตัวเดียวกัน', (send(g, 'เห็ดนางรมหลวงใหญ่ 0.5 โล 20', 'm3'), g.stockBalances_()[g.CENTRAL]['เห็ดออเร็นจิ (ดิบ)']), 1.5);
}

section('แพ็คสามชั้นแล้วส่งสาขา');
{
  const g = fresh();
  send(g, 'สามชั้นสไลด์ 1.13 โล 134.25 บาท', 'm1');
  const pk = g.handleStockPack_({ token: 't', item: 'หมูสามชั้นสไลซ์', packs: 2, rem: 3,
                                  raws: [{ name: 'หมูสามชั้นสไลซ์ (ดิบ)', qty: 1.13 }] });
  eq('แพ็คได้ 23 ไม้', pk.success, true);
  const sh = g.handleStockToShop_({ token: 't', item: 'หมูสามชั้นสไลซ์', location: SHOP, packs: 2, rem: 0 });
  const b = g.stockBalances_();
  eq('ส่งสาขา 20 ไม้ ครัวกลางเหลือ 3', [sh.success, b[SHOP]['หมูสามชั้นสไลซ์'], b[g.CENTRAL]['หมูสามชั้นสไลซ์'], b[g.CENTRAL]['หมูสามชั้นสไลซ์ (ดิบ)'] || 0], [true, 20, 3, 0]);
  const rep = g.costReplay_();
  eq('ต้นทุนส่งสาขา = 134.25 × 20/23', Math.round(rep.sent[SHOP] * 100) / 100, Math.round(134.25 * 20 / 23 * 100) / 100);
}

section('ส่งจำนวนเพิ่มไม่ใส่ราคา — ผูกกับค่าซื้อที่ลงไว้แล้ว');
{
  const g = fresh();
  send(g, 'มันเทศ 1 โล 137 บาท', 'm1');
  const out = send(g, 'มันเทศ 5 ถุง', 'm2');
  g.cacheClear_();
  const L = () => g.costReplay_().layers[g.CENTRAL]['มันเทศ (ดิบ)'];
  eq('ล็อตนี้ต้นทุน 137 (ไม่ใช่ 0)', L().map(x => Math.round(x.qty * x.cost * 100) / 100), [137]);
  eq('ตอบกลับบอกว่าใช้ราคาที่ซื้อไว้', /ต้นทุนจากที่ซื้อไว้ 137 บาท/.test(out), true);
  send(g, 'มันเทศ 2 ถุง', 'm3'); g.cacheClear_();
  // ผูกซ้ำ = 137 โดนหารเป็น 7 อัน (97.86 + 39.14) · ไม่ผูก = ล็อตใหม่ใช้ราคาล่าสุด 27.40/อัน ตามเดิม
  eq('ส่งอีกรอบ ไม่ผูกซ้ำ (ข้อความนั้นมีของเข้าแล้ว)', L().map(x => Math.round(x.qty * x.cost * 100) / 100), [137, 54.8]);
  const g2 = fresh();
  send(g2, 'วุ้นเส้นเกาหลี 1 โล 64', 'a1');
  send(g2, 'เต้าหู้หลอด 12 หลอด', 'a2'); g2.cacheClear_();
  eq('ไม่มีค่าซื้อค้าง = ไม่ผูกกับของอื่น', g2.costReplay_().layers[g2.CENTRAL]['เต้าหู้หลอด (ดิบ)'].map(x => x.cost), [0]);
}

process.exit(done().fail ? 1 : 0);
