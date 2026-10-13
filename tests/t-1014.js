process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, D, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('14/10 — โลละไม่บอกยอดรวม · ถุงที่ซื้อเป็นค่าใช้จ่าย');

const ctx = { location: 'ครัวกลาง', who: 'S.', msgId: 'm1', isGroup: true };
const col = (g, h) => { const s = g.__env.SHEETS[g.INTAKE_SHEET]; return s.rows.map(r => r[s.headers.indexOf(h)]); };

section('บอกแค่ "โลละ" — คูณเป็นยอดเงินให้');
{
  const g = fresh();
  const out = g.intakeSaveAndSummarize_(g.intakeParseText_('หม่าล่าครัวกลาง\nน้ำจิ้มสุกี้ 0.455 กิโลลิตร โลละ 47.8 บาท'), ctx, 'ข้อความ', 'x', []);
  eq('ลงชีต 21.75 บาท (0.455 × 47.8)', col(g, 'จำนวนเงิน'), [21.75]);
  eq('ตอบกลับบอกยอด + รวม', [/21\.75 บาท \/ 0\.455 กิโลลิตร/.test(out), /รวม ซื้อของ 21\.75 บาท/.test(out)], [true, true]);
  g.cacheClear_();
  const s = g.costSummary_();
  eq('ไม่เตือน "ไม่รู้ราคาที่ซื้อมา"', s.warn.filter(w => w.item === 'น้ำจิ้มสุกี้ (ดิบ)').length, 0);
  eq('ต้นทุนในครัวกลาง ≈ 21.75', Math.round(g.costReplay_().layers[g.CENTRAL]['น้ำจิ้มสุกี้ (ดิบ)'].reduce((a, l) => a + l.qty * l.cost, 0) * 100) / 100, 21.75);
  const p = g.intakeParseText_('หมูไม่ติดมัน 1.5 กิโล โลละ 120\nไก่ 2 ถุง โลละ 80\nสามชั้นสไลซ์ 1.128 โล 156 บาท โลละ119 บาท');
  eq('กิโล × โลละ · ถุงไม่รู้น้ำหนักไม่เดา · พิมพ์ยอดรวมมาใช้ยอดที่พิมพ์', p.map(x => x.baht), [180, 0, 156]);
}

section('ถุงที่สาขาซื้อเป็นค่าใช้จ่าย นับเกินระบบ — ไม่เตือนไม่รู้ราคาทุน');
{
  const g = fresh();
  const cnt = (item, qty, d) => push(g, g.SHEET_COUNT, { 'วันที่เวลา': D(d, 21, 9), 'สาขา': SHOP, 'รายการ': item, 'จำนวน': qty, 'ประเภท': 'เช็คสต็อก' });
  ['ถุงหูหิ้ว', 'ถุงร้อนใหญ่', 'ถุงร้อนเล็ก', 'ดอลลี่'].forEach(n => cnt(n, 2, 10));
  ['ถุงหูหิ้ว', 'ถุงร้อนใหญ่', 'ถุงร้อนเล็ก', 'ดอลลี่'].forEach(n => cnt(n, 5, 12));
  const w = [...new Set(g.costSummary_().warn.filter(x => /ไม่รู้ราคาทุน/.test(x.msg)).map(x => x.item))];
  eq('ถุงไม่เตือน · ของอื่นยังเตือน', w, ['ดอลลี่']);
}

section('แพ็คของ: ใส่ 0 = ใช้ของเหลือจากรอบก่อน (สาหร่ายแช่ไว้ตั้งแต่ 12/10)');
{
  const g = fresh();
  const { buy } = require('./t-cost');
  buy(g, 12, 'สะโพกหมูสไลซ์ (ดิบ)', 1, 120, 'b1', 9); buy(g, 12, 'สาหร่าย (ดิบ)', 1, 285, 'b2', 9);
  const pk = (raws, id) => g.handleStockPack_({ token: 't', item: 'หมูพันสาหร่าย', packs: 0, rem: 6, raws, reqId: id });
  const bal = n => Math.round((g.stockBalances_()[g.CENTRAL][n] || 0) * 1000) / 1000;
  let r = pk([{ name: 'สะโพกหมูสไลซ์ (ดิบ)', qty: 0.125 }, { name: 'สาหร่าย (ดิบ)', qty: 0.05 }], 'p1');
  eq('12/10 แช่สาหร่าย 0.05', [r.success, bal('สาหร่าย (ดิบ)')], [true, 0.95]);
  r = pk([{ name: 'สะโพกหมูสไลซ์ (ดิบ)', qty: 0.09 }, { name: 'สาหร่าย (ดิบ)', qty: '0' }], 'p2');
  const P = g.__env.SHEETS[g.SHEET_PACK], last = P.rows.slice(-1)[0];
  eq('13/10 สาหร่ายใส่ 0 ได้ · ไม่ตัดซ้ำ · หมูตัด', [r.success, bal('สาหร่าย (ดิบ)'), bal('สะโพกหมูสไลซ์ (ดิบ)')], [true, 0.95, 0.785]);
  eq('จดหมายเหตุว่าใช้ของเหลือ', last[P.headers.indexOf('หมายเหตุ')], 'ใช้ของเหลือจากรอบก่อน: สาหร่าย (ดิบ)');
  eq('แจ้งไลน์บอกด้วย', /ใช้ของเหลือจากรอบก่อน สาหร่าย \(ดิบ\) \(ไม่ตัดซ้ำ\)/.test(g.__env.SENT.map(x => x.messages[0].text).join('\n')), true);
  r = pk([{ name: 'สะโพกหมูสไลซ์ (ดิบ)', qty: 0.09 }, { name: 'สาหร่าย (ดิบ)', qty: '' }], 'p3');
  eq('ช่องว่าง = ลืมกรอก ยังไม่รับ', [r.success, /สาหร่าย/.test(r.message)], [false, true]);
  r = pk([{ name: 'สะโพกหมูสไลซ์ (ดิบ)', qty: 0 }, { name: 'สาหร่าย (ดิบ)', qty: 0 }], 'p4');
  eq('0 ทุกช่องไม่รับ', [r.success, /อย่างน้อย 1/.test(r.message)], [false, true]);
  r = g.handleStockPack_({ token: 't', item: 'ดอลลี่', packs: 0, rem: 10, raws: [{ name: 'ดอลลี่ (ดิบ)', qty: 0 }], reqId: 'p5' });
  eq('ของดิบอย่างเดียวใส่ 0 ไม่รับ', r.success, false);
}

process.exit(done().fail ? 1 : 0);
