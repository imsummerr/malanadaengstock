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
    fee: 0, byApp: {},   // ค่า GP ที่แอปหัก แยกรายแอป
    guessed: 0,          // ออเดอร์ที่ไม่ได้กรอกยอดเงิน ต้องเดาเอา
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
    if (typeof costBefore_ === 'function' && costBefore_(rptDateOf_(r[iDate]))) return;
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
      jData = dl.head.indexOf('ข้อมูล'), jPf = dl.head.indexOf('แพลตฟอร์ม'),
      jAmt = dl.head.indexOf('ยอดเงิน');
  if (jDate !== -1 && jData !== -1) {
    var price = {};
    if (typeof itemCatalogue_ === 'function') {
      try { itemCatalogue_().forEach(function (it) { if (it.price) price[it.name] = it.price; }); }
      catch (e) {}
    }
    dl.rows.forEach(function (r) {
      if (rptMonthOf_(r[jDate]) !== ym) return;
      if (typeof costBefore_ === 'function' && costBefore_(rptDateOf_(r[jDate]))) return;
      if (only && jLoc !== -1 && String(r[jLoc] || '').trim() !== only) return;
      // นับรายการเสมอ ส่วนยอดเงินเอาที่แอปแจ้งก่อน ไม่มีค่อยเดาจากรายการราคา
      var guess = 0;
      try {
        JSON.parse(r[jData] || '[]').forEach(function (it) {
          var qty = Number(it.qty) || 0;
          guess += qty * (price[it.name] || 0);
          if (it.name) out.menu['เดลิเวอรี่ · ' + it.name] =
            (out.menu['เดลิเวอรี่ · ' + it.name] || 0) + qty;
        });
      } catch (e) {}
      var told = jAmt === -1 ? 0 : Number(r[jAmt]) || 0;
      var amt = told > 0 ? told : guess;
      if (told <= 0) out.guessed = (out.guessed || 0) + 1;
      if (!amt) return;
      out.delivery = rptBaht_(out.delivery + amt);
      // ค่า GP คิดจากราคาบนแอป แต่ละเจ้าหักไม่เท่ากัน
      var pf = jPf === -1 ? '' : String(r[jPf] || '').trim();
      var cut = (typeof deliveryCutRate_ === 'function') ? deliveryCutRate_(pf) : 0;
      var fee = rptBaht_(amt * cut);
      out.fee = rptBaht_(out.fee + fee);
      var key = pf || 'ไม่ระบุแอป';
      if (!out.byApp[key]) out.byApp[key] = { sales: 0, fee: 0, orders: 0, rate: cut };
      out.byApp[key].sales = rptBaht_(out.byApp[key].sales + amt);
      out.byApp[key].fee = rptBaht_(out.byApp[key].fee + fee);
      out.byApp[key].orders++;
    });
  }

  // ── ค่าใช้จ่ายหน้าร้าน ──
  var ex = rptRead_(SHEET_EXPENSE);
  var kDate = ex.head.indexOf('วันที่'), kLoc = ex.head.indexOf('สาขา'),
      kType = ex.head.indexOf('ประเภท'), kBaht = ex.head.indexOf('จำนวนเงิน');
  if (kDate !== -1 && kBaht !== -1) {
    ex.rows.forEach(function (r) {
      if (rptMonthOf_(r[kDate]) !== ym) return;
      if (typeof costBefore_ === 'function' && costBefore_(rptDateOf_(r[kDate]))) return;
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
  out.cash    = rptBaht_(out.revenue - out.fee);     // เงินที่เข้ากระเป๋าจริง
  out.gross   = rptBaht_(out.cash - out.cogs - out.wasteCost);
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
  rptLine_(R, 'เดลิเวอรี่ (ราคาบนแอป)', g.delivery, rptPct_(g.delivery, g.revenue), '');
  rptLine_(R, 'รายได้รวม', g.revenue, 100, '');
  rptLine_(R, '− ค่าคอมแอป + VAT', g.fee, rptPct_(g.fee, g.revenue),
    g.delivery ? 'หักจากราคาบนแอป ' + rptPct_(g.fee, g.delivery) + '%' : '');
  rptLine_(R, 'เงินเข้าจริง', g.cash, rptPct_(g.cash, g.revenue), '');
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

  // ── แยกตามแอป ──
  if (Object.keys(g.byApp).length) {
    R.push(['', '', '', '']);
    R.push(['เดลิเวอรี่แยกตามแอป', 'ราคาบนแอป', 'โดนหักกี่ %', 'ค่าคอม → เงินเข้าจริง']);
    rptTop_(g.byApp, function (v) { return v.sales; }).forEach(function (e) {
      var a = g.byApp[e.k];
      rptLine_(R, e.k + ' (' + a.orders + ' ออเดอร์)', a.sales, a.rate * 100,
        '−' + a.fee.toLocaleString() + ' → ' + rptBaht_(a.sales - a.fee).toLocaleString());
    });
    if (g.byApp['ไม่ระบุแอป']) {
      rptLine_(R, '⚠️ มีออเดอร์ที่ไม่ได้เลือกแอป', '', '',
        'คิดค่าคอมด้วยเรตกลาง อาจไม่ตรงกับที่โดนหักจริง');
    }
    if (g.guessed) {
      rptLine_(R, '⚠️ ไม่ได้กรอกยอดเงิน ' + g.guessed + ' ออเดอร์', '', '',
        'ประมาณจากรายการราคาหน้าร้าน ซึ่งต่ำกว่าราคาบนแอป — กรอกยอดที่แอปแจ้งจะแม่นกว่า');
    }
  }

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

  // สิ้นเดือนที่ขายได้แต่ไม่มีต้นทุน = ยังไม่ได้นับสต็อก หรือไปล้างยอดแทนการนับ
  R.push(['', '', '', '']);
  R.push(['ตรวจความครบถ้วน', '', '', '']);
  if (g.revenue > 0 && g.cogs === 0) {
    rptLine_(R, '⚠️ ขายได้แต่ไม่มีค่าใช้จ่ายวัตถุดิบ', '', '',
      'ยังไม่ได้นับสต็อกสิ้นเดือน หรือไปกด "ล้างสต็อก" แทนการนับ — ตัวเลขกำไรสูงเกินจริง');
  } else if (g.revenue > 0) {
    rptLine_(R, 'ต้นทุนวัตถุดิบต่อเงินเข้าจริง', '', rptPct_(g.cogs + g.wasteCost, g.cash),
      'ร้านหม่าล่าทั่วไปอยู่ราว 30–40% สูงกว่านี้ให้ดูว่าของหายหรือขายถูกไป');
  }
  if (g.wasteCost > 0) {
    rptLine_(R, 'ของเสียต่อยอดขาย', '', rptPct_(g.wasteCost, g.revenue),
      g.wasteCost / (g.revenue || 1) > 0.05 ? 'เกิน 5% ถือว่าเยอะ ลองลดรอบการส่งของ' : 'อยู่ในเกณฑ์ปกติ');
  }

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
    'ค่าคอมแอป ' + g.fee.toLocaleString() + ' → เงินเข้าจริง ' + g.cash.toLocaleString(),
    'ต้นทุนวัตถุดิบ ' + g.cogs.toLocaleString() + ' = ' + rptPct_(g.cogs, g.cash) + '%',
    'ของเสีย ' + g.wasteCost.toLocaleString() + ' = ' + rptPct_(g.wasteCost, g.revenue) + '%',
    'กำไรขั้นต้น ' + g.gross.toLocaleString() + ' = ' + rptPct_(g.gross, g.cash) + '%',
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
 * ล้างของที่ค้างอยู่ให้เป็นศูนย์ — ใช้ตอน "เริ่มระบบใหม่" เท่านั้น
 *
 * ⚠️ ห้ามใช้ตอนสิ้นเดือน
 *   สิ้นเดือนต้อง "นับสต็อก" ตามปกติ ของที่หายไประหว่างสองรอบนับ
 *   คือของที่ขายไปจริง = ค่าใช้จ่ายวัตถุดิบของเดือนนั้น
 *   ถ้ามาล้างยอดแทน ของที่เหลือจะหายไปเฉย ๆ โดยไม่กลายเป็นต้นทุน
 *   แล้วเดือนนั้นจะไม่รู้ว่า COGS เท่าไหร่ กำไรที่เห็นจะสูงเกินจริง
 */
/**
 * เริ่มใหม่ทั้งระบบ — ทั้งของ ทั้งเงิน
 *   ของ   ตั้งเป็น 0 ทุกที่ (แถว "ล้างยอด" ไม่นับเป็นค่าใช้จ่ายวัตถุดิบ)
 *   เงิน  ขีดเส้นวันเริ่มนับใหม่ ยอดขาย/ค่าใช้จ่าย/หนี้ก่อนหน้านั้นไม่เอามาคิด
 *
 * ไม่ลบแถวไหนทิ้งเลย ประวัติยังอยู่ในชีตครบ แค่ไม่ถูกนำมาคิด
 * เปลี่ยนใจก็สั่ง clearStartDate() แล้วลบแถว "ล้างยอด" ในชีตเช็คสต็อกออก
 */
function resetEverything(startYmd) {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}
  var ymd = String(startYmd || Utilities.formatDate(new Date(), rptTz_(), 'yyyy-MM-dd')).trim();
  if (ui) {
    var ans = ui.alert('เริ่มใหม่ทั้งระบบ',
      'จะตั้งของทุกที่เป็น 0 และเริ่มนับเงินใหม่ตั้งแต่ ' + ymd + '\n\n' +
      'ยอดขาย ค่าใช้จ่าย และยอดค้างชำระก่อนวันนั้น จะไม่ถูกนำมาคิดอีก\n' +
      'แถวเก่ายังอยู่ในชีตครบ ไม่ได้ลบ\n\n' +
      '⚠️ ถ้านี่คือการปิดยอดสิ้นเดือน อย่ากดปุ่มนี้ ให้ไปนับสต็อกตามปกติ\n\n' +
      'ยืนยันไหม', ui.ButtonSet.YES_NO);
    if (ans !== ui.Button.YES) { Logger.log('ยกเลิก ไม่ได้แก้อะไร'); return; }
  }
  PropertiesService.getScriptProperties().setProperty('ACC_START_DATE', ymd);
  zeroOutAllStock();
  if (typeof refreshCostingSheets === 'function') refreshCostingSheets();
  Logger.log('\nเริ่มใหม่เรียบร้อย — นับทุกอย่างตั้งแต่ ' + ymd + ' เป็นต้นไป\n' +
             'ของเก่ายังอยู่ในชีต แค่ไม่ถูกนำมาคิด · ย้อนกลับด้วย clearStartDate()');
}

/**
 * ลบรายการที่ลงไปผิดของ "วันเดียว" ออกให้หมด — ทั้งสต็อกและเงิน
 *
 * ต่างจากล้างสต็อกตรงที่ตัวนั้นตั้งยอดเป็น 0 แต่แถวเก่ายังอยู่และเงิน
 * ยังถูกนับ ส่วนตัวนี้ลบแถวทิ้งจริง เหมือนไม่เคยพิมพ์เข้ากลุ่มวันนั้น
 * ใช้ตอนลงไลน์ผิดหลายรายการจนแก้ทีละอันไม่ไหว แล้วอยากพิมพ์ใหม่ทั้งชุด
 *
 * ลบ 3 ชีต — ของเข้าครัวกลาง (จำนวนของเข้า) · ซื้อของเข้า · POS_Expenses
 * ไม่แตะ ของเข้าร้าน เช็คสต็อก ของเสีย แพ็คของ และยอดขาย POS_Orders
 * เพราะพวกนั้นไม่ได้มาจากไลน์ ลบไปจะพังของที่ถูกอยู่แล้ว
 *
 * ไม่ใส่วันมา = วันนี้ · ใส่เป็น 'd/M/yyyy' หรือ 'yyyy-MM-dd' ก็ได้
 */
function deleteIntakeDay(ymd) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = rptTz_();
  var want = rptDayKey_(ymd || new Date(), tz);
  if (!want) { Logger.log('อ่านวันที่ไม่ออก — ใส่เป็น 25/9/2026 หรือ 2026-09-25'); return; }

  // [ชื่อชีต, คอลัมน์วันที่, คอลัมน์ประเภท (เว้นว่าง = เอาทุกแถว), ค่าที่ต้องตรง]
  var targets = [
    ['จำนวนของเข้า', 'วันที่เวลา', 'ประเภท', 'ของเข้าครัวกลาง'],
    ['ซื้อของเข้า',   'วันที่',     '',       ''],
    ['POS_Expenses', 'วันที่',     '',       '']
  ];

  var plan = [], total = 0;
  targets.forEach(function (t) {
    var hit = rptRowsOnDay_(ss, t[0], t[1], t[2], t[3], want, tz);
    plan.push({ name: t[0], rows: hit });
    total += hit.length;
  });

  if (!total) { Logger.log('ไม่มีรายการของวันที่ ' + want + ' ให้ลบ'); return; }

  var detail = plan.filter(function (x) { return x.rows.length; })
    .map(function (x) { return '• ' + x.name + ' — ' + x.rows.length + ' แถว'; }).join('\n');

  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}
  if (ui) {
    var ans = ui.alert('ลบรายการของวันที่ ' + want,
      detail + '\n\nรวม ' + total + ' แถว — ลบทิ้งจริง เอาคืนไม่ได้\n\n' +
      'ไม่แตะยอดขาย ของเข้าร้าน เช็คสต็อก ของเสีย และแพ็คของ\n\nยืนยันไหม',
      ui.ButtonSet.YES_NO);
    if (ans !== ui.Button.YES) { Logger.log('ยกเลิก ไม่ได้ลบอะไร'); return; }
  }

  plan.forEach(function (x) {
    if (!x.rows.length) return;
    var sh = ss.getSheetByName(x.name);
    // ลบจากล่างขึ้นบน ไม่งั้นเลขแถวเลื่อนแล้วลบผิดแถว
    x.rows.slice().sort(function (a, b) { return b - a; })
      .forEach(function (r) { sh.deleteRow(r); });
  });

  if (typeof cacheClear_ === 'function') cacheClear_();
  if (typeof refreshCostingSheets === 'function') refreshCostingSheets();
  Logger.log('🧹 ลบรายการของวันที่ ' + want + ' แล้ว ' + total + ' แถว\n' + detail +
             '\n\nพิมพ์เข้ากลุ่มใหม่ได้เลย เหมือนไม่เคยลงวันนั้น');
}

/** วันในรูป d/M/yyyy — รับได้ทั้ง Date, 'd/M/yyyy' และ 'yyyy-MM-dd' */
function rptDayKey_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'd/M/yyyy');
  var t = String(v || '').trim();
  var m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return Number(m[3]) + '/' + Number(m[2]) + '/' + m[1];
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return Number(m[1]) + '/' + Number(m[2]) + '/' + m[3];
  return '';
}

/** เลขแถวในชีตนี้ที่ตรงวันที่ (และตรงประเภท ถ้าระบุมา) */
function rptRowsOnDay_(ss, sheetName, dateCol, kindCol, kindWant, want, tz) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var head = v[0].map(function (x) { return String(x || '').trim(); });
  var dc = head.indexOf(dateCol);
  if (dc === -1) return [];
  var kc = kindCol ? head.indexOf(kindCol) : -1;

  var out = [];
  for (var i = 1; i < v.length; i++) {
    if (kc !== -1 && String(v[i][kc] || '').trim() !== kindWant) continue;
    if (rptDayKey_(v[i][dc], tz) !== want) continue;
    out.push(i + 1);
  }
  return out;
}

function resetStockToZero() {
  // กดจากเมนูต้องยืนยันก่อน กดพลาดแล้วยอดหายทั้งระบบ
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}
  if (ui) {
    var ans = ui.alert('ล้างสต็อกเป็นศูนย์',
      'ใช้ตอนเริ่มระบบใหม่เท่านั้น\n\n' +
      'ของที่ค้างอยู่ทุกที่จะถูกตั้งเป็น 0 และ "ไม่" นับเป็นค่าใช้จ่ายวัตถุดิบ\n\n' +
      '⚠️ ถ้านี่คือการปิดยอดสิ้นเดือน อย่ากดปุ่มนี้\n' +
      'ให้ไปนับสต็อกในหน้าเว็บตามปกติ ระบบจะคิด COGS ให้เอง\n\n' +
      'ยืนยันจะล้างทั้งระบบไหม',
      ui.ButtonSet.YES_NO);
    if (ans !== ui.Button.YES) { Logger.log('ยกเลิก ไม่ได้ล้างอะไร'); return; }
  }
  zeroOutAllStock();
  if (typeof refreshCostingSheets === 'function') refreshCostingSheets();
  Logger.log('\nล้างเรียบร้อย — ของที่เข้ามาหลังจากนี้จะเริ่มนับใหม่จากศูนย์\n' +
             'สิ้นเดือนถัดไปให้ "นับสต็อก" ตามปกติ อย่ามาล้างยอดซ้ำ ไม่งั้นจะไม่มี COGS');
}
