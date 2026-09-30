process.env.TZ = 'Asia/Bangkok';
const { makeCheck } = require('./harness');
const { fresh, itemRow, itemNames } = require('./fixture');
const { eq, done } = makeCheck('โหลดโปรเจกต์ได้');
const g = fresh();
eq('มีรายการสินค้า', itemNames(g).length > 50, true);
eq('ดอลลี่เป็นไม้', itemRow(g, 'ดอลลี่')['หน่วยย่อย'], 'ไม้');
process.exit(done().fail ? 1 : 0);
