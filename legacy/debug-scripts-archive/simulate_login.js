const fs = require('fs');

let html = fs.readFileSync('Yarz-admin panal/index.html', 'utf8');

// We will extract doLogin and simulate its execution to see where it fails.
const start = html.indexOf('const doLogin = async (e)=>');
const end = html.indexOf('btn.disabled = false;', start);
const doLoginBody = html.substring(start, end + 'btn.disabled = false;'.length);

console.log("Extracted doLogin block to analyze.");

let modifiedBody = doLoginBody
  .replace('if(p) {', 'console.log("p is truthy"); if(p) {')
  .replace('const res = await appsPost(', 'console.log("calling appsPost..."); const res = await appsPost(')
  .replace('if(res && res.success && res.token){', 'console.log("res condition check:", res); if(res && res.success && res.token){')
  .replace('ok = true;', 'console.log("ok set to true!"); ok = true;')
  .replace('catch(e){', 'catch(e){ console.log("CAUGHT ERROR:", e);')
  .replace('btn.disabled = false;', 'console.log("btn.disabled set to false"); btn.disabled = false;');

console.log("MODIFIED BODY:");
console.log(modifiedBody);
