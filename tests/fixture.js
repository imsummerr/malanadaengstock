/**
 * ตั้งชีตให้เหมือนร้านจริงหลังรัน fixItemList + addSupplyItems
 * ทุกเทสต์เริ่มจากตรงนี้ จะได้ไม่ต้องสร้างชีตเองซ้ำทุกไฟล์
 */
const { makeEnv } = require('./harness');

const SHOP = 'ตลาดทรัพย์พัฒนา';

function fresh() {
  const g = makeEnv();
  const { SHEETS } = g.__env;
  const mk = (n, h) => { SHEETS[n] = { headers: h.slice(), rows: [] }; };

  mk(g.SHEET_ITEMS, g.ITEM_COLS);
  mk(g.SHEET_INCOMING, g.MOVE_COLS.concat(['messageId']));
  mk(g.SHEET_COUNT, g.MOVE_COLS);
  mk(g.SHEET_WASTE, g.MOVE_COLS);
  mk(g.SHEET_PACK, g.PACK_COLS);
  mk(g.INTAKE_SHEET, g.INTAKE_HEADERS);
  mk(g.INTAKE_EXPENSE_SHEET, g.INTAKE_EXPENSE_HEADERS);
  mk(g.SHEET_ORDERS, g.ORDER_HEADERS);
  mk(g.SHEET_DELIVERY, g.DELIVERY_HEADERS);
  mk(g.COST_SHEET_PAY, g.COST_PAY_COLS);

  g.applyItemCatalogue();
  g.addSupplyItems();
  g.cacheClear_();

  // ล็อกอินเป็นเจ้าของไว้ก่อน แต่ละเทสต์เปลี่ยนเองได้
  g.checkToken_ = () => ({ role: 'owner', branch: '', branches: [], name: 'เจ้าของ' });
  g.__env.PROPS.LINE_GROUPS = JSON.stringify({ 'ครัวกลาง': 'Ccentral', [SHOP]: 'Cshop' });
  g.__env.PROPS.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
  return g;
}

/** อ่านค่าในชีตรายการสินค้า */
function itemRow(g, name) {
  const s = g.__env.SHEETS[g.SHEET_ITEMS];
  const r = s.rows.find(x => x[0] === name);
  if (!r) return null;
  const o = {};
  s.headers.forEach((h, i) => { o[h] = r[i] === undefined ? '' : r[i]; });
  return o;
}
function itemNames(g) { return g.__env.SHEETS[g.SHEET_ITEMS].rows.map(r => r[0]); }

/** ใส่แถวลงชีตตามชื่อคอลัมน์ */
function push(g, sheet, obj) {
  const s = g.__env.SHEETS[sheet];
  const r = new Array(s.headers.length).fill('');
  Object.keys(obj).forEach(k => {
    const i = s.headers.indexOf(k);
    if (i === -1) throw new Error('ไม่มีคอลัมน์ ' + k + ' ในชีต ' + sheet);
    r[i] = obj[k];
  });
  s.rows.push(r);
  g.cacheClear_();
}

const D = (day, h, month) => new Date(2026, month === undefined ? 8 : month, day, h === undefined ? 9 : h, 0, 0);

module.exports = { fresh, itemRow, itemNames, push, D, SHOP };
