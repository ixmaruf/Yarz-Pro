const fs = require('fs');
let text = fs.readFileSync('Yarz-admin panal/index.html', 'utf8');

const replacement = `  const btn = $('login-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ri-loader-4-line" style="animation:spin 1s linear infinite"></i> which Processing...';

  let ok = false;
  let _serverLock = 0;
  try {`;

if (!text.includes("const btn = $('login-btn');")) {
  text = text.replace(/let ok = false;[\s]*let _serverLock = 0;[\s]*try \{/, replacement);
  fs.writeFileSync('Yarz-admin panal/index.html', text);
  console.log('Restored btn var');
} else {
  console.log('btn var exists');
}
