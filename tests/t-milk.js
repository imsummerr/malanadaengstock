process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, D } = require('./fixture');
const { eq, section, done } = makeCheck('นมข้นจืด → นมผง (9/10)');

const SHOP = 'ตลาดทรัพย์พัฒนา';

/** ชีตแบบก่อนอัปเดต — ถุงชื่อ "นมข้นจืด" · นมผงที่ซื้อมาชื่อ "นมผง" เป็นของใช้ */
function oldSheet(bagName) {
  const g = fresh();
  const S = g.__env.SHEETS[g.SHEET_ITEMS], H = S.headers;
  const c = h => H.indexOf(h);
  S.rows.find(r => r[0] === 'นมผง')[0] = bagName;
  const raw = S.rows.find(r => r[0] === 'นมผง (ดิบ)');
  raw[0] = 'นมผง'; raw[c('ชนิด')] = g.KIND_SUPPLY;
  g.cacheClear_();

  push(g, g.SHEET_INCOMING, { 'วันที่เวลา': D(5, 9, 9), 'สาขา': g.CENTRAL, 'รายการ': 'นมผง',
    'จำนวน': 1000, 'หน่วย': 'กรัม', 'ประเภท': 'ของเข้า', 'messageId': 'm1' });
  push(g, g.INTAKE_SHEET, { 'วันที่': '5/10/2026', 'รายการ': 'นมผง', 'ชื่อที่พิมพ์มา': 'นมผง',
    'จำนวนเงิน': 110, 'messageId': 'm1' });
  push(g, g.SHEET_PACK, { 'วันที่เวลา': D(5, 10, 9), 'สาขา': g.CENTRAL, 'วัตถุดิบ': 'นมผง',
    'จำนวนวัตถุดิบ': 400, 'หน่วยวัตถุดิบ': 'กรัม', 'รายการ': bagName, 'จำนวน': 2, 'หน่วย': 'ถุง' });
  push(g, g.SHEET_INCOMING, { 'วันที่เวลา': D(5, 11, 9), 'สาขา': SHOP, 'รายการ': bagName,
    'จำนวน': 2, 'หน่วย': 'ถุง', 'ประเภท': 'ของเข้าร้าน' });
  return g;
}
const col = (g, sheet, h) => { const s = g.__env.SHEETS[sheet]; const i = s.headers.indexOf(h); return s.rows.map(r => r[i]); };
const kindOf = (g, n) => { const s = g.__env.SHEETS[g.SHEET_ITEMS]; const r = s.rows.find(x => x[0] === n); return r ? r[s.headers.indexOf('ชนิด')] : null; };

['นมข้นจืด', 'นมผง (ถุง)'].forEach(bagName => {
  section('ชีตเดิมชื่อถุงว่า "' + bagName + '" → fixItemList');
  const g = oldSheet(bagName);
  g.fixItemList(); g.cacheClear_();
  const names = g.__env.SHEETS[g.SHEET_ITEMS].rows.map(r => r[0]);
  eq('เหลือชื่อเดียวในแพ็คของ: นมผง', names.filter(n => /^นม/.test(n)).sort(), ['นมผง', 'นมผง (ดิบ)']);
  eq('นมผง = ของแพ็ค · นมผง (ดิบ) = วัตถุดิบ', [kindOf(g, 'นมผง'), kindOf(g, 'นมผง (ดิบ)')], [g.KIND_PACKED, g.KIND_RAW]);
  eq('ซื้อเข้าเดิมย้ายไปของดิบ', col(g, g.SHEET_INCOMING, 'รายการ'), ['นมผง (ดิบ)', 'นมผง']);
  eq('ชีตซื้อของเข้าก็ย้าย (บัญชีจับราคาด้วยชื่อ)', col(g, g.INTAKE_SHEET, 'รายการ'), ['นมผง (ดิบ)']);
  eq('แพ็คของ: ตัดนมผง (ดิบ) ได้นมผง', [col(g, g.SHEET_PACK, 'วัตถุดิบ')[0], col(g, g.SHEET_PACK, 'รายการ')[0]],
     ['นมผง (ดิบ)', 'นมผง']);
  const b = g.stockBalances_();
  eq('ครัวกลางเหลือนมผง (ดิบ) 600 กรัม', b[g.CENTRAL]['นมผง (ดิบ)'], 600);
  eq('สาขามีนมผง 2 ถุง (ยกจากของเดิม)', b[SHOP]['นมผง'], 2);

  g.fixItemList(); g.cacheClear_();
  eq('รันซ้ำ — ถุงไม่โดนย้ายไปเป็นของดิบ', [kindOf(g, 'นมผง'), col(g, g.SHEET_PACK, 'รายการ')[0],
     g.stockBalances_()[SHOP]['นมผง']], [g.KIND_PACKED, 'นมผง', 2]);
  eq('รันซ้ำ — ของดิบยังเท่าเดิม', g.stockBalances_()[g.CENTRAL]['นมผง (ดิบ)'], 600);
});

section('ไลน์: ซื้อนมผงเข้าครัวกลาง = นมผง (ดิบ)');
{
  const g = fresh();
  const ctx = { location: 'ครัวกลาง', who: 'เจ้าของ', msgId: 'n1', isGroup: true };
  const out = g.intakeSaveAndSummarize_(g.intakeParseText_('นมผง 1 โล 110 บาท\nนม 2 โล 220'), ctx, 'ข้อความ', 'n1', []);
  const bal = g.stockBalances_()[g.CENTRAL] || {};
  eq('ลง 3000 กรัม เข้าของดิบ', bal['นมผง (ดิบ)'], 3000);
  eq('ไม่ลงเป็นถุงแพ็คแล้ว', bal['นมผง'] || 0, 0);
  eq('ตอบกลับชื่อของดิบ', /นมผง \(ดิบ\)/.test(out), true);
  const out2 = g.intakeSaveAndSummarize_(g.intakeParseText_('นมผง 1 ถุง 110'), Object.assign({}, ctx, { msgId: 'n2' }), 'ข้อความ', 'n2', []);
  eq('"1 ถุง" ไม่เดาว่าเป็น 1 โล', (g.stockBalances_()[g.CENTRAL] || {})['นมผง (ดิบ)'], 3000);
}

process.exit(done().fail ? 1 : 0);
