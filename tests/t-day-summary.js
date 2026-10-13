process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('สรุปยอดรายวัน — รอเช็คสต็อก + นับเบเกอรี่ + ค่าใช้จ่ายในไลน์ครบก่อน (13/10)');

const NOW = Date.now(), M = 60000;
const at = min => new Date(NOW - min * M);
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const hms = d => [d.getHours(), d.getMinutes(), d.getSeconds()].map(x => String(x).padStart(2, '0')).join(':');
const FL = ['ไดฟุกุ ครีมนม', 'ไดฟุกุ ช็อกโกแลต', 'ไดฟุกุ ชาเขียว', 'ไดฟุกุ โอริโอ้', 'บราวนี่ นูเทลล่า', 'บราวนี่ โอริโอ้'];
const bkRows = qs => FL.map((n, i) => ({ item: n, qty: qs[i] }));

function webList(g, loc) {
  const want = loc === g.CENTRAL ? g.SCOPE_CENTRAL : g.SCOPE_SHOP;
  return g.getStockItems_().filter(i => (!i.scope || i.scope === want) && (loc === g.CENTRAL || !i.bakery));
}
/** นับทุกรายการที่สาขา — qty ตามที่ให้ ที่เหลือ 0 */
function rows(g, qty) {
  return webList(g, SHOP).map(i => i.level ? { item: i.name, level: 'มาก ไม่ต้องเติม' }
                                           : { item: i.name, packs: 0, rem: qty[i.name] || 0, pieces: '' });
}
const ord = (g, min, gross, how) => push(g, g.SHEET_ORDERS, { 'วันที่': ymd(at(min)), 'เวลา': hms(at(min)), 'สาขา': SHOP,
  'ยอดรวม': gross, 'ส่วนลด': 0, 'ยอดสุทธิ': gross, 'รวมไม้': gross / 10, 'วิธีชำระเงิน': how || 'เงินสด' });
const texts = g => g.__env.SENT.map(x => x.messages.map(m => m.text).join('\n---\n')).join('\n===\n');
const line = (g, text, id) => {
  const ctx = { location: 'ครัวกลาง', who: 'S.', msgId: id, isGroup: true, srcId: 'Gcentral' };
  return g.intakeSaveAndSummarize_(g.intakeParseText_(text), ctx, 'ข้อความ', text, []);
};
const owner = { role: 'owner', branch: '', branches: [], name: 'เจ้าของ' };
const staff = { role: 'staff', branch: SHOP, branches: [SHOP], name: 'ลลิตา' };

function setup(sold, opt) {
  opt = opt || {};
  const g = fresh();
  g.CASH_DAY_CUT_HOURS = (new Date(NOW).getHours() + 18) % 24;      // วันนี้เริ่ม 6 ชม.ก่อน
  g.BAKERY_START_DATE = '2000-01-01';
  g.__env.SHEETS[g.SHEET_EXPENSE] = { headers: g.EXPENSE_HEADERS.slice(), rows: [] };
  // เมื่อวานปิดร้าน 23 ชม.ก่อน: ดอลลี่ 30 — รอบฐาน
  g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g, { 'ดอลลี่': 30 }) });
  g.__env.SHEETS[g.SHEET_COUNT].rows.forEach(r => { r[0] = at(23 * 60); });
  g.cacheClear_();
  ord(g, 200, 100); ord(g, 150, 50, 'สแกน/โอนผ่านธนาคาร'); ord(g, 60, sold - 150);
  if (opt.bakery) {
    g.checkToken_ = () => staff;
    g.handleBakeryCount_({ token: 't', round: 'ก่อนขาย', rows: bkRows([10, 0, 0, 0, 0, 10]) });
    g.checkToken_ = () => owner;
  } else {
    // นับเบเกอรี่หลังขาย 18 นาทีก่อนเช็คสต็อก (แบบ 13/10: 20:34 แล้วเช็คสต็อก 20:52) — ไม่ได้ออกขาย (ไม่มีก่อนขาย)
    FL.forEach(n => push(g, g.SHEET_COUNT, { 'วันที่เวลา': at(18), 'สาขา': SHOP, 'รายการ': n, 'จำนวน': 0,
      'ประเภท': g.KIND_BAKERY_COUNT, 'หมายเหตุ': 'หลังขาย · ยอดระบบ 0' }));
  }
  g.__env.SENT.length = 0;
  return g;
}

section('นับเบเกอรี่ 20:34 แล้วเช็คสต็อก 20:52 — เทียบจากรอบเมื่อวาน ไม่ใช่ 20:34');
let g = setup(200);
const D = g.cashBizDay_(NOW), DM = Number(D.slice(8)) + '/' + Number(D.slice(5, 7));
const HEAD = DM + '/' + D.slice(0, 4);
eq('รอบก่อนของหม่าล่า = เมื่อวาน (ไม่ใช่รอบนับเบเกอรี่)', Math.round((NOW - g.auditPrevCountTime_(SHOP, new Date())) / 3600000), 23);

section('ขายแล้ว นับสต็อกปิดร้าน แต่ยังไม่แจ้งค่าใช้จ่าย → ยังไม่สรุป');
let r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g, { 'ดอลลี่': 10 }) });
let t = texts(g);
eq('บันทึกได้', r.success, true);
eq('ข้อความนับสั้น ไม่ลิสต์ "ไม่ตรงกับระบบ"', [/📋 นับสต็อกปิดร้าน — ตลาดทรัพย์พัฒนา\nนับครบ \d+ รายการ/.test(t), /ที่ไม่ตรงกับระบบ/.test(t)], [true, false]);
eq('บอกว่ารอค่าใช้จ่าย ไม่มีตัวเลข', [/⏳ ยังไม่สรุปยอดวันที่ [\d/]+ — รอ แจ้งค่าใช้จ่ายของวันที่/.test(t), /ควรได้|บาท/.test(t)], [true, false]);
eq('ไม่ขึ้นว่าไม่มีบิลขาย', /ไม่มีบิลขาย/.test(t), false);

section('เจ้าของแจ้งค่าใช้จ่าย + เงินสดคงเหลือในไลน์ (เขียนวันที่บรรทัดแรก) → สรุปเลย');
g.__env.SENT.length = 0;
let out = line(g, [HEAD, 'หม่าล่า ทรัพย์', 'ค่าน้ำแข็ง 10 เงินสด', 'ค่าถุง 45 โอน', 'เงินสดคงเหลือ 140'].join('\n'), 'L1');
t = texts(g);
const ex = g.__env.SHEETS[g.SHEET_EXPENSE], eh = ex.headers;
const bizOf = x => g.cashBizDay_(new Date(x[eh.indexOf('วันที่')] + 'T' + x[eh.indexOf('เวลา')] + '+07:00').getTime());
eq('ค่าใช้จ่ายลงวันนั้น (วันทำการ) · วิธีจ่ายตามที่พิมพ์', ex.rows.map(x => [bizOf(x), x[eh.indexOf('ประเภท')], x[eh.indexOf('จำนวนเงิน')], x[eh.indexOf('วิธีจ่าย')], x[eh.indexOf('สาขา')]]),
   [[D, 'ค่าน้ำแข็ง', 10, 'เงินสด', SHOP], [D, 'อื่น ๆ', 45, 'โอน', SHOP]]);
eq('เงินสดไม่โดนบอกให้ไปลง POS แล้ว', /ไปลงในหน้า POS/.test(out), false);
eq('ตอบกลับบอกเงินสดคงเหลือ + ส่งสรุปแล้ว', [/💵 เงินสดคงเหลือ ตลาดทรัพย์พัฒนา วันที่ [\d/]+ — 140 บาท/.test(out), /📊 ส่งสรุปยอดวันที่/.test(out)], [true, true]);
eq('สรุปในกลุ่มสาขา: ควรได้ 200 · ได้จริง 200 · ตรงกัน', /📊 สรุปยอด ตลาดทรัพย์พัฒนา วันที่[\s\S]*🌶️ หม่าล่า ✅ — เงินสดตรง[\s\S]*ควรได้ \(ตามของที่ขายออกไป\) 200 บาท\nได้จริง \(POS 3 บิล\) 200 บาท\n→ ตรงกัน/.test(t), true);
eq('เงินสดควรมี 150 − ค่าน้ำแข็งเงินสด 10 = 140 · นับได้ 140', /เงินสดควรมี 140 · นับได้ 140 บาท/.test(t), true);
eq('ค่าใช้จ่ายของวัน 55 (เงินสด 10)', /💸 ค่าใช้จ่ายวันที่ [\d/]+ 55 บาท \(เงินสด 10\)/.test(t), true);
const cs = g.__env.SHEETS[g.SHEET_CASH];
eq('เงินสดคงเหลือลงชีตปิดร้าน (จากไลน์)', [cs.rows.length, cs.rows[0][cs.headers.indexOf('เงินสดที่นับได้')], cs.rows[0][cs.headers.indexOf('หมายเหตุ')]], [1, 140, 'ไลน์']);

section('ลบ (ในไลน์) — ถอนค่าใช้จ่าย เงินสด และที่จดว่าแจ้งแล้ว');
out = g.intakeUndo_({ srcId: 'Gcentral' });
eq('ลบแล้ว', [/ลบออกให้แล้ว 2 รายการ/.test(out), ex.rows.length, cs.rows.length, g.expDoneHas_(SHOP, D)], [true, 0, 0, false]);

section('ของออกมากกว่าที่ขาย → บอกหายเท่าไหร่ · "ไม่มีค่าใช้จ่าย"');
g = setup(150);
g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g, { 'ดอลลี่': 10 }) });
g.__env.SENT.length = 0;
line(g, [HEAD, 'หม่าล่า ทรัพย์', 'ไม่มีค่าใช้จ่าย'].join('\n'), 'L2');
t = texts(g);
eq('"ไม่มีค่าใช้จ่าย" = แจ้งแล้ว', g.expDoneHas_(SHOP, D), true);
eq('ควรได้ 200 · ได้จริง 150 · หาย 50', /🌶️ หม่าล่า ⚠️[\s\S]*ควรได้ \(ตามของที่ขายออกไป\) 200 บาท\nได้จริง \(POS 3 บิล\) 150 บาท\n🔻 หาย 50 บาท/.test(t), true);
eq('ไม่แจ้งเงินสด → บอกให้พิมพ์ในไลน์', /ยังไม่ได้แจ้งเงินสดคงเหลือ — พิมพ์ในไลน์/.test(t), true);
eq('ค่าใช้จ่ายไม่มี', /💸 ค่าใช้จ่ายวันที่ [\d/]+ ไม่มี/.test(t), true);

section('ขายมากกว่าของที่ออก (ลืมลงของเข้าร้าน) · แจ้งค่าใช้จ่ายไว้ก่อน → นับเสร็จสรุปเลย');
g = setup(300);
g.expDoneMark_(SHOP, D, 'เจ้าของ', 0, 0, 'm0');
g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g, { 'ดอลลี่': 10, 'หมูไม่ติดมัน': 10 }) });
t = texts(g);
eq('สรุปตอนนับเสร็จ', /📊 สรุปยอด/.test(t), true);
eq('POS มากกว่า + บอกหมูไม่ติดมันนับเกิน 10', /🔺 POS มากกว่าของที่ออก (\d+) บาท[\s\S]*นับได้เกินระบบ: หมูไม่ติดมัน 10 ไม้/.test(t), true);

section('เบเกอรี่ด้วย — รอนับหลังขาย · เงินสดที่หยิบไปจ่ายบวกกลับ');
g = setup(200, { bakery: true });
g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g, { 'ดอลลี่': 10 }) });
g.__env.SENT.length = 0;
out = line(g, [HEAD, 'หม่าล่า ทรัพย์', 'ค่าน้ำแข็ง 10 เงินสด', 'เบเกอรี่ ทรัพย์', 'ค่าที่ 60 เงินสด'].join('\n'), 'L3');
eq('ยังไม่นับเบเกอรี่หลังขาย → ยังไม่สรุป', [/⏳ ยังไม่สรุปยอดวันที่ [\d/]+ ของ ตลาดทรัพย์พัฒนา — รอ นับเบเกอรี่หลังขาย/.test(out), texts(g)], [true, '']);
g.checkToken_ = () => staff;
// ขาย 5 + 5 = 10 ชิ้น = 100 · ได้ 40 (เงินสดหลังจ่ายค่าที่ 60)
r = g.handleBakeryCount_({ token: 't', round: 'หลังขาย', rows: bkRows([5, 0, 0, 0, 0, 5]), money: { cash: 40, transfer: 0, thai: 0 }, id: 'BK1' });
t = texts(g);
eq('นับหลังขายเสร็จ = ครบ → สรุปทั้งหม่าล่าและเบเกอรี่', [/🌶️ หม่าล่า/.test(t), /🍡 เบเกอรี่ ✅/.test(t)], [true, true]);
eq('เบเกอรี่: ได้ 40 + จ่ายค่าที่เงินสด 60 = 100 ตรง', /ขายไป 10 ชิ้น → ควรได้ 100 บาท\nได้จริง 40 บาท[^\n]*\n\+ จ่ายค่าใช้จ่ายเงินสดจากเงินขาย 60 บาท\n→ ตรงกัน/.test(t), true);
eq('พนักงานไม่เห็นตัวเลขในคำตอบ', r.expected, undefined);

section('ลืมเช็คสต็อกปิดร้าน → 23:59 เตือน (ไม่สรุป) · พรุ่งนี้ขึ้น "เช็คสต็อกของวันนี้ก่อนขายพรุ่งนี้"');
g = setup(200);
g.expDoneMark_(SHOP, D, 'เจ้าของ', 0, 0, 'm0');
const dayStart = g.cashDayStart_(D);
const endMs = dayStart + (24 - g.CASH_DAY_CUT_HOURS) * 3600000 - 4 * M;   // 23:56 ตามนาฬิกา
const sent = g.dayEndMaybe_(endMs);
t = texts(g);
eq('เตือนในกลุ่ม ไม่มีตัวเลข', [sent, /⏰ ตลาดทรัพย์พัฒนา วันที่ [\d/]+ — ยังไม่สรุปยอด\nยังไม่มี: เช็คสต็อกปิดร้านหม่าล่า/.test(t), /ควรได้|บาท/.test(t)], [[SHOP], true, false]);
eq('วันละครั้ง', g.dayEndMaybe_(endMs + 5 * M), []);
const tomorrow = g.lateStatus_(SHOP, dayStart + 30 * 3600000);   // วันถัดไป ยังไม่ขาย
eq('พรุ่งนี้ขึ้นเตือนเช็คสต็อกของวันนี้', [tomorrow.mala && tomorrow.mala.count, tomorrow.mala && tomorrow.mala.dm], [true, DM]);

section('ครบแล้ว → 23:59 ไม่เตือน');
g = setup(200);
g.expDoneMark_(SHOP, D, 'เจ้าของ', 0, 0, 'm0');
g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g, { 'ดอลลี่': 10 }) });
g.__env.SENT.length = 0;
eq('ครบ = ไม่เตือน', g.dayEndMaybe_(endMs), []);

section('วันที่บนหัวเลยวันนี้ไป = ลงเป็นวันนี้แล้วเตือน');
g = setup(200);
const fut = new Date(NOW + 5 * 86400000);
out = line(g, [fut.getDate() + '/' + (fut.getMonth() + 1) + '/' + fut.getFullYear(), 'หม่าล่า ทรัพย์', 'ค่าน้ำแข็ง 10'].join('\n'), 'L9');
eq('เตือนวันที่ยังไม่ถึง', /ยังไม่ถึง — ลงเป็นวันนี้ไปก่อน/.test(out), true);

section('วิธีจ่าย: เงินสด / โอน / บัตร · บรรทัดวันที่');
const pays = g.intakeParseText_('ค่าน้ำแข็ง 10 เงินสด\nค่าถุง 20 โอน\nค่าแก๊ส 40 บัตร\nค่าไม้เสียบ 18').map(x => x.pay);
eq('อ่านวิธีจ่ายได้ครบ · ไม่บอก = โอน', pays, ['เงินสด', 'โอน', 'บัตรเครดิต', 'โอน']);
eq('บรรทัดวันที่ไม่กลายเป็นรายการ', g.intakeParseText_('10/10/2026\nค่าน้ำแข็ง 10').map(x => [x.raw, x.day]), [['ค่าน้ำแข็ง', '2026-10-10']]);
eq('"10/10 ค่าน้ำแข็ง 10" ไม่ใช่หัว', g.intakeDayHead_('10/10 ค่าน้ำแข็ง 10'), null);
eq('"วันที่ 9/10/69" (พ.ศ.) ได้', g.intakeDayHead_('วันที่ 9/10/69').day, '2026-10-09');
{
  const g4 = fresh();   // ตัดวันตี 4 ตามจริง
  eq('แจ้งย้อนหลัง = เที่ยงของวันนั้น', g4.intakeDayStamp_('2026-10-10', new Date('2026-10-13T21:00:00+07:00')), { date: '2026-10-10', time: '12:00:00' });
  eq('แจ้งหลังเที่ยงคืนของวันเดียวกัน = เวลาตอนนี้ (ยังเป็นวันทำการเดิม)',
     g4.intakeDayStamp_('2026-10-13', new Date('2026-10-13T10:30:00+07:00')), { date: '2026-10-13', time: '10:30:00' });
}

section('ค่าใช้จ่ายลงครบแล้วทางอื่น (ไม่ได้ลงในไลน์) — ปุ่มเจ้าของในหน้าสต็อก (14/10)');
g = setup(200);
g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g, { 'ดอลลี่': 10 }) });
push(g, g.SHEET_EXPENSE, { 'วันที่': ymd(at(30)), 'เวลา': hms(at(30)), 'สาขา': SHOP, 'ประเภท': 'ค่าที่', 'จำนวนเงิน': 60, 'วิธีจ่าย': 'เงินสด' });
g.cacheClear_();
const nextDay = g.cashDayStart_(D) + 30 * 3600000;   // วันถัดไป ยังไม่ขาย
eq('วันถัดไป กล่องเตือนเจ้าของขึ้น "แจ้งค่าใช้จ่ายของวันที่ D"', (g.lateStatus_(SHOP, nextDay).exp || {}).day, D);
g.__env.SENT.length = 0;
g.checkToken_ = () => staff;
r = g.handleExpDone_({ token: 't', location: SHOP, day: D });
eq('พนักงานกดไม่ได้', [r.success, r.code, g.expDoneHas_(SHOP, D), texts(g)], [false, 403, false, '']);
g.checkToken_ = () => owner;
eq('วันที่ผิด / ยังไม่ถึง / ครัวกลาง ไม่รับ', [
  g.handleExpDone_({ token: 't', location: SHOP, day: '13/10' }).success,
  g.handleExpDone_({ token: 't', location: SHOP, day: '2099-01-01' }).success,
  g.handleExpDone_({ token: 't', location: g.CENTRAL, day: D }).success], [false, false, false]);
r = g.handleExpDone_({ token: 't', location: SHOP, day: D });
t = texts(g);
eq('เจ้าของกด → จดว่าแจ้งแล้ว + ส่งสรุป', [r.success, r.sent, g.expDoneHas_(SHOP, D), /ส่งสรุปยอดวันที่/.test(r.message)], [true, true, true, true]);
eq('สรุปใช้ค่าใช้จ่ายที่ลงไว้แล้ว (ค่าที่ 60 เงินสด)', [/📊 สรุปยอด ตลาดทรัพย์พัฒนา/.test(t), /💸 ค่าใช้จ่ายวันที่ [\d/]+ 60 บาท \(เงินสด 60\)/.test(t)], [true, true]);
const ed = g.__env.SHEETS[g.SHEET_EXP_DONE];
eq('ชีตแจ้งค่าใช้จ่ายแล้ว: ผู้แจ้ง (หน้าเว็บ) · 1 รายการ 60', [ed.rows.length, ed.rows[0][ed.headers.indexOf('ผู้แจ้ง')], ed.rows[0][ed.headers.indexOf('รายการ')], ed.rows[0][ed.headers.indexOf('รวมเงิน')]],
   [1, 'เจ้าของ (หน้าเว็บ)', 1, 60]);
eq('กล่องเตือนหายไป', g.lateStatus_(SHOP, nextDay).exp || null, null);
g.__env.SENT.length = 0;
r = g.handleExpDone_({ token: 't', location: SHOP, day: D });
eq('กดซ้ำ ไม่จดซ้ำ ไม่ส่งซ้ำ', [r.success, ed.rows.length, texts(g)], [true, 1, '']);

section('ไลน์: "ค่าใช้จ่ายครบ" ใต้บรรทัดวันที่ = แจ้งแล้ว (ไม่มีอะไรเพิ่ม)');
g = setup(200);
g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g, { 'ดอลลี่': 10 }) });
g.__env.SENT.length = 0;
out = line(g, [HEAD, 'หม่าล่า ทรัพย์', 'ค่าใช้จ่ายครบ'].join('\n'), 'L5');
eq('จดว่าแจ้งแล้ว · ไม่ลงค่าใช้จ่าย · ส่งสรุป', [g.expDoneHas_(SHOP, D), g.__env.SHEETS[g.SHEET_EXPENSE].rows.length, /ไม่มีค่าใช้จ่ายเพิ่ม/.test(out), /📊 สรุปยอด/.test(texts(g))],
   [true, 0, true, true]);

section('พนักงานนับ — ไม่ได้ตัวเลขเงินกลับไป');
g = setup(150);
g.checkToken_ = () => staff;
r = g.handleStockCount_({ token: 't', location: SHOP, rows: rows(g, { 'ดอลลี่': 10 }) });
eq('ไม่มี shrink ในคำตอบ', [r.success, r.shrink], [true, null]);
eq('ไม่มีตัวเลขเงินในคำตอบ', /ควรได้|บาท/.test(JSON.stringify(r).replace(/"lineMsg":"[^"]*"/, '')), false);

process.exit(done().fail ? 1 : 0);
