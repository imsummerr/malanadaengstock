process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, D, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('สาขาคืนเงินครัวกลาง → แจ้งไลน์');

/** ครัวกลางซื้อแล้วส่งเข้าร้าน = หนี้ค่าของ (ของที่ไม่ได้ขายเป็นไม้ ไม่มีค่าไม้เสียบ) */
function owe(g, item, qty, baht, msg) {
  push(g, g.INTAKE_SHEET, { 'รายการ': item, 'จำนวนเงิน': baht, 'messageId': msg });
  push(g, g.SHEET_INCOMING, { 'วันที่เวลา': D(5, 9, 9), 'สาขา': g.CENTRAL, 'รายการ': item,
    'จำนวน': qty, 'ประเภท': 'ของเข้าครัวกลาง', 'messageId': msg });
  push(g, g.SHEET_INCOMING, { 'วันที่เวลา': D(5, 11, 9), 'สาขา': SHOP, 'รายการ': item,
    'จำนวน': qty, 'ประเภท': 'ของเข้าร้าน' });
}

const g = fresh();
g.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
owe(g, 'หม่าล่า(ผสมแล้ว)', 20, 2000, 'o1');
const sentTo = () => g.__env.SENT.map(x => x.to);
const sentText = () => g.__env.SENT.map(x => x.messages.map(m => m.text).join('\n')).join('\n');

section('อ่านข้อความคืนเงิน');
let p = g.intakePaybackOf_('คืนเงิน ทรัพย์พัฒนา 500 โอน');
eq('สาขา', p.loc, SHOP);
eq('จำนวน', p.baht, 500);
eq('วิธีจ่าย', p.method, 'โอน');
p = g.intakePaybackOf_('คืนเงินครัวกลาง 1,200 บาท เงินสด');
eq('มีคำว่าครัวกลาง', p.baht, 1200);
eq('เงินสดได้', p.method, 'เงินสด');
eq('ไม่ใช่คืนเงิน', g.intakePaybackOf_('ค่าแก๊ส 450'), null);

section('พิมพ์ในกลุ่มครัวกลาง → บันทึก + ตอบในกลุ่ม');
const ctxC = { location: g.CENTRAL, who: 'เจ้าของ', isGroup: true, msgId: 'a' };
let txt = g.intakePayback_(g.intakePaybackOf_('คืนเงิน 500'), ctxC);
eq('สาขาเดียว ไม่ต้องบอกชื่อ', /ตลาดทรัพย์พัฒนา — 500 บาท/.test(txt), true);
eq('บอกยอดคืนแล้วรวม', /คืนค่าของแล้วรวม 500 บาท/.test(txt), true);
eq('ไม่เกินหนี้ = ไม่มีกำไร', /กำไร/.test(txt), false);
const sh = g.__env.SHEETS[g.COST_SHEET_PAY];
eq('ลงชีตจ่ายคืน', sh.rows.length, 1);
eq('จดว่าแจ้งแล้ว', !!sh.rows[0][sh.headers.indexOf(g.COST_PAY_NOTIFIED_COL)], true);
eq('ไม่ push ซ้ำ (ตอบในกลุ่มอยู่แล้ว)', g.__env.SENT.length, 0);
g.cacheClear_();
eq('ยอดจ่ายคืนเข้าบัญชี', g.costSummary_().owed[SHOP]['จ่ายคืนแล้ว'], 500);

section('พิมพ์ในกลุ่มสาขา → ส่งเข้ากลุ่มครัวกลางด้วย');
txt = g.intakePayback_(g.intakePaybackOf_('คืนเงิน 300 เงินสด'), { location: SHOP, who: 'ลลิตา', isGroup: true });
eq('ส่งกลุ่มครัวกลาง', sentTo().indexOf('Ccentral') !== -1, true);
eq('ข้อความครบ', /💸 สาขาโอนเงินเข้าครัวกลาง\nตลาดทรัพย์พัฒนา — 300 บาท \(เงินสด\)/.test(sentText()), true);

section('กรอกเองในชีต → trigger แจ้งกลุ่มครัวกลาง ครั้งเดียว');
g.__env.SENT.length = 0;
const row = h => { const r = new Array(sh.headers.length).fill(''); Object.keys(h).forEach(k => r[sh.headers.indexOf(k)] = h[k]); sh.rows.push(r); };
row({ 'วันที่': new Date(), 'สาขา': SHOP, 'จำนวนเงิน': 250, 'วิธีจ่าย': 'โอน', 'หมายเหตุ': 'ยอดวันที่ 8' });
row({ 'วันที่': new Date(), 'สาขา': SHOP });                           // ยังกรอกไม่ครบ
eq('แจ้ง 1 แถว', g.checkNewPaybacks(), 1);
eq('ไปกลุ่มครัวกลาง', sentTo()[0], 'Ccentral');
eq('มีหมายเหตุ', /ตลาดทรัพย์พัฒนา — 250 บาท \(โอน\)\nหมายเหตุ: ยอดวันที่ 8/.test(sentText()), true);
eq('รอบต่อไปไม่แจ้งซ้ำ', g.checkNewPaybacks(), 0);
eq('กรอกเองในชีต → เติมช่องส่งกำไรให้ (0 เพราะยังค้าง)', sh.rows[2][sh.headers.indexOf('ส่งกำไร')], 0);

section('สิ้นเดือน — ส่งเงินทั้งหมด เกินหนี้ค่าของ = กำไรเข้าครัวกลาง');
{
  const gm = fresh();
  gm.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
  owe(gm, 'หม่าล่า(ผสมแล้ว)', 10, 1000, 'm1');
  // ขายได้ 3000 จ่ายค่าที่ 200 → เงินในมือ 2800 · หนี้ค่าของ 1000
  push(gm, gm.SHEET_ORDERS, { 'วันที่': '2026-10-06', 'เวลา': '12:00:00', 'สาขา': SHOP, 'ยอดรวม': 3000,
    'ส่วนลด': 0, 'ยอดสุทธิ': 3000, 'วิธีชำระเงิน': 'เงินสด' });
  push(gm, gm.SHEET_EXPENSE, { 'วันที่': '2026-10-06', 'เวลา': '12:00:00', 'สาขา': SHOP, 'ประเภท': 'ค่าน้ำแข็ง',
    'จำนวนเงิน': 200, 'วิธีจ่าย': 'เงินสด' });
  let o = gm.costSummary_().owed[SHOP];
  eq('วันอาทิตย์คืนได้ไม่เกินหนี้', o['จ่ายได้เลย'], 1000);
  eq('สิ้นเดือนส่งทั้งหมด 2800 ในนั้นกำไร 1800', [o['สิ้นเดือนส่งทั้งหมด'], o['กำไรที่ส่งได้']], [2800, 1800]);
  gm.checkPaybackReminder(new Date('2026-10-31T22:10:00+07:00'));
  const rt = gm.__env.SENT.slice(-1)[0].messages[0].text;
  eq('แจ้งสิ้นเดือนบอกยอดส่งทั้งหมด + แบ่งกำไร', /สิ้นเดือน ส่งเข้าครัวกลางทั้งหมด 2,800 บาท\n   = คืนค่าของ 1,000 \+ กำไร 1,800/.test(rt), true);
  const t = gm.recordPayback_(SHOP, 2800, 'โอน', '', 'เจ้าของ');
  eq('ข้อความแบ่งคืนค่าของ/กำไร', /คืนค่าของ 1,000 บาท\n• กำไรเข้าครัวกลาง 1,800 บาท/.test(t), true);
  gm.cacheClear_();
  o = gm.costSummary_().owed[SHOP];
  eq('หลังส่ง: หนี้ 0 · เงินในมือ 0 · ส่งกำไรแล้ว 1800', [o['ค้างชำระ'], o['เงินในมือ'], o['ส่งกำไรแล้ว'], o['จ่ายคืนแล้ว']], [0, 0, 1800, 1000]);
  eq('ครัวกลางเห็นกำไรที่รับมา', gm.costSummary_().pl[gm.CENTRAL]['รับกำไรจากสาขา'], 1800);
  // เดือนหน้าส่งของใหม่ — กำไรที่ส่งไปแล้วไม่กลายเป็นเงินคืนค่าของ
  owe(gm, 'น้ำดำ', 2, 150, 'm2');
  gm.cacheClear_();
  eq('ของใหม่เป็นหนี้เต็ม ไม่ถูกหักด้วยกำไรที่ส่งไป', gm.costSummary_().owed[SHOP]['ค้างชำระ'], 150);
}

section('ค่าไม้เสียบ = ค่าใช้จ่ายหม่าล่าของสาขา ตอนซื้อ (ไม่คิดไม้ละ 0.09 · ไม่นับในครัวกลาง)');
{
  const gs = fresh();
  const at = (d, h) => new Date(2026, 9, d, h);
  gs.__env.SHEETS[gs.SHEET_EXPENSE] = { headers: gs.EXPENSE_HEADERS.slice(), rows: [] };
  push(gs, gs.INTAKE_SHEET, { 'รายการ': 'ดอลลี่ (ดิบ)', 'จำนวนเงิน': 500, 'messageId': 's1' });
  push(gs, gs.SHEET_INCOMING, { 'วันที่เวลา': at(9, 8), 'สาขา': gs.CENTRAL, 'รายการ': 'ดอลลี่ (ดิบ)', 'จำนวน': 5, 'ประเภท': 'ของเข้าครัวกลาง', 'messageId': 's1' });
  const o = { 'วันที่เวลา': at(9, 9), 'สาขา': gs.CENTRAL, 'รายการ': 'ดอลลี่', 'จำนวน': 100 };
  const c0 = gs.packRawCols_(0); o[c0.name] = 'ดอลลี่ (ดิบ)'; o[c0.qty] = 5;
  push(gs, gs.SHEET_PACK, o);
  push(gs, gs.SHEET_INCOMING, { 'วันที่เวลา': at(9, 10), 'สาขา': SHOP, 'รายการ': 'ดอลลี่', 'จำนวน': 100, 'ประเภท': 'ของเข้าร้าน' });
  let sm = gs.costSummary_();
  eq('ส่งดอลลี่ 100 ไม้ หนี้ 500 พอดี ไม่บวกค่าไม้', sm.owed[SHOP]['ส่งไปแล้ว'], 500);
  eq('ต้นทุนดอลลี่ที่สาขา 5/ไม้', sm.stock[SHOP].rows.find(r => r.item === 'ดอลลี่').unit, 5);
  eq('ไม้เสียบไม่อยู่ในรายการสินค้าแล้ว', gs.findStockItem_('ไม้เสียบเบอร์ 8'), null);
  // ประวัติเก่าที่ครัวกลางเคยนับไม้ ไม่เอามาคิด (ไม่ค้างเป็นมูลค่า ไม่เป็นค่าใช้จ่ายครัวกลาง)
  gs.__env.SHEETS[gs.SHEET_COUNT].headers.push(gs.COUNT_COST_COL);
  push(gs, gs.SHEET_COUNT, { 'วันที่เวลา': at(8, 7), 'สาขา': gs.CENTRAL, 'รายการ': 'ไม้เสียบเบอร์ 8', 'จำนวน': 3, 'ประเภท': 'เช็คสต็อก', 'ต้นทุน/หน่วย': 18 });
  push(gs, gs.SHEET_COUNT, { 'วันที่เวลา': at(9, 20), 'สาขา': gs.CENTRAL, 'รายการ': 'ไม้เสียบเบอร์ 8', 'จำนวน': 1, 'ประเภท': 'เช็คสต็อก' });
  sm = gs.costSummary_();
  eq('ไม้เสียบไม่ค้างในมูลค่าครัวกลาง', (sm.stock[gs.CENTRAL] || { rows: [] }).rows.some(r => r.item === 'ไม้เสียบเบอร์ 8'), false);
  eq('ไม่เป็นค่าใช้จ่ายครัวกลาง', (sm.pl[gs.CENTRAL]['ใช้ไปในครัว'] || []).some(x => x.item === 'ไม้เสียบเบอร์ 8'), false);
  // ลงไลน์ในกลุ่มครัวกลาง ไม่บอกสาขา — แบบไหนก็ลงสาขา หม่าล่า
  const { send } = require('./t-intake');
  send(gs, 'ไม้เสียบ 1 แพ็ค 18', 'k1');
  send(gs, 'เบเกอรี่ ทรัพย์พัฒนา\nค่าไม้เสียบ 18', 'k2');
  const ex = gs.__env.SHEETS[gs.SHEET_EXPENSE], k = h => ex.headers.indexOf(h);
  eq('ไม้เสียบ 1 แพ็ค 18 → ค่าไม้เสียบ ของสาขา หม่าล่า', ex.rows.map(r => [r[k('ประเภท')], r[k('สาขา')], r[k('จำนวนเงิน')], r[k('ธุรกิจ')]]),
     [['ค่าไม้เสียบ', SHOP, 18, 'หม่าล่า'], ['ค่าไม้เสียบ', SHOP, 18, 'หม่าล่า']]);
  gs.cacheClear_();
  sm = gs.costSummary_();
  eq('หม่าล่าหักค่าไม้ 36 · เบเกอรี่ไม่โดน', [sm.pl[SHOP]['ค่าใช้จ่ายอื่น'], (sm.biz['เบเกอรี่'].pl[SHOP] || {})['ค่าใช้จ่ายอื่น'] || 0], [36, 0]);
  eq('ไม่ลงเป็นของซื้อเข้าครัวกลาง', gs.__env.SHEETS[gs.INTAKE_SHEET].rows.length, 1);
}

section('คืนเงินบัญชีเบเกอรี่');
{
  const g5 = fresh();
  g5.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
  owe(g5, 'บราวนี่ นูเทลล่า', 100, 600, 'b1');
  owe(g5, 'หม่าล่า(ผสมแล้ว)', 5, 500, 'b2');
  const pb = g5.intakePaybackOf_('คืนเงิน เบเกอรี่ 300 โอน');
  eq('อ่านว่าเป็นเบเกอรี่', [pb.biz, pb.baht, pb.method], ['เบเกอรี่', 300, 'โอน']);
  eq('ไม่บอก = หม่าล่า', g5.intakePaybackOf_('คืนเงิน 200').biz, 'หม่าล่า');
  const t = g5.intakePayback_(pb, { location: g5.CENTRAL, who: 'เจ้าของ', isGroup: true });
  eq('หัวข้อความบอกเบเกอรี่', /💸 สาขาโอนเงินเข้าครัวกลาง · เบเกอรี่/.test(t), true);
  g5.intakePayback_(g5.intakePaybackOf_('คืนเงิน 200'), { location: g5.CENTRAL, who: 'เจ้าของ', isGroup: true });
  g5.cacheClear_();
  const sm = g5.costSummary_();
  eq('คืนเบเกอรี่ 300 อยู่บัญชีเบเกอรี่', sm.biz['เบเกอรี่'].owed[SHOP]['จ่ายคืนแล้ว'], 300);
  eq('คืนหม่าล่า 200 อยู่บัญชีหม่าล่า', sm.owed[SHOP]['จ่ายคืนแล้ว'], 200);
}

done();
