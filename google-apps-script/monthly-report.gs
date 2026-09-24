/************************************************************
 *  รายงานสรุปรายเดือน — ตัดยอดเดือนต่อเดือน
 *
 *  ใช้คู่กับการนับสต็อกทุกสิ้นเดือน
 *    นับสิ้นเดือน = ปิดยอดเดือนนั้น ของที่หายไปคือของที่ขายไปจริง
 *    เดือนถัดไปเริ่มนับจากยอดที่นับได้ ไม่ต้องล้างอะไรเอง
 *
 *  สั่ง monthlyReport('2026-09') หรือ monthlyReportLastMonth()
 *  ได้ชีต "รายงานรายเดือน" ที่เขียนทับทุกครั้ง
 *
 *  ตัวเลขทุกตัวมาจากที่บันทึกไว้อยู่แล้ว ไม่ต้องกรอกซ้ำ
 *  ต้นทุนวัตถุดิบมาจาก stock-costing.gs ซึ่งคิดแบบเข้าก่อนออกก่อน
 ************************************************************/

var RPT_SHEET = 'รายงานรายเดือน';
var RPT_DAYS  = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

function rptTz_()   { return (typeof TZ === 'string' && TZ) ? TZ : 'Asia/Bangkok'; }
function rptBaht_(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function rptPct_(part, whole) {
  return whole > 0 ? Math.round(part / whole * 1000) / 10 : 0;
}

/** "2026-09-15" หรือ Date → "2026-09" · อ่านไม่ออกคืนค่าว่าง */
function rptMonthOf_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, rptTz_(), 'yyyy-MM');
  }
  var t = String(v == null ? '' : v).trim();
  var m = t.match(/^(\d{4})-(\d{2})/);
  if (m) return m[1] + '-' + m[2];
  // d/M/yyyy — ปีไทยก็รับ แปลงเป็น ค.ศ. ให้
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    var y = Number(m[3]); if (y > 2400) y -= 543;
    return y + '-' + ('0' + m[2]).slice(-2);
  }
  var d = new Date(t);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, rptTz_(), 'yyyy-MM');
}

function rptDateOf_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  var t = String(v == null ? '' : v).trim();
  var m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    var y = Number(m[3]); if (y > 2400) y -= 543;
    return new Date(y, Number(m[2]) - 1, Number(m[1]));
  }
  var d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

/** "18:42" หรือ Date → 18 · อ่านไม่ออกคืน -1 */
function rptHourOf_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.getHours();
  var m = String(v == null ? '' : v).trim().match(/(\d{1,2})[:.](\d{2})/);
  return m ? Number(m[1]) : -1;
}

function rptRead_(name) {
  var sh = sheet_(name);
  if (!sh || sh.getLastRow() < 2) return { head: [], rows: [] };
  var v = sh.getDataRange().getValues();
  return { head: v[0].map(function (x) { return String(x).trim(); }), rows: v.slice(1) };
}

/* ═══════════════════ เก็บตัวเลขของเดือนนั้น ═══════════════════ */

function rptGather_(ym, branch) {
  var only = String(branch || '').trim();
  var out = {
    ym: ym, branch: only,
    bills: 0, sales: 0, discount: 0, delivery: 0,
    byDow: RPT_DAYS.map(function (d) { return { day: d, sales: 0, bills: 0, dates: {} }; }),
    byHour: {}, byPay: {},
    sticks: 0, mama: 0, extras: 0,
    menu: {},          // ลูกค้าสั่งอะไร นับจากบิล
    used: {},          // ของที่ถูกใช้จริง จากผลนับสต็อก
    waste: {},         // ของเสีย
    cogs: 0, wasteCost: 0,
    expense: 0, byExpense: {}
  };

  // ── บิลหน้าร้าน ──
  var o = rptRead_(SHEET_ORDERS);
  var iDate = o.head.indexOf('วันที่'), iTime = o.head.indexOf('เวลา');
  var iLoc = o.head.indexOf('สาขา'), iNet = o.head.indexOf('ยอดสุทธิ');
  var iDisc = o.head.indexOf('ส่วนลด'), iPay = o.head.indexOf('วิธีชำระเงิน');
  var iStick = o.head.indexOf('รวมไม้'), iMama = o.head.indexOf('รวมมาม่า');
  var iEx = o.head.indexOf('รวมของอื่น'), iExName = o.head.indexOf('ของอื่น');
  var iSoup = o.head.indexOf('น้ำซุป'), iHot = o.head.indexOf('ความเผ็ด');
  var iDip = o.head.indexOf('น้ำจิ้ม');

  o.rows.forEach(function (r) {
    if (iDate === -1 || rptMonthOf_(r[iDate]) !== ym) return;
    if (only && String(r[iLoc] || '').trim() !== only) return;
    var net = Number(r[iNet]) || 0;
    out.bills++;
    out.sales = rptBaht_(out.sales + net);
    out.discount = rptBaht_(out.discount + (iDisc === -1 ? 0 : Number(r[iDisc]) || 0));

    var d = rptDateOf_(r[iDate]);
    if (d) {
      var b = out.byDow[d.getDay()];
      b.sales = rptBaht_(b.sales + net);
      b.bills++;
      b.dates[Utilities.formatDate(d, rptTz_(), 'yyyy-MM-dd')] = true;
    }
    var h = iTime === -1 ? -1 : rptHourOf_(r[iTime]);
    if (h >= 0) {
      if (!out.byHour[h]) out.byHour[h] = { sales: 0, bills: 0 };
      out.byHour[h].sales = rptBaht_(out.byHour[h].sales + net);
      out.byHour[h].bills++;
    }
    var pay = iPay === -1 ? 'ไม่ระบุ' : (String(r[iPay] || '').trim() || 'ไม่ระบุ');
    out.byPay[pay] = rptBaht_((out.byPay[pay] || 0) + net);

    out.sticks += iStick === -1 ? 0 : Number(r[iStick]) || 0;
    out.mama   += iMama  === -1 ? 0 : Number(r[iMama])  || 0;
    out.extras += iEx    === -1 ? 0 : Number(r[iEx])    || 0;

    function tally(label, v) {
      var t = String(v == null ? '' : v).trim();
      if (!t) return;
      var key = label + ' · ' + t;
      out.menu[key] = (out.menu[key] || 0) + 1;
    }
    if (iSoup !== -1) tally('น้ำซุป', r[iSoup]);
    if (iHot  !== -1) tally('ความเผ็ด', r[iHot]);
    if (iDip  !== -1) tally('น้ำจิ้ม', r[iDip]);
    // ของอื่นเก็บเป็นข้อความสรุปช่องเดียว เช่น "ต็อก x2, ชีส x1"
    if (iExName !== -1) {
      String(r[iExName] || '').split(/[,·]+/).forEach(function (part) {
        var t = part.trim();
        if (!t) return;
        var mm = t.match(/^(.*?)\s*[x×]\s*(\d+)$/);
        var nm = (mm ? mm[1] : t).trim();
        var qty = mm ? Number(mm[2]) : 1;
        if (nm) out.menu['ของอื่น · ' + nm] = (out.menu['ของอื่น · ' + nm] || 0) + qty;
      });
    }
  });

  // ── เดลิเวอรี่ — ไม่มีช่องเงิน ต้องคูณราคาเอง ──
  var dl = rptRead_(SHEET_DELIVERY);
  var jDate = dl.head.indexOf('วันที่'), jLoc = dl.head.indexOf('สาขา'),
      jData = dl.head.indexOf('ข้อมูล');
  if (jDate !== -1 && jData !== -1) {
    var price = {};
    if (typeof itemCatalogue_ === 'function') {
      try { itemCatalogue_().forEach(function (it) { if (it.price) price[it.name] = it.price; }); }
      catch (e) {}
    }
    dl.rows.forEach(function (r) {
      if (rptMonthOf_(r[jDate]) !== ym) return;
      if (only && jLoc !== -1 && String(r[jLoc] || '').trim() !== only) return;
      try {
        JSON.parse(r[jData] || '[]').forEach(function (it) {
          var qty = Number(it.qty) || 0;
          out.delivery = rptBaht_(out.delivery + qty * (price[it.name] || 0));
          if (it.name) out.menu['เดลิเวอรี่ · ' + it.name] =
            (out.menu['เดลิเวอรี่ · ' + it.name] || 0) + qty;
        });
      } catch (e) {}
    });
  }

  // ── ค่าใช้จ่ายหน้าร้าน ──
  var ex = rptRead_(SHEET_EXPENSE);
  var kDate = ex.head.indexOf('วันที่'), kLoc = ex.head.indexOf('สาขา'),
      kType = ex.head.indexOf('ประเภท'), kBaht = ex.head.indexOf('จำนวนเงิน');
  if (kDate !== -1 && kBaht !== -1) {
    ex.rows.forEach(function (r) {
      if (rptMonthOf_(r[kDate]) !== ym) return;
      if (only && kLoc !== -1 && String(r[kLoc] || '').trim() !== only) return;
      var baht = Number(r[kBaht]) || 0;
      if (!baht) return;
      var type = kType === -1 ? 'อื่น ๆ' : (String(r[kType] || '').trim() || 'อื่น ๆ');
      out.expense = rptBaht_(out.expense + baht);
      out.byExpense[type] = rptBaht_((out.byExpense[type] || 0) + baht);
    });
  }

  // ── ต้นทุนวัตถุดิบ จากผลนับสต็อก ──
  if (typeof costReplay_ === 'function') {
    try {
      (costReplay_().log || []).forEach(function (r) {
        var d = new Date(r.t);
        if (Utilities.formatDate(d, rptTz_(), 'yyyy-MM') !== ym) return;
        if (only && r.loc !== only) return;
        if (r.kind === 'ของเสีย') {
          out.wasteCost = rptBaht_(out.wasteCost + r.value);
          if (!out.waste[r.item]) out.waste[r.item] = { qty: 0, value: 0 };
          out.waste[r.item].qty += r.qty;
          out.waste[r.item].value = rptBaht_(out.waste[r.item].value + r.value);
        } else {
          out.cogs = rptBaht_(out.cogs + r.value);
          if (!out.used[r.item]) out.used[r.item] = { qty: 0, value: 0 };
          out.used[r.item].qty += r.qty;
          out.used[r.item].value = rptBaht_(out.used[r.item].value + r.value);
        }
      });
    } catch (e) { Logger.log('rptGather_ อ่านต้นทุนไม่ได้: ' + e.message); }
  }

  out.revenue = rptBaht_(out.sales + out.delivery);
  out.gross   = rptBaht_(out.revenue - out.cogs - out.wasteCost);
  out.net     = rptBaht_(out.gross - out.expense);
  return out;
}

/* ═══════════════════ เขียนรายงาน ═══════════════════ */

function rptLine_(rows, label, value, pct, note) {
  rows.push([label, value === '' ? '' : rptBaht_(value),
             pct === '' || pct === undefined ? '' : pct / 100, note || '']);
}

function rptTop_(obj, pick) {
  return Object.keys(obj).map(function (k) { return { k: k, v: pick(obj[k]) }; })
    .sort(function (a, b) { return b.v - a.v; });
}

/**
 * รายงานเดือนที่ระบุ เช่น monthlyReport('2026-09')
 * ไม่ใส่เดือนมา = เดือนนี้ · ใส่สาขามาด้วยได้ ไม่ใส่คือรวมทุกที่
 */
function monthlyReport(ym, branch) {
  cacheClear_();
  ym = String(ym || Utilities.formatDate(new Date(), rptTz_(), 'yyyy-MM')).trim();
  var g = rptGather_(ym, branch);
  var R = [];

  var title = 'รายงานเดือน ' + ym + (g.branch ? ' · ' + g.branch : ' · ทุกสาขา');
  R.push(['ยอดขายและกำไร', 'บาท', '% ของยอดขาย', 'หมายเหตุ']);
  rptLine_(R, 'ขายหน้าร้าน', g.sales, rptPct_(g.sales, g.revenue), g.bills + ' บิล');
  rptLine_(R, 'เดลิเวอรี่', g.delivery, rptPct_(g.delivery, g.revenue), 'ก่อนหักค่าคอม');
  rptLine_(R, 'รายได้รวม', g.revenue, 100, '');
  rptLine_(R, '− ค่าใช้จ่ายวัตถุดิบ', g.cogs, rptPct_(g.cogs, g.revenue), 'จากผลนับสต็อก');
  rptLine_(R, '− ของเสีย', g.wasteCost, rptPct_(g.wasteCost, g.revenue), '');
  rptLine_(R, 'กำไรขั้นต้น', g.gross, rptPct_(g.gross, g.revenue), '');

  R.push(['', '', '', '']);
  R.push(['ค่าใช้จ่าย', 'บาท', '% ของยอดขาย', '']);
  rptTop_(g.byExpense, function (v) { return v; }).forEach(function (e) {
    rptLine_(R, '− ' + e.k, e.v, rptPct_(e.v, g.revenue), '');
  });
  rptLine_(R, 'รวมค่าใช้จ่าย', g.expense, rptPct_(g.expense, g.revenue), '');
  rptLine_(R, 'กำไรสุทธิ', g.net, rptPct_(g.net, g.revenue), '');
  rptLine_(R, 'เฉลี่ยต่อบิล', g.bills ? g.sales / g.bills : 0, '', g.bills + ' บิล');
  rptLine_(R, 'ส่วนลดที่ให้ไป', g.discount, rptPct_(g.discount, g.revenue), '');

  // ── วันไหนขายดี ──
  R.push(['', '', '', '']);
  R.push(['วันในสัปดาห์', 'ยอดขาย', '% ของยอดขาย', 'บิล · เฉลี่ยต่อวันที่เปิด']);
  var dows = g.byDow.filter(function (d) { return d.bills > 0; });
  var best = null, worst = null;
  dows.forEach(function (d) {
    d.open = Object.keys(d.dates).length;
    d.avg = d.open ? rptBaht_(d.sales / d.open) : 0;
    if (!best || d.avg > best.avg) best = d;
    if (!worst || d.avg < worst.avg) worst = d;
  });
  // เรียงตามวันจันทร์→อาทิตย์ ให้อ่านง่ายกว่าเรียงตามยอด
  [1, 2, 3, 4, 5, 6, 0].forEach(function (i) {
    var d = g.byDow[i];
    if (!d.bills) return;
    rptLine_(R, d.day, d.sales, rptPct_(d.sales, g.sales),
      d.bills + ' บิล · เฉลี่ยวันละ ' + d.avg.toLocaleString() +
      (d === best ? '  ⭐ ดีสุด' : d === worst ? '  🔻 น้อยสุด' : ''));
  });

  // ── ช่วงเวลา ──
  R.push(['', '', '', '']);
  R.push(['ช่วงเวลา', 'ยอดขาย', '% ของยอดขาย', 'บิล']);
  var hours = Object.keys(g.byHour).map(Number).sort(function (a, b) { return a - b; });
  var peak = null;
  hours.forEach(function (h) { if (!peak || g.byHour[h].sales > g.byHour[peak].sales) peak = h; });
  hours.forEach(function (h) {
    var v = g.byHour[h];
    rptLine_(R, ('0' + h).slice(-2) + ':00–' + ('0' + h).slice(-2) + ':59',
      v.sales, rptPct_(v.sales, g.sales),
      v.bills + ' บิล' + (h === peak ? '  ⭐ ช่วงพีค' : ''));
  });

  // ── ลูกค้าทานอะไร ──
  R.push(['', '', '', '']);
  R.push(['ลูกค้าสั่งอะไร', 'จำนวน', '', 'หน่วย']);
  rptLine_(R, 'ไม้', g.sticks, '', 'ไม้');
  rptLine_(R, 'มาม่า', g.mama, '', 'ห่อ');
  rptLine_(R, 'ของอื่น', g.extras, '', 'ชิ้น');
  rptTop_(g.menu, function (v) { return v; }).slice(0, 25).forEach(function (e) {
    rptLine_(R, e.k, e.v, '', 'ครั้ง');
  });

  // ── ของที่ถูกใช้จริง ──
  R.push(['', '', '', '']);
  R.push(['ของที่ใช้ไปจริง (จากผลนับสต็อก)', 'มูลค่า', '% ของต้นทุน', 'จำนวน']);
  rptTop_(g.used, function (v) { return v.value; }).slice(0, 25).forEach(function (e) {
    rptLine_(R, e.k, e.v, rptPct_(e.v, g.cogs),
      Math.round(g.used[e.k].qty * 100) / 100);
  });

  // ── ของเสีย ──
  R.push(['', '', '', '']);
  R.push(['ของเสีย', 'มูลค่า', '% ของของเสีย', 'จำนวน']);
  var wl = rptTop_(g.waste, function (v) { return v.value; });
  if (!wl.length) rptLine_(R, 'ไม่มีของเสียในเดือนนี้ 🎉', '', '', '');
  wl.slice(0, 20).forEach(function (e) {
    rptLine_(R, e.k, e.v, rptPct_(e.v, g.wasteCost),
      Math.round(g.waste[e.k].qty * 100) / 100);
  });

  // ── วิธีจ่ายเงิน ──
  R.push(['', '', '', '']);
  R.push(['ลูกค้าจ่ายยังไง', 'ยอด', '% ของหน้าร้าน', '']);
  rptTop_(g.byPay, function (v) { return v; }).forEach(function (e) {
    rptLine_(R, e.k, e.v, rptPct_(e.v, g.sales), '');
  });

  rptWrite_(title, R, g);
  Logger.log(rptText_(g, best, worst, peak));
  return g;
}

function rptWrite_(title, rows, g) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(RPT_SHEET) || ss.insertSheet(RPT_SHEET);
  sh.clear();
  sh.getRange(1, 1, 1, 1).setValues([[title]]).setFontWeight('bold').setFontSize(13);
  sh.getRange(2, 1, 1, 1).setValues([['สร้างเมื่อ ' +
    Utilities.formatDate(new Date(), rptTz_(), 'd/M/yyyy HH:mm') +
    ' · ตัวเลขทั้งหมดมาจากที่บันทึกไว้แล้ว ไม่ได้กรอกเพิ่ม']]);
  sh.getRange(3, 1, rows.length, 4).setValues(rows);

  // หัวข้อของแต่ละส่วน = แถวที่ช่องที่สองเป็นข้อความ ไม่ใช่ตัวเลข
  rows.forEach(function (r, i) {
    if (typeof r[1] === 'string' && r[1] !== '') {
      sh.getRange(3 + i, 1, 1, 4).setFontWeight('bold').setBackground('#f0f0f2');
    }
  });
  sh.getRange(3, 2, rows.length, 1).setNumberFormat('#,##0.00');
  sh.getRange(3, 3, rows.length, 1).setNumberFormat('0.0%');
  sh.setColumnWidth(1, 300);
  sh.setColumnWidth(4, 260);
  sh.setFrozenRows(2);
  if (g && g.cogs === 0 && g.revenue > 0) {
    sh.getRange(2, 3, 1, 2).setValues([['⚠️ ไม่มีต้นทุนวัตถุดิบในเดือนนี้',
      'ยังไม่ได้นับสต็อก หรือยังไม่ได้ติดตั้ง stock-costing.gs']]);
  }
}

function rptText_(g, best, worst, peak) {
  var L = ['📊 ' + g.ym + (g.branch ? ' · ' + g.branch : ''),
    'รายได้ ' + g.revenue.toLocaleString() + ' (' + g.bills + ' บิล)',
    'ต้นทุนวัตถุดิบ ' + g.cogs.toLocaleString() + ' = ' + rptPct_(g.cogs, g.revenue) + '%',
    'ของเสีย ' + g.wasteCost.toLocaleString() + ' = ' + rptPct_(g.wasteCost, g.revenue) + '%',
    'กำไรขั้นต้น ' + g.gross.toLocaleString() + ' = ' + rptPct_(g.gross, g.revenue) + '%',
    'ค่าใช้จ่าย ' + g.expense.toLocaleString() + ' = ' + rptPct_(g.expense, g.revenue) + '%',
    'กำไรสุทธิ ' + g.net.toLocaleString() + ' = ' + rptPct_(g.net, g.revenue) + '%'];
  if (best)  L.push('ขายดีสุด ' + best.day + ' เฉลี่ยวันละ ' + best.avg.toLocaleString());
  if (worst) L.push('น้อยสุด ' + worst.day + ' เฉลี่ยวันละ ' + worst.avg.toLocaleString());
  if (peak !== null && peak !== undefined) L.push('ช่วงพีค ' + peak + ':00 น.');
  return L.join('\n');
}

/** เดือนที่แล้ว — ใช้กับ trigger ทุกวันที่ 1 */
function monthlyReportLastMonth() {
  var d = new Date();
  d.setDate(1); d.setMonth(d.getMonth() - 1);
  return monthlyReport(Utilities.formatDate(d, rptTz_(), 'yyyy-MM'));
}

/** เดือนนี้ถึงวันนี้ */
function monthlyReportThisMonth() { return monthlyReport(); }

/**
 * ล้างของที่ค้างอยู่ให้เป็นศูนย์ แล้วเริ่มนับใหม่
 * เขียนเป็นแถว "ล้างยอด" ซึ่งเครื่องคิดต้นทุนจะไม่นับเป็นค่าใช้จ่ายวัตถุดิบ
 * ต่างจากการนับสต็อกได้ 0 ซึ่งแปลว่าของถูกใช้ไปหมดจริง ๆ
 */
function resetStockToZero() {
  zeroOutAllStock();
  if (typeof refreshCostingSheets === 'function') refreshCostingSheets();
  Logger.log('\nล้างเรียบร้อย — ของที่เข้ามาหลังจากนี้จะเริ่มนับใหม่จากศูนย์');
}
