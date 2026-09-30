process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, itemNames } = require('./fixture');
const { eq, section, done } = makeCheck('ความครบถ้วนของรายการสินค้า');

const g = fresh();
const names = itemNames(g);
const has = {}; names.forEach(n => { has[n] = true; });

section('ชื่อเล่น/ชื่อเก่า ต้องชี้ไปที่ของที่มีอยู่จริง');
eq('INTAKE_ALIAS ทุกตัวมีปลายทาง',
   Object.keys(g.INTAKE_ALIAS).filter(k => !has[g.INTAKE_ALIAS[k]])
     .map(k => k + ' → ' + g.INTAKE_ALIAS[k]), []);
eq('ITEM_RENAME ทุกตัวมีปลายทาง',
   Object.keys(g.ITEM_RENAME).filter(k => !has[g.ITEM_RENAME[k]])
     .map(k => k + ' → ' + g.ITEM_RENAME[k]), []);
eq('ชื่อเก่าต้องไม่ใช่ของที่ยังขายอยู่',
   Object.keys(g.ITEM_RENAME).filter(k => has[k]), []);

section('ของแพ็คทุกตัวมีของดิบรองรับ');
const missing = [];
g.getStockItems_().filter(i => i.kind === 'ของแพ็ค').forEach(i => {
  (i.raws || []).forEach(r => {
    if (r.charAt(0) === '@') { (g.rawGroupOf_(r) || []).forEach(x => { if (!has[x]) missing.push(i.name + ' → ' + x); }); }
    else if (!has[r]) missing.push(i.name + ' → ' + r);
  });
});
eq('ไม่มีของดิบหาย', missing, []);

section('ไม่มีชื่อซ้ำ');
const seen = {}, dups = [];
names.forEach(n => { if (seen[n]) dups.push(n); seen[n] = true; });
eq('ไม่มีแถวซ้ำ', dups, []);

process.exit(done().fail ? 1 : 0);
