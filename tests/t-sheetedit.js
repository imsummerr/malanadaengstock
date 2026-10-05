process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, D, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('แก้ในชีตเอง');

function edit(g, sheet, row, header) {
  const s = g.__env.SHEETS[sheet];
  const c = s.headers.indexOf(header) + 1;
  g.onEdit({ range: g.SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheet).getRange(row, c) });
  g.cacheClear_();
}
function cell(g, sheet, row, header) {
  const s = g.__env.SHEETS[sheet];
  return s.rows[row - 2][s.headers.indexOf(header)];
}
function setCell(g, sheet, row, header, v) {
  const s = g.__env.SHEETS[sheet];
  s.rows[row - 2][s.headers.indexOf(header)] = v;
}

section('ของเสียลงผิด 2 ถุง → แก้เป็น 1 ถุงในชีต');
let g = fresh();
push(g, g.SHEET_INCOMING, { 'วันที่เวลา': D(5, 9, 9), 'สาขา': SHOP, 'รายการ': 'วุ้นเส้นหม่าล่า',
  'จำนวน': 10, 'ประเภท': 'ของเข้าร้าน' });
g.checkToken_ = () => ({ role: 'staff', branch: SHOP, branches: [SHOP], name: 'ลลิตา' });
let r = g.handleStockWaste_({ token: 't', location: SHOP, item: 'วุ้นเส้นหม่าล่า', packs: 0, rem: 2, reason: 'หมดอายุ' });
eq('ลงของเสียได้', r.success, true);
g.cacheClear_();
eq('ยอดเหลือ 8 ถุง', g.stockBalances_()[SHOP]['วุ้นเส้นหม่าล่า'], 8);
setCell(g, g.SHEET_WASTE, 2, 'เศษ', 1);
edit(g, g.SHEET_WASTE, 2, 'เศษ');
eq('ช่องจำนวนถูกคิดใหม่เป็น 1', cell(g, g.SHEET_WASTE, 2, 'จำนวน'), 1);
eq('ยอดเหลือ 9 ถุง', g.stockBalances_()[SHOP]['วุ้นเส้นหม่าล่า'], 9);
eq('จดไว้ว่าแก้ในชีต', /แก้ในชีต .* \(เดิม 2\)/.test(cell(g, g.SHEET_WASTE, 2, 'หมายเหตุ')), true);

section('ลบทั้งแถว = เหมือนไม่เคยลง');
g.__env.SHEETS[g.SHEET_WASTE].rows.splice(0, 1); g.cacheClear_();
eq('ยอดกลับมา 10 ถุง', g.stockBalances_()[SHOP]['วุ้นเส้นหม่าล่า'], 10);

section('ของที่ไม้ละหลายชิ้น แก้เป็นแพ็คได้ คิดเป็นชิ้นให้เอง');
g = fresh();
g.checkToken_ = () => ({ role: 'owner', branch: '', branches: [], name: 'เจ้าของ' });
g.handleStockWaste_({ token: 't', location: SHOP, item: 'ไส้กรอกแดง', packs: 0, rem: 3, reason: 'หมดอายุ' });
eq('3 ไม้ = 12 ชิ้น', cell(g, g.SHEET_WASTE, 2, 'จำนวน'), 12);
setCell(g, g.SHEET_WASTE, 2, 'แพ็ค', 1); setCell(g, g.SHEET_WASTE, 2, 'เศษ', 0);
edit(g, g.SHEET_WASTE, 2, 'แพ็ค');
eq('1 แพ็ค = 40 ชิ้น', cell(g, g.SHEET_WASTE, 2, 'จำนวน'), 40);

section('แก้ชื่อรายการผิดตัว');
setCell(g, g.SHEET_WASTE, 2, 'รายการ', 'ดอลลี่');
edit(g, g.SHEET_WASTE, 2, 'รายการ');
eq('ดอลลี่ 1 แพ็ค = 10 ไม้', cell(g, g.SHEET_WASTE, 2, 'จำนวน'), 10);
eq('หน่วยเปลี่ยนตาม', cell(g, g.SHEET_WASTE, 2, 'หน่วย'), 'ไม้');

section('ชีตอื่นไม่แตะ');
const before = JSON.stringify(g.__env.SHEETS[g.SHEET_ITEMS].rows);
g.onEdit({ range: g.SpreadsheetApp.getActiveSpreadsheet().getSheetByName(g.SHEET_ITEMS).getRange(2, 2) });
eq('รายการสินค้าไม่เปลี่ยน', JSON.stringify(g.__env.SHEETS[g.SHEET_ITEMS].rows), before);

process.exit(done().fail ? 1 : 0);
