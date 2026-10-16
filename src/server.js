'use strict';
// HTTP entry point: static files, JSON API dispatch, media delivery, SSE and background tasks.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const core = require('./core');
const { get, all, run, HttpError, matchRoute, streams, isMod, canManageChannel, now } = core;
const media = require('./media');
const auth = require('./routes-auth');
require('./routes-videos');
require('./routes-studio');
require('./routes-admin');
require('./gifs');
require('./halloween');
require('./ads');
const youtube = require('./youtube');
const seed = require('./seed');

const PORT = parseInt(process.env.PORT || '4321', 10);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const INDEX = path.join(PUBLIC_DIR, 'index.html');

// Origins that may embed the site in an <iframe> (config.json "frameAncestors" / FRAME_ANCESTORS), e.g. the
// Pindows1 desktop simulator. Empty = same origin only. X-Frame-Options cannot list several origins, so it is
// only sent when no extra ancestors are configured; frame-ancestors in the CSP always applies.
const FRAME_ANCESTORS = ["'self'", ...require('./config').frameAncestors];
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  ...(FRAME_ANCESTORS.length === 1 ? { 'X-Frame-Options': 'SAMEORIGIN' } : {}),
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': `default-src 'self'; img-src 'self' data: blob: https://*.giphy.com; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors ${FRAME_ANCESTORS.join(' ')}; base-uri 'self'; form-action 'self'`,
};

function sendJson(res, status, data, extra = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY, ...extra });
  res.end(body);
}
function readBody(req, maxBytes = 1048576) {
  return new Promise((resolve, reject) => {
    const ct = String(req.headers['content-type'] || '');
    if (!/application\/json/i.test(ct)) { req.resume(); return resolve({}); }
    let data = '', n = 0;
    req.on('data', c => {
      n += c.length;
      if (n > maxBytes) { reject(new HttpError(413, 'Request body is too large')); req.destroy(); } else data += c;
    });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new HttpError(400, 'Invalid JSON body')); } });
    req.on('error', reject);
  });
}
function clientIp(req) {
  const fwd = process.env.TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  return fwd || req.socket.remoteAddress || '0.0.0.0';
}

/* ---------- media access control ---------- */
function canStream(ctx, assetId) {
  const asset = get('SELECT * FROM media_assets WHERE id=?', assetId);
  if (!asset || asset.status !== 'ready') return false;
  if (ctx.user && (ctx.user.id === asset.owner_id || isMod(ctx.user))) return true;
  for (const v of all('SELECT id, channel_id FROM videos WHERE asset_id=?', assetId)) {
    if (ctx.user && canManageChannel(ctx.user, v.channel_id)) return true;
    if (get(`SELECT 1 AS x FROM publications WHERE video_id=? AND visibility IN ('public','unlisted') AND status IN ('approved','restricted')`, v.id)) return true;
  }
  return false;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const ctx = { req, res, query: Object.fromEntries(url.searchParams), params: {}, body: {}, user: null, ip: clientIp(req), cookies: [] };
  ctx.setCookie = c => ctx.cookies.push(c);

  // Static assets and the SPA shell.
  if (method === 'GET' && !pathname.startsWith('/api/') && !pathname.startsWith('/media/') && !pathname.startsWith('/files/')) {
    let rel = '';
    try { rel = path.normalize(decodeURIComponent(pathname)).replace(/^([.][.][/\\])+/, ''); } catch { rel = ''; }
    const file = path.join(PUBLIC_DIR, rel);
    if (rel && file.startsWith(PUBLIC_DIR) && path.extname(file) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return media.sendFile(req, res, file, { cache: /\.(js|css|html)$/.test(file) ? 'no-cache' : 'public, max-age=86400' });
    }
    const html = fs.readFileSync(INDEX);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...SECURITY });
    return res.end(html);
  }

  try {
    ctx.user = auth.loadSession(req);
    if (method === 'GET' && pathname.startsWith('/files/')) {
      const name = pathname.slice(7);
      if (!/^[\w.-]+$/.test(name)) throw new HttpError(404, 'Not found');
      return media.sendFile(req, res, path.join(media.FILES_DIR, name), { cache: 'public, max-age=604800' });
    }
    if (method === 'GET' && pathname.startsWith('/media/')) {
      const [assetId, file] = pathname.slice(7).split('/');
      if (!/^[\w-]+$/.test(assetId || '') || !/^[\w.-]+$/.test(file || '')) throw new HttpError(404, 'Not found');
      if (!canStream(ctx, assetId)) throw new HttpError(403, 'This video is private');
      return media.sendFile(req, res, path.join(media.MEDIA_DIR, assetId, file));
    }

    // Same-origin check for state-changing API calls (the SameSite=Lax cookie is the second layer).
    if (method !== 'GET' && req.headers.origin) {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      if (new URL(req.headers.origin).host !== host) throw new HttpError(403, 'Cross-origin request blocked');
    }

    const m = matchRoute(method, pathname);
    if (!m) throw new HttpError(404, 'Not found');
    if (m.wrongMethod) throw new HttpError(405, 'Method not allowed');
    ctx.params = m.params;
    if (!m.route.opts.raw) ctx.body = await readBody(req);
    const result = await m.route.handler(ctx);
    if (res.writableEnded || m.route.opts.stream) return;
    const extra = ctx.cookies.length ? { 'Set-Cookie': ctx.cookies } : {};
    sendJson(res, 200, result === undefined ? { ok: true } : result, extra);
  } catch (e) {
    if (res.headersSent) return res.end();
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(`[err] ${method} ${pathname}:`, e);
    const extra = ctx.cookies.length ? { 'Set-Cookie': ctx.cookies } : {};
    sendJson(res, status, { error: status === 500 ? 'Something went wrong on our side. Please try again.' : e.message }, extra);
  }
}

/* ---------- realtime (SSE) ---------- */
core.route('GET', '/api/events', ctx => {
  const u = core.need(ctx);
  const { res } = ctx;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...SECURITY });
  res.write(`event: hello\ndata: ${JSON.stringify({ t: now() })}\n\n`);
  let set = streams.get(u.id);
  if (!set) { set = new Set(); streams.set(u.id, set); }
  set.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  ctx.req.on('close', () => { clearInterval(ping); set.delete(res); if (!set.size) streams.delete(u.id); });
}, { stream: true });

/* ---------- background tasks ---------- */
const watchLink = p => (p.platform === 'geotube' ? '/geotube' : '') + '/watch?v=' + p.video_id;
function publishScheduled() {
  const due = all(`SELECT p.video_id, p.platform, p.title, v.channel_id FROM publications p JOIN videos v ON v.id=p.video_id
    JOIN media_assets a ON a.id=v.asset_id
    WHERE p.visibility='scheduled' AND p.publish_at<=? AND a.status='ready'`, now());
  for (const p of due) {
    run("UPDATE publications SET visibility='public', published_at=COALESCE(published_at,?), updated_at=? WHERE video_id=? AND platform=?",
      now(), now(), p.video_id, p.platform);
    const ch = get('SELECT user_id FROM channels WHERE id=?', p.channel_id);
    if (ch) core.notify(ch.user_id, 'upload', 'Scheduled video is now live', p.title, watchLink(p));
  }
  notifySubscribers();
}
// Tells subscribers once about each newly public, approved, processed publication.
function notifySubscribers() {
  const fresh = all(`SELECT p.video_id, p.platform, p.title, v.channel_id, c.name, c.geo_separate, c.geo_name FROM publications p
    JOIN videos v ON v.id=p.video_id JOIN channels c ON c.id=v.channel_id JOIN media_assets a ON a.id=v.asset_id
    WHERE p.notified=0 AND p.visibility='public' AND p.status='approved' AND a.status='ready'`);
  for (const p of fresh) {
    run('UPDATE publications SET notified=1 WHERE video_id=? AND platform=?', p.video_id, p.platform);
    const name = p.platform === 'geotube' && p.geo_separate && p.geo_name ? p.geo_name : p.name;
    for (const s of all("SELECT user_id FROM subscriptions WHERE channel_id=? AND notify<>'none'", p.channel_id))
      core.notify(s.user_id, 'subscriptions', `${name} uploaded: ${p.title}`, '', watchLink(p));
  }
}
media.events.on('ready', () => { try { notifySubscribers(); } catch (e) { console.error(e); } });
setInterval(() => { try { publishScheduled(); } catch (e) { console.error('[scheduler]', e); } }, 30000).unref();
setInterval(() => {
  run('DELETE FROM sessions WHERE expires_at<?', now());
  run('DELETE FROM email_tokens WHERE expires_at<?', now());
  run('DELETE FROM outbox WHERE created_at<?', now() - 7 * core.DAY);
}, 3600000).unref();

/* ---------- start ---------- */
seed.ensure().then(() => {
  media.resumeJobs();
  try { const held = require('./safety').rescanAll(); if (held) console.log(`[safety] ${held} video(s) held for review`); } catch (e) { console.error('[safety]', e); }
  publishScheduled();
  const server = http.createServer((req, res) => {
    handle(req, res).catch(e => { console.error(e); if (!res.headersSent) sendJson(res, 500, { error: 'Server error' }); });
  });
  server.requestTimeout = 0; server.headersTimeout = 60000;
  server.listen(PORT, () => {
    console.log(`VidTube running on http://localhost:${PORT}  (GeoTube: http://localhost:${PORT}/geotube)`);
    console.log(`FFmpeg: ${media.hasFfmpeg ? 'available' : 'NOT found - only MP4/WebM uploads will play'}`);
    youtube.start();
  });
}).catch(e => { console.error('Startup failed:', e); process.exit(1); });
