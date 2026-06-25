
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

const doLogin = async (e)=>{
  if(e) e.preventDefault();
  // Check lock
  const now = Date.now();
  if(LOGIN_LOCK.lockedUntil > now){
  const secs = Math.ceil((LOGIN_LOCK.lockedUntil - now)/1000);
  const err = $('login-error');
  err.innerHTML = '<i class="ri-lock-line"></i> many wrong/incorrect attempt! '+secs+' ';
  err.classList.add('show');
  return;
  }

  const u = $('login-user').value.trim();
  const p = $('login-pass').value.trim(); // Trim password to prevent copy-paste space issues

    const btn = $('login-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ri-loader-4-line" style="animation:spin 1s linear infinite"></i> which Processing...';

  let ok = false;
  let _serverLock = 0;
  try {
  if(p) {
   // ✅ v17.5: Call adminLogin instead of verify_auth. Server validates
   // the password with a constant-time compare, checks IP-based rate
   // limit, and on success returns a 64-char hex session token.
   const res = await appsPost('adminLogin', { adminUser: u, adminPass: p, userAgent: navigator.userAgent });
   if(res && res.success && res.token){
     window._adminToken = res.token;
     sessionStorage.setItem('yarz_session_token', res.token);
     sessionStorage.setItem('yarz_session_expiresAt', String(res.expiresAt || (Date.now() + (res.ttlMs || 30*60*1000))));
     ok = true;
   }
   if(res && res.locked) {
     _serverLock = res.retryAfter || 60;
   }
  }
  } catch(e){
  console.error("Login verification failed", e); alert("LOGIN FAILED: " + e.message);
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="ri-login-box-line"></i> Sign In';

  if(ok){
  LOGIN_LOCK.attempts = 0;
  _adminScheduleRefresh();
  showApp();
  } else {
  LOGIN_LOCK.attempts++;
  if(LOGIN_LOCK.attempts >= LOGIN_LOCK.MAX_ATTEMPTS){
   LOGIN_LOCK.lockedUntil = Date.now() + LOGIN_LOCK.LOCK_DURATION;
   LOGIN_LOCK.attempts = 0;
  }
  const err = $('login-error');
  let msg;
  if (_serverLock > 0) {
   msg = '<i class="ri-lock-line"></i> Server locked. Try again in ' + _serverLock + 's.';
   LOGIN_LOCK.lockedUntil = Date.now() + (_serverLock * 1000);
  } else {
   msg = '<i class="ri-error-warning-line"></i> Incorrect username or password '+
   (LOGIN_LOCK.attempts>0 ? ' ('+(LOGIN_LOCK.MAX_ATTEMPTS-LOGIN_LOCK.attempts)+' items attempt remaining)' : '');
  }
  err.innerHTML = msg;
  err.classList.add('show');
  setTimeout(()=>err.classList.remove('show'), 4000);
  $('login-pass').value = '';
  $('login-pass').focus();
  }
  };
  $('login-btn').onclick = doLogin;
  $('login-pass').addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(e); });
  $('login-user').addEventListener('keydown', e=>{ if(e.key==='Enter') { e.preventDefault(); $('login-pass').focus(); } });
  $('login-user').focus();
}

// ✅ v17.5 PHASE 3: Session helpers.
function _adminClearSession(){
  try {
    if (window._adminToken) {
      // Fire-and-forget logout so the server-side session is marked
      // revoked immediately. Don't await — we still want the local
      // clear to be instant.
      try { appsPost('adminLogout', { sessionToken: window._adminToken }); } catch(e) {}
    }
  } catch (e) { /* ignore */ }
  try { sessionStorage.removeItem('yarz_session_token'); } catch (e) {}
  try { sessionStorage.removeItem('yarz_session_expiresAt'); } catch (e) {}
  // Wipe legacy v15.99 keys (just in case an old browser profile
  // migrated from a previous version still has them).
  try { sessionStorage.removeItem('yarz_auth'); } catch (e) {}
  try { sessionStorage.removeItem('yarz_auth_time'); } catch (e) {}
  try { sessionStorage.removeItem('yarz_ak'); } catch (e) {}
  window._adminToken = '';
}

// Auto-refresh the session 5 minutes before its expiry. The server TTL
// is the real authority; this is just UX — without it the user gets
// kicked out mid-edit when the token naturally expires. We poll the
// verify endpoint silently; if the server says the token is bad we
// drop to the login screen.
var _adminRefreshTimer = null;
function _adminScheduleRefresh(){
  try { if (_adminRefreshTimer) clearTimeout(_adminRefreshTimer); } catch(e) {}
  try {
    var exp = parseInt(sessionStorage.getItem('yarz_session_expiresAt')||'0', 10);
    if (!exp) return;
    var msUntilRefresh = Math.max(60 * 1000, exp - Date.now() - 5 * 60 * 1000);
    _adminRefreshTimer = setTimeout(function(){
      appsPost('verify_auth', { sessionToken: window._adminToken })
        .then(function(res){
          if (res && res.success) {
            // Server still happy. Push expiry out by another 30 min so
            // the next refresh is also 5 min before that.
            var newExp = Date.now() + 30 * 60 * 1000;
            _ss('yarz_session_expiresAt', String(newExp));
            _adminScheduleRefresh();
          } else {
            _adminClearSession();
            try { showLoginScreen(); } catch(e) {}
          }
        })
        .catch(function(){ _adminScheduleRefresh(); }); // network blip, try again
    }, msUntilRefresh);
  } catch (e) { /* ignore */ }
}

// ✅ v17.5 PHASE 3: Public logout function. Wipes the session both
// client-side and (best-effort) server-side. Bound to the existing
// "Sign out" UI in the admin header.
function adminLogout(){
  _adminClearSession();
  try { showLoginScreen(); } catch(e) {}
  try { toast('Signed out.', 'info'); } catch(e) {}
}

// ✅ v17.5 PHASE 3: Inverse of showApp. Used when the session token is
// rejected (401) by the server, when the user clicks "Logout", and when
// the auto-refresh fails. Idempotent — safe to call multiple times.


doLogin({ preventDefault: () => {} }).then(() => {
  console.log('doLogin finished.');
  console.log('btn state:', domElements['login-btn']);
}).catch(e => console.error(e));
