/** รันเทสต์ทุกไฟล์ที่ขึ้นต้นด้วย t- แล้วสรุปรวม */
process.env.TZ = 'Asia/Bangkok';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const files = fs.readdirSync(__dirname).filter(f => /^t-.*\.js$/.test(f)).sort();
let bad = 0;
files.forEach(f => {
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, f)],
                             { env: process.env, encoding: 'utf8' });
    const last = out.trim().split('\n').pop();
    console.log(last);
    if (/❌/.test(last)) { bad++; console.log(out); }
  } catch (e) { bad++; console.log('💥 ' + f + '\n' + (e.stdout || '') + (e.stderr || '')); }
});
console.log(bad ? `\n❌ พัง ${bad} ไฟล์` : '\n✅ ผ่านทุกไฟล์');
process.exit(bad ? 1 : 0);
