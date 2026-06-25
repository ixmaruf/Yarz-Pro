const fs = require('fs');
const html = fs.readFileSync('Yarz-admin panal/index.html', 'utf8');

// 1. Check all scripts have valid syntax
const regex = /<script(?:.*?)>([\s\S]*?)<\/script>/gi;
let match, i = 0, allOk = true;
while ((match = regex.exec(html)) !== null) {
  i++;
  const sc = match[1];
  if(sc.trim().length > 100) {
    fs.writeFileSync('_tmp_sc_'+i+'.js', sc);
    try {
      require('child_process').execSync('node -c _tmp_sc_'+i+'.js', {stdio:'pipe'});
    } catch(e) { console.log('Script '+i+': SYNTAX ERROR!'); allOk = false; }
  }
}
if(allOk) console.log('All scripts: syntax OK');

// 2. Check sheetRead exists
console.log('sheetRead exists:', html.includes('async function sheetRead(range)'));
console.log('sheetReadFormatted exists:', html.includes('async function sheetReadFormatted(range)'));

// 3. Check parseSheetDate is correct
console.log('No "is Today" bug:', !html.includes('is Today:false'));
console.log('isToday:false correct:', html.includes('isToday:false'));

// 4. Check toast function exists  
console.log('toast function exists:', html.includes('function toast(msg, type)'));

// 5. Check supabase adapter
const adapter = fs.readFileSync('Yarz-admin panal/supabase_adapter.js', 'utf8');
console.log('adminlogin NOT in adapter:', !adapter.includes("case 'adminlogin'"));
console.log('null fallback for unknown ranges:', adapter.includes('return null;'));
console.log('sheet_read handled:', adapter.includes("case 'sheet_read'"));
console.log('INVENTORY handled:', adapter.includes("range.startsWith('INVENTORY')"));

// Cleanup
for(let j=1;j<=10;j++) try { fs.unlinkSync('_tmp_sc_'+j+'.js'); } catch(e) {}
