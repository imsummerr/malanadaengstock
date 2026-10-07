process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, D, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('เช็คสต็อก');

/** รายการที่หน้าเว็บส่งมาให้นับที่สถานที่นี้ — ตรงกับ itemsFor() ใน stock.html */
function webList(g, loc) {
  const want = loc === g.CENTRAL ? g.SCOPE_CENTRAL : g.SCOPE_SHOP;
  return g.getStockItems_().filter(i => !i.scope || i.scope === want);
}
function rowsFor(g, loc, levels) {
  return webList(g, loc).map(i => (i.level && loc !== g.CENTRAL)
    ? { item: i.name, level: (levels && levels[i.name]) || 'มาก ไม่ต้องเติม' }
    : { item: i.name, packs: '', rem: 0, pieces: '' });
}

section('สาขานับครบตามที่หน้าเว็บโชว์ ต้องบันทึกได้');
let g = fresh();
let r = g.handleStockCount_({ token: 't', location: SHOP, rows: rowsFor(g, SHOP) });
eq('บันทึกได้', r.success, true);
eq('ไม่ถามหาของดิบที่อยู่แค่ครัวกลาง', /ขาด/.test(r.message || ''), false);
eq('นับครบตามรายการของสาขา', r.counted, webList(g, SHOP).length);

section('ครัวกลางนับครบ ต้องบันทึกได้');
g = fresh();
r = g.handleStockCount_({ token: 't', location: g.CENTRAL, rows: rowsFor(g, g.CENTRAL) });
eq('บันทึกได้', r.success, true);

section('ยังนับไม่ครบ ต้องไม่ให้บันทึก');
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rowsFor(g, SHOP).slice(1) });
eq('ไม่ให้บันทึก', r.success, false);

section('กระดูกหมู น้ำดำ นับเป็นระดับ');
g = fresh();
eq('กระดูกหมูเป็นของนับระดับ', g.findStockItem_('กระดูกหมู').level, true);
eq('น้ำดำเป็นของนับระดับ', g.findStockItem_('น้ำดำ').level, true);
eq('ดอลลี่ไม่ใช่', g.findStockItem_('ดอลลี่').level, false);
// ซื้อน้ำดำ 9 ถุงเข้าครัวกลาง ส่งไปสาขาหมด แล้วนับเป็นระดับ — ยอดตัวเลขต้องไม่ถูกล้าง
push(g, g.INTAKE_SHEET, { 'รายการ': 'น้ำดำ', 'จำนวนเงิน': 677.7, 'messageId': 'nd' });
push(g, g.SHEET_INCOMING, { 'วันที่เวลา': D(19), 'สาขา': g.CENTRAL, 'รายการ': 'น้ำดำ',
  'จำนวน': 9, 'ประเภท': 'ของเข้าครัวกลาง', 'messageId': 'nd' });
push(g, g.SHEET_INCOMING, { 'วันที่เวลา': D(20), 'สาขา': SHOP, 'รายการ': 'น้ำดำ',
  'จำนวน': 9, 'ประเภท': 'ของเข้าร้าน' });
const noLevel = rowsFor(g, SHOP).map(x => x.item === 'น้ำดำ' ? { item: 'น้ำดำ', packs: '', rem: 3 } : x);
r = g.handleStockCount_({ token: 't', location: SHOP, rows: noLevel });
eq('ไม่เลือกระดับ = นับไม่ครบ', r.success, false);
r = g.handleStockCount_({ token: 't', location: SHOP,
  rows: rowsFor(g, SHOP, { 'น้ำดำ': 'เหลือน้อย ต้องเติม', 'กระดูกหมู': 'กลาง ต้องเติม' }) });
eq('เลือกระดับแล้วบันทึกได้', r.success, true);
eq('บอกว่าต้องเติม 2 อย่าง', r.refill, 2);
const sentText = g.__env.SENT.map(x => (x.messages || []).map(m => m.text).join('\n')).join('\n');
eq('LINE บอกรายการที่ต้องเติม', /🔔 ต้องเติม[\s\S]*น้ำดำ — เหลือน้อย ต้องเติม/.test(sentText), true);
g.cacheClear_();
eq('ยอดตัวเลขน้ำดำไม่ถูกล้างเป็น 0', g.stockBalances_()[SHOP]['น้ำดำ'], 9);
const lv = g.latestLevels_()[SHOP];
eq('จำระดับล่าสุดไว้', lv['น้ำดำ'].level, 'เหลือน้อย ต้องเติม');
g.checkToken_ = () => ({ role: 'owner', branch: '', branches: [], name: 'เจ้าของ' });
const boot = g.handleStockBootstrap_({ token: 't' }).data;
const shopRows = boot.stock.find(x => x.name === SHOP).rows;
const nd = shopRows.find(x => x.item === 'น้ำดำ');
eq('หน้าสต็อกโชว์ระดับแทนตัวเลข', nd && nd.text, 'เหลือน้อย ต้องเติม');
eq('เหลือน้อยขึ้นเป็นเตือน', nd && nd.low, true);
eq('ส่งตัวเลือกระดับไปให้หน้าเว็บ', boot.levels, ['เหลือน้อย ต้องเติม', 'กลาง ต้องเติม', 'มาก ไม่ต้องเติม']);
const cs = g.costSummary_();
eq('ระดับไม่ไปรีเซ็ตต้นทุน ไม่มีคำเตือน', cs.warn.filter(w => w.item === 'น้ำดำ').length, 0);
// ของที่นับเป็นระดับ นับเป็นตัวเลขไม่ได้ ต้นทุนเลยลงเป็นใช้ไปตั้งแต่ถึงสาขา
eq('น้ำดำถึงสาขา = ใช้ไปทันที 677.7', cs.used[SHOP]['ใช้ไป'], 677.7);
eq('ไม่ค้างเป็นสต็อกที่สาขา', (cs.stock[SHOP] || { total: 0 }).total, 0);
eq('แต่ยังเป็นหนี้ตามปกติ', cs.owed[SHOP]['ค้างชำระ'], 677.7);

section('นับรอบแรกหลังเริ่มนับใหม่ = ยอดตั้งต้น ไม่เทียบกับรอบเก่า');
g = fresh();
const today = g.formatDate ? null : null;
const ymd = (d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
                  String(d.getDate()).padStart(2, '0'))(new Date());
// รอบนับเก่าก่อนเส้น — ห้ามเอามาเป็น "รอบก่อน"
push(g, g.SHEET_COUNT, { 'วันที่เวลา': new Date(Date.now() - 8 * 86400000), 'สาขา': SHOP,
  'รายการ': 'ดอลลี่', 'จำนวน': 0, 'ประเภท': 'เช็คสต็อก' });
g.setStartDate(ymd);
g.__env.SENT.length = 0;
const baseRows = rowsFor(g, SHOP).map(x => x.item === 'ดอลลี่' ? { item: 'ดอลลี่', packs: '', rem: 7, pieces: '' } : x);
r = g.handleStockCount_({ token: 't', location: SHOP, rows: baseRows });
let txt = g.__env.SENT.map(x => (x.messages || []).map(m => m.text).join('\n')).join('\n---\n');
eq('บอกว่าเป็นยอดตั้งต้น', r.base, true);
eq('ข้อความขึ้นว่าตั้งยอดตั้งต้น', /📋 ตั้งยอดตั้งต้น/.test(txt), true);
eq('ไม่ขึ้นว่าไม่ตรงกับระบบ', /ไม่ตรงกับระบบ/.test(txt), false);
eq('ไม่ส่งข้อความเทียบของหายที่อ้างรอบเก่า', /ช่วงที่เทียบ|นับได้เกิน/.test(txt), false);
eq('ส่งไลน์ข้อความเดียว', g.__env.SENT.length, 1);
eq('รายการที่มีของถูกลิสต์ไว้', /ดอลลี่  7 ไม้/.test(txt), true);
// นับรอบสองหลังจากนั้น — ต้องเป็นการนับปกติ ไม่ใช่ฐานซ้ำ
g.cacheClear_();
const rows2 = g.__env.SHEETS[g.SHEET_COUNT].rows;
const iT = g.__env.SHEETS[g.SHEET_COUNT].headers.indexOf('วันที่เวลา');
rows2.forEach(rw => { if (rw[iT] instanceof Date && rw[iT].getTime() > Date.now() - 600000) rw[iT] = new Date(Date.now() - 120000); });
g.cacheClear_();
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rowsFor(g, SHOP) });
eq('รอบสองไม่ใช่ฐาน', r.base, false);


section('ครัวกลางนับกระดูกหมู/น้ำดำเป็นถุง');
{
  const gc = fresh();
  eq('กระดูกหมูหน่วยถุง', gc.findStockItem_('กระดูกหมู').subUnit, 'ถุง');
  const rowsC = webList(gc, gc.CENTRAL).map(i => i.name === 'กระดูกหมู' ? { item: i.name, packs: '', rem: 3, pieces: '' }
    : i.name === 'น้ำดำ' ? { item: i.name, packs: '', rem: 5, pieces: '' }
    : { item: i.name, packs: '', rem: 0, pieces: '' });
  const rc = gc.handleStockCount_({ token: 't', location: gc.CENTRAL, rows: rowsC });
  eq('บันทึกได้โดยไม่ต้องเลือกระดับ', rc.success, true);
  gc.cacheClear_();
  eq('กระดูกหมู 3 ถุง', gc.stockBalances_()[gc.CENTRAL]['กระดูกหมู'], 3);
  eq('น้ำดำ 5 ถุง', gc.stockBalances_()[gc.CENTRAL]['น้ำดำ'], 5);
  const cr = gc.__env.SHEETS[gc.SHEET_COUNT];
  eq('ไม่มีแถวเช็คระดับที่ครัวกลาง', cr.rows.some(r => r[cr.headers.indexOf('ประเภท')] === gc.KIND_LEVEL_COUNT), false);
  // สาขายังต้องเลือกระดับ
  const rs = gc.handleStockCount_({ token: 't', location: SHOP, rows: webList(gc, SHOP).map(i => ({ item: i.name, packs: '', rem: 0, pieces: '' })) });
  eq('สาขายังบังคับเลือกระดับ', rs.success, false);
}

process.exit(done().fail ? 1 : 0);
