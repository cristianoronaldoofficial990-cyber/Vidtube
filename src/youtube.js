'use strict';
// YouTube auto-import: follows YouTube channels through their public RSS feed and puts every new
// video or Short on VidTube by itself. yt-dlp downloads the file, then it goes through the normal
// FFmpeg queue like any upload. Moderation → YouTube import has the channel list, the log and the
// "Check now" / "Import" buttons. No YouTube API key is needed.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { DATA_DIR } = require('./db');
const {
  get, all, run, tx, route, HttpError, bad, intOf, json, now, rid, needRole, notify, audit, getSetting, setSetting, DEFAULT_SETTINGS, hashPassword,
} = require('./core');
const media = require('./media');
const safety = require('./safety');

const TOOLS_DIR = path.join(DATA_DIR, 'tools');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) VidTube-import/1.0';
const HANDLE_RX = /^[A-Za-z0-9_.-]{3,30}$/;
const RETRY_MAX = 5;
const SHORT_MAX_SECONDS = 90; // an import shorter than this becomes a Short
const FEED = id => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
const WATCH = id => 'https://www.youtube.com/watch?v=' + id;

// Channels followed from the first start. Removing one in Moderation keeps it removed.
// target: a VidTube channel handle, or 'auto' = the VidTube channel with the same handle, else a
// mirror channel made at the first import.
const DEFAULT_SOURCES = [
  { handle: 'Belgian_Mapper-t6z', target: 'Belgian_Mapper' },
  { handle: 'MapperFromMars', target: 'Belgian_Mapper' },
  { handle: 'mapperfromgreece', target: 'Belgian_Mapper' },
];

/* ---------- yt-dlp ---------- */
const EXE = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux';
let ytdlp = { path: null, version: null };
function tryBin(p) {
  try { const r = spawnSync(p, ['--version'], { windowsHide: true, timeout: 30000 }); if (r.status === 0) return String(r.stdout).trim(); } catch { /* not there */ }
  return null;
}
function findYtDlp() {
  for (const p of [process.env.YTDLP_PATH, path.join(TOOLS_DIR, EXE), 'yt-dlp'].filter(Boolean)) {
    const v = tryBin(p);
    if (v) { ytdlp = { path: p, version: v }; return ytdlp; }
  }
  ytdlp = { path: null, version: null };
  return ytdlp;
}
async function downloadYtDlp() {
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  const dest = path.join(TOOLS_DIR, EXE);
  const res = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${EXE}`, { redirect: 'follow', signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error('GitHub answered HTTP ' + res.status);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
  if (!findYtDlp().path) throw new Error('the downloaded yt-dlp does not run');
}
let installing = null;
function ensureYtDlp() {
  if (ytdlp.path || findYtDlp().path) return Promise.resolve(ytdlp);
  if (!installing) installing = downloadYtDlp()
    .then(() => console.log(`[youtube] yt-dlp ${ytdlp.version} downloaded to ${ytdlp.path}`))
    .catch(e => console.error('[youtube] yt-dlp could not be downloaded:', e.message))
    .finally(() => { installing = null; });
  return installing.then(() => ytdlp);
}
async function updateYtDlp() {
  if (!ytdlp.path) { await ensureYtDlp(); return ytdlp; }
  const r = await media.runFf(ytdlp.path, ['-U'], { signal: AbortSignal.timeout(180000) });
  if (r.code !== 0) throw new HttpError(500, 'yt-dlp could not update itself: ' + (r.err.split('\n').filter(Boolean).pop() || 'exit ' + r.code));
  return findYtDlp();
}

/* ---------- YouTube lookups ---------- */
const decodeEntities = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(n)).replace(/&amp;/g, '&');
const ytHeaders = { 'User-Agent': UA, 'Accept-Language': 'en', Cookie: 'CONSENT=YES+; SOCS=CAI' };

// "@MapperFromMars", "MapperFromMars" or a channel link -> "MapperFromMars"
function handleOf(input) {
  let s = String(input || '').trim();
  const m = /youtube\.com\/@([A-Za-z0-9_.-]+)/i.exec(s);
  if (m) s = m[1];
  s = s.replace(/^@/, '');
  if (!HANDLE_RX.test(s)) throw bad('Enter a YouTube handle such as @MapperFromMars, or the link of the channel');
  return s;
}
async function resolveHandle(handle) {
  const res = await fetch('https://www.youtube.com/@' + encodeURIComponent(handle), { headers: ytHeaders, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  if (res.status === 404) throw new Error(`YouTube has no channel @${handle}`);
  if (!res.ok) throw new Error('YouTube answered HTTP ' + res.status);
  const html = await res.text();
  const m = /"channelId":"(UC[\w-]{22})"/.exec(html) || /channel_id=(UC[\w-]{22})/.exec(html) || /<meta itemprop="identifier" content="(UC[\w-]{22})"/.exec(html);
  if (!m) throw new Error('The channel id was not found on the YouTube page');
  const t = /<meta property="og:title" content="([^"]*)"/.exec(html);
  return { channelId: m[1], title: decodeEntities(t ? t[1] : handle).slice(0, 50) };
}
async function fetchFeed(channelId) {
  const res = await fetch(FEED(channelId), { headers: ytHeaders, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error('The YouTube feed answered HTTP ' + res.status);
  const xml = await res.text();
  const title = /<title>([^<]*)<\/title>/.exec(xml);
  const entries = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const id = /<yt:videoId>([^<]+)/.exec(e);
    if (!id) continue;
    const t = /<title>([^<]*)/.exec(e), p = /<published>([^<]+)/.exec(e);
    entries.push({ id: id[1].trim(), title: decodeEntities(t ? t[1] : '').trim(), published: (p && Date.parse(p[1])) || now() });
  }
  return { title: title ? decodeEntities(title[1]).trim().slice(0, 50) : '', entries };
}
// The newest videos on the channel page itself. The RSS feed often shows an upload only after a quarter of an hour or
// more; the Shorts and Videos tabs show it within a minute. Returns the ids in page order, newest first.
const PAGE_TAKE = 6;
async function fetchPageIds(handle) {
  const out = [];
  for (const tab of ['shorts', 'videos']) {
    let html;
    try {
      const res = await fetch(`https://www.youtube.com/@${encodeURIComponent(handle)}/${tab}`, { headers: ytHeaders, redirect: 'follow', signal: AbortSignal.timeout(25000) });
      if (!res.ok) continue;
      html = await res.text();
    } catch { continue; }
    const seen = new Set(out.map(e => e.id));
    let taken = 0;
    for (const m of html.matchAll(/"videoId":"([\w-]{11})"/g)) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const near = html.slice(Math.max(0, m.index - 600), m.index + 3000);
      const t = new RegExp("shorts-shelf-item-" + m[1] + "\",\"accessibilityText\":\"(.*?)(?:, [^\",]* views?)? - play Short\"").exec(near) || /"title":\{"runs":\[\{"text":"([^"]*)"/.exec(near.slice(600));
      let title = '';
      if (t) { try { title = JSON.parse('"' + t[1] + '"'); } catch { title = t[1]; } }
      out.push({ id: m[1], title: title.trim().slice(0, 200), tab });
      if (++taken >= PAGE_TAKE) break;
    }
  }
  return out;
}
// The YouTube thumbnail (oar2 = vertical picture of a Short). Falls back to the FFmpeg frame.
async function fetchThumb(ytId, ownerId, portrait) {
  const names = portrait ? ['oar2', 'maxresdefault', 'hqdefault'] : ['maxresdefault', 'sddefault', 'hqdefault'];
  for (const name of names) {
    try {
      const res = await fetch(`https://i.ytimg.com/vi/${ytId}/${name}.jpg`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (media.sniffImage(buf) !== 'jpg' || buf.length < 2000) continue;
      const file = `t_${rid(12)}.jpg`;
      fs.writeFileSync(path.join(media.FILES_DIR, file), buf);
      run('INSERT INTO files(name,user_id,kind,created_at) VALUES(?,?,?,?)', file, ownerId, 'thumb', now());
      return file;
    } catch { /* try the next size */ }
  }
  return null;
}

/* ---------- followed channels ---------- */
const sourceRows = () => all('SELECT * FROM youtube_channels ORDER BY added_at');
function seedSources() {
  const cfg = getSetting('youtube');
  if (cfg.seeded) return;
  for (const s of DEFAULT_SOURCES) run('INSERT OR IGNORE INTO youtube_channels(handle,target,enabled,added_at) VALUES(?,?,1,?)', s.handle, s.target, now());
  setSetting('youtube', { ...cfg, seeded: true });
}
// 'auto', a VidTube handle or a channel id -> stored target text (validated).
function targetOf(v) {
  const t = String(v === undefined || v === null ? 'auto' : v).trim().replace(/^@/, '');
  if (!t || t.toLowerCase() === 'auto') return 'auto';
  const ch = /^\d+$/.test(t) ? get('SELECT handle FROM channels WHERE id=?', Number(t)) : get('SELECT handle FROM channels WHERE handle=?', t);
  if (!ch) throw bad(`There is no VidTube channel "${t}"`);
  return ch.handle;
}
// The VidTube channel the videos of a YouTube channel go to; made on first use when target = auto.
async function ensureTarget(src) {
  if (src.target_channel_id) {
    const ch = get('SELECT * FROM channels WHERE id=?', src.target_channel_id);
    if (ch) return ch;
  }
  let ch;
  if (src.target && src.target !== 'auto') {
    ch = get('SELECT * FROM channels WHERE handle=?', src.target);
    if (!ch) throw new Error(`The VidTube channel "${src.target}" no longer exists. Change the target in Moderation → YouTube import.`);
  } else ch = get('SELECT * FROM channels WHERE handle=?', src.handle) || await createMirror(src);
  run('UPDATE youtube_channels SET target_channel_id=? WHERE handle=?', ch.id, src.handle);
  return ch;
}
async function createMirror(src) {
  const email = `${src.handle.toLowerCase()}@youtube-import.local`;
  let user = get('SELECT * FROM users WHERE email=?', email);
  if (!user) {
    const hash = await hashPassword(rid(24));
    const r = run("INSERT INTO users(email,password_hash,role,email_verified,created_at) VALUES(?,?,'creator',1,?)", email, hash, now());
    run('INSERT INTO user_prefs(user_id,onboarded) VALUES(?,1)', r.lastInsertRowid);
    user = get('SELECT * FROM users WHERE id=?', Number(r.lastInsertRowid));
  }
  const existing = get('SELECT * FROM channels WHERE user_id=?', user.id);
  if (existing) return existing;
  let handle = src.handle, n = 2;
  while (get('SELECT 1 AS x FROM channels WHERE handle=?', handle)) handle = `${src.handle.slice(0, 27)}-${n++}`;
  // The house-ad picture of a befriended channel doubles as its avatar.
  let avatar = null;
  const ad = DEFAULT_SETTINGS.ads.channels.find(c => c.handle && c.handle.replace(/^@/, '').toLowerCase() === src.handle.toLowerCase());
  if (ad && ad.avatar) {
    try {
      const from = path.join(__dirname, '..', 'public', ad.avatar);
      avatar = `a_${rid(12)}${path.extname(from) || '.jpg'}`;
      fs.copyFileSync(from, path.join(media.FILES_DIR, avatar));
      run('INSERT INTO files(name,user_id,kind,created_at) VALUES(?,?,?,?)', avatar, user.id, 'avatar', now());
    } catch { avatar = null; }
  }
  const r = run('INSERT INTO channels(user_id,handle,name,description,avatar,links,created_at) VALUES(?,?,?,?,?,?,?)',
    user.id, handle, (src.title || src.handle).slice(0, 50), `Videos from youtube.com/@${src.handle}, put on VidTube automatically.`, avatar,
    JSON.stringify([{ title: 'YouTube', url: 'https://www.youtube.com/@' + src.handle }]), now());
  audit(null, 'youtube.mirror_channel', 'channel', Number(r.lastInsertRowid), { handle: src.handle });
  console.log(`[youtube] made VidTube channel @${handle} for youtube.com/@${src.handle}`);
  return get('SELECT * FROM channels WHERE id=?', Number(r.lastInsertRowid));
}

/* ---------- checking the feeds ---------- */
// Reads one channel's feed. Videos published after the channel was followed are queued; older ones
// are only listed ("seen") so they can be imported by hand. Returns how many were queued.
async function checkSource(src) {
  try {
    if (!src.channel_id) {
      const r = await resolveHandle(src.handle);
      run('UPDATE youtube_channels SET channel_id=?, title=COALESCE(title,?) WHERE handle=?', r.channelId, r.title, src.handle);
      src.channel_id = r.channelId;
    }
    // The feed is one of two sources; when YouTube does not serve it (it answered 404 for days in October 2026)
    // the channel page below still finds new uploads.
    let feed = { title: '', entries: [] }, feedError = null;
    try { feed = await fetchFeed(src.channel_id); } catch (e) { feedError = String(e && e.message || e); }
    if (feed.title && feed.title !== src.title) run('UPDATE youtube_channels SET title=? WHERE handle=?', feed.title, src.handle);
    let queued = 0;
    for (const e of feed.entries) {
      if (get('SELECT 1 AS x FROM youtube_imports WHERE yt_id=?', e.id)) {
        run("UPDATE youtube_imports SET title=? WHERE yt_id=? AND title=''", e.title, e.id); // found on the page before the feed knew it
        continue;
      }
      const fresh = e.published >= src.added_at - 10 * 60000; // the feed can lag a little behind the upload
      run("INSERT INTO youtube_imports(yt_id,handle,title,published_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        e.id, src.handle, e.title, e.published, fresh ? 'queued' : 'seen', now(), now());
      if (fresh) queued++;
    }
    // Second look at the channel page: an upload the feed does not list yet. Only what stands above a video we
    // already know is new; everything else on the page (older videos the feed never listed) is only remembered.
    const page = await fetchPageIds(src.handle);
    if (!page.length && feedError) throw new Error(feedError + ', and the channel page could not be read either');
    for (const tab of ['shorts', 'videos']) {
      const items = page.filter(e => e.tab === tab);
      const known = items.map(e => !!get('SELECT 1 AS x FROM youtube_imports WHERE yt_id=?', e.id));
      const firstKnown = known.indexOf(true);
      items.forEach((e, n) => {
        if (known[n]) return;
        const fresh = !!src.last_checked_at && firstKnown > -1 && n < firstKnown;
        run("INSERT INTO youtube_imports(yt_id,handle,title,published_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
          e.id, src.handle, e.title, now(), fresh ? 'queued' : 'seen', now(), now());
        if (fresh) queued++;
      });
    }
    run('UPDATE youtube_channels SET last_checked_at=?, last_error=? WHERE handle=?', now(), feedError ? 'Feed unavailable (' + feedError + '); the channel page is checked instead' : null, src.handle);
    if (queued) console.log(`[youtube] @${src.handle}: ${queued} new video(s) queued`);
    return queued;
  } catch (e) {
    run('UPDATE youtube_channels SET last_checked_at=?, last_error=? WHERE handle=?', now(), String(e && e.message || e).slice(0, 300), src.handle);
    return 0;
  }
}
let timer = null, polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    if (!getSetting('youtube').enabled) return;
    for (const src of sourceRows()) if (src.enabled) await checkSource(src);
    drain();
  } catch (e) { console.error('[youtube]', e); } finally { polling = false; }
}
function schedule() {
  if (timer) clearInterval(timer);
  const minutes = Math.max(1, getSetting('youtube').intervalMinutes || 2);
  timer = setInterval(() => poll(), minutes * 60000);
  timer.unref();
}

/* ---------- importing ---------- */
let draining = false, current = null;
function nextJob() {
  if (!getSetting('youtube').enabled) return null;
  // Failed ones are retried a few times, waiting 15 minutes more after each attempt (a premiere
  // or a video that is still processing on YouTube becomes available later).
  return get(`SELECT i.* FROM youtube_imports i JOIN youtube_channels c ON c.handle=i.handle
    WHERE c.enabled=1 AND (i.status='queued' OR (i.status='failed' AND i.attempts<? AND i.updated_at < ? - i.attempts*900000))
    ORDER BY i.published_at LIMIT 1`, RETRY_MAX, now());
}
function drain() {
  if (draining) return;
  draining = true;
  (async () => {
    for (;;) {
      const job = nextJob();
      if (!job) break;
      current = job.yt_id;
      await importOne(job);
      current = null;
    }
  })().catch(e => console.error('[youtube]', e)).finally(() => { draining = false; });
}
async function importOne(job) {
  const src = get('SELECT * FROM youtube_channels WHERE handle=?', job.handle);
  run("UPDATE youtube_imports SET status='downloading', attempts=attempts+1, error=NULL, updated_at=? WHERE yt_id=?", now(), job.yt_id);
  const tmp = path.join(media.TMP_DIR, 'yt_' + rid(8));
  try {
    if (!src) throw new Error('The YouTube channel is no longer followed');
    if (!media.hasFfmpeg) throw new Error('FFmpeg is needed to import YouTube videos');
    if (!ytdlp.path) await ensureYtDlp();
    if (!ytdlp.path) throw new Error('yt-dlp is not installed and could not be downloaded (see Moderation → YouTube import)');
    const target = await ensureTarget(src);
    fs.mkdirSync(tmp, { recursive: true });
    // Best MP4 whose longest side fits the configured size; H.264 first (fastest to transcode).
    const H = getSetting('youtube').maxHeight || 1280;
    const fit = `[height<=${H}][width<=${H}]`;
    const fmt = `bv*[vcodec^=avc1]${fit}[ext=mp4]+ba[ext=m4a]/bv*${fit}[ext=mp4]+ba[ext=m4a]/b${fit}[ext=mp4]/b`;
    const args = ['-q', '--no-progress', '--no-warnings', '--no-playlist', '--no-mtime', '-f', fmt, '--merge-output-format', 'mp4',
      '--write-info-json', '--no-write-playlist-metafiles', '--js-runtimes', 'node:' + process.execPath,
      '-o', path.join(tmp, 'source.%(ext)s'), WATCH(job.yt_id)];
    if (process.env.FFMPEG_PATH) args.push('--ffmpeg-location', process.env.FFMPEG_PATH);
    const r = await media.runFf(ytdlp.path, args, { signal: AbortSignal.timeout(30 * 60000) });
    if (r.code !== 0) throw new Error('yt-dlp: ' + (r.err.split('\n').map(l => l.trim()).filter(Boolean).pop() || 'exit code ' + r.code));
    const file = fs.readdirSync(tmp).find(f => /^source\.(mp4|m4v|mkv|webm)$/i.test(f));
    if (!file) throw new Error('yt-dlp did not produce a video file');
    let info = {};
    try { info = json(fs.readFileSync(path.join(tmp, 'source.info.json'), 'utf8'), {}) || {}; } catch { /* metadata is optional */ }

    // Register it exactly like an upload; the queue makes the playable versions.
    const ext = file.split('.').pop().toLowerCase();
    const assetId = rid(10);
    const dir = path.join(media.MEDIA_DIR, assetId);
    fs.mkdirSync(dir, { recursive: true });
    fs.renameSync(path.join(tmp, file), path.join(dir, 'source.' + ext));
    const size = fs.statSync(path.join(dir, 'source.' + ext)).size;
    const owner = get('SELECT user_id FROM channels WHERE id=?', target.id).user_id;
    const title = String(info.title || job.title || '').trim().slice(0, 100) || 'Untitled video';
    const credit = 'Originally on YouTube: ' + WATCH(job.yt_id);
    const own = String(info.description || '').trim();
    const description = ((own ? own + '\n\n' : '') + credit).slice(0, 5000);
    const tags = [...new Set((Array.isArray(info.tags) ? info.tags : []).map(t => String(t).trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 30);
    const portrait = !!(info.width && info.height && info.height > info.width);
    // Under 1:30 it is a Short, from 1:30 on a video; only when yt-dlp gives no duration the shape decides.
    // The owner can change it afterwards in Studio.
    const dur = Number(info.duration) || 0;
    const isShort = (dur ? dur < SHORT_MAX_SECONDS : portrait || /#shorts?\b/i.test(title)) ? 1 : 0;
    // Published 'now', not on the YouTube date: an import must show up at the top of the feeds.
    const publishedAt = now();
    const thumb = await fetchThumb(job.yt_id, owner, portrait);
    // The sexual-content detector applies here too: a hit holds the video for a moderator.
    const scan = safety.scanVideo({ title, description, tags });
    const { check, hold } = safety.applyScan(null, scan, null, null);
    const status = hold ? 'pending' : 'approved';
    const videoId = tx(() => {
      run("INSERT INTO media_assets(id,owner_id,original_name,ext,size,status,created_at) VALUES(?,?,?,?,?,'processing',?)", assetId, owner, title + '.' + ext, ext, size, now());
      const vid = rid(8);
      run('INSERT INTO videos(id,channel_id,asset_id,thumb,tags,is_short,created_at) VALUES(?,?,?,?,?,?,?)', vid, target.id, assetId, thumb, JSON.stringify(tags), isShort, now());
      run(`INSERT INTO publications(video_id,platform,title,description,visibility,status,published_at,check_json,created_at,updated_at) VALUES(?,'vidtube',?,?,'public',?,?,?,?,?)`,
        vid, title, description, status, status === 'approved' ? publishedAt : null, JSON.stringify(check), now(), now());
      run("UPDATE youtube_imports SET status='done', video_id=?, title=?, error=NULL, updated_at=? WHERE yt_id=?", vid, title, now(), job.yt_id);
      return vid;
    });
    media.enqueue(assetId);
    if (hold) { safety.notifyHold({ id: videoId }, { platform: 'vidtube', title }, owner); audit(null, 'safety.hold', 'video', videoId, { platform: 'vidtube', hits: scan.hits }); }
    notify(owner, 'upload', 'Imported from YouTube', title, '/studio/video/' + videoId);
    audit(null, 'youtube.import', 'video', videoId, { yt_id: job.yt_id, handle: job.handle, channel: target.id, short: !!isShort });
    console.log(`[youtube] imported ${job.yt_id} "${title}" -> ${videoId}`);
  } catch (e) {
    const msg = String(e && e.message || e).slice(0, 300);
    run("UPDATE youtube_imports SET status='failed', error=?, updated_at=? WHERE yt_id=?", msg, now(), job.yt_id);
    console.error(`[youtube] import of ${job.yt_id} failed: ${msg}`);
  } finally {
    fs.rm(tmp, { recursive: true, force: true }, () => {});
  }
}

/* ---------- start ---------- */
function start() {
  seedSources();
  // A download that was running when the server stopped starts over.
  run("UPDATE youtube_imports SET status='queued', updated_at=? WHERE status='downloading'", now());
  ensureYtDlp().then(() => {
    console.log(`[youtube] yt-dlp: ${ytdlp.path ? ytdlp.version + ' (' + ytdlp.path + ')' : 'NOT found - YouTube import cannot download'}`);
    schedule();
    poll();
  });
}

/* ---------- admin API ---------- */
const srcOut = s => ({
  ...s, enabled: !!s.enabled,
  target_channel: s.target_channel_id ? get('SELECT id, handle, name, avatar FROM channels WHERE id=?', s.target_channel_id) : null,
  counts: get(`SELECT COALESCE(SUM(status='done'),0) AS done, COALESCE(SUM(status='failed'),0) AS failed,
    COALESCE(SUM(status IN ('queued','downloading')),0) AS waiting, COALESCE(SUM(status='seen'),0) AS seen FROM youtube_imports WHERE handle=?`, s.handle),
});
const sourceOr404 = handle => { const s = get('SELECT * FROM youtube_channels WHERE handle=?', handle); if (!s) throw new HttpError(404, 'That YouTube channel is not followed'); return s; };

route('GET', '/api/admin/youtube', ctx => {
  needRole(ctx, 'admin');
  const { seeded, ...settings } = getSetting('youtube');
  void seeded;
  return {
    settings, ytdlp, ffmpeg: media.hasFfmpeg, busy: current,
    sources: sourceRows().map(srcOut),
    imports: all('SELECT i.*, c.title AS channel_title FROM youtube_imports i LEFT JOIN youtube_channels c ON c.handle=i.handle ORDER BY i.updated_at DESC LIMIT 100'),
  };
});
route('POST', '/api/admin/youtube/sources', async ctx => {
  const admin = needRole(ctx, 'admin');
  const handle = handleOf(ctx.body.handle);
  if (get('SELECT 1 AS x FROM youtube_channels WHERE handle=?', handle)) throw new HttpError(409, 'That YouTube channel is already followed');
  const target = targetOf(ctx.body.target);
  let r;
  try { r = await resolveHandle(handle); } catch (e) { throw bad(e.message); }
  run('INSERT INTO youtube_channels(handle,channel_id,title,target,enabled,added_at) VALUES(?,?,?,?,1,?)', handle, r.channelId, r.title, target, now());
  audit(admin.id, 'youtube.source_add', 'youtube', handle, { target });
  const src = sourceOr404(handle);
  checkSource(src).then(() => drain());
  return srcOut(src);
});
route('PATCH', '/api/admin/youtube/sources/:handle', ctx => {
  const admin = needRole(ctx, 'admin');
  const src = sourceOr404(ctx.params.handle);
  if (typeof ctx.body.enabled === 'boolean') run('UPDATE youtube_channels SET enabled=? WHERE handle=?', ctx.body.enabled ? 1 : 0, src.handle);
  if (ctx.body.target !== undefined) {
    const target = targetOf(ctx.body.target);
    run('UPDATE youtube_channels SET target=?, target_channel_id=NULL WHERE handle=?', target, src.handle);
  }
  audit(admin.id, 'youtube.source_update', 'youtube', src.handle, ctx.body);
  if (ctx.body.enabled) drain();
  return srcOut(sourceOr404(src.handle));
});
route('DELETE', '/api/admin/youtube/sources/:handle', ctx => {
  const admin = needRole(ctx, 'admin');
  const src = sourceOr404(ctx.params.handle);
  // Imported videos stay on VidTube; only the follow and its log go.
  tx(() => { run('DELETE FROM youtube_imports WHERE handle=?', src.handle); run('DELETE FROM youtube_channels WHERE handle=?', src.handle); });
  audit(admin.id, 'youtube.source_remove', 'youtube', src.handle);
  return { ok: true };
});
route('POST', '/api/admin/youtube/check', async ctx => {
  needRole(ctx, 'admin');
  let queued = 0;
  for (const src of sourceRows()) if (src.enabled) queued += await checkSource(src);
  drain();
  return { queued };
});
route('POST', '/api/admin/youtube/sources/:handle/import-all', ctx => {
  const admin = needRole(ctx, 'admin');
  const src = sourceOr404(ctx.params.handle);
  const r = run("UPDATE youtube_imports SET status='queued', attempts=0, error=NULL, updated_at=? WHERE handle=? AND status IN ('seen','failed')", now(), src.handle);
  audit(admin.id, 'youtube.import_all', 'youtube', src.handle, { queued: Number(r.changes) });
  drain();
  return { queued: Number(r.changes) };
});
route('POST', '/api/admin/youtube/imports/:id/import', ctx => {
  const admin = needRole(ctx, 'admin');
  const i = get('SELECT * FROM youtube_imports WHERE yt_id=?', ctx.params.id);
  if (!i) throw new HttpError(404, 'Video not found');
  if (!['seen', 'failed'].includes(i.status)) throw bad('That video is already ' + (i.status === 'done' ? 'imported' : 'in the queue'));
  run("UPDATE youtube_imports SET status='queued', attempts=0, error=NULL, updated_at=? WHERE yt_id=?", now(), i.yt_id);
  audit(admin.id, 'youtube.import_one', 'youtube', i.yt_id);
  drain();
  return { ok: true };
});
route('POST', '/api/admin/youtube/update', async ctx => {
  const admin = needRole(ctx, 'admin');
  await updateYtDlp();
  audit(admin.id, 'youtube.ytdlp_update', 'youtube', null, { version: ytdlp.version });
  return ytdlp;
});

module.exports = { start, schedule, poll, drain, handleOf, resolveHandle, fetchFeed, ytdlpInfo: () => ytdlp };
