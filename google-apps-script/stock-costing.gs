/************************************************************
 *  ต้นทุนแบบเข้าก่อนออกก่อน (FIFO) + บัญชีครัวกลาง / บัญชีสาขา
 *
 *  ไม่มีชีตเก็บ "ยอดต้นทุนคงเหลือ" แยกต่างหาก — คำนวณสดจากชีตที่มีอยู่แล้ว
 *  ทุกครั้งที่เรียก เพราะยอดที่เก็บไว้จะเพี้ยนทันทีที่มีใครแก้แถวย้อนหลัง
 *  แล้วไม่มีใครรู้ว่าเพี้ยนตั้งแต่เมื่อไหร่ (เหมือนยอดสต็อกที่คิดจากการนับล่าสุด)
 *
 *  ของเดินทางสามชั้น ต้นทุนก็เดินตาม
 *    1) ซื้อเข้าครัวกลาง   สร้างชั้นต้นทุนใหม่ ราคาต่อหน่วยจากบิลในไลน์
 *    2) แพ็คของ            กินชั้นของดิบ แล้วโยนต้นทุนไปเป็นของที่แพ็คแล้ว
 *    3) ส่งเข้าร้าน         กินชั้นครัวกลาง สร้างชั้นที่สาขา "ราคาเท่าเดิม"
 *                          ของออกจากครัวกลางแล้ว = สาขาเป็นหนี้เต็มจำนวนทันที
 *    4) เช็คสต็อก          นับได้เท่าไหร่คือเท่านั้น ส่วนที่หายไปคือของที่ใช้จริง
 *                          → เป็นค่าใช้จ่ายวัตถุดิบ และเป็นยอดที่ถึงกำหนดจ่าย
 *
 *  ยอดค้างชำระ = ของที่รับไปทั้งหมด − ที่จ่ายคืนแล้ว
 *  ขายได้เท่าไหร่ก็จ่ายคืนเท่านั้น ที่เหลือค้างไว้เท่ากับของที่ยังวางอยู่
 *  ของเสียที่สาขาก็ยังต้องจ่าย เพราะของออกจากครัวกลางไปแล้ว ทิ้งแล้วหนี้ไม่หาย
 *
 *  ครัวกลางไม่มีกำไรไม่มีขาดทุน — ส่งต่อที่ต้นทุนจริง กำไรไปโผล่ที่สาขาทั้งหมด
 *  ตัวเลขที่ครัวกลางจึงเป็น "เงินที่จมอยู่ในของ" ล้วน ๆ
 ************************************************************/

var COST_SHEET_PAY    = 'บัญชี_สาขาจ่ายคืน';      // กรอกเอง เวลาสาขาโอนเงินคืนครัวกลาง
var COST_SHEET_STOCK  = 'บัญชี_มูลค่าสต็อก';       // ผลลัพธ์ เขียนทับทุกครั้งที่สั่ง
var COST_SHEET_LEDGER = 'บัญชี_ครัวกลางกับสาขา';   // ผลลัพธ์ เขียนทับทุกครั้งที่สั่ง

var COST_PAY_COLS = ['วันที่', 'สาขา', 'จำนวนเงิน', 'วิธีจ่าย', 'หมายเหตุ'];

/** ปัดเป็นสตางค์ — เงินไม่มีทศนิยมที่สาม */
function costBaht_(n) { return Math.round((Number(n) || 0) * 100) / 100; }
/** ปัดจำนวนของ — กันเศษทศนิยมลอยจากการลบกันไปมา */
function costQty_(n)  { return Math.round((Number(n) || 0) * 10000) / 10000; }

function costCentral_() { return (typeof CENTRAL === 'string' && CENTRAL) ? CENTRAL : 'ครัวกลาง'; }
function costTz_()      { return (typeof TZ === 'string' && TZ) ? TZ : 'Asia/Bangkok'; }

function costTime_(v) {
  if (v instanceof Date) return v.getTime();
  var d = new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

/* ═══════════════════ ราคาที่ซื้อมาจริง ═══════════════════ */

/**
 * ราคาที่จ่ายจริงต่อการซื้อหนึ่งครั้ง — จากชีต "ซื้อของเข้า" ที่บอทไลน์เขียนไว้
 * คีย์คือ messageId + ชื่อของ เพราะข้อความเดียวซื้อหลายอย่างได้
 * ข้อความเดียวพูดถึงของตัวเดิมสองบรรทัด ก็รวมเงินเข้าด้วยกัน
 */
function costPaidByMsg_() {
  return cached_('cost:paid', function () {
    var out = {};
    var name = (typeof INTAKE_SHEET === 'string') ? INTAKE_SHEET : 'ซื้อของเข้า';
    var sh = sheet_(name);
    if (!sh || sh.getLastRow() < 2) return out;

    var v = sh.getDataRange().getValues();
    var head = v[0].map(function (h) { return String(h).trim(); });
    var iItem = head.indexOf('รายการ');
    var iBaht = head.indexOf('จำนวนเงิน');
    var iMsg  = head.indexOf('messageId');
    if (iItem === -1 || iBaht === -1) return out;

    for (var r = 1; r < v.length; r++) {
      var item = String(v[r][iItem] || '').trim();
      var baht = Number(v[r][iBaht]) || 0;
      if (!item || !baht) continue;
      var key = (iMsg === -1 ? '' : String(v[r][iMsg] || '').trim()) + '|' + item;
      out[key] = costBaht_((out[key] || 0) + baht);
    }
    return out;
  });
}

/* ═══════════════════ ไล่เหตุการณ์ตามเวลา ═══════════════════ */

/**
 * ทุกความเคลื่อนไหวของทุกที่ เรียงตามเวลา
 * เวลาเท่ากันให้เรียงตาม step — ซื้อเข้าก่อน แพ็คทีหลัง ส่งของถัดไป
 * แล้วปิดท้ายด้วยการนับ เพราะการนับคือ "สรุปว่าตกลงเหลือเท่าไหร่"
 * ถ้าเอาการนับไปไว้ก่อนของที่เข้าเวลาเดียวกัน ของที่เพิ่งเข้าจะถูกนับทับหาย
 */
function costEvents_() {
  var ev = [];
  var central = costCentral_();
  var paid = costPaidByMsg_();

  // 1) ของเข้า — ครัวกลางคือซื้อเข้ามาใหม่ · สาขาคือรับมาจากครัวกลาง
  var shIn = sheet_(SHEET_INCOMING);
  if (shIn && shIn.getLastRow() > 1) {
    var mapIn = ensureCols_(shIn, MOVE_COLS.concat(['messageId']));
    var vin = shIn.getRange(2, 1, shIn.getLastRow() - 1, shIn.getLastColumn()).getValues();
    vin.forEach(function (r) {
      var item = String(r[mapIn['รายการ']] || '').trim();
      if (!item) return;
      var qty = costQty_(r[mapIn['จำนวน']]);
      if (!(qty > 0)) return;
      var loc = String(r[mapIn['สาขา']] || '').trim();
      var msg = mapIn['messageId'] !== undefined ? String(r[mapIn['messageId']] || '').trim() : '';
      var kind = String(r[mapIn['ประเภท']] || '').trim();
      if (kind === 'ของเข้าร้าน' && loc !== central) {
        ev.push({ t: costTime_(r[mapIn['วันที่เวลา']]), step: 3, type: 'ส่งเข้าร้าน',
                  loc: loc, item: item, qty: qty });
      } else {
        ev.push({ t: costTime_(r[mapIn['วันที่เวลา']]), step: 1, type: 'ซื้อเข้า',
                  loc: loc, item: item, qty: qty, paid: paid[msg + '|' + item] || 0 });
      }
    });
  }

  // 2) แพ็คของ — กินของดิบ ได้ของที่แพ็คแล้ว
  var shPk = sheet_(SHEET_PACK);
  if (shPk && shPk.getLastRow() > 1) {
    var mapPk = ensureCols_(shPk, PACK_COLS);
    var vpk = shPk.getRange(2, 1, shPk.getLastRow() - 1, shPk.getLastColumn()).getValues();
    vpk.forEach(function (r) {
      var item = String(r[mapPk['รายการ']] || '').trim();
      var raws = [];
      for (var k = 0; k < PACK_RAW_SLOTS; k++) {
        var c = packRawCols_(k);
        if (mapPk[c.name] === undefined) continue;
        var rn = String(r[mapPk[c.name]] || '').trim();
        var rq = costQty_(r[mapPk[c.qty]]);
        if (rn && rq > 0) raws.push({ name: rn, qty: rq });
      }
      if (!item && !raws.length) return;
      ev.push({ t: costTime_(r[mapPk['วันที่เวลา']]), step: 2, type: 'แพ็คของ',
                loc: String(r[mapPk['สาขา']] || '').trim() || central,
                item: item, qty: costQty_(r[mapPk['จำนวน']]), raws: raws });
    });
  }

  // 3) ของเสีย
  var shW = sheet_(SHEET_WASTE);
  if (shW && shW.getLastRow() > 1) {
    var mapW = ensureCols_(shW, MOVE_COLS);
    var vw = shW.getRange(2, 1, shW.getLastRow() - 1, shW.getLastColumn()).getValues();
    vw.forEach(function (r) {
      var item = String(r[mapW['รายการ']] || '').trim();
      var qty = costQty_(r[mapW['จำนวน']]);
      if (!item || !(qty > 0)) return;
      ev.push({ t: costTime_(r[mapW['วันที่เวลา']]), step: 4, type: 'ของเสีย',
                loc: String(r[mapW['สาขา']] || '').trim(), item: item, qty: qty,
                reason: String(r[mapW['ประเภท']] || '').trim() });
    });
  }

  // 4) เช็คสต็อก
  var shC = sheet_(SHEET_COUNT);
  if (shC && shC.getLastRow() > 1) {
    var mapC = ensureCols_(shC, MOVE_COLS);
    var vc = shC.getRange(2, 1, shC.getLastRow() - 1, shC.getLastColumn()).getValues();
    vc.forEach(function (r) {
      var item = String(r[mapC['รายการ']] || '').trim();
      if (!item) return;
      ev.push({ t: costTime_(r[mapC['วันที่เวลา']]), step: 5, type: 'เช็คสต็อก',
                loc: String(r[mapC['สาขา']] || '').trim(), item: item,
                qty: costQty_(r[mapC['จำนวน']]) });
    });
  }

  ev.sort(function (a, b) { return (a.t - b.t) || (a.step - b.step); });
  return ev;
}

/* ═══════════════════ เครื่องคิดต้นทุน ═══════════════════ */

/**
 * ไล่ทุกเหตุการณ์ตั้งแต่แถวแรก แล้วคืนสภาพ ณ ตอนนี้
 *   layers  ชั้นต้นทุนที่ยังเหลือ  loc → item → [{qty, cost}]
 *   used    ของที่ออกไปแล้ว       loc → { ใช้ไป, ของเสีย, นับเกิน }
 *   sent    มูลค่าของที่ส่งไปให้สาขาสะสม = ยอดหนี้ก่อนหักเงินที่จ่ายคืน
 *   moved   มูลค่าที่ส่งออกจากครัวกลาง แยกรายสินค้า
 *   warn    จุดที่ตัวเลขไม่สมบูรณ์ ต้องบอก ไม่ใช่กลืนเงียบ ๆ
 */
function costReplay_() {
  return cached_('cost:replay', costReplayRaw_);
}

function costReplayRaw_() {
  var central = costCentral_();
  var lay = {}, used = {}, sent = {}, moved = {}, warn = [];
  var lastCost = {};     // loc|item → ต้นทุนต่อหน่วยที่รู้ล่าสุด ไว้เดาตอนไม่มีบิล

  function box(loc, item) {
    if (!lay[loc]) lay[loc] = {};
    if (!lay[loc][item]) lay[loc][item] = [];
    return lay[loc][item];
  }
  function bucket(loc) {
    if (!used[loc]) used[loc] = { ใช้ไป: 0, ของเสีย: 0, นับเกิน: 0, items: {} };
    return used[loc];
  }
  function noteItem(loc, item, what, qty, value) {
    var b = bucket(loc);
    if (!b.items[item]) b.items[item] = { ใช้ไป: 0, ของเสีย: 0, นับเกิน: 0, qty: 0 };
    b[what] = costBaht_(b[what] + value);
    b.items[item][what] = costBaht_(b.items[item][what] + value);
    if (what !== 'นับเกิน') b.items[item].qty = costQty_(b.items[item].qty + qty);
  }
  function total(loc, item) {
    return costQty_(box(loc, item).reduce(function (s, l) { return s + l.qty; }, 0));
  }
  function put(loc, item, qty, cost) {
    if (!(qty > 0)) return;
    box(loc, item).push({ qty: qty, cost: cost });
    if (cost > 0) lastCost[loc + '|' + item] = cost;
  }
  /** ดึงของออกแบบเข้าก่อนออกก่อน — คืนมูลค่าที่ดึงได้ และส่วนที่ของไม่พอ */
  function take(loc, item, qty) {
    var a = box(loc, item), value = 0, got = 0;
    while (qty > 0.00001 && a.length) {
      var l = a[0];
      var n = Math.min(l.qty, qty);
      value += n * l.cost;
      got += n; l.qty = costQty_(l.qty - n); qty = costQty_(qty - n);
      if (l.qty <= 0.00001) a.shift();
    }
    return { qty: costQty_(got), value: costBaht_(value), short: costQty_(qty) };
  }
  function guessCost(loc, item) {
    return lastCost[loc + '|' + item] || lastCost[central + '|' + item] || 0;
  }

  costEvents_().forEach(function (e) {
    if (e.type === 'ซื้อเข้า') {
      // ซื้อผ่านไลน์จะมีราคามาด้วย · กรอกในเว็บไม่มี ต้องเดาจากราคาล่าสุด
      var unit = e.paid > 0 ? e.paid / e.qty : guessCost(e.loc, e.item);
      if (!(unit > 0)) {
        warn.push({ when: e.t, loc: e.loc, item: e.item,
                    msg: 'ไม่รู้ราคาที่ซื้อมา — คิดต้นทุนเป็น 0' });
      }
      put(e.loc, e.item, e.qty, unit);

    } else if (e.type === 'แพ็คของ') {
      // ต้นทุนของที่แพ็คแล้ว = ต้นทุนของดิบที่กินไปทั้งหมด หารด้วยจำนวนที่ได้
      var sum = 0;
      e.raws.forEach(function (r) {
        var t = take(e.loc, r.name, r.qty);
        sum += t.value;
        if (t.short > 0) {
          warn.push({ when: e.t, loc: e.loc, item: r.name,
                      msg: 'แพ็คของโดยที่ของดิบในระบบไม่พอ ขาด ' + t.short });
        }
      });
      if (e.qty > 0) put(e.loc, e.item, e.qty, sum / e.qty);

    } else if (e.type === 'ส่งเข้าร้าน') {
      // กินชั้นครัวกลางตามลำดับที่ซื้อมา แล้วยกไปตั้งที่สาขาในราคาเดิมเป๊ะ
      var t2 = take(central, e.item, e.qty);
      var unitCost = t2.qty > 0 ? t2.value / t2.qty : guessCost(central, e.item);
      var value = costBaht_(t2.value + t2.short * unitCost);
      if (t2.short > 0) {
        warn.push({ when: e.t, loc: central, item: e.item,
                    msg: 'ส่งเข้าร้านมากกว่าที่ครัวกลางมี ขาด ' + t2.short +
                         ' — คิดต้นทุนจากราคาล่าสุดแทน' });
      }
      put(e.loc, e.item, e.qty, e.qty > 0 ? value / e.qty : 0);
      // ของออกจากครัวกลางแล้วเป็นหนี้ทันทีเต็มจำนวน — จะขายได้หรือทิ้งก็หนี้เท่าเดิม
      sent[e.loc] = costBaht_((sent[e.loc] || 0) + value);
      moved[e.item] = costBaht_((moved[e.item] || 0) + value);

    } else if (e.type === 'ของเสีย') {
      var t3 = take(e.loc, e.item, e.qty);
      noteItem(e.loc, e.item, 'ของเสีย', t3.qty, t3.value);

    } else if (e.type === 'เช็คสต็อก') {
      // นับได้เท่าไหร่คือเท่านั้น ส่วนที่หายไประหว่างสองรอบนับคือของที่ใช้ไป
      var have = total(e.loc, e.item);
      var diff = costQty_(have - e.qty);
      if (diff > 0.00001) {
        var t4 = take(e.loc, e.item, diff);
        noteItem(e.loc, e.item, 'ใช้ไป', t4.qty, t4.value);
      } else if (diff < -0.00001) {
        var add = -diff;
        var c = guessCost(e.loc, e.item);
        put(e.loc, e.item, add, c);
        noteItem(e.loc, e.item, 'นับเกิน', add, costBaht_(add * c));
      }
    }
  });

  return { layers: lay, used: used, sent: sent, moved: moved, warn: warn };
}

/* ═══════════════════ เงินที่สาขาจ่ายคืนแล้ว ═══════════════════ */

/** ยอดที่สาขาโอนคืนครัวกลางแล้ว — กรอกเองในชีต COST_SHEET_PAY */
function costPaidBack_() {
  var out = {};
  var sh = sheet_(COST_SHEET_PAY);
  if (!sh || sh.getLastRow() < 2) return out;
  var map = ensureCols_(sh, COST_PAY_COLS);
  sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues().forEach(function (r) {
    var loc = String(r[map['สาขา']] || '').trim();
    var baht = Number(r[map['จำนวนเงิน']]) || 0;
    if (!loc || !baht) return;
    out[loc] = costBaht_((out[loc] || 0) + baht);
  });
  return out;
}

/* ═══════════════════ สรุปให้อ่านง่าย ═══════════════════ */

/**
 * ภาพรวมทั้งระบบ ณ วินาทีนี้
 *   stock   มูลค่าวัตถุดิบคงเหลือ แยกตามที่ และแยกรายตัว
 *   owed    ค้างชำระ = ที่ส่งไปสะสม − ที่จ่ายคืนแล้ว
 *   used    ค่าใช้จ่ายวัตถุดิบสะสมของแต่ละที่
 */
function costSummary_() {
  var rep = costReplay_();
  var back = costPaidBack_();
  var central = costCentral_();

  var stock = {};
  Object.keys(rep.layers).forEach(function (loc) {
    var rows = [], sum = 0;
    Object.keys(rep.layers[loc]).forEach(function (item) {
      var qty = 0, value = 0;
      rep.layers[loc][item].forEach(function (l) { qty += l.qty; value += l.qty * l.cost; });
      qty = costQty_(qty); value = costBaht_(value);
      if (qty <= 0.00001 && value === 0) return;
      rows.push({ item: item, qty: qty, value: value,
                  unit: costBaht_(qty > 0 ? value / qty : 0) });
      sum += value;
    });
    rows.sort(function (a, b) { return b.value - a.value; });
    stock[loc] = { rows: rows, total: costBaht_(sum) };
  });

  var owed = {};
  function seat(loc) {
    if (owed[loc]) return owed[loc];
    var u = rep.used[loc] || {};
    var sent = rep.sent[loc] || 0;
    var paid = back[loc] || 0;
    var gone = costBaht_((u['ใช้ไป'] || 0) + (u['ของเสีย'] || 0));
    owed[loc] = {
      ส่งไปแล้ว:   sent,                              // ของออกจากครัวกลาง = หนี้ทันที
      ใช้ไป:       u['ใช้ไป'] || 0,
      ของเสีย:     u['ของเสีย'] || 0,
      จ่ายคืนแล้ว: paid,
      // จ่ายครบแล้วของที่เหลือไม่ใช่หนี้ เป็นวัตถุดิบคงเหลือของสาขาเฉย ๆ
      ค้างชำระ:    costBaht_(sent - paid),
      ถึงกำหนดจ่าย: costBaht_(Math.max(0, gone - paid)),  // ของที่ออกจากสต็อกแล้วแต่ยังไม่จ่าย
      วัตถุดิบคงเหลือ: (stock[loc] || { total: 0 }).total
    };
    return owed[loc];
  }
  Object.keys(rep.sent).forEach(seat);
  Object.keys(rep.used).forEach(function (l) { if (l !== central) seat(l); });
  Object.keys(back).forEach(seat);
  delete owed[central];

  return { central: central, stock: stock, owed: owed,
           used: rep.used, warn: rep.warn };
}

/* ═══════════════════ เขียนลงชีต ═══════════════════ */

function costWriteSheet_(name, headers, rows, note) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  var top = [[note]];
  sh.getRange(1, 1, 1, 1).setValues(top).setFontWeight('bold');
  sh.getRange(2, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#f3f3f4');
  if (rows.length) sh.getRange(3, 1, rows.length, headers.length).setValues(rows);
  sh.setFrozenRows(2);
  return sh;
}

/** มูลค่าสต็อกทุกที่ → ชีต "บัญชี_มูลค่าสต็อก" */
function buildStockValue() {
  cacheClear_();
  var s = costSummary_();
  var rows = [];
  Object.keys(s.stock).forEach(function (loc) {
    s.stock[loc].rows.forEach(function (r) {
      rows.push([loc, r.item, r.qty, r.unit, r.value]);
    });
    rows.push([loc, '— รวม —', '', '', s.stock[loc].total]);
  });
  costWriteSheet_(COST_SHEET_STOCK,
    ['สถานที่', 'สินค้า', 'คงเหลือ', 'ต้นทุน/หน่วย', 'มูลค่า'], rows,
    'มูลค่าสต็อกแบบเข้าก่อนออกก่อน · อัปเดตเมื่อ ' +
    Utilities.formatDate(new Date(), costTz_(), 'd/M/yyyy HH:mm') +
    ' · สั่งใหม่ได้ด้วย buildStockValue()');

  if (s.warn.length) {
    Logger.log('⚠️ มีจุดที่ตัวเลขไม่สมบูรณ์ ' + s.warn.length + ' จุด:\n  ' +
      s.warn.slice(0, 20).map(function (w) {
        return w.loc + ' · ' + w.item + ' — ' + w.msg;
      }).join('\n  '));
  }
  Logger.log('เขียนชีต "' + COST_SHEET_STOCK + '" แล้ว ' + rows.length + ' แถว');
}

/** ครัวกลางส่งของไปเท่าไหร่ สาขาใช้ไปเท่าไหร่ ค้างชำระเท่าไหร่ */
function buildBranchLedger() {
  cacheClear_();
  var s = costSummary_();
  var rows = [];
  Object.keys(s.owed).forEach(function (loc) {
    var u = s.used[loc] || { ใช้ไป: 0, ของเสีย: 0, นับเกิน: 0 };
    var st = s.stock[loc] || { total: 0 };
    var o = s.owed[loc];
    rows.push([loc, o['ส่งไปแล้ว'], o['ใช้ไป'], o['ของเสีย'],
               o['จ่ายคืนแล้ว'], o['ถึงกำหนดจ่าย'], o['ค้างชำระ'], st.total]);
  });
  var c = s.central;
  var uc = s.used[c] || { ใช้ไป: 0, ของเสีย: 0 };
  rows.push([c + ' (คงเหลือในครัว)', '', uc['ใช้ไป'], uc['ของเสีย'], '', '', '',
             (s.stock[c] || { total: 0 }).total]);

  costWriteSheet_(COST_SHEET_LEDGER,
    ['สถานที่', 'รับของไปแล้ว', 'ใช้ไปจริง', 'ของเสีย',
     'จ่ายคืนแล้ว', 'ถึงกำหนดจ่าย', 'ค้างชำระ', 'มูลค่าวัตถุดิบคงเหลือ'], rows,
    'ของออกจากครัวกลางแล้วเป็นหนี้ทันที · ขายได้เท่าไหร่จ่ายคืนเท่านั้น ที่เหลือค้างไว้ · อัปเดตเมื่อ ' +
    Utilities.formatDate(new Date(), costTz_(), 'd/M/yyyy HH:mm') +
    ' · สาขาจ่ายคืนกรอกในชีต "' + COST_SHEET_PAY + '"');
  Logger.log('เขียนชีต "' + COST_SHEET_LEDGER + '" แล้ว ' + rows.length + ' แถว');
}

/** สร้างชีตให้กรอกเงินที่สาขาโอนคืนครัวกลาง */
function setupCosting() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(COST_SHEET_PAY);
  if (!sh) {
    sh = ss.insertSheet(COST_SHEET_PAY);
    sh.getRange(1, 1, 1, COST_PAY_COLS.length).setValues([COST_PAY_COLS])
      .setFontWeight('bold').setBackground('#f3f3f4');
    sh.setFrozenRows(1);
    Logger.log('สร้างชีต "' + COST_SHEET_PAY + '" แล้ว — เวลาสาขาโอนเงินคืนครัวกลาง มากรอกที่นี่');
  } else {
    Logger.log('มีชีต "' + COST_SHEET_PAY + '" อยู่แล้ว');
  }
  refreshCostingSheets();
  Logger.log('\nอยากให้ชีตอัปเดตเองทุกชั่วโมง สั่ง setupCostingTriggers() อีกทีนึง');
}

/* ═══════════════════ ให้ชีตอัปเดตเอง ═══════════════════ */

/** เขียนทั้งสองชีตรวดเดียว */
function refreshCostingSheets() {
  cacheClear_();
  buildStockValue();
  buildBranchLedger();
}

/**
 * ตั้งให้ชีตอัปเดตเองทุกชั่วโมง
 * ไม่ได้ให้อัปเดตทุกครั้งที่บันทึกของ เพราะการคิดต้นทุนต้องไล่ทุกแถวตั้งแต่ต้น
 * ถ้าไปแขวนไว้ท้ายปุ่มบันทึก คนกดจะรอนานขึ้นทุกครั้งโดยไม่จำเป็น
 * อยากได้ตัวเลขสด ๆ เดี๋ยวนั้นให้ดูหน้าเว็บ ซึ่งคิดตอนเปิดอยู่แล้ว
 */
function setupCostingTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshCostingSheets') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshCostingSheets').timeBased().everyHours(1).create();
  Logger.log('ตั้งให้ชีตบัญชีอัปเดตเองทุกชั่วโมงแล้ว');
}

/** เมนูในชีต — เจ้าของจะได้ไม่ต้องเข้า Apps Script เพื่อกดอัปเดต */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('📒 บัญชี')
      .addItem('อัปเดตตัวเลขเดี๋ยวนี้', 'refreshCostingSheets')
      .addItem('ดูสรุปย่อ', 'previewCosting')
      .addSeparator()
      .addItem('ตั้งค่าครั้งแรก', 'setupCosting')
      .addItem('ให้อัปเดตเองทุกชั่วโมง', 'setupCostingTriggers')
      .addToUi();
  } catch (e) { /* เปิดจาก trigger ไม่มี UI ข้ามไป */ }
}

/** ดูสรุปเร็ว ๆ ใน Log ไม่ต้องเปิดชีต */
function previewCosting() {
  cacheClear_();
  var s = costSummary_();
  var out = ['📊 ต้นทุนและยอดค้างชำระ ณ ' +
             Utilities.formatDate(new Date(), costTz_(), 'd/M/yyyy HH:mm')];
  Object.keys(s.stock).forEach(function (loc) {
    out.push('\n📍 ' + loc + ' — มูลค่าสต็อก ' + s.stock[loc].total.toLocaleString() + ' บาท');
    s.stock[loc].rows.slice(0, 8).forEach(function (r) {
      out.push('   ' + r.item + '  ' + r.qty + ' × ' + r.unit + ' = ' + r.value);
    });
    if (s.stock[loc].rows.length > 8) out.push('   … อีก ' + (s.stock[loc].rows.length - 8) + ' รายการ');
  });
  Object.keys(s.owed).forEach(function (loc) {
    var o = s.owed[loc];
    out.push('\n💰 ' + loc +
             '\n   รับของไปแล้ว ' + o['ส่งไปแล้ว'].toLocaleString() +
             ' · จ่ายคืนแล้ว ' + o['จ่ายคืนแล้ว'].toLocaleString() +
             ' → ค้างชำระ ' + o['ค้างชำระ'].toLocaleString() + ' บาท' +
             '\n   ใช้ไปจริง ' + o['ใช้ไป'].toLocaleString() +
             ' + ของเสีย ' + o['ของเสีย'].toLocaleString() +
             ' → ถึงกำหนดจ่าย ' + o['ถึงกำหนดจ่าย'].toLocaleString() + ' บาท' +
             '\n   วัตถุดิบคงเหลือ ' + o['วัตถุดิบคงเหลือ'].toLocaleString() + ' บาท');
  });
  if (s.warn.length) {
    out.push('\n⚠️ จุดที่ตัวเลขไม่สมบูรณ์ ' + s.warn.length + ' จุด');
    s.warn.slice(0, 10).forEach(function (w) {
      out.push('   ' + w.loc + ' · ' + w.item + ' — ' + w.msg);
    });
  }
  Logger.log(out.join('\n'));
}
