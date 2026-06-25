const fs = require('fs');
const html = fs.readFileSync('Yarz-admin panal/index.html', 'utf8');
const start = html.indexOf('const doLogin = async (e)=>');
// Extract the entire doLogin function
const end = html.indexOf('function showLoginScreen()', start);
const doLoginBody = html.substring(start, end);

let script = `
let LOGIN_LOCK = { attempts: 0, lockedUntil: 0, MAX_ATTEMPTS: 5, LOCK_DURATION: 15*60*1000 };
let sessionStorage = { setItem: (k,v) => console.log('sessionStorage.setItem', k, v) };
let navigator = { userAgent: 'test' };
let window = {};
let document = {};

let domElements = {
  'login-error': { innerHTML: '', classList: { add: (c) => console.log('Added class', c, 'to login-error') } },
  'login-user': { value: 'maruf_ix' },
  'login-pass': { value: 'Hassan__00' },
  'login-btn': { disabled: false, innerHTML: '' }
};

function $(id) {
  return domElements[id];
}

async function appsPost(action, payload) {
  console.log('appsPost called with:', action, payload);
  return { success: true, ok: true, sessionToken: 'temp', token: 'temp', expiresAt: 0, ttlMs: 30000 };
}

function _adminScheduleRefresh() { console.log('_adminScheduleRefresh called'); }
function showApp() { console.log('showApp called'); }

` + doLoginBody + `

doLogin({ preventDefault: () => {} }).then(() => {
  console.log('doLogin finished.');
  console.log('btn state:', domElements['login-btn']);
}).catch(e => console.error(e));
`;

fs.writeFileSync('test_doLogin.js', script);
console.log("Wrote test_doLogin.js");
