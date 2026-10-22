// "Get app": installs Pro Move on the iPad home screen. Safari can't be asked to install from a
// button, so on iPad we show the two taps; browsers that support it get the real install prompt.
(() => {
  const btn = document.getElementById('btnGetApp');
  const sheet = document.getElementById('appSheet');
  if (!btn) return;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let deferred = null;
  if (!standalone()) btn.classList.remove('hidden');
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
  addEventListener('appinstalled', () => btn.classList.add('hidden'));
  btn.addEventListener('click', async () => {
    if (deferred) { deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; return; }
    sheet.classList.remove('hidden');
  });
  document.getElementById('appSheetOk').addEventListener('click', () => sheet.classList.add('hidden'));
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.classList.add('hidden'); });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
