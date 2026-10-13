process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('ปิดร้าน — สรุปสั้น ควรได้/ได้จริง/หาย · นับเบเกอรี่ไม่ใช่รอบเทียบหม่าล่า (13/10)');

const NOW = Date.now(), M = 60000;
const at = min => new Date(NOW - min * M);
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const hms = d => [d.getHours(), d.getMinutes(), d.getSeconds()].map(x => String(x).padStart(2, '0')).join(':');
const FL = ['ไดฟุกุ ครีมนม', 'ไดฟุกุ ช็อกโกแลต', 'ไดฟุกุ ชาเขียว', 'ไดฟุกุ โอริโอ้', 'บราวนี่ นูเทลล่า', 'บราวนี่ โอริโอ้'];

function webList(g, loc) {
  const want = loc === g.CENTRAL ? g.SCOPE_CENTRAL : g.SCOPE_SHOP;
  return g.getStockItems_().filter(i => (!i.scope || i.scope === want) && (loc === g.CENTRAL || !i.bakery));
}
/** นับทุกรายการที่สาขา — qty ตามที่ให้ ที่เหลือ 0 */
function rows(g, qty) {
  return webList(g, SHOP).map(i => i.level ? { item: i.name, level: 'มาก ไม่ต้องเติม' }
                                           : { item: i.name, packs: 0, rem: qty[i.name] || 0, pieces: '' });
}
const ord = (g, min, gross) => push(g, g.SHEET_ORDERS, { 'วันที่': ymd(at(min)), 'เวลา': hms(at(min)), 'สาขา': SHOP,
  'ยอดรวม': gross, 'ส่วนลด': 0, 'ยอดสุทธิ': gross, 'รวมไม้': gross / 10, 'วิธีชำระเงิน': 'เงินสด' });

function setup(sold) {
  const g = fresh();
  g.CASH_DAY_CUT_HOURS = (new Date(NOW).getHours() + 18) % 24;      // วันนี้เริ่ม 6 ชม.ก่อน
  g.BAKERY_START_DATE = '2000-01-01';
  // เมื่อวานปิดร้าน 23 ชม.ก่อน: ดอลลี่ 30 (ยกมา) — รอบฐาน
  g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g, { 'ดอลลี่': 30 }) });
  g.__env.SHEETS[g.SHEET_COUNT].rows.forEach(r => { r[0] = at(23 * 60); });
  g.cacheClear_();
  // วันนี้ขาย 3 บิล รวม sold บาท
  ord(g, 200, 100); ord(g, 150, 50); ord(g, 60, sold - 150);
  // นับเบเกอรี่หลังขาย 18 นาทีก่อนเช็คสต็อก
  FL.forEach(n => push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(18), 'สาขา': SHOP, 'รายการ': n, 'จำนวน': 5,
    'ประเภท': g.KIND_BAKERY_COUNT, 'หมายเหตุ': 'หลังขาย · ยอดระบบ 5' }));
  g.__env.SENT.length = 0;
  return g;
}
const texts = g => g.__env.SENT.map(x => x.messages.map(m => m.text).join('\n---\n')).join('\n===\n');

section('นับเบเกอรี่ 20:34 แล้วเช็คสต็อก 20:52 — ต้องเทียบจากรอบเมื่อวาน ไม่ใช่ 20:34');
let g = setup(200);
eq('รอบก่อนของหม่าล่า = เมื่อวาน (ไม่ใช่รอบนับเบเกอรี่)', Math.round((NOW - g.auditPrevCountTime_(SHOP, new Date())) / 3600000), 23);
// ดอลลี่ 30 → 10 = ขายไป 20 ไม้ = 200 · POS 200
let r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g, { 'ดอลลี่': 10 }) });
let t = texts(g);
eq('บันทึกได้', r.success, true);
eq('ไม่ขึ้นว่าไม่มีบิลขาย', /ไม่มีบิลขาย/.test(t), false);
eq('ข้อความนับไม่ลิสต์ "ไม่ตรงกับระบบ"', /ที่ไม่ตรงกับระบบ/.test(t), false);
eq('ข้อความนับสั้น', /📋 นับสต็อกปิดร้าน — ตลาดทรัพย์พัฒนา\nนับครบ \d+ รายการ โดย เจ้าของ/.test(t), true);
eq('สรุป: ควรได้ 200 · ได้จริง 200 · ตรงกัน', /✅ ปิดร้าน[\s\S]*ควรได้ \(ตามของที่ขายออกไป\) 200 บาท\nได้จริง \(POS 3 บิล\) 200 บาท\n→ ตรงกัน/.test(t), true);
eq('ยังไม่กรอกเงิน → บอกเงินสดที่ควรมีและให้กรอกใน POS', /เงินสดในลิ้นชักควรมี 200 บาท\nยังไม่ได้กรอกเงินปิดร้าน/.test(t), true);
eq('ไม่ส่งข้อความของหายแบบเก่าซ้ำ', /เช็คสต็อกแล้วของ/.test(t), false);

section('ของออกมากกว่าที่ขาย → บอกหายเท่าไหร่');
g = setup(150);
g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g, { 'ดอลลี่': 10 }) });
t = texts(g);
eq('ควรได้ 200 · ได้จริง 150 · หาย 50', /⚠️ ปิดร้าน[\s\S]*ควรได้ \(ตามของที่ขายออกไป\) 200 บาท\nได้จริง \(POS 3 บิล\) 150 บาท\n🔻 หาย 50 บาท/.test(t), true);

section('ขายมากกว่าของที่ออก (ลืมลงของเข้าร้าน) → บอกตัวที่นับเกิน');
g = setup(300);
g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g, { 'ดอลลี่': 10, 'หมูไม่ติดมัน': 10 }) });
t = texts(g);
eq('POS มากกว่า + บอกหมูไม่ติดมันนับเกิน 10', /🔺 POS มากกว่าของที่ออก (\d+) บาท[\s\S]*นับได้เกินระบบ: หมูไม่ติดมัน 10 ไม้/.test(t), true);

section('พนักงานนับ — ไม่ได้ตัวเลขเงินกลับไป');
g = setup(150);
g.checkToken_ = () => ({ role: 'staff', branch: SHOP, branches: [SHOP], name: 'ลลิตา' });
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g, { 'ดอลลี่': 10 }) });
eq('ไม่มี shrink ในคำตอบ', [r.success, r.shrink], [true, null]);
eq('ไม่มีตัวเลขเงินในคำตอบ', /ควรได้|บาท/.test(JSON.stringify(r).replace(/"lineMsg":"[^"]*"/, '')), false);

process.exit(done().fail ? 1 : 0);
