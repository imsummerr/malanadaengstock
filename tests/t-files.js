process.env.TZ = 'Asia/Bangkok';
const fs = require('fs'), path = require('path');
const { makeCheck } = require('./harness');
const { fresh } = require('./fixture');
const { eq, section, done } = makeCheck('รุ่นไฟล์ .gs — หน้าสต็อกบอกเจ้าของว่าไฟล์ไหนยังไม่ได้วางใหม่');

const html = fs.readFileSync(path.join(__dirname, '..', 'stock.html'), 'utf8');
const m = html.match(/const WANT_FILES = (\{[\s\S]*?\});/);
const sortK = o => o && Object.keys(o).sort().reduce((a, k) => (a[k] = o[k], a), {});
const want = sortK(Function('return ' + m[1])());

section('โค้ดใน repo = รุ่นที่หน้าเว็บรอ (แก้ไฟล์ไหนต้องเปลี่ยนรุ่นทั้งสองที่)');
{
  const g = fresh();
  const got = sortK(g.gsFileVersions_());
  eq('ทุกไฟล์ตรงกัน', got, want);
  eq('BACKEND_VERSION ขึ้นต้นด้วยรุ่น pos-backend.gs', g.BACKEND_VERSION.split('·')[0].trim(), want['pos-backend.gs']);
  eq('bootstrap ส่ง files ให้เจ้าของ', sortK(g.handleStockBootstrap_({ token: 't' }).data.files), want);
  g.checkToken_ = () => ({ role: 'staff', branch: 'ตลาดทรัพย์พัฒนา', branches: ['ตลาดทรัพย์พัฒนา'], name: 'x' });
  eq('พนักงานไม่ได้ files', g.handleStockBootstrap_({ token: 't' }).data.files, undefined);
}

section('ไฟล์เก่าที่ยังไม่มี GS_FILES — ส่องจากของในรุ่นล่าสุดแทน');
{
  const g = fresh();
  delete g.GS_FILES['stock-costing.gs'];
  eq('stock-costing ล่าสุด (มี oweWarn) ยังรู้ว่าเป็น 15c', g.gsFileVersions_()['stock-costing.gs'], '2026-10-15c');
  g.costReplayRaw_ = function () { return {}; };
  eq('stock-costing เก่า (ไม่มี oweWarn) = ว่าง → หน้าเว็บขึ้นเตือน', g.gsFileVersions_()['stock-costing.gs'], '');
  delete g.GS_FILES['line-intake.gs'];          // 16/10 ไฟล์นี้จดรุ่นเองแล้ว — ลบออกเพื่อจำลองไฟล์ 15b ที่ยังไม่จด
  eq('line-intake 15b (มีอัลม่อน ยังไม่จดรุ่น) ส่องได้ว่า 15b', g.gsFileVersions_()['line-intake.gs'], '2026-10-15b');
  delete g.INTAKE_ALIAS['อัลม่อน'];
  eq('line-intake เก่า (ไม่มีอัลม่อน) = ว่าง', g.gsFileVersions_()['line-intake.gs'], '');
}

process.exit(done().fail ? 1 : 0);
