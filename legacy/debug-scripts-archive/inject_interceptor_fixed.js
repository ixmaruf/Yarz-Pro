const fs = require('fs');
let text = fs.readFileSync('Yarz-admin panal/index.html', 'utf8');

const interceptor = `async function appsPost(action, payload){
  // ----- SUPABASE HYBRID MIGRATION INTERCEPTOR -----
  if (window.supabaseAdapter) {
    try {
      const sbResult = await window.supabaseAdapter.handleAppsPost(action, payload);
      if (sbResult !== null) return sbResult;
    } catch (sbErr) {
      console.error('[Supabase Adapter] Error:', sbErr);
      if (sbErr.message && sbErr.message.includes('Migration in progress')) {
         // let it fallback
      } else {
         throw sbErr;
      }
    }
  }
  // ---------------------------------------------------
  // CSRF check: verify token matches before sending`;

if (!text.includes('SUPABASE HYBRID MIGRATION INTERCEPTOR')) {
  text = text.replace(/async function appsPost\(action, payload\)\{[\r\n\s]*\/\/ CSRF check: verify token matches before sending/m, interceptor);
  fs.writeFileSync('Yarz-admin panal/index.html', text);
  console.log('Successfully injected with regex!');
} else {
  console.log('Already there.');
}
