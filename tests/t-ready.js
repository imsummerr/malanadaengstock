process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, itemRow, itemNames, D, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('ฟองเต้าหู้ม้วนไม่มีของดิบ — ซื้อแล้วส่งสาขาได้เลย (13/10)');

const F = 'ฟองเต้าหู้ม้วน', RAW = F + ' (ดิบ)';
const col = (g, sheet, h) => { const s = g.__env.SHEETS[sheet]; const i = s.headers.indexOf(h); return s.rows.map(r => r[i]); };

section('แคตตาล็อก');
{
  const g = fresh();
  const it = g.findStockItem_(F);
  eq('ไม่มีแถวของดิบ', itemNames(g).indexOf(RAW), -1);
  eq('ของแพ็ค ไม่มีวัตถุดิบ เป็นของพร้อมส่ง', [it.kind, it.raws, it.ready], [g.KIND_PACKED, [], true]);
  eq('ยังเป็นกล่องละ 12 อัน', [it.packUnit, it.perPack, it.subUnit], ['กล่อง', 12, 'อัน']);
  eq('หมายเหตุบอกว่าไม่ต้องแพ็ค', /ไม่ต้องแพ็ค/.test(itemRow(g, F)['หมายเหตุ']), true);
  eq('ของอื่นยังมีของดิบตามเดิม', g.findStockItem_('ดอลลี่').raws, ['ดอลลี่ (ดิบ)']);
  eq('ฟองเต้าหู้สามเหลี่ยมยังเสียบไม้จากของดิบ', g.findStockItem_('ฟองเต้าหู้สามเหลี่ยม').raws, ['ฟองเต้าหู้สามเหลี่ยม (ดิบ)']);
}

section('ไลน์ซื้อเข้าครัวกลาง → ส่งสาขา');
{
  const g = fresh();
  const ctx = { location: 'ครัวกลาง', who: 'เจ้าของ', msgId: 'f1', isGroup: true };
  const out = g.intakeSaveAndSummarize_(g.intakeParseText_('ฟองเต้าหู้ 18 กล่อง 385.92'), ctx, 'ข้อความ', 'f1', []);
  eq('เข้าครัวกลาง 216 อัน เป็นตัวพร้อมส่ง', g.stockBalances_()[g.CENTRAL][F], 216);
  eq('ไม่เตือนให้ไปแพ็ค', /แพ็คของ/.test(out), false);
  eq('ชีตซื้อของเข้าลงชื่อพร้อมส่ง', col(g, g.INTAKE_SHEET, 'รายการ'), [F]);
  const r = g.handleStockToShop_({ token: 't', item: F, location: SHOP, packs: 2, rem: 0 });
  eq('ส่งสาขา 2 กล่องได้เลย', r.success, true);
  const b = g.stockBalances_();
  eq('ครัวกลางเหลือ 192 · สาขาได้ 24', [b[g.CENTRAL][F], b[SHOP][F]], [192, 24]);
  const rep = g.costReplay_();
  eq('ต้นทุนส่งสาขา = กล่องละ 21.44', Math.round(rep.sent[SHOP] * 100) / 100, 42.88);
}

section('หน้าเว็บลงของเข้าครัวกลาง');
{
  const g = fresh();
  const r = g.handleStockIn_({ token: 't', item: F, packs: 3, rem: 0 });
  eq('รับฟองเต้าหู้ม้วนได้', [r.success, g.stockBalances_()[g.CENTRAL][F]], [true, 36]);
  const r2 = g.handleStockIn_({ token: 't', item: 'ดอลลี่', packs: 1, rem: 0 });
  eq('ของแพ็คอื่นยังต้องลงในแพ็คของ', [r2.success, /แพ็คของ/.test(r2.message)], [false, true]);
}

section('ชีตเดิมที่มี "ฟองเต้าหู้ม้วน (ดิบ)" → fixItemList');
{
  const g = fresh();
  const S = g.__env.SHEETS[g.SHEET_ITEMS], H = S.headers;
  const row = new Array(H.length).fill('');
  row[H.indexOf('สินค้า')] = RAW; row[H.indexOf('หน่วยย่อย')] = 'อัน'; row[H.indexOf('หน่วยแพ็ค')] = 'กล่อง';
  row[H.indexOf('หน่วยย่อยต่อแพ็ค')] = 12; row[H.indexOf('ใช้ที่')] = 'ครัวกลาง'; row[H.indexOf('ชนิด')] = g.KIND_RAW;
  S.rows.push(row);
  S.rows.find(r => r[0] === F)[H.indexOf('วัตถุดิบ')] = RAW;
  g.cacheClear_();
  push(g, g.SHEET_INCOMING, { 'วันที่เวลา': D(26, 14), 'สาขา': g.CENTRAL, 'รายการ': RAW, 'จำนวน': 24,
    'หน่วย': 'อัน', 'ประเภท': 'ของเข้าครัวกลาง', 'messageId': 'm1' });
  push(g, g.INTAKE_SHEET, { 'รายการ': RAW, 'ชื่อที่พิมพ์มา': 'ฟองเต้าหู้', 'จำนวนเงิน': 42.88, 'messageId': 'm1' });
  push(g, g.SHEET_COUNT, { 'วันที่เวลา': D(9, 1, 9), 'สาขา': g.CENTRAL, 'รายการ': RAW, 'จำนวน': 216,
    'หน่วย': 'อัน', 'ประเภท': 'เช็คสต็อก' });
  push(g, g.SHEET_COUNT, { 'วันที่เวลา': D(9, 20, 9), 'สาขา': SHOP, 'รายการ': F, 'จำนวน': 6,
    'หน่วย': 'อัน', 'ประเภท': 'เช็คสต็อก' });
  // 13/10 แบบของจริง: ก่อนรัน fixItemList กดแพ็คของดิบ 12 → ฟองเต้าหู้ม้วน 12 แล้วส่งสาขา 12
  push(g, g.SHEET_PACK, { 'วันที่เวลา': D(13, 16, 9), 'สาขา': g.CENTRAL, 'วัตถุดิบ': RAW, 'จำนวนวัตถุดิบ': 12,
    'หน่วยวัตถุดิบ': 'อัน', 'รายการ': F, 'จำนวน': 12 });
  push(g, g.SHEET_INCOMING, { 'วันที่เวลา': D(13, 17, 9), 'สาขา': SHOP, 'รายการ': F, 'จำนวน': 12,
    'หน่วย': 'อัน', 'ประเภท': 'ของเข้าร้าน' });
  eq('ก่อนรัน: ครัวกลางมีแต่ของดิบ 204 (แพ็คไป 12 ส่งไป 12)', [g.stockBalances_()[g.CENTRAL][RAW], g.stockBalances_()[g.CENTRAL][F] || 0], [204, 0]);

  g.fixItemList(); g.cacheClear_();
  eq('แถวของดิบหายไป', itemNames(g).indexOf(RAW), -1);
  eq('ไม่มีวัตถุดิบ ใช้ได้ทุกที่', [itemRow(g, F)['วัตถุดิบ'], itemRow(g, F)['ใช้ที่']], ['', '']);
  eq('ประวัติเปลี่ยนชื่อ', [col(g, g.SHEET_INCOMING, 'รายการ')[0], col(g, g.SHEET_COUNT, 'รายการ')[0]], [F, F]);
  eq('ชีตซื้อของเข้าเปลี่ยนตาม (ราคาจับคู่ด้วยชื่อ)', col(g, g.INTAKE_SHEET, 'รายการ'), [F]);
  const b = g.stockBalances_();
  eq('แพ็คของ: ช่องวัตถุดิบเปลี่ยนชื่อด้วย', col(g, g.SHEET_PACK, 'วัตถุดิบ'), [F]);
  eq('ครัวกลาง 204 ไม่เบิ้ล (ไม่มีของดิบติดลบลอย) · สาขา 6 + 12', [b[g.CENTRAL][F], b[g.CENTRAL][RAW] || 0, b[SHOP][F]], [204, 0, 18]);
  g.fixItemList(); g.cacheClear_();
  eq('รันซ้ำไม่เปลี่ยนอะไร', [g.stockBalances_()[g.CENTRAL][F], itemNames(g).indexOf(RAW)], [204, -1]);
  const rep = g.costReplay_();
  eq('ต้นทุนครัวกลางไม่ติดลบ ไม่มีชั้นของดิบค้าง', [!(rep.layers[g.CENTRAL] || {})[RAW] || !(rep.layers[g.CENTRAL][RAW] || []).length,
     (rep.layers[g.CENTRAL][F] || []).reduce((a, x) => a + x.qty, 0)], [true, 204]);
}

process.exit(done().fail ? 1 : 0);
