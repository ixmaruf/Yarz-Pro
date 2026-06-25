const fs = require('fs');
let text = fs.readFileSync('Yarz-admin panal/index.html', 'utf8');

const targetFunction = `async function appsPost(action, payload){
  // CSRF check: verify token matches before sending`;

const interceptor = `async function appsPost(action, payload){
  // ----- SUPABASE HYBRID MIGRATION INTERCEPTOR -----
  if (window.supabaseAdapter) {
    try {
      const sbResult = await window.supabaseAdapter.handleAppsPost(action, payload);
      if (sbResult !== null) return sbResult;
    } catch (sbErr) {
      console.error('[Supabase Adapter] Error:', sbErr);
      // Wait! If it throws, we should not fallback to old Apps Script logic.
      // But we must throw it exactly as the UI expects (with a message)
      if (sbErr.message && sbErr.message.includes('Migration in progress')) {
         // let it fall through
      } else {
         throw sbErr;
      }
    }
  }
  // ---------------------------------------------------

  // CSRF check: verify token matches before sending`;

if (text.includes('// ----- SUPABASE HYBRID MIGRATION INTERCEPTOR -----')) {
  console.log('Already injected!');
} else {
  text = text.replace(targetFunction, interceptor);
  fs.writeFileSync('Yarz-admin panal/index.html', text);
  console.log('Injected adapter into appsPost successfully.');
}
