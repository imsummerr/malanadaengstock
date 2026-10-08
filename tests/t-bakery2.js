process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('เบเกอรี่ — วันหมดอายุ · เตือนเติมของ');

const T = s => new Date(s + '+07:00');
const BR = 'บราวนี่ นูเทลล่า', DF = 'ไดฟุกุ ครีมนม';
function setup() {
  const g = fresh();
  g.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
  g.BAKERY_START_DATE = '2000-01-01';
  const S = g.__env.SHEETS[g.SHEET_INCOMING];
  if (S.headers.indexOf(g.BAKERY_START_COL) === -1) { S.headers.push(g.BAKERY_START_COL); S.rows.forEach(r => r.push('')); }
  return g;
}
const rcv = (g, when, item, qty, start) => push(g, g.SHEET_INCOMING, Object.assign({ 'วันที่เวลา': T(when), 'สาขา': g.CENTRAL,
  'รายการ': item, 'จำนวน': qty, 'ประเภท': 'ของเข้าครัวกลาง' }, start ? { [g.BAKERY_START_COL]: start } : {}));
const send = (g, when, item, qty) => push(g, g.SHEET_INCOMING, { 'วันที่เวลา': T(when), 'สาขา': SHOP, 'รายการ': item, 'จำนวน': qty, 'ประเภท': 'ของเข้าร้าน' });
const cnt = (g, when, loc, item, qty) => push(g, g.SHEET_COUNT, { 'วันที่เวลา': T(when), 'สาขา': loc, 'รายการ': item, 'จำนวน': qty, 'ประเภท': 'นับเบเกอรี่' });

section('บราวนี่: 14 วันจากเข้าครัวกลาง · สาขา 7 วัน แต่ไม่เกินอายุเดิม');
let g = setup();
rcv(g, '2026-10-01T10:00:00', BR, 20);
send(g, '2026-10-12T09:00:00', BR, 10);
let lots = g.bakeryLots_(BR, T('2026-10-12T10:00:00').getTime());
eq('ครัวกลางเหลือ 10 หมด 15/10', lots[g.CENTRAL].map(l => [l.qty, l.last]), [[10, '2026-10-15']]);
eq('ส่งร้าน 12/10 → ไม่เกิน 15/10 (ไม่ใช่ 19/10)', lots[SHOP].map(l => [l.qty, l.last]), [[10, '2026-10-15']]);
cnt(g, '2026-10-14T21:00:00', SHOP, BR, 5);
eq('14/10 ยังไม่แจ้ง', g.bakeryExpiryAt_(SHOP, T('2026-10-14T21:00:00').getTime()).length, 0);
cnt(g, '2026-10-15T21:00:00', SHOP, BR, 3);
let x = g.bakeryExpiryAt_(SHOP, T('2026-10-15T21:00:00').getTime());
eq('15/10 เหลือ 3 → ทิ้ง 16/10', x.map(i => [i.name, i.qty, i.toss]), [[BR, 3, '2026-10-16']]);
eq('ข้อความ', /• บราวนี่ นูเทลล่า 3 ชิ้น — ทิ้งวันที่ 16\/10\/2026 ก่อนขาย/.test(g.bakeryExpiryText_(SHOP, x, T('2026-10-15T21:00:00').getTime())), true);

section('บราวนี่ส่งร้านตอนยังใหม่ — สาขา 7 วัน');
g = setup();
rcv(g, '2026-10-10T10:00:00', BR, 10);
send(g, '2026-10-11T09:00:00', BR, 10);
eq('11/10 + 7 = 18/10', g.bakeryLots_(BR, T('2026-10-11T10:00:00').getTime())[SHOP][0].last, '2026-10-18');
cnt(g, '2026-10-18T21:00:00', SHOP, BR, 0);
eq('ขายหมด ไม่แจ้ง', g.bakeryExpiryAt_(SHOP, T('2026-10-18T21:00:00').getTime()).length, 0);

section('ไดฟุกุ: 30 วันจากวันเข้าที่กรอก');
g = setup();
rcv(g, '2026-10-05T10:00:00', DF, 30, '2026-09-20');
rcv(g, '2026-10-05T10:05:00', DF, 30, '2026-10-05');
lots = g.bakeryLots_(DF, T('2026-10-05T11:00:00').getTime())[g.CENTRAL];
eq('อายุจากวันเข้า ไม่ใช่วันลงระบบ', lots.map(l => l.last), ['2026-10-20', '2026-11-04']);
send(g, '2026-10-19T09:00:00', DF, 40);
lots = g.bakeryLots_(DF, T('2026-10-19T10:00:00').getTime())[SHOP];
eq('ส่งร้าน: ชุดเก่าหมด 20/10 · ชุดใหม่ 19+7 = 26/10', lots.map(l => [l.qty, l.last]), [[30, '2026-10-20'], [10, '2026-10-26']]);
cnt(g, '2026-10-20T21:00:00', SHOP, DF, 12);
x = g.bakeryExpiryAt_(SHOP, T('2026-10-20T21:00:00').getTime());
eq('20/10 เหลือ 12 (ชุดใหม่ 10 + ชุดเก่า 2) → ทิ้งชุดเก่า 2', x.map(i => [i.qty, i.toss]), [[2, '2026-10-21']]);

section('ครัวกลางเช็ควันละครั้ง');
g = setup();
rcv(g, '2026-10-01T10:00:00', BR, 10);
eq('16/10 เช้า 7 โมง ยังไม่เช็ค', g.checkBakeryExpiryDaily(T('2026-10-16T07:00:00')), false);
eq('16/10 9 โมง แจ้ง (หมด 15/10)', g.checkBakeryExpiryDaily(T('2026-10-16T09:00:00')), true);
const txt = g.__env.SENT.map(s => s.messages[0].text).join('\n');
eq('ไปกลุ่มครัวกลาง ทิ้งเลย', g.__env.SENT[0].to === 'Ccentral' && /ทิ้งเลย \(หมดอายุ 15\/10\/2026\)/.test(txt), true);
eq('วันเดียวกันไม่แจ้งซ้ำ', g.checkBakeryExpiryDaily(T('2026-10-16T15:00:00')), false);
eq('วันถัดไป ชุดเดิม ไม่แจ้งซ้ำ', g.checkBakeryExpiryDaily(T('2026-10-17T09:00:00')), false);
g = setup();
rcv(g, '2026-10-01T10:00:00', BR, 10);
send(g, '2026-10-05T09:00:00', BR, 10);
eq('ส่งร้านหมดแล้ว ครัวกลางไม่มีอะไรต้องทิ้ง → ไม่แจ้ง', g.checkBakeryExpiryDaily(T('2026-10-16T09:00:00')), false);
g = setup();
rcv(g, '2026-10-01T10:00:00', BR, 10);
eq('ยังไม่หมดอายุ → ไม่แจ้ง', g.checkBakeryExpiryDaily(T('2026-10-10T09:00:00')), false);
eq('ไม่ได้ส่งอะไร', g.__env.SENT.length, 0);

section('ตัวอย่างจากเจ้าของร้าน: บราวนี่เข้าครัวกลาง 1/10 (อยู่ได้ 14 วัน = ถึง 15/10)');
g = setup();
rcv(g, '2026-10-01T10:00:00', BR, 20);
send(g, '2026-10-04T09:00:00', BR, 10);                 // อยู่ครัวกลาง 3 วันแล้วส่ง
send(g, '2026-10-12T09:00:00', BR, 5);                  // อยู่ครัวกลาง 11 วันแล้วส่ง
lots = g.bakeryLots_(BR, T('2026-10-12T10:00:00').getTime());
eq('อยู่ครัวกลาง 3 วันแล้วส่ง → สาขาได้เต็ม 7 วัน (4/10–11/10)', lots[SHOP][0].last, '2026-10-11');
eq('อยู่ครัวกลาง 11 วันแล้วส่ง → เหลือ 4 วัน (12/10–15/10)', lots[SHOP][1].last, '2026-10-15');
eq('ที่ยังอยู่ครัวกลาง หมดตามเดิม 15/10', lots[g.CENTRAL][0].last, '2026-10-15');

section('รับไดฟุกุเข้าครัวกลางต้องกรอกวันเข้า');
g = setup();
g.checkToken_ = () => ({ role: 'owner', branch: '', branches: [], name: 'เจ้าของ' });
let r = g.handleStockIn_({ token: 't', item: DF, packs: 3, rem: 0, location: g.CENTRAL });
eq('ไม่กรอก = ไม่รับ', r.success, false);
r = g.handleStockIn_({ token: 't', item: DF, packs: 3, rem: 0, location: g.CENTRAL, start: '2026-10-07' });
eq('กรอกแล้วรับ', r.success, true);
const S = g.__env.SHEETS[g.SHEET_INCOMING];
eq('เก็บวันเข้า', S.rows.slice(-1)[0][S.headers.indexOf(g.BAKERY_START_COL)], '2026-10-07');
r = g.handleStockIn_({ token: 't', item: BR, packs: 2, rem: 0, location: g.CENTRAL });
eq('บราวนี่ไม่ต้องกรอก', r.success, true);

section('เหลือน้อย → แจ้งให้เติม');
g = setup();
eq('จุดเตือนสาขา ไดฟุกุ 20 บราวนี่ 10', [g.bakeryLowPieces_(DF, SHOP), g.bakeryLowPieces_(BR, SHOP)], [20, 10]);
eq('จุดเตือนครัวกลาง ไดฟุกุ 40 บราวนี่ 20', [g.bakeryLowPieces_(DF, g.CENTRAL), g.bakeryLowPieces_(BR, g.CENTRAL)], [40, 20]);
g.checkToken_ = () => ({ role: 'staff', branch: SHOP, branches: [SHOP], name: 'ลลิตา' });
const FL = g.BAKERY_ITEMS.map(b => b[0]);
g.handleBakeryCount_({ token: 't', round: 'ก่อนขาย', rows: FL.map(n => ({ item: n, qty: n === DF ? 15 : n === BR ? 12 : 30 })) });
let all = g.__env.SENT.map(s => s.messages.map(m => m.text).join('\n')).join('\n');
eq('สาขาไดฟุกุ 15 ≤ 20 → เตือน', /ใกล้หมด[\s\S]*ไดฟุกุ ครีมนม เหลือ 15 ลูก  \(จุดเตือน 20 ลูก\)/.test(all), true);
eq('บราวนี่ 12 > 10 ไม่เตือน', /บราวนี่ นูเทลล่า เหลือ/.test(all), false);
g.__env.SENT.length = 0;
rcv(g, '2026-10-01T10:00:00', DF, 120, '2026-10-01');
g.checkToken_ = () => ({ role: 'owner', branch: '', branches: [], name: 'เจ้าของ' });
const sr = g.handleStockToShop_({ token: 't', item: DF, packs: 0, rem: 2, location: SHOP });   // ส่ง 2 ชุด
eq('ส่ง 2 ชุด = 80 ลูก = 1 แพ็ค', sr.text, '1 แพ็ค');
all = g.__env.SENT.map(s => (s.to || '') + ' ' + s.messages.map(m => m.text).join('\n')).join('\n');
eq('ครัวกลางเหลือ 40 ≤ 40 → เตือนกลุ่มครัวกลาง', /Ccentral[\s\S]*ไดฟุกุ ครีมนม เหลือ 40 ลูก/.test(all), true);
eq('สาขาได้ 80 ลูก', g.stockBalances_()[SHOP][DF] - 15, 80);

done();
