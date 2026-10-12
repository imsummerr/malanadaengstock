process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, push, SHOP } = require('./fixture');
const { eq, section, done } = makeCheck('กดบันทึกซ้ำ (เน็ตหลุดตอนรอคำตอบ) ไม่ลงซ้ำ');

const g = fresh();
g.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
const S = g.__env.SHEETS;
const ship = (id, qty) => g.handleStockToShop_({ token: 't', item: 'หมูพันสาหร่าย', location: SHOP, packs: 0, rem: qty || 6, reqId: id });

section('ของเข้าร้าน — 12/10 หมูพันสาหร่าย 6 ไม้');
let r1 = ship('Wabc'), r2 = ship('Wabc');
const rows = () => S[g.SHEET_INCOMING].rows.filter(r => r[S[g.SHEET_INCOMING].headers.indexOf('รายการ')] === 'หมูพันสาหร่าย');
eq('ส่งซ้ำรหัสเดิม ลงแถวเดียว', rows().length, 1);
eq('รอบสองบอกว่าลงไปแล้ว', [r1.duplicated || false, r2.duplicated], [false, true]);
eq('เก็บรหัสในชีต', rows()[0][S[g.SHEET_INCOMING].headers.indexOf('รหัสบันทึก')], 'Wabc');
ship('Wxyz');
eq('รหัสใหม่ (ส่งอีกรอบตั้งใจ) ลงได้', rows().length, 2);
g.handleStockToShop_({ token: 't', item: 'หมูพันสาหร่าย', location: SHOP, packs: 0, rem: 6 });
eq('ไม่มีรหัส (เว็บรุ่นเก่า) ลงตามเดิม', rows().length, 3);

section('ของเข้าครัวกลาง / ของเสีย / แพ็คของ');
const inn = () => g.handleStockIn_({ token: 't', item: 'ดอลลี่ (ดิบ)', packs: 0, rem: 2, reqId: 'Win' });
inn(); inn();
eq('ของเข้าครัวกลางไม่ซ้ำ', S[g.SHEET_INCOMING].rows.filter(r => r[S[g.SHEET_INCOMING].headers.indexOf('รายการ')] === 'ดอลลี่ (ดิบ)').length, 1);
const waste = () => g.handleStockWaste_({ token: 't', item: 'ดอลลี่', location: SHOP, packs: 0, rem: 1, reason: 'ของเสีย', reqId: 'Wws' });
const sent0 = g.__env.SENT.length;
waste(); waste();
eq('ของเสียไม่ซ้ำ', S[g.SHEET_WASTE].rows.length, 1);
eq('ไม่แจ้งไลน์ซ้ำ', g.__env.SENT.length - sent0, 1);
const pack = () => g.handleStockPack_({ token: 't', item: 'ดอลลี่', packs: 0, rem: 20, raws: [{ name: 'ดอลลี่ (ดิบ)', qty: 1 }], reqId: 'Wpk' });
pack(); const p2 = pack();
eq('แพ็คของไม่ซ้ำ', [S[g.SHEET_PACK].rows.length, p2.duplicated], [1, true]);

process.exit(done().fail ? 1 : 0);
