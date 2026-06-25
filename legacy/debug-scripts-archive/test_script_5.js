
(function(){
 'use strict';

 // ========== 1. Disable Right-Click Context Menu ==========
 document.addEventListener('contextmenu', function(e){
 // Allow right-click only inside input/textarea fields (so user can paste)
 var tag = e.target.tagName;
 if(tag === 'INPUT' || tag === 'TEXTAREA') return;
 e.preventDefault();
 return false;
 }, true);

 // ========== 2. Block DevTools Keyboard Shortcuts ==========
 document.addEventListener('keydown', function(e){
 // F12
 if(e.keyCode === 123){ e.preventDefault(); return false; }
 // Ctrl+Shift+I (Inspect)
 if(e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.key === 'I' || e.key === 'i')){
 e.preventDefault(); return false;
 }
 // Ctrl+Shift+J (Console)
 if(e.ctrlKey && e.shiftKey && (e.keyCode === 74 || e.key === 'J' || e.key === 'j')){
 e.preventDefault(); return false;
 }
 // Ctrl+Shift+C (Inspect element)
 if(e.ctrlKey && e.shiftKey && (e.keyCode === 67 || e.key === 'C' || e.key === 'c')){
 e.preventDefault(); return false;
 }
 // Ctrl+U (View source)
 if(e.ctrlKey && (e.keyCode === 85 || e.key === 'U' || e.key === 'u')){
 e.preventDefault(); return false;
 }
 // Ctrl+S (Save page)
 if(e.ctrlKey && (e.keyCode === 83 || e.key === 'S' || e.key === 's')){
 e.preventDefault(); return false;
 }
 // Mac equivalents: Cmd+Opt+I, Cmd+Opt+J, Cmd+Opt+C, Cmd+Opt+U
 if(e.metaKey && e.altKey && (e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67 || e.keyCode === 85)){
 e.preventDefault(); return false;
 }
 }, true);

 // ========== 3. Disable Text Selection on App Body (allow inputs) ==========
 // (already handled via CSS user-select for buttons)

 // ========== 4. Detect DevTools Open ==========
 var devtoolsOpen = false;
 var devtoolsWarning = null;

 function showDevToolsBlock(){
 if(devtoolsOpen) return;
 devtoolsOpen = true;
 if(!devtoolsWarning){
 devtoolsWarning = document.createElement('div');
 devtoolsWarning.id = '__devtools_block__';
 devtoolsWarning.style.cssText = 'position:fixed;inset:0;z-index:999999;background:linear-gradient(135deg,#1B2530,#0D1117);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;font-family:Inter,sans-serif;text-align:center;';
 devtoolsWarning.innerHTML = '<div style="font-size:64px;margin-bottom:20px">🔒</div>' +
  '<h1 style="font-size:28px;margin-bottom:12px;font-weight:800">Access Restricted</h1>' +
  '<p style="font-size:16px;opacity:0.8;max-width:480px;line-height:1.6">Developer Tools are restricted. Please close DevTools to access the dashboard.</p>' +
  '<p style="font-size:13px;opacity:0.5;margin-top:20px">YARZ PRO · Private Dashboard</p>';
 document.body.appendChild(devtoolsWarning);
 }
 devtoolsWarning.style.display = 'flex';
 }
 function hideDevToolsBlock(){
 devtoolsOpen = false;
 if(devtoolsWarning) devtoolsWarning.style.display = 'none';
 }

 // Size-based detection (works on desktop)
 // ✅ v15.99 DISABLED: This falsely triggered a full-screen "Access Restricted"
 // block for the LEGITIMATE owner on browser zoom, OS display scaling, a
 // docked side panel, or a restored/narrow window — locking them out of their
 // own dashboard. Client-side code is always inspectable anyway (real security
 // is the server-side ADMIN_SECRET), so this guard added risk without real
 // protection. Kept the function defined (no-op call removed) to avoid touching
 // the rest of the IIFE.
 var checkDevTools = function(){
 var threshold = 160;
 var widthDiff = window.outerWidth - window.innerWidth;
 var heightDiff = window.outerHeight - window.innerHeight;
 if(widthDiff > threshold || heightDiff > threshold){
 showDevToolsBlock();
 } else {
 hideDevToolsBlock();
 }
 };
 // (v15.99) Interval intentionally NOT started — see note above.
 // if(window.innerWidth > 900){ setInterval(checkDevTools, 1000); }

 // Console detection via getter trick (DISABLED v15.99 — same reason as the
 // size detection + debugger trap: it blocked the owner the moment they
 // opened DevTools to troubleshoot. No real protection, only owner risk.)
 var __devCheckElement = new Image();
 Object.defineProperty(__devCheckElement, 'id', {
 get: function(){
 showDevToolsBlock();
 return '';
 }
 });
 // (v15.99) Interval intentionally NOT started.
 // setInterval(function(){ try { console.log(__devCheckElement); console.clear(); } catch(e){} }, 2000);

 // ========== 5. Clear console periodically & silence it ==========
 setInterval(function(){ try{ console.clear(); }catch(e){} }, 1500);

 // Override console methods (makes it less useful if opened)
 try {
 var noop = function(){};
 // Uncomment these if you want full silence:
 // console.log = noop; console.info = noop; console.warn = noop; console.debug = noop;
 } catch(e){}

 // ========== 6. Disable drag (prevents dragging images/text out) ==========
 document.addEventListener('dragstart', function(e){
 var tag = e.target.tagName;
 if(tag === 'INPUT' || tag === 'TEXTAREA') return;
 e.preventDefault();
 return false;
 }, true);

 // ========== 7. Disable copy of sensitive areas (optional light guard) ==========
 // We don't disable copy globally — user needs to copy order IDs etc.

 // ========== 8. Debugger trap (DISABLED v15.99) ==========
 // Removed the active `debugger` trap: it froze the page every 3s whenever
 // the OWNER legitimately opened DevTools to troubleshoot, actively fighting
 // their own repair work. Client code is inspectable regardless; the real
 // protection is the server-side ADMIN_SECRET. No-op now.
 // (left intentionally empty)

})();
