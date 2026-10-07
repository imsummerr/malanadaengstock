process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('สาขาคืนเงินครัวกลาง → แจ้งไลน์');

const g = fresh();
g.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
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
eq('บอกยอดคืนแล้วรวม', /คืนเงินแล้วรวม 500 บาท/.test(txt), true);
const sh = g.__env.SHEETS[g.COST_SHEET_PAY];
eq('ลงชีตจ่ายคืน', sh.rows.length, 1);
eq('จดว่าแจ้งแล้ว', !!sh.rows[0][sh.headers.indexOf(g.COST_PAY_NOTIFIED_COL)], true);
eq('ไม่ push ซ้ำ (ตอบในกลุ่มอยู่แล้ว)', g.__env.SENT.length, 0);
g.cacheClear_();
eq('ยอดจ่ายคืนเข้าบัญชี', g.costSummary_().owed[SHOP]['จ่ายคืนแล้ว'], 500);

section('พิมพ์ในกลุ่มสาขา → ส่งเข้ากลุ่มครัวกลางด้วย');
txt = g.intakePayback_(g.intakePaybackOf_('คืนเงิน 300 เงินสด'), { location: SHOP, who: 'ลลิตา', isGroup: true });
eq('ส่งกลุ่มครัวกลาง', sentTo().indexOf('Ccentral') !== -1, true);
eq('ข้อความครบ', /💸 สาขาคืนเงินครัวกลาง\nตลาดทรัพย์พัฒนา — 300 บาท \(เงินสด\)/.test(sentText()), true);

section('กรอกเองในชีต → trigger แจ้งกลุ่มครัวกลาง ครั้งเดียว');
g.__env.SENT.length = 0;
const row = h => { const r = new Array(sh.headers.length).fill(''); Object.keys(h).forEach(k => r[sh.headers.indexOf(k)] = h[k]); sh.rows.push(r); };
row({ 'วันที่': new Date(), 'สาขา': SHOP, 'จำนวนเงิน': 250, 'วิธีจ่าย': 'โอน', 'หมายเหตุ': 'ยอดวันที่ 8' });
row({ 'วันที่': new Date(), 'สาขา': SHOP });                           // ยังกรอกไม่ครบ
eq('แจ้ง 1 แถว', g.checkNewPaybacks(), 1);
eq('ไปกลุ่มครัวกลาง', sentTo()[0], 'Ccentral');
eq('มีหมายเหตุ', /ตลาดทรัพย์พัฒนา — 250 บาท \(โอน\)\nหมายเหตุ: ยอดวันที่ 8/.test(sentText()), true);
eq('รอบต่อไปไม่แจ้งซ้ำ', g.checkNewPaybacks(), 0);

section('ชีตเก่าที่ยังไม่มีช่องแจ้ง — ไม่ย้อนส่งของเก่า');
{
  const g2 = fresh();
  g2.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
  g2.__env.SHEETS[g2.COST_SHEET_PAY] = { headers: g2.COST_PAY_COLS.slice(), rows: [[new Date(), SHOP, 100, 'โอน', '']] };
  eq('ครั้งแรกไม่ส่ง', g2.checkNewPaybacks(), 0);
  eq('ไม่มีข้อความ', g2.__env.SENT.length, 0);
}

section('คุยกันในกลุ่ม ไม่ใช่คืนเงินครัวกลาง');
{
  const g3 = fresh();
  g3.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
  g3.intakeOnText_({ message: { text: 'คืนเงินลูกค้า 20' } }, { location: g3.CENTRAL, who: 'x', isGroup: true, msgId: 'z' });
  eq('ไม่ลงชีตจ่ายคืน', (g3.__env.SHEETS[g3.COST_SHEET_PAY] || { rows: [] }).rows.length, 0);
}

section('ทุกวันอาทิตย์ + สิ้นเดือน หลัง 4 ทุ่ม → บอกยอดที่ควรคืน');
{
  const g4 = fresh();
  g4.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
  const T = s => new Date(s + '+07:00');
  g4.recordPayback_(SHOP, 100, 'โอน', '', 'เจ้าของ');
  eq('อาทิตย์ 11/10 3 ทุ่ม ยังไม่ส่ง', g4.checkPaybackReminder(T('2026-10-11T21:00:00')), false);
  eq('อาทิตย์ 11/10 4 ทุ่ม ส่ง', g4.checkPaybackReminder(T('2026-10-11T22:05:00')), true);
  const t = g4.__env.SENT.map(x => x.messages[0].text).join('\n');
  eq('ไปกลุ่มครัวกลาง', g4.__env.SENT[0].to, 'Ccentral');
  eq('หัวข้อความ', /📅 ถึงรอบตัดยอดคืนครัวกลาง \(วันอาทิตย์\) 11\/10\/2026/.test(t), true);
  eq('มีสาขา + ยอดคืนได้', /🏪 ตลาดทรัพย์พัฒนา[\s\S]*👉 คืนได้รอบนี้/.test(t), true);
  eq('ส่งวันละครั้ง', g4.checkPaybackReminder(T('2026-10-11T22:10:00')), false);
  eq('วันพุธธรรมดาไม่ส่ง', g4.checkPaybackReminder(T('2026-10-14T22:10:00')), false);
  eq('สิ้นเดือน 31/10 (วันเสาร์) ส่ง', g4.checkPaybackReminder(T('2026-10-31T22:10:00')), true);
  eq('บอกว่าเป็นรอบสิ้นเดือน', /\(สิ้นเดือน\) 31\/10\/2026/.test(g4.__env.SENT.slice(-1)[0].messages[0].text), true);
  eq('อาทิตย์ที่ตรงสิ้นเดือน (31/1/2027) ส่งครั้งเดียว บอกทั้งสอง', (g4.checkPaybackReminder(T('2027-01-31T22:10:00')),
    /\(วันอาทิตย์ \+ สิ้นเดือน\)/.test(g4.__env.SENT.slice(-1)[0].messages[0].text)), true);
}

done();
