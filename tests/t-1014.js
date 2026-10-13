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

process.exit(done().fail ? 1 : 0);
