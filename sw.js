// خدمة بسيطة: تخزّن ملفات التطبيق نفسها فقط (لا الدروس ولا الصور) ليفتح التطبيق بسرعة.
// المحتوى المدفوع لا يُخزَّن أبداً في الجهاز.
const CACHE = 'mulakhasati-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'admin.js', 'config.js', 'icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return; // لا نتدخل في طلبات Supabase
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
