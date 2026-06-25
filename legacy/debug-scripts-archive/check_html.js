const fs = require('fs');
let text = fs.readFileSync('Yarz-admin panal/index.html', 'utf8');
const lines = text.split('\n');

const divIdx = lines.findIndex(l => l.includes('id="login-screen"'));
if(divIdx !== -1) {
  console.log("LOGIN SCREEN HTML:");
  console.log(lines.slice(divIdx, divIdx+40).join('\n'));
}

const errIdx = lines.findIndex(l => l.includes('id="login-error"'));
if(errIdx !== -1) {
  console.log("LOGIN ERROR HTML:");
  console.log(lines.slice(errIdx-2, errIdx+5).join('\n'));
}
