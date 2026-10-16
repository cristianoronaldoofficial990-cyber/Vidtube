'use strict';
// Media storage: streamed uploads, validation, FFmpeg processing queue, range-request delivery.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { EventEmitter } = require('events');
const { DATA_DIR } = require('./db');
const { get, all, run, HttpError, bad, now, rid, notify, json } = require('./core');

const MEDIA_DIR = path.join(DATA_DIR, 'media');
const FILES_DIR = path.join(DATA_DIR, 'files');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || FFMPEG.replace(/ffmpeg(\.exe)?$/i, (m, ext) => 'ffprobe' + (ext || ''));
const hasFfmpeg = (() => { try { return spawnSync(FFMPEG, ['-version'], { windowsHide: true }).status === 0; } catch { return false; } })();
const events = new EventEmitter();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.json': 'application/json', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.vtt': 'text/vtt; charset=utf-8', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.txt': 'text/plain; charset=utf-8',
};
const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'];

function runFf(bin, args, opts = {}) {
  return new Promise(resolve => {
    let err = '', out = '';
    const p = spawn(bin, args, { windowsHide: true, ...opts });
    p.stdout.on('data', d => { if (out.length < 2e6) out += d; });
    p.stderr.on('data', d => { err = (err + d).slice(-4000); });
    p.on('error', e => resolve({ code: -1, out, err: String(e) }));
    p.on('close', code => resolve({ code, out, err }));
  });
}

async function probe(file) {
  const r = await runFf(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (r.code !== 0) return null;
  const info = json(r.out, null);
  if (!info) return null;
  const v = (info.streams || []).find(s => s.codec_type === 'video');
  return {
    duration: parseFloat(info.format && info.format.duration) || 0,
    width: v ? v.width : 0, height: v ? v.height : 0, hasVideo: !!v,
  };
}

/* ---------- content sniffing ---------- */
function sniffVideo(b) {
  if (b.length < 12) return false;
  if (['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(b.toString('latin1', 4, 8))) return true; // MP4 / MOV
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return true;                      // WebM / MKV
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'AVI ') return true;       // AVI
  return false;
}
function sniffImage(b) {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (b.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  return null;
}

// Streams the request body to disk. `sniff(firstChunk)` may throw to reject the file early.
function receiveToFile(req, dest, maxBytes, sniff, onProgress) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    let n = 0, first = true, done = false;
    const fail = e => {
      if (done) return; done = true;
      req.unpipe(out); out.destroy(); fs.rm(dest, { force: true }, () => {});
      req.resume(); reject(e);
    };
    req.on('data', chunk => {
      if (done) return;
      if (first) { first = false; try { sniff(chunk); } catch (e) { return fail(e); } }
      n += chunk.length;
      if (n > maxBytes) return fail(new HttpError(413, `File is too large (limit ${Math.round(maxBytes / 1048576)} MB)`));
      if (onProgress) onProgress(n);
    });
    req.on('aborted', () => fail(bad('Upload was interrupted')));
    req.on('error', fail); out.on('error', fail);
    out.on('finish', () => {
      if (done) return; done = true;
      if (n === 0) { fs.rm(dest, { force: true }, () => {}); return reject(bad('The uploaded file is empty')); }
      resolve(n);
    });
    req.pipe(out);
  });
}

async function saveImage(ctx, kind) {
  let ext = null;
  const tmp = path.join(TMP_DIR, rid(12));
  await receiveToFile(ctx.req, tmp, 5 * 1048576, b => {
    ext = sniffImage(b);
    if (!ext) throw bad('Only PNG, JPG, WebP or GIF images are allowed');
  });
  const name = `${kind[0]}_${rid(12)}.${ext}`;
  fs.renameSync(tmp, path.join(FILES_DIR, name));
  run('INSERT INTO files(name,user_id,kind,created_at) VALUES(?,?,?,?)', name, ctx.user.id, kind, now());
  return name;
}
// A client may only reference files it uploaded itself (or keep the current value).
function ownFile(userId, name, current) {
  if (name === null || name === '') return null;
  if (name === current) return current;
  if (typeof name !== 'string' || !get('SELECT 1 AS x FROM files WHERE name=? AND user_id=?', name, userId)) throw bad('Unknown uploaded file');
  return name;
}

/* ---------- processing queue ---------- */
let busy = false;
function kick() {
  if (busy) return;
  const job = get("SELECT * FROM processing_jobs WHERE status='queued' ORDER BY id LIMIT 1");
  if (!job) return;
  busy = true;
  run("UPDATE processing_jobs SET status='running', started_at=? WHERE id=?", now(), job.id);
  processAsset(job.asset_id)
    .then(() => run("UPDATE processing_jobs SET status='done', finished_at=? WHERE id=?", now(), job.id))
    .catch(e => {
      const msg = String(e && e.message || e).slice(0, 500);
      run("UPDATE processing_jobs SET status='failed', error=?, finished_at=? WHERE id=?", msg, now(), job.id);
      run("UPDATE media_assets SET status='failed', error=? WHERE id=?", msg, job.asset_id);
      const a = get('SELECT owner_id FROM media_assets WHERE id=?', job.asset_id);
      if (a) notify(a.owner_id, 'upload', 'Video processing failed', msg, '/studio/content?filter=failed');
      events.emit('failed', job.asset_id);
    })
    .finally(() => { busy = false; kick(); });
}
function enqueue(assetId) {
  run("INSERT INTO processing_jobs(asset_id,status,created_at) VALUES(?,'queued',?)", assetId, now());
  kick();
}
function resumeJobs() {
  run("UPDATE processing_jobs SET status='queued' WHERE status='running'");
  kick();
}

async function processAsset(assetId) {
  const asset = get('SELECT * FROM media_assets WHERE id=?', assetId);
  if (!asset) throw new Error('Asset no longer exists');
  const dir = path.join(MEDIA_DIR, assetId);
  const source = path.join(dir, 'source.' + asset.ext);
  let qualities = [], duration = 0, width = 0, height = 0, thumb = null;

  if (!hasFfmpeg) {
    // No transcoder available: serve the original file if browsers can play it.
    if (!['mp4', 'm4v', 'webm'].includes(asset.ext)) throw new Error('FFmpeg is not installed, so only MP4 and WebM uploads can be used');
    const file = 'main.' + (asset.ext === 'webm' ? 'webm' : 'mp4');
    fs.renameSync(source, path.join(dir, file));
    qualities = [{ label: 'Original', file }];
  } else {
    const info = await probe(source);
    if (!info || !info.hasVideo) throw new Error('This file does not contain a playable video stream');
    ({ duration, width, height } = info);
    const mainH = Math.min(720, height - (height % 2)) || 360;
    const enc = async (h, file) => {
      const r = await runFf(FFMPEG, ['-y', '-i', source, '-vf', `scale=-2:${h}`, '-c:v', 'libx264', '-preset', 'veryfast',
        '-crf', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', path.join(dir, file)]);
      if (r.code !== 0) throw new Error('Transcoding failed: ' + r.err.split('\n').filter(Boolean).slice(-2).join(' '));
      qualities.push({ label: h + 'p', file });
    };
    await enc(mainH, 'main.mp4');
    if (mainH > 480) await enc(360, '360.mp4');
    const tname = `t_${rid(12)}.jpg`;
    const tr = await runFf(FFMPEG, ['-y', '-ss', String(Math.min(2, duration / 3)), '-i', path.join(dir, 'main.mp4'),
      '-frames:v', '1', '-vf', 'scale=640:-2', path.join(FILES_DIR, tname)]);
    if (tr.code === 0 && fs.existsSync(path.join(FILES_DIR, tname))) thumb = tname;
    fs.rm(source, { force: true }, () => {});
  }
  run("UPDATE media_assets SET status='ready', error=NULL, duration=?, width=?, height=?, qualities=? WHERE id=?",
    duration, width, height, JSON.stringify(qualities), assetId);
  const portraitShort = height > width && duration > 0 && duration <= 60;
  for (const v of all('SELECT id, thumb FROM videos WHERE asset_id=?', assetId)) {
    if (!v.thumb && thumb) {
      run('UPDATE videos SET thumb=? WHERE id=?', thumb, v.id);
      run('INSERT OR IGNORE INTO files(name,user_id,kind,created_at) VALUES(?,?,?,?)', thumb, asset.owner_id, 'thumb', now());
    }
    if (portraitShort) run('UPDATE videos SET is_short=1 WHERE id=?', v.id);
  }
  notify(asset.owner_id, 'upload', 'Your video finished processing', asset.original_name || '', '/studio/content');
  events.emit('ready', assetId);
}

/* ---------- delivery ---------- */
function sendFile(req, res, file, { download = null, cache = 'private, max-age=3600' } = {}) {
  let st;
  try { st = fs.statSync(file); } catch { st = null; }
  if (!st || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  const headers = {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff',
  };
  if (download) headers['Content-Disposition'] = `attachment; filename="${download.replace(/[^\w.\- ]/g, '_')}"`;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) {
    let start = m[1] ? parseInt(m[1], 10) : st.size - parseInt(m[2], 10);
    let end = m[1] && m[2] ? parseInt(m[2], 10) : st.size - 1;
    start = Math.max(0, start); end = Math.min(end, st.size - 1);
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

function deleteFile(name) {
  if (!name || name.includes('/') || name.includes('\\')) return;
  fs.rm(path.join(FILES_DIR, name), { force: true }, () => {});
  run('DELETE FROM files WHERE name=?', name);
}
// Removes the stored media once no video references the asset any more.
function releaseAsset(assetId) {
  if (get('SELECT 1 AS x FROM videos WHERE asset_id=? LIMIT 1', assetId)) return;
  run('DELETE FROM media_assets WHERE id=?', assetId);
  fs.rm(path.join(MEDIA_DIR, assetId), { recursive: true, force: true }, () => {});
}

module.exports = {
  MEDIA_DIR, FILES_DIR, TMP_DIR, FFMPEG, hasFfmpeg, events, MIME, VIDEO_EXT, runFf, probe, sniffVideo, sniffImage,
  receiveToFile, saveImage, ownFile, enqueue, resumeJobs, sendFile, deleteFile, releaseAsset,
};
