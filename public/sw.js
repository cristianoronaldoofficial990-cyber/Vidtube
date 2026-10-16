/* VidTube service worker. It makes the site installable as an app and shows a friendly page when
   the VidTube server is not running. Nothing is cached except that offline page, so updates to the
   site always come through immediately. */
const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VidTube is not running</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#0f0f12;color:#f1f2f5;display:flex;align-items:center;justify-content:center;min-height:100vh}main{max-width:520px;padding:32px;text-align:center}h1{font-size:22px}p{color:#aab0bd;line-height:1.5}button{margin-top:12px;padding:10px 18px;border:0;border-radius:10px;background:#6d28d9;color:#fff;font-weight:600;cursor:pointer}code{background:#1c1c22;padding:2px 6px;border-radius:6px}</style></head>
<body><main><h1>VidTube is not running</h1><p>The app could not reach the VidTube server. Start it with <b>start.cmd</b> in the VidTube folder (or <code>npm start</code>) and try again.</p><button onclick="location.reload()">Try again</button></main></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return; // files, media and API calls go straight to the server
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
