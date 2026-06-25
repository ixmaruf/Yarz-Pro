const fs = require('fs');
let text = fs.readFileSync('Yarz-admin panal/index.html', 'utf8');

text = text.replace(
  'console.error("Login verification failed", e);',
  'console.error("Login verification failed", e); alert("LOGIN FAILED: " + e.message);'
);

fs.writeFileSync('Yarz-admin panal/index.html', text);
console.log('Added alert!');
