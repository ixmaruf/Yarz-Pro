const fs = require('fs');
let text = fs.readFileSync('Yarz-admin panal/index.html', 'utf8');

const oldStr = ` return { key, label:EN_DAYS[target.getDay()], isToday:false, date:target, dayName:EN_DAYS[target.getDay()] };
 let icon = 'check-circle';
 if(type==='error') icon = 'exclamation-circle';
 if(type==='info') icon = 'info-circle';
 t.innerHTML = '<i class="fas fa-'+icon+'"></i> '+esc(msg);
 clearTimeout(toast._t);
 toast._t = setTimeout(()=>t.classList.remove('show'), 2800);
}

function showLoader(text){
 $('load-text').textContent = text || 'Loading...';
 $('load-overlay').classList.add('show');
}
function hideLoader(){ $('load-overlay').classList.remove('show'); }

function parseSheetDate(v){
 if(!v) return null;
 if(v instanceof Date) return v;
 // Try ISO first
 let d = new Date(v);
 if(!isNaN(d.getTime())) return d;
 if (res && res.success && res.data) return res.data;
 throw new Error(res.msg || 'Sheet read failed');
}`;

const newStr = ` return { key, label:EN_DAYS[target.getDay()], isToday:false, date:target, dayName:EN_DAYS[target.getDay()] };
}

function toast(msg, type){
 const t = $('toast');
 t.className = 'toast '+(type||'success')+' show';
 let icon = 'check-circle';
 if(type==='error') icon = 'exclamation-circle';
 if(type==='info') icon = 'info-circle';
 t.innerHTML = '<i class="fas fa-'+icon+'"></i> '+esc(msg);
 clearTimeout(toast._t);
 toast._t = setTimeout(()=>t.classList.remove('show'), 2800);
}

function showLoader(text){
 $('load-text').textContent = text || 'Loading...';
 $('load-overlay').classList.add('show');
}
function hideLoader(){ $('load-overlay').classList.remove('show'); }

function parseSheetDate(v){
 if(!v) return null;
 if(v instanceof Date) return v;
 // Try ISO first
 let d = new Date(v);
 if(!isNaN(d.getTime())) return d;
 if(typeof v === 'string'){
  let p = v.split('/');
  if(p.length===3){
   d = new Date(p[2], p[1]-1, p[0]);
   if(!isNaN(d.getTime())) return d;
  }
 }
 return null;
}

async function sheetRead(range){
 const res = await appsPost('sheet_read', { range });
 if (res && res.success && res.data) return res.data;
 throw new Error(res.msg || 'Sheet read failed');
}

async function sheetReadFormatted(range){
 const res = await appsPost('sheet_read_formatted', { range });
 if (res && res.success && res.data) return res.data;
 throw new Error(res.msg || 'Sheet read failed');
}`;

text = text.replace(oldStr, newStr);
fs.writeFileSync('Yarz-admin panal/index.html', text);
console.log('Fixed index.html structure.');
